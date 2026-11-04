import { z } from "zod";
import { IsoTimeSchema } from "./card.js";
import { LIMITS } from "./limits.js";
import { BusNameSchema } from "./names.js";

/**
 * Renames (#393, R393a). The first client version that decodes `rename`,
 * `renamed` and roster `former_names`. Predicted: the release after 0.63.0
 * that carries R393a. Below it the hub resolves former names the same, but
 * sends no `former_names` and no former-name receipt `to_name`; the daemon
 * renames by re-sending `agent_up`.
 */
export const RENAME_MIN_CLIENT = "0.64.0";

/** Pinned `error` messages for `rename` refusals. Clients may match on them. */
export const RENAME_MESSAGES = {
  /** `rate_limited`: past LIMITS.renamesPerHour name changes in a rolling hour. */
  rate: "Too many renames",
} as const;

/** A name the agent left, which still reaches it until `expires_at`. */
export const FormerNameSchema = z.strictObject({
  name: BusNameSchema,
  expires_at: IsoTimeSchema,
});

/**
 * An agent's live former names: 1 to LIMITS.maxFormerNames, newest first
 * (`expires_at` non-increasing), distinct case-insensitively. The hub omits
 * the field when there are none. It may hold more live rows than it shows;
 * those still resolve and stay reserved.
 */
export const FormerNamesSchema = z
  .array(FormerNameSchema)
  .min(1)
  .max(LIMITS.maxFormerNames)
  .refine(
    (a) =>
      a.every(
        (f, i) =>
          i === 0 ||
          Date.parse(a[i - 1].expires_at) >= Date.parse(f.expires_at),
      ),
    "former_names not newest first",
  )
  .refine(
    (a) => new Set(a.map((f) => f.name.toLowerCase())).size === a.length,
    "duplicate former name",
  );

export type FormerName = z.infer<typeof FormerNameSchema>;
