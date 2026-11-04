# OpenBus Backend Implementation Plan (Track B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the OpenBus Worker and hub Durable Object: Access login, device approval and machine tokens, one hub per owner with roster, namespaces, mail and revoke, all inside Workers Free CPU.

**Architecture:** `apps/server` is a Hono Worker that owns `/healthz`, `/auth/*`, the device flow, `/approve/:user_code`, `/hub` (WebSocket upgrade), the dashboard's REST routes, its WebSocket feed (`/api/v1/events`, B10-ws ruling; was SSE) and the SPA fallback. Every route passes a fail-closed policy gate before its handler. All state lives in one `Hub` Durable Object per owner (SQLite + WebSocket Hibernation); the Worker reaches it only through the `HUB` binding. Auth (OIDC, session, HMAC keys, crypto) is copied from `~/code/projects/openartifacts/apps/server` and reduced to one owner.

**Tech stack:** TypeScript 5.x strict, Hono, Zod 4, Cloudflare Workers + Durable Objects (SQLite, Hibernation), `@cloudflare/vitest-plugin`, pnpm 10, Biome. No D1/KV/R2/Queues, no Agents SDK.

**Depends on:** F1 (scaffold, CI, staging) and F2 (`@ob/shared`). Read `00-overview.md` §Contracts and `docs/superpowers/specs/2026-10-21-openbus-design.md` together with this file.

**Worktree:** `~/code/projects/openbus-be`, created after F1 lands; branch per task `be/<task>-<slug>`.

**Reference copies:** `~/code/projects/openartifacts/apps/server/src/{auth,http,util}`.

---

## File structure

```
apps/server/
  wrangler.jsonc              # name, DO binding + migration, assets, ratelimits, vars
  wrangler.test.jsonc         # same bindings, zero ids, test vars
  vitest.config.ts            # @cloudflare/vitest-plugin (hand to Platform if F3 owns it)
  src/
    index.ts                  # entry: content routing, Hub export, scheduled none
    app.ts                    # Hono app, policy gate, middleware, SPA fallback
    env.ts                    # Env
    version.ts                # healthz version (env.VERSION ?? "dev")
    auth/
      oidc.ts                 # copied from OA, cookie prefix ob_
      session.ts              # owner-only stateless session
      keys.ts                 # HKDF labels ob:*
      route-policy.ts         # fail-closed route table + gate
      approve-csrf.ts         # signed approve form token
    http/
      errors.ts               # ApiError, errorJson, toErrorResponse
      body.ts                 # capped JSON reader
      middleware.ts           # security headers, session resolve, csrf, sameOrigin
    routes/
      index.ts                # mountRoutes
      auth.ts                 # /auth/login, /auth/callback, /auth/logout, dev login
      device.ts               # POST /device/code, POST /device/token
      approve.ts              # GET/POST /approve/:user_code
      approve-page.ts         # HTML (Design owns the look)
      machines.ts             # GET /api/v1/machines, DELETE /api/v1/machines/:id
      agents.ts               # GET /api/v1/agents
      events.ts               # GET /api/v1/events (WebSocket upgrade forwarded to the hub's /events; B10-ws)
      me.ts                   # GET /api/v1/me
    hub/
      do.ts                   # Hub DurableObject: sockets, roster, mail, alarm
      schema.ts               # HUB_SCHEMA SQL
      rows.ts                 # row types + small SQL helpers
      stub.ts                 # hub(env) typed stub, idFromName(OWNER_ORG_ID)
      dto.ts                  # AgentSummary/Machine/Me builders
    util/
      crypto.ts               # copied: hmacSign/Verify, b64url, sha256Hex
      text.ts                 # copied: utf8 encoders
      log.ts                  # structured JSON logs
  test/
    helpers.ts                # daemon sockets, session cookie, frames
    auth.test.ts
    app.test.ts
    device.test.ts
    hub.socket.test.ts        # hello/agent_up/sessions/roster
    hub.from_ref.test.ts      # Review Focus 1
    hub.reconnect.test.ts     # Review Focus 3
    hub.namespace.matrix.test.ts # Review Focus 2
    revoke.test.ts            # Review Focus 4
    events.test.ts
    size.test.ts              # approve page < 8 KB
```

---

### Task B1: Copy auth — session, OIDC, keys, crypto

**Files:**
- Create: `apps/server/src/util/crypto.ts`, `apps/server/src/util/text.ts`, `apps/server/src/auth/keys.ts`, `apps/server/src/auth/session.ts`, `apps/server/src/auth/oidc.ts`, `apps/server/src/env.ts`
- Test: `apps/server/test/auth.test.ts`

- [ ] **Step 1: Copy the OA files that need no change**

```bash
mkdir -p apps/server/src/{auth,http,routes,hub,util} apps/server/test
cp ~/code/projects/openartifacts/apps/server/src/util/crypto.ts apps/server/src/util/crypto.ts
cp ~/code/projects/openartifacts/apps/server/src/util/text.ts   apps/server/src/util/text.ts
cp ~/code/projects/openartifacts/apps/server/src/auth/oidc.ts   apps/server/src/auth/oidc.ts
cp ~/code/projects/openartifacts/apps/server/src/auth/keys.ts   apps/server/src/auth/keys.ts
```

- [ ] **Step 2: Adapt the two copied files**

`apps/server/src/auth/oidc.ts`: change only `const OIDC_BASE = "oa_oidc_";` to `const OIDC_BASE = "ob_oidc_";` (both the `__Host-` and dev regexes derive from it), and keep every other line. Import `AUTH` from `@ob/shared` instead of `@oa/shared`.

`apps/server/src/auth/keys.ts`: replace `KEY_LABELS` with:

```ts
export const KEY_LABELS = ["ob:session", "ob:oidc-state", "ob:approve"] as const;
```

and `const HKDF_SALT = "open-bus/hkdf/v1";`.

- [ ] **Step 3: Write `env.ts`**

```ts
export interface Env {
  HUB: DurableObjectNamespace<import("./hub/do.js").Hub>;
  ASSETS?: Fetcher;
  /** Anonymous device-flow limiter (per IP). Unbound in tests and local dev. */
  RL_DEVICE?: RateLimit;
  // vars
  /** Public host with no scheme, e.g. `open-bus.acct.workers.dev`; F4 sets it at deploy. */
  APP_HOST: string;
  OWNER_EMAIL: string;
  ENVIRONMENT: "dev" | "production";
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_CLIENT_ID: string;
  /** Set by deploy (F4); /healthz reports it, unset in dev and tests. */
  VERSION?: string;
  // secrets
  ACCESS_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}
```

- [ ] **Step 4: Write the failing session test**

`apps/server/test/auth.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildAuthorizeRedirect, safeNext } from "../src/auth/oidc.js";
import {
  OWNER_UID,
  readSession,
  sessionCookieName,
  signSession,
} from "../src/auth/session.js";

const e = env as unknown as import("../src/env.js").Env;

describe("session", () => {
  it("round-trips the owner session", async () => {
    const c = await signSession(e);
    const s = await readSession(e, c);
    expect(s?.uid).toBe(OWNER_UID);
    expect(s!.exp).toBeGreaterThan(Date.now());
  });
  it("rejects tampering, truncation and expiry", async () => {
    const c = await signSession(e);
    expect(await readSession(e, c.slice(0, -2) + "AA")).toBeNull();
    expect(await readSession(e, c.split(".")[0])).toBeNull();
    expect(await readSession(e, undefined)).toBeNull();
    expect(await readSession(e, await signSession(e, OWNER_UID, Date.now() - 8 * 86400_000))).toBeNull();
  });
  it("uses the __Host- name outside dev", () => {
    expect(sessionCookieName({ ENVIRONMENT: "production" })).toBe("__Host-ob_session");
    expect(sessionCookieName({ ENVIRONMENT: "dev" })).toBe("ob_session");
  });
});

describe("oidc", () => {
  it("builds a PKCE authorize redirect with a per-attempt state cookie", async () => {
    const r = await buildAuthorizeRedirect(e, "/machines", { cookieHeader: null });
    const u = new URL(r.location);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("nonce")).toBeTruthy();
    expect(r.stateCookie).toMatch(/ob_oidc_[A-Za-z0-9_-]{10}=/);
  });
  it("keeps next same-origin only", () => {
    const base = "https://bus.example.com";
    expect(safeNext({ ...e, ENVIRONMENT: "dev" } as never, "/machines")).toBe("/machines");
    expect(safeNext({ ...e, ENVIRONMENT: "dev" } as never, "//evil.com")).toBe("/");
    expect(safeNext({ ...e, ENVIRONMENT: "dev" } as never, "https://evil.com/x")).toBe("/");
  });
});
```

- [ ] **Step 5: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/auth.test.ts`
Expected: FAIL — `../src/auth/session.js` has no `OWNER_UID`.

- [ ] **Step 6: Write `session.ts`**

```ts
import type { Env } from "../env.js";
import { b64urlDecode, b64urlEncode, hmacSign, hmacVerify } from "../util/crypto.js";
import { utf8Decoder, utf8Encoder } from "../util/text.js";

/** OpenBus is single-owner: the session names the owner, never a user row. */
export const OWNER_UID = "owner";
const UID_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_AGE_S = 7 * 86400;
const MAX_COOKIE_LEN = 1024;

export type Session = { uid: string; exp: number };

export async function signSession(
  env: Env,
  uid: string = OWNER_UID,
  now = Date.now(),
): Promise<string> {
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32)
    throw new Error("SESSION_SECRET must be at least 32 characters");
  if (!UID_RE.test(uid)) throw new Error("invalid uid");
  const payload: Session = { uid, exp: now + MAX_AGE_S * 1000 };
  const p = b64urlEncode(utf8Encoder.encode(JSON.stringify(payload)));
  return `${p}.${await hmacSign(env.SESSION_SECRET, p)}`;
}

export async function readSession(
  env: Env,
  cookieValue: string | undefined,
  now = Date.now(),
): Promise<Session | null> {
  if (!cookieValue || cookieValue.length > MAX_COOKIE_LEN) return null;
  try {
    const parts = cookieValue.split(".");
    if (parts.length !== 2) return null;
    const [p, sig] = parts as [string, string];
    if (!(await hmacVerify(env.SESSION_SECRET, p, sig))) return null;
    const raw = b64urlDecode(p);
    if (!raw) return null;
    const s = JSON.parse(utf8Decoder.decode(raw)) as Partial<Session> | null;
    if (!s || typeof s.uid !== "string" || !UID_RE.test(s.uid)) return null;
    if (typeof s.exp !== "number" || !Number.isFinite(s.exp) || s.exp <= now) return null;
    return { uid: s.uid, exp: s.exp };
  } catch {
    return null;
  }
}

/**
 * `__Host-` outside dev so no sibling or parent-domain host can plant a
 * session (cookie tossing / fixation). Every read, write and clear goes here.
 */
export function sessionCookieName(env: Pick<Env, "ENVIRONMENT">): string {
  return env.ENVIRONMENT === "dev" ? "ob_session" : "__Host-ob_session";
}

const attrs = (env: Pick<Env, "ENVIRONMENT">) =>
  env.ENVIRONMENT === "dev"
    ? "HttpOnly; SameSite=Lax; Path=/"
    : "HttpOnly; Secure; SameSite=Lax; Path=/";

export function sessionCookie(value: string, env: Pick<Env, "ENVIRONMENT">): string {
  return `${sessionCookieName(env)}=${value}; ${attrs(env)}; Max-Age=${MAX_AGE_S}`;
}

export function clearSessionCookie(env: Pick<Env, "ENVIRONMENT">): string {
  return `${sessionCookieName(env)}=; ${attrs(env)}; Max-Age=0`;
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @ob/server test -- test/auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): port Access OIDC, owner session and HMAC keys from open-artifacts"
```

---

### Task B1b: Sign-in routes — login, callback, logout, dev-login

**Files:**
- Create: `apps/server/src/routes/auth.ts`
- Test: `apps/server/test/signin.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/signin.test.ts`:

```ts
import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readSession, sessionCookieName } from "../src/auth/session.js";

