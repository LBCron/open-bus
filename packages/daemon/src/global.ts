import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { home } from "./config.ts";
import { readOwnFile } from "./own-file.ts";

/**
 * The user's global allowlist, `<OPENBUS_HOME>/global.json`: `{"dirs": [...]}`,
 * each an absolute realpath. The only source of `global`: a repo's
 * `.openbus.json` never grants it, so an untrusted clone cannot widen its reach.
 */
export const globalFile = (h = home()): string => join(h, "global.json");

/** `error` completes "<file> …": why the file grants nothing. */
export type GlobalDirs = { dirs: string[]; error?: string };

/**
 * How an entry is stored and shown: the volume's own case and spelling
 * (`realpathSync.native`). Never compared as a string: membership is by
 * identity (isGlobalDir). Throws when `path` does not resolve.
 */
export const canonicalPath = (path: string): string =>
  realpathSync.native(path);

/**
 * The allowlist. None when the file is missing; none with `error` (why it
 * cannot be used) when it is unreadable, malformed, or not safely ours: a
 * symlink, a FIFO, another user's, or writable by others.
 */
export function readGlobalDirs(file = globalFile()): GlobalDirs {
  const own = readOwnFile(file);
  if (own.state === "none") return { dirs: [] };
  if (own.state === "unsafe") return { dirs: [], error: own.why };
  try {
    const raw = JSON.parse(own.text) as { dirs?: unknown } | null;
    const dirs = raw?.dirs;
    if (
      !Array.isArray(raw) &&
      Array.isArray(dirs) &&
      dirs.every((d) => typeof d === "string" && isAbsolute(d))
    )
      return { dirs: dirs as string[] };
  } catch {}
  return { dirs: [], error: "is not valid JSON" };
}

/**
 * A directory's identity: the same folder however its path is spelled.
 * Caveat: some FUSE filesystems invent inode numbers, so two folders on one
 * may share an identity; the entry must still be an ancestor by name (below).
 */
const idOf = (path: string, follow = true): string | undefined => {
  try {
    const st = follow ? statSync(path) : lstatSync(path);
    return st.isDirectory() ? `${st.dev}:${st.ino}` : undefined;
  } catch {
    return undefined;
  }
};

/** Case- and form-blind, for the pre-filter only: never decides membership. */
const loose = (p: string) => p.normalize("NFC").toLowerCase();

/**
 * Whether `dir` is an entry. Membership is identity and exact: `dir`
 * (resolved) must be the same directory (device and inode) as an entry, so
 * two folders a case- or normalization-sensitive volume keeps apart never
 * match. A subdirectory of an entry is not global (#397): the allowlist names
 * a directory, not a subtree.
 *
 * An entry counts only while its stored path is still real
 * (`realpathSync.native(entry) === entry`): a repo that turns an allowlisted
 * folder, or one of its parents, into a symlink (`tools -> /`) must not carry
 * global elsewhere. `onStale` hears each entry skipped that way.
 *
 * Only an entry that is a loose string match of `dir` is touched, so an
 * unrelated entry on a hung network mount cannot stall a hello.
 */
export function isGlobalDir(
  dir: string,
  dirs: string[],
  onStale?: (entry: string) => void,
): boolean {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return false;
  }
  const near = loose(real);
  for (const entry of dirs) {
    if (loose(entry) !== near) continue;
    let still: string | undefined;
    try {
      still = realpathSync.native(entry);
    } catch {}
    if (still !== entry) {
      if (still !== undefined) onStale?.(entry);
      continue;
    }
    if (sameDir(entry, real)) return true;
  }
  return false;
}

/**
 * Whether allowlist `entry` names directory `dir`. As in isGlobalDir, an
 * entry counts only while its stored path is real: one that a symlink now
 * stands in never matches by identity.
 */
export function sameDir(entry: string, dir: string): boolean {
  try {
    if (realpathSync.native(entry) !== entry) return false;
  } catch {
    return false;
  }
  const id = idOf(entry, false);
  return id !== undefined && id === idOf(dir);
}

/**
 * Replaces the allowlist: 0600, written to a new file then renamed, never
 * through a symlink. Readers always see a whole file; two `global add`s at
 * once may lose one, since the last rename wins.
 */
export function writeGlobalDirs(dirs: string[], h = home()): void {
  mkdirSync(h, { recursive: true, mode: 0o700 });
  chmodSync(h, 0o700);
  const tmp = join(h, `.global.json.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, `${JSON.stringify({ dirs }, null, 2)}\n`);
  } catch (e) {
    closeSync(fd);
    unlinkSync(tmp);
    throw e;
  }
  closeSync(fd);
  try {
    chmodSync(tmp, 0o600);
    // rename replaces a symlink at global.json rather than following it.
    renameSync(tmp, globalFile(h));
  } catch (e) {
    unlinkSync(tmp);
    throw e;
  }
}
