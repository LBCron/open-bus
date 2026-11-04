// L2 + L3: an isolated `opencode serve` (temp HOME and XDG dirs, own port,
// own password), never the background service. L2: is session.prompt
// idempotent on `id`, and what do 409 and 404 look like on stdout/stderr?
// L3: what `ps -o comm=` reports for the opencode processes started here.
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";

const BIN = process.env.OPENCODE_BIN ?? join(homedir(), ".opencode/bin/opencode");
const EVIDENCE = join(import.meta.dirname, "opencode.evidence.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const msgId = () => [...randomBytes(16)].map((b) => B58[b % 58]).join("");
const promptId = (m, ref) => `msg_openbus_${m}_${ref}`; // transports/opencode.ts

const root = mkdtempSync("/tmp/ob-oc-");
const dirs = Object.fromEntries(["home", "config", "data", "state", "cache", "tmp", "work"].map((d) => {
  mkdirSync(join(root, d));
  return [d, join(root, d)];
}));
const password = randomBytes(24).toString("base64url");
const env = {
  PATH: process.env.PATH, HOME: dirs.home, TMPDIR: dirs.tmp,
  XDG_CONFIG_HOME: dirs.config, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state, XDG_CACHE_HOME: dirs.cache,
  OPENCODE_PASSWORD: password,
};
const port = 47000 + (process.pid % 900);
const server = `http://127.0.0.1:${port}`;
// Evidence is published: no home path or user name.
const scrub = (s) => s.replaceAll(homedir(), "~").replaceAll(userInfo().username, "<user>");
const redact = (s) => s.replaceAll(password, "<password>").replaceAll(root, "$TMP");

const api = (...args) => new Promise((resolve) => {
  execFile(BIN, ["api", "--server", server, ...args], { env, cwd: dirs.work, timeout: 20_000 }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout: redact(stdout), stderr: redact(stderr) });
  });
});
const prompt = (ses, id, text) =>
  api("session.prompt", "--param", `sessionID=${ses}`, "--data", JSON.stringify({ id, text, delivery: "queue" }));
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
const ps = (pid) => {
  const comm = execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
  const args = execFileSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8" }).trim();
  return { pid, comm, args: redact(args), basename: basename(comm), attestMatches: basename(comm) === "opencode" };
};

