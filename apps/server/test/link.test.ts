// AC4c Task 9: GET /link, GET/POST /link/confirm.
import { env } from "cloudflare:workers";
import { CARD_TTL_SEC, LINK_TYP, MAX_LINKED_APPS, R } from "@ob/shared";
import { TEST_CARD_JWK } from "@ob/shared/mocks";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  jwtVerify,
} from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LINK_COOKIE_TTL_S,
  linkCookieName,
  linkCsrf,
  sealLink,
} from "../src/auth/link-cookie.js";
import { ROUTE_POLICY } from "../src/auth/route-policy.js";
import {
  OWNER_UID,
  sessionCookieName,
  sessionGeneration,
  signSession,
} from "../src/auth/session.js";
import { ownerId } from "../src/card/keys.js";
import type { Env } from "../src/env.js";
import { hub } from "../src/hub/stub.js";
import worker from "../src/index.js";
import { LINK_CALLBACK_PATH } from "../src/routes/link.js";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;
const base = env as unknown as Env;
const SALT = `${"s".repeat(24)}A_-0123456789abcdefghijk`;
/** Dev: the shared test key is allowed. */
const DEV: Env = {
  ...base,
  CARD_SIGNING_KEY: JSON.stringify(TEST_CARD_JWK),
  CARD_OWNER_SALT: SALT,
};
const ORIGIN = `https://${base.APP_HOST}`;
const FORM = "application/x-www-form-urlencoded";

let seq = 0;
const newAud = () => `https://oa-${++seq}-${Date.now()}.example.com`;
const STATE = "state_0123456789-abcdef";

const call = (path: string, e: Env = DEV, init?: RequestInit) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }) as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    e,
    ctx,
  );

const q = (p: Record<string, string>) =>
  `${R.link}?${new URLSearchParams(p).toString()}`;
const start = (aud: string, over: Record<string, string> = {}, e = DEV) =>
  call(q({ aud, state: STATE, ...over }), e);

const session = async (e: Env = DEV) => ({
  uid: OWNER_UID,
  gen: await sessionGeneration(e),
});
const sessionCookie = async (e: Env = DEV) =>
  `${sessionCookieName(e)}=${await signSession(e)}`;

/** The ob_link cookie value from a /link response. */
function linkValue(r: Response, e: Env = DEV): string {
  const sc = r.headers.get("set-cookie") ?? "";
  const m = new RegExp(`${linkCookieName(e)}=([^;]*)`).exec(sc);
  if (!m) throw new Error(`no link cookie in ${sc}`);
  return m[1] as string;
}

async function begin(aud: string, e: Env = DEV) {
  const r = await start(aud, {}, e);
  expect(r.status).toBe(303);
  return linkValue(r, e);
}

const confirmPage = async (link: string | null, e: Env = DEV) =>
  call(R.linkConfirm, e, {
    headers: {
      cookie: [
        await sessionCookie(e),
        ...(link === null ? [] : [`${linkCookieName(e)}=${link}`]),
      ].join("; "),
    },
  });

async function post(
  link: string,
  decision: string,
  opts: { csrf?: string | null; origin?: string; e?: Env } = {},
) {
  const e = opts.e ?? DEV;
  const csrf =
    opts.csrf === undefined
      ? await linkCsrf(e, link, await session(e))
      : opts.csrf;
  const body = new URLSearchParams({ decision });
  if (csrf !== null) body.set("csrf", csrf);
  const text = body.toString();
  return call(R.linkConfirm, e, {
    method: "POST",
    headers: {
      "content-type": FORM,
      "content-length": String(text.length),
      origin: opts.origin ?? ORIGIN,
      cookie: `${await sessionCookie(e)}; ${linkCookieName(e)}=${link}`,
    },
    body: text,
  });
}

const linked = async () => (await hub(DEV).listLinkedApps()).map((a) => a.aud);

/** Fragment params of a Location. */
function fragment(r: Response): URLSearchParams {
  const loc = r.headers.get("location") ?? "";
  return new URLSearchParams(loc.slice(loc.indexOf("#") + 1));
}

