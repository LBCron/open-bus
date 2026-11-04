// #393 (R393c): the daemon follows renames. A harness's own name change is an
// edge the daemon notices; the `rename` tool sets the name it asks the hub for;
// and both reach the wire as `rename` at the gate, or as a re-sent `agent_up`
// below it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DaemonFrame, daemonStatus } from "@ob/ipc";
import {
  RENAME_MIN_CLIENT,
  type ServerFrame,
  type ClientFrame as ToHub,
} from "@ob/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonHarness, stopAll } from "./helpers.ts";

afterEach(stopAll);

/** A valid wire machine id (base58). */
const MACHINE = "1111111111111111";
const ID = "mmmmmmmmmmmmmmm1";
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const dir = () => mkdtempSync(join(tmpdir(), "ob-ren-"));

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

/** A harness over a temp sessions dir: no real ~/.claude is ever read. */
const claudeHarness = (sessionsDir: string, over: object = {}) =>
  daemonHarness({
    // This build carries R393c, so it offers the `rename` tool.
    version: RENAME_MIN_CLIENT,
    statusRosterMs: 50,
    claude: {
      sessionsDir,
      socketsDir: join(sessionsDir, "return"),
      procStart: () => "t0",
      isRunning: () => true,
      ...over,
    },
  });

/**
 * Tells the daemon the hub's version, then waits until it has read it: the
 * `rename` gate is decided from it, and status reports it as `hub_version`.
 */
const gatedHub = async (h: Harness) => {
  await h.next("hello");
  h.toDaemon({
    id: "hv",
    type: "hello_ok",
    machine_id: MACHINE,
    machine_label: "laptop",
    server_version: RENAME_MIN_CLIENT,
  });
  await vi.waitFor(async () => {
    const st = await daemonStatus({ path: h.socketPath, timeoutMs: 2000 });
    expect(st.hub_version).toBe(RENAME_MIN_CLIENT);
  });
};

type FrameOf<T extends ToHub["type"]> = Extract<ToHub, { type: T }>;

/**
 * Answers the daemon's frames of one type, each id once, as a hub would.
 * Returns a function that stops answering.
 */
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