const ev = { opencode: execFileSync(BIN, ["--version"], { encoding: "utf8" }).trim(), port, isolation: env };
ev.isolation = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, k === "OPENCODE_PASSWORD" ? "<password>" : k === "PATH" ? "<redacted>" : redact(v)]));
const srv = spawn(BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { env, cwd: dirs.work, stdio: ["ignore", "pipe", "pipe"] });
let srvOut = "";
srv.stdout.on("data", (d) => { srvOut += d; });
srv.stderr.on("data", (d) => { srvOut += d; });
try {
  for (let i = 0; i < 40 && !srvOut.includes("listening"); i++) await sleep(250);
  if (!srvOut.includes("listening")) throw new Error(`server did not start: ${srvOut}`);
  ev.server = { started: redact(srvOut.trim()), ps: ps(srv.pid) };
  console.log("L3 serve:", JSON.stringify(ev.server.ps));

  const mk = async (title) => json(await api("session.create", "--data", JSON.stringify({ title })))?.data?.id;
  const a = await mk("ob-probe-a");
  const b = await mk("ob-probe-b");
  const m = msgId();
  const id = promptId(m, a);
  ev.l2 = { sessionA: a, sessionB: b, id };

  // Same id twice, sequentially.
  ev.l2.first = await prompt(a, id, "openbus probe: idempotency");
  ev.l2.second = await prompt(a, id, "openbus probe: idempotency");
  // Same id, different text: does the server compare the body?
  ev.l2.secondOtherText = await prompt(a, id, "openbus probe: different text");
  // Same id in another session.
  ev.l2.otherSession = await prompt(b, id, "openbus probe: idempotency");
  // A race: four at once with a fresh id.
  const raceId = promptId(msgId(), a);
  ev.l2.raceId = raceId;
  ev.l2.race = await Promise.all([1, 2, 3, 4].map(() => prompt(a, raceId, "openbus probe: race")));
  // A missing session (well-formed id) and a malformed one.
  const ghost = `ses_${"0".repeat(12)}${msgId().slice(0, 14)}`;
  ev.l2.missingSession = await prompt(ghost, promptId(msgId(), ghost), "openbus probe: 404");
  ev.l2.malformedSession = await prompt("nope", promptId(msgId(), "nope"), "openbus probe: 404");

  // L3, the TUI: attached to this server, on a pty; the helper prints the
  // TUI's pid, drains its output for 6 s, then SIGTERMs it.
  const PTY = [
    "import os, pty, select, signal, sys, time",
    "pid, fd = pty.fork()",
    "if pid == 0: os.execv(sys.argv[1], sys.argv[1:])",
    "print(pid, flush=True)",
    "end = time.time() + 6",
    "while time.time() < end:",
    "    if not select.select([fd], [], [], 0.5)[0]: continue",
    "    try: os.read(fd, 65536)",
    "    except OSError: break",
    "os.kill(pid, signal.SIGTERM); time.sleep(1)",
    "try: os.kill(pid, signal.SIGKILL)",
    "except ProcessLookupError: pass",
  ].join("\n");
  const tui = spawn("python3", ["-I", "-c", PTY, BIN, "--server", server, dirs.work], { env: { ...env, TERM: "xterm-256color" }, cwd: dirs.work, stdio: ["ignore", "pipe", "inherit"] });
  const tuiPid = await new Promise((r) => tui.stdout.once("data", (d) => r(Number(String(d).trim()))));
  await sleep(4000);
  ev.tui = ps(tuiPid);
  console.log("L3 tui:", JSON.stringify(ev.tui));
  await new Promise((r) => tui.once("exit", r));

  await sleep(1500);
  // Admitted messages plus the queue: a queued prompt waits in the inbox.
  const list = async (ses) => ({
    messages: await api("session.message.list", "--param", `sessionID=${ses}`),
    inbox: await api("session.inbox.list", "--param", `sessionID=${ses}`),
  });
  const la = await list(a);
  const lb = await list(b);
  const items = (r) => {
    const d = json(r)?.data;
    return Array.isArray(d) ? d : d?.items ?? [];
  };
  const count = (l, want) => [...items(l.messages), ...items(l.inbox)].filter((x) => x.id === want).length;
  ev.l2.listA = { messages: json(la.messages) ?? la.messages, inbox: json(la.inbox) ?? la.inbox };
  ev.l2.listB = { messages: json(lb.messages) ?? lb.messages, inbox: json(lb.inbox) ?? lb.inbox };
  ev.l2.copies = { idInA: count(la, id), raceIdInA: count(la, raceId), idInB: count(lb, id) };
  console.log("L2 copies:", JSON.stringify(ev.l2.copies));
  for (const k of ["first", "second", "secondOtherText", "otherSession", "missingSession", "malformedSession"])
    console.log(`L2 ${k}: rc=${ev.l2[k].code} out=${ev.l2[k].stdout.slice(0, 200)} err=${ev.l2[k].stderr.slice(0, 200)}`);
  ev.l2.race.forEach((r, i) => console.log(`L2 race${i}: rc=${r.code} out=${r.stdout.slice(0, 160)} err=${r.stderr.slice(0, 160)}`));
} catch (e) {
  ev.error = String(e?.stack ?? e);
  console.error(ev.error);
  process.exitCode = 1;
} finally {
  srv.kill("SIGTERM");
  await sleep(1000);
  if (srv.exitCode === null && srv.signalCode === null) srv.kill("SIGKILL");
  writeFileSync(EVIDENCE, `${scrub(JSON.stringify(ev, null, 2))}\n`);
  rmSync(root, { recursive: true, force: true });
  console.log(`evidence: ${EVIDENCE}`);
}
