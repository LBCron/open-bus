// Focused C1a follow-up: does Claude 2.1.306 send peer_message_status at all?
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const SESSIONS = join(homedir(), ".claude/sessions");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procStart = (pid) => execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
const BRIEF = "You are a peer in a probe. Do not use any tools. Do not reply to anything. Just say READY and wait.";

const dir = mkdtempSync(join(tmpdir(), "ob-status-"));
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
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  try { rec = JSON.parse(readFileSync(file, "utf8")); break; } catch {}
  await sleep(1000);
}
if (!rec) { console.error("no session file", dir); process.exit(1); }
const token = rec.peerToken ?? JSON.parse(readFileSync(join(SESSIONS, `${rec.pid}.${sha(rec.messagingSocketPath)}.key`), "utf8")).peerToken;

const sockPath = join(tmpdir(), `obst-${randomBytes(4).toString("hex")}.sock`);
const frames = [];
const server = createServer((sock) => createInterface({ input: sock }).on("line", (l) => {
  try { frames.push(JSON.parse(l)); } catch { frames.push({ raw: l }); }
}));
await new Promise((r) => server.listen(sockPath, r));

const msgId = `status-${Date.now()}`;
const inner = `<cross-session-message from="uds:${sockPath}" from-name="openbus-probe" from-mode="prompting">\nstatus probe, do not reply\n</cross-session-message>`;
await new Promise((r, j) => {
  const s = connect(rec.messagingSocketPath);
  s.once("error", j);
  s.once("connect", () => {
    s.write(JSON.stringify({ type: "auth", token }) + "\n");
    s.write(JSON.stringify({ msgV: 1, msg_id: msgId, type: "user", message: { role: "user", content: inner }, priority: "next", from: `uds:${sockPath}` }) + "\n");
    s.end(() => r());
  });
});

for (const wait of [5, 15, 30, 60]) {
  await sleep(wait * 1000 - (wait === 5 ? 0 : 0));
  console.log(`t=${wait}s frames=${JSON.stringify(frames.map((f) => `${f.type}:${f.action ?? ""}`))}`);
  if (frames.some((f) => f.action === "peer_message_status")) break;
}
console.log("FULL:", JSON.stringify(frames, null, 2));
fs_write();
function fs_write() {
  writeFileSync(join(process.cwd(), "status.evidence.json"), JSON.stringify(frames, null, 2));
}
server.close();
rmSync(sockPath, { force: true });
try { proc.stdin.end(); } catch {}
await sleep(500); proc.kill("SIGTERM"); await sleep(500); proc.kill("SIGKILL");