const e = env as unknown as import("../src/env.js").Env;
const cookieOf = (res: Response): string =>
  (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

describe("sign-in", () => {
  it("/auth/login redirects to Access with PKCE and sets a state cookie", async () => {
    const r = await SELF.fetch("https://app.localhost/auth/login?next=/machines", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain("code_challenge_method=S256");
    const set = r.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/ob_oidc_[A-Za-z0-9_-]{10}=/);
    expect(set).toContain("HttpOnly");
  });

  it("/auth/login never sends next off-site", async () => {
    const r = await SELF.fetch("https://app.localhost/auth/login?next=https://evil.test", { redirect: "manual" });
    expect(r.headers.get("location") ?? "").not.toContain("evil.test");
  });

  it("/auth/callback without a state cookie redirects to retry once", async () => {
    const r = await SELF.fetch("https://app.localhost/auth/callback?state=abc&code=x", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`/auth/login?next=${encodeURIComponent("/")}&retry=1`);
  });

  it("/auth/dev-login signs the owner in only in dev", async () => {
    const r = await SELF.fetch("https://app.localhost/auth/dev-login?next=/machines", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/machines");
    const c = cookieOf(r);
    expect(c.startsWith(`${sessionCookieName(e)}=`)).toBe(true);
    expect((await readSession(e, c.slice(c.indexOf("=") + 1)))?.uid).toBe("owner");
  });

  it("/auth/logout clears the session", async () => {
    const login = await SELF.fetch("https://app.localhost/auth/dev-login", { redirect: "manual" });
    const c = cookieOf(login);
    const r = await SELF.fetch("https://app.localhost/auth/logout", {
      method: "POST",
      redirect: "manual",
      headers: { cookie: c, "X-OB-Request": "1" },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/signin.test.ts`
Expected: FAIL — 404 on `/auth/login`.

- [ ] **Step 3: Write `routes/auth.ts`**

```ts
import { AUTH } from "@ob/shared";
import {
  buildAuthorizeRedirect,
  clearOidcCookie,
  handleCallback,
  OidcStateError,
  pickStateCookie,
  safeNext,
} from "../auth/oidc.js";
import { clearSessionCookie, sessionCookie, signSession } from "../auth/session.js";
import { ApiError } from "../http/errors.js";
import type { AppType } from "./types.js";

const redirect = (location: string, cookies: string[] = []) => {
  const h = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
};

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OpenBus</title></head><body>${body}</body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });

const sameOwner = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function mountAuth(app: AppType): void {
  app.get(AUTH.login, async (c) => {
    const { location, stateCookie, evict } = await buildAuthorizeRedirect(
      c.env,
      c.req.query("next") ?? "/",
      { retry: c.req.query("retry") === "1", cookieHeader: c.req.header("cookie") },
    );
    return redirect(location, [...evict, stateCookie]);
  });

  app.get(AUTH.callback, async (c) => {
    // This attempt's state cookie is single-use: cleared on success and on every failure.
    const picked = await pickStateCookie(c.env, c.req.raw, c.req.query("state") ?? "");
    const clear = picked ? [clearOidcCookie(c.env, picked.name)] : [];
    try {
      const { email, next } = await handleCallback(c.env, c.req.raw);
      if (!sameOwner(email, c.env.OWNER_EMAIL)) return redirect("/auth/no-access", clear);
      return redirect(next, [...clear, sessionCookie(await signSession(c.env), c.env)]);
    } catch (e) {
      if (!(e instanceof OidcStateError)) throw e;
      if (e.retry) return html("<h1>Sign-in interrupted</h1><p>Try again.</p>", 400);
      return redirect(`${AUTH.login}?next=${encodeURIComponent(e.next)}&retry=1`, clear);
    }
  });

  app.get("/auth/no-access", () =>
    html("<h1>Not your bus</h1><p>This instance belongs to another owner.</p>", 403),
  );

  app.post(AUTH.logout, () =>
    new Response(null, {
      status: 204,
      headers: { "set-cookie": clearSessionCookie({ ENVIRONMENT: "production" }), "cache-control": "no-store" },
    }),
  );

  app.get(AUTH.devLogin, async (c) => {
    if (c.env.ENVIRONMENT !== "dev") throw new ApiError("not_found", "Not found");
    return redirect(safeNext(c.env, c.req.query("next")), [
      sessionCookie(await signSession(c.env), c.env),
    ]);
  });
}
```

One correction to the logout above: it must clear the cookie with the *same* name the browser holds, so pass the real env: `clearSessionCookie(c.env)` and take `c` as the handler argument. Write it as:

```ts
  app.post(AUTH.logout, (c) =>
    new Response(null, {
      status: 204,
      headers: { "set-cookie": clearSessionCookie(c.env), "cache-control": "no-store" },
    }),
  );
```

- [ ] **Step 4: Mount it**

`routes/index.ts` becomes:

```ts
import type { AppType } from "./types.js";
import { mountAuth } from "./auth.js";

export function mountRoutes(app: AppType): void {
  mountAuth(app);
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ob/server test -- test/signin.test.ts`
Expected: PASS (5 tests). `ENVIRONMENT` is fixed to `dev` by the test config; the production branch of dev-login is one line and is covered by review.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): sign-in routes with Access OIDC and dev login"
```

---

### Task B2: App shell, fail-closed policy gate, `/healthz`

**Files:**
- Create: `apps/server/src/http/errors.ts`, `http/middleware.ts`, `http/body.ts`, `auth/route-policy.ts`, `routes/index.ts`, `version.ts`
- Create: `apps/server/src/app.ts`, `index.ts`, `wrangler.jsonc`, `wrangler.test.jsonc`, `vitest.config.ts`
- Test: `apps/server/test/app.test.ts`

- [ ] **Step 1: Copy the HTTP helpers**

```bash
cp ~/code/projects/openartifacts/apps/server/src/http/errors.ts  apps/server/src/http/errors.ts
cp ~/code/projects/openartifacts/apps/server/src/http/body.ts    apps/server/src/http/body.ts
```

In `http/errors.ts` keep `ApiError`, `errorJson`, `toErrorResponse`, `appOrigin`; delete every reference to D1, plans and `@oa/shared` codes (map to `@ob/shared`'s `ERROR_CODES`, `STATUS_FOR`).

- [ ] **Step 2: Write the failing app test**

`apps/server/test/app.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const get = (p: string, init?: RequestInit) => SELF.fetch(`https://app.localhost${p}`, init);

describe("app shell", () => {
  it("serves /healthz with a version", async () => {
    const r = await get("/healthz");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: "dev" });
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("404s an unlisted route before any handler runs", async () => {
    expect((await get("/api/v1/nope")).status).toBe(404);
    expect((await get("/approve/AAAA-AAAA", { method: "PUT" })).status).toBe(404);
  });
  it("401s a session route without a cookie", async () => {
    const r = await get("/api/v1/me");
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe("unauthorized");
  });
  it("requires X-OB-Request on cookie mutations", async () => {
    const { cookie } = await loginForTest();
    const r = await get("/api/v1/machines/x", { method: "DELETE", headers: { cookie } });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("csrf");
  });
  it("allows the same call with the header", async () => {
    const { cookie } = await loginForTest();
    const r = await get("/api/v1/machines/x", {
      method: "DELETE",
      headers: { cookie, "X-OB-Request": "1" },
    });
    expect(r.status).toBe(404);
  });
});

async function loginForTest() {
  const { signSession, sessionCookie, sessionCookieName } = await import("../src/auth/session.js");
  const { env } = await import("cloudflare:workers");
  const e = env as unknown as import("../src/env.js").Env;
  return { cookie: `${sessionCookieName(e)}=${await signSession(e)}` };
}
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/app.test.ts`
Expected: FAIL — no `src/app.ts`.

- [ ] **Step 4: Write the policy gate**

`apps/server/src/auth/route-policy.ts`:

```ts
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { ApiError } from "../http/errors.js";
import type { AppEnv } from "../http/middleware.js";
import { readSession, sessionCookieName } from "./session.js";

/**
 * Every route's access rule. An unmatched `${method} ${routePath}` and no
 * `ALL ${routePath}` entry answers 404 before any handler runs, so a new
 * route cannot ship unguarded. `machine` routes verify the bearer token in
 * their handler (the gate only proves the table lists them).
 */
export type Policy = { public: string } | { session: string } | { machine: string };

export const ROUTE_POLICY: Readonly<Record<string, Policy>> = {
  "GET /healthz": { public: "health probe" },
  "ALL /healthz": { public: "405" },
  "GET /robots.txt": { public: "robots" },
  "GET /auth/login": { public: "sign-in start" },
  "GET /auth/callback": { public: "sign-in callback" },
  "GET /auth/no-access": { public: "not the owner" },
  "GET /auth/dev-login": { public: "dev only; handler 404s outside dev" },
  "POST /auth/logout": { session: "sign out" },
  "POST /device/code": { public: "device flow start" },
  "POST /device/token": { public: "device flow poll" },
  "GET /approve/:user_code": { session: "approval page" },
  "POST /approve/:user_code": { session: "approval decision" },
  "GET /api/v1/me": { session: "owner identity" },
  "GET /api/v1/machines": { session: "machines" },
  "DELETE /api/v1/machines/:id": { session: "revoke a machine" },
  "GET /api/v1/agents": { session: "roster" },
  "GET /api/v1/events": { session: "live feed" },
  "GET /hub": { machine: "daemon socket" },
};

/** The matched route pattern Hono registered, e.g. "/api/v1/machines/:id". */
const routeKey = (c: Context<AppEnv>): string => `${c.req.method} ${c.req.routePath}`;

export const enforcePolicy =
  (table: Readonly<Record<string, Policy>> = ROUTE_POLICY): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const rule = table[routeKey(c)] ?? table[`ALL ${c.req.routePath}`];
    if (!rule) throw new ApiError("not_found", "Not found");
    if ("public" in rule) return next();
    if ("machine" in rule) return next();
    const session = await readSession(c.env, getCookie(c, sessionCookieName(c.env)));
    if (!session) throw new ApiError("unauthorized", "Sign in to continue");
    c.set("session", session);
    return next();
  };
```

- [ ] **Step 5: Write `http/middleware.ts`**

```ts
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { CSRF_HEADER } from "@ob/shared";
import type { Env } from "../env.js";
import { ApiError, appOrigin, toErrorResponse } from "./errors.js";
import { readSession, sessionCookieName } from "../auth/session.js";

export type Session = { uid: string; exp: number };
export type AppVariables = { session: Session | null };
export type AppEnv = { Bindings: Env; Variables: AppVariables };

export function withSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res;
  const set = (h: Headers) => {
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
    h.set("X-Frame-Options", "DENY");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("X-Robots-Tag", "noindex, nofollow");
  };
  try {
    set(res.headers);
    return res;
  } catch {
    const out = new Response(res.body, res);
    set(out.headers);
    return out;
  }
}

export const securityHeaders = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await next();
  c.res = withSecurityHeaders(c.res);
};

/** Idempotent: the gate may already have read the session. */
export async function resolveSession(c: Context<AppEnv>): Promise<Session | null> {
  const known = c.get("session");
  if (known !== undefined) return known;
  const s = await readSession(c.env, getCookie(c, sessionCookieName(c.env)));
  c.set("session", s);
  return s;
}

export const session = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await resolveSession(c);
  await next();
};

/**
 * Session-cookie mutations need `X-OB-Request: 1`. There are no bearer PATs on
 * the app host (machine tokens only open /hub), so every non-GET page route is
 * cookie-authenticated and must opt in.
 */
export const csrf = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD") {
    const hasCookie = getCookie(c, sessionCookieName(c.env)) !== undefined;
    if (hasCookie && c.req.header(CSRF_HEADER) !== "1")
      return toErrorResponse(new ApiError("csrf", `Missing ${CSRF_HEADER}: 1 header`));
  }
  await next();
};

/** POST /auth/logout and the approve form: refuse other sites outright. */
export const sameOrigin = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const site = c.req.header("sec-fetch-site");
  const origin = c.req.header("origin");
  if (site === "cross-site" || (origin !== undefined && origin !== appOrigin(c.env)))
    return toErrorResponse(new ApiError("csrf", "Cross-site request"));
  await next();
};
```

- [ ] **Step 6: Write `app.ts`, `index.ts`, version and routes stub**

`apps/server/src/version.ts`:

```ts
import type { Env } from "./env.js";
export const version = (env: Pick<Env, "VERSION">): string => env.VERSION?.trim() || "dev";
```

`apps/server/src/app.ts`:

```ts
import { Hono } from "hono";
import { enforcePolicy } from "./auth/route-policy.js";
import { ApiError, toErrorResponse } from "./http/errors.js";
import {
  type AppEnv,
  csrf,
  sameOrigin,
  securityHeaders,
  session,
} from "./http/middleware.js";
import { mountRoutes } from "./routes/index.js";
import { version } from "./version.js";

export function createApp(mount = mountRoutes) {
  const app = new Hono<AppEnv>();
  app.use("*", securityHeaders());
  // Fail closed: an unlisted route is 404 before any other middleware runs.
  app.use("*", enforcePolicy());
  app.onError((e) => toErrorResponse(e));
  app.notFound(() => toErrorResponse(new ApiError("not_found", "Not found")));

  app.get("/healthz", (c) => c.json({ version: version(c.env) }));
  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

  app.use("/api/v1/*", session(), csrf());
  app.use("/approve/*", session(), sameOrigin(), csrf());
  app.use("/auth/logout", session(), sameOrigin(), csrf());

  mount(app);

  // SPA fallback: only for GET/HEAD off the Worker's own prefixes.
  app.on(["GET", "HEAD"], "*", async (c) => {
    const p = new URL(c.req.url).pathname;
    if (/^\/(api|auth|approve|device|hub)(\/|$)/.test(p) || !c.env.ASSETS)
      return toErrorResponse(new ApiError("not_found", "Not found"));
    return c.env.ASSETS.fetch(c.req.raw);
  });
  return app;
}

export const app = createApp();
```

`apps/server/src/routes/index.ts` (already has auth from B1b; device, approve, machines, agents, events and me mount here in later tasks):

```ts
import type { AppType } from "./types.js";
import { mountAuth } from "./auth.js";

export function mountRoutes(app: AppType): void {
  mountAuth(app);
}
```

`apps/server/src/routes/types.ts`:

```ts
import type { Hono } from "hono";
import type { AppEnv } from "../http/middleware.js";
export type AppType = Hono<AppEnv>;
```

`apps/server/src/index.ts`:

```ts
import { app } from "./app.js";
import type { Env } from "./env.js";

export type { Env } from "./env.js";
export { Hub } from "./hub/do.js";

const normHost = (h: string) => h.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // workers.dev and custom-domain hosts both serve the app; only the exact
    // configured host list is honoured in production once F4 sets it.
    void normHost(url.hostname);
    return app.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

Create an empty `apps/server/src/hub/do.ts` exporting `class Hub {}` for now; B3 replaces it.

- [ ] **Step 7: Write the Cloudflare test config**

`apps/server/wrangler.test.jsonc`:

```jsonc
{
  "name": "ob-server-test",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": { "bindings": [{ "name": "HUB", "class_name": "Hub" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Hub"] }],
  "vars": {
    "ENVIRONMENT": "dev",
    "APP_HOST": "app.localhost",
    "OWNER_EMAIL": "owner@example.com",
    "ACCESS_TEAM_DOMAIN": "test.cloudflareaccess.com",
    "ACCESS_CLIENT_ID": "test-client-id",
    "ACCESS_CLIENT_SECRET": "test-client-secret",
    "SESSION_SECRET": "test-session-secret-0123456789abcdef"
  }
}
```

`apps/server/vitest.config.ts` (hand this file to Platform if F3 already created one):

```ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @ob/server test -- test/app.test.ts`
Expected: PASS (5 tests). `/api/v1/me` is listed in the policy table and returns 401 from the gate; its handler lands in B10.

- [ ] **Step 9: Commit**

```bash
git add apps/server
git commit -m "feat(server): Hono shell, fail-closed route gate and /healthz"
```

---

### Task B3: Hub Durable Object — schema, stub, machines

**Files:**
- Create: `apps/server/src/hub/schema.ts`, `hub/rows.ts`, `hub/stub.ts`
- Replace: `apps/server/src/hub/do.ts`
- Test: `apps/server/test/hub.machines.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hub } from "../src/hub/stub.js";

const e = env as unknown as import("../src/env.js").Env;

describe("hub machines", () => {
  it("creates a machine, returns a token once and verifies its hash", async () => {
    const h = hub(e);
    const m = await h.createMachine("MacBook");
    expect(m.token).toMatch(/^ob_machine_[1-9A-HJ-NP-Za-km-z]{32}$/);
    expect(m.id).toHaveLength(16);
    const { sha256Hex } = await import("../src/util/crypto.js");
    expect(await h.verifyToken(await sha256Hex(m.token))).toEqual({ id: m.id, label: "MacBook" });
    expect(await h.verifyToken(await sha256Hex("ob_machine_" + "a".repeat(32)))).toBeNull();
  });
  it("lists machines with liveness and never the hash", async () => {
    const h = hub(e);
    const m = await h.createMachine("Studio");
    const rows = await h.listMachines();
    const row = rows.find((r) => r.id === m.id);
    expect(row).toMatchObject({ label: "Studio", revokedAt: null, lastUsedAt: null });
    expect(JSON.stringify(rows)).not.toContain("tokenHash");
  });
  it("stamps org_id on every row", async () => {
    const h = hub(e);
    await h.createMachine("Org");
    const rows = await h.listMachines();
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/hub.machines.test.ts`
Expected: FAIL — `hub` is not exported / `createMachine` missing.

- [ ] **Step 3: Write the schema**

`apps/server/src/hub/schema.ts`:

```ts
/**
 * The hub's whole database. Every row carries org_id (OWNER_ORG_ID today, an
 * org id later). Migrations add columns only: `create ... if not exists` is
 * safe to run on every wake.
 *
 * receipts is the durable spine of a message: one row per send, written before
 * any delivery attempt, so an eviction can never make a receipt lie. The body
 * lives in `mail` only when the hub had to store it (miss, oversized, or ack
 * timeout).
 */
export const HUB_SCHEMA = `
create table if not exists machines (
  id text primary key,
  org_id text not null,
  label text not null,
  token_hash text not null unique,
  created_at integer not null,
  last_used integer,
  revoked_at integer
);
create index if not exists machines_org on machines(org_id);

create table if not exists agents (
  id text primary key,
  org_id text not null,
  namespace text not null,
  name text not null,
  last_name text,
  kind text not null,
  machine_id text not null,
  native_ref text not null,
  global integer not null default 0,
  live integer not null default 0,
  updated_at integer not null,
  unique(machine_id, native_ref)
);
create unique index if not exists agents_live_name
  on agents(org_id, namespace, name) where live = 1;
create unique index if not exists agents_global_name
  on agents(org_id, name) where live = 1 and global = 1;
create index if not exists agents_ns on agents(org_id, namespace, live);
create index if not exists agents_machine on agents(machine_id, live);

create table if not exists receipts (
  id text primary key,
  org_id text not null,
  namespace text not null,
  to_agent text,
  to_name text not null,
  from_agent text not null,
  from_name text not null,
  state text not null,
  reason text,
  size integer not null,
  created_at integer not null,
  expires_at integer not null,
  acked_at integer
);
create index if not exists receipts_to on receipts(to_agent, state);
create index if not exists receipts_due on receipts(state, expires_at);

create table if not exists mail (
  id text primary key,
  org_id text not null,
  body text not null,
  created_at integer not null,
  expires_at integer not null
);
create index if not exists mail_due on mail(expires_at);

create table if not exists device_codes (
  user_code text primary key,
  org_id text not null,
  code_hash text not null unique,
  label text not null,
  created_at integer not null,
  expires_at integer not null,
  approved_at integer,
  denied_at integer,
  machine_id text,
  consumed_at integer
);
create index if not exists device_codes_due on device_codes(expires_at);
`;
```

- [ ] **Step 4: Write row types and SQL helpers**

`apps/server/src/hub/rows.ts`:

```ts
export type MachineRow = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type AgentRow = {
  id: string;
  namespace: string;
  name: string;
  lastName: string | null;
  kind: string;
  machineId: string;
  nativeRef: string;
  global: number;
  live: number;
  updatedAt: number;
};

export type ReceiptRow = {
  id: string;
  namespace: string;
  toAgent: string | null;
  toName: string;
  fromAgent: string;
  fromName: string;
  state: string;
  reason: string | null;
  size: number;
  createdAt: number;
  expiresAt: number;
};

export type DeviceCodeRow = {
  userCode: string;
  codeHash: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
  deniedAt: number | null;
  machineId: string | null;
  consumedAt: number | null;
};

export const MACHINE_COLS =
  "id, label, created_at as createdAt, last_used as lastUsedAt, revoked_at as revokedAt";
export const AGENT_COLS =
  "id, namespace, name, last_name as lastName, kind, machine_id as machineId, native_ref as nativeRef, global, live, updated_at as updatedAt";
export const RECEIPT_COLS =
  "id, namespace, to_agent as toAgent, to_name as toName, from_agent as fromAgent, from_name as fromName, state, reason, size, created_at as createdAt, expires_at as expiresAt";
```

- [ ] **Step 5: Write the hub class (machines only)**

`apps/server/src/hub/do.ts`:

```ts
import { DurableObject } from "cloudflare:workers";
import { LIMITS, newId, newMachineToken, OWNER_ORG_ID } from "@ob/shared";
import type { Env } from "../env.js";
import { MACHINE_COLS, type MachineRow } from "./rows.js";
import { HUB_SCHEMA } from "./schema.js";

export class Hub extends DurableObject<Env> {
  private ready = false;
  /** Tests only: a frozen clock so expiry can be exercised without waiting. */
  private clock: number | null = null;

  private init(): void {
    if (this.ready) return;
    this.ctx.storage.sql.exec(HUB_SCHEMA);
    this.ready = true;
  }

  protected now(): number {
    return this.clock ?? Date.now();
  }

  /** Tests only. */
  async setClock(ms: number | null): Promise<void> {
    this.clock = ms;
  }

  private all<T>(sql: string, ...b: unknown[]): T[] {
    this.init();
    return this.ctx.storage.sql.exec(sql, ...b).toArray() as T[];
  }

  private one<T>(sql: string, ...b: unknown[]): T | null {
    return this.all<T>(sql, ...b)[0] ?? null;
  }

  // ---------------------------------------------------------------- machines

  /** Called by the device flow once a user code is approved. Returns the token once. */
  async createMachine(label: string, id: string = newId()): Promise<{ id: string; label: string; token: string }> {
    this.init();
    const token = newMachineToken();
    const { sha256Hex } = await import("../util/crypto.js");
    this.ctx.storage.sql.exec(
      "insert into machines (id, org_id, label, token_hash, created_at) values (?, ?, ?, ?, ?)",
      id,
      OWNER_ORG_ID,
      label.slice(0, LIMITS.maxLabelChars),
      await sha256Hex(token),
      this.now(),
    );
    return { id, label, token };
  }

  /** One lookup per WebSocket upgrade; last_used is throttled to once an hour. */
  async verifyToken(tokenHash: string): Promise<{ id: string; label: string } | null> {
    const row = this.one<{ id: string; label: string; revokedAt: number | null; lastUsedAt: number | null }>(
      `select id, label, revoked_at as revokedAt, last_used as lastUsedAt from machines where token_hash = ? limit 1`,
      tokenHash,
    );
    if (!row || row.revokedAt !== null) return null;
    const now = this.now();
    if (row.lastUsedAt === null || row.lastUsedAt < now - 3_600_000)
      this.ctx.storage.sql.exec("update machines set last_used = ? where id = ?", now, row.id);
    return { id: row.id, label: row.label };
  }

  // NOTE: superseded by the B3 implementation (apps/server hub): lists revoked machines too (revokedAt set), active first, cap 100.
  async listMachines(): Promise<MachineRow[]> {
    return this.all<MachineRow>(
      `select ${MACHINE_COLS} from machines where org_id = ? and revoked_at is null order by created_at desc limit 100`,
      OWNER_ORG_ID,
    );
  }

  private machine(id: string): MachineRow | null {
    return this.one<MachineRow>(
      `select ${MACHINE_COLS} from machines where id = ? and org_id = ? and revoked_at is null`,
      id,
      OWNER_ORG_ID,
    );
  }
}

/**
 * The Worker and tests see the whole public RPC surface. Every `async` method
 * on `Hub` is callable; private helpers stay private and are not reachable
 * across the boundary.
 */
export type HubStub = Hub;
```

- [ ] **Step 6: Write the stub helper**

`apps/server/src/hub/stub.ts`:

```ts
import { OWNER_ORG_ID } from "@ob/shared";
import type { Env } from "../env.js";
import type { Hub, HubStub } from "./do.js";

/** One hub per owner. A future D1 directory replaces this constant lookup. */
export function hub(env: Pick<Env, "HUB">): HubStub {
  const ns = env.HUB;
  return ns.get(ns.idFromName(OWNER_ORG_ID)) as unknown as HubStub;
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @ob/server test -- test/hub.machines.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(hub): SQLite schema, machine rows and token verification"
```

---

### Task B4: Device flow and the approval page

**Files:**
- Create: `apps/server/src/routes/device.ts`, `routes/approve.ts`, `routes/approve-page.ts`, `auth/approve-csrf.ts`
- Modify: `routes/index.ts`, `hub/do.ts`, `hub/stub.ts`, `app.test.ts` (dev-login helper)
- Test: `apps/server/test/device.test.ts`, `apps/server/test/size.test.ts`

- [ ] **Step 1: Write the failing device test**

`apps/server/test/device.test.ts`:

```ts
import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sessionCookie, sessionCookieName, signSession } from "../src/auth/session.js";

const e = env as unknown as import("../src/env.js").Env;
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`https://app.localhost${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const cookie = async () => `${sessionCookieName(e)}=${await signSession(e)}`;

describe("device flow", () => {
  it("runs code -> approve -> token, once", async () => {
    const r = await post("/device/code", { machine_label: "MacBook" });
    expect(r.status).toBe(201);
    const code = await r.json();
    expect(code.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code.expires_in).toBe(600);
    expect(code.interval).toBe(5);

    expect(await (await post("/device/token", { device_code: code.device_code })).json())
      .toEqual({ status: "pending" });

    const c = await cookie();
    const page = await SELF.fetch(`https://app.localhost/approve/${code.user_code}`, { headers: { cookie: c } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("MacBook");

    const approve = await SELF.fetch(`https://app.localhost/approve/${code.user_code}`, {
      method: "POST",
      headers: { cookie: c, "X-OB-Request": "1", "content-type": "application/x-www-form-urlencoded" },
      body: "decision=approve&csrf=" + encodeURIComponent(await csrfFor(code.user_code)),
    });
    expect(approve.status).toBe(303);

    const granted = await (await post("/device/token", { device_code: code.device_code })).json();
    expect(granted.status).toBe("approved");
    expect(granted.token).toMatch(/^ob_machine_/);
    const again = await (await post("/device/token", { device_code: code.device_code })).json();
    expect(again).toEqual({ status: "expired" });
  });

  it("reports a denial", async () => {
    const code = await (await post("/device/code", {})).json();
    const c = await cookie();
    await SELF.fetch(`https://app.localhost/approve/${code.user_code}`, {
      method: "POST",
      headers: { cookie: c, "X-OB-Request": "1", "content-type": "application/x-www-form-urlencoded" },
      body: "decision=deny&csrf=" + encodeURIComponent(await csrfFor(code.user_code)),
    });
    expect(await (await post("/device/token", { device_code: code.device_code })).json())
      .toEqual({ status: "denied" });
  });

  it("sends a signed-out browser to login with next", async () => {
    const code = await (await post("/device/code", {})).json();
    const r = await SELF.fetch(`https://app.localhost/approve/${code.user_code}`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`/auth/login?next=${encodeURIComponent(`/approve/${code.user_code}`)}`);
  });

  it("rejects a forged CSRF token", async () => {
    const code = await (await post("/device/code", {})).json();
    const c = await cookie();
    const r = await SELF.fetch(`https://app.localhost/approve/${code.user_code}`, {
      method: "POST",
      headers: { cookie: c, "X-OB-Request": "1", "content-type": "application/x-www-form-urlencoded" },
      body: "decision=approve&csrf=1.2",
    });
    expect(r.status).toBe(403);
  });
});

async function csrfFor(userCode: string): Promise<string> {
  const { approveCsrf } = await import("../src/auth/approve-csrf.js");
  return approveCsrf(e, userCode);
}
```

`apps/server/test/size.test.ts`:

```ts
import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sessionCookieName, signSession } from "../src/auth/session.js";

it("renders the approval page under 8 KB", async () => {
  const e = env as unknown as import("../src/env.js").Env;
  const code = await (await SELF.fetch("https://app.localhost/device/code", { method: "POST", body: "{}" })).json();
  const cookie = `${sessionCookieName(e)}=${await signSession(e)}`;
  const html = await (await SELF.fetch(`https://app.localhost/approve/${code.user_code}`, { headers: { cookie } })).text();
  expect(new TextEncoder().encode(html).length).toBeLessThan(8 * 1024);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/device.test.ts`
Expected: FAIL — 404 on `/device/code`.

- [ ] **Step 3: Add the hub's device methods**

Append to the `Hub` class in `hub/do.ts` (imports: `newDeviceSecret`, `newUserCode`, `formatUserCode`, `normalizeUserCode`, `LIMITS` from `@ob/shared`; `DeviceCodeRow` from `./rows.js`):

```ts
  // ------------------------------------------------------------ device flow

  /** Registers a pending user code; the secret half is returned once to the CLI. */
  async createDeviceCode(label: string): Promise<{ deviceCode: string; userCode: string }> {
    this.init();
    const { sha256Hex } = await import("../util/crypto.js");
    const deviceCode = newDeviceSecret();
    const raw = newUserCode();
    const now = this.now();
    this.ctx.storage.sql.exec(
      `insert into device_codes (user_code, org_id, code_hash, label, created_at, expires_at)
       values (?, ?, ?, ?, ?, ?)`,
      formatUserCode(raw),
      OWNER_ORG_ID,
      await sha256Hex(deviceCode),
      label.slice(0, LIMITS.maxLabelChars),
      now,
      now + LIMITS.deviceCodeTtlSec * 1000,
    );
    return { deviceCode, userCode: raw };
  }

  async deviceCodeInfo(userCode: string): Promise<{
    label: string;
    state: "pending" | "approved" | "denied" | "expired";
  } | null> {
    const normalized = normalizeUserCode(userCode);
    if (!normalized) return null;
    const row = this.one<DeviceCodeRow>(
      "select user_code as userCode, code_hash as codeHash, label, created_at as createdAt, expires_at as expiresAt, approved_at as approvedAt, denied_at as deniedAt, machine_id as machineId, consumed_at as consumedAt from device_codes where user_code = ?",
      formatUserCode(normalized),
    );
    if (!row) return null;
    return { label: row.label, state: this.deviceState(row) };
  }

  private deviceState(row: DeviceCodeRow): "pending" | "approved" | "denied" | "expired" {
    if (row.consumedAt !== null) return "expired";
    if (row.expiresAt <= this.now()) return "expired";
    if (row.deniedAt !== null) return "denied";
    if (row.approvedAt !== null) return "approved";
    return "pending";
  }

  /** The approval page's decision. False when the code is unknown or already used. */
  async decideDeviceCode(
    userCode: string,
    decision: "approve" | "deny",
    label?: string,
  ): Promise<{ ok: true } | { ok: false; reason: "unknown" | "used" | "expired" }> {
    const normalized = normalizeUserCode(userCode);
    if (!normalized) return { ok: false, reason: "unknown" };
    const key = formatUserCode(normalized);
    const row = this.one<DeviceCodeRow>(
      "select user_code as userCode, code_hash as codeHash, label, created_at as createdAt, expires_at as expiresAt, approved_at as approvedAt, denied_at as deniedAt, machine_id as machineId, consumed_at as consumedAt from device_codes where user_code = ?",
      key,
    );
    if (!row) return { ok: false, reason: "unknown" };
    const state = this.deviceState(row);
    if (state === "expired") return { ok: false, reason: "expired" };
    if (state !== "pending") return { ok: false, reason: "used" };
    const now = this.now();
    if (decision === "deny") {
      this.ctx.storage.sql.exec("update device_codes set denied_at = ? where user_code = ?", now, key);
      return { ok: true };
    }
    this.ctx.storage.sql.exec(
      "update device_codes set approved_at = ?, label = ? where user_code = ?",
      now,
      (label ?? row.label).slice(0, LIMITS.maxLabelChars),
      key,
    );
    return { ok: true };
  }

  /** Poll: pending until approved, then one token, then expired forever. */
  async deviceToken(deviceCode: string): Promise<
    | { status: "pending" }
    | { status: "approved"; token: string; machineId: string }
    | { status: "denied" }
    | { status: "expired" }
  > {
    const { sha256Hex } = await import("../util/crypto.js");
    const row = this.one<DeviceCodeRow>(
      "select user_code as userCode, code_hash as codeHash, label, created_at as createdAt, expires_at as expiresAt, approved_at as approvedAt, denied_at as deniedAt, machine_id as machineId, consumed_at as consumedAt from device_codes where code_hash = ?",
      await sha256Hex(deviceCode),
    );
    if (!row) return { status: "denied" };
    const state = this.deviceState(row);
    if (state === "expired") return { status: "expired" };
    if (state === "denied") return { status: "denied" };
    if (state === "pending") return { status: "pending" };
    const machine = await this.createMachine(row.label);
    this.ctx.storage.sql.exec(
      "update device_codes set consumed_at = ?, machine_id = ? where user_code = ?",
      this.now(),
      machine.id,
      row.userCode,
    );
    this.notifyMachines();
    return { status: "approved", token: machine.token, machineId: machine.id };
  }

  /** Replaced by the real observer broadcast in B10. */
  notifyMachines(): void {}
```

`HubStub` is the class type, so these methods are visible to the Worker with no further export. `notifyMachines` lands in B10; B4's `deviceToken` calls it, so for this one task add a no-op `notifyMachines(): void {}` and B10 replaces it with the real broadcast.

- [ ] **Step 4: Write the approve CSRF**

`apps/server/src/auth/approve-csrf.ts`:

```ts
import type { Env } from "../env.js";
import { normalizeUserCode } from "@ob/shared";
import { deriveKey } from "./keys.js";
import { hmacSign, hmacVerify } from "../util/crypto.js";

const TTL_MS = 600_000;
const payload = (userCode: string, exp: number) => `${normalizeUserCode(userCode) ?? ""}\n${exp}`;

/**
 * The approval form's token: HMAC under `ob:approve` over the normalized code
 * and an expiry. Bound to the code, so a token lifted from another tab cannot
 * approve a different machine, and no cookie is needed to carry it.
 */
export async function approveCsrf(env: Env, userCode: string): Promise<string> {
  const exp = Date.now() + TTL_MS;
  const body = payload(userCode, exp);
  return `${exp}.${await hmacSign(await deriveKey(env, "ob:approve"), body)}`;
}

export async function checkApproveCsrf(env: Env, userCode: string, token: string): Promise<boolean> {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  return hmacVerify(await deriveKey(env, "ob:approve"), payload(userCode, exp), m[2] as string);
}
```

- [ ] **Step 5: Write the device routes**

`apps/server/src/routes/device.ts`:

```ts
import {
  DeviceCodeRequestSchema,
  DeviceTokenRequestSchema,
  LIMITS,
  R,
  formatUserCode,
  newMachineLabel,
} from "@ob/shared";
import { ApiError, appOrigin } from "../http/errors.js";
import { jsonBody } from "../http/body.js";
import type { AppEnv } from "../http/middleware.js";
import { hub } from "../hub/stub.js";
import type { AppType } from "./types.js";
import type { Context } from "hono";

/** Per-IP limiter; fails open only in dev/test where the binding is absent. */
async function deviceLimit(c: Context<AppEnv>, key: string): Promise<void> {
  const rl = c.env.RL_DEVICE;
  if (!rl) {
    if (c.env.ENVIRONMENT === "dev") return;
    throw new ApiError("rate_limited", "Rate limiter unavailable");
  }
  if (!(await rl.limit({ key })).success)
    throw new ApiError("rate_limited", "Too many attempts");
}

const ipKey = (c: Context<AppEnv>): string => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  return ip.split(",")[0]!.trim().slice(0, 64);
};

export function mountDevice(app: AppType): void {
  app.post(R.deviceCode, async (c) => {
    await deviceLimit(c, `dc:${ipKey(c)}`);
    const body = await jsonBody(c, DeviceCodeRequestSchema);
    const label = newMachineLabel(body.machine_label ?? "machine");
    const created = await hub(c.env).createDeviceCode(label);
    const userCode = formatUserCode(created.userCode);
    return c.json(
      {
        device_code: created.deviceCode,
        user_code: userCode,
        verification_uri: `${appOrigin(c.env)}${R.approve(userCode)}`,
        expires_in: LIMITS.deviceCodeTtlSec,
        interval: LIMITS.devicePollIntervalSec,
      },
      201,
    );
  });

  app.post(R.deviceToken, async (c) => {
    await deviceLimit(c, `dt:${ipKey(c)}`);
    const { device_code } = await jsonBody(c, DeviceTokenRequestSchema);
    const r = await hub(c.env).deviceToken(device_code);
    return c.json(
      r.status === "approved"
        ? { status: "approved", token: r.token, machine_id: r.machineId }
        : { status: r.status },
    );
  });
}
```

- [ ] **Step 6: Write the approval page and routes**

`apps/server/src/routes/approve-page.ts` (Backend owns behaviour and size; Design owns the look — see `03-design.md`. Keep every token inline, no external CSS or JS):

```ts
import { PRODUCT_NAME } from "@ob/shared";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

export type ApproveView =
  | { kind: "pending"; userCode: string; label: string; csrf: string }
  | { kind: "used"; userCode: string }
  | { kind: "expired"; userCode: string };

export function renderApprove(v: ApproveView): string {
  const body =
    v.kind === "pending"
      ? `<p class="k">Machine</p><p class="m">${esc(v.label)}</p>
<p class="k">Code</p><p class="c">${esc(v.userCode)}</p>
<p class="q">Allow this machine to join your ${PRODUCT_NAME}?</p>
<form method="post" action="/approve/${esc(v.userCode)}">
<input type="hidden" name="csrf" value="${esc(v.csrf)}">
<input type="hidden" name="label" value="${esc(v.label)}">
<button name="decision" value="approve">Approve</button>
<button name="decision" value="deny" class="no">Deny</button>
</form>`
      : `<p class="q">${v.kind === "used" ? "This code was already used." : "This code expired."}</p>
<p>Run <code>npx open-bus</code> again to get a new one.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approve a machine · ${PRODUCT_NAME}</title>
<style>
:root{--bg:#EEF0F3;--fg:#131518;--mut:#5b6068;--acc:#2350D0;--line:#d6d9de;--r:6px;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#131518;--fg:#EEF0F3;--mut:#9aa0aa;--acc:#7F9CFF;--line:#2a2d33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Geist,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}
main{width:100%;max-width:380px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:24px}
h1{font-size:16px;margin:0 0 16px}.k{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin:12px 0 2px}
.m,.c{margin:0;font:20px/1.3 Geist Mono,ui-monospace,monospace}.c{letter-spacing:.12em}
.q{margin:20px 0 12px}form{display:flex;gap:8px}button{flex:1;padding:9px 12px;border-radius:var(--r);border:1px solid var(--acc);background:var(--acc);color:#fff;font:inherit;cursor:pointer}
button.no{background:transparent;color:var(--fg);border-color:var(--line)}code{font-family:Geist Mono,ui-monospace,monospace}
</style></head><body><main><h1>Approve a machine</h1>${body}</main></body></html>`;
}
```

`apps/server/src/routes/approve.ts`:

```ts
import { ApprovalBodySchema, R, formatUserCode, normalizeUserCode } from "@ob/shared";
import { approveCsrf, checkApproveCsrf } from "../auth/approve-csrf.js";
import { ApiError } from "../http/errors.js";
import { resolveSession } from "../http/middleware.js";
import { hub } from "../hub/stub.js";
import type { AppType } from "./types.js";
import { renderApprove } from "./approve-page.js";

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });

export function mountApprove(app: AppType): void {
  app.get("/approve/:user_code", async (c) => {
    const code = normalizeUserCode(c.req.param("user_code"));
    if (!code) throw new ApiError("not_found", "Not found");
    const userCode = formatUserCode(code);
    if (!(await resolveSession(c))) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `/auth/login?next=${encodeURIComponent(`/approve/${userCode}`)}`,
          "cache-control": "no-store",
        },
      });
    }
    const info = await hub(c.env).deviceCodeInfo(userCode);
    if (!info) throw new ApiError("not_found", "Not found");
    if (info.state === "pending")
      return html(renderApprove({ kind: "pending", userCode, label: info.label, csrf: await approveCsrf(c.env, userCode) }));
    return html(renderApprove({ kind: info.state === "expired" ? "expired" : "used", userCode }));
  });

  app.post("/approve/:user_code", async (c) => {
    const code = normalizeUserCode(c.req.param("user_code"));
    if (!code) throw new ApiError("not_found", "Not found");
    const userCode = formatUserCode(code);
    const form = await c.req.parseBody();
    const csrf = typeof form.csrf === "string" ? form.csrf : "";
    if (!(await checkApproveCsrf(c.env, userCode, csrf)))
      throw new ApiError("csrf", "Invalid or expired form token");
    const body = ApprovalBodySchema.parse({
      decision: form.decision,
      label: typeof form.label === "string" && form.label.trim() ? form.label : undefined,
    });
    const r = await hub(c.env).decideDeviceCode(userCode, body.decision, body.label);
    if (!r.ok)
      return html(
        renderApprove({ kind: r.reason === "expired" ? "expired" : "used", userCode }),
      );
    return new Response(null, {
      status: 303,
      headers: { location: `${R.dashboard}?approved=${encodeURIComponent(userCode)}`, "cache-control": "no-store" },
    });
  });
}
```

- [ ] **Step 7: Mount everything**

`routes/index.ts`:

```ts
import type { AppType } from "./types.js";
import { mountApprove } from "./approve.js";
import { mountAuth } from "./auth.js";
import { mountDevice } from "./device.js";

