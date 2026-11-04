import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fitName } from "@ob/ipc";

/**
 * The name a Codex thread has on the bus until the user renames it. Codex
 * gives its MCP server no session name, so this is the whole fallback.
 */
export const DEFAULT_CODEX_NAME = "codex";

/** The db Codex keeps its threads in: `state_5.sqlite`, one per `CODEX_HOME`. */
const STATE_DB = "state_5.sqlite";

/**
 * `$CODEX_HOME`, or `~/.codex`: Codex's own rule (docs/probes/codex.md §1).
 * Codex filters the MCP server's env, so a custom `CODEX_HOME` reaches the
 * adapter only if the entry's `env` table passes it; otherwise the read below
 * misses and the name stays the default.
 */
export const codexHome = (
  env: Record<string, string | undefined> = process.env,
): string => resolve(env.CODEX_HOME || join(homedir(), ".codex"));

type Sqlite = typeof import("node:sqlite");

/**
 * `node:sqlite` when this Node has it (22.13 and up), undefined on an older
 * one. A builtin, so no dependency; loading it prints an experimental warning
 * on stderr, which MCP leaves alone (its channel is stdout).
 */
export function builtinSqlite(): Sqlite | undefined {
  return process.getBuiltinModule?.("node:sqlite") as Sqlite | undefined;
}

export type CodexNameDeps = {
  /** A `CODEX_HOME`; the real one is never read by a test. */
  home?: string;
  /** `node:sqlite`, injected so a test can take it away. */
  load?: () => Sqlite | undefined;
  /** How long a locked db may hold a call up before it counts as a miss. */
  timeoutMs?: number;
};

/**
 * The `name` column of the thread's row in `$CODEX_HOME/state_5.sqlite`, or
 * `codex`. Codex sets it from `thread/name/set`, which is what `/rename`
 * sends (not `title`, which is auto-derived), so a `/rename` in Codex is a
 * rename on the bus. Codex hellos are per call, so this is read on each call
 * and a change is a new edge.
 *
 * Read-only, never created, never written. Every way it can fail — no
 * `node:sqlite`, no db, a schema without `name`, a locked db, no row for the
 * thread, an empty value — is a miss that leaves the name `codex`; none is an
 * error. Not `immutable=1`: the db is in WAL mode and a fresh rename lives
 * only in the WAL until a checkpoint (docs/probes/codex.md §5).
 */
export function codexThreadName(
  threadId: string,
  deps: CodexNameDeps = {},
): string {
  try {
    const sqlite = (deps.load ?? builtinSqlite)();
    if (!sqlite) return DEFAULT_CODEX_NAME;
    const db = new sqlite.DatabaseSync(
      join(deps.home ?? codexHome(), STATE_DB),
      {
        readOnly: true,
        timeout: deps.timeoutMs ?? 200,
      },
    );
    try {
      const row = db
        .prepare("SELECT name FROM threads WHERE id = ?")
        .get(threadId) as { name?: unknown } | undefined;
      const name = row?.name;
      if (typeof name !== "string") return DEFAULT_CODEX_NAME;
      const trimmed = name.trim();
      // The wire allows 64; the hub slugs whatever arrives.
      return trimmed ? fitName(trimmed, 64) : DEFAULT_CODEX_NAME;
    } finally {
      db.close();
    }
  } catch {
    return DEFAULT_CODEX_NAME;
  }
}
