import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";

/** Start times and mtimes compare at second granularity; the plugin writes moments after its TUI starts. */
export const START_TOLERANCE_SECONDS = 2;

/** Where the TUI plugin writes `<tui pid>.json`: `{ pid, sessionIDs }`. */
export const opencodePresenceDir = () => join(home(), "opencode-tui");

export type PresenceDeps = {
  isRunning: (pid: number) => boolean;
  /** Epoch seconds the pid's current process started; null when it cannot be told. `stamp` names the file's version. */
  procStartEpoch: (pid: number, stamp?: string) => number | null;
};

/**
 * Root session ids some running TUI has open. The plugin removes its file on
 * a clean exit only, so a TUI killed by a signal leaves one behind; once its
 * pid is reused, a file written before that process started counts for nothing.
 */
export function openSessions(dir: string, deps: PresenceDeps): Set<string> {
  const out = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const fn of names) {
    if (!/^\d+\.json$/.test(fn)) continue;
    let data: { pid?: unknown; sessionIDs?: unknown };
    let mtime: number;
    try {
      mtime = statSync(join(dir, fn)).mtimeMs / 1000;
      data = JSON.parse(readFileSync(join(dir, fn), "utf8"));
    } catch {
      continue;
    }
    const pid = data?.pid;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1)
      continue;
    if (!Array.isArray(data.sessionIDs) || !deps.isRunning(pid)) continue;
    const started = deps.procStartEpoch(pid, String(mtime));
    if (started !== null && started > mtime + START_TOLERANCE_SECONDS) continue;
    for (const id of data.sessionIDs) if (typeof id === "string") out.add(id);
  }
  return out;
}

/** `ps -o lstart=` under `TZ=UTC LC_ALL=C` (procStartOf), as epoch seconds. */
export function lstartEpoch(lstart: string | null): number | null {
  if (!lstart) return null;
  const ms = Date.parse(`${lstart} UTC`);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/**
 * The root session titles a running TUI published (#393), by root session id,
 * from a presence file's `titles`. R393d's plugin writes it; until then the
 * key is absent and nothing is read. Two shapes are accepted, both keyed by
 * the root session the title belongs to: `<session id>: title`, and
 * `root: title` (a session id is never `root`), which names the newest root
 * the file lists. A title that is not a string counts for nothing.
 */
export function openSessionTitles(
  dir: string,
  deps: PresenceDeps,
): Map<string, string> {
  const out = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const fn of names) {
    if (!/^\d+\.json$/.test(fn)) continue;
    let data: { pid?: unknown; sessionIDs?: unknown; titles?: unknown };
    let mtime: number;
    try {
      mtime = statSync(join(dir, fn)).mtimeMs / 1000;
      data = JSON.parse(readFileSync(join(dir, fn), "utf8"));
    } catch {
      continue;
    }
    const pid = data?.pid;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1)
      continue;
    if (!Array.isArray(data.sessionIDs) || !deps.isRunning(pid)) continue;
    const started = deps.procStartEpoch(pid, String(mtime));
    if (started !== null && started > mtime + START_TOLERANCE_SECONDS) continue;
    const ids = data.sessionIDs.filter(
      (id): id is string => typeof id === "string",
    );
    const { titles } = data;
    if (!titles || typeof titles !== "object") continue;
    for (const [key, title] of Object.entries(titles as object)) {
      if (typeof title !== "string" || title === "") continue;
      const id = key === "root" ? ids.at(-1) : key;
      if (id !== undefined && ids.includes(id)) out.set(id, title);
    }
  }
  return out;
}