export function mountRoutes(app: AppType): void {
  mountAuth(app);
  mountDevice(app);
  mountApprove(app);
}
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @ob/server test -- test/device.test.ts test/size.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/server
git commit -m "feat(server): device flow, approval page and machine token issuance"
```

---

### Task B5: `/hub` upgrade, hello, sessions, agent_up, roster

**Files:**
- Modify: `hub/do.ts`, `hub/stub.ts`, `routes/index.ts`
- Create: `routes/hub.ts`, `hub/names.ts`
- Test: `apps/server/test/hub.socket.test.ts`, `apps/server/test/hub.from_ref.test.ts`, `test/helpers.ts`

- [ ] **Step 1: Write the test helpers**

`apps/server/test/helpers.ts`:

```ts
import { SELF, env } from "cloudflare:test";
import { expect } from "vitest";
import type { ClientFrame, Frame, ServerFrame } from "@ob/shared";
import { decodeFrame } from "@ob/shared";
import { hub } from "../src/hub/stub.js";
import { sessionCookieName, signSession } from "../src/auth/session.js";

export const e = env as unknown as import("../src/env.js").Env;

export async function session(): Promise<string> {
  return `${sessionCookieName(e)}=${await signSession(e)}`;
}

export async function machine(label = "MacBook"): Promise<{ id: string; token: string }> {
  const m = await hub(e).createMachine(label);
  return { id: m.id, token: m.token };
}

/** A daemon socket exactly as the daemon opens it. */
export async function daemon(token: string): Promise<{
  ws: WebSocket;
  next: () => Promise<ServerFrame>;
  send: (f: ClientFrame) => void;
  close: () => void;
}> {
  const res = await SELF.fetch("https://app.localhost/hub", {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket as WebSocket;
  ws.accept();
  const queue: ServerFrame[] = [];
  const waiting: ((f: ServerFrame) => void)[] = [];
  ws.addEventListener("message", (ev) => {
    const f = decodeFrame(String(ev.data));
    if (!f) throw new Error(`not a frame: ${ev.data}`);
    const w = waiting.shift();
    if (w) w(f as ServerFrame);
    else queue.push(f as ServerFrame);
  });
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift() as ServerFrame)
      : new Promise<ServerFrame>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("timed out waiting for a frame")), 2000);
          waiting.push((f) => {
            clearTimeout(t);
            resolve(f);
          });
        });
  return {
    ws,
    next,
    send: (f) => ws.send(JSON.stringify(f)),
    close: () => ws.close(),
  };
}

