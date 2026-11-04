// #430 (0.66.0): the rename gate must work before a link's hello_ok, a
// Codex fallback must say it is one, a tool rename must survive the next sync
// back to the harness's name, and a restart must keep the name it was given.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonStatus } from "@ob/ipc";
import {
  RENAME_MIN_CLIENT,
  type ServerFrame,
  type ClientFrame as ToHub,
} from "@ob/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nameKindOf } from "../src/rename.ts";
import { daemonHarness, stopAll } from "./helpers.ts";

afterEach(stopAll);

const MACHINE = "1111111111111111";
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const dir = () => mkdtempSync(join(tmpdir(), "ob-430-"));
const tempFile = (name: string) => join(dir(), name);

/** A Claude session file, as `~/.claude/sessions/<pid>.json`: `name` is what `/rename` writes. */
const writeSession = (d: string, pid: number, name: string | undefined) =>
  writeFileSync(
    join(d, `${pid}.json`),
    JSON.stringify({
      pid,
      sessionId: `s${pid}`,
      procStart: "t0",
      cwd: "/repo",
      ...(name === undefined ? {} : { name }),
    }),
  );

type Harness = Awaited<ReturnType<typeof daemonHarness>>;
type FrameOf<T extends ToHub["type"]> = Extract<ToHub, { type: T }>;

/** Tells the daemon the hub's version, then waits until it has read it. */
const gatedHub = async (h: Harness, version = RENAME_MIN_CLIENT) => {
  await h.next("hello");
  h.toDaemon({
    id: "hv",
    type: "hello_ok",
    machine_id: MACHINE,
    machine_label: "laptop",
    server_version: version,
  });
  await vi.waitFor(async () => {
    const st = await daemonStatus({ path: h.socketPath, timeoutMs: 2000 });
    expect(st.hub_version).toBe(version);
  });
};

/** Answers the daemon's frames of one type, each id once, as a hub would. */
function answerEach<T extends ToHub["type"]>(
  h: Harness,
  type: T,
  answer: (f: FrameOf<T>) => ServerFrame | undefined,
): () => void {
  const seen = new Set<string>();
  const tick = setInterval(() => {
    for (const f of h.of(type)) {
      const id = (f as { id: string }).id;
      if (seen.has(id)) continue;
      seen.add(id);
      const reply = answer(f as FrameOf<T>);
      if (reply) h.toDaemon(reply);
    }
  }, 10);
  tick.unref();
  return () => clearInterval(tick);
}

/** A hub that registers every agent under the name it proposed. */
const answerUps = (h: Harness) =>
  answerEach(h, "agent_up", (f) => ({
    v: 1,
    id: f.id,
    type: "agent_ok",
    agent_ref: f.agent_ref,
    bus_name: f.proposed_name,
  }));

describe("#430 item 1: name_kind before a link's hello_ok", () => {
  it("re-announces a live agent with its name_kind when the link comes back", async () => {
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
    });
    await gatedHub(h);
    await h.adapter("A", { kind: "pi", proposed_name: "alpha" });
    expect((await h.next("agent_up")).name_kind).toBe("chosen");

    // The link drops: the replay that follows is before the next hello_ok.
    const first = h.hubSock();
    first?.terminate();
    await vi.waitFor(() => expect(h.hubSock()).not.toBe(first));
    const again = await h.next("agent_up", 2);
    expect(again).toMatchObject({ agent_ref: "A", proposed_name: "alpha" });
    expect(again.name_kind).toBe("chosen");
  });

  it("writes the version it saw, and gates a cold start from it", async () => {
    const file = tempFile("hub-version.json");
    const seen = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
      hubVersionFile: file,
    });
    await gatedHub(seen);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      version: RENAME_MIN_CLIENT,
    });
    await stopAll();

    // A new daemon: its first agent_up is replayed at onOpen, before any
    // hello_ok, and still says whose name it is.
    const sessions = dir();
    writeSession(sessions, 4242, "alpha");
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
      hubVersionFile: file,
      claude: {
        sessionsDir: sessions,
        procStart: () => "t0",
        isRunning: () => true,
        syncMs: 3_600_000,
      },
    });
    const up = await h.next("agent_up");
    expect(up).toMatchObject({ agent_ref: "s4242", proposed_name: "alpha" });
    expect(up.name_kind).toBe("chosen");
  });

  it("drops name_kind for good when the hub refuses it, after one retry", async () => {
    const file = tempFile("hub-version.json");
    writeFileSync(file, JSON.stringify({ version: RENAME_MIN_CLIENT }));
    const sessions = dir();
    writeSession(sessions, 4242, "alpha");
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
      hubVersionFile: file,
      claude: {
        sessionsDir: sessions,
        procStart: () => "t0",
        isRunning: () => true,
        syncMs: 3_600_000,
      },
    });

    const up = await h.next("agent_up");
    expect(up.name_kind).toBe("chosen");
    // The remembered version was too new for this hub.
    h.toDaemon({
      id: up.id,
      type: "error",
      code: "bad_frame",
      message: "Unreadable frame",
    });
    const retry = await h.next("agent_up", 2);
    expect(retry.proposed_name).toBe("alpha");
    expect(retry).not.toHaveProperty("name_kind");
    // One retry only, and the record now says the hub is below the gate.
    await settle();
    expect(h.of("agent_up")).toHaveLength(2);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      below_gate: true,
    });

    // A hello_ok is the hub's own word: it is believed again.
    await gatedHub(h, RENAME_MIN_CLIENT);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      version: RENAME_MIN_CLIENT,
    });
  });
});

