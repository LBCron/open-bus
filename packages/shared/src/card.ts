import { z } from "zod";
import { IdSchema } from "./ids.js";
import { KindTokenSchema } from "./kinds.js";
import { LIMITS } from "./limits.js";
import { BusNameSchema } from "./names.js";
import { MachineLabelSchema } from "./refs.js";

/**
 * Agent card: status and a signed card (spec 2026-10-29; roles removed in
 * #394). The first daemon release that decodes the new server-to-daemon
 * fields and frames (roster `status*`, receipt `to_name`, `card`,
 * `card_refused`). Below it the hub withholds them. v0.54.0 was cut before
 * AC1 merged (#300), so the first release with these schemas is 0.55.0.
 */
export const AGENT_CARD_MIN_CLIENT = "0.55.0";

/** ISO 8601 with offset, as every REST and wire timestamp. */
export const IsoTimeSchema = z.string().datetime({ offset: true });

export const STATUS_STATES = [
  "working",
  "idle",
  "blocked",
  "waiting_on_owner",
] as const;
export const StatusStateSchema = z.enum(STATUS_STATES);
export type StatusState = z.infer<typeof StatusStateSchema>;

/** `MachineLabelSchema` rules, at most `LIMITS.maxLabelChars` (64) code points. */
export const StatusLabelSchema = MachineLabelSchema.refine(
  (s) => [...s].length <= LIMITS.maxLabelChars,
  "status label too long",
);
/** Self-reported by the agent (`set_status`); shown tagged "agent says". */
export const AgentStatusSchema = z.strictObject({
  state: StatusStateSchema,
  label: StatusLabelSchema.optional(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** OA's card nonce and the link `state`. */
export const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

const isOrigin = (s: string): boolean => {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  const loopback =
    u.hostname === "localhost" ||
    u.hostname === "127.0.0.1" ||
    u.hostname === "[::1]";
  return (
    u.origin === s &&
    (u.protocol === "https:" || (u.protocol === "http:" && loopback))
  );
};
/**
 * An exact origin: `https://host[:port]`, no path, query, fragment or
 * userinfo, lowercase, default port omitted (http only on loopback). The
 * card's `iss`/`aud`, a linked app's `aud`.
 */
export const OriginSchema = z
  .string()
  .max(512)
  .refine(isOrigin, "not an exact https origin");

export const CARD_TYP = "ob-card+jwt";
export const LINK_TYP = "ob-link+jwt";
/** `exp = iat + CARD_TTL_SEC` for cards and link assertions. */
export const CARD_TTL_SEC = 300;
/** The coalescing window for status updates. */
export const STATUS_WINDOW_MS = 5000;
/** Card requests per agent per minute. */
export const CARDS_PER_MINUTE = 6;
/** Linked apps listed at most. */
export const MAX_LINKED_APPS = 100;

export const CARD_REFUSAL_CODES = [
  "not_linked",
  "bad_nonce",
  "rate_limited",
] as const;
export const CardRefusalCodeSchema = z.enum(CARD_REFUSAL_CODES);
export type CardRefusalCode = z.infer<typeof CardRefusalCodeSchema>;

/** `base64url(HMAC-SHA256(...))`: 32 bytes. */
const OwnerSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
/** 128 random bits, base64url. */
const JtiSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const SecSchema = z.number().int().nonnegative();
const lives300 = (c: { iat: number; exp: number }): boolean =>
  c.exp === c.iat + CARD_TTL_SEC;

/** Signed by the hub (`typ: ob-card+jwt`). Never email, namespace or machine id. */
export const CardClaimsSchema = z
  .strictObject({
    iss: OriginSchema,
    aud: OriginSchema,
    sub: IdSchema,
    owner: OwnerSchema,
    nonce: NonceSchema,
    iat: SecSchema,
    exp: SecSchema,
    jti: JtiSchema,
    name: BusNameSchema,
    /** @deprecated never sent since #394; removal tracked in #396 */
    role: BusNameSchema.optional(),
    kind: KindTokenSchema,
    machine: MachineLabelSchema,
    /** Self-reported. */
    agent_says: z
      .strictObject({
        status: StatusStateSchema,
        label: StatusLabelSchema.optional(),
      })
      .optional(),
  })
  .refine(lives300, "exp must be iat + 300");
export type CardClaims = z.infer<typeof CardClaimsSchema>;

/** Signed by the Worker's `/link` route (`typ: ob-link+jwt`). */
export const LinkClaimsSchema = z
  .strictObject({
    iss: OriginSchema,
    aud: OriginSchema,
    owner: OwnerSchema,
    state: NonceSchema,
    iat: SecSchema,
    exp: SecSchema,
    jti: JtiSchema,
  })
  .refine(lives300, "exp must be iat + 300");
export type LinkClaims = z.infer<typeof LinkClaimsSchema>;