/** Consume frames until one matches `type` (roster broadcasts may interleave). */
export async function waitFor<T extends Frame["type"]>(
  conn: { next: () => Promise<ServerFrame> },
  type: T,
): Promise<Extract<ServerFrame, { type: T }>> {
  for (let i = 0; i < 10; i++) {
    const f = await conn.next();
    if (f.type === type) return f as Extract<ServerFrame, { type: T }>;
  }
  throw new Error(`no ${type} frame`);
}
```

- [ ] **Step 2: Write the failing socket test**

`apps/server/test/hub.socket.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { daemon, machine, waitFor } from "./helpers.js";

const hello = (id: string) => ({ v: 1, id, type: "hello", machine_label: "MacBook", client_version: "0.1.0" }) as const;

describe("hub socket", () => {
  it("refuses /hub without a valid machine token", async () => {
    const r = await SELF.fetch("https://app.localhost/hub", { headers: { Upgrade: "websocket" } });
    expect(r.status).toBe(401);
    const r2 = await SELF.fetch("https://app.localhost/hub", {
      headers: { Upgrade: "websocket", Authorization: "Bearer ob_machine_" + "a".repeat(32) },
    });
    expect(r2.status).toBe(401);
  });

  it("answers hello with the machine id and registers agents", async () => {
    const m = await machine();
    const d = await daemon(m.token);
    d.send(hello("h1"));
    const ok = await waitFor(d, "hello_ok");
    expect(ok.machine_id).toBe(m.id);

    d.send({
      v: 1, id: "u1", type: "agent_up", agent_ref: "ses_a", kind: "opencode",
      proposed_name: "OpenBus Backend", namespace: "github.com/a/b", global: false,
    });
    const reg = await waitFor(d, "agent_ok");
    expect(reg).toMatchObject({ agent_ref: "ses_a", bus_name: "OpenBus Backend" });
    d.close();
  });

  it("suffixes a name already taken in the namespace", async () => {
    const m = await machine();
    const d = await daemon(m.token);
    d.send(hello("h"));
    await waitFor(d, "hello_ok");
    for (const [id, ref] of [["u1", "ses_a"], ["u2", "ses_b"]] as const) {
      d.send({ v: 1, id, type: "agent_up", agent_ref: ref, kind: "opencode", proposed_name: "Claude", namespace: "ns", global: false });
    }
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("Claude");
    const second = await waitFor(d, "agent_ok");
    expect(second.bus_name).not.toBe("Claude");
    d.close();
  });

  it("broadcasts roster_changed and frees the name on agent_down", async () => {
    const m = await machine();
    const a = await daemon(m.token);
    a.send(hello("h"));
    await waitFor(a, "hello_ok");
    a.send({ v: 1, id: "u1", type: "agent_up", agent_ref: "ses_a", kind: "opencode", proposed_name: "Pi", namespace: "ns", global: false });
    await waitFor(a, "agent_ok");
    a.send({ v: 1, id: "d1", type: "agent_down", agent_ref: "ses_a" });
    await waitFor(a, "roster_changed");
    a.send(hello("h2"));
    await waitFor(a, "hello_ok");
    a.send({ v: 1, id: "u2", type: "agent_up", agent_ref: "ses_b", kind: "pi", proposed_name: "Pi", namespace: "ns", global: false });
    expect((await waitFor(a, "agent_ok")).bus_name).toBe("Pi");
    a.close();
  });

  it("keeps the last socket and closes the replaced one", async () => {
    const m = await machine();
    const first = await daemon(m.token);
    const second = await daemon(m.token);
    const code = await new Promise<number>((resolve) => first.ws.addEventListener("close", (e) => resolve(e.code)));
    expect(code).toBe(1000);
    second.close();
  });
});
```

`apps/server/test/hub.from_ref.test.ts` (Review Focus 1):

```ts
import { describe, expect, it } from "vitest";
import { daemon, machine, waitFor } from "./helpers.js";

const up = (id: string, ref: string, name: string, ns = "ns") => ({
  v: 1, id, type: "agent_up", agent_ref: ref, kind: "opencode",
  proposed_name: name, namespace: ns, global: false,
}) as const;

describe("identity", () => {
  it("rejects a send whose from_ref is not registered on this socket", async () => {
    const m = await machine();
    const d = await daemon(m.token);
    d.send({ v: 1, id: "h", type: "hello", machine_label: "MacBook", client_version: "0.1.0" });
    await waitFor(d, "hello_ok");
    d.send(up("u1", "ses_a", "Mine"));
    await waitFor(d, "agent_ok");

    // ses_other belongs to no agent on this machine.
    d.send({ v: 1, id: "s1", type: "send", from_ref: "ses_other", to_name: "Mine", body: "spoof" });
    const err = await waitFor(d, "error");
    expect(err.code).toBe("not_registered");

    // Nothing was accepted: the same agent may send to itself and gets a receipt.
    d.send({ v: 1, id: "s2", type: "send", from_ref: "ses_a", to_name: "Mine", body: "hi" });
    const receipt = await waitFor(d, "receipt");
    expect(receipt.msg_id).toHaveLength(16);
    d.close();
  });

  it("rejects frames that are not client frames", async () => {
    const m = await machine();
    const d = await daemon(m.token);
    d.send({ v: 1, id: "h", type: "hello", machine_label: "m", client_version: "0.1.0" });
    await waitFor(d, "hello_ok");
    d.ws.send(JSON.stringify({ v: 1, id: "x", type: "receipt", msg_id: "a".repeat(16), state: "delivered" }));
    expect((await waitFor(d, "error")).code).toBe("bad_frame");
    d.close();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/hub.socket.test.ts`
Expected: FAIL — `/hub` returns 404.

- [ ] **Step 4: Write the hub's socket layer**

Add to `hub/do.ts` (imports: `CLIENT_FRAMES`, `PING`, `PONG`, `ServerFrame`, `ClientFrame`, `AgentRow`, `AGENT_COLS`, `decodeFrame`, `encodeFrame`, `frameId`, `candidateName`, `suffixName`, `AgentUpFrame`, `isMachineId`):

```ts
  // ------------------------------------------------------------ sockets

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/events") return this.acceptObserver(req);
    if (url.pathname !== "/hub") return new Response("Not found", { status: 404 });
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected WebSocket upgrade", { status: 426 });
    const machineId = req.headers.get("X-Ob-Machine-Id") ?? "";
    if (!isMachineId(machineId) || !this.machine(machineId))
      return new Response("Unknown machine", { status: 401 });

    // One live socket per machine: a reconnect replaces the previous one.
    for (const old of this.ctx.getWebSockets(`m:${machineId}`)) {
      try {
        old.close(1000, "replaced");
      } catch {
        // already gone
      }
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["daemon", `m:${machineId}`]);
    pair[1].serializeAttachment({ machineId });
    // Bare-string keepalive costs no isolate time while hibernated.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    this.notifyMachines();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return this.closeWith(ws, LIMITS.protocolCloseCode, "text frames only");
    if (message === PING) return;
    const frame = decodeFrame(message);
    if (!frame || !(CLIENT_FRAMES as readonly string[]).includes(frame.type))
      return this.reject(ws, null, "bad_frame", "unreadable frame");
    const { machineId } = (ws.deserializeAttachment() as { machineId: string } | null) ?? { machineId: "" };
    if (!machineId || !this.machine(machineId))
      return this.closeWith(ws, LIMITS.revokeCloseCode, "machine revoked");

    switch (frame.type) {
      case "hello":
        return this.send(ws, {
          v: 1, id: frame.id, type: "hello_ok",
          machine_id: machineId,
          machine_label: this.machine(machineId)!.label,
          server_version: this.env.VERSION ?? "dev",
        });
      case "sessions":
        this.applySessions(machineId, frame.open, frame.closed);
        return;
      case "agent_up":
        return this.send(ws, this.agentUp(frame, machineId));
      case "agent_down":
        this.agentDown(machineId, frame.agent_ref);
        return;
      case "list":
        return this.send(ws, this.listFor(machineId, frame.from_ref, frame.id));
      // Mail lands in B6 (send/ack/refuse) and B8 (fetch). Until then these
      // answer not_found, so this commit still compiles and never lies.
      case "send":
      case "ack":
      case "refuse":
      case "fetch":
        return this.reject(ws, frame.id, "not_found", "Mail is not available yet");
      case "hello_ok":
      case "agent_ok":
      case "receipt":
      case "roster":
      case "body":
      case "error":
      case "deliver":
      case "receipt_update":
      case "roster_changed":
        return this.reject(ws, frame.id, "bad_frame", "server frame from a daemon");
    }
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
    } catch {
      // already closed
    }
    this.notifyMachines();
    this.notifyRoster([]);
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(encodeFrame(frame));
    } catch {
      // closing socket
    }
  }

  private reject(ws: WebSocket, id: string | null, code: "bad_frame" | "not_registered" | "not_found" | "too_large" | "rate_limited" | "internal", message: string): void {
    this.send(ws, { v: 1, id: id ?? frameId(), type: "error", code, message });
  }

  private closeWith(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason.slice(0, 120));
    } catch {
      // already closed
    }
  }

  // ------------------------------------------------------------ roster

  private agentForRef(machineId: string, ref: string): AgentRow | null {
    return this.one<AgentRow>(
      `select ${AGENT_COLS} from agents where machine_id = ? and native_ref = ? and live = 1`,
      machineId,
      ref,
    );
  }

  private nameTaken(namespace: string, name: string, global: boolean, excludeId: string | null): boolean {
    const local = this.one<{ x: number }>(
      "select 1 as x from agents where org_id = ? and namespace = ? and name = ? and live = 1 and id is not ? limit 1",
      OWNER_ORG_ID, namespace, name, excludeId,
    );
    if (local) return true;
    if (!global) return false;
    return !!this.one<{ x: number }>(
      "select 1 as x from agents where org_id = ? and name = ? and global = 1 and live = 1 and id is not ? limit 1",
      OWNER_ORG_ID, name, excludeId,
    );
  }

  private assignName(namespace: string, proposed: string, global: boolean, excludeId: string | null): string {
    const base = candidateName(proposed);
    if (!this.nameTaken(namespace, base, global, excludeId)) return base;
    for (let n = 2; n <= 99; n++) {
      const next = suffixName(base, n);
      if (!this.nameTaken(namespace, next, global, excludeId)) return next;
    }
    return suffixName(base, 100 + Math.floor(Math.random() * 100));
  }

  private agentUp(frame: AgentUpFrame, machineId: string): ServerFrame {
    const now = this.now();
    const existing = this.one<AgentRow>(
      `select ${AGENT_COLS} from agents where machine_id = ? and native_ref = ?`,
      machineId, frame.agent_ref,
    );
    const name = this.assignName(frame.namespace, frame.proposed_name, frame.global, existing?.id ?? null);
    if (!existing) {
      this.ctx.storage.sql.exec(
        `insert into agents (id, org_id, namespace, name, last_name, kind, machine_id, native_ref, global, live, updated_at)
         values (?, ?, ?, ?, null, ?, ?, ?, ?, 1, ?)`,
        newId(), OWNER_ORG_ID, frame.namespace, name, frame.kind, machineId, frame.agent_ref,
        frame.global ? 1 : 0, now,
      );
    } else {
      this.ctx.storage.sql.exec(
        `update agents set namespace = ?, name = ?, kind = ?, global = ?, live = 1, updated_at = ? where id = ?`,
        frame.namespace, name, frame.kind, frame.global ? 1 : 0, now, existing.id,
      );
    }
    this.notifyRoster([frame.namespace]);
    this.notifyMachines();
    return { v: 1, id: frame.id, type: "agent_ok", agent_ref: frame.agent_ref, bus_name: name };
  }

  private closeAgent(agent: AgentRow): void {
    this.ctx.storage.sql.exec(
      "update agents set live = 0, last_name = name, updated_at = ? where id = ?",
      this.now(),
      agent.id,
    );
  }

  private agentDown(machineId: string, ref: string): void {
    const agent = this.one<AgentRow>(
      `select ${AGENT_COLS} from agents where machine_id = ? and native_ref = ? and live = 1`,
      machineId, ref,
    );
    if (!agent) return;
    this.closeAgent(agent);
    this.notifyRoster([agent.namespace]);
    this.notifyMachines();
  }

  private applySessions(machineId: string, open: string[], closed: string[]): void {
    for (const ref of closed) this.agentDown(machineId, ref);
    void open; // an agent becomes live on its own agent_up, which the daemon sends next
  }

  private listFor(machineId: string, fromRef: string, id: string): ServerFrame {
    const agent = this.agentForRef(machineId, fromRef);
    if (!agent)
      return { v: 1, id, type: "error", code: "not_registered", message: "from_ref is not registered on this socket" };
    const rows = agent.global
      ? this.all<AgentRow>(`select ${AGENT_COLS} from agents where org_id = ? and live = 1 order by namespace, name limit 500`, OWNER_ORG_ID)
      : this.all<AgentRow>(
          `select ${AGENT_COLS} from agents where org_id = ? and live = 1 and (namespace = ? or global = 1) order by namespace, name limit 500`,
          OWNER_ORG_ID, agent.namespace,
        );
    return {
      v: 1, id, type: "roster",
      agents: rows.map((r) => ({
        bus_name: r.name, kind: r.kind, namespace: r.namespace, global: r.global === 1,
      })),
    };
  }

  /** Every daemon hears about a roster change, one frame per changed namespace. */
  private notifyRoster(namespaces: string[]): void {
    const seen = [...new Set(namespaces)].filter((n) => n.length > 0);
    for (const ws of this.ctx.getWebSockets("daemon"))
      for (const namespace of seen)
        this.send(ws, { v: 1, id: frameId(), type: "roster_changed", namespace });
  }
```

B10 adds the dashboard observer broadcast to this method.

Call sites: `this.notifyRoster([frame.namespace])` in `agentUp`, `this.notifyRoster([agent.namespace])` in `agentDown`, `this.notifyRoster([])` in `webSocketClose`.

`hub/names.ts` is not needed: `candidateName`/`suffixName` come from `@ob/shared`.

- [ ] **Step 5: Add the Worker's `/hub` route**

`apps/server/src/routes/hub.ts`:

```ts
import { R, isMachineToken } from "@ob/shared";
import { ApiError } from "../http/errors.js";
import { hub } from "../hub/stub.js";
import { sha256Hex } from "../util/crypto.js";
import type { AppType } from "./types.js";

const BEARER = /^\s*Bearer\s+(\S+)\s*$/i;

export function mountHub(app: AppType): void {
  app.get(R.hub, async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      throw new ApiError("bad_request", "Expected a WebSocket upgrade");
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
    if (!isMachineToken(token)) throw new ApiError("unauthorized", "Invalid machine token");
    const h = hub(c.env);
    const machine = await h.verifyToken(await sha256Hex(token));
    if (!machine) throw new ApiError("unauthorized", "Invalid machine token");
    // The Worker never speaks the protocol: it forwards the upgrade with the
    // machine id it just proved, which the hub trusts (same binding).
    return c.env.HUB.get(c.env.HUB.idFromName(machine.id === "" ? "" : "owner"))
      .fetch("https://hub.internal/hub", {
        headers: { Upgrade: "websocket", "X-Ob-Machine-Id": machine.id },
      });
  });
}
```

Use `hub(c.env)`'s stub for the forward instead of repeating idFromName. Add `fetchHub(env, machineId, path, init)` to `hub/stub.ts`:

```ts
export function hubFetch(env: Pick<Env, "HUB">, path: string, init: RequestInit = {}): Promise<Response> {
  const ns = env.HUB;
  return ns.get(ns.idFromName(OWNER_ORG_ID)).fetch(`https://hub.internal${path}`, init);
}
```

and the route returns `hubFetch(c.env, "/hub", { headers: { Upgrade: "websocket", "X-Ob-Machine-Id": machine.id } })`.

- [ ] **Step 6: Mount and run**

Mount in `routes/index.ts`: `mountHub(app);`

Run: `pnpm --filter @ob/server test -- test/hub.socket.test.ts test/hub.from_ref.test.ts`
Expected: PASS (7 tests). `send` and `fetch` are not implemented until B6/B8; the from_ref test only asserts the identity rejection, so it passes once the socket layer exists. If it reaches `handleSend` before B6, keep that test focused on `not_registered` and re-enable the receipt half in B6.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(hub): daemon sockets, hello, agent registration and roster"
```

---

### Task B6: Send, deliver, ack — and write-on-miss

**Files:**
- Modify: `hub/do.ts`, `hub/stub.ts`, `routes/index.ts`
- Test: `apps/server/test/hub.mail.test.ts`

- [ ] **Step 1: Write the failing mail test**