describe("#430: whose name a Codex agent has", () => {
  it("reads the fallback as default and a thread name as chosen", () => {
    expect(nameKindOf("codex", "codex")).toBe("default");
    expect(nameKindOf("codex", "fix-the-flaky-test")).toBe("chosen");
    // The other kinds are unchanged.
    expect(nameKindOf("pi", "pi")).toBe("default");
    expect(nameKindOf("pi", "alpha")).toBe("chosen");
    expect(nameKindOf("claude-code", "claude-4242")).toBe("default");
    expect(nameKindOf("claude-code", "ob-manager")).toBe("chosen");
  });

  it("announces a fallback as default, so the next Codex is not pushed off it", async () => {
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
    });
    await gatedHub(h);
    const stop = answerUps(h);
    await h.adapter("t1", {
      kind: "codex",
      proposed_name: "codex",
      cwd: "/repo",
    });
    expect(await h.next("agent_up")).toMatchObject({
      agent_ref: "t1",
      proposed_name: "codex",
      name_kind: "default",
    });

    // A name from the thread db is the user's own.
    await h.adapter("t2", {
      kind: "codex",
      proposed_name: "nightly-triage",
      cwd: "/repo",
    });
    expect(await h.next("agent_up", 2)).toMatchObject({
      agent_ref: "t2",
      proposed_name: "nightly-triage",
      name_kind: "chosen",
    });
    stop();
  });
});

describe("#430: a tool rename, and the harness's own name", () => {
  it("hears a harness rename back to the name it had before a tool rename", async () => {
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
    });
    await gatedHub(h);
    await h.adapter("A", { kind: "pi", proposed_name: "alpha" });
    await h.next("agent_up");
    const a = await h.adapter("A", { kind: "pi", proposed_name: "alpha" });

    // The tool renames the agent. Pi writes the name back into the session,
    // so the harness's own name is now `beta` too.
    const stop = answerEach(h, "rename", (f) => ({
      v: 1,
      id: f.id,
      type: "renamed",
      agent_ref: "A",
      bus_name: f.proposed_name,
      former: "alpha",
    }));
    expect(await a.request({ type: "rename", name: "beta" })).toMatchObject({
      type: "agent",
      agent: { name: "beta" },
    });
    stop();

    // The user renames the session back to what it was. It is a change from
    // what the harness last said, so it must reach the hub.
    const back = await h.adapter("A", { kind: "pi", proposed_name: "alpha" });
    expect(back.welcome.bus_name).toBe("beta");
    const rename = await h.next("rename", 2);
    expect(rename).toMatchObject({ agent_ref: "A", proposed_name: "alpha" });
    expect(rename.name_kind).toBe("chosen");
  });

  it("keeps a tool rename across a daemon restart", async () => {
    const sessions = dir();
    writeSession(sessions, 4242, "alpha");
    const namesFile = tempFile("names.json");
    const claude = {
      sessionsDir: sessions,
      procStart: () => "t0",
      isRunning: () => true,
      syncMs: 3_600_000,
    };
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
      namesFile,
      claude,
    });
    expect((await h.next("agent_up")).proposed_name).toBe("alpha");
    await gatedHub(h);
    const a = await h.adapter("s4242", { pid: 4242, proposed_name: "alpha" });
    const stop = answerEach(h, "rename", (f) => ({
      v: 1,
      id: f.id,
      type: "renamed",
      agent_ref: "s4242",
      bus_name: f.proposed_name,
      former: "alpha",
    }));
    expect(await a.request({ type: "rename", name: "beta" })).toMatchObject({
      agent: { name: "beta" },
    });
    stop();
    expect(JSON.parse(readFileSync(namesFile, "utf8"))).toEqual({
      s4242: "beta",
    });
    await stopAll();

    // A restarted daemon proposes the name it was given, not the harness's
    // `alpha`: otherwise the hub renames it back and reserves `beta` for an
    // hour against the very agent that chose it.
    const restarted = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
      namesFile,
      claude,
    });
    const up = await restarted.next("agent_up");
    expect(up).toMatchObject({ agent_ref: "s4242", proposed_name: "beta" });
    await settle();
    expect(restarted.of("rename")).toEqual([]);
  });

  it("lets a later harness rename take the kept name over", async () => {
    const sessions = dir();
    writeSession(sessions, 4242, "alpha");
    const namesFile = tempFile("names.json");
    const claude = {
      sessionsDir: sessions,
      procStart: () => "t0",
      isRunning: () => true,
      syncMs: 20,
    };
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
      namesFile,
      claude,
    });
    await h.next("agent_up");
    await gatedHub(h);
    const a = await h.adapter("s4242", { pid: 4242, proposed_name: "alpha" });
    const stop = answerEach(h, "rename", (f) => ({
      v: 1,
      id: f.id,
      type: "renamed",
      agent_ref: "s4242",
      bus_name: f.proposed_name,
      former: "alpha",
    }));
    expect(await a.request({ type: "rename", name: "beta" })).toMatchObject({
      agent: { name: "beta" },
    });
    expect(JSON.parse(readFileSync(namesFile, "utf8"))).toEqual({
      s4242: "beta",
    });
    // The user renames in Claude itself: the harness's file wins.
    writeSession(sessions, 4242, "gamma");
    await vi.waitFor(() => expect(h.of("rename")).toHaveLength(2));
    stop();
    expect(JSON.parse(readFileSync(namesFile, "utf8"))).toEqual({});
    await stopAll();

    const restarted = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 10,
      namesFile,
      claude,
    });
    expect((await restarted.next("agent_up")).proposed_name).toBe("gamma");
  });
});
