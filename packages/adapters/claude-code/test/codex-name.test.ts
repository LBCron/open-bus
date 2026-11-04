// The Codex thread name (#393e): `threads.name` in $CODEX_HOME/state_5.sqlite,
// read-only, and every miss is the harness default rather than an error.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  codexHome,
  codexThreadName,
  DEFAULT_CODEX_NAME,
} from "../src/codex-name.ts";

const THREAD = "01a1a66f-4e10-7c31-89e7-edbb4fd5b73a";

// The real CODEX_HOME is never read: HOME is a sentinel in tests, and every
// call below names a temp home. This keeps an ambient var out of it too.
delete process.env.CODEX_HOME;

/** A temp CODEX_HOME with a `threads` table shaped like Codex 0.166's (§5). */
function codexHomeWith(
  rows: { id: string; name: string | null }[] = [],
  opts: { wal?: boolean; columns?: string } = {},
): { home: string; db: DatabaseSync } {
  const home = mkdtempSync(join(tmpdir(), "ob-codex-name-"));
  writeFileSync(join(home, "config.toml"), "");
  // The writer stays open: the name is then only in the WAL, as in Codex.
  const db = new DatabaseSync(join(home, "state_5.sqlite"));
  if (opts.wal !== false) db.exec("PRAGMA journal_mode = WAL");
  db.exec(
    `CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', name ${opts.columns ?? "TEXT"})`,
  );
  const insert = db.prepare("INSERT INTO threads (id, name) VALUES (?, ?)");
  for (const row of rows) insert.run(row.id, row.name);
  return { home, db };
}