```ts
import { describe, expect, it } from "vitest";
import { LIMITS } from "@ob/shared";
import { daemon, machine, waitFor } from "./helpers.js";

const up = (id: string, ref: string, name: string, ns = "ns") => ({
  v: 1, id, type: "agent_up", agent_ref: ref, kind: "opencode",
  proposed_name: name, namespace: ns, global: false,
}) as const;
const hello = (id: string) => ({ v: 1, id, type: "hello", machine_label: "m", client_version: "0.1.0" }) as const;

describe("mail", () => {
  it("delivers inline, acks, and reports delivered", async () => {
    const m = await machine();
    const sender = await daemon(m.token);
    const receiver = await daemon(m.token);
    sender.send(hello("h1")); await waitFor(sender, "hello_ok");
    receiver.send(hello("h2")); await waitFor(receiver, "hello_ok");
    sender.send(up("u1", "sref", "Sender")); await waitFor(sender, "agent_ok");
    receiver.send(up("u2", "rref", "Receiver")); await waitFor(receiver, "agent_ok");

    sender.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Receiver", body: "hello" });
    const receipt = await waitFor(sender, "receipt");
    expect(receipt.state).toBe("pending");

    const deliver = await waitFor(receiver, "deliver");
    expect(deliver).toMatchObject({ to_ref: "rref", from_name: "Sender", namespace: "ns", body: "hello" });
    receiver.send({ v: 1, id: "a1", type: "ack", msg_id: deliver.msg_id });
    expect(await waitFor(sender, "receipt_update")).toMatchObject({ msg_id: deliver.msg_id, state: "delivered" });
    sender.close(); receiver.close();
  });

  it("sends an oversized body as a notice and serves it on fetch", async () => {
    const m = await machine();
    const sender = await daemon(m.token);
    const receiver = await daemon(m.token);
    sender.send(hello("h1")); await waitFor(sender, "hello_ok");
    receiver.send(hello("h2")); await waitFor(receiver, "hello_ok");
    sender.send(up("u1", "sref", "Sender")); await waitFor(sender, "agent_ok");
    receiver.send(up("u2", "rref", "Receiver")); await waitFor(receiver, "agent_ok");

    const big = "x".repeat(LIMITS.inlineBodyBytes + 1);
    sender.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Receiver", body: big });
    await waitFor(sender, "receipt");
    const deliver = await waitFor(receiver, "deliver");
    expect(deliver.body).toBeUndefined();
    expect(deliver.notice).toEqual({ size: big.length, msg_id: deliver.msg_id });

    receiver.send({ v: 1, id: "f1", type: "fetch", from_ref: "rref", msg_id: deliver.msg_id });
    const body = await waitFor(receiver, "body");
    expect(body.body).toBe(big);
    sender.close(); receiver.close();
  });

  it("refuses over the hard cap and to an unknown agent", async () => {
    const m = await machine();
    const d = await daemon(m.token);
    d.send(hello("h")); await waitFor(d, "hello_ok");
    d.send(up("u1", "sref", "Sender")); await waitFor(d, "agent_ok");

    d.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Nobody", body: "x" });
    expect(await waitFor(d, "receipt")).toMatchObject({ state: "refused", reason: "unknown_agent" });

    d.send({ v: 1, id: "s2", type: "send", from_ref: "sref", to_name: "Sender", body: "x".repeat(LIMITS.maxMessageBytes + 1) });
    expect((await waitFor(d, "error")).code).toBe("bad_frame"); // rejected by the frame schema before any work
    d.close();
  });

  it("refuses the message past the inbox cap", async () => {
    const senderM = await machine("Sender");
    const receiverM = await machine("Receiver");
    const sender = await daemon(senderM.token);
    sender.send(hello("h")); await waitFor(sender, "hello_ok");
    sender.send(up("u1", "sref", "Sender")); await waitFor(sender, "agent_ok");

    // The receiver registers, then its machine goes offline without a close
    // frame: the agent stays live, so its mail queues.
    const receiver = await daemon(receiverM.token);
    receiver.send(hello("h2")); await waitFor(receiver, "hello_ok");
    receiver.send(up("u2", "rref", "Receiver")); await waitFor(receiver, "agent_ok");
    receiver.close();
    await new Promise((r) => setTimeout(r, 50));

    for (let i = 0; i < LIMITS.inboxCap; i++) {
      sender.send({ v: 1, id: `q${i}`, type: "send", from_ref: "sref", to_name: "Receiver", body: `m${i}` });
      expect((await waitFor(sender, "receipt")).state).toBe("pending");
    }
    sender.send({ v: 1, id: "over", type: "send", from_ref: "sref", to_name: "Receiver", body: "one too many" });
    expect(await waitFor(sender, "receipt")).toMatchObject({ state: "refused", reason: "inbox_full" });
    sender.close();
  });

  it("turns a harness refusal into refused:closed and drops the mail", async () => {
    const m = await machine();
    const sender = await daemon(m.token);
    const receiver = await daemon(m.token);
    sender.send(hello("h1")); await waitFor(sender, "hello_ok");
    receiver.send(hello("h2")); await waitFor(receiver, "hello_ok");
    sender.send(up("u1", "sref", "Sender")); await waitFor(sender, "agent_ok");
    receiver.send(up("u2", "rref", "Receiver")); await waitFor(receiver, "agent_ok");

    sender.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Receiver", body: "hi" });
    await waitFor(sender, "receipt");
    const deliver = await waitFor(receiver, "deliver");
    receiver.send({ v: 1, id: "r1", type: "refuse", msg_id: deliver.msg_id, reason: "closed", detail: "denied" });
    expect(await waitFor(sender, "receipt_update")).toMatchObject({
      msg_id: deliver.msg_id, state: "refused", reason: "closed",
    });
    // A later ack cannot resurrect it.
    receiver.send({ v: 1, id: "a1", type: "ack", msg_id: deliver.msg_id });
    sender.send({ v: 1, id: "s2", type: "send", from_ref: "sref", to_name: "Receiver", body: "second" });
    expect((await waitFor(sender, "receipt")).state).toBe("pending");
    sender.close(); receiver.close();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/hub.mail.test.ts`
Expected: FAIL — no `deliver` frame (send is unhandled).

- [ ] **Step 3: Replace the mail stub in the dispatcher**

In `webSocketMessage`, replace the combined case added in B5:

```ts
      case "send":
      case "ack":
      case "refuse":
      case "fetch":
        return this.reject(ws, frame.id, "not_found", "Mail is not available yet");
```

with:

```ts
      case "send":
        return this.handleSend(ws, frame, machineId);
      case "ack":
        this.handleAck(machineId, frame.msg_id);
        return;
      case "refuse":
        this.handleRefuse(machineId, frame.msg_id, frame.detail);
        return;
      case "fetch":
        return this.reject(ws, frame.id, "not_found", "No such message");
```

(`fetch` becomes real in B8.)

- [ ] **Step 4: Implement send/deliver/ack**

Add to `Hub` (imports: `RefusalReason`, `SendFrame`, `AckFrame`, `utf8Bytes`, `RECEIPT_COLS`, `ReceiptRow`; plus `import { logEvent } from "../util/log.js"`):

```ts
  // ------------------------------------------------------------ mail

  private receipt(id: string): ReceiptRow | null {
    return this.one<ReceiptRow>(`select ${RECEIPT_COLS} from receipts where id = ?`, id);
  }

  private held = new Map<string, { body: string; deadline: number }>();

  private resolveTarget(sender: AgentRow, name: string):
    | { kind: "agent"; agent: AgentRow }
    | { kind: "refused"; reason: RefusalReason } {
    const live = this.one<AgentRow>(
      `select ${AGENT_COLS} from agents where org_id = ? and namespace = ? and name = ? and live = 1 limit 1`,
      OWNER_ORG_ID, sender.namespace, name,
    );
    if (live) return { kind: "agent", agent: live };
    const global = this.one<AgentRow>(
      `select ${AGENT_COLS} from agents where org_id = ? and name = ? and global = 1 and live = 1 limit 1`,
      OWNER_ORG_ID, name,
    );
    if (global) return { kind: "agent", agent: global };
    const closed = this.one<{ x: number }>(
      `select 1 as x from agents where org_id = ? and name = ? and (namespace = ? or global = 1) and live = 0 limit 1`,
      OWNER_ORG_ID, name, sender.namespace,
    );
    if (closed) return { kind: "refused", reason: "closed" };
    // B8 ruling: no "live elsewhere -> other_namespace" branch. Other
    // namespaces are invisible and unreachable (spec goal 5, scenario 6), so a
    // name live only in another namespace is unknown_agent; other_namespace
    // answers an explicit to_namespace only.
    return { kind: "refused", reason: "unknown_agent" };
  }

  private pendingTo(agentId: string): number {
    const row = this.one<{ n: number }>(
      "select count(*) as n from receipts where to_agent = ? and state = 'pending'",
      agentId,
    );
    return row?.n ?? 0;
  }

  private handleSend(ws: WebSocket, frame: SendFrame, machineId: string): void {
    const sender = this.agentForRef(machineId, frame.from_ref);
    if (!sender)
      return this.reject(ws, frame.id, "not_registered", "from_ref is not registered on this socket");

    const target = this.resolveTarget(sender, frame.to_name);
    if (target.kind === "refused")
      return this.send(ws, {
        v: 1, id: frame.id, type: "receipt", msg_id: newId(), state: "refused", reason: target.reason,
      });

    if (target.agent.machineId && this.pendingTo(target.agent.id) >= LIMITS.inboxCap)
      return this.send(ws, {
        v: 1, id: frame.id, type: "receipt", msg_id: newId(), state: "refused", reason: "inbox_full",
      });

    const now = this.now();
    const msgId = newId();
    const size = utf8Bytes(frame.body);
    const expiresAt = now + LIMITS.mailTtlSec * 1000;
    this.ctx.storage.sql.exec(
      `insert into receipts (id, org_id, namespace, to_agent, to_name, from_agent, from_name, state, reason, size, created_at, expires_at, acked_at)
       values (?, ?, ?, ?, ?, ?, ?, 'pending', null, ?, ?, ?, null)`,
      msgId, OWNER_ORG_ID, sender.namespace, target.agent.id, target.agent.name,
      sender.id, sender.name, size, now, expiresAt,
    );
    const receipt = this.receipt(msgId)!;
    this.deliverTo(target.agent, receipt, frame.body);
    this.send(ws, { v: 1, id: frame.id, type: "receipt", msg_id: msgId, state: "pending" });
  }

  /**
   * Push when the machine is connected, else persist the body for the next
   * reconnect. The receipt row exists either way, so a receipt never lies.
   */
  private deliverTo(target: AgentRow, receipt: ReceiptRow, body: string): void {
    const socket = this.ctx.getWebSockets(`m:${target.machineId}`)[0];
    if (!socket || target.live !== 1) {
      this.persistBody(receipt, body);
      return;
    }
    if (receipt.size <= LIMITS.inlineBodyBytes) {
      this.send(socket, {
        v: 1, id: frameId(), type: "deliver", msg_id: receipt.id, to_ref: target.nativeRef,
        from_name: receipt.fromName, namespace: receipt.namespace, body,
      });
      this.held.set(receipt.id, { body, deadline: this.now() + LIMITS.ackTimeoutMs });
    } else {
      this.persistBody(receipt, body);
      this.send(socket, {
        v: 1, id: frameId(), type: "deliver", msg_id: receipt.id, to_ref: target.nativeRef,
        from_name: receipt.fromName, namespace: receipt.namespace,
        notice: { size: receipt.size, msg_id: receipt.id },
      });
    }
    this.arm(receipt.expiresAt);
  }

  private persistBody(receipt: ReceiptRow, body: string): void {
    this.ctx.storage.sql.exec(
      `insert into mail (id, org_id, body, created_at, expires_at) values (?, ?, ?, ?, ?)
       on conflict(id) do update set body = excluded.body`,
      receipt.id, OWNER_ORG_ID, body, receipt.createdAt, receipt.expiresAt,
    );
  }

  private bodyOf(id: string): string | null {
    const held = this.held.get(id);
    if (held) return held.body;
    return this.one<{ body: string }>("select body from mail where id = ?", id)?.body ?? null;
  }

  private handleAck(machineId: string, msgId: string): void {
    const r = this.receipt(msgId);
    if (!r || r.state !== "pending") return;
    const target = this.one<AgentRow>(`select ${AGENT_COLS} from agents where id = ?`, r.toAgent ?? "");
    // Only the recipient's machine may ack, and only for its own mail.
    if (!target || target.machineId !== machineId) return;
    this.markDelivered(r);
  }

  /**
   * The harness did not take the message (Claude `peer_message_status` on the
   * hold/drop path, a failed `session.prompt`, a dead session). Only the
   * recipient's machine may refuse, and only while the receipt is pending.
   * `held` never reaches here: it means "keep waiting", so the daemon stays
   * silent and acks later.
   */
  private handleRefuse(
    machineId: string,
    msgId: string,
    detail: "denied" | "refused" | "expired" | "dropped",
  ): void {
    const r = this.receipt(msgId);
    if (!r || r.state !== "pending") return;
    const target = this.one<AgentRow>(`select ${AGENT_COLS} from agents where id = ?`, r.toAgent ?? "");
    if (!target || target.machineId !== machineId) return;
    this.ctx.storage.sql.exec(
      "update receipts set state = 'refused', reason = 'closed' where id = ? and state = 'pending'",
      msgId,
    );
    this.ctx.storage.sql.exec("delete from mail where id = ?", msgId);
    this.held.delete(msgId);
    logEvent("harness_refused", { detail });
    this.notifySender(r, "refused", "closed");
  }

  private markDelivered(r: ReceiptRow): void {    this.ctx.storage.sql.exec(
      "update receipts set state = 'delivered', acked_at = ? where id = ? and state = 'pending'",
      this.now(), r.id,
    );
    this.ctx.storage.sql.exec("delete from mail where id = ?", r.id);
    this.held.delete(r.id);
    this.notifySender(r, "delivered");
  }

  /** A receipt update goes to the sender's machine if it is connected. */
  private notifySender(
    r: ReceiptRow,
    state: "delivered" | "expired" | "refused",
    reason?: "recipient_closed" | "closed",
  ): void {
    const from = this.one<AgentRow>(`select ${AGENT_COLS} from agents where id = ?`, r.fromAgent);
    if (!from) return;
    const socket = this.ctx.getWebSockets(`m:${from.machineId}`)[0];
    if (!socket) return;
    const frame: ServerFrame = { v: 1, id: frameId(), type: "receipt_update", msg_id: r.id, state };
    if (reason) frame.reason = reason;
    this.send(socket, frame);
  }

  private arm(t: number): void {
    const cur = this.ctx.storage.getAlarm();
    if (cur === null || cur > t) this.ctx.storage.setAlarm(t);
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ob/server test -- test/hub.mail.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(hub): send, inline delivery, notice plus fetch, ack and receipts"
```

---

### Task B7: Expiry, ack timeout, reconnect flush

**Files:**
- Modify: `hub/do.ts`
- Test: `apps/server/test/hub.reconnect.test.ts`

- [ ] **Step 1: Write the failing reconnect test**

```ts
import { describe, expect, it } from "vitest";
import { LIMITS } from "@ob/shared";
import { daemon, e, machine, waitFor } from "./helpers.js";
import { hub } from "../src/hub/stub.js";

const up = (id: string, ref: string, name: string) => ({
  v: 1, id, type: "agent_up", agent_ref: ref, kind: "opencode",
  proposed_name: name, namespace: "ns", global: false,
}) as const;
const hello = (id: string) => ({ v: 1, id, type: "hello", machine_label: "m", client_version: "0.1.0" }) as const;

describe("reconnect", () => {
  it("queues while the machine is offline and delivers on reconnect", async () => {
    const senderM = await machine("Sender");
    const receiverM = await machine("Receiver");
    const sender = await daemon(senderM.token);
    sender.send(hello("h")); await waitFor(sender, "hello_ok");
    sender.send(up("u1", "sref", "Sender")); await waitFor(sender, "agent_ok");

    // The receiver registered once, then went offline without saying so.
    const first = await daemon(receiverM.token);
    first.send(hello("h2")); await waitFor(first, "hello_ok");
    first.send(up("u2", "rref", "Receiver")); await waitFor(first, "agent_ok");
    first.close();
    await new Promise((r) => setTimeout(r, 50));

    sender.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Receiver", body: "queued" });
    expect((await waitFor(sender, "receipt")).state).toBe("pending");

    const second = await daemon(receiverM.token);
    second.send(hello("h3")); await waitFor(second, "hello_ok");
    second.send({ v: 1, id: "se", type: "sessions", open: ["rref"], closed: [] });
    second.send(up("u3", "rref", "Receiver")); await waitFor(second, "agent_ok");
    const deliver = await waitFor(second, "deliver");
    expect(deliver.body).toBe("queued");
    second.send({ v: 1, id: "a1", type: "ack", msg_id: deliver.msg_id });
    expect(await waitFor(sender, "receipt_update")).toMatchObject({ state: "delivered" });
    sender.close(); second.close();
  });

  it("expires queued mail at the TTL and never claims delivered", async () => {
    const senderM = await machine("Sender");
    const receiverM = await machine("Receiver");
    const sender = await daemon(senderM.token);
    sender.send(hello("h")); await waitFor(sender, "hello_ok");
    sender.send(up("u1", "sref", "Sender")); await waitFor(sender, "agent_ok");
    const receiver = await daemon(receiverM.token);
    receiver.send(hello("h2")); await waitFor(receiver, "hello_ok");
    receiver.send(up("u2", "rref", "Receiver")); await waitFor(receiver, "agent_ok");
    receiver.close();
    await new Promise((r) => setTimeout(r, 50));

    sender.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Receiver", body: "later" });
    await waitFor(sender, "receipt");

    await hub(e).setClock(Date.now() + (LIMITS.mailTtlSec + 5) * 1000);
    await hub(e).runAlarmForTest();
    expect(await waitFor(sender, "receipt_update")).toMatchObject({ state: "expired" });
    sender.close();
  });

  it("expires queued mail at once when the daemon reports the session closed", async () => {
    const senderM = await machine("Sender");
    const receiverM = await machine("Receiver");
    const sender = await daemon(senderM.token);
    sender.send(hello("h")); await waitFor(sender, "hello_ok");
    sender.send(up("u1", "sref", "Sender")); await waitFor(sender, "agent_ok");
    const receiver = await daemon(receiverM.token);
    receiver.send(hello("h2")); await waitFor(receiver, "hello_ok");
    receiver.send(up("u2", "rref", "Receiver")); await waitFor(receiver, "agent_ok");
    receiver.close();
    await new Promise((r) => setTimeout(r, 50));

    sender.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Receiver", body: "queued" });
    await waitFor(sender, "receipt");

    const again = await daemon(receiverM.token);
    again.send(hello("h3")); await waitFor(again, "hello_ok");
    again.send({ v: 1, id: "se", type: "sessions", open: [], closed: ["rref"] });
    expect(await waitFor(sender, "receipt_update")).toMatchObject({
      state: "expired", reason: "recipient_closed",
    });
    sender.close(); again.close();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/hub.reconnect.test.ts`
Expected: FAIL — `runAlarmForTest` and expiry are missing.

- [ ] **Step 3: Implement expiry, flush and the alarm**

Add to `Hub`:

```ts
  // ------------------------------------------------------------ expiry

  private expireAllPending(agentId: string, reason: "recipient_closed"): void {
    const rows = this.all<ReceiptRow>(
      `select ${RECEIPT_COLS} from receipts where to_agent = ? and state = 'pending' limit 200`,
      agentId,
    );
    for (const r of rows) this.expire(r.id, reason);
  }

  private expire(id: string, reason?: "recipient_closed"): void {
    const r = this.receipt(id);
    if (!r || r.state !== "pending") return;
    this.ctx.storage.sql.exec(
      "update receipts set state = 'expired', reason = ? where id = ? and state = 'pending'",
      reason ?? null, id,
    );
    this.ctx.storage.sql.exec("delete from mail where id = ?", id);
    this.held.delete(id);
    this.notifySender(r, "expired", reason);
  }

  /** Mail stored for an offline machine goes out as soon as its agent is live again. */
  private flushQueued(agent: AgentRow): void {
    const rows = this.all<ReceiptRow>(
      `select ${RECEIPT_COLS} from receipts where to_agent = ? and state = 'pending' order by created_at limit 50`,
      agent.id,
    );
    for (const r of rows) {
      const body = this.bodyOf(r.id);
      // No body left (in-memory mail lost to an eviction): never pretend delivered.
      if (body === null) {
        this.expire(r.id);
        continue;
      }
      this.deliverTo(agent, r, body);
    }
  }

  /**
   * One alarm serves TTL expiry and the ack deadline. A held body past its
   * deadline is persisted so a reconnect can redeliver it.
   */
  override async alarm(): Promise<void> {
    const now = this.now();
    let next: number | null = null;
    for (const [id, h] of [...this.held]) {
      if (now >= h.deadline) {
        const r = this.receipt(id);
        if (r && r.state === "pending") this.persistBody(r, h.body);
        this.held.delete(id);
      } else {
        next = next === null ? h.deadline : Math.min(next, h.deadline);
      }
    }
    const due = this.all<{ id: string }>(
      "select id from receipts where state = 'pending' and expires_at <= ? limit 200",
      now,
    );
    for (const r of due) this.expire(r.id);
    const soonest = this.one<{ t: number | null }>(
      "select min(expires_at) as t from receipts where state = 'pending'",
    );
    if (soonest?.t != null) next = next === null ? soonest.t : Math.min(next, soonest.t);

    // Housekeeping: closed agents and consumed device codes are noise after a day.
    this.ctx.storage.sql.exec("delete from agents where live = 0 and updated_at < ?", now - 86_400_000);
    this.ctx.storage.sql.exec("delete from device_codes where expires_at < ?", now - 86_400_000);

    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  /** Tests only: run the alarm body without waiting for the scheduler. */
  async runAlarmForTest(): Promise<void> {
    await this.alarm();
  }
```

