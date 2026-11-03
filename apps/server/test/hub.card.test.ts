// AC4c: card_request signing in the hub DO. The order of checks (gate,
// from_ref, nonce, linked aud, rate limit, keys), the claims, rotation and a
// socket replaced while the card is signed. Time is a frozen Hub.setTestClock
// an hour ahead of wall time, so the real alarm never fires on its own.
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  AGENT_CARD_MIN_CLIENT,
  CARD_TTL_SEC,
  CARD_TYP,
  CardClaimsSchema,
  OWNER_ORG_ID,
  type ServerFrame,
} from "@ob/shared";
import { TEST_CARD_JWK } from "@ob/shared/mocks";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  type JWK,
  jwtVerify,
} from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { loadCardKeys, ownerId } from "../src/card/keys.js";
import type { Env } from "../src/env.js";
import { Hub } from "../src/hub/do.js";
import { hub } from "../src/hub/stub.js";
import {
  type Daemon,
  daemon,
  e,
  framesSeen,
  inOwnerHub,
  machine,
  ns,
  up,
  waitFor,
} from "./helpers.js";

const stub = () => hub(e) as unknown as DurableObjectStub<Hub>;
const inHub = <R>(fn: (i: Hub, s: DurableObjectState) => R) =>
  runInDurableObject(stub(), fn);
const setClock = (ms: number | null) => inHub((i) => Hub.setTestClock(i, ms));
const setCardEnv = (c: Partial<Env> | null) =>
  inHub((i) => Hub.setCardEnvForTests(i, c));

const SALT = `${"s".repeat(24)}A_-0123456789abcdefghijk`;
const KEYS: Partial<Env> = {
  CARD_SIGNING_KEY: JSON.stringify(TEST_CARD_JWK),
  CARD_OWNER_SALT: SALT,
};
const cardEnv = (c: Partial<Env> = KEYS) => ({ ...e, ...c });
const NOW = Date.now() + 3_600_000;
const NONCE = "nonce_0123456789-abc";

afterEach(async () => {
  await setClock(null);
  await setCardEnv(null);
  await inHub((i) => Hub.holdCardsForTests(i, null));
});

let seq = 0;
const id = (t: string) => `${t}${++seq}`;
const newAud = () => `https://oa-${++seq}-${Date.now()}.example.com`;

async function at(
  version = AGENT_CARD_MIN_CLIENT,
  token?: string,
): Promise<Daemon & { token: string }> {
  const t = token ?? (await machine("Card Mac")).token;
  const d = await daemon(t);
  d.send({
    v: 1,
    id: id("h"),
    type: "hello",
    machine_label: "Card Mac",
    client_version: version,
  });
  await waitFor(d, "hello_ok");
  return Object.assign(d, { token: t });
}

async function register(d: Daemon, ref: string, n: string): Promise<string> {
  const namespace = ns("card");
  d.send(up(id("u"), ref, n, namespace));
  expect((await waitFor(d, "agent_ok")).bus_name).toBe(n);
  return inOwnerHub(
    (s) =>
      s.storage.sql
        .exec<{ id: string }>(
          "select id from agents where native_ref = ? and live = 1 and namespace = ?",
          ref,
          namespace,
        )
        .one().id,
  );
}

/** Raw JSON: some cases are deliberately off-schema. */
function request(d: Daemon, from_ref: string, aud: string, nonce = NONCE) {
  const fid = id("c");
  d.ws.send(
    JSON.stringify({
      v: 1,
      id: fid,
      type: "card_request",
      from_ref,
      aud,
      nonce,
    }),
  );
  return fid;
}

/** The reply to frame `fid`. */
async function reply(d: Daemon, fid: string): Promise<ServerFrame> {
  for (;;) {
    const f = await d.next();
    if (f.id === fid) return f;
  }
}

const settled = () => inHub((i) => Hub.cardsSettledForTests(i));

async function verify(jwt: string, c: Partial<Env> = KEYS, aud?: string) {
  const keys = await loadCardKeys(cardEnv(c));
  if (!keys) throw new Error("no keys");
  return jwtVerify(jwt, createLocalJWKSet(keys.jwks), {
    algorithms: ["EdDSA"],
    typ: CARD_TYP,
    issuer: "https://app.localhost",
    ...(aud ? { audience: aud } : {}),
    currentDate: new Date(NOW),
  });
}

async function card(d: Daemon, ref: string, aud: string): Promise<string> {
  const r = await reply(d, request(d, ref, aud));
  if (r.type !== "card") throw new Error(`expected card: ${JSON.stringify(r)}`);
  return r.jwt;
}

