import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVER_TEST_CARD_KEY_X } from "../src/card/keys.js";
import type { Env } from "../src/env.js";
import { resetCardKeyGuardLog } from "../src/http/card-key-guard.js";
import worker from "../src/index.js";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;
const jwk = (x: string) =>
  JSON.stringify({ kty: "OKP", crv: "Ed25519", x, kid: "ob-k", alg: "EdDSA" });
const prod = (o: Partial<Env>): Env =>
  ({ ...(env as unknown as Env), ENVIRONMENT: "production", ...o }) as Env;
const get = (p: string, e: Env, init?: RequestInit) =>
  worker.fetch(
    new Request(`https://app.localhost${p}`, init) as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    e,
    ctx,
  );
const TEST = jwk(SERVER_TEST_CARD_KEY_X);
/** The same 32 bytes with spare low bits set in the last character (AC4a review). */
const NONCANONICAL = jwk(
  `${SERVER_TEST_CARD_KEY_X.slice(0, -1)}${String.fromCharCode(SERVER_TEST_CARD_KEY_X.charCodeAt(SERVER_TEST_CARD_KEY_X.length - 1) + 1)}`,
);
const REAL = jwk("bm90LXRoZS10ZXN0LWtleS1hdC1hbGwtMDEyMzQ1Njc4OQ");

afterEach(() => {
  resetCardKeyGuardLog();
  vi.restoreAllMocks();
});

describe("test card key guard (I11)", () => {
  it("the test key answers 503 outside dev, on every route but /healthz", async () => {
    for (const e of [
      prod({ CARD_SIGNING_KEY: TEST }),
      prod({ CARD_SIGNING_KEY: REAL, CARD_SIGNING_KEY_PREV: TEST }),
      prod({ CARD_SIGNING_KEY: NONCANONICAL }),
      prod({ CARD_SIGNING_KEY: REAL, CARD_SIGNING_KEY_PREV: NONCANONICAL }),
    ]) {
      for (const p of ["/", "/api/agents", "/device/code", "/hub", "/nope"]) {
        const r = await get(p, e);
        expect(r.status, p).toBe(503);
        expect(r.headers.get("cache-control")).toBe("no-store");
        const body = (await r.json()) as {
          error: { code: string; message: string };
        };
        expect(body.error.code).toBe("internal");
        expect(body.error.message).toContain("--rotate-card-key --force");
      }
      expect((await get("/device/code", e, { method: "POST" })).status).toBe(
        503,
      );
    }
  });

  it("HEAD /healthz passes too, so a HEAD probe sees the bus up (#392)", async () => {
    const e = prod({ CARD_SIGNING_KEY: TEST });
    expect((await get("/healthz", e, { method: "HEAD" })).status).toBe(200);
    expect((await get("/healthz", e, { method: "POST" })).status).toBe(503);
    expect((await get("/", e, { method: "HEAD" })).status).toBe(503);
  });

  it("/healthz still answers, with problem: test_card_key", async () => {
    const r = await get("/healthz", prod({ CARD_SIGNING_KEY: TEST }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      version: "dev",
      problem: "test_card_key",
    });
  });

  it("a real key, no key, or a malformed key passes, with no problem", async () => {
    for (const k of [REAL, undefined, "not json"]) {
      const e = prod({ CARD_SIGNING_KEY: k });
      expect((await get("/healthz", e)).status).toBe(200);
      expect(await (await get("/healthz", e)).json()).toEqual({
        version: "dev",
      });
      expect((await get("/robots.txt", e)).status).toBe(200);
    }
  });

  it("dev accepts the test key", async () => {
    const e = prod({ CARD_SIGNING_KEY: TEST, ENVIRONMENT: "dev" });
    expect((await get("/robots.txt", e)).status).toBe(200);
    expect(await (await get("/healthz", e)).json()).toEqual({ version: "dev" });
  });

  it("logs one line per isolate, with no key material", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const e = prod({ CARD_SIGNING_KEY: TEST });
    for (let i = 0; i < 3; i++) await get("/", e);
    const lines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("card_key_is_test_key"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SERVER_TEST_CARD_KEY_X);
    expect(lines[0]).toContain("docs/ops/releases.md");
  });
});