Finally reconnect the two hooks B5 left out:

```ts
    // agentUp, just before the return:
    this.flushQueued(this.agentForRef(machineId, frame.agent_ref)!);
    // closeAgent, after the update:
    this.expireAllPending(agent.id, "recipient_closed");
```

- [ ] **Step 4: Make the queued path arm the alarm**

In `deliverTo`, the offline branch must also arm expiry. Change the first lines to:

```ts
    const socket = this.ctx.getWebSockets(`m:${target.machineId}`)[0];
    if (!socket || target.live !== 1) {
      this.persistBody(receipt, body);
      this.arm(receipt.expiresAt);
      return;
    }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ob/server test -- test/hub.reconnect.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(hub): TTL expiry, ack timeout and reconnect flush"
```

---

### Task B8: `list`, `fetch`, namespaces and globals

**Files:**
- Modify: `hub/do.ts`
- Test: `apps/server/test/hub.namespace.matrix.test.ts`

- [ ] **Step 1: Write the failing matrix test**

```ts
import { describe, expect, it } from "vitest";
import { daemon, machine, waitFor } from "./helpers.js";

const up = (id: string, ref: string, name: string, ns: string, global = false) => ({
  v: 1, id, type: "agent_up", agent_ref: ref, kind: "opencode",
  proposed_name: name, namespace: ns, global,
}) as const;
const hello = (id: string) => ({ v: 1, id, type: "hello", machine_label: "m", client_version: "0.1.0" }) as const;

async function connected(label: string) {
  const m = await machine(label);
  const d = await daemon(m.token);
  d.send(hello("h")); await waitFor(d, "hello_ok");
  return d;
}

describe("namespaces", () => {
  it("keeps namespaces invisible to each other", async () => {
    const a = await connected("A");
    a.send(up("u1", "refA", "Alpha", "ns1")); await waitFor(a, "agent_ok");
    a.send(up("u2", "refB", "Beta", "ns2")); await waitFor(a, "agent_ok");

    a.send({ v: 1, id: "l1", type: "list", from_ref: "refA" });
    const roster = await waitFor(a, "roster");
    expect(roster.agents.map((x) => x.bus_name)).toEqual(["Alpha"]);

    a.send({ v: 1, id: "s1", type: "send", from_ref: "refA", to_name: "Beta", body: "x" });
    // B8 ruling: other namespaces are "invisible and unreachable" (spec goal 5,
    // scenario 6), so this is unknown_agent; other_namespace is only for an
    // explicit to_namespace.
    expect(await waitFor(a, "receipt")).toMatchObject({ state: "refused", reason: "unknown_agent" });
    a.close();
  });

  it("lets a global agent see and reach every namespace, and be reached", async () => {
    const a = await connected("A");
    a.send(up("u1", "refA", "Alpha", "ns1")); await waitFor(a, "agent_ok");
    a.send(up("u2", "refG", "Glob", "ns2", true)); await waitFor(a, "agent_ok");

    a.send({ v: 1, id: "l1", type: "list", from_ref: "refG" });
    expect((await waitFor(a, "roster")).agents.map((x) => x.bus_name).sort()).toEqual(["Alpha", "Glob"]);

    a.send({ v: 1, id: "s1", type: "send", from_ref: "refG", to_name: "Alpha", body: "hi" });
    expect((await waitFor(a, "receipt")).state).toBe("pending");

    // Any agent can reach a global one.
    a.send({ v: 1, id: "s2", type: "send", from_ref: "refA", to_name: "Glob", body: "yo" });
    expect((await waitFor(a, "receipt")).state).toBe("pending");

    a.send({ v: 1, id: "l2", type: "list", from_ref: "refA" });
    expect((await waitFor(a, "roster")).agents.map((x) => x.bus_name).sort()).toEqual(["Alpha", "Glob"]);
    a.close();
  });

  it("lets the recipient fetch and refuses everyone else", async () => {
    const m = await machine();
    const d = await daemon(m.token);
    d.send(hello("h")); await waitFor(d, "hello_ok");
    d.send(up("u1", "a", "A", "ns")); await waitFor(d, "agent_ok");
    d.send(up("u2", "b", "B", "ns")); await waitFor(d, "agent_ok");
    d.send({ v: 1, id: "s1", type: "send", from_ref: "a", to_name: "B", body: "secret" });
    await waitFor(d, "receipt");
    const deliver = await waitFor(d, "deliver");

    // The sender may not read the recipient's mail.
    d.send({ v: 1, id: "f1", type: "fetch", from_ref: "a", msg_id: deliver.msg_id });
    expect((await waitFor(d, "error")).code).toBe("not_found");

    // The recipient may, and the fetch closes the receipt.
    d.send({ v: 1, id: "f2", type: "fetch", from_ref: "b", msg_id: deliver.msg_id });
    expect(await waitFor(d, "body")).toMatchObject({ msg_id: deliver.msg_id, body: "secret" });

    // Once delivered, a second fetch finds nothing.
    d.send({ v: 1, id: "f3", type: "fetch", from_ref: "b", msg_id: deliver.msg_id });
    expect((await waitFor(d, "error")).code).toBe("not_found");
    d.close();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/hub.namespace.matrix.test.ts`
Expected: FAIL — `fetch` unhandled, roster lists both namespaces.

- [ ] **Step 3: Implement `fetch` and tighten `list`**

In `webSocketMessage`, replace:

```ts
      case "fetch":
        return this.reject(ws, frame.id, "not_found", "No such message");
```

with:

```ts
      case "fetch":
        return this.handleFetch(ws, frame, machineId);
```

`listFor` already scopes by namespace and global (B5). Add (import `FetchFrame` from `@ob/shared`):

```ts
  /** The recipient fetches a notice; the body leaves storage on the way out. */
  private handleFetch(ws: WebSocket, frame: FetchFrame, machineId: string): void {
    const agent = this.agentForRef(machineId, frame.from_ref);
    if (!agent)
      return this.reject(ws, frame.id, "not_registered", "from_ref is not registered on this socket");
    const r = this.receipt(frame.msg_id);
    if (!r || r.toAgent !== agent.id || r.state !== "pending")
      return this.reject(ws, frame.id, "not_found", "No such message");
    const body = this.bodyOf(frame.msg_id);
    if (body === null) {
      this.expire(frame.msg_id);
      return this.reject(ws, frame.id, "not_found", "No such message");
    }
    this.send(ws, { v: 1, id: frame.id, type: "body", msg_id: frame.msg_id, body });
    this.markDelivered(r);
  }
```

