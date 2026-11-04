// The Codex e2e's stack (C26g): the real server under `wrangler dev`, the real
// daemon from the CLI bundle, the pinned Codex CLI in a temp CODEX_HOME, and a
// Pi-kind peer on the daemon's socket. Every process is spawned here in its own
// process group and stopped by that pid only.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { lstartEpoch, procStartOf, psRows } from "@ob/daemon";
import {
  CLIENT_VERSION,
  connectDaemon,
  type DaemonClient,
  type DaemonFrame,
  daemonStatus,
  Hello,
} from "@ob/ipc";
import { TEST_CARD_JWK } from "@ob/shared/mocks";
import { eventually, tmpDir, workspace } from "../staging/harness.ts";

const root = join(import.meta.dirname, "../..");

/** This run's temp root: homes, hub state, logs. Removed when the run passes. */
export const RUN = tmpDir("cx");
/** A fresh folder under RUN. */
export function scratch(name: string): string {
  const dir = join(RUN, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
/** Each process's output, kept in a file and dumped when a test fails. */
export const LOGS = scratch("logs");
export function logTail(lines = 60): string {
  return readdirSync(LOGS)
    .map((file) => {
      const text = readFileSync(join(LOGS, file), "utf8");
      return `── ${file} ──\n${text.split("\n").slice(-lines).join("\n")}`;
    })
    .join("\n");
}

const owned = new Map<
  number,
  { name: string; child: ChildProcess; start: string | undefined }
>();

/** One live group for globalSetup's teardown: its leader and the leader's lstart. */
export type Listed = { pid: number; start: string };

/**
 * The live process groups, for globalSetup's teardown: it kills what is
 * listed if this worker died without its afterAll (setup.ts, `pidFile`).
 * Written whole to a temp file and renamed, so a reader never sees half.
 */
let pidFile: string | undefined;
export function trackPids(file: string): void {
  pidFile = file;
}
const writePids = () => {
  if (!pidFile) return;
  const listed: Listed[] = [...owned].flatMap(([pid, o]) =>
    o.start ? [{ pid, start: o.start }] : [],
  );
  writeFileSync(`${pidFile}.tmp`, JSON.stringify(listed));
  renameSync(`${pidFile}.tmp`, pidFile);
};

/** SIGKILL every group this suite started. Sync: it runs on exit and signals. */
export function killAllSync(): void {
  for (const pid of owned.keys())
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  owned.clear();
  writePids();
}
// A Ctrl-C or a dying worker skips afterAll; the groups are detached, so
// nothing else reaches them.
process.once("exit", killAllSync);
// Then the signal again, now unhandled, so the worker dies of it: vitest
// stubs process.exit in workers, and a listener alone keeps it alive.
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.once(sig, () => {
    killAllSync();
    process.kill(process.pid, sig);
  });

/** Spawns `cmd` in its own process group, its output to LOGS/<name>.log. */
export function start(
  name: string,
  cmd: string,
  args: string[],
  o: { cwd?: string; env: NodeJS.ProcessEnv; stdin?: "pipe" | "ignore" },
): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: o.cwd ?? root,
    env: o.env,
    detached: true,
    stdio: [o.stdin ?? "ignore", "pipe", "pipe"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error(`${name} did not start`);
  const log = createWriteStream(join(LOGS, `${name}.log`));
  child.stderr?.pipe(log);
  // A JSON-lines peer reads stdout itself.
  if (o.stdin !== "pipe") child.stdout?.pipe(log);
  // The leader's start time lets teardown tell this group from a reused pid.
  owned.set(pid, { name, child, start: psRows([pid]).get(pid)?.start });
  writePids();
  child.once("exit", () => {
    // The leader is gone; a child it left (workerd under wrangler, codex's
    // MCP servers) is still in the group. ESRCH when none is.
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
    owned.delete(pid);
    writePids();
  });
  return child;
}

/** Stops one process group this suite started; never anything else. */
export async function stop(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || !owned.has(pid)) return;
  const gone = new Promise<void>((r) => child.once("exit", () => r()));
  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
  const t = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }, 5_000);
  await gone;
  clearTimeout(t);
}

export async function stopAll(): Promise<void> {
  await Promise.all([...owned.values()].map(({ child }) => stop(child)));
}

export const exited = (child: ChildProcess): Promise<number | null> =>
  child.exitCode !== null
    ? Promise.resolve(child.exitCode)
    : new Promise((r) => child.once("exit", (code) => r(code)));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/**
 * PATH for every child: the pinned codex first, then node, then the system's
 * bin. No sbin, as under the launchd service: the daemon runs lsof by its
 * absolute path (C26j).
 */
export const childPath = (codexBin: string): string =>
  [join(codexBin, ".."), join(process.execPath, ".."), "/usr/bin", "/bin"].join(
    ":",
  );

// ── the server ─────────────────────────────────────────────────────────────

export type Machine = {
  hub: string;
  machine_id: string;
  label: string;
  machine_token: string;
};

