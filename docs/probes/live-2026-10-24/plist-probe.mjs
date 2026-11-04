// L4: render the launchd plist through systemService().ensure() with a temp
// home and a stub exec (no launchctl runs), then `plutil -lint` the file.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { systemService } from "../../../packages/cli/src/steps/service.ts";

const EVIDENCE = join(import.meta.dirname, "plist.evidence.json");
// Evidence is published: no home path or user name.
const scrub = (s) => s.replaceAll(homedir(), "~").replaceAll(userInfo().username, "<user>");
const lint = (f) => {
  try {
    return { code: 0, out: execFileSync("plutil", ["-lint", f], { encoding: "utf8" }).trim() };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() };
  }
};

async function render(userHome, home, src) {
  const calls = [];
  const svc = systemService({
    platform: "darwin",
    userHome,
    home: () => home,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    exec: async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    sleep: async () => {},
    execPath: process.execPath,
    uid: process.getuid(),
    user: "probe",
    source: () => src,
    daemonPid: async () => undefined,
    processArgs: () => undefined,
    kill: () => { throw new Error("probe never kills"); },
    spawnDaemon: () => { throw new Error("probe never spawns"); },
  });
  await svc.ensure();
  const plist = calls.find((c) => c[0] === "launchctl" && c[1] === "bootstrap")?.[3];
  return { calls: calls.map((c) => c.join(" ").replaceAll(userHome, "$TMP")), plist };
}

const results = [];
const root = mkdtempSync(join(tmpdir(), "ob-plist-"));
try {
  // A bundle source: a stub dist/index.js is enough, install only copies it.
  const pkg = join(root, "pkg");
  execFileSync("mkdir", ["-p", join(pkg, "dist")]);
  writeFileSync(join(pkg, "dist/index.js"), "");
  const src = { kind: "bundle", file: join(pkg, "dist/index.js") };
  for (const [variant, rel] of [
    ["default-home", ".openbus"],
    ["custom-home-hostile-chars", "a b/<x>&'\"bus"],
  ]) {
    const userHome = join(root, variant);
    const { calls, plist } = await render(userHome, join(userHome, rel), src);
    const r = lint(plist);
    results.push({
      variant,
      file: plist.replaceAll(userHome, "$TMP"),
      launchctl: calls,
      lintExit: r.code,
      lint: r.out.replaceAll(userHome, "$TMP"),
      plist: readFileSync(plist, "utf8").replaceAll(userHome, "$TMP").replaceAll(process.execPath, "$NODE"),
    });
    console.log(variant, r.code === 0 ? "OK" : "FAIL", r.out);
  }
  writeFileSync(EVIDENCE, `${scrub(JSON.stringify(results, null, 2))}\n`);
  if (results.some((r) => r.lintExit !== 0)) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