Import `FetchFrame`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @ob/server test -- test/hub.namespace.matrix.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(hub): fetch by id, namespace isolation and global agents"
```

---

### Task B9: Revoke a machine

**Files:**
- Modify: `hub/do.ts`, `hub/stub.ts`, `routes/machines.ts`, `routes/index.ts`
- Test: `apps/server/test/revoke.test.ts`

- [ ] **Step 1: Write the failing revoke test**

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { daemon, machine, session, waitFor } from "./helpers.js";
import { hub } from "../src/hub/stub.js";

const up = (id: string, ref: string, name: string) => ({
  v: 1, id, type: "agent_up", agent_ref: ref, kind: "opencode",
  proposed_name: name, namespace: "ns", global: false,
}) as const;

describe("revoke", () => {
  it("closes with 4403, drops agents, refuses reconnects and mail", async () => {
    const victimM = await machine("Victim");
    const senderM = await machine("Sender");
    const victim = await daemon(victimM.token);
    victim.send({ v: 1, id: "h", type: "hello", machine_label: "Victim", client_version: "0.1.0" });
    await waitFor(victim, "hello_ok");
    victim.send(up("u1", "vref", "Victim Agent")); await waitFor(victim, "agent_ok");

    const sender = await daemon(senderM.token);
    sender.send({ v: 1, id: "h", type: "hello", machine_label: "Sender", client_version: "0.1.0" });
    await waitFor(sender, "hello_ok");
    sender.send(up("u2", "sref", "Sender Agent")); await waitFor(sender, "agent_ok");

    const closed = new Promise<number>((resolve) => victim.ws.addEventListener("close", (e) => resolve(e.code)));
    const res = await SELF.fetch(`https://app.localhost/api/v1/machines/${victimM.id}`, {
      method: "DELETE",
      headers: { cookie: await session(), "X-OB-Request": "1" },
    });
    expect(res.status).toBe(204);
    expect(await closed).toBe(4403);

    // Its agents left the roster.
    sender.send({ v: 1, id: "l1", type: "list", from_ref: "sref" });
    expect((await waitFor(sender, "roster")).agents.map((a) => a.bus_name)).toEqual(["Sender Agent"]);

    // Sends to the revoked agent are refused with `revoked`.
    sender.send({ v: 1, id: "s1", type: "send", from_ref: "sref", to_name: "Victim Agent", body: "x" });
    expect(await waitFor(sender, "receipt")).toMatchObject({ state: "refused", reason: "revoked" });

    // Reconnect is refused at the Worker.
    const again = await SELF.fetch("https://app.localhost/hub", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${victimM.token}` },
    });
    expect(again.status).toBe(401);
    sender.close();
  });

  it("404s an unknown machine", async () => {
    const res = await SELF.fetch("https://app.localhost/api/v1/machines/aaaaaaaaaaaaaaaa", {
      method: "DELETE",
      headers: { cookie: await session(), "X-OB-Request": "1" },
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/revoke.test.ts`
Expected: FAIL — 404 on `/api/v1/machines/:id` (no handler).

- [ ] **Step 3: Implement `revokeMachine` and the `revoked` refusal**

Add to `Hub`:

```ts
  // ------------------------------------------------------------ revoke

  async revokeMachine(id: string): Promise<boolean> {
    const now = this.now();
    const res = this.ctx.storage.sql.exec(
      "update machines set revoked_at = ? where id = ? and org_id = ? and revoked_at is null",
      now, id, OWNER_ORG_ID,
    );
    if (res.rowsWritten === 0) return false;

    for (const ws of this.ctx.getWebSockets(`m:${id}`))
      this.closeWith(ws, LIMITS.revokeCloseCode, "machine revoked");

    const agents = this.all<{ id: string; namespace: string }>(
      "select id, namespace from agents where machine_id = ? and live = 1",
      id,
    );
    for (const a of agents) this.expireAllPending(a.id, "recipient_closed");
    this.ctx.storage.sql.exec(
      "update agents set live = 0, last_name = name, updated_at = ? where machine_id = ? and live = 1",
      now, id,
    );
    this.notifyRoster([...new Set(agents.map((a) => a.namespace))]);
    this.notifyMachines();
    return true;
  }
```

`resolveTarget` must say `revoked` when the name belongs to an agent whose machine is revoked. Insert after the live lookups:

```ts
    const dead = this.one<{ x: number }>(
      `select 1 as x from agents a join machines m on m.id = a.machine_id
        where a.org_id = ? and a.name = ? and m.revoked_at is not null limit 1`,
      OWNER_ORG_ID, name,
    );
    if (dead) return { kind: "refused", reason: "revoked" };
```

and place it before the `closed` check, since a revoked agent is also not live.

- [ ] **Step 4: Add the REST routes**

`apps/server/src/hub/dto.ts` (agent DTO joins in B10):

```ts
import type { Machine } from "@ob/shared";
import type { MachineRow } from "./rows.js";

const iso = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();

/** Epoch-ms rows to the FE's ISO DTO; `revokedAt` is null: revoked rows are never listed. */
export const machineDto = (r: MachineRow): Machine => ({
  id: r.id,
  label: r.label,
  createdAt: iso(r.createdAt) as string,
  lastUsed: iso(r.lastUsedAt),
  revokedAt: iso(r.revokedAt),
});
```

`apps/server/src/routes/machines.ts`:

```ts
import { MachinesResponseSchema, R } from "@ob/shared";
import { ApiError } from "../http/errors.js";
import { machineDto } from "../hub/dto.js";
import { hub } from "../hub/stub.js";
import type { AppType } from "./types.js";

export function mountMachines(app: AppType): void {
  app.get(R.machines, async (c) => {
    const machines = (await hub(c.env).listMachines()).map(machineDto);
    return c.json(MachinesResponseSchema.parse({ machines }));
  });

  // 204 on the first revoke; unknown and already-revoked are both 404.
  app.delete("/api/v1/machines/:id", async (c) => {
    if (!(await hub(c.env).revokeMachine(c.req.param("id"))))
      throw new ApiError("not_found", "Not found");
    return c.body(null, 204);
  });
}
```

`MachinesResponseSchema.parse` is the runtime assertion at the boundary; the DTO is the only place epoch ms becomes ISO. Add `mountMachines(app);` to `mountRoutes`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ob/server test -- test/revoke.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(hub): revoke a machine, close 4403, refuse revoked mail"
```

---

### Task B10: `/api/v1/me`, `/api/v1/agents`, dashboard events (WebSocket, was SSE)

> **Superseded in part by the B10-ws manager ruling (2026-10-24): the dashboard's live feed is a hibernatable WebSocket, not SSE.** Reasons: WebSocket Hibernation lets the hub sleep while a dashboard idles, and an SSE pipe would keep a Worker invocation (and its CPU) open against the 10 ms CPU limit on Workers Free. Pinned values (Frontend builds against them; source of truth is `packages/shared/CONTRACT.md`, "Dashboard feed"):
> 1. `GET /api/v1/events` with `Upgrade: websocket` is the Worker route (Frontend writes it); anything else is 426.
> 2. The Worker checks the session and `Origin`, then forwards with `hubFetch(env, EVENTS_DO_PATH, { headers })` (`EVENTS_DO_PATH = "/events"`): a fresh request carrying only `Upgrade: websocket`, `x-ob-session-exp` (`SESSION_EXP_HEADER`, the session's expiry in epoch ms) and `x-ob-session-gen` (`SESSION_GEN_HEADER`, the session's generation), each set (overwritten) from the verified session, never copied from the client. The hub 400s `/events`, creating no socket, when the expiry is not a decimal of at most 16 digits, is past, or is beyond now + `MAX_AGE_S` + 1 min, or the generation is missing, malformed or not current (fix round 1: M1, M2).
> 3. One JSON text frame per `BusEvent`: `hello`, `machines`, `agents` on connect; a full `machines` and a full `agents` frame on every change (throttled, 500 ms trailing).
> 4. Close codes: 1013 evicted by the cap (16 per hub; non-open first, then oldest); 1011 a send failed; 4401 (`LIMITS.dashboardSessionClose`) the session ended: `bumpSessionGeneration()` closes every dashboard socket with 4401, and each socket closes with 4401 at its stored `x-ob-session-exp` (the multiplexed alarm is armed for the earliest; pushes check it too).
> 5. Client frames: only the auto-response `"ping"` -> `"pong"` (set in the hub constructor, so it applies to every socket); anything else is ignored, never decoded as a daemon frame. Dashboard sockets are tagged `dashboard` and never receive bus frames.
> The SSE bridge code below (`routes/events.ts` piping the observer socket into a `TransformStream`) is historical; do not build it.

**Files:**
- Create: `routes/me.ts`, `routes/agents.ts`, `routes/events.ts`, `hub/dto.ts`
- Modify: `hub/do.ts`, `routes/index.ts`
- Test: `apps/server/test/events.test.ts`

- [ ] **Step 1: Write the failing REST/SSE test**

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { daemon, machine, session, waitFor } from "./helpers.js";

const hello = (id: string) => ({ v: 1, id, type: "hello", machine_label: "m", client_version: "0.1.0" }) as const;

describe("dashboard API", () => {
  it("serves me and the roster", async () => {
    const m = await machine("Studio");
    const d = await daemon(m.token);
    d.send(hello("h")); await waitFor(d, "hello_ok");
    d.send({ v: 1, id: "u1", type: "agent_up", agent_ref: "r1", kind: "pi", proposed_name: "Pi", namespace: "github.com/a/b", global: false });
    await waitFor(d, "agent_ok");

    const cookie = await session();
    const me = await (await SELF.fetch("https://app.localhost/api/v1/me", { headers: { cookie } })).json();
    expect(me).toEqual({ user: { id: "owner", email: "owner@example.com", name: null } });

    const machines = await (await SELF.fetch("https://app.localhost/api/v1/machines", { headers: { cookie } })).json();
    expect(machines.machines.find((x: { id: string }) => x.id === m.id))
      .toMatchObject({ label: "Studio", lastUsed: null, revokedAt: null });

    const agents = await (await SELF.fetch("https://app.localhost/api/v1/agents?namespace=github.com/a/b", { headers: { cookie } })).json();
    expect(agents.agents).toHaveLength(1);
    expect(agents.agents[0]).toMatchObject({ name: "Pi", kind: "pi", live: true, machineLabel: "Studio" });
    d.close();
  });

  it("opens the stream with hello, then full snapshots", async () => {
    const cookie = await session();
    const res = await SELF.fetch("https://app.localhost/api/v1/events", {
      headers: { cookie, accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const chunk = async () => dec.decode((await reader.read()).value);
    const hello = await chunk();
    const agents = await chunk();
    const machines = await chunk();
    expect(hello).toContain("event: hello");
    expect(hello).toContain('"type":"hello"');
    expect(agents).toContain("event: agents");
    expect(agents).toContain('"agents":[');
    expect(machines).toContain("event: machines");
    expect(machines).toContain('"machines":[');
    await reader.cancel();
  });

  it("rejects a cross-site SSE request", async () => {
    const r = await SELF.fetch("https://app.localhost/api/v1/events", {
      headers: { cookie: await session(), origin: "https://evil.test" },
    });
    expect(r.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/server test -- test/events.test.ts`
Expected: FAIL — `/api/v1/me` has no handler.

- [ ] **Step 3: Write the DTO builders and observers**

Append to `apps/server/src/hub/dto.ts` (created in B9; keep its `iso` helper):

```ts
import type { Agent } from "@ob/shared";
import type { AgentRow } from "./rows.js";

export type AgentWithMachine = AgentRow & { machineLabel: string };

export const agentDto = (a: AgentWithMachine): Agent => ({
  id: a.id,
  namespace: a.namespace,
  name: a.name,
  kind: a.kind as Agent["kind"],
  machineId: a.machineId,
  machineLabel: a.machineLabel,
  global: a.global === 1,
  live: a.live === 1,
  updatedAt: iso(a.updatedAt) as string,
});
```

Add to `Hub`:

```ts
  // ------------------------------------------------------------ observers

  private async acceptObserver(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected WebSocket upgrade", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["observer"]);
    pair[1].serializeAttachment({ machineId: "" });
    // hello tells the dashboard to refetch; the two snapshots seed the caches.
    pair[1].send(JSON.stringify({ type: "hello" }));
    pair[1].send(JSON.stringify({ type: "agents", agents: await this.agentList() }));
    pair[1].send(JSON.stringify({ type: "machines", machines: await this.machineList() }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private notifyObservers(): void {
    const sockets = this.ctx.getWebSockets("observer");
    if (sockets.length === 0) return;
    // The observer feed is awaited once per change; it is small and bounded.
    void this.pushObservers();
  }

  private async pushObservers(): Promise<void> {
    const payloads = [
      JSON.stringify({ type: "agents", agents: await this.agentList() }),
      JSON.stringify({ type: "machines", machines: await this.machineList() }),
    ];
    for (const ws of this.ctx.getWebSockets("observer"))
      for (const p of payloads)
        try {
          ws.send(p);
        } catch {
          // closing socket
        }
  }

  private async agentList(): Promise<Agent[]> {
    const rows = this.all<AgentWithMachine>(
      `select a.id, a.namespace, a.name, a.last_name as lastName, a.kind, a.machine_id as machineId,
              a.native_ref as nativeRef, a.global, a.live, a.updated_at as updatedAt, m.label as machineLabel
         from agents a join machines m on m.id = a.machine_id
        where a.org_id = ? and a.live = 1
        order by a.namespace, a.name limit 200`,
      OWNER_ORG_ID,
    );
    return rows.map(agentDto);
  }

  async listAgents(namespace?: string): Promise<Agent[]> {
    const all = await this.agentList();
    return namespace ? all.filter((a) => a.namespace === namespace || a.global) : all;
  }

  async machineList(): Promise<Machine[]> {
    return (await this.listMachines()).map(machineDto);
  }

  /** Called when a daemon connects, disconnects, registers or is revoked. */
  notifyMachines(): void {
    this.notifyObservers();
  }
```

Replace the no-op `notifyMachines` added in B4 with this one, and add
`this.notifyObservers();` as the last line of `notifyRoster`. Imports for this task:
`type { Agent, Machine }` from `@ob/shared`, and `type AgentWithMachine` plus `agentDto`
from `../hub/dto.js` (`machineDto` came in B9).

`notifyMachines` is referenced by B4/B5; it now exists.

- [ ] **Step 4: Write the REST and SSE routes**

`apps/server/src/routes/me.ts`:

```ts
import { MeSchema, R } from "@ob/shared";
import { OWNER_UID } from "../auth/session.js";
import type { AppType } from "./types.js";

export function mountMe(app: AppType): void {
  app.get(R.me, (c) =>
    c.json(MeSchema.parse({
      user: { id: OWNER_UID, email: c.env.OWNER_EMAIL.toLowerCase(), name: null },
    })),
  );
}
```

`apps/server/src/routes/agents.ts`:

```ts
import { AgentsResponseSchema, AgentListQuerySchema, R } from "@ob/shared";
import { hub } from "../hub/stub.js";
import type { AppType } from "./types.js";

export function mountAgents(app: AppType): void {
  app.get(R.agents, async (c) => {
    const q = AgentListQuerySchema.parse({ namespace: c.req.query("namespace") || undefined });
    return c.json(AgentsResponseSchema.parse({ agents: await hub(c.env).listAgents(q.namespace) }));
  });
}
```

`apps/server/src/routes/events.ts`:

```ts
import { BusEventSchema, R } from "@ob/shared";
import { ApiError } from "../http/errors.js";
import { hubFetch } from "../hub/stub.js";
import type { AppType } from "./types.js";

/**
 * SSE is a Worker-side pipe over the hub's observer socket: the hub never
 * holds a timer, and the dashboard gets push, not polling.
 */
export function mountEvents(app: AppType): void {
  app.get(R.events, async (c) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== new URL(c.req.url).origin)
      throw new ApiError("csrf", "Cross-site request");

    const res = await hubFetch(c.env, "/events", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    if (!ws) throw new ApiError("internal", "Hub did not upgrade");
    ws.accept();

    const enc = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let closed = false;
    const write = (chunk: string) => {
      if (closed) return;
      try {
        void writer.write(enc.encode(chunk)).catch(() => {
          closed = true;
        });
      } catch {
        closed = true;
      }
    };
    ws.addEventListener("message", (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const parsed = BusEventSchema.safeParse(raw);
      if (!parsed.success) return;
      write(`event: ${parsed.data.type}\ndata: ${JSON.stringify(parsed.data)}\n\n`);
    });
    ws.addEventListener("close", () => {
      closed = true;
      void writer.close().catch(() => {});
    });

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });
}
```

The `try` around `JSON.parse` is load-bearing: a malformed hub payload must never throw out of a listener.

Mount all: `mountMe(app); mountAgents(app); mountMachines(app); mountEvents(app);`

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ob/server test -- test/events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): me, live roster and machines over REST and SSE"
```

---

### Task B11: Hardening — limits, logging, socket caps

**Files:**
- Modify: `routes/device.ts`, `routes/hub.ts`, `hub/do.ts`, `util/log.ts`, `wrangler.jsonc`
- Test: extend `test/device.test.ts`

- [ ] **Step 1: Write `wrangler.jsonc`**

```jsonc
{
  "name": "open-bus",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "../../apps/dashboard/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true
  },
  "durable_objects": { "bindings": [{ "name": "HUB", "class_name": "Hub" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Hub"] }],
  "ratelimits": [
    { "name": "RL_DEVICE", "namespace_id": "2001", "simple": { "limit": 20, "period": 60 } }
  ],
  "vars": {
    "ENVIRONMENT": "production",
    "OWNER_EMAIL": "{{OWNER_EMAIL}}",
    "ACCESS_TEAM_DOMAIN": "{{ACCESS_TEAM_DOMAIN}}",
    "ACCESS_CLIENT_ID": "{{ACCESS_CLIENT_ID}}"
    // APP_HOST is written by deploy-staging (F4): the workers.dev subdomain is
    // account-specific and cannot be known here. VERSION likewise.
  },
  "observability": { "enabled": true }
}
```

Add `RL_DEVICE` to `wrangler.test.jsonc` only if the plugin accepts `ratelimits` locally; otherwise leave it unbound (the handler already tolerates that in dev).

- [ ] **Step 2: Structured, secret-free logging**

`apps/server/src/util/log.ts`:

```ts
/** One JSON line per event. Never tokens, codes, bodies, emails or secrets. */
export function logEvent(evt: string, fields: Record<string, string | number | boolean | null> = {}): void {
  console.log(JSON.stringify({ evt, ...fields }));
}

export function logError(evt: string, err: unknown): void {
  const message = err instanceof Error ? err.message.slice(0, 200) : "unknown";
  console.error(JSON.stringify({ evt, message }));
}
```

Use it in: `oidc_fail` (already logged by the copied code), `device_code`, `device_approved`, `machine_revoked`, `hub_reject` (code only). Add `logEvent("machine_revoked", { machineId: id })` in `revokeMachine`, and `logEvent("hub_reject", { code, machine: machineId })` in `reject`.

- [ ] **Step 3: Cap per-socket abuse**

In `webSocketMessage`, before `decodeFrame`, add a per-socket budget kept in the attachment:

```ts
    const meta = (ws.deserializeAttachment() as { machineId: string; count?: number; window?: number }) ?? { machineId: "" };
    const now = this.now();
    const window = meta.window && now - meta.window < 1000 ? meta.window : now;
    const count = window === meta.window ? (meta.count ?? 0) + 1 : 1;
    if (count > 50) return this.closeWith(ws, LIMITS.protocolCloseCode, "rate limited");
    ws.serializeAttachment({ ...meta, count, window });
```

This also means the machineId read later must come from `meta`.

- [ ] **Step 4: Test the device limiter is bypassable only in dev**

Extend `device.test.ts`:

```ts
  it("still answers /healthz and /device/code without a limiter in dev", async () => {
    const r = await post("/device/code", {});
    expect(r.status).toBe(201);
  });
```

- [ ] **Step 5: Run the whole suite and commit**

Run: `pnpm --filter @ob/server test && pnpm --filter @ob/server typecheck && pnpm lint`
Expected: all green.

```bash
git add apps/server
git commit -m "feat(server): device rate limit, structured logs and per-socket budget"
```

---

### Task B12: Pinned suite, opt-in CPU guard, quiet-runner perf job

**Files (shipped):**
- Create: `apps/server/test/cpu.test.ts`, `.github/workflows/perf.yml`, `apps/server/scripts/test-pinned.mjs`
- Modify: `apps/server/package.json` (`test:pinned`), `apps/server/vitest.config.ts` (forwards `OB_PERF` into workerd), `scripts/ci/workflows.test.ts` (pins perf.yml's triggers)
- Pinned files: `hub.from_ref`, `hub.namespace.matrix`, `hub.expiry` (was `hub.reconnect`), `hub.revoke` (was `revoke`), `hub.b11`, `hub.b11.adv`, `hub.events`. The device smoke step is B4's and is not part of B12.

> **Required (manager, after #54):** the quiet-runner job runs `@ob/shared`'s opt-in decode-timing test, `OB_PERF=1 pnpm --filter @ob/shared exec vitest run src/protocol.test.ts -t "decode fast"`, next to the hub CPU guard. Wall-clock timing flakes on shared CI runners, so neither runs in the PR gate.

- **CPU guard (`test/cpu.test.ts`).** Opt-in: the whole `describe` is `skipIf(!OB_PERF)`; run it with `OB_PERF=1 pnpm --filter @ob/server exec vitest run test/cpu.test.ts`. It measures the warm, median-of-N wall-clock round trip through a real hub socket for: `send` at 1 KiB and at the 32 KiB inline max, `agent_up`, `sessions{closed}` with 1000 refs (200 live, 10,000 pending), a close with 500k delivered receipts in history, a dashboard push at the caps (100 machines, 1000 agents), one alarm step with a full `SWEEP_BATCH`, and `fetch` of a 1 MiB body. Each path has a named budget constant (measured median x2 to 3); a breach fails with the path name, and a table of medians prints at the end.
- **Perf workflow (`.github/workflows/perf.yml`).** `schedule` (daily) and `workflow_dispatch` only, one job, concurrency 1; never `pull_request` or `merge_group`. It runs the two commands above.
- **Pinned suite (`pnpm --filter @ob/server test:pinned`).** Runs the pinned files one at a time, in sequence, and reports every failure at the end. For the release check; the PR gate already runs these files inside `pnpm test`.
- **Machine-load rule.** Run one file at a time, and calibrate budgets only when the 1-minute load average is under 15.

Measured medians (ms, load average 11-14, three runs; `performance.now()` ticks in whole ms in workerd):

| path | median | budget |
| --- | --- | --- |
| hello baseline | 1-3 | 8 |
| send 1 KiB | 3-4 | 10 |
| send 32 KiB | 3-4 | 10 |
| agent_up | 2 | 6 |
| sessions{closed} 1000 refs | 7-11 | 25 |
| close, 500k delivered | 2-3 | 8 |
| dashboard push (100 machines, 1000 agents) | 8-9 | 22 |
| alarm, full SWEEP_BATCH | 3 | 9 |
| fetch 1 MiB | 3-6 | 15 |

Staging smoke (`/healthz` version, `/device/code`) belongs to Platform's deploy pipeline (B4/F4), not B12.

---

## Self-review

- **Spec coverage:** login + device approval (B1, B4), machine tokens hashed (B3, B4), hub per owner with roster/presence (B3, B5), namespaces and globals (B5, B8), mail with inline cap/notice/fetch/hard max/expiry/inbox cap (B6, B7, B8), receipts and write-on-miss (B6), reconnect (B7), revoke 4403 (B9), REST + dashboard WebSocket feed (B10, B10-ws), Workers Free constraints (B11 enforces, B12 guards: opt-in CPU test + scheduled perf workflow), `/healthz` version (B2, B12). Scenarios 3–6 of the spec's verification map to these tests; 1–2 and 7 are the Client/Integration tracks.
- **Deviations to flag to the manager (not silent):** the overview's pinned data model lists three tables; the hub also needs `receipts` (the durable receipt spine, without it an eviction could lose a send silently) and `device_codes` (the Worker has no KV, so the flow must live in the hub). Both are first-class under "all state lives in the hub's SQLite". `refuse` is the client track's requested addition (05-client.md), pinned in F2: `detail` is `denied|refused|expired|dropped` and `held` is deliberately excluded. Also `deliver` and `receipt_update` reasons use the wording `recipient_closed`, and `list` for a global agent includes every live agent.
- **Type consistency:** `HubStub` is extended in the same task as each new public method; the Worker only ever touches `HubStub`, never the class. `hubFetch` is the only path to the hub's `/hub` and `/events`; it builds a fresh request, and the `/events` forward sets only `Upgrade`, `x-ob-session-exp` and `x-ob-session-gen` (never the client's headers). Row types come from `hub/rows.ts`, DTOs from `hub/dto.ts`; `MachineSchema.parse` guards the boundary.
- **Known limits:** the in-memory held body is an optimization; after a hibernation eviction an unacked message surfaces as `expired`, never `delivered` (matches Review Focus 3). The dashboard feed is a WebSocket (B10-ws ruling): keepalive is the auto-answered `ping`/`pong`; after 1013/1011 the dashboard reconnects, after 4401 it signs in again.

---

# Agent card, backend half (AC1–AC4): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-assigned roles, self-reported status and a signed agent card to the hub and Worker. OA verifies the card offline against the bus's JWKS.

**Architecture:** Each feature gets its own module beside `hub/do.ts`: `hub/roles.ts`, `hub/status.ts`, `hub/card.ts`, `card/keys.ts`, `routes/{roles,linked-apps,link,jwks}.ts`. `do.ts` only calls into them, because it is already 3.7k lines. Every new server-to-daemon field and frame is gated on `semverGte(clientVersion, AGENT_CARD_MIN_CLIENT)`, which reuses the attachment-held `clientVersion` that the kind gate already uses. The hub DO signs cards and the Worker signs link assertions, both with one shared key loader.

**Tech Stack:**
- Cloudflare Workers and a Durable Object with SQLite.
- Hono; zod 4.
- jose 6 (EdDSA/Ed25519 via workerd WebCrypto).
- vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-29-agent-card-design.md`. Platform's key contract (I11, `06-integration.md` on `in/ac4-ops-plan`) binds the secret formats.

## Global Constraints

- Strict wire decoders: below `AGENT_CARD_MIN_CLIENT`, a daemon never receives `role`, `status*`, receipt `to_name`, `role_vacant`, `card` or `card_refused`. In their place it gets `unknown_agent`.
- `AGENT_CARD_MIN_CLIENT = "0.54.0"`. This is predicted: npm's latest is 0.53.0. Test that `semverGte("0.53.0", gate) === false`, and that the gate is ≤ Client's first release decoding the fields. Re-check it against the real tag before Client publishes.
- Status `state` is one of `working | idle | blocked | waiting_on_owner`. `label` is at most `LIMITS.maxLabelChars` (64) characters, cleaned the way `newMachineLabel` cleans a label.
- Status rate limit: the first update in a 5 s window applies at once, and the last coalesced update applies when the window closes, from the DO alarm.
- Card requests: at most 6 per agent per minute. `nonce` and link `state` both match `^[A-Za-z0-9_-]{16,128}$`.
- JWS: `alg: EdDSA`, `kid` required. `typ` is `ob-card+jwt` for a card and `ob-link+jwt` for a link assertion. Both have `exp = iat + 300`, and `jti` is 128 random bits, base64url.
- Card claims: `iss, aud, sub, owner, nonce, iat, exp, jti, name, role?, kind, machine, agent_says?`. Never include email, namespace or machine id.
- `owner = base64url(HMAC-SHA256(CARD_OWNER_SALT, "owner\n" + aud))`.
- Secrets (Platform I11):
  - `CARD_SIGNING_KEY`: a private OKP Ed25519 JWK with `kid` and `alg`.
  - `CARD_SIGNING_KEY_PREV`: a public JWK, optional.
  - `CARD_OWNER_SALT`.
  - When any of them is absent, the card, link and JWKS routes answer 503 and the hub refuses `card_request` with `error internal`.
- If `CARD_SIGNING_KEY.x === TEST_CARD_KEY_X` outside `ENVIRONMENT=dev`, the loader refuses: 503 or `internal`, and nothing is ever signed.
- JWKS response: `Cache-Control: public, max-age=3600`, listing the current public key first, then PREV.
- Roles and linked-apps REST are owner session routes in `ROUTE_POLICY`. Unsafe methods use the header CSRF rule. Machine tokens never reach them.
- `/link`: `aud` is an exact lowercased https origin. `redirect_uri` is https, on `aud`'s origin, has no fragment, and is ≤512 characters. The `ob_link` cookie lives 10 min and is HttpOnly. The assertion travels only in the redirect fragment and is never logged.
- PRs are about 400 lines or less. AC2a and every AC4 PR get an adversarial review. Give the manager a heads-up before merging anything in `packages/shared`.

## Review Focus

1. **A holder closes and the same session reopens** (the same machine and `native_ref` reuse the agent id): the role must stay vacant. Test this in Task 3.
2. **A role name differing only in case from an open agent's name**, and an agent proposing a name equal to a role (in any case): the role is refused or the name gets a suffix. Test this in Task 3.
3. **A frozen 0.53.0 roster/receipt/error decoder on a hub with roles, status and a vacant role**: it must keep decoding. Test this in Tasks 3 and 5, in the `hub.compat-v0.44.test.ts` style, with a 0.53-shaped strict decoder.
4. **`/link` with `aud` shaped as `HTTPS://X`, `https://x/`, `https://x:443`, `https://u@x`, `http://x`, or a `redirect_uri` with userinfo or on a different port**: each is refused or normalized exactly as specified. The confirm page's CSP `form-action` must allow `aud`, because browsers apply `form-action` to the post-submit redirect. Test this in Task 9.
5. **A status burst that spans a DO eviction**, or an agent that closes while an update is pending: the pending update survives in SQLite, and a close clears both the applied and the pending status. Test this in Task 5.

---

### Task 1 (AC1): Shared schemas and the gate

**Files:**
- Create `packages/shared/src/card.ts` and `packages/shared/src/card.test.ts`.
- Create `packages/shared/src/mocks/card.ts` and `packages/shared/src/mocks/card.test.ts`.
- Modify:
  - `packages/shared/src/protocol.ts`: frames, roster row, error codes.
  - `packages/shared/src/receipts.ts`: `role_vacant`, `to_name`.
  - `packages/shared/src/rest.ts`: `AgentSchema` status, roles and linked-apps schemas, `R`.
  - `packages/shared/src/index.ts` and `mocks/index.ts`: exports.
  - `packages/shared/package.json`: `jose` as a dependency, used only by mocks.
  - `packages/shared/CONTRACT.md` and `contract.test.ts`.

**Interfaces (produces):**
- From `card.ts`:
  - `AGENT_CARD_MIN_CLIENT = "0.54.0"`
  - `STATUS_STATES` and `StatusStateSchema`
  - `StatusLabelSchema`: `MachineLabelSchema` rules, ≤64; `AgentStatusSchema {state, label?}`
  - `NonceSchema`
  - `CARD_TYP = "ob-card+jwt"`, `LINK_TYP = "ob-link+jwt"`, `CARD_TTL_SEC = 300`
  - `CardClaimsSchema` (strict) and `LinkClaimsSchema` (strict: `{iss, aud, owner, state, iat, exp, jti}`)
  - `CARD_REFUSAL_CODES = ["not_linked","bad_nonce","rate_limited"]`
  - `STATUS_WINDOW_MS = 5000`, `CARDS_PER_MINUTE = 6`
- From `protocol.ts`:
  - Client frame `status {id, from_ref, state, label?}`. Fire and forget: no reply on success.
  - Client frame `card_request {id, from_ref, aud, nonce}`.
  - Server frames `card {id, jwt}` and `card_refused {id, code}`.
  - The `RosterAgent` row gains `role?: BusName`, `status?`, `status_label?` and `status_at?` (ISO).
  - `ErrorFrame.code` gains nothing. `role_vacant` is a refusal reason only (a refused receipt).
- `receipts.ts`: `REFUSAL_REASONS` gains `role_vacant`, and `receiptShape` gains `to_name?: BusName`.
- `rest.ts`:
  - `AgentSchema` gains `role?`, `status?`, `statusLabel?` and `statusAt?`. The feed's `agents` frame therefore carries roles; there is no separate roles frame.
  - `RoleSchema {namespace, role, agentId|null, setAt}`, `RolesResponseSchema {roles}`, `PutRoleBodySchema {agentId}`.
  - `LinkedAppSchema {aud, linkedAt}` and `LinkedAppsResponseSchema {apps}`.
  - `R.roles`, `R.role(ns, role)`, `R.linkedApps`, `R.linkedApp(aud)`, `R.link = "/link"`, `R.linkConfirm = "/link/confirm"`, `R.jwks = "/.well-known/jwks.json"`.
- `mocks/card.ts`: `TEST_CARD_JWK` (private), `TEST_CARD_KEY_X`, `signTestCard(claims)` and `signTestLink(claims)`, both returning `Promise<string>`.

- [ ] **Step 1: Write the failing tests.**
  - `card.test.ts`: the gate is above 0.53.0; nonce bounds (15 or 129 characters fail; `+` fails); `CardClaimsSchema` refuses `email`, `namespace` and `machine_id` keys (strict); `agent_says` requires `status`.
  - `protocol.test.ts`: round-trips for the four new frames; a roster row with `role` and `status`.
  - `receipts.test.ts`: `refused/role_vacant` passes `receiptReasonMatchesState`.
  - `mocks/card.test.ts`: `signTestCard` output verifies with jose against the public half, has `typ` `ob-card+jwt` and a `kid`, and the claims parse.
- [ ] **Step 2:** Run `pnpm --filter @ob/shared test`. Expect FAIL.
- [ ] **Step 3:** Implement the schemas above. Add `CONTRACT.md` sections for roles, status, card and the gate, plus the `contract.test.ts` pins.
- [ ] **Step 4:** Run `pnpm --filter @ob/shared test && pnpm -r typecheck`. Expect PASS. Typecheck catches every exhaustive switch over `ClientFrame` (hub `#onMessage`, daemon). The hub answers the new client frames with `error bad_frame` until Tasks 4, 6 and 8, so the build stays green.
- [ ] **Step 5:** Commit, give the manager the shared heads-up, then open the PR.

### Task 2 (AC2a-1): Roles table and collisions

**Files:**
- Create `apps/server/src/hub/roles.ts` and `apps/server/test/hub.roles.test.ts`.
- Modify `hub/schema.ts`:

```sql
create table if not exists roles (org_id text not null, namespace text not null, role text not null, lrole text not null, agent_id text, set_at integer not null, primary key (org_id, namespace, lrole));
create index if not exists roles_agent on roles(agent_id);
create index if not exists roles_lrole on roles(org_id, lrole);
```

- Modify `hub/do.ts`: `nameTaken` also refuses role names, and every close site vacates roles.

**Interfaces (produces, in `roles.ts`):**
- `roleTaken(sql, namespace, lname, global): boolean`. A global agent's name collides with a role in any namespace.
- `vacateRoles(sql, agentIds: string[]): void`, which sets `agent_id = null`.
- `setRole(sql, ns, role, agentId, now): "ok" | "bad_agent" | "name_taken" | "agent_has_role"`.
- `deleteRole(sql, ns, role): boolean`.
- `listRoles(sql): RoleRow[]`, joining the holder's name when it is live.

Rulings: each agent holds at most one role (`agent_has_role` becomes 409). Roles compare case-insensitively, like names.

- [ ] **Step 1: Write the failing tests.**
  - `setRole` refuses `bad_agent` for a closed agent, an agent in another namespace, or an unknown agent; it allows a global agent.
  - It refuses `name_taken` when an open agent is named `Lane-6` and the role is `lane-6`.
  - An agent_up proposing `LANE-6` gets `lane-6-2`.
  - After agent_down, after a `sessions` close, and after a machine revoke, the role's `agent_id` is null. After the same ref sends agent_up again, it is still null. This is Review Focus 1.
- [ ] **Step 2:** Run the scoped tests (`npx vitest run test/hub.roles.test.ts --no-file-parallelism --maxWorkers=1`, load <40). Expect FAIL.
- [ ] **Step 3:** Implement. Call `vacateRoles` from the three `live = 0` updates (do.ts ~749, ~1927, ~2154) using the `returning id` rows they already have.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit.

### Task 3 (AC2a-2): Send resolution, gated wire (one PR with Task 2; adversarial review)

**Files:**
- Modify `hub/do.ts`: `resolveTarget` → `resolveRole` first; `#send` and `#resend` (`to_name`); `roster()` (`role`).
- Modify `hub/roles.ts`: `resolveRole(sql, sender, lname, toNamespace): Resolution | null`. It returns null when no role matches, which lets name resolution run.
- Test `apps/server/test/hub.roles-send.test.ts`, and add a case to `hub.compat-v0.44.test.ts` (or a new `hub.compat-v0.53.test.ts`).

Scoping matches names:
- A non-global sender sees roles only in its own namespace. With `to_namespace` set to another namespace, it gets `other_namespace`.
- A global sender sees roles in every namespace, or only in `to_namespace` when given. A match in two namespaces is `ambiguous`.
- A vacant role, or a holder with `live=0`, gives `role_vacant`. Below the gate that is sent as `unknown_agent`, via a `refusalFor(ws, reason)` helper.

- [ ] **Step 1: Write the failing tests.**
  - A send to `lane-6` while the holder is live is delivered to the holder, and the gated receipt carries `to_name: <holder bus name>`.
  - With the holder queued, the send is pending and stored.
  - A vacant role is refused `role_vacant`, and `unknown_agent` at client_version `0.53.0`.
  - Re-pointing the role delivers to the new holder.
  - A global sender with `lane-6` in two namespaces gets `ambiguous`, and `to_namespace` resolves it.
  - A gated roster row shows `role`. A 0.53.0 roster has no `role` and passes a strict 0.53 decoder (Review Focus 3).
  - No client frame can set a role: `bad_frame` for `{type:"role"}`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `to_name` is included only in gated `receipt` frames.
- [ ] **Step 4:** Run `hub.roles*.test.ts` plus the compat test. Expect PASS.
- [ ] **Step 5:** Commit, adversarial review, PR.

### Task 4 (AC2b): Roles REST

**Files:**
- Create `apps/server/src/routes/roles.ts` and `apps/server/test/roles.rest.test.ts`.
- Modify:
  - `routes/index.ts`
  - `auth/route-policy.ts`, adding `GET /api/v1/roles`, `PUT /api/v1/roles/:namespace/:role` and `DELETE` the same path
  - `hub/do.ts`, adding RPCs `listRoles()`, `putRole(ns, role, agentId)` and `deleteRole(ns, role)`, which notify dashboards and fan out `roster_changed`.

- [ ] **Step 1: Write the failing tests.**
  - PUT without a session gives 401; without `X-OB-Request` it gives 403.
  - A bad namespace or role gives 400 with the field set. `bad_agent` gives 400, `name_taken` 409, `agent_has_role` 409.
  - PUT then GET lists `{role, agentId, agentName}`. DELETE gives 204, and 404 the second time.
  - A machine bearer token on PUT gives 401.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement, following `routes/machines.ts`, with `noStore()` and the `requireOwner` pattern.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit, PR.

### Task 5 (AC3): Status storage and the coalescing limit

**Files:**
- Create `apps/server/src/hub/status.ts` and `apps/server/test/hub.status.test.ts`.
- Modify:
  - `hub/schema.ts` + `migrateHub`: `agents` gains `status`, `status_label`, `status_at`, `status_next` (JSON `{state,label}`, nullable) and `status_due`.
  - `hub/do.ts`: the `#onMessage` `status` case; an alarm step that runs before housekeeping; `#nextDeadline` gets `min(status_due)`; every close site clears the five columns (shared with `vacateRoles`'s sites).
  - `roster()` and `agentDto`: gated `status*` and REST `status*`.

**Interfaces (`status.ts`):**
- `applyStatus(sql, agentId, s, now): {applied: boolean, due: number | null}`. If `now ≥ status_at + STATUS_WINDOW_MS`, it applies the update immediately. Otherwise it stores `status_next` and `status_due = status_at + 5000`.
- `applyDueStatus(sql, now, limit): string[]`, returning the changed agent ids.
- `clearStatus(sql, agentIds)`.

Every applied change calls `#notifyDashboards()` and fans out `roster_changed` to the agent's namespace.

- [ ] **Step 1: Write the failing tests.**
  - The first update shows in REST at once.
  - Three updates within 5 s leave the first one shown; after `alarmOnce` at +5 s (frozen clock), the third one is shown.
  - The status label is cleaned and capped at 64 characters, and a bad state gives `bad_frame`.
  - A status from an unregistered ref gives `not_registered`.
  - Closing with an update pending clears everything, and the alarm afterwards applies nothing (Review Focus 5).
  - The pending update survives a simulated eviction (a new instance via `runInDurableObject` after the in-memory state is reset).
  - A 0.53.0 roster has no `status*` and decodes.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Use `this.#arm(due)` and keep the alarm batch bounded by `BATCH`.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit, PR.

### Task 6 (AC4a): Key loader, JWKS, test-key guard (adversarial review)

**Files:**
- Create:
  - `apps/server/src/card/keys.ts`
  - `apps/server/src/routes/jwks.ts`
  - `apps/server/test/card.keys.test.ts`
- Modify:
  - `env.ts`: optional `CARD_SIGNING_KEY`, `CARD_SIGNING_KEY_PREV` and `CARD_OWNER_SALT`.
  - `route-policy.ts`: `GET /.well-known/jwks.json` as `{public}`.
  - `routes/index.ts`

**Interfaces (`card/keys.ts`, used by both the Worker and the DO):**
- `loadCardKeys(env): Promise<CardKeys | null>`. It parses and imports once per isolate (cached by secret string). It returns null when any secret is absent or malformed. It throws `TestKeyError` when `x === TEST_CARD_KEY_X && env.ENVIRONMENT !== "dev"`. This one check, inside the loader, guards every signing path, so the signer itself carries no separate check.
- `CardKeys = {kid, privateKey: CryptoKey, jwks: {keys: JWK[]}}`. The JWKS holds the public halves only: `d` is stripped and asserted absent.
- `ownerId(salt, aud): Promise<string>`.
- `signJws(keys, typ, claims): Promise<string>`, using `new SignJWT(...).setProtectedHeader({alg:"EdDSA", kid, typ})`.

- [ ] **Step 1: Write the failing tests.**
  - JWKS with no secrets gives 503. With a key it gives 200, `max-age=3600`, the current key first, then PREV, and no `d` anywhere.
  - The test key outside dev gives 503 and `signJws` is never reached. In dev it gives 200.
  - `ownerId` is stable, base64url without padding, and differs per `aud`.
  - A JWS signed by `signJws` verifies with jose's `jwtVerify` against the JWKS, with `typ` checked.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit, adversarial review, PR.

### Task 7 (AC4b): linked_apps and the linked-apps REST

**Files:**
- Modify:
  - `hub/schema.ts`: `create table if not exists linked_apps (org_id text not null, aud text not null, linked_at integer not null, primary key (org_id, aud))`
  - `hub/do.ts`: RPCs `linkApp(aud)`, `listLinkedApps()` and `unlinkApp(aud): boolean`
  - `route-policy.ts`
- Create `routes/linked-apps.ts` and `test/linked-apps.test.ts`.

- [ ] **Step 1: Write the failing tests.** GET lists apps. DELETE `/api/v1/linked-apps/:aud` (URL-encoded origin) gives 204, then 404. A non-origin `aud` gives 400. Session and CSRF behave as in Task 4.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `aud` is validated by a shared `parseOrigin(s): string | null` in `card/origin.ts`, which Task 9 also uses.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit. Ship in one PR with Task 8.

### Task 8 (AC4c): card_request signing in the DO (adversarial review)

**Files:**
- Create `hub/card.ts` and `test/hub.card.test.ts`.
- Modify:
  - `hub/schema.ts`: `card_rl (agent_id text primary key, window_start integer not null, n integer not null)`
  - `hub/do.ts`: the `card_request` case.

**Interface:** `issueCard(sql, env, agent: AgentRow, machineLabel, f, now): Promise<{jwt} | {code}>`. The claims come from the agent row:
- `sub = id`, `name`, `kind`, `machine = label`.
- `role` comes from `roles` for this agent.
- `agent_says` comes from the applied status only.
- `iss = "https://" + env.APP_HOST`.

The order is fixed:
1. Gate: below it, reply `error bad_frame`.
2. Attested `from_ref`, else `not_registered`.
3. `NonceSchema`, else `card_refused bad_nonce`.
4. Linked `aud`, else `not_linked`.
5. Rate limit: 6 per rolling 60 s window per agent in `card_rl`, else `rate_limited`.
6. `loadCardKeys`: null or `TestKeyError` gives `error internal`.

Only then is the card signed.

- [ ] **Step 1: Write the failing tests.**
  - The card verifies against the JWKS (Task 6) with `typ` `ob-card+jwt`, `exp − iat = 300`, `aud` equal to the requested one, and the `role` and `agent_says` claims.
  - There are no `email`, `namespace` or `machine_id` keys.
  - The seventh request in a minute gives `rate_limited`. An unlinked `aud` gives `not_linked`. A bad nonce gives `bad_nonce`. Each refusal echoes the frame `id`.
  - After `unlinkApp`, the result is `not_linked`.
  - After a rotation (PREV set to the old public key), an old card still verifies against the JWKS.
  - A 0.53.0 daemon's `card_request` gets `bad_frame` and never a `card` frame.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. The signing is async: call `#onMessage`'s handler with `ctx.waitUntil`-free awaiting, inside `blockConcurrencyWhile`-free code, so that the reply is sent after the `await`. Re-check that the socket is not replaced before sending.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit, adversarial review, PR (with Task 7).

### Task 9 (AC4d): /link flow (adversarial review)

**Files:**
- Create:
  - `routes/link.ts`
  - `routes/link-page.ts` is Frontend's (AC6): `renderLinkConfirm({busHost, userEmail, aud, action, csrf})` and `renderLinkError(base, "bad_request" | "expired")`. The 503 page reuses `renderLinkError`.
  - `card/origin.ts`, if Task 7 has not already created it
  - `test/link.test.ts`
- Modify:
  - `route-policy.ts`: `GET /link` `{public}`, which validates and sets the cookie; `GET /link/confirm` `{session, signedOut:"login"}`; `POST /link/confirm` `{session, form: linkFormCheck}`
  - `auth/approve-csrf.ts`: generalize to `formToken(purpose)`, or add `linkFormCheck` alongside it.

The flow:
- `GET /link?aud&state&redirect_uri` validates (400 on any failure) and sets `__Host-ob_link`: an HMAC-signed `{aud, state, redirect_uri, exp}` with the `auth/keys.ts` HKDF purpose `"link"`, HttpOnly, Secure, `SameSite=Lax`, Path `/`, Max-Age 600. It then answers 303 to `/link/confirm`.
- `GET /link/confirm` reads the cookie (missing or expired gives a 400 page) and renders the confirm page ("Let <aud> verify your agents' cards?") with a form token. The CSP is `form-action 'self' <aud>` and `frame-ancestors 'none'`.
- `POST /link/confirm` runs `linkApp(aud)` and signs a `LinkClaimsSchema` assertion with `typ` `ob-link+jwt`. It clears the cookie and answers 303 to `${redirect_uri}#assertion=<jws>&state=<state>`, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The assertion is never logged: assert this with the `logEvent` spy.

- [ ] **Step 1: Write the failing tests.**
  - All the Review Focus 4 shapes give 400. `HTTPS://OA.Example` normalizes to lowercase.
  - A `redirect_uri` on another origin, with a fragment, or longer than 512 characters gives 400.
  - A `state` of 15 characters or with `.` gives 400.
  - Signed out, `/link/confirm` gives 302 to login with `next=/link/confirm`.
  - A POST without the form token gives 403.
  - On success, the `Location` fragment holds a JWS that verifies with `typ` `ob-link+jwt`, `aud`, the echoed `state`, and `owner === ownerId(salt, aud)`, and `linked_apps` contains `aud`.
  - A tampered cookie gives 400.
  - No card secrets gives a 503 page.
  - The log spy never contains `assertion=`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit, adversarial review, PR.

## Delivery order

| PR | Tasks | Review |
| --- | --- | --- |
| AC1 | 1 | spec + quality, shared heads-up |
| AC2a | 2+3 | adversarial |
| AC2b | 4 | spec + quality |
| AC3 | 5 | spec + quality |
| AC4a | 6 | adversarial |
| AC4b | 7+8 | adversarial |
| AC4c | 9 | adversarial |

AC2–AC4 depend on AC1. Within AC2–AC4, the order above is the default. AC3 and AC4a can run before AC2b.
