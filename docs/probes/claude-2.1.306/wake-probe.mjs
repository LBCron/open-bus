// Does an injected frame alone start a turn, or does it need a user prompt?
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const SESSIONS = join(homedir(), ".claude/sessions");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BRIEF = 'You are a peer in a probe. When a <cross-session-message from="uds:..."> arrives, reply once with your native SendMessage tool to that from= address, text OPENBUS-WAKE-OK. Say READY now and wait.';

const dir = mkdtempSync(join(tmpdir(), "ob-wake-"));
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
proc.stdout.pipe(out); proc.stderr.pipe(err);
proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: BRIEF }] } }) + "\n");

const file = join(SESSIONS, `${proc.pid}.json`);
let rec;
for (let i = 0; i < 90; i++) { try { rec = JSON.parse(readFileSync(file, "utf8")); break; } catch { await sleep(1000); } }
if (!rec) { console.error("no session file", dir); process.exit(1); }
const token = rec.peerToken ?? JSON.parse(readFileSync(join(SESSIONS, `${rec.pid}.${sha(rec.messagingSocketPath)}.key`), "utf8")).peerToken;

// Wait for READY to appear, then a full 3s of quiet: the peer is idle.
await sleep(6000);

const sockPath = join(tmpdir(), `obw-${randomBytes(4).toString("hex")}.sock`);
const frames = [];
const server = createServer((sock) => createInterface({ input: sock }).on("line", (l) => {
  try { frames.push(JSON.parse(l)); } catch {}
}));
await new Promise((r) => server.listen(sockPath, r));

const msgId = `wake-${Date.now()}`;
const inner = `<cross-session-message from="uds:${sockPath}" from-name="openbus-probe" from-mode="prompting">\nwake probe. Reply with OPENBUS-WAKE-OK.\n</cross-session-message>`;
const t0 = Date.now();
await new Promise((r, j) => {
  const s = connect(rec.messagingSocketPath);
  s.once("error", j);
  s.once("connect", () => {
    s.write(JSON.stringify({ type: "auth", token }) + "\n");
    s.write(JSON.stringify({ msgV: 1, msg_id: msgId, type: "user", message: { role: "user", content: inner }, priority: "next", from: `uds:${sockPath}` }) + "\n");
    s.end(() => r());
  });
});

let repliedAt = null;
for (let i = 0; i < 60; i++) {
  if (frames.some((f) => JSON.stringify(f).includes("OPENBUS-WAKE-OK"))) { repliedAt = Date.now() - t0; break; }
  await sleep(1000);
}
console.log(JSON.stringify({ replied: repliedAt !== null, repliedAfterMs: repliedAt, frames: frames.length, transcript: dir }, null, 2));
console.log("stream tail:", readFileSync(join(dir, "stdout.jsonl"), "utf8").slice(-1500));

server.close(); rmSync(sockPath, { force: true });
try { proc.stdin.end(); } catch {}
await sleep(500); proc.kill("SIGTERM"); await sleep(500); proc.kill("SIGKILL");