/**
 * `wrangler dev` on wrangler.e2e.jsonc (loopback only, never deployed), on a
 * free port with its own state dir, so it never meets another run's hub.
 * Resolves once its seed route answers, with this run's one machine.
 */
export async function startServer(): Promise<{
  child: ChildProcess;
  machine: Machine;
}> {
  const port = await freePort();
  const inspector = await freePort();
  const vars = {
    ENVIRONMENT: "dev",
    APP_HOST: `127.0.0.1:${port}`,
    OWNER_EMAIL: "owner@example.com",
    ACCESS_TEAM_DOMAIN: "team.example.cloudflareaccess.com",
    ACCESS_CLIENT_ID: "dev-client",
    ACCESS_CLIENT_SECRET: "dev-secret",
    SESSION_SECRET: "dev-session-secret-0123456789abcdef-xyz",
    // The shared test key: the hub signs cards with it in dev only (AC4a).
    CARD_SIGNING_KEY: JSON.stringify(TEST_CARD_JWK),
    CARD_OWNER_SALT: "e2e-card-owner-salt-0123456789abcdefghijklmnopqr",
  };
  const home = scratch("wrangler");
  const child = start(
    "wrangler",
    process.execPath,
    [
      join(root, "apps/server/node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "-c",
      "wrangler.e2e.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspector),
      "--persist-to",
      scratch("hub"),
      "--show-interactive-dev-session=false",
      ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
    ],
    {
      cwd: join(root, "apps/server"),
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        WRANGLER_SEND_METRICS: "false",
        CI: "1",
      },
    },
  );
  const hub = `http://127.0.0.1:${port}`;
  const machine = await eventually(
    async () => {
      if (child.exitCode !== null)
        throw new Error(`wrangler exited ${child.exitCode}`);
      const res = await fetch(`${hub}/__e2e/machine`, {
        method: "POST",
        headers: { "X-OB-E2E": "1" },
        body: JSON.stringify({ label: "codex-e2e" }),
      });
      if (res.status !== 200) throw new Error(`seed: ${res.status}`);
      return (await res.json()) as Machine;
    },
    { timeoutMs: 90_000, intervalMs: 250 },
  );
  return { child, machine };
}

// ── the daemon ─────────────────────────────────────────────────────────────

export type Homes = { home: string; obHome: string; codexHome: string };

/** The real daemon from the bundle, logged in as `machine`, its hub link up. */
export async function startDaemon(
  cliBundle: string,
  codexBin: string,
  machine: Machine,
  h: Homes,
): Promise<{ child: ChildProcess; socket: string }> {
  mkdirSync(h.obHome, { recursive: true, mode: 0o700 });
  const file = join(h.obHome, "machine.json");
  writeFileSync(file, `${JSON.stringify(machine)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  const child = start("daemon", process.execPath, [cliBundle, "daemon"], {
    env: {
      HOME: h.home,
      OPENBUS_HOME: h.obHome,
      CODEX_HOME: h.codexHome,
      PATH: childPath(codexBin),
    },
  });
  // Short enough on both runners: the daemon only moves it when it does not fit.
  const socket = join(h.obHome, "daemon.sock");
  await eventually(
    async () => {
      if (child.exitCode !== null)
        throw new Error(`daemon exited ${child.exitCode}`);
      const s = await daemonStatus({ path: socket, timeoutMs: 2_000 });
      if (s.hub !== "connected") throw new Error(`hub ${s.hub}`);
    },
    { timeoutMs: 30_000, intervalMs: 100 },
  );
  return { child, socket };
}

// ── Codex ──────────────────────────────────────────────────────────────────

/**
 * CODEX_HOME's config.toml: the fake model, and our MCP entry as C26e writes
 * it (exactly `[mcp_servers.openbus]`, tools pre-approved, CODEX_HOME in env).
 */
export function writeCodexConfig(
  h: Homes,
  o: { model: string; cliBundle: string },
): void {
  mkdirSync(h.codexHome, { recursive: true });
  const s = JSON.stringify;
  writeFileSync(
    join(h.codexHome, "config.toml"),
    [
      `model = "stub-model"`,
      `model_provider = "stub"`,
      `approval_policy = "never"`,
      `sandbox_mode = "read-only"`,
      ``,
      `[model_providers.stub]`,
      `name = "stub"`,
      `base_url = ${s(o.model)}`,
      `wire_api = "responses"`,
      `requires_openai_auth = false`,
      ``,
      `[mcp_servers.openbus]`,
      `command = ${s(process.execPath)}`,
      `args = [${s(o.cliBundle)}, "mcp", "codex"]`,
      `default_tools_approval_mode = "approve"`,
      `env = { OPENBUS_HOME = ${s(h.obHome)}, CODEX_HOME = ${s(h.codexHome)} }`,
      ``,
    ].join("\n"),
  );
}

/** What every codex process gets: the temp homes, nothing of the user's. */
export const codexEnv = (h: Homes, codexBin: string): NodeJS.ProcessEnv => ({
  HOME: h.home,
  CODEX_HOME: h.codexHome,
  PATH: childPath(codexBin),
  TERM: "dumb",
});

/**
 * A git work tree whose `.openbus.json` sets `namespace`. Codex 0.165 names
 * the thread's directory only as a `workspaces` root, which it sends for a
 * git work tree.
 */
export function codexWorkspace(namespace: string): string {
  const dir = workspace(namespace);
  execFileSync("git", ["-C", dir, "init", "-q"], {
    stdio: "ignore",
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  return dir;
}

/** One app-server JSON-RPC line: a reply, or a notification about a thread. */
type Rpc = {
  id?: number;
  method?: string;
  params?: { threadId?: string };
  result?: unknown;
  error?: unknown;
};

/** `codex app-server` over stdio, as the desktop app runs it. */
export type AppServer = {
  child: ChildProcess;
  notes: Rpc[];
  request: <T>(method: string, params: object) => Promise<T>;
  /** Resolves with the first notification (seen or to come) that matches. */
  next: (f: (n: Rpc) => boolean, from?: number) => Promise<Rpc>;
};

export async function appServer(
  codexBin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  /** More `codex app-server` arguments, such as `-c` overrides. */
  args: string[] = [],
): Promise<AppServer> {
  const child = start("app-server", codexBin, ["app-server", ...args], {
    cwd,
    env,
    stdin: "pipe",
  });
  const notes: Rpc[] = [];
  const waiting = new Map<number, (m: Rpc) => void>();
  const watchers = new Set<() => void>();
  const out = createWriteStream(join(LOGS, "app-server.out.log"));
  createInterface({ input: child.stdout as NodeJS.ReadableStream }).on(
    "line",
    (line) => {
      out.write(`${line}\n`);
      const m = JSON.parse(line) as Rpc;
      if (m.id !== undefined && !m.method) {
        waiting.get(m.id)?.(m);
        waiting.delete(m.id);
      } else {
        notes.push(m);
        for (const w of watchers) w();
      }
    },
  );
  let seq = 0;
  const send = (m: object) => child.stdin?.write(`${JSON.stringify(m)}\n`);
  const request = <T>(method: string, params: object) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, (m) =>
        m.error
          ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`))
          : resolve(m.result as T),
      );
      send({ id, method, params });
    });
  const next = (f: (n: Rpc) => boolean, from = 0) =>
    new Promise<Rpc>((resolve) => {
      const check = () => {
        const hit = notes.slice(from).find(f);
        if (!hit) return false;
        watchers.delete(check as () => void);
        resolve(hit);
        return true;
      };
      if (!check()) watchers.add(check as () => void);
    });
  await request("initialize", {
    clientInfo: { name: "ob-e2e", title: null, version: "0" },
    capabilities: null,
  });
  send({ method: "initialized" });
  return { child, notes, request, next };
}

