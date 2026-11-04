// C1a probe: does a native Claude reply reach a return socket with no
// ~/.claude/sessions/<pid>.json? Three variants, one live headless peer.
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const SESSIONS = process.env.OPENBUS_CLAUDE_SESSIONS_DIR ?? join(homedir(), ".claude/sessions");
const SOCKS = "/tmp/cc-socks";
const EVIDENCE = join(process.cwd(), "return-socket.evidence.json");

const sha = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procStart = (pid) => execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();

const BRIEF = [
  "You are a peer in an OpenBus protocol probe.",
  'Every inbound message arrives as a <cross-session-message from="uds:..."> block.',
  "For each one, reply once with your native SendMessage tool, addressed to that block's from= address,",
  "with the text OPENBUS-PROBE-OK. Do nothing else. Say READY now.",
].join(" ");

const TICK = "If a message arrived, answer it now with SendMessage to its from= address, text OPENBUS-PROBE-OK.";

class ReturnSink {
  constructor(path) { this.path = path; this.frames = []; this.firstLines = []; this.connections = 0; }
  async listen() {
    rmSync(this.path, { force: true });
    mkdirSync(this.path.replace(/\/[^/]+$/, ""), { recursive: true, mode: 0o700 });
    this.server = createServer((sock) => {
      this.connections += 1;
      createInterface({ input: sock }).on("line", (line) => {
        if (this.firstLines.length < 50) this.firstLines.push(line);
        try { this.frames.push(JSON.parse(line)); } catch { this.frames.push({ type: "unparsed", line }); }
      });
    });
    await new Promise((res, rej) => { this.server.once("error", rej); this.server.listen(this.path, () => res()); });
    chmodSync(this.path, 0o600);
  }
  text() {
    return this.frames.filter((f) => f.type === "user")
      .map((f) => typeof f.message?.content === "string" ? f.message.content : JSON.stringify(f.message?.content ?? ""))
      .join("\n");
  }
  statusFor(id) {
    return this.frames.find((f) => f.type === "control" && f.action === "peer_message_status" && f.orig_msg_id === id);
  }
  async close() {
    await new Promise((r) => this.server ? this.server.close(() => r()) : r());
    rmSync(this.path, { force: true });
  }
}

function inject({ socketPath, peerToken, fromSocket, fromName, msgId, text }) {
  const inner = `<cross-session-message from="uds:${fromSocket}" from-name="${fromName}" from-mode="prompting">\n${text}\n</cross-session-message>`;
  const frame = { msgV: 1, msg_id: msgId, type: "user", message: { role: "user", content: inner }, priority: "next", from: `uds:${fromSocket}` };
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    sock.once("error", reject);
    sock.once("connect", () => {
      sock.write(JSON.stringify({ type: "auth", token: peerToken }) + "\n");
      sock.write(JSON.stringify(frame) + "\n");
      sock.end(() => resolve());
    });
  });
}

async function startPeer() {
  const dir = mkdtempSync(join(tmpdir(), "ob-claude-"));
  const out = createWriteStream(join(dir, "stdout.jsonl"));
  const err = createWriteStream(join(dir, "stderr.txt"));
  const proc = spawn("claude", [
    "-p", "--model", "claude-haiku-4-5-20251001",
    "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--disable-slash-commands",
    "--settings", JSON.stringify({ crossSessionInbound: "accept" }),
    "--dangerously-skip-permissions",
  ], { stdio: ["pipe", "pipe", "pipe"], cwd: dir });
  // Never leave a stream on an undrained pipe: pump to files.
  proc.stdout.pipe(out);
  proc.stderr.pipe(err);
  proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: BRIEF }] } }) + "\n");

  const timer = setInterval(() => {
    try {
      proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: TICK }] } }) + "\n");
    } catch { /* exited */ }
  }, 30_000);
  timer.unref();

  const deadline = Date.now() + 90_000;
  const file = join(SESSIONS, `${proc.pid}.json`);
  let rec;
  while (Date.now() < deadline) {
    try { rec = JSON.parse(readFileSync(file, "utf8")); break; } catch { /* not yet */ }
    if (proc.exitCode !== null) {
      throw new Error(`claude exited early rc=${proc.exitCode}:\n${readFileSync(join(dir, "stderr.txt"), "utf8").slice(-2000)}`);
    }
    await sleep(1000);
  }
  if (!rec) throw new Error(`no session file ${file} within 90s; transcript ${dir}`);
  const keyPath = join(SESSIONS, `${rec.pid}.${sha(rec.messagingSocketPath)}.key`);
  let token = rec.peerToken;
  if (!token) token = JSON.parse(readFileSync(keyPath, "utf8")).peerToken;
  return {
    proc, dir, pid: rec.pid, sessionId: rec.sessionId,
    socketPath: rec.messagingSocketPath, peerToken: token,
    stop: async () => {
      clearInterval(timer);
      try { proc.stdin.end(); } catch {}
      await sleep(500);
      proc.kill("SIGTERM");
      await sleep(500);
      proc.kill("SIGKILL");
      out.close(); err.close();
    },
  };
}