describe("the harness edge (#393)", () => {
  it("sends one rename when a Claude session file's name changes", async () => {
    const d = dir();
    writeSession(d, 4242, "alpha");
    const h = await claudeHarness(d, { syncMs: 20 });
    await h.next("agent_up");
    await gatedHub(h);
    expect(h.of("rename")).toEqual([]);

    writeSession(d, 4242, "beta");
    const rename = await h.next("rename");
    expect(rename).toMatchObject({
      agent_ref: "s4242",
      proposed_name: "beta",
      name_kind: "chosen",
    });
    // One edge, one frame: the same value read again proposes nothing.
    await settle();
    expect(h.of("rename")).toHaveLength(1);
  });

  it("re-reads the file after hello: a resumed custom title is a rename", async () => {
    const d = dir();
    // The session file has no title yet when the daemon registers it, so
    // Claude's default name is what both the file and the hello say.
    writeSession(d, 4242, undefined);
    // No sync after startup: only the read that follows the hello can see it.
    const h = await claudeHarness(d, { syncMs: 3_600_000 });
    expect((await h.next("agent_up")).proposed_name).toBe("claude-4242");
    await gatedHub(h);

    // The resumed session's custom title lands in the file.
    writeSession(d, 4242, "ob-manager");
    await h.adapter("s4242", { pid: 4242, proposed_name: "claude-4242" });

    const rename = await h.next("rename");
    expect(rename).toMatchObject({
      agent_ref: "s4242",
      proposed_name: "ob-manager",
      name_kind: "chosen",
    });
    await settle();
    expect(h.of("rename")).toHaveLength(1);
  });

  it("a restarted session with no name yet keeps the name it had (#393)", async () => {
    const d = dir();
    writeSession(d, 4242, "ob-manager");
    const h = await claudeHarness(d, { syncMs: 20 });
    expect((await h.next("agent_up")).proposed_name).toBe("ob-manager");
    await gatedHub(h);

    // The session goes away, then comes back with the same sessionId, a new
    // pid and no name in its fresh file: the pid default must not rename it.
    rmSync(join(d, "4242.json"));
    await vi.waitFor(() =>
      expect(h.of("sessions").at(-1)?.closed ?? []).toContain("s4242"),
    );
    writeFileSync(
      join(d, "5151.json"),
      JSON.stringify({
        pid: 5151,
        sessionId: "s4242",
        procStart: "t0",
        cwd: "/repo",
      }),
    );
    const up = await vi.waitFor(async () => {
      const found = h
        .of("agent_up")
        .find(
          (f) => f.agent_ref === "s4242" && f.proposed_name === "ob-manager",
        );
      expect(found).toBeDefined();
      return found as Extract<ToHub, { type: "agent_up" }>;
    });
    expect(up.proposed_name).toBe("ob-manager");
    expect(
      h.of("agent_up").some((f) => f.proposed_name === "claude-5151"),
    ).toBe(false);
  });

  it("takes a live agent's later hello as the harness's own edge", async () => {
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 50,
      claude: { syncMs: 3_600_000 },
    });
    await gatedHub(h);
    await h.adapter("A", { kind: "pi", proposed_name: "alpha" });
    await h.next("agent_up");
    // Codex and Pi hello per call: each one re-reads the harness's own name.
    await h.adapter("A", { kind: "pi", proposed_name: "beta" });
    expect(await h.next("rename")).toMatchObject({
      agent_ref: "A",
      proposed_name: "beta",
      name_kind: "chosen",
    });
    // The same value in a later hello is not an edge.
    await h.adapter("A", { kind: "pi", proposed_name: "beta" });
    await settle();
    expect(h.of("rename")).toHaveLength(1);
  });

  it("sends nothing when the re-read agrees with the hello", async () => {
    const d = dir();
    writeSession(d, 4242, "alpha");
    const h = await claudeHarness(d, { syncMs: 3_600_000 });
    await h.next("agent_up");
    await gatedHub(h);

    await h.adapter("s4242", { pid: 4242, proposed_name: "alpha" });
    await settle();
    expect(h.of("rename")).toEqual([]);
    expect(h.of("agent_up")).toHaveLength(1);
  });
});

