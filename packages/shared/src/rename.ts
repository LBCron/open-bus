import { z } from "zod";
import { IsoTimeSchema } from "./card.js";
import { LIMITS } from "./limits.js";
import { BusNameSchema } from "./names.js";

/**
 * Renames (#393). One gate for three hops, so it must be the first release
 * that carries all of R393a (wire), R393b (hub) and R393c (daemon IPC):
 * the hub sends `former_names` and a former-name `to_name` only to daemons at
 * or above it; the daemon sends `rename` only to hubs at or above it (below
 * it, it re-sends `agent_up`); adapters offer the tool only on daemons at or
 * above it. 0.64.0 shipped the wire (R393a) and 0.65.0 shipped without
 * the hub and daemon halves, so the gate is the release after 0.65.0:
 * re-pin it if those land in different releases. A hub with R393a but not R393b answers `rename`
 * with `error bad_frame`.
 */
export const RENAME_MIN_CLIENT = "0.66.0";

/** Pinned `error` messages for `rename` refusals. Clients may match on them. */
export const RENAME_MESSAGES = {
  /** `rate_limited`: past LIMITS.renamesPerHour name changes in a rolling hour. */
  rate: "Too many renames",
} as const;

/**
 * Whose name it is (#393 amendment 1). `default`: the harness's fallback
 * (`pi`, `codex`, `code-96`), which nobody chose; the hub mints it as
 * `<base>-<4 hex>`, never reuses it and doesn't reserve it after a rename.
 * `chosen`: anything else, reserved for the grace after a rename. Only the
 * daemon knows which, so it says so; absent means `chosen`, since reserving
 * a default is the safe error.
 */
export const NAME_KINDS = ["default", "chosen"] as const;
export const NameKindSchema = z.enum(NAME_KINDS);
export type NameKind = z.infer<typeof NameKindSchema>;

/** A name the agent left, which still reaches it until `expires_at`. */
export const FormerNameSchema = z.strictObject({
  name: BusNameSchema,
  expires_at: IsoTimeSchema,
});

/**
 * An agent's live former names: 1 to LIMITS.maxFormerNames; the hub omits the
 * field when there are none. It may hold more live rows than it shows; those
 * still resolve and stay reserved.
 *
 * The hub also guarantees, and its tests pin (R393b): newest first
 * (`expires_at` non-increasing), distinct case-insensitively, and never equal
 * to the row's `bus_name` case-insensitively. The decoder does not enforce
 * these: one bad row would otherwise fail the whole roster for every daemon.
 */
export const FormerNamesSchema = z
  .array(FormerNameSchema)
  .min(1)
  .max(LIMITS.maxFormerNames);

export type FormerName = z.infer<typeof FormerNameSchema>;
