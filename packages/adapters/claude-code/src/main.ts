import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { connectDaemon, type DaemonClient } from "@ob/ipc";
import {
  ancestorChain,
  claudeProcStartOf,
  claudeSessionsDir,
  findSession,
  openbusHome,
  sessionHello,
} from "./session.ts";
import { daemonSocketPath, socketDirProblem } from "./socket-path.ts";
import { callTool, offeredTools } from "./tools.ts";

const SESSIONS = claudeSessionsDir();
const HOME = openbusHome();
const SOCKET = daemonSocketPath(HOME);

/** One connection per tool call: the daemon attests the session behind this process. */
async function connect(): Promise<DaemonClient | null> {
  try {
    const session = findSession(process.pid, {
      sessionsDir: SESSIONS,
      ancestors: ancestorChain,
      procStart: claudeProcStartOf,
    });
    // A short socket folder another user could reach is never dialed.
    if (!session || socketDirProblem(HOME)) return null;
    return await connectDaemon({
      path: SOCKET,
      hello: sessionHello(session, process.pid, process.cwd()),
    });
  } catch {
    return null;
  }
}

/**
 * The daemon's version, from a `self` on a connection of its own (#393):
 * `rename` is offered only at the rename gate, and a daemon that cannot be
 * asked hides it. One local round trip, at list time only.
 */
async function daemonVersion(): Promise<string | undefined> {
  const client = await connect();
  if (!client) return undefined;
  try {
    const r = await client.request({ type: "self" });
    return r.type === "agent" ? r.daemon_version : undefined;
  } catch {
    return undefined;
  } finally {
    client.close();
  }
}

const server = new Server(
  { name: "openbus", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: offeredTools(await daemonVersion()),
}));
server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const client = await connect();
  if (!client) {
    return {
      content: [
        {
          type: "text",
          text: "openbus: no Claude session or daemon found. Run `npx @open-bus/cli install`.",
        },
      ],
      isError: true,
    };
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
});

await server.connect(new StdioServerTransport());
