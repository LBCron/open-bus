/**
 * The agent card (AC4c): `card_request` from an attested agent, signed by the
 * hub. do.ts runs the first two checks (the AGENT_CARD_MIN_CLIENT gate, then
 * the from_ref attestation); issueCard runs the rest: nonce (bad_nonce),
 * then the per-agent rate limit (rate_limited) and the linked, canonical aud
 * (not_linked), then, asynchronously, the keys (null: `error internal`).
 * A not_linked refusal counts against the limit and a full window answers
 * rate_limited for any aud, so linked apps cannot be probed at speed. Every
 * synchronous step, including the count and the claims snapshot (name,
 * applied status), runs before the first await; do.ts re-checks the link,
 * the agent and the snapshot after it (stillTrue).
 */
import {
  AgentRefSchema,
  CARD_TTL_SEC,
  CARD_TYP,
  CARDS_PER_MINUTE,
  type CardClaims,
  CardClaimsSchema,
  type CardRefusalCode,
  NonceSchema,
} from "@ob/shared";
import { z } from "zod";
import { loadCardKeys, ownerId, signJws } from "../card/keys.js";
import { parseOrigin } from "../card/origin.js";
import type { Env } from "../env.js";
import { logEvent } from "../util/log.js";
import { isLinked } from "./linked-apps.js";
import type { AgentRow } from "./rows.js";
import { statusFields } from "./status.js";

/** The sliding window: at most CARDS_PER_MINUTE counted requests per agent in any CARD_WINDOW_MS. */
export const CARD_WINDOW_MS = 60_000;

/** Housekeeping: requests out of every window (with `now - CARD_WINDOW_MS`, then the batch). */
export const CARD_RL_PURGE_SQL =
  "delete from card_rl where rowid in (select rowid from card_rl indexed by card_rl_at where at <= ? limit ?) returning rowid";

export type CardRequest = {
  v: 1;
  id: string;
  type: "card_request";
  from_ref: string;
  aud: string;
  nonce: string;
};

/**
 * The shared frame schema already requires a valid nonce and an exact
 * origin, so such a frame never decodes. This lax shape (any short nonce or
 * aud) lets the hub answer it `card_refused bad_nonce` / `not_linked`, as the
 * spec says, instead of `bad_frame`. Used only after decodeClientFrame
 * rejected a frame it could read an id from.
 */
const LaxCardRequest = z.strictObject({
  v: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  type: z.literal("card_request"),
  from_ref: AgentRefSchema,
  aud: z.string().max(512),
  nonce: z.string().max(512),
});

export function laxCardRequest(raw: string): CardRequest | null {
  try {
    const r = LaxCardRequest.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * A sliding log, one card_rl row per counted request (at most
 * CARDS_PER_MINUTE live rows per agent): true when `agentId` already has
 * CARDS_PER_MINUTE requests in (now - CARD_WINDOW_MS, now]. Drops its rows
 * older than that first.
 */
function windowFull(sql: SqlStorage, agentId: string, now: number): boolean {
  sql.exec(
    "delete from card_rl where agent_id = ? and at <= ?",
    agentId,
    now - CARD_WINDOW_MS,
  );
  return (
    sql
      .exec<{ n: number }>(
        "select count(*) as n from card_rl where agent_id = ?",
        agentId,
      )
      .one().n >= CARDS_PER_MINUTE
  );
}

/** What a card says about the agent beyond its id: name, applied status. */
function snapshot(agent: AgentRow) {
  const st = statusFields(agent);
  return {
    name: agent.name,
    ...(st.status === undefined
      ? {}
      : {
          agent_says: {
            status: st.status,
            ...(st.statusLabel === undefined ? {} : { label: st.statusLabel }),
          },
        }),
  };
}

/**
 * After the signing await: the agent (null when no longer open) still says
 * what the card says. A close and reopen that changed none of it (same id,
 * name and status) is indistinguishable and the card is still true.
 */
export function stillTrue(agent: AgentRow | null, snap: string): boolean {
  return agent !== null && JSON.stringify(snapshot(agent)) === snap;
}

const b64url = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

type CardEnv = Parameters<typeof loadCardKeys>[0] & Pick<Env, "APP_HOST">;

/**
 * Checks 3 to 5 (synchronous), then the signing: a refusal code, or a
 * promise of the compact JWS (null: no usable keys, a test key outside dev
 * or any signing error; the caller answers `error internal`). Never rejects.
 */
export function issueCard(
  sql: SqlStorage,
  env: CardEnv,
  agent: AgentRow,
  machineLabel: string,
  f: CardRequest,
  now: number,
): { code: CardRefusalCode } | { jwt: Promise<string | null>; snap: string } {
  if (!NonceSchema.safeParse(f.nonce).success) return { code: "bad_nonce" };
  if (windowFull(sql, agent.id, now)) return { code: "rate_limited" };
  sql.exec("insert into card_rl (agent_id, at) values (?, ?)", agent.id, now);
  if (parseOrigin(f.aud, env) !== f.aud || !isLinked(sql, f.aud))
    return { code: "not_linked" };

  const iat = Math.floor(now / 1000);
  const about = snapshot(agent);
  const claims: Omit<CardClaims, "owner"> = {
    iss: `https://${env.APP_HOST}`,
    aud: f.aud,
    sub: agent.id,
    nonce: f.nonce,
    iat,
    exp: iat + CARD_TTL_SEC,
    jti: b64url(crypto.getRandomValues(new Uint8Array(16))),
    kind: agent.kind,
    machine: machineLabel,
    ...about,
  };
  const sign = async (): Promise<string | null> => {
    let keys: Awaited<ReturnType<typeof loadCardKeys>>;
    try {
      keys = await loadCardKeys(env);
    } catch {
      logEvent("card_failed", { reason: "test_key" });
      return null;
    }
    if (!keys) {
      logEvent("card_failed", { reason: "no_keys" });
      return null;
    }
    const full = CardClaimsSchema.safeParse({
      ...claims,
      owner: await ownerId(keys.ownerSalt, f.aud),
    });
    if (!full.success) {
      logEvent("card_failed", { reason: "claims" });
      return null;
    }
    return signJws(keys, CARD_TYP, full.data);
  };
  return {
    jwt: sign().catch(() => {
      logEvent("card_failed", { reason: "sign" });
      return null;
    }),
    snap: JSON.stringify(about),
  };
}
