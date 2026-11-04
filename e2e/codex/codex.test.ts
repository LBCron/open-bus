// C26g: Codex end to end, with no API key and no network. The pinned Codex CLI
// runs in a temp CODEX_HOME against a fake Responses model (fake-model.ts),
// with `[mcp_servers.openbus]` running `open-bus mcp codex` from the CLI
// bundle; the real daemon from the same bundle; the real server under
// `wrangler dev`. A Pi-kind peer on the daemon's socket is the other end.
//
//   pnpm e2e:codex
import type { ChildProcess } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CODEX_REFUSALS } from "@ob/daemon";
import {
  CARD_COPY,
  connectDaemon,
  Hello,
  HelloRefused,
  statusSetText,
} from "@ob/ipc";
import { AGENT_CARD_MIN_CLIENT, CardClaimsSchema } from "@ob/shared";
import { TEST_CARD_JWK } from "@ob/shared/mocks";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import {
  assertNoOuterConfig,
  eventually,
  SENTINEL_HOME,
  sentinelWrites,
} from "../staging/harness.ts";
import { type FakeAnthropic, fakeAnthropic } from "./fake-anthropic.ts";
import {
  codePrompt,
  type FakeModel,
  fakeModel,
  toolsPrompt,
} from "./fake-model.ts";
import {
  jwks,
  linkApp,
  type Owner,
  type OwnerAgent,
  ownerSession,
  verifyCard,
} from "./owner.ts";
import {
  type AppServer,
  appServer,
  childPath,
  codexEnv,
  codexWorkspace,
  exited,
  type Homes,
  logTail,
  nativeCodexPid,
  type Peer,
  pastFirstSecond,
  peer,
  RUN,
  scratch,
  start,
  startDaemon,
  startServer,
  stop,
  stopAll,
  trackPids,
  writeCodexConfig,
} from "./stack.ts";

const codexBin = inject("codexBin");
const claudeBin = inject("claudeBin");
const cliBundle = inject("cliBundle");
trackPids(inject("pidFile"));

let model: FakeModel;
let homes: Homes;
let socket: string;
/** The server's origin. */
let hub: string;
let env: NodeJS.ProcessEnv;
const peers: Peer[] = [];