const cleanup = [];
try {
  mkdirSync(SESSIONS, { recursive: true });
  mkdirSync(SOCKS, { recursive: true });
  console.log("starting headless claude...");
  const peer = await startPeer();
  cleanup.push(() => peer.stop());
  console.log(`peer pid=${peer.pid} session=${peer.sessionId} sock=${peer.socketPath}`);
  console.log(`transcript: ${peer.dir}`);

  const results = [];
  for (const variant of ["bare", "key-only", "control"]) {
    const token = randomBytes(24).toString("hex");
    const sock = variant === "bare"
      ? join(tmpdir(), `ob-${randomBytes(4).toString("hex")}`, "return.sock")
      : join(SOCKS, `${process.pid}.sock`);
    const sink = new ReturnSink(sock);
    await sink.listen();
    const keyPath = join(SESSIONS, `${process.pid}.${sha(sock)}.key`);
    const jsonPath = join(SESSIONS, `${process.pid}.json`);

    if (variant !== "bare") {
      writeFileSync(keyPath, JSON.stringify({ peerToken: token }), { mode: 0o600 });
      chmodSync(keyPath, 0o600);
      cleanup.push(() => rmSync(keyPath, { force: true }));
    }
    if (variant === "control") {
      writeFileSync(jsonPath, JSON.stringify({
        pid: process.pid, sessionId: "probe-control", procStart: procStart(process.pid),
        name: "openbus-probe", agentBus: true, messagingSocketPath: sock,
        startedAt: Date.now(), updatedAt: Date.now(),
      }));
      cleanup.push(() => rmSync(jsonPath, { force: true }));
    }

    const msgId = `probe-${variant}-${Date.now()}`;
    console.log(`variant ${variant}: injecting via ${sock}`);
    await inject({ socketPath: peer.socketPath, peerToken: peer.peerToken, fromSocket: sock, fromName: "openbus-probe", msgId, text: `openbus probe ${variant}. Reply with OPENBUS-PROBE-OK.` });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !sink.text().includes("OPENBUS-PROBE-OK")) await sleep(1000);

    const first = sink.firstLines[0] ?? null;
    let authMatches = null;
    if (first) {
      try { const f = JSON.parse(first); if (f.type === "auth") authMatches = f.token === token; } catch {}
    }
    const r = {
      variant,
      replied: sink.text().includes("OPENBUS-PROBE-OK"),
      statusBack: Boolean(sink.statusFor(msgId)),
      connected: sink.connections > 0,
      firstLine: first,
      authTokenMatches: authMatches,
      frameTypes: sink.frames.map((f) => f.type),
    };
    results.push(r);
    console.log(JSON.stringify(r));
    await sink.close();
  }

  writeFileSync(EVIDENCE, JSON.stringify(results, null, 2));
  console.log(`\nevidence: ${EVIDENCE}`);
  const noSession = results.filter((r) => r.variant !== "control");
  const ok = noSession.some((r) => r.replied);
  console.log(ok ? "RESULT: PASS (a session-file-less variant received a native reply)" : "RESULT: FAIL (only the control, if any, replied)");
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error("PROBE ERROR:", e?.stack || e);
  writeFileSync(EVIDENCE, JSON.stringify({ error: String(e?.message || e), stack: String(e?.stack || "") }, null, 2));
  process.exitCode = 1;
} finally {
  for (const fn of cleanup.reverse()) { try { await fn(); } catch {} }
}
