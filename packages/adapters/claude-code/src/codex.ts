import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CLIENT_VERSION,
  type DaemonClient,
  Hello,
  HelloRefused,
  SPAWNED_SOURCES,
} from "@ob/ipc";
import {
  type CodexNameDeps,
  codexThreadName,
  DEFAULT_CODEX_NAME,
} from "./codex-name.ts";
import { callTool, TOOLS, type ToolResult } from "./tools.ts";

/** Codex sets this on every tools/call, next to `threadId` and `callId`; the model does not control it. */
export const TURN_META = "x-codex-turn-metadata";

/** The omp copy (pi/assets/openbus.ts), for Codex. */
export const SUBAGENT_REFUSAL =
  "openbus: a subagent is not on the bus; only the main Codex thread can use OpenBus";

/**
 * A daemon older than this adapter rejects the hello's shape (bad_frame)
 * until the service restarts on the new bundle (C26j).
 */
export const RESTART_REFUSAL =
  "OpenBus did not accept this thread: the update is half done. Ask the user to run npx @open-bus/cli install.";

const NO_IDENTITY =
  "openbus: this Codex version did not send the thread's identity.";

export type CodexCall = {
  threadId: string;
  callId: string;
  /** A hint only: the daemon decides from Codex's own state. */
  threadSource?: string;
  /** A hint only: the daemon takes the cwd from the rollout. */
  cwd?: string;
  /**
   * Code mode (C27): the outer `exec` call's item id, which the daemon finds
   * in the rollout; the call id there is a fresh `exec-<uuid>` it never has.
   */
  itemId?: string;
  /** The turn the call was made in. */
  turnId?: string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

/**
 * The thread's directory. The turn metadata Codex 0.165 sends has no `cwd`
 * key, only `workspaces` keyed by root, so one root is the cwd; several are
 * ambiguous. A `cwd` string wins if a later Codex sends one. A woken turn
 * may carry no `workspaces` at all (C26j).
 */
function cwdOf(turn: Record<string, unknown>): string | undefined {
  const cwd = str(turn.cwd);
  if (cwd) return cwd.startsWith("/") ? cwd : undefined;
  const roots = Object.keys(record(turn.workspaces) ?? {});
  return roots.length === 1 && roots[0]?.startsWith("/") ? roots[0] : undefined;
}

/**
 * Who is calling, from a tools/call's `_meta`, or the refusal to give. The
 * thread id must agree in both places Codex writes it. A thread Codex spawned
 * (a subagent) is refused, as omp does. With no `thread_source` the daemon
 * decides from Codex's state db or rollout.
 */
export function codexCall(meta: unknown): CodexCall | { refuse: string } {
  const m = record(meta);
  let turn: unknown = m?.[TURN_META];
  // Header-shaped: some builds may send it as JSON text.
  if (typeof turn === "string")
    try {
      turn = JSON.parse(turn);
    } catch {
      turn = undefined;
    }
  const t = record(turn);
  const threadId = str(m?.threadId);
  const callId = str(m?.callId);
  if (!m || !t || !threadId || !callId) return { refuse: NO_IDENTITY };
  if (t.thread_id !== undefined && t.thread_id !== threadId)
    return { refuse: NO_IDENTITY };
  const source = str(t.thread_source);
  if (source && SPAWNED_SOURCES.has(source))
    return { refuse: SUBAGENT_REFUSAL };
  const cwd = cwdOf(t);
  const itemId = str(m.itemId);
  const turnId = str(t.turn_id);
  return {
    threadId,
    callId,
    ...(source ? { threadSource: source } : {}),
    ...(cwd ? { cwd } : {}),
    ...(itemId ? { itemId } : {}),
    ...(turnId ? { turnId } : {}),
  };
}

/**
 * The hello for one call: the daemon re-proves the thread and this call id
 * each time. Undefined when a fact cannot go on the wire.
 *
 * `proposedName` is the thread's `name` in Codex's state db (#393e): Codex
 * hellos are per call, so a `/rename` on the Codex side is a rename on the
 * bus at its next tool call. Absent, it is the harness default, `codex`.
 */
export function codexHello(
  call: CodexCall,
  pid: number,
  ppid: number,
  proposedName: string = DEFAULT_CODEX_NAME,
): Hello | undefined {
  const hello = Hello.safeParse({
    v: 1,
    id: "hello",
    type: "hello",
    kind: "codex",
    client_version: CLIENT_VERSION,
    agent_ref: call.threadId,
    pid,
    ...(call.cwd ? { cwd: call.cwd } : {}),
    proposed_name: proposedName,
    codex: {
      thread_id: call.threadId,
      call_id: call.callId,
      ppid,
      ...(call.threadSource ? { thread_source: call.threadSource } : {}),
      ...(call.itemId ? { item_id: call.itemId } : {}),
      ...(call.turnId ? { turn_id: call.turnId } : {}),
    },
  });
  return hello.success ? hello.data : undefined;
}

const refused = (t: string): ToolResult => ({
  content: [{ type: "text", text: t }],
  isError: true,
});

export type CodexDeps = {
  connect: (hello: Hello) => Promise<DaemonClient>;
  pid?: number;
  ppid?: number;
  /** Where the thread's name is read (#393e); a test brings a temp `CODEX_HOME`. */
  name?: CodexNameDeps;
};

/**
 * The claude-code TOOLS for Codex. Codex gives its MCP server no session env,
 * so nothing is said to the daemon until a tools/call brings `_meta`; then one
 * connection per call, closed after it. One process serves one thread: a
 * call from another thread is refused, never re-identified.
 */
export function codexServer(deps: CodexDeps): Server {
  const pid = deps.pid ?? process.pid;
  const ppid = deps.ppid ?? process.ppid;
  let thread: string | undefined;
  const server = new Server(
    { name: "openbus", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOLS],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    try {
      const call = codexCall(req.params._meta);
      if ("refuse" in call) return refused(call.refuse);
      if (thread !== undefined && call.threadId !== thread)
        return refused(
          `openbus: this OpenBus server belongs to Codex thread ${thread}, not ${call.threadId}.`,
        );
      // The name is read before the hello: the hello carries it (#393e).
      const hello = codexHello(
        call,
        pid,
        ppid,
        codexThreadName(call.threadId, deps.name),
      );
      if (!hello) return refused(NO_IDENTITY);
      // Pinned only by a call whose hello is valid: a bad first call claims nothing.
      thread ??= call.threadId;
      let client: DaemonClient;
      try {
        client = await deps.connect(hello);
      } catch (e) {
        if (
          e instanceof HelloRefused &&
          e.frame.type === "error" &&
          e.frame.code === "bad_frame"
        )
          return refused(RESTART_REFUSAL);
        const reason =
          e instanceof HelloRefused && e.reason
            ? e.reason
            : e instanceof Error
              ? e.message
              : String(e);
        return refused(`OpenBus did not accept this thread: ${reason}`);
      }
      try {
        return await callTool(
          req.params.name,
          (req.params.arguments ?? {}) as Record<string, unknown>,
          client,
          extra.signal,
        );
      } finally {
        client.close();
      }
    } catch (e) {
      return refused(`openbus: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return server;
}
