// #361 rotation box on staging: keep a fresh card signed with the current key,
// watch the JWKS, and once the user rotates, check the old card still verifies,
// the JWKS lists two keys (new first), and a new card uses the new kid.
// Machine tokens stay in memory and are never printed; the probe machine and link are removed at the end.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const require = createRequire(`${process.env.REPO}/package.json`);
const WebSocket = require("ws");
const jose = await import(
  createRequire(`${process.env.REPO}/apps/server/package.json`).resolve("jose")
);
const HUB = "https://staging.open-bus.ai"; // staging only
const ORIGIN = new URL(HUB).origin;
const AUD = "https://card-probe.example.com";
const OTHER_AUD = "https://other-probe.example.com";
const state = JSON.parse(
  readFileSync(`${homedir()}/.openbus/e2e-staging-state.json`, "utf8"),
);
const cookie = state.cookies
  .filter((c) => c.domain === "staging.open-bus.ai")
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");
const NS = `e2e.local/card-check-${Date.now()}`;
const out = (...a) => console.log(...a);
const rand = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  out(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

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
    headers: { cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
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

/** The link flow, as a browser would: GET /link, GET confirm, POST allow. */
async function link(aud) {
  const st = rand();
  const a = await fetch(`${HUB}/link?aud=${encodeURIComponent(aud)}&state=${st}`, {
    redirect: "manual",
    headers: { cookie },
  });
  if (a.status !== 303) throw new Error(`GET /link: ${a.status}`);
  const linkCookie = a.headers.get("set-cookie").split(";")[0];
  const jar = `${cookie}; ${linkCookie}`;
  const confirm = new URL(a.headers.get("location"), HUB).toString();
  const page = await fetch(confirm, { redirect: "manual", headers: { cookie: jar } });
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  if (!page.ok || !csrf) throw new Error(`GET confirm: ${page.status}`);
  const r = await fetch(confirm, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: jar, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, decision: "allow" }).toString(),
  });
  const loc = r.headers.get("location") ?? "";
  if (r.status !== 303 || !loc.startsWith(`${aud}/settings/openbus/callback#assertion=`))
    throw new Error(`POST confirm: ${r.status}`);
}

function wsLink(token) {
  const ws = new WebSocket(`${HUB.replace("https", "wss")}/hub`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const frames = [];
  const waiters = [];
  ws.on("message", (d) => {
    try {
      frames.push(JSON.parse(d.toString()));
    } catch {
      return;
    }
    for (const w of waiters.splice(0)) w();
  });
  const wait = async (pred, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = frames.find(pred);
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
  let n = 0;
  const send = async (f) => {
    const id = `f${++n}`;
    ws.send(JSON.stringify({ v: 1, id, ...f }));
    return wait((x) => x.id === id && x.type !== "ack");
  };
  return { ws, open, send };
}

const JWKS_URL = `${HUB}/.well-known/jwks.json`;
const kids = async () =>
  (await (await fetch(JWKS_URL, { cache: "no-store" })).json()).keys.map((k) => k.kid);
async function verifyFresh(jwt, aud, nonce) {
  // A new key set each time: the rotation must be visible without the cache.
  const { payload, protectedHeader } = await jose.jwtVerify(
    jwt,
    jose.createRemoteJWKSet(new URL(JWKS_URL), { cacheMaxAge: 0 }),
    { algorithms: ["EdDSA"], typ: "ob-card+jwt", issuer: HUB, audience: aud, clockTolerance: 0 },
  );
  if (payload.nonce !== nonce) throw new Error("nonce");
  return protectedHeader.kid;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMIT_MS = Number(process.env.WATCH_MIN ?? 120) * 60_000;

let machineId;
let linked = false;
let ok = true;
try {
  const before = await kids();
  if (before.length !== 1) throw new Error(`expected one key before, got ${before.length}`);
  out("before: kid", before[0]);
  await link(AUD);
  linked = true;
  const m = await login("rotation-watch");
  machineId = m.machineId;
  const d = wsLink(m.token);
  await d.open;
  await d.send({ type: "hello", machine_label: "rotation-watch", client_version: "0.61.0" });
  await d.send({ type: "agent_up", agent_ref: "r-w", kind: "opencode", proposed_name: "rotwatch", namespace: NS, global: false });
  const sign = async () => {
    const nonce = rand();
    const c = await d.send({ type: "card_request", from_ref: "r-w", aud: AUD, nonce });
    if (c.type !== "card") throw new Error(`card: ${JSON.stringify(c)}`);
    return { jwt: c.jwt, nonce, iat: jose.decodeJwt(c.jwt).iat, kid: jose.decodeProtectedHeader(c.jwt).kid };
  };
  let card = await sign();
  out("READY: holding a card signed with", card.kid, "- run --rotate-card-key --force now");
  const end = Date.now() + LIMIT_MS;
  let after = before;
  while (Date.now() < end) {
    await sleep(10_000);
    after = await kids();
    if (after[0] !== before[0]) break;
    // Keep the held card well inside its 300 s.
    if (Date.now() / 1000 - card.iat > 150) card = await sign();
  }
  if (after[0] === before[0]) throw new Error("no rotation seen before the time limit");
  out("rotation seen at", new Date().toISOString(), "kids", after.join(","));
  check("JWKS lists two keys, the new one first and the old one second", after.length === 2 && after[1] === before[0]);
  check("new kid has the ob-<UTC>-<hex> form", /^ob-\d{8}T\d{6}Z-[0-9a-f]{6}$/.test(after[0]));
  const age = Math.floor(Date.now() / 1000) - card.iat;
  let oldKid = "";
  try {
    oldKid = await verifyFresh(card.jwt, AUD, card.nonce);
  } catch (e) {
    oldKid = `refused: ${e.code ?? e.message}`;
  }
  check(`card signed before the rotation still verifies (${age}s old)`, oldKid === before[0], oldKid);
  // The DO reads the new secret on its next isolate; allow a short wait.
  let fresh;
  for (let i = 0; i < 12; i++) {
    fresh = await sign();
    if (fresh.kid === after[0]) break;
    await sleep(10_000);
  }
  let newKid = "";
  try {
    newKid = await verifyFresh(fresh.jwt, AUD, fresh.nonce);
  } catch (e) {
    newKid = `refused: ${e.code ?? e.message}`;
  }
  check("a new card is signed with the new kid and verifies", newKid === after[0], newKid);
  d.ws.close();
} catch (e) {
  ok = false;
  out("ERROR:", e.message);
} finally {
  if (linked)
    await rest("DELETE", `/api/v1/linked-apps/${encodeURIComponent(AUD)}`).catch((e) =>
      out("cleanup link:", e.message),
    );
  if (machineId)
    await rest("DELETE", `/api/v1/machines/${machineId}`).catch((e) =>
      out("cleanup machine:", e.message),
    );
  out("cleanup: link", "removed", "; machine", machineId ? "revoked" : "none");
  ok = ok && results.length > 0 && results.every(Boolean);
  out(ok ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(ok ? 0 : 1);
}