describe("card_request (AC4c)", () => {
  it("signs a card that verifies against the JWKS, with the applied status", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    expect(await stub().linkApp(aud)).toBe(true);
    const d = await at();
    const agentId = await register(d, "ses_a", "Carder");
    // Applied at once, then a coalesced (pending) one that must not show.
    for (const [state, label] of [
      ["working", "on it"],
      ["blocked", "pending one"],
    ])
      d.ws.send(
        JSON.stringify({
          v: 1,
          id: id("s"),
          type: "status",
          from_ref: "ses_a",
          state,
          label,
        }),
      );

    const fid = request(d, "ses_a", aud);
    const r = await reply(d, fid);
    expect(r.type).toBe("card");
    const jwt = (r as Extract<ServerFrame, { type: "card" }>).jwt;
    const { payload, protectedHeader } = await verify(jwt, KEYS, aud);
    expect(protectedHeader).toMatchObject({
      alg: "EdDSA",
      typ: CARD_TYP,
      kid: TEST_CARD_JWK.kid,
    });
    const iat = Math.floor(NOW / 1000);
    expect(payload).toEqual({
      iss: "https://app.localhost",
      aud,
      sub: agentId,
      owner: await ownerId(SALT, aud),
      nonce: NONCE,
      iat,
      exp: iat + CARD_TTL_SEC,
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      name: "Carder",
      kind: "opencode",
      machine: "Card Mac",
      agent_says: { status: "working", label: "on it" },
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
    for (const k of ["email", "namespace", "machine_id", "machineId", "role"])
      expect(payload).not.toHaveProperty(k);
    expect(() => CardClaimsSchema.parse(payload)).not.toThrow();
    // A fresh jti every time.
    const again = await verify(await card(d, "ses_a", aud), KEYS, aud);
    expect(again.payload.jti).not.toBe(payload.jti);
    d.close();
  });

  it("never carries role, and leaves out agent_says when there is none", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at();
    await register(d, "ses_b", "Plain");
    const { payload } = await verify(await card(d, "ses_b", aud), KEYS, aud);
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("agent_says");
    d.close();
  });

  it("at most 6 cards in any rolling 60 s", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at();
    await register(d, "ses_r", "Rater");
    const limited = async () => {
      const fid = request(d, "ses_r", aud);
      expect(await reply(d, fid)).toEqual({
        v: 1,
        id: fid,
        type: "card_refused",
        code: "rate_limited",
      });
    };
    // A bad nonce is not counted.
    for (let i = 0; i < 3; i++)
      expect(await reply(d, request(d, "ses_r", aud, "short"))).toMatchObject({
        code: "bad_nonce",
      });
    await setClock(NOW + 59_900);
    for (let i = 0; i < 6; i++) await card(d, "ses_r", aud);
    await limited();
    await setClock(NOW + 60_000);
    await limited();
    await setClock(NOW + 119_899);
    await limited();
    // The six at 59.9 s have left the window: six more, then full again.
    await setClock(NOW + 119_950);
    for (let i = 0; i < 6; i++) await card(d, "ses_r", aud);
    await limited();
    d.close();
  });

  it("not_linked refusals count, so linked apps cannot be probed at speed", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at();
    await register(d, "ses_p", "Prober");
    for (let i = 0; i < 6; i++)
      expect(await reply(d, request(d, "ses_p", newAud()))).toMatchObject({
        type: "card_refused",
        code: "not_linked",
      });
    // Full: linked and unlinked auds look the same.
    for (const a of [newAud(), aud])
      expect(await reply(d, request(d, "ses_p", a))).toMatchObject({
        type: "card_refused",
        code: "rate_limited",
      });
    await setClock(NOW + 60_001);
    await card(d, "ses_p", aud);
    d.close();
  });

  it("refuses an unlinked aud, a bad nonce, an unlinked-after-link aud and a non-canonical aud", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const d = await at();
    await register(d, "ses_e", "Erry");
    // A fresh rate-limit window per request: not_linked refusals count.
    let t = NOW;
    const req = async (aud: string, nonce?: string) => {
      t += 60_001;
      await setClock(t);
      return request(d, "ses_e", aud, nonce);
    };
    const refused = async (fid: string, code: string) =>
      expect(await reply(d, fid)).toEqual({
        v: 1,
        id: fid,
        type: "card_refused",
        code,
      });

    await refused(await req(newAud()), "not_linked");
    const aud = newAud();
    await stub().linkApp(aud);
    await refused(await req(aud, "short"), "bad_nonce");
    await refused(await req(aud, `${"n".repeat(16)}!`), "bad_nonce");
    t += 60_001;
    await setClock(t);
    await card(d, "ses_e", aud);
    expect(await stub().unlinkApp(aud)).toBe(true);
    await refused(await req(aud), "not_linked");

    // Stored as is (never through linkApp), still not canonical.
    const dotted = `${newAud()}.`;
    await inOwnerHub((s) =>
      s.storage.sql.exec(
        "insert into linked_apps (org_id, aud, linked_at) values (?, ?, ?)",
        OWNER_ORG_ID,
        dotted,
        NOW,
      ),
    );
    await refused(await req(dotted), "not_linked");
    const linked = newAud();
    await stub().linkApp(linked);
    await refused(await req(linked.toUpperCase()), "not_linked");
    await refused(await req(`${linked}/`), "not_linked");
    await refused(await req(`${linked}:443`), "not_linked");
    d.close();
  });

  it("an unregistered from_ref is not_registered", async () => {
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at();
    await register(d, "ses_n", "Known");
    const fid = request(d, "ses_other", aud);
    expect(await reply(d, fid)).toMatchObject({
      type: "error",
      code: "not_registered",
    });
    d.close();
  });

  for (const v of ["0.53.0", "0.54.0"])
    it(`a ${v} daemon gets bad_frame, before attestation, and never a card`, async () => {
      await setCardEnv(KEYS);
      const aud = newAud();
      await stub().linkApp(aud);
      const d = await at(v);
      await register(d, "ses_old", "Oldie");
      for (const ref of ["ses_old", "ses_nobody"]) {
        const fid = request(d, ref, aud);
        expect(await reply(d, fid)).toMatchObject({
          type: "error",
          code: "bad_frame",
        });
      }
      const fid = request(d, "ses_old", aud, "short");
      expect(await reply(d, fid)).toMatchObject({ code: "bad_frame" });
      const types = framesSeen(d).map((f) => f.type);
      expect(types).not.toContain("card");
      expect(types).not.toContain("card_refused");
      d.close();
    });

  it("0.55.0, the lowest gated version, gets a card", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at("0.55.0");
    await register(d, "ses_new", "Newbie");
    await card(d, "ses_new", aud);
    d.close();
  });

  it("missing keys, or the test key outside dev, give internal", async () => {
    await setClock(NOW);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at();
    await register(d, "ses_k", "Keyless");
    for (const c of [
      {},
      { CARD_SIGNING_KEY: KEYS.CARD_SIGNING_KEY },
      { ...KEYS, ENVIRONMENT: "production" as const },
    ]) {
      await setCardEnv({
        CARD_SIGNING_KEY: undefined,
        CARD_OWNER_SALT: undefined,
        ...c,
      });
      const fid = request(d, "ses_k", aud);
      expect(await reply(d, fid)).toMatchObject({
        id: fid,
        type: "error",
        code: "internal",
      });
    }
    expect(framesSeen(d).map((f) => f.type)).not.toContain("card");
    d.close();
  });

  it("after a rotation (PREV = the old public key) an old card still verifies", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at();
    await register(d, "ses_rot", "Rotor");
    const old = await card(d, "ses_rot", aud);

    const { privateKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    });
    const next: JWK = {
      ...(await exportJWK(privateKey)),
      kid: "ob-rotated-2",
      alg: "EdDSA",
    };
    const { d: _d, ...prev } = TEST_CARD_JWK;
    const rotated: Partial<Env> = {
      CARD_SIGNING_KEY: JSON.stringify(next),
      CARD_SIGNING_KEY_PREV: JSON.stringify(prev),
      CARD_OWNER_SALT: SALT,
    };
    await setCardEnv(rotated);
    const fresh = await card(d, "ses_rot", aud);
    expect(decodeProtectedHeader(fresh).kid).toBe("ob-rotated-2");
    expect((await verify(old, rotated, aud)).payload.sub).toBeTruthy();
    expect((await verify(fresh, rotated, aud)).payload.sub).toBeTruthy();
    d.close();
  });

  it("a socket replaced while the card is signed gets nothing", async () => {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d1 = await at();
    await register(d1, "ses_x", "Replaced");
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    await inHub((i) => Hub.holdCardsForTests(i, hold));
    const fid = request(d1, "ses_x", aud);
    // A round trip: the request's synchronous part ran.
    const h = id("b");
    d1.send({
      v: 1,
      id: h,
      type: "hello",
      machine_label: "Card Mac",
      client_version: AGENT_CARD_MIN_CLIENT,
    });
    await reply(d1, h);
    const d2 = await at(AGENT_CARD_MIN_CLIENT, d1.token);
    release();
    await settled();
    for (const d of [d1, d2])
      expect(framesSeen(d).filter((f) => f.id === fid)).toEqual([]);
    d2.close();
  });

  // The socket stays open but is marked dead (as between a replace or revoke
  // mark and its close): only the re-check after the await keeps the card off.
  for (const mark of [false, true])
    it(`a held card ${mark ? "is dropped on a socket marked replaced" : "arrives on a live socket"}`, async () => {
      await setClock(NOW);
      await setCardEnv(KEYS);
      const aud = newAud();
      await stub().linkApp(aud);
      const d = await at();
      const agentId = await register(d, "ses_m", "Marked");
      let release!: () => void;
      const hold = new Promise<void>((r) => {
        release = r;
      });
      await inHub((i) => Hub.holdCardsForTests(i, hold));
      const fid = request(d, "ses_m", aud);
      const h = id("b");
      d.send({
        v: 1,
        id: h,
        type: "hello",
        machine_label: "Card Mac",
        client_version: AGENT_CARD_MIN_CLIENT,
      });
      await reply(d, h);
      if (mark)
        await inOwnerHub((s) => {
          const m = s.storage.sql
            .exec<{ m: string }>(
              "select machine_id as m from agents where id = ?",
              agentId,
            )
            .one().m;
          for (const w of s.getWebSockets(m))
            w.serializeAttachment({ machineId: m, replaced: true });
        });
      release();
      await settled();
      if (mark) {
        expect(framesSeen(d).filter((f) => f.id === fid)).toEqual([]);
      } else {
        expect((await reply(d, fid)).type).toBe("card");
      }
      d.close();
    });
});