describe("the Codex thread name", () => {
  it("follows `threads.name`, which /rename sets (thread/name/set)", () => {
    const { home, db } = codexHomeWith([
      { id: THREAD, name: "ob-manager" },
      { id: "01a1a66f-0000-7000-8000-000000000000", name: "someone-else" },
    ]);
    expect(codexThreadName(THREAD, { home })).toBe("ob-manager");
    // The row is only in the WAL here: the writer is still open. `immutable=1`
    // would see no `threads` table at all (docs/probes/codex.md §5).
    db.prepare("UPDATE threads SET name = ? WHERE id = ?").run(
      "renamed-later",
      THREAD,
    );
    expect(codexThreadName(THREAD, { home })).toBe("renamed-later");
    db.close();
  });

  it("reads the name a /rename wrote while Codex still holds the db", () => {
    const { home, db } = codexHomeWith([{ id: THREAD, name: null }]);
    expect(codexThreadName(THREAD, { home })).toBe(DEFAULT_CODEX_NAME);
    db.prepare("UPDATE threads SET name = ? WHERE id = ?").run(
      "chosen-name",
      THREAD,
    );
    // No checkpoint, no sleep: the WAL is read as it is.
    expect(codexThreadName(THREAD, { home })).toBe("chosen-name");
    db.close();
  });

  it.each<[string, string | null]>([
    ["a NULL name", null],
    ["an empty name", ""],
    ["a whitespace name", "  \t "],
  ])("%s leaves the name `codex`", (_, name) => {
    const { home, db } = codexHomeWith([{ id: THREAD, name }]);
    expect(codexThreadName(THREAD, { home })).toBe("codex");
    db.close();
  });

  it("trims a name and cuts it to the wire's 64 characters", () => {
    const { home, db } = codexHomeWith([
      { id: THREAD, name: "  padded-name  " },
    ]);
    expect(codexThreadName(THREAD, { home })).toBe("padded-name");
    db.prepare("UPDATE threads SET name = ? WHERE id = ?").run(
      "x".repeat(80),
      THREAD,
    );
    expect(codexThreadName(THREAD, { home })).toBe("x".repeat(64));
    db.close();
  });

  it("keeps the name well-formed when the db holds a lone surrogate", () => {
    const { home, db } = codexHomeWith([{ id: THREAD, name: `ab\uD800cd` }]);
    expect(codexThreadName(THREAD, { home })).toBe("ab\uFFFDcd");
    db.close();
  });

  it("a thread with no row is a miss", () => {
    const { home, db } = codexHomeWith([]);
    expect(codexThreadName(THREAD, { home })).toBe("codex");
    db.close();
  });

  it("is `codex` when node:sqlite is not there (Node before 22.13)", () => {
    const { home, db } = codexHomeWith([{ id: THREAD, name: "ob-manager" }]);
    expect(codexThreadName(THREAD, { home, load: () => undefined })).toBe(
      "codex",
    );
    db.close();
  });

  it.each<[string, () => string]>([
    [
      "no CODEX_HOME at all",
      () => mkdtempSync(join(tmpdir(), "ob-codex-name-none-")),
    ],
    [
      "a schema without a `name` column",
      () => {
        const home = mkdtempSync(join(tmpdir(), "ob-codex-name-old-"));
        const db = new DatabaseSync(join(home, "state_5.sqlite"));
        db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)");
        db.prepare("INSERT INTO threads VALUES (?, 'a title')").run(THREAD);
        db.close();
        return home;
      },
    ],
    [
      "a schema without a `threads` table",
      () => {
        const home = mkdtempSync(join(tmpdir(), "ob-codex-name-none-"));
        const db = new DatabaseSync(join(home, "state_5.sqlite"));
        db.exec("CREATE TABLE other (id TEXT)");
        db.close();
        return home;
      },
    ],
    [
      "a state_5.sqlite that is not a database",
      () => {
        const home = mkdtempSync(join(tmpdir(), "ob-codex-name-junk-"));
        writeFileSync(join(home, "state_5.sqlite"), "not a database at all");
        return home;
      },
    ],
    [
      "a state_5.sqlite that is a directory",
      () => {
        const home = mkdtempSync(join(tmpdir(), "ob-codex-name-dir-"));
        mkdirSync(join(home, "state_5.sqlite"));
        return home;
      },
    ],
    [
      "an older state_4",
      () => {
        const home = mkdtempSync(join(tmpdir(), "ob-codex-name-v4-"));
        const db = new DatabaseSync(join(home, "state_4.sqlite"));
        db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT)");
        db.prepare("INSERT INTO threads VALUES (?, 'ob-manager')").run(THREAD);
        db.close();
        return home;
      },
    ],
  ])("%s is a miss, not an error", (_, home) => {
    expect(codexThreadName(THREAD, { home: home() })).toBe("codex");
  });

  it("a locked db is a miss, not a crash", () => {
    const home = mkdtempSync(join(tmpdir(), "ob-codex-name-locked-"));
    const path = join(home, "state_5.sqlite");
    const writer = new DatabaseSync(path);
    // A rollback-journal db held EXCLUSIVE is the case a reader cannot wait
    // out: WAL lets a reader through, this does not (docs/probes/codex.md §5).
    writer.exec("PRAGMA journal_mode = DELETE");
    writer.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT)");
    writer.prepare("INSERT INTO threads VALUES (?, 'ob-manager')").run(THREAD);
    writer.exec("BEGIN EXCLUSIVE");
    expect(codexThreadName(THREAD, { home, timeoutMs: 20 })).toBe("codex");
    writer.exec("ROLLBACK");
    // Once the writer is done, the same call reads it.
    expect(codexThreadName(THREAD, { home })).toBe("ob-manager");
    writer.close();
  });

  it("a HOME without a .codex reads the default, with no throw", () => {
    const home = mkdtempSync(join(tmpdir(), "ob-codex-name-unset-"));
    expect(codexThreadName(THREAD, { home })).toBe("codex");
    expect(codexThreadName(THREAD, { home: join(home, "missing") })).toBe(
      "codex",
    );
  });
});

describe("codexHome", () => {
  it("is $CODEX_HOME when set, else ~/.codex, always absolute", () => {
    const home = process.env.HOME ?? "";
    expect(codexHome({ CODEX_HOME: "/tmp/ob-codex-home" })).toBe(
      "/tmp/ob-codex-home",
    );
    expect(codexHome({ CODEX_HOME: "" })).toBe(join(home, ".codex"));
    expect(codexHome({})).toBe(join(home, ".codex"));
    expect(codexHome({ CODEX_HOME: "relative/codex" }).startsWith("/")).toBe(
      true,
    );
  });
});
