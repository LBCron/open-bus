import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Api = (
  op: string,
  params: Record<string, string>,
) => Promise<Record<string, unknown> | undefined>;

/** `opencode api` finds the service and carries its password; nothing here reads OpenCode's config. */
export const opencodeApi: Api = async (op, params) => {
  const args = ["api", op];
  for (const [k, v] of Object.entries(params))
    args.push("--param", `${k}=${v}`);
  const { stdout } = await run("opencode", args, { timeout: 15_000 });
  const data = (JSON.parse(stdout) as { data?: unknown }).data;
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : undefined;
};

/** The agent a session id belongs to, the directory its namespace comes from, and its title. */
export type OpenCodeSession = {
  root: string;
  directory: string | null;
  title: string | null;
};

/**
 * What never changes once a session exists: its root and the root's
 * directory. The title is deliberately not here (#393): a session is renamed
 * by retitling it, and a cached title would hide that for the whole life of
 * the service.
 */
type Root = { root: string; directory: string | null };

const MAX_DEPTH = 32;
const ROOTS = new Map<string, Root>();

export type RootDeps = {
  api: Api;
  /** A parent never changes once a session exists, so these entries never go stale. */
  cache?: Map<string, Root>;
  maxDepth?: number;
};

/** A session's title, as OpenCode has it now; null when it has none yet. */
const titleOf = (s: Record<string, unknown> | undefined): string | null =>
  typeof s?.title === "string" ? s.title : null;

function directoryOf(s: Record<string, unknown>): string | null {
  const loc = s.location as { directory?: unknown } | undefined;
  const dir = s.directory ?? loc?.directory;
  return typeof dir === "string" && isAbsolute(dir) ? dir : null;
}

/** A root as found: `fresh` is the read it came from, when it was not cached. */
type Found = Root & { fresh?: Record<string, unknown> };

/**
 * The root conversation behind a session id, cached. Null when the server
 * cannot answer, the chain cycles or runs past the cap: "cannot tell" is
 * never cached.
 */
async function findRoot(
  sessionId: string,
  deps: RootDeps,
): Promise<Found | null> {
  const cache = deps.cache ?? ROOTS;
  const cached = cache.get(sessionId);
  if (cached) return cached;
  const seen = [sessionId];
  let cur = sessionId;
  for (let depth = 0; ; depth += 1) {
    if (depth >= (deps.maxDepth ?? MAX_DEPTH)) return null;
    let s: Record<string, unknown> | undefined;
    try {
      s = await deps.api("session.get", { sessionID: cur });
    } catch {
      return null;
    }
    if (!s) return null;
    const parent = s.parentID;
    if (typeof parent !== "string" || !parent) {
      const found: Root = { root: cur, directory: directoryOf(s) };
      for (const id of seen) cache.set(id, found);
      return { ...found, fresh: s };
    }
    if (seen.includes(parent)) return null;
    seen.push(parent);
    cur = parent;
  }
}

/**
 * A sub-agent's calls carry the child id; the agent is the root conversation.
 * Its title is read fresh on every call (#393): retitling the root session is
 * how OpenCode renames an agent, and the daemon has no other title source.
 */
export async function rootSession(
  sessionId: string,
  deps: RootDeps,
): Promise<OpenCodeSession | null> {
  const found = await findRoot(sessionId, deps);
  if (!found) return null;
  let now = found.fresh;
  if (!now) {
    try {
      now = await deps.api("session.get", { sessionID: found.root });
    } catch {
      return null;
    }
  }
  if (!now) return null;
  return { root: found.root, directory: found.directory, title: titleOf(now) };
}

/** The root session's id, or `sessionId` unchanged when it cannot be told. */
export async function rootOf(
  sessionId: string,
  deps: RootDeps,
): Promise<string> {
  return (await findRoot(sessionId, deps))?.root ?? sessionId;
}