/** The pid of the native `codex` under the npm shim `shim` (ps, both platforms). */
export function nativeCodexPid(shim: number): number {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/));
  const hit = rows.find(
    ([, ppid, comm]) => Number(ppid) === shim && comm?.endsWith("codex"),
  );
  if (!hit) throw new Error(`no codex under ${shim}`);
  return Number(hit[0]);
}

/**
 * Resolves once the codex under `shim` is past its first second. The daemon
 * admits only a call written after the second its codex started (check 3:
 * lstart has one-second resolution), and the fake model answers within it.
 */
export async function pastFirstSecond(shim: number): Promise<void> {
  const pid = await eventually(() => nativeCodexPid(shim), {
    timeoutMs: 20_000,
    intervalMs: 50,
  });
  const start = lstartEpoch(psRows([pid]).get(pid)?.start ?? null);
  if (start === null) throw new Error(`no start time for codex ${pid}`);
  const at = (start + 1) * 1000;
  if (Date.now() < at) await new Promise((r) => setTimeout(r, at - Date.now()));
}

// ── the peer ───────────────────────────────────────────────────────────────

export type Peer = {
  client: DaemonClient;
  delivered: Extract<DaemonFrame, { type: "deliver" }>[];
};

/**
 * A Pi-kind session in this test process: Pi's attestation is this pid and
 * its start time, both real. It acks every delivery, as the Pi extension does.
 */
export async function peer(
  socket: string,
  ref: string,
  name: string,
  cwd: string,
  /** The adapter's IPC marker; an older one sees no agent card fields. */
  clientVersion = CLIENT_VERSION,
): Promise<Peer> {
  const proc_start = procStartOf(process.pid);
  if (!proc_start) throw new Error("no start time for this process");
  const client = await connectDaemon({
    path: socket,
    hello: Hello.parse({
      v: 1,
      id: `h-${ref}`,
      type: "hello",
      kind: "pi",
      // The IPC marker: without it the daemon shows codex rows as pi (legacyKind).
      client_version: clientVersion,
      agent_ref: ref,
      pid: process.pid,
      cwd,
      proposed_name: name,
      attest: { proc_start },
    }),
  });
  const delivered: Peer["delivered"] = [];
  client.onDeliver((f) => {
    delivered.push(f);
    client.ack(f.msg_id);
  });
  return { client, delivered };
}
