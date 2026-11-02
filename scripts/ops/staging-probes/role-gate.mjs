// I11 step 5b on staging: a role is set; a daemon at 0.53.0 gets a roster with
// no role field (and the 0.53.0 row shape); one at the gate (0.55.0) gets the
// role. Machine tokens stay in memory and are never printed; both machines and
// the role are removed at the end.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const require = createRequire(`${process.env.REPO}/package.json`);
const WebSocket = require("ws");
const HUB = "https://staging.open-bus.ai"; // staging only
const ORIGIN = new URL(HUB).origin;
const state = JSON.parse(
  readFileSync(`${homedir()}/.openbus/e2e-staging-state.json`, "utf8"),
);
const cookie = state.cookies
  .filter((c) => c.domain === "staging.open-bus.ai")
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");
const NS = `e2e.local/role-gate-${Date.now()}`;
const ROLE = "gate-probe";
const out = (...a) => console.log(...a);

async function rest(method, path, body) {
  const r = await fetch(HUB + path, {
    method,
    redirect: "manual",
    headers: {
      cookie,
      origin: ORIGIN,
      "x-ob-request": "1",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

async function approve(userCode) {
  const url = `${HUB}/approve/${userCode}`;
  const page = await fetch(url, { redirect: "manual", headers: { cookie } });
  const html = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  if (!page.ok || !csrf) throw new Error(`GET approve: ${page.status}`);
  const r = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ csrf, decision: "approve" }).toString(),
  });
  if (r.status !== 303) throw new Error(`POST approve: ${r.status}`);
}

async function login(label) {
  const c = await (
    await fetch(`${HUB}/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ machine_label: label }),
    })
  ).json();
  await approve(c.user_code);
  for (let i = 0; i < 20; i++) {
    const t = await (
      await fetch(`${HUB}/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: c.device_code }),
      })
    ).json();
    if (t.status === "approved") return { token: t.token, machineId: t.machine_id };
    if (t.status !== "pending") throw new Error(`device token: ${t.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("device token: timed out");
}

function link(token, version) {
  const ws = new WebSocket(`${HUB.replace("https", "wss")}/hub`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const frames = [];
  const waiters = [];
  ws.on("message", (d) => {
    const t = d.toString();
    let f;
    try {
      f = JSON.parse(t);
    } catch {
      return;
    }
    frames.push({ f, raw: t });
    for (const w of waiters.splice(0)) w();
  });
  const wait = async (pred, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = frames.find((x) => pred(x.f));
      if (hit) return hit;
      if (Date.now() > end) throw new Error("timed out waiting for a frame");
      await new Promise((r) => {
        waiters.push(r);
        setTimeout(r, 500);
      });
    }
  };
  const open = new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  return {
    ws,
    wait,
    async hello() {
      await open;
      ws.send(
        JSON.stringify({
          v: 1,
          id: "h1",
          type: "hello",
          machine_label: `gate-${version}`,
          client_version: version,
        }),
      );
      await wait((f) => f.type === "hello_ok");
    },
    async up(ref, name) {
      ws.send(
        JSON.stringify({
          v: 1,
          id: `u-${ref}`,
          type: "agent_up",
          agent_ref: ref,
          kind: "opencode",
          proposed_name: name,
          namespace: NS,
          global: false,
        }),
      );
      await wait((f) => f.type === "agent_ok" && f.id === `u-${ref}`);
    },
    async list(ref, id) {
      ws.send(JSON.stringify({ v: 1, id, type: "list", from_ref: ref }));
      return (await wait((f) => f.type === "roster" && f.id === id)).f;
    },
  };
}

const V053_ROW_KEYS = new Set([
  "bus_name",
  "kind",
  "namespace",
  "global",
  "state",
  "machine_label",
]);

const machines = [];
let roleSet = false;
let ok = true;
try {
  const agents = await rest("GET", "/api/v1/agents");
  out("session: ok,", agents.agents.length, "agents visible");
  const newM = await login("role-gate-0.55");
  machines.push(newM.machineId);
  const oldM = await login("role-gate-0.53");
  machines.push(oldM.machineId);
  out("machines approved:", machines.length);

  const host = link(newM.token, "0.55.0");
  await host.hello();
  await host.up("r-h", "holder");
  const old = link(oldM.token, "0.53.0");
  await old.hello();
  await old.up("r-o", "oldie");

  const listed = await rest(
    "GET",
    `/api/v1/agents?namespace=${encodeURIComponent(NS)}`,
  );
  const holder = listed.agents.find((a) => a.name === "holder");
  if (!holder) throw new Error("holder not in the agent list");
  await rest(
    "PUT",
    `/api/v1/roles/${encodeURIComponent(NS)}/${ROLE}`,
    { agentId: holder.id },
  );
  roleSet = true;
  out("role set:", ROLE, "->", "holder");

  const oldRoster = await old.list("r-o", "l-old");
  const newRoster = await host.list("r-h", "l-new");
  const oldRows = oldRoster.agents.filter((a) => a.namespace === NS);
  const newRows = newRoster.agents.filter((a) => a.namespace === NS);
  const extra = [
    ...new Set(
      oldRows.flatMap((r) => Object.keys(r).filter((k) => !V053_ROW_KEYS.has(k))),
    ),
  ];
  const oldHasRole = oldRows.some((r) => "role" in r || "roles" in r);
  const newHolder = newRows.find((r) => r.bus_name === "holder");
  out("0.53 rows:", oldRows.length, "keys:", [...new Set(oldRows.flatMap(Object.keys))].sort().join(","));
  out("0.53 extra keys beyond the 0.53.0 shape:", extra.length ? extra.join(",") : "none");
  out("0.55 holder row keys:", Object.keys(newHolder ?? {}).sort().join(","));
  out("0.55 holder row role-ish fields:", JSON.stringify(
    Object.fromEntries(Object.entries(newHolder ?? {}).filter(([k]) => /role/.test(k))),
  ));
  if (oldHasRole || extra.length) {
    ok = false;
    out("FAIL: the 0.53 daemon received fields it can't decode");
  }
  if (!newHolder || !Object.keys(newHolder).some((k) => /role/.test(k))) {
    ok = false;
    out("FAIL: the 0.55 daemon did not get the role");
  }
  host.ws.close();
  old.ws.close();
} catch (e) {
  ok = false;
  out("ERROR:", e.message);
} finally {
  if (roleSet)
    await rest("DELETE", `/api/v1/roles/${encodeURIComponent(NS)}/${ROLE}`).catch(
      (e) => out("cleanup role:", e.message),
    );
  for (const m of machines)
    await rest("DELETE", `/api/v1/machines/${m}`).catch((e) =>
      out("cleanup machine:", e.message),
    );
  out("cleanup: role", roleSet ? "deleted" : "never set", "; machines revoked:", machines.length);
  out(ok ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(ok ? 0 : 1);
}