describe("the rename tool (#393)", () => {
  it("is proposed to the hub and answered with the updated self", async () => {
    const d = dir();
    writeSession(d, 4242, "alpha");
    const h = await claudeHarness(d, { syncMs: 3_600_000 });
    await h.next("agent_up");
    await gatedHub(h);
    const a = await h.adapter("s4242", { pid: 4242, proposed_name: "alpha" });
    const stop = answerEach(h, "rename", (f) => ({
      v: 1,
      id: f.id,
      type: "renamed",
      agent_ref: "s4242",
      bus_name: "beta",
      former: "alpha",
    }));

    const reply = await a.request({ type: "rename", name: "beta" });
    stop();
    expect(reply).toMatchObject({ type: "agent", agent: { name: "beta" } });
    expect(await h.next("rename")).toMatchObject({
      agent_ref: "s4242",
      proposed_name: "beta",
      name_kind: "chosen",
    });
  });

  it("survives the next sync, and a later harness edge overrides it", async () => {
    const d = dir();
    writeSession(d, 4242, "alpha");
    const h = await claudeHarness(d, { syncMs: 20 });
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
    // Several syncs read the file's unchanged "alpha": the tool's choice stands.
    await settle(200);
    expect(h.of("rename")).toHaveLength(1);
    expect(h.of("agent_up")).toHaveLength(1);

    // A real harness edge then wins: the later of the two acts.
    writeSession(d, 4242, "gamma");
    await vi.waitFor(() => expect(h.of("rename")).toHaveLength(2));
    stop();
    expect(h.of("rename")[1]).toMatchObject({
      agent_ref: "s4242",
      proposed_name: "gamma",
    });
  });

  it("re-sends agent_up to a hub below the gate, with no name_kind", async () => {
    const d = dir();
    writeSession(d, 4242, "alpha");
    const h = await claudeHarness(d, { syncMs: 3_600_000 });
    await h.next("agent_up");
    // No hello_ok: the hub's version is unknown, so it gets no `rename`.
    const a = await h.adapter("s4242", { pid: 4242, proposed_name: "alpha" });
    const first = h.of("agent_up")[0]?.id;
    const stop = answerEach(h, "agent_up", (f) =>
      f.id === first
        ? undefined
        : {
            v: 1,
            id: f.id,
            type: "agent_ok",
            agent_ref: f.agent_ref,
            bus_name: f.proposed_name,
          },
    );
    const reply = await a.request({ type: "rename", name: "beta" });
    stop();
    expect(reply).toMatchObject({ agent: { name: "beta" } });
    const up = h.of("agent_up")[1];
    expect(up).toMatchObject({ agent_ref: "s4242", proposed_name: "beta" });
    expect(up).not.toHaveProperty("name_kind");
    expect(h.of("rename")).toEqual([]);
  });

  it("falls back to agent_up once when the hub cannot read a rename", async () => {
    const d = dir();
    writeSession(d, 4242, "alpha");
    const h = await claudeHarness(d, { syncMs: 3_600_000 });
    await h.next("agent_up");
    await gatedHub(h);
    const a = await h.adapter("s4242", { pid: 4242, proposed_name: "alpha" });
    // A hub with R393a but not R393b: it refuses the frame it cannot read.
    const stopRename = answerEach(h, "rename", (f) => ({
      v: 1,
      id: f.id,
      type: "error",
      code: "bad_frame",
      message: "Unreadable frame",
    }));
    const first = h.of("agent_up")[0]?.id;
    const stopUp = answerEach(h, "agent_up", (f) =>
      f.id === first
        ? undefined
        : {
            v: 1,
            id: f.id,
            type: "agent_ok",
            agent_ref: f.agent_ref,
            bus_name: f.proposed_name,
          },
    );
    const reply = await a.request({ type: "rename", name: "beta" });
    stopRename();
    stopUp();
    expect(reply).toMatchObject({ agent: { name: "beta" } });
    // One rename tried, then exactly one agent_up for it.
    expect(h.of("rename")).toHaveLength(1);
    expect(h.of("agent_up")).toHaveLength(2);
    expect(h.of("agent_up")[1]).toMatchObject({ proposed_name: "beta" });
  });

  it("reaches the caller when the hub refuses it", async () => {
    const d = dir();
    writeSession(d, 4242, "alpha");
    const h = await claudeHarness(d, { syncMs: 3_600_000 });
    await h.next("agent_up");
    await gatedHub(h);
    const a = await h.adapter("s4242", { pid: 4242, proposed_name: "alpha" });
    const stop = answerEach(h, "rename", (f) => ({
      v: 1,
      id: f.id,
      type: "error",
      code: "rate_limited",
      message: "Too many renames",
    }));
    const reply = await a.request({ type: "rename", name: "beta" });
    stop();
    expect(reply).toMatchObject({
      type: "error",
      code: "rate_limited",
      message: "Too many renames",
    });
  });
});

type Pushed = Extract<DaemonFrame, { type: "renamed" }>;