let failed = false;
/** Every process's log tail and what the fake models saw; the temp root is kept. */
function dump(why: string): void {
  failed = true;
  const seen = (xs: object[] | undefined) =>
    (xs ?? [])
      .slice(-20)
      .map((x) => JSON.stringify(x).slice(0, 300))
      .join("\n");
  console.error(
    [
      `${why}; temp root kept: ${RUN}`,
      logTail(),
      `── fake model (last 20) ──\n${seen(model?.seen)}`,
      `── fake anthropic (last 20) ──\n${seen(anthropicSeen)}`,
    ].join("\n"),
  );
}
/** A beforeAll whose failure dumps first: afterEach never runs for it. */
const setUp = (fn: () => Promise<void>) =>
  beforeAll(async () => {
    try {
      await fn();
    } catch (e) {
      dump(`setup failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  });
let anthropicSeen: object[] | undefined;

setUp(async () => {
  assertNoOuterConfig();
  homes = {
    home: scratch("home"),
    obHome: scratch("ob"),
    codexHome: scratch("codex"),
  };
  model = await fakeModel();
  writeCodexConfig(homes, { model: model.url, cliBundle });
  env = codexEnv(homes, codexBin);
  const server = await startServer();
  hub = server.machine.hub;
  ({ socket } = await startDaemon(cliBundle, codexBin, server.machine, homes));
});

afterEach((ctx) => {
  if (ctx.task.result?.state === "fail") dump(`failed: ${ctx.task.name}`);
});

afterAll(async () => {
  for (const p of peers) p.client.close();
  await stopAll();
  await model?.close();
  // Nothing went to the harness's sentinel HOME: every path was threaded.
  expect(sentinelWrites(), SENTINEL_HOME).toEqual([]);
  if (!failed) rmSync(RUN, { recursive: true, force: true });
  else console.error(`temp root kept: ${RUN}`);
});

const onThread = (thread: string) =>
  model.seen.filter((s) => s.thread === thread);
/** The output Codex handed the model for this thread's `tool` call. */
const outputOf = (thread: string, tool: string) =>
  onThread(thread).find((s) => s.answers === tool)?.output ?? "";

/** Rows `codex queue` wrote for `thread` (read-only: Codex owns the file). */
function queuedFor(thread: string): number {
  const file = join(homes.codexHome, "queue_1.sqlite");
  if (!existsSync(file)) return 0;
  const db = new DatabaseSync(file, {
    readOnly: true,
  });
  try {
    const row = db
      .prepare("SELECT count(*) AS n FROM queued_items WHERE thread_id = ?")
      .get(thread) as { n: number };
    return Number(row.n);
  } finally {
    db.close();
  }
}

async function joinPeer(
  ns: string,
  name: string,
  cwd: string,
  clientVersion?: string,
) {
  const p = await peer(socket, `${name}-${ns}`, name, cwd, clientVersion);
  peers.push(p);
  return p;
}

const OPENBUS_TOOLS = [
  "list_agents",
  "send_message",
  "self",
  "set_status",
  "card",
].map((t) => `mcp__openbus__${t}`);

let claudeRuns = 0;
/**
 * `claude -p prompt` in `cwd` against `anthropic`, with `open-bus mcp claude`
 * from the bundle and the openbus tools pre-approved.
 */
function startClaude(
  anthropic: FakeAnthropic,
  cwd: string,
  prompt: string,
): ChildProcess {
  const config = join(scratch("claude"), "mcp.json");
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        openbus: {
          command: process.execPath,
          args: [cliBundle, "mcp", "claude"],
          env: { OPENBUS_HOME: homes.obHome },
        },
      },
    }),
  );
  return start(
    claudeRuns++ ? `claude-${claudeRuns}` : "claude",
    claudeBin,
    [
      "-p",
      prompt,
      "--mcp-config",
      config,
      "--strict-mcp-config",
      "--allowedTools",
      OPENBUS_TOOLS.join(","),
      "--max-turns",
      "8",
    ],
    {
      cwd,
      env: {
        // The daemon's HOME: it reads this Claude's ~/.claude/sessions.
        HOME: homes.home,
        PATH: childPath(codexBin),
        ANTHROPIC_BASE_URL: anthropic.url,
        ANTHROPIC_API_KEY: "sk-ant-e2e-not-a-key",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
      },
    },
  );
}

describe("codex exec", () => {
  let thread: string;
  let p: Peer;
  let ws: string;

  it("joins as codex, is attested, lists agents and delivers to the peer", async () => {
    ws = codexWorkspace("cx-exec");
    p = await joinPeer("exec", "peer", ws);
    const run = start(
      "codex-exec",
      codexBin,
      ["exec", "ob-e2e send peer hello from exec"],
      { cwd: ws, env },
    );
    const ready = pastFirstSecond(run.pid as number);
    // Its failure surfaces through hold; never as an unhandled rejection.
    ready.catch(() => {});
    let during: unknown;
    model.hold = async (tool) => {
      await ready;
      // Mid-turn, after list_agents admitted the thread: the peer's view of it.
      if (tool === "send_message")
        during = await p.client.request({ type: "list" });
    };
    expect(await exited(run)).toBe(0);

    const turn = model.seen.filter((s) => s.user.startsWith("ob-e2e send"));
    thread = turn[0]?.thread ?? "";
    expect(thread).not.toBe("");
    // list_agents went through the daemon and the hub: the roster has both.
    expect(outputOf(thread, "list_agents")).toMatch(/^- peer \(pi, cx-exec,/m);
    expect(during).toMatchObject({
      type: "roster",
      agents: expect.arrayContaining([
        expect.objectContaining({ name: "codex", kind: "codex", live: true }),
      ]),
    });
    // send_message: attested (a refused thread gets "did not accept"), then Delivered.
    expect(outputOf(thread, "send_message")).toMatch(/Delivered to peer/);
    expect(p.delivered).toEqual([
      expect.objectContaining({
        from_name: "codex",
        namespace: "cx-exec",
        body: "hello from exec",
      }),
    ]);
  });

  it("is not woken after exit: offline semantics, and no codex queue runs", async () => {
    const before = onThread(thread).length;
    const r = await p.client.request({
      type: "send",
      to: "codex",
      body: "after exit",
    });
    // The thread closed with its process: the hub expires mail to it.
    expect(r).toMatchObject({
      type: "receipt",
      state: "expired",
      reason: "recipient_closed",
    });
    // A wake would come after the receipt: watch a bounded window for one.
    const until = Date.now() + 3_000;
    while (Date.now() < until) {
      expect(queuedFor(thread)).toBe(0);
      expect(onThread(thread).length).toBe(before);
      await new Promise((r) => setTimeout(r, 100));
    }
    // No `codex queue` ran at all: the daemon writes codex-queued.json at its
    // first one, and this is the first Codex delivery this daemon has seen.
    expect(
      existsSync(join(homes.obHome, "codex-queued.json")),
      "codex-queued.json: a codex queue ran",
    ).toBe(false);
  });
});

describe("codex exec in code mode (C27)", () => {
  it("each exec's OpenBus call is attested by its item; a second in one exec is told to use its own", async () => {
    const ws = codexWorkspace("cx-code");
    const p = await joinPeer("code", "peer", ws);
    const run = start(
      "codex-code",
      codexBin,
      [
        "exec",
        "-c",
        "features.code_mode_only=true",
        codePrompt([
          [["list_agents", {}]],
          [["send_message", { to: "peer", text: "hello from code mode" }]],
          [
            ["self", {}],
            ["self", {}],
          ],
        ]),
      ],
      { cwd: ws, env },
    );
    const ready = pastFirstSecond(run.pid as number);
    ready.catch(() => {});
    model.hold = async () => {
      await ready;
    };
    expect(await exited(run)).toBe(0);
    const turn = model.seen.filter((s) => s.user.startsWith("ob-e2e code"));
    const thread = turn[0]?.thread ?? "";
    expect(thread).not.toBe("");
    const outs = onThread(thread)
      .filter((s) => s.answers === "exec")
      .map((s) => s.output ?? "");
    expect(outs).toHaveLength(3);
    expect(outs[0]).toMatch(/- peer \(pi, cx-code,/);
    expect(outs[1]).toMatch(/Delivered to peer/);
    expect(p.delivered).toEqual([
      expect.objectContaining({
        from_name: "codex",
        namespace: "cx-code",
        body: "hello from code mode",
      }),
    ]);
    // The exec's first call is admitted; its second is refused, retryably.
    expect(outs[2]).toContain(
      "this exec already made an OpenBus call. Make each OpenBus call in its own exec.",
    );
    expect(outs[2].match(/did not accept/g)).toHaveLength(1);
  });
});

describe("codex app-server (the desktop app's mode)", () => {
  let app: AppServer;
  let thread: string;
  let p: Peer;
  let ws: string;

  setUp(async () => {
    ws = codexWorkspace("cx-app");
    p = await joinPeer("app", "peer", ws);
    app = await appServer(codexBin, ws, env);
    const ready = pastFirstSecond(app.child.pid as number);
    ready.catch(() => {});
    model.hold = () => ready;
    // As the desktop app starts a user's thread (app.asar: threadSource `user`).
    thread = (
      await app.request<{ thread: { id: string } }>("thread/start", {
        cwd: ws,
        threadSource: "user",
      })
    ).thread.id;
  });
  afterAll(async () => {
    if (app) await stop(app.child);
  });

  it("joins as codex and delivers to the peer", async () => {
    const from = app.notes.length;
    await app.request("turn/start", {
      threadId: thread,
      input: [
        {
          type: "text",
          text: "ob-e2e send peer hello from app",
          text_elements: [],
        },
      ],
    });
    await app.next((n) => n.method === "turn/completed", from);
    expect(outputOf(thread, "list_agents")).toMatch(/^- peer \(pi, cx-app,/m);
    expect(await p.client.request({ type: "list" })).toMatchObject({
      type: "roster",
      agents: expect.arrayContaining([
        expect.objectContaining({ name: "codex", kind: "codex", live: true }),
      ]),
    });
    expect(outputOf(thread, "send_message")).toMatch(/Delivered to peer/);
    expect(p.delivered).toEqual([
      expect.objectContaining({ from_name: "codex", body: "hello from app" }),
    ]);
  });

  it("an idle thread is woken by codex queue: a turn starts with the message", async () => {
    const from = app.notes.length;
    const r = await p.client.request({
      type: "send",
      to: "codex",
      body: "wake up, codex",
    });
    expect(r).toMatchObject({ type: "receipt", state: "delivered" });
    const started = await app.next((n) => n.method === "turn/started", from);
    expect(started.params?.threadId).toBe(thread);
    const woke = await eventually(
      () => {
        const s = onThread(thread).find((x) =>
          x.user.includes("wake up, codex"),
        );
        if (!s) throw new Error("the model has not seen the message");
        return s;
      },
      { timeoutMs: 30_000 },
    );
    expect(woke.user).toMatch(/^\[openbus\] Message from peer/);
    await app.next((n) => n.method === "turn/completed", from);
  });

  it("the woken thread replies over the bus", async () => {
    const from = app.notes.length;
    const replies = p.delivered.length;
    const r = await p.client.request({
      type: "send",
      to: "codex",
      body: "ob-e2e send peer pong",
    });
    expect(r).toMatchObject({ type: "receipt", state: "delivered" });
    // The woken turn (`codex queue`) runs the script: list_agents, then
    // send_message back to the peer.
    await app.next(
      (n) => n.method === "turn/completed" && n.params?.threadId === thread,
      from,
    );
    const woken = onThread(thread).filter((s) =>
      s.user.includes("ob-e2e send peer pong"),
    );
    expect(woken.find((s) => s.answers === "send_message")?.output).toMatch(
      /Delivered to peer/,
    );
    expect(p.delivered.slice(replies)).toEqual([
      expect.objectContaining({ from_name: "codex", body: "pong" }),
    ]);
  });

  it("refuses a forged caller: a process that is not codex's child claims the thread", async () => {
    const callId = onThread(thread).find((s) => s.answers === "send_message")
      ?.last.call_id;
    const hello = Hello.parse({
      v: 1,
      id: "forged",
      type: "hello",
      kind: "codex",
      agent_ref: thread,
      pid: process.pid,
      cwd: ws,
      proposed_name: "codex",
      codex: {
        thread_id: thread,
        call_id: callId ?? "call_1",
        ppid: nativeCodexPid(app.child.pid as number),
        thread_source: "user",
      },
    });
    const err = await connectDaemon({ path: socket, hello }).then(
      (c) => {
        c.close();
        return undefined;
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HelloRefused);
    expect((err as HelloRefused).reason).toContain(CODEX_REFUSALS.notCodex);
  });
});

// Claude Code, the same way: `claude -p` against a fake Messages API with a
// dummy key (no login, no network), `open-bus mcp claude` from the bundle.
describe("claude -p", () => {
  let anthropic: FakeAnthropic;
  afterAll(async () => {
    await anthropic?.close();
  });

  it("joins as claude-code, lists agents and delivers to the peer", async () => {
    anthropic = await fakeAnthropic();
    anthropicSeen = anthropic.seen;
    const ws = codexWorkspace("cc");
    const p = await joinPeer("cc", "peer", ws);
    const run = startClaude(
      anthropic,
      ws,
      "ob-e2e send peer hello from claude",
    );
    expect(await exited(run)).toBe(0);
    const out = (tool: string) =>
      anthropic.seen.find((s) => s.answers === tool)?.output ?? "";
    // Itself (named for its directory) and the peer.
    expect(out("list_agents")).toMatch(/\(claude-code, cc,/);
    expect(out("list_agents")).toMatch(/^- peer \(pi, cc,/m);
    expect(out("send_message")).toMatch(/Delivered to peer/);
    expect(p.delivered).toEqual([
      expect.objectContaining({ namespace: "cc", body: "hello from claude" }),
    ]);
  });
});

// AC5d: the agent card end to end. A Codex thread (app-server) and Claude
// sessions in one namespace; the owner reads and writes through the
// dashboard's REST with a dev-login session. Status, then the card, then
// an adapter below the gate.
describe("agent card (AC5d)", () => {
  const NS = "cx-card";
  const AUD = "https://artifacts.example.com";
  const OTHER = "https://other.example.com";
  const nonce = (n: number) => `e2e-nonce-${String(n).padStart(8, "0")}`;
  let app: AppServer;
  let thread: string;
  let ws: string;
  /** At the gate, and one below it (a 0.46.3 adapter). */
  let p: Peer;
  let old: Peer;
  let owner: Owner;
  let anthropic: FakeAnthropic;
  let codexId: string;
  /** Whether the hub signs cards (AC4b); probed by the not_linked case. */
  let signs = false;

  setUp(async () => {
    ws = codexWorkspace(NS);
    p = await joinPeer("card", "peer", ws, AGENT_CARD_MIN_CLIENT);
    old = await joinPeer("card", "old", ws, "0.46.3");
    owner = await ownerSession(hub);
    anthropic = await fakeAnthropic();
    anthropicSeen = anthropic.seen;
    app = await appServer(codexBin, ws, env);
    const ready = pastFirstSecond(app.child.pid as number);
    ready.catch(() => {});
    model.hold = () => ready;
    thread = (
      await app.request<{ thread: { id: string } }>("thread/start", {
        cwd: ws,
        threadSource: "user",
      })
    ).thread.id;
  });
  afterAll(async () => {
    if (app) await stop(app.child);
    await anthropic?.close();
  });

  /** One Codex turn calling `calls` in order: each call's output. */
  async function turn(calls: [string, object][]): Promise<string[]> {
    const from = app.notes.length;
    const seen = model.seen.length;
    await app.request("turn/start", {
      threadId: thread,
      input: [{ type: "text", text: toolsPrompt(calls), text_elements: [] }],
    });
    await app.next(
      (n) => n.method === "turn/completed" && n.params?.threadId === thread,
      from,
    );
    const outs = model.seen
      .slice(seen)
      .filter((s) => s.thread === thread && s.answers);
    expect(outs.map((s) => s.answers)).toEqual(calls.map(([t]) => t));
    // Codex prefixes an MCP result with its wall time.
    return outs.map((s) =>
      (s.output ?? "").replace(/^Wall time: [\d.]+ seconds\nOutput:\n/, ""),
    );
  }

  /** The owner's REST row for the first agent of `kind` that `ok` accepts. */
  const restRow = (
    kind: string,
    ok: (a: OwnerAgent) => boolean,
    timeoutMs = 10_000,
  ) =>
    eventually(
      async () => {
        const rows = await owner.agents(NS);
        const row = rows.find((a) => a.kind === kind && ok(a));
        if (!row)
          throw new Error(`no such ${kind} row: ${JSON.stringify(rows)}`);
        return row;
      },
      { timeoutMs, intervalMs: 100 },
    );

  const rosterRow = async (peerOf: Peer, name: string) => {
    const r = await peerOf.client.request({ type: "list" });
    if (r.type !== "roster") throw new Error(`list: ${r.type}`);
    return r.agents.find((a) => a.name === name);
  };

  describe("status", () => {
    it("a Codex thread's set_status shows on the REST roster and the roster", async () => {
      const [out] = await turn([
        ["set_status", { state: "working", label: "writing tests" }],
      ]);
      expect(out).toBe(statusSetText("working", "writing tests"));
      // An outer bound only: the hub's tests own the 2 s timing.
      const row = await restRow("codex", (a) => a.status === "working", 10_000);
      expect(row).toMatchObject({
        name: "codex",
        status: "working",
        statusLabel: "writing tests",
      });
      codexId = row.id;
      expect(await rosterRow(p, "codex")).toMatchObject({
        status: "working",
        status_label: "writing tests",
      });
    });

    it("Claude's set_status (no label) and Codex's each show in the other's list_agents", async () => {
      let release = () => {};
      const released = new Promise<void>((r) => {
        release = r;
      });
      // Claude stays open after its list_agents until Codex has listed.
      anthropic.hold = (s) =>
        s.answers === "list_agents" ? released : Promise.resolve();
      const from = anthropic.seen.length;
      const run = startClaude(
        anthropic,
        ws,
        toolsPrompt([
          ["set_status", { state: "blocked" }],
          ["list_agents", {}],
        ]),
      );
      try {
        const claudeList = await eventually(
          () => {
            const s = anthropic.seen
              .slice(from)
              .find((x) => x.answers === "list_agents");
            if (!s) throw new Error("claude has not listed");
            return s;
          },
          { timeoutMs: 45_000 },
        );
        expect(
          anthropic.seen.slice(from).find((x) => x.answers === "set_status")
            ?.output,
        ).toBe(statusSetText("blocked"));
        expect(claudeList.output).toMatch(
          /^- codex \(codex, cx-card[^)]*\) {2}agent says: working · "writing tests"$/m,
        );
        const row = await restRow("claude-code", (a) => a.status === "blocked");
        expect(row.statusLabel).toBeUndefined();
        const [codexList] = await turn([["list_agents", {}]]);
        expect(codexList).toContain(
          `- ${row.name} (claude-code, cx-card, codex-e2e)  agent says: blocked\n`,
        );
      } finally {
        release();
        anthropic.hold = undefined;
      }
      expect(await exited(run)).toBe(0);
    });

    it("the status clears when the agent closes", async () => {
      // A closed agent leaves the dashboard's roster, its status with it.
      await eventually(
        async () => {
          const rows = await owner.agents(NS);
          const left = rows.filter((a) => a.kind === "claude-code");
          if (left.length)
            throw new Error(`still open: ${JSON.stringify(left)}`);
        },
        { timeoutMs: 30_000 },
      );
      const r = await p.client.request({ type: "list" });
      expect(r).toMatchObject({ type: "roster" });
      expect(
        r.type === "roster" && r.agents.filter((a) => a.kind === "claude-code"),
      ).toEqual([]);
    });

    it("a re-join of the same name shows no status", async () => {
      // The same ref and name, as an agent that closes and comes back.
      const first = await peer(
        socket,
        "stat-card",
        "stat",
        ws,
        AGENT_CARD_MIN_CLIENT,
      );
      expect(
        await first.client.request({
          type: "set_status",
          state: "idle",
          label: "about to go",
        }),
      ).toMatchObject({ type: "status_set" });
      await restRow("pi", (a) => a.name === "stat" && a.status === "idle");
      first.client.close();
      await eventually(
        async () => {
          if ((await owner.agents(NS)).some((a) => a.name === "stat"))
            throw new Error("stat is still open");
        },
        { timeoutMs: 30_000 },
      );
      const again = await peer(
        socket,
        "stat-card",
        "stat",
        ws,
        AGENT_CARD_MIN_CLIENT,
      );
      peers.push(again);
      const row = await restRow("pi", (a) => a.name === "stat");
      for (const k of ["status", "statusLabel", "statusAt"])
        expect(row).not.toHaveProperty(k);
      const self = await again.client.request({ type: "self", card: true });
      expect(self).toMatchObject({ type: "agent", agent: { name: "stat" } });
      for (const k of ["status", "status_label", "status_at"])
        expect(self.type === "agent" && self.agent).not.toHaveProperty(k);
    });

    it("a burst of updates ends showing the last one", async () => {
      const steps = [1, 2, 3, 4, 5].map((i) => `step ${i}`);
      const outs = await turn(
        steps.map((label) => ["set_status", { state: "working", label }]),
      );
      expect(outs).toEqual(steps.map((l) => statusSetText("working", l)));
      // An outer bound only: the hub's tests own the 7 s timing.
      await restRow("codex", (a) => a.statusLabel === "step 5", 15_000);
      expect(await rosterRow(p, "codex")).toMatchObject({
        status_label: "step 5",
      });
    });
  });

  describe("card", () => {
    it("the hub publishes the card key's public half in its JWKS", async () => {
      const keys = await jwks(hub);
      expect(keys.keys).toEqual([
        {
          kty: "OKP",
          crv: "Ed25519",
          x: TEST_CARD_JWK.x,
          kid: TEST_CARD_JWK.kid,
          alg: "EdDSA",
        },
      ]);
    });

    it("a bad nonce is refused locally", async () => {
      const [out] = await turn([["card", { audience: AUD, nonce: "short" }]]);
      expect(out).toBe(CARD_COPY.bad_nonce);
    });

    it("an unlinked aud is refused not_linked", async (ctx) => {
      const [out] = await turn([
        ["card", { audience: OTHER, nonce: nonce(1) }],
      ]);
      // Until AC4b the hub answers card_request bad_frame, "not supported yet".
      signs = out !== CARD_COPY.bad_frame;
      if (!signs) ctx.skip("the hub does not sign cards yet (AC4b)");
      expect(out).toBe(CARD_COPY.not_linked);
    });

    it("a linked aud gets a card that verifies against the hub's JWKS", async (ctx) => {
      // `signs` is set by the not_linked case: run alone (-t), this skips.
      if (!signs) ctx.skip("the hub does not sign cards yet (AC4b)");
      expect(await linkApp(hub, AUD)).toBe(204);
      const [jwt] = await turn([["card", { audience: AUD, nonce: nonce(2) }]]);
      const { header, claims } = verifyCard(jwt ?? "", await jwks(hub));
      expect(header.kid).toBe(TEST_CARD_JWK.kid);
      expect(CardClaimsSchema.safeParse(claims).success).toBe(true);
      expect(claims).toMatchObject({
        aud: AUD,
        sub: codexId,
        nonce: nonce(2),
        name: "codex",
        kind: "codex",
      });
      const now = Date.now() / 1000;
      expect(claims.exp).toBeGreaterThan(now);
      expect(claims.exp).toBeLessThanOrEqual(now + 300 + 5);
    });
  });

  describe("below the gate", () => {
    it("an adapter below the gate sees none of the new fields", async () => {
      expect(await rosterRow(p, "codex")).toMatchObject({
        status: "working",
      });
      const row = await rosterRow(old, "codex");
      expect(row).toBeDefined();
      for (const k of ["status", "status_label", "status_at"])
        expect(row).not.toHaveProperty(k);
      const self = await old.client.request({ type: "self", card: true });
      expect(self.type === "agent" && Object.keys(self.agent ?? {})).toEqual(
        expect.not.arrayContaining(["status"]),
      );
    });
  });
});
