// L1: the frame a native Claude reply puts on a bare return socket, compared
// with what packages/daemon/src/transports/claude.ts accepts. One headless
// peer started here; two injections, both with the adapter's real inject():
// (a) from a raw sink that records every line; (b) through ClaudeTransport.
// Run from the repo root: node_modules/.bin/jiti docs/probes/live-2026-10-24/claude-reply-probe.mjs
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { inject } from "../../../packages/adapters/claude-code/src/inject.ts";
import { ClaudeTransport } from "../../../packages/daemon/src/transports/claude.ts";

// Evidence is published: no home path or user name.
const scrub = (s) => s.replaceAll(homedir(), "~").replaceAll(userInfo().username, "<user>");
const SESSIONS = join(homedir(), ".claude/sessions");
const EVIDENCE = join(import.meta.dirname, "claude-reply.evidence.json");
const MODEL = process.env.PROBE_MODEL ?? "haiku";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WRAP = /^\s*<cross-session-message\b[^>]*>([\s\S]*)<\/cross-session-message>\s*$/; // claude.ts

const BRIEF = [
  "You are a peer in an OpenBus protocol probe.",
  'Every inbound message arrives as a <cross-session-message from="uds:..."> block.',
  "For each one, reply once with your native SendMessage tool, addressed to that block's from= address,",
  "with exactly the token the message asks for. Do nothing else. Say READY now.",
].join(" ");

// Sockets live under /tmp: sun_path is 104 bytes on macOS.
const root = mkdtempSync("/tmp/ob-l1-");

async function rawSink(path) {
  const lines = [];
  let connections = 0;
  const server = createServer((sock) => {
    connections += 1;
    createInterface({ input: sock }).on("line", (l) => lines.push(l));
  });
  await new Promise((res, rej) => { server.once("error", rej); server.listen(path, res); });
  return { lines, conns: () => connections, close: () => new Promise((r) => server.close(r)) };
}

async function startPeer() {
  const dir = join(root, "peer");
  mkdirSync(dir);
  const out = createWriteStream(join(dir, "stdout.jsonl"));
  const err = createWriteStream(join(dir, "stderr.txt"));
  const proc = spawn("claude", [
    "-p", "--model", MODEL,
    "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--disable-slash-commands",
    "--settings", JSON.stringify({ crossSessionInbound: "accept" }),
    // The peer gets one tool, pre-approved: no bypass mode.
    "--tools", "SendMessage", "--allowedTools", "SendMessage",
  ], { stdio: ["pipe", "pipe", "pipe"], cwd: dir });
  proc.stdout.pipe(out);
  proc.stderr.pipe(err);
  proc.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: BRIEF }] } })}\n`);
  const file = join(SESSIONS, `${proc.pid}.json`);
  let rec;
  for (const deadline = Date.now() + 90_000; Date.now() < deadline; await sleep(1000)) {
    try { rec = JSON.parse(readFileSync(file, "utf8")); break; } catch { /* not yet */ }
    if (proc.exitCode !== null) throw new Error(`claude exited rc=${proc.exitCode}: ${readFileSync(join(dir, "stderr.txt"), "utf8").slice(-1500)}`);
  }
  if (!rec) throw new Error(`no ${file} within 90 s`);
  const keyPath = join(SESSIONS, `${rec.pid}.${sha(rec.messagingSocketPath)}.key`);
  const peerToken = rec.peerToken ?? JSON.parse(readFileSync(keyPath, "utf8")).peerToken;
  return {
    proc, pid: rec.pid, socketPath: rec.messagingSocketPath, peerToken, keyPath, file,
    stop: async () => {
      try { proc.stdin.end(); } catch {}
      await sleep(500);
      proc.kill("SIGTERM");
      await sleep(1000);
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      out.close(); err.close();
    },
  };
}

const ev = { claude: execFileSync("claude", ["--version"], { encoding: "utf8" }).trim(), model: MODEL };
let peer;
let transport;
try {
  peer = await startPeer();
  ev.peer = { pid: peer.pid, socketPath: peer.socketPath, peerToken: "<redacted>" };
  console.log(`peer pid=${peer.pid} sock=${peer.socketPath}`);
  const claudeFrom = `uds:${peer.socketPath}`;

  // (a) raw sink: every line, verbatim.
  const sinkPath = join(root, "raw.sock");
  const sink = await rawSink(sinkPath);
  const msgA = randomBytes(8).toString("hex");
  await inject({ socketPath: peer.socketPath, peerToken: peer.peerToken, fromSocket: sinkPath, fromName: "openbus-probe", msgId: msgA, text: "Reply with OPENBUS-L1-RAW." });
  for (const d = Date.now() + 90_000; Date.now() < d && !sink.lines.some((l) => l.includes("OPENBUS-L1-RAW")); ) await sleep(1000);
  await sleep(3000); // any trailing control frame
  const frames = sink.lines.map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l }; } });
  const reply = frames.find((f) => f.type === "user");
  const content = reply?.message?.content;
  ev.raw = {
    injectedMsgId: msgA,
    connections: sink.conns(),
    lines: sink.lines,
    frameTypes: frames.map((f) => f.type === "control" ? `control:${f.action}` : f.type),
    compare: reply && {
      type: { got: reply.type, want: "user", match: reply.type === "user" },
      from: { got: reply.from, want: claudeFrom, match: reply.from === claudeFrom },
      contentIsString: typeof content === "string",
      wrapped: { match: typeof content === "string" && WRAP.test(content), body: typeof content === "string" ? content.match(WRAP)?.[1]?.trim() : null },
      wrapperFrom: typeof content === "string" ? content.match(/<cross-session-message\b[^>]*\bfrom="([^"]*)"/)?.[1] : null,
      role: reply.message?.role,
      msgIdEchoesInjected: reply.msg_id === msgA,
      otherKeys: Object.keys(reply).filter((k) => !["type", "from", "message", "msg_id"].includes(k)),
    },
  };
  await sink.close();
  console.log("raw:", JSON.stringify(ev.raw.compare));

  // (b) the real ClaudeTransport: does onReply fire with the body?
  const replies = [];
  transport = new ClaudeTransport({
    socketsDir: join(root, "s"),
    target: () => ({ socketPath: peer.socketPath, peerToken: peer.peerToken }),
    onReply: (agentRef, peerName, body, namespace) => replies.push({ agentRef, peerName, body, namespace }),
  });
  const outcome = await transport.deliver({ ref: "probe-ref", busName: "probe", global: false }, {
    msg_id: randomBytes(8).toString("hex"), namespace: "default", from_name: "alice", body: "Reply with OPENBUS-L1-TRANSPORT.",
  });
  for (const d = Date.now() + 90_000; Date.now() < d && !replies.length; ) await sleep(1000);
  ev.transport = { deliverOutcome: outcome, onReply: replies };
  console.log("transport:", JSON.stringify(ev.transport));
} catch (e) {
  ev.error = String(e?.stack ?? e);
  console.error(ev.error);
  process.exitCode = 1;
} finally {
  await transport?.close();
  if (peer) {
    await peer.stop();
    // Only this peer's own session files, if Claude left them.
    ev.leftover = [peer.file, peer.keyPath].map((f) => { try { readFileSync(f); rmSync(f); return `removed ${f.replace(homedir(), "~")}`; } catch { return null; } }).filter(Boolean);
  }
  writeFileSync(EVIDENCE, `${scrub(JSON.stringify(ev, null, 2).replaceAll(root, "$TMP"))}\n`);
  rmSync(root, { recursive: true, force: true });
  console.log(`evidence: ${EVIDENCE}`);
}
