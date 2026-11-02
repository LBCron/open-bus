// #361 (I11 step 5), bus side on staging: link a probe aud, get a card from
// the hub over a daemon link, verify it with a test OA verifier (spec rules),
// and check the refusals. Machine tokens stay in memory and are never
// printed; the probe machine and link are removed at the end.
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

// The test OA verifier: the spec's binding verifier rules.
const JWKS = jose.createRemoteJWKSet(new URL(`${HUB}/.well-known/jwks.json`));
const seen = new Set();
async function verify(jwt, { aud, nonce, now }) {
  const h = jose.decodeProtectedHeader(jwt);
  if (h.alg !== "EdDSA" || !h.kid || h.typ !== "ob-card+jwt") throw new Error("header");
  const { payload } = await jose.jwtVerify(jwt, JWKS, {
    algorithms: ["EdDSA"],
    typ: "ob-card+jwt",
    issuer: HUB,
    audience: aud,
    clockTolerance: 0,
    currentDate: now ? new Date(now * 1000) : undefined,
  });
  if (payload.nonce !== nonce) throw new Error("nonce");
  if (seen.has(payload.jti)) throw new Error("jti replayed");
  seen.add(payload.jti);
  return payload;
}
const refused = async (fn) => {
  try {
    await fn();
    return "accepted";
  } catch (e) {
    return e.code ?? e.message;
  }
};

let machineId;
let linked = false;
let ok = true;
try {
  const jwks = await (await fetch(`${HUB}/.well-known/jwks.json`)).json();
  check(
    "JWKS: one key, ob-<UTC>-<hex> kid, no d",
    jwks.keys.length === 1 &&
      /^ob-\d{8}T\d{6}Z-[0-9a-f]{6}$/.test(jwks.keys[0].kid) &&
      !("d" in jwks.keys[0]),
    jwks.keys.map((k) => k.kid).join(","),
  );

  await link(AUD);
  linked = true;
  const apps = await rest("GET", "/api/v1/linked-apps");
  check("link flow links the probe aud", JSON.stringify(apps).includes(AUD));

  const m = await login("card-check");
  machineId = m.machineId;
  const d = wsLink(m.token);
  await d.open;
  await d.send({ type: "hello", machine_label: "card-check", client_version: "0.61.0" });
  await d.send({ type: "agent_up", agent_ref: "r-c", kind: "opencode", proposed_name: "carder", namespace: NS, global: false });

  const nonce = rand();
  const c1 = await d.send({ type: "card_request", from_ref: "r-c", aud: AUD, nonce });
  check("hub signs a card for a linked aud", c1.type === "card", c1.type === "card" ? "" : JSON.stringify(c1));
  const jwt = c1.jwt;
  const p = await verify(jwt, { aud: AUD, nonce });
  check(
    "card verifies against the JWKS",
    p.iss === HUB && p.aud === AUD && p.exp - p.iat === 300 && p.name === "carder",
    `kid ${jose.decodeProtectedHeader(jwt).kid}`,
  );
  const leak = ["email", "namespace", "machine_id"].filter((k) => k in p);
  check("card carries no email, namespace or machine id", leak.length === 0, leak.join(","));

  seen.clear();
  check("wrong aud is refused", (await refused(() => verify(jwt, { aud: OTHER_AUD, nonce }))) !== "accepted");
  seen.clear();
  check("one second after exp is refused", (await refused(() => verify(jwt, { aud: AUD, nonce, now: p.exp + 1 }))) !== "accepted");
  seen.clear();
  check("another grant's nonce is refused", (await refused(() => verify(jwt, { aud: AUD, nonce: rand() }))) !== "accepted");
  seen.clear();
  await verify(jwt, { aud: AUD, nonce });
  check("replayed jti is refused", (await refused(() => verify(jwt, { aud: AUD, nonce }))) === "jti replayed");

  const c2 = await d.send({ type: "card_request", from_ref: "r-c", aud: OTHER_AUD, nonce: rand() });
  check("unlinked aud: card_refused not_linked", c2.type === "card_refused" && c2.code === "not_linked");

  const c3 = await d.send({ type: "card_request", from_ref: "r-c", aud: AUD, nonce: rand() });
  const p3 = c3.type === "card" ? jose.decodeJwt(c3.jwt) : {};
  check("each card has a fresh jti", c3.type === "card" && p3.jti !== p.jti);

  await rest("DELETE", `/api/v1/linked-apps/${encodeURIComponent(AUD)}`);
  linked = false;
  const c4 = await d.send({ type: "card_request", from_ref: "r-c", aud: AUD, nonce: rand() });
  check("unlinking stops new cards", c4.type === "card_refused" && c4.code === "not_linked");
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
  out("cleanup: link", linked ? "LEFT" : "removed", "; machine", machineId ? "revoked" : "none");
  ok = ok && results.every(Boolean);
  out(ok ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(ok ? 0 : 1);
}