describe("re-checks after the signing await (AC4c)", () => {
  async function held(
    ref: string,
    n: string,
    before?: (agentId: string) => Promise<void>,
  ) {
    await setClock(NOW);
    await setCardEnv(KEYS);
    const aud = newAud();
    await stub().linkApp(aud);
    const d = await at();
    const agentId = await register(d, ref, n);
    if (before) await before(agentId);
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    await inHub((i) => Hub.holdCardsForTests(i, hold));
    const fid = request(d, ref, aud);
    const h = id("b");
    d.send({
      v: 1,
      id: h,
      type: "hello",
      machine_label: "Card Mac",
      client_version: AGENT_CARD_MIN_CLIENT,
    });
    await reply(d, h);
    return { d, aud, fid, release };
  }

  it("an aud unlinked mid-sign gets card_refused not_linked", async () => {
    const { d, aud, fid, release } = await held("ses_u", "Unlinky");
    expect(await stub().unlinkApp(aud)).toBe(true);
    release();
    await settled();
    expect(await reply(d, fid)).toEqual({
      v: 1,
      id: fid,
      type: "card_refused",
      code: "not_linked",
    });
    d.close();
  });

  it("an agent closed mid-sign gets nothing", async () => {
    const { d, fid, release } = await held("ses_c", "Closer");
    d.send({ v: 1, id: id("dn"), type: "agent_down", agent_ref: "ses_c" });
    const h = id("b");
    d.send({
      v: 1,
      id: h,
      type: "hello",
      machine_label: "Card Mac",
      client_version: AGENT_CARD_MIN_CLIENT,
    });
    await reply(d, h);
    release();
    await settled();
    expect(framesSeen(d).filter((f) => f.id === fid)).toEqual([]);
    d.close();
  });
});

describe("card_rl housekeeping (AC4c)", () => {
  it("the alarm purges requests older than 60 s and keeps newer ones", async () => {
    await setClock(NOW);
    await inOwnerHub((s) => {
      s.storage.sql.exec("delete from card_rl");
      s.storage.sql.exec(
        "insert into card_rl (agent_id, at) values ('old', ?), ('old', ?), ('cur', ?)",
        NOW - 60_000,
        NOW - 70_000,
        NOW - 59_999,
      );
    });
    await runDurableObjectAlarm(stub());
    const left = await inOwnerHub((s) =>
      s.storage.sql
        .exec<{ a: string }>("select agent_id as a from card_rl order by a")
        .toArray()
        .map((r) => r.a),
    );
    expect(left).toEqual(["cur"]);
  });
});