const clears = (r: Response, e: Env = DEV) =>
  expect(r.headers.get("set-cookie")).toMatch(
    new RegExp(`^${linkCookieName(e)}=;.*Max-Age=0`),
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("route policy", () => {
  it("the callback path is fixed", () => {
    expect(LINK_CALLBACK_PATH).toBe("/settings/openbus/callback");
  });

  it("pins the three /link rows", () => {
    expect(ROUTE_POLICY[`GET ${R.link}`]).toEqual({
      public: expect.any(String),
    });
    expect(ROUTE_POLICY[`GET ${R.linkConfirm}`]).toEqual({
      session: expect.any(String),
      signedOut: "login",
    });
    expect(ROUTE_POLICY[`POST ${R.linkConfirm}`]).toEqual({
      session: expect.any(String),
      form: expect.any(Function),
    });
  });
});

describe("GET /link validates before anything else", () => {
  it("sets the cookie and 303s to /link/confirm", async () => {
    const r = await start(newAud());
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(R.linkConfirm);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(
      /^ob_link=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=600$/,
    );
    expect(LINK_COOKIE_TTL_S).toBe(600);
  });

  it("outside dev the cookie is __Host- and Secure", async () => {
    const { privateKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    });
    const prod: Env = {
      ...DEV,
      ENVIRONMENT: "production",
      CARD_SIGNING_KEY: JSON.stringify({
        ...(await exportJWK(privateKey)),
        kid: "ob-prod",
        alg: "EdDSA",
      }),
    };
    const r = await start(newAud(), {}, prod);
    expect(r.status).toBe(303);
    expect(r.headers.get("set-cookie")).toMatch(
      /^__Host-ob_link=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=600$/,
    );
  });

  const host = "oa.example";
  const badAuds = [
    "HTTPS://OA.EXAMPLE", // not canonical: refused, never normalized
    `https://${host}/`,
    `https://${host}:443`,
    `https://u@${host}`,
    `http://${host}`,
    `https://${host}/path`,
    `https://${host}?q`,
    `https://${host}#f`,
    "",
  ];
  for (const aud of badAuds)
    it(`refuses aud ${JSON.stringify(aud)}`, async () => {
      const r = await call(q({ aud, state: STATE }));
      expect(r.status).toBe(400);
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(await r.text()).toContain("isn&#39;t valid");
    });

  const aud = `https://${host}`;
  for (const state of ["a".repeat(15), `${"a".repeat(16)}.`, "a".repeat(129)])
    it(`refuses state of ${state.length} chars (${state.slice(-1)})`, async () => {
      const r = await start(aud, { state });
      expect(r.status).toBe(400);
    });

  const refusedQueries: [string, string][] = [
    [
      "redirect_uri present (even equal to the callback)",
      `${q({ aud, state: STATE })}&redirect_uri=${encodeURIComponent(aud + LINK_CALLBACK_PATH)}`,
    ],
    ["an unknown parameter", `${q({ aud, state: STATE })}&x=1`],
    ["an empty unknown parameter", `${q({ aud, state: STATE })}&x`],
    [
      "a repeated aud",
      `${q({ aud, state: STATE })}&aud=${encodeURIComponent(aud)}`,
    ],
    ["a repeated state", `${q({ aud, state: STATE })}&state=${STATE}`],
    ["a missing state", q({ aud })],
    ["a missing aud", q({ state: STATE })],
  ];
  for (const [what, path] of refusedQueries)
    it(`refuses ${what}`, async () => {
      const r = await call(path);
      expect(r.status).toBe(400);
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(await r.text()).toContain("isn&#39;t valid");
    });

  it("no card secrets: 503 page, no cookie", async () => {
    const r = await start(aud, {}, base);
    expect(r.status).toBe(503);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /link/confirm", () => {
  it("signed out: 302 to sign-in with next=/link/confirm", async () => {
    const r = await call(R.linkConfirm);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(
      `/auth/login?next=${encodeURIComponent(R.linkConfirm)}`,
    );
  });

  it("renders the confirm page; CSP form-action allows aud", async () => {
    const aud = newAud();
    const r = await confirmPage(await begin(aud));
    expect(r.status).toBe(200);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(
      `form-action 'self' ${aud} https://${DEV.ACCESS_TEAM_DOMAIN};`,
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    const html = await r.text();
    expect(html).toContain(`<bdi>${aud}</bdi>`);
    expect(html).toContain(
      `<form id="switch" method="post" action="${ORIGIN}/auth/logout?then=login&amp;next=${encodeURIComponent(R.linkConfirm)}"></form>`,
    );
    expect(html).toMatch(/name="csrf" value="[^"]+"/);
    expect(html).toContain(`action="${R.linkConfirm}"`);
  });

  it("CSP falls back to 'self' plus aud when ACCESS_TEAM_DOMAIN is not a hostname", async () => {
    const aud = newAud();
    const e = { ...DEV, ACCESS_TEAM_DOMAIN: "x; script-src *" };
    const r = await confirmPage(await begin(aud, e), e);
    expect(r.status).toBe(200);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`form-action 'self' ${aud};`);
    expect(csp).not.toContain("script-src");
  });

  it("missing, tampered or expired cookie: 400 expired", async () => {
    const good = await begin(newAud());
    const [body, sig] = good.split(".") as [string, string];
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    const expired = await sealLink(
      DEV,
      {
        aud: "https://oa.example",
        state: STATE,
      },
      Date.now() - LINK_COOKIE_TTL_S * 1000 - 1,
    );
    for (const v of [
      null,
      "",
      "x",
      `${flip(body)}.${sig}`,
      `${body}.${flip(sig)}`,
      expired,
    ]) {
      const r = await confirmPage(v);
      expect(r.status, String(v)).toBe(400);
      expect(await r.text()).toContain("expired");
    }
  });

  it("an expired cookie by clock (frozen time) is 400", async () => {
    const link = await begin(newAud());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + LINK_COOKIE_TTL_S * 1000 + 1000);
    const r = await confirmPage(link);
    expect(r.status).toBe(400);
  });
});

describe("POST /link/confirm", () => {
  it("without a form token: 403; cross-origin: 403; nothing linked", async () => {
    const aud = newAud();
    const link = await begin(aud);
    expect((await post(link, "allow", { csrf: null })).status).toBe(403);
    expect((await post(link, "allow", { csrf: "1.x" })).status).toBe(403);
    expect(
      (await post(link, "allow", { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(await linked()).not.toContain(aud);
  });

  it("a token minted for another link request is refused", async () => {
    const a = await begin(newAud());
    const b = await begin(newAud());
    const csrf = await linkCsrf(DEV, a, await session());
    expect((await post(b, "allow", { csrf })).status).toBe(403);
  });

  it("allow: links, 303 with a verifiable ob-link+jwt assertion in the fragment", async () => {
    const aud = newAud();
    const r = await post(await begin(aud), "allow");
    expect(r.status).toBe(303);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    clears(r);
    const loc = r.headers.get("location") ?? "";
    expect(loc).toBe(
      `${aud}${LINK_CALLBACK_PATH}#assertion=${fragment(r).get("assertion")}&state=${STATE}`,
    );
    const f = fragment(r);
    expect(f.get("state")).toBe(STATE);
    const jwks = (await (await call(R.jwks)).json()) as JSONWebKeySet;
    const { payload, protectedHeader } = await jwtVerify(
      f.get("assertion") as string,
      createLocalJWKSet(jwks),
      { typ: LINK_TYP, audience: aud, issuer: ORIGIN, algorithms: ["EdDSA"] },
    );
    expect(protectedHeader.kid).toBe(TEST_CARD_JWK.kid);
    expect(payload.state).toBe(STATE);
    expect(payload.owner).toBe(await ownerId(SALT, aud));
    expect((payload.exp as number) - (payload.iat as number)).toBe(
      CARD_TTL_SEC,
    );
    expect(payload.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await linked()).toContain(aud);
  });

  it("cancel: error=access_denied, nothing linked, cookie cleared", async () => {
    const aud = newAud();
    const r = await post(await begin(aud), "cancel");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(
      `${aud}${LINK_CALLBACK_PATH}#error=access_denied&state=${STATE}`,
    );
    clears(r);
    expect(await linked()).not.toContain(aud);
  });

  it("an expired cookie at POST: 400 expired, cleared, nothing linked", async () => {
    const aud = newAud();
    const link = await begin(aud);
    const csrf = await linkCsrf(DEV, link, await session());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + LINK_COOKIE_TTL_S * 1000 + 1000);
    const r = await post(link, "allow", { csrf });
    expect([400, 403]).toContain(r.status);
    vi.useRealTimers();
    expect(await linked()).not.toContain(aud);
  });

  it("an invalid decision: 400, cleared, nothing linked", async () => {
    const aud = newAud();
    const r = await post(await begin(aud), "maybe");
    expect(r.status).toBe(400);
    clears(r);
    expect(await linked()).not.toContain(aud);
  });

  it("no card secrets at POST: 503, nothing linked", async () => {
    const aud = newAud();
    const link = await begin(aud);
    const noKeys: Env = { ...DEV, CARD_SIGNING_KEY: undefined };
    const r = await post(link, "allow", { e: noKeys });
    expect(r.status).toBe(503);
    clears(r);
    expect(await linked()).not.toContain(aud);
  });

  it("never logs the assertion or the Location", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m),
    );
    const aud = newAud();
    const r = await post(await begin(aud), "allow");
    const jws = fragment(r).get("assertion") as string;
    const logged = spies
      .flatMap((s) => s.mock.calls.flat())
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join("\n");
    expect(logged).not.toContain("assertion=");
    expect(logged).not.toContain(jws.split(".")[2]);
    expect(logged).not.toContain(aud);
  });

  it("full linked_apps: 409 page, no assertion", async () => {
    const h = hub(DEV);
    const before = await linked();
    const fill: string[] = [];
    for (let n = before.length; n < MAX_LINKED_APPS; n++) {
      const a = `https://fill-${n}-${Date.now()}.example.com`;
      fill.push(a);
      expect(await h.linkApp(a)).toBe(true);
    }
    try {
      const aud = newAud();
      const r = await post(await begin(aud), "allow");
      expect(r.status).toBe(409);
      expect(r.headers.get("location")).toBeNull();
      expect(r.headers.get("content-type")).toMatch(/^text\/html/);
      clears(r);
      expect(await linked()).not.toContain(aud);
    } finally {
      for (const a of fill) await h.unlinkApp(a);
    }
  });
});