describe("the adapter gate (#393)", () => {
  it("pushes renamed, former names and to_name only at the gate", async () => {
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 50,
      claude: { syncMs: 3_600_000 },
    });
    await gatedHub(h);
    const old = await h.adapter("A", { kind: "omp", proposed_name: "alpha" });
    const now = await h.adapter("B", {
      kind: "pi",
      proposed_name: "bravo",
      client_version: RENAME_MIN_CLIENT,
    });
    // A roster with a former name, for either client's own `list`.
    const stopList = answerEach(h, "list", (f) => ({
      v: 1,
      id: f.id,
      type: "roster",
      agents: [
        {
          bus_name: "peer",
          kind: "pi",
          namespace: "ns",
          global: false,
          state: "live",
          former_names: [
            { name: "older", expires_at: "2026-11-04T12:00:00.000Z" },
          ],
        },
      ],
    }));

    // A rename of the gated Pi session: its own link hears about it.
    const stopRename = answerEach(h, "rename", (f) => ({
      v: 1,
      id: f.id,
      type: "renamed",
      agent_ref: "B",
      bus_name: f.proposed_name,
      former: "bravo",
    }));
    const pushes: Pushed[] = [];
    now.onRenamed((f) => pushes.push(f));
    expect(
      await now.request({ type: "rename", name: "charlie" }),
    ).toMatchObject({ agent: { name: "charlie" } });
    stopRename();
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]).toMatchObject({ name: "charlie", former: "bravo" });

    // The old adapter sees no former names and gets no push.
    const oldPushes: Pushed[] = [];
    old.onRenamed((f) => oldPushes.push(f));
    const oldList = await old.request({ type: "list" });
    if (oldList.type !== "roster") throw new Error("expected a roster");
    expect(oldList.agents[0]).toMatchObject({ name: "peer" });
    expect(oldList.agents[0]).not.toHaveProperty("former_names");
    const nowList = await now.request({ type: "list" });
    if (nowList.type !== "roster") throw new Error("expected a roster");
    expect(nowList.agents[0]?.former_names?.[0]?.name).toBe("older");

    // A former-name receipt's to_name reaches only the gated adapter.
    const stopSend = answerEach(h, "send", (f) => ({
      v: 1,
      id: f.id,
      type: "receipt",
      msg_id: ID,
      state: "pending",
      to_name: "peer",
    }));
    const oldSend = await old.request({ type: "send", to: "old", body: "hi" });
    if (oldSend.type !== "receipt") throw new Error("expected a receipt");
    expect(oldSend).not.toHaveProperty("to_name");
    const nowSend = await now.request({ type: "send", to: "old", body: "hi" });
    if (nowSend.type !== "receipt") throw new Error("expected a receipt");
    expect(nowSend.to_name).toBe("peer");
    stopSend();
    stopList();
    // Nothing was ever pushed at the old adapter's link.
    await settle();
    expect(oldPushes).toEqual([]);
  });
});

describe("an OpenCode presence title (#393)", () => {
  it("is not a rename source: the adapter's hello carries the slug", async () => {
    const presence = dir();
    const write = (title: string) =>
      writeFileSync(
        join(presence, "4242.json"),
        JSON.stringify({
          pid: 4242,
          sessionIDs: ["ses_root"],
          titles: { root: title },
        }),
      );
    write("opencode");
    const h = await daemonHarness({
      version: RENAME_MIN_CLIENT,
      statusRosterMs: 50,
      claude: { syncMs: 20 },
      opencode: {
        presenceDir: presence,
        openSessions: () => new Set(["ses_root"]),
        isRunning: () => true,
        procStart: () => "t0",
      },
    });
    const a = await h.adapter("ses_root", {
      kind: "opencode",
      proposed_name: "opencode",
      cwd: "/repo",
    });
    expect(a.welcome.bus_name).toBe("opencode");
    await h.next("agent_up");
    await gatedHub(h);
    await settle();
    expect(h.of("rename")).toEqual([]);

    // A raw title is never proposed: the adapter sends `nameOf(title)`, so
    // reading the title here too would alternate the two forms every 2 s.
    write("Fix the flaky test");
    await settle();
    expect(h.of("rename")).toEqual([]);

    // The hello is the source, and it proposes the slug.
    await h.adapter("ses_root", {
      kind: "opencode",
      proposed_name: "fix-the-flaky-test",
      cwd: "/repo",
    });
    const rename = await vi.waitFor(() => {
      const found = h.of("rename")[0];
      expect(found).toBeDefined();
      return found as Extract<ToHub, { type: "rename" }>;
    });
    expect(rename).toMatchObject({
      agent_ref: "ses_root",
      proposed_name: "fix-the-flaky-test",
      name_kind: "chosen",
    });
  });
});
