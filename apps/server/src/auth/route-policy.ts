import { AUTH } from "@ob/shared";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { matchedRoutes } from "hono/route";
import { ApiError } from "../http/errors.js";
import {
  type AppEnv,
  csrfRefusal,
  type FormCheck,
  formCsrfRefusal,
  isSafeMethod,
  refuse,
} from "../http/middleware.js";
import { approveFormCheck } from "./approve-csrf.js";
import { linkFormCheck } from "./link-cookie.js";
import { readSession, sessionCookieName } from "./session.js";

/**
 * EVERY middleware (anything registered with `app.use` or that calls `next()`)
 * MUST be wrapped with `mw()`. The gate enforces exactly one rule: the first
 * matched route after it that is not tagged. An untagged middleware is taken
 * as the answering route, so if its path is listed (e.g. `"ALL /api/*"`) the
 * gate passes on its rule and the real handler behind it runs unchecked
 * (pinned by test/hardening.test.ts). Never list a middleware in the table.
 *
 * Real middleware, tagged at registration (`mw`). The gate skips exactly
 * these when it looks for the route that will answer; anything else matched
 * is a handler and needs a policy.
 */
const MIDDLEWARE = new WeakSet<object>();
export function mw<T extends object>(handler: T): T {
  MIDDLEWARE.add(handler);
  return handler;
}
export const isMiddleware = (handler: object): boolean =>
  MIDDLEWARE.has(handler);

/**
 * Every route's access rule. A route with no entry answers 404 before its
 * handler runs, so a new route cannot ship unguarded. `machine` routes verify
 * the bearer token in their handler (the gate only proves the table lists them).
 */
export type Policy =
  | { public: string }
  | {
      session: string;
      /**
       * Form-POST CSRF mode (B4): a classic HTML form cannot send
       * X-OB-Request, so instead of the header rule the request must be
       * same-origin AND carry a signed form token that `form` verifies
       * (formCsrfRefusal). Every other session row keeps the header rule.
       */
      form?: FormCheck;
      /** A signed-out GET/HEAD is sent to sign-in and back, not refused 401 (a page a browser opens). */
      signedOut?: "login";
    }
  | { machine: string };

/** Keyed `${method} ${path}` as Hono registers the route. */
export const ROUTE_POLICY: Readonly<Record<string, Policy>> = {
  "GET /healthz": { public: "health probe" },
  "GET /robots.txt": { public: "robots" },
  "GET /llms.txt": { public: "agent setup instructions" },
  "GET /hub": { machine: "daemon socket" },
  "GET /auth/login": { public: "OIDC sign-in start" },
  "GET /auth/callback": { public: "OIDC callback (state cookie + Access)" },
  "GET /auth/no-access": { public: "non-owner page" },
  // Stays public: a forged cookie must still get 204 and a cleared cookie.
  // The handler checks Origin / Sec-Fetch-Site and the session itself.
  "POST /auth/logout": { public: "logout (same-origin checked in handler)" },
  // 404s unless ENVIRONMENT=dev and the host is loopback (checked in handler).
  "GET /auth/dev-login": { public: "dev login (dev + loopback only)" },
  // B4 device flow: the CLI has no session. Per-IP RL_DEVICE plus the hub's
  // own caps (MAX_DEVICE_CODES, per-row slow_down) bound them.
  "POST /device/code": { public: "device flow: new code (CLI)" },
  "POST /device/token": { public: "device flow: poll (CLI)" },
  "GET /approve/:user_code": {
    session: "approval page",
    signedOut: "login",
  },
  // A classic form POST: same-origin plus the signed approve token, no header.
  "POST /approve/:user_code": {
    session: "approval decision",
    form: approveFormCheck,
  },
  "GET /api/v1/me": { session: "dashboard: the signed-in owner" },
  "GET /api/v1/agents": { session: "dashboard: agent roster" },
  "GET /api/v1/machines": { session: "dashboard: machine list" },
  "DELETE /api/v1/machines/:id": { session: "dashboard: revoke a machine" },
  "GET /api/v1/linked-apps": { session: "dashboard: linked apps" },
  "DELETE /api/v1/linked-apps/:aud": { session: "dashboard: unlink an app" },
  "GET /api/v1/events": { session: "dashboard WebSocket" },
  // AC4a: card verification keys for linked apps (no secrets: public halves).
  "GET /.well-known/jwks.json": { public: "card JWKS" },
  // AC4c: an app links to this bus. /link validates and sets the signed
  // ob_link cookie (per-IP RL_AUTH); confirm is the owner's, and its POST
  // is a classic form (same-origin plus the token bound to that cookie).
  "GET /link": { public: "link an app: validate, set ob_link" },
  "GET /link/confirm": { session: "link confirm page", signedOut: "login" },
  "POST /link/confirm": { session: "link decision", form: linkFormCheck },
  // Hono routes HEAD as GET, so this row covers HEAD too.
  "GET /*": { public: "SPA and assets" },
};

type Target = { method: string; path: string };

/**
 * The route that will answer: the first matched route after this middleware
 * that is not tagged middleware. (`c.req.routePath` inside `app.use("*")` is
 * the middleware's own path, not the answering route's.)
 */
export function targetRoute(c: Context): Target | null {
  const routes = matchedRoutes(c);
  for (let i = c.req.routeIndex + 1; i < routes.length; i++) {
    const r = routes[i];
    if (!r || isMiddleware(r.handler)) continue;
    return { method: r.method, path: r.path };
  }
  return null;
}

/**
 * App gate: looks the answering route up in `table` and enforces it.
 * `{session}`: readSession (signature, claims, then the hub generation; a hub
 * error is null) or 401 (a 302 to sign-in for a `signedOut: "login"` GET),
 * then CSRF on every method but GET/HEAD (403): the X-OB-Request header rule,
 * or for a `form` row the same-origin plus signed-token rule; then
 * `c.set("session", s)`. Refusals are no-store and land before the handler.
 */
export const enforcePolicy = (
  table: Readonly<Record<string, Policy>> = ROUTE_POLICY,
): MiddlewareHandler<AppEnv> =>
  mw(async (c, next) => {
    const t = targetRoute(c);
    // No answering route: the app's notFound handler answers 404.
    if (!t) return next();
    const p = table[`${t.method} ${t.path}`];
    if (!p) throw new ApiError("not_found", "Not found");
    if ("session" in p) {
      const s = await readSession(
        c.env,
        getCookie(c, sessionCookieName(c.env)),
      );
      if (!s) {
        if (p.signedOut === "login" && isSafeMethod(c.req.method))
          return new Response(null, {
            status: 302,
            headers: {
              location: `${AUTH.login}?next=${encodeURIComponent(c.req.path)}`,
              "cache-control": "no-store",
            },
          });
        return refuse(new ApiError("unauthorized", "Sign in to continue"));
      }
      const csrf = p.form
        ? await formCsrfRefusal(c, s, p.form)
        : csrfRefusal(c);
      if (csrf) return refuse(csrf);
      c.set("session", s);
    }
    await next();
  });
