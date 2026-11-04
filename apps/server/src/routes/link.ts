import { CARD_TTL_SEC, LINK_TYP, LinkClaimsSchema, R } from "@ob/shared";
import {
  clearLinkCookie,
  type LinkRequest,
  linkCookie,
  linkCookieValue,
  linkCsrf,
  openLink,
  sealLink,
} from "../auth/link-cookie.js";
import {
  type CardKeys,
  loadCardKeys,
  ownerId,
  signJws,
  TestKeyError,
} from "../card/keys.js";
import { parseOrigin } from "../card/origin.js";
import type { Env } from "../env.js";
import { appOrigin } from "../http/errors.js";
import { clientIp, clientKey, enforceRateLimit } from "../http/rate-limit.js";
import { hub } from "../hub/stub.js";
import { b64urlEncode } from "../util/crypto.js";
import { approveCsp } from "./approve.js";
import { pageBase, REFERRER_POLICY } from "./approve-page.js";
import { HTML_CSP } from "./auth.js";
import {
  linkSwitchUrl,
  renderLinkConfirm,
  renderLinkError,
} from "./link-page.js";
import type { AppType } from "./types.js";

const STATE = /^[A-Za-z0-9_-]{16,128}$/;
/**
 * OA's one link callback, fixed by spec amendment #322 (agreed with OA). The
 * bus never takes a redirect target from the request: any OA path that
 * redirects or runs untrusted script would otherwise leak the assertion.
 */
export const LINK_CALLBACK_PATH = "/settings/openbus/callback";

/**
 * Exactly `aud` and `state`, each once, and nothing else (a `redirect_uri`,
 * even one equal to the callback, is refused). aud is exact and canonical:
 * a different spelling is refused, never normalized.
 */
function parseLinkRequest(
  url: string,
  env: Pick<Env, "ENVIRONMENT">,
): LinkRequest | null {
  const p = new URL(url).searchParams;
  const keys = [...p.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2) return null;
  const aud = p.get("aud");
  const state = p.get("state");
  if (aud === null || state === null) return null;
  if (parseOrigin(aud, env) !== aud || !STATE.test(state)) return null;
  return { aud, state };
}

/** null when any card secret is absent or the key is the test key outside dev. */
async function cardKeys(env: Env): Promise<CardKeys | null> {
  try {
    return await loadCardKeys(env);
  } catch (e) {
    if (e instanceof TestKeyError) return null;
    throw e;
  }
}

type Extra = { csp?: string; cookie?: string };

const html = (body: string, status: number, x: Extra = {}) => {
  const h = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": x.csp ?? HTML_CSP,
    "referrer-policy": REFERRER_POLICY,
  });
  if (x.cookie) h.append("set-cookie", x.cookie);
  return new Response(body, { status, headers: h });
};

const errorPage = (
  env: Env,
  reason: "bad_request" | "expired",
  status: number,
  x?: Extra,
) => html(renderLinkError(pageBase(env), reason), status, x);

/** A 303 to OA carrying the outcome in the fragment only. Never logged. */
const toApp = (env: Env, r: LinkRequest, frag: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location: `${r.aud}${LINK_CALLBACK_PATH}#${frag}&state=${r.state}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "set-cookie": clearLinkCookie(env),
    },
  });

async function assertion(env: Env, keys: CardKeys, aud: string, state: string) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = LinkClaimsSchema.parse({
    iss: appOrigin(env),
    aud,
    owner: await ownerId(keys.ownerSalt, aud),
    state,
    iat,
    exp: iat + CARD_TTL_SEC,
    jti: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  });
  return signJws(keys, LINK_TYP, claims);
}

/**
 * Linking an Open Artifacts instance (AC4c; spec "Linking OA to a bus").
 * GET /link (public) validates first and keeps the request in the signed
 * ob_link cookie, so it never rides through sign-in's `next`. GET
 * /link/confirm (session, signed-out to sign-in) renders the confirm page;
 * its CSP allows `aud` in form-action because browsers apply it to the
 * post-submit redirect. POST /link/confirm (session plus linkFormCheck)
 * clears the cookie on every outcome and returns the assertion in the
 * redirect fragment only.
 */
export function mountLink(app: AppType): void {
  app.get(R.link, async (c) => {
    await enforceRateLimit(
      c.env.RL_AUTH,
      "link",
      clientKey(clientIp(c.req.raw)),
    );
    const req = parseLinkRequest(c.req.url, c.env);
    if (!req) return errorPage(c.env, "bad_request", 400);
    if (!(await cardKeys(c.env))) return errorPage(c.env, "bad_request", 503);
    return new Response(null, {
      status: 303,
      headers: {
        location: R.linkConfirm,
        "cache-control": "no-store",
        "set-cookie": linkCookie(await sealLink(c.env, req), c.env),
      },
    });
  });

  app.get(R.linkConfirm, async (c) => {
    const link = linkCookieValue(c);
    const req = await openLink(c.env, link);
    if (!req || !link) return errorPage(c.env, "expired", 400);
    if (!(await cardKeys(c.env))) return errorPage(c.env, "bad_request", 503);
    const page = renderLinkConfirm({
      ...pageBase(c.env),
      aud: req.aud,
      action: R.linkConfirm,
      csrf: await linkCsrf(c.env, link, c.get("session")),
      switchUrl: linkSwitchUrl(c.env),
    });
    // approveCsp: "Not you?" posts to logout, whose redirects reach Access.
    // aud is a canonical origin (parseOrigin): no CSP metacharacters.
    return html(page, 200, {
      csp: approveCsp(c.env).replace(
        "form-action 'self'",
        `form-action 'self' ${req.aud}`,
      ),
    });
  });

  app.post(R.linkConfirm, async (c) => {
    const cookie = clearLinkCookie(c.env);
    const req = await openLink(c.env, linkCookieValue(c));
    if (!req) return errorPage(c.env, "expired", 400, { cookie });
    // The gate read the body for linkFormCheck; Hono caches it.
    const decisions = new URLSearchParams(await c.req.text()).getAll(
      "decision",
    );
    const decision = decisions.length === 1 ? decisions[0] : null;
    if (decision === "cancel") return toApp(c.env, req, "error=access_denied");
    if (decision !== "allow")
      return errorPage(c.env, "bad_request", 400, { cookie });
    const keys = await cardKeys(c.env);
    if (!keys) return errorPage(c.env, "bad_request", 503, { cookie });
    // Full: tell OA via the callback so its link attempt doesn't stall (#387).
    if (!(await hub(c.env).linkApp(req.aud)))
      return toApp(c.env, req, "error=limit_reached");
    const jws = await assertion(c.env, keys, req.aud, req.state);
    return toApp(c.env, req, `assertion=${jws}`);
  });
}
