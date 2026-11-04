// Replays the captured `opencode api` results through the real
// OpenCodeTransport (stub spawn) and records each outcome.
// Run from the repo root: node_modules/.bin/jiti docs/probes/live-2026-10-24/opencode-replay.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { OpenCodeTransport } from "../../../packages/daemon/src/transports/opencode.ts";

// Evidence is published: no home path or user name.
const scrub = (s) => s.replaceAll(homedir(), "~").replaceAll(userInfo().username, "<user>");
const dir = import.meta.dirname;
const ev = JSON.parse(readFileSync(join(dir, "opencode.evidence.json"), "utf8"));
const { l2 } = ev;
const [, msg] = l2.id.match(/^msg_openbus_([^_]+)_/);
const cases = {
  second: [l2.sessionA, l2.second],
  otherSession: [l2.sessionA, l2.otherSession], // as if the conflict came back for our own id
  missingSession: [JSON.parse(l2.missingSession.stdout).sessionID, l2.missingSession],
  malformedSession: ["nope", l2.malformedSession],
};
const out = {};
for (const [name, [ref, res]] of Object.entries(cases)) {
  const t = new OpenCodeTransport({ openSessions: () => new Set([ref]), spawn: async () => res });
  const agent = { ref, busName: "probe", global: false };
  out[name] = await t.deliver(agent, { msg_id: name === "otherSession" ? msg : "x", from_name: "p", namespace: "default", body: "b" });
  // heldAlready needs the id it sent to appear in the output: the replayed 409 names l2.id.
  if (name === "otherSession") out[name].note = "ref is session A: the 409 names the id deliver() builds";
}
console.log(JSON.stringify(out, null, 2));
writeFileSync(join(dir, "opencode-replay.evidence.json"), `${scrub(JSON.stringify(out, null, 2))}\n`);
