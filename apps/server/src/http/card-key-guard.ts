import type { MiddlewareHandler } from "hono";
import { isTestCardKey } from "../card/keys.js";
import type { Env } from "../env.js";
import { logEvent } from "../util/log.js";
import { errorJson } from "./errors.js";
import type { AppEnv } from "./middleware.js";

/** The `problem` /healthz reports; `status` and `doctor` print its fix (#297). */
export const TEST_CARD_KEY_PROBLEM = "test_card_key";

/**
 * True outside ENVIRONMENT=dev when CARD_SIGNING_KEY or CARD_SIGNING_KEY_PREV
 * is the shared test key (I11), by decoded bytes, so a non-canonical
 * encoding of its x still counts. Checked on the raw secrets, so it holds
 * whatever else is wrong with them. A Worker has no start to refuse, so every
 * request refuses instead.
 */
export function onTestCardKey(env: Env): boolean {
  if (env.ENVIRONMENT === "dev") return false;
  return [env.CARD_SIGNING_KEY, env.CARD_SIGNING_KEY_PREV].some(isTestCardKey);
}

/** One log line per isolate: loud enough to find, never a flood. */
let logged = false;

/**
 * 503 on everything but GET or HEAD /healthz, which keeps answering with
 * `problem: "test_card_key"` so `status` and `doctor` can say why and how to
 * fix it. Never a silent outage, and never any key material in the log.
 */
export const cardKeyGuard =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    if (!onTestCardKey(c.env)) return next();
    if (!logged) {
      logged = true;
      logEvent("card_key_is_test_key", {
        action: "refusing requests; see docs/ops/releases.md",
      });
    }
    if (
      (c.req.method === "GET" || c.req.method === "HEAD") &&
      new URL(c.req.url).pathname === "/healthz"
    )
      return next();
    // The standard envelope (the SPA and CLI parse it), as the JWKS 503 does.
    return errorJson(
      503,
      "internal",
      "This bus's card key is the shared test key. Run: pnpm -s ob:setup --name <instance> --rotate-card-key --force",
      undefined,
      { "cache-control": "no-store" },
    );
  };

/** Test seam: forget that the line was logged. */
export const resetCardKeyGuardLog = () => {
  logged = false;
};
