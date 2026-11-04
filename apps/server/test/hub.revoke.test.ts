import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  type BusEvent,
  BusEventSchema,
  type ClientFrame,
  decodeServerFrame,
  EVENTS_DO_PATH,
  encodeFrame,
  LIMITS,
  newId,
  PONG,
  SESSION_EXP_HEADER,
  SESSION_GEN_HEADER,
  type ServerFrame,
} from "@ob/shared";
import { describe, expect, it } from "vitest";
import { Hub, type HubStub, SWEEP_BATCH } from "../src/hub/do.js";
import { sha256Hex } from "../src/hub/hash.js";
import { hub } from "../src/hub/stub.js";
import { e, hello, machine, ns, up, upgrade } from "./helpers.js";

// ------------------------------------------------------------------ helpers
//
// Each test runs on its own hub (newUniqueId) except the reconnect test,
// which goes through the Worker's /hub route to the owner hub. Daemons
// connect through the DO's internal /hub forward, as the Worker does.

const freshHub = (): HubStub =>
  e.HUB.get(e.HUB.newUniqueId()) as unknown as HubStub;

const fetchOf = (h: HubStub) =>
  (h as unknown as DurableObjectStub<Hub>).fetch.bind(h);

const inHub = <R>(h: HubStub, fn: (i: Hub, s: DurableObjectState) => R) =>
  runInDurableObject(h as unknown as DurableObjectStub<Hub>, (i: Hub, s) =>
    fn(i, s),
  );

function wire<T>(ws: WebSocket, parse: (t: string) => T | null) {
  ws.accept();
  const queue: T[] = [];
  const waiting: ((f: T) => void)[] = [];
  const seen: T[] = [];
  ws.addEventListener("message", (ev) => {
    const f = parse(String(ev.data));
    if (f === null) return;
    seen.push(f);
    const w = waiting.shift();
    if (w) w(f);
    else queue.push(f);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (ev) =>
      resolve({ code: ev.code, reason: ev.reason }),
    ),
  );
  const next = () => {
    const f = queue.shift();
    if (f !== undefined) return Promise.resolve(f);
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out")), 15_000);
      waiting.push((x) => {
        clearTimeout(t);
        resolve(x);
      });
    });
  };
  return { seen, next, closed };
}

type D = {
  ws: WebSocket;
  seen: ServerFrame[];
  next: () => Promise<ServerFrame>;
  send: (f: ClientFrame) => void;
  closed: Promise<{ code: number; reason: string }>;
};

/** A daemon on `h`. Every frame must decode with decodeServerFrame. */
async function daemonOn(h: HubStub, machineId: string): Promise<D> {
  const res = await fetchOf(h)("https://hub.internal/hub", {
    headers: { Upgrade: "websocket", "X-Ob-Machine-Id": machineId },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket as WebSocket;
  const w = wire<ServerFrame>(ws, (t) => {
    if (t === PONG) return null;
    const r = decodeServerFrame(t);
    expect(r.ok, `not a server frame: ${t}`).toBe(true);
    return r.ok ? r.frame : null;
  });
  return { ws, ...w, send: (f) => ws.send(encodeFrame(f)) };
}

type Obs = { next: () => Promise<BusEvent>; seen: BusEvent[] };

async function observer(h: HubStub): Promise<Obs> {
  const res = await fetchOf(h)(`https://hub.internal${EVENTS_DO_PATH}`, {
    headers: {
      Upgrade: "websocket",
      [SESSION_EXP_HEADER]: String(Date.now() + 6 * 24 * 3_600_000),
      [SESSION_GEN_HEADER]: "0",
    },
  });
  expect(res.status).toBe(101);
  const w = wire<BusEvent>(res.webSocket as WebSocket, (t) => {
    const r = BusEventSchema.safeParse(JSON.parse(t));
    expect(r.success, `not a BusEvent: ${t}`).toBe(true);
    return r.success ? r.data : null;
  });
  // The snapshot: hello, machines, agents.
  for (let k = 0; k < 3; k++) await w.next();
  return w;
}

async function push(o: Obs) {
  const m = await o.next();
  const a = await o.next();
  if (m.type !== "machines" || a.type !== "agents")
    throw new Error(`not a push: ${m.type}, ${a.type}`);
  return { machines: m.machines, agents: a.agents };
}

async function until<T extends ServerFrame["type"]>(d: D, type: T) {
  for (let i = 0; i < 5000; i++) {
    const f = await d.next();
    if (f.type === type) return f as Extract<ServerFrame, { type: T }>;
  }
  throw new Error(`no ${type}`);
}

/** Round-trips a hello: every frame sent before it has been handled. */
async function sync(d: D) {
  d.send(hello(`sync-${newId()}`));
  await until(d, "hello_ok");
}

async function machineOn(h: HubStub, label = "MacBook") {
  const m = await h.createMachine(label);
  if (!m.ok) throw new Error(m.code);
  return m;
}

/** A connected machine with one registered agent. */
async function agentOn(
  h: HubStub,
  label: string,
  name: string,
  namespace: string,
  global = false,
) {
  const m = await machineOn(h, label);
  const d = await daemonOn(h, m.id);
  d.send(hello());
  await until(d, "hello_ok");
  d.send(up("u", `ref-${name}`, name, namespace, global));
  await until(d, "agent_ok");
  return { m, d, ref: `ref-${name}` };
}

const send = (
  from_ref: string,
  to_name: string,
  body: string,
  to_namespace?: string,
): ClientFrame => ({
  v: 1,
  id: `s-${newId()}`,
  type: "send",
  from_ref,
  to_name,
  body,
  ...(to_namespace === undefined ? {} : { to_namespace }),
});

const list = (from_ref: string): ClientFrame => ({
  v: 1,
  id: `l-${newId()}`,
  type: "list",
  from_ref,
});

const tick = () => new Promise((r) => setTimeout(r, 30));

const receiptRow = (h: HubStub, id: string) =>
  inHub(
    h,
    (_, s) =>
      s.storage.sql
        .exec<{ state: string; reason: string | null; final_at: number }>(
          "select state, reason, final_at from receipts where id = ?",
          id,
        )
        .toArray()[0] ?? null,
  );

const mailCount = (h: HubStub, ids: string[]) =>
  inHub(h, (_, s) => {
    let n = 0;
    for (const id of ids)
      n += s.storage.sql
        .exec("select 1 from mail where id = ?", id)
        .toArray().length;
    return n;
  });

// ---------------------------------------------------------------------- RPC

describe("revokeMachine", () => {
  it("true the first time, then false; malformed and unknown ids are false", async () => {
    const h = freshHub();
    const m = await machineOn(h, "Once");
    expect(await h.revokeMachine("not an id")).toBe(false);
    expect(await h.revokeMachine("")).toBe(false);
    expect(await h.revokeMachine(newId())).toBe(false);
    expect(await h.revokeMachine(m.id)).toBe(true);
    expect(await h.revokeMachine(m.id)).toBe(false);
  });

  it("false has no side effects", async () => {
    const h = freshHub();
    const keep = await machineOn(h, "Keep");
    const o = await observer(h);
    expect(await h.revokeMachine(newId())).toBe(false);
    await tick();
    expect(o.seen.length).toBe(3);
    const [m] = await h.listMachines();
    expect(m).toMatchObject({ id: keep.id, revokedAt: null });
  });

  it("closes every daemon socket of the machine with 4403", async () => {
    const h = freshHub();
    const n = ns("close");
    const v = await agentOn(h, "Victim", "victim", n);
    const other = await agentOn(h, "Other", "other", n);
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    expect(await v.d.closed).toEqual({
      code: LIMITS.revokeCloseCode,
      reason: "machine revoked",
    });
    // Other machines keep their socket.
    await sync(other.d);
  });

  it("machineDto shows revokedAt; active machines are listed first", async () => {
    const h = freshHub();
    const a = await machineOn(h, "A");
    const b = await machineOn(h, "B");
    const c = await machineOn(h, "C");
    expect(await h.revokeMachine(c.id)).toBe(true);
    const ms = await h.listMachines();
    expect(ms.map((m) => m.id)).toEqual([b.id, a.id, c.id]);
    expect(ms[2]?.revokedAt).toEqual(expect.any(Number));
    expect(ms[2]?.connected).toBe(false);
    expect(ms[0]?.revokedAt).toBeNull();
  });
});

// ----------------------------------------------------------- agents, roster

describe("revoke drops the machine's agents", () => {
  it("from list, the roster and the observer feed; one roster_changed and one push", async () => {
    const h = freshHub();
    const n = ns("drop");
    const v = await agentOn(h, "Victim", "victim", n);
    const s = await agentOn(h, "Sender", "sender", n);
    const o = await observer(h);
    s.d.seen.length = 0;

    expect(await h.revokeMachine(v.m.id)).toBe(true);
    const p = await push(o);
    expect(p.agents.map((a) => a.name)).toEqual(["sender"]);
    const vm = p.machines.find((m) => m.id === v.m.id);
    expect(vm?.revokedAt).toEqual(expect.any(String));
    expect(vm?.connected).toBe(false);
    expect(p.machines.at(-1)?.id).toBe(v.m.id);

    // The close lands: no second push, no second roster_changed.
    await v.d.closed;
    await tick();
    await machineOn(h, "marker");
    const marker = await push(o);
    expect(marker.machines.some((m) => m.label === "marker")).toBe(true);

    s.d.send(list(s.ref));
    const r = await until(s.d, "roster");
    expect(r.agents.map((a) => a.bus_name)).toEqual(["sender"]);
    expect(
      s.d.seen.filter((f) => f.type === "roster_changed" && f.namespace === n)
        .length,
    ).toBe(1);
    expect((await h.listAgents()).map((a) => a.name)).toEqual(["sender"]);
    expect(
      (await h.listMachines()).find((m) => m.id === v.m.id)?.connected,
    ).toBe(false);
    const live = await inHub(
      h,
      (_, st) =>
        st.storage.sql
          .exec(
            "select 1 from agents where machine_id = ? and live = 1",
            v.m.id,
          )
          .toArray().length,
    );
    expect(live).toBe(0);
  });

  it("inside the throttle window, the trailing push shows revokedAt and the agents gone", async () => {
    const h = freshHub();
    const n = ns("thr");
    const v = await agentOn(h, "Victim", "victim", n);
    await agentOn(h, "Sender", "sender", n);
    const o = await observer(h);
    // An hour ahead of wall time: the real alarm (armed for t0 + 500) never
    // fires on its own; only runDurableObjectAlarm below runs it.
    const t0 = Date.now() + 3_600_000;
    await inHub(h, (i) => Hub.setTestClock(i, t0));
    // Opens a throttle window: this push goes out at once.
    await machineOn(h, "opener");
    await push(o);
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    await tick();
    // Throttled: due persisted and the alarm armed (revoke committed it).
    const due = await inHub(h, async (_, st) => ({
      alarm: await st.storage.getAlarm(),
      row: st.storage.sql
        .exec<{ value: string }>(
          "select value from meta where key = 'dashboard_push_due'",
        )
        .toArray()[0]?.value,
    }));
    expect(Number(due.row)).toBe(t0 + 500);
    expect(due.alarm).not.toBeNull();
    expect(due.alarm as number).toBeLessThanOrEqual(t0 + 500);
    await inHub(h, (i) => Hub.setTestClock(i, t0 + 600));
    expect(
      await runDurableObjectAlarm(h as unknown as DurableObjectStub<Hub>),
    ).toBe(true);
    const p = await push(o);
    expect(p.machines.find((m) => m.id === v.m.id)?.revokedAt).toEqual(
      expect.any(String),
    );
    expect(p.machines.find((m) => m.id === v.m.id)?.connected).toBe(false);
    expect(p.agents.map((a) => a.name)).toEqual(["sender"]);
    await inHub(h, (i) => Hub.setTestClock(i, null));
  });

  it("a revoked global agent tells every daemon", async () => {
    const h = freshHub();
    const v = await agentOn(h, "Victim", "gvictim", ns("g"), true);
    const n2 = ns("elsewhere");
    const s = await agentOn(h, "Sender", "sender", n2);
    s.d.seen.length = 0;
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    const rc = await until(s.d, "roster_changed");
    expect(rc.namespace).toBe(n2);
  });
});

// --------------------------------------------------------------------- mail

describe("revoke and mail", () => {
  it("pending mail to the machine expires once; bodies and held bytes dropped exactly", async () => {
    const h = freshHub();
    const n = ns("mail");
    const v = await agentOn(h, "Victim", "victim", n);
    const s = await agentOn(h, "Sender", "sender", n);
    const before = await inHub(h, (i) => Hub.heldStats(i));

    // One held inline push, one notice (stored body).
    s.d.send(send(s.ref, "victim", "hello"));
    const r1 = await until(s.d, "receipt");
    s.d.send(send(s.ref, "victim", "x".repeat(LIMITS.inlineBodyBytes + 1)));
    const r2 = await until(s.d, "receipt");
    await until(v.d, "deliver");
    await until(v.d, "deliver");
    const held = await inHub(h, (i) => Hub.heldStats(i));
    expect(held.ids).toContain(r1.msg_id);
    expect(held.bytes).toBeGreaterThan(before.bytes);
    expect(await mailCount(h, [r2.msg_id])).toBe(1);

    expect(await h.revokeMachine(v.m.id)).toBe(true);
    const u1 = await until(s.d, "receipt_update");
    const u2 = await until(s.d, "receipt_update");
    expect([u1, u2].map((u) => [u.msg_id, u.state, u.reason]).sort()).toEqual(
      [
        [r1.msg_id, "expired", "recipient_closed"],
        [r2.msg_id, "expired", "recipient_closed"],
      ].sort(),
    );
    for (const id of [r1.msg_id, r2.msg_id])
      expect(await receiptRow(h, id)).toMatchObject({
        state: "expired",
        reason: "revoked",
        final_at: expect.any(Number),
      });
    expect(await inHub(h, (i) => Hub.heldStats(i))).toEqual(before);
    expect(await mailCount(h, [r1.msg_id, r2.msg_id])).toBe(0);

    // Exactly once: nothing more after the close lands.
    await v.d.closed;
    await sync(s.d);
    expect(s.d.seen.filter((f) => f.type === "receipt_update").length).toBe(2);
  });

  it("past one batch, the alarm expires the rest; held bytes end exact", async () => {
    const h = freshHub();
    const n = ns("batch");
    const v = await agentOn(h, "Victim", "va", n);
    v.d.send(up("u2", "ref-vb", "vb", n));
    await until(v.d, "agent_ok");
    const s = await agentOn(h, "Sender", "sender", n);
    const before = await inHub(h, (i) => Hub.heldStats(i));
    const per = SWEEP_BATCH / 2 + 5;
    const ids: string[] = [];
    for (const to of ["va", "vb"])
      for (let k = 0; k < per; k++) {
        s.d.send(send(s.ref, to, `m${k}`));
        ids.push((await until(s.d, "receipt")).msg_id);
      }
    s.d.seen.length = 0;
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    await sync(s.d);
    const told = () =>
      s.d.seen.filter((f) => f.type === "receipt_update").length;
    expect(told()).toBe(SWEEP_BATCH);
    for (let k = 0; k < 5; k++)
      if (
        !(await runDurableObjectAlarm(h as unknown as DurableObjectStub<Hub>))
      )
        break;
    await sync(s.d);
    expect(told()).toBe(ids.length);
    for (const f of s.d.seen)
      if (f.type === "receipt_update")
        expect(f).toMatchObject({
          state: "expired",
          reason: "recipient_closed",
        });
    for (const id of ids)
      expect(await receiptRow(h, id)).toMatchObject({
        state: "expired",
        reason: "revoked",
      });
    expect(await inHub(h, (i) => Hub.heldStats(i))).toEqual(before);
  });

  it("leftovers past their TTL at the next alarm still expire as revoked (L2)", async () => {
    const h = freshHub();
    const t0 = Date.now();
    await inHub(h, (i) => Hub.setTestClock(i, t0));
    const n = ns("ttl");
    const v = await agentOn(h, "Victim", "va", n);
    v.d.send(up("u2", "ref-vb", "vb", n));
    await until(v.d, "agent_ok");
    const s = await agentOn(h, "Sender", "sender", n);
    const ids: string[] = [];
    for (const to of ["va", "vb"])
      for (let k = 0; k < SWEEP_BATCH / 2 + 5; k++) {
        s.d.send(send(s.ref, to, `m${k}`));
        ids.push((await until(s.d, "receipt")).msg_id);
      }
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    // The leftovers' TTL passes before the alarm drains them.
    await inHub(h, (i) =>
      Hub.setTestClock(i, t0 + LIMITS.mailTtlSec * 1000 + 1),
    );
    for (let k = 0; k < 5; k++)
      if (
        !(await runDurableObjectAlarm(h as unknown as DurableObjectStub<Hub>))
      )
        break;
    for (const id of ids)
      expect(await receiptRow(h, id)).toMatchObject({
        state: "expired",
        reason: "revoked",
      });
    await inHub(h, (i) => Hub.setTestClock(i, null));
  });

  it("an offline sender is told on its next agent_up, once", async () => {
    const h = freshHub();
    const n = ns("replay");
    const v = await agentOn(h, "Victim", "victim", n);
    const s = await agentOn(h, "Sender", "sender", n);
    s.d.send(send(s.ref, "victim", "hello"));
    const r = await until(s.d, "receipt");
    s.d.ws.close(1000, "bye");
    await tick();
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    await v.d.closed;

    const again = await daemonOn(h, s.m.id);
    again.send(up("u2", s.ref, "sender", n));
    await until(again, "agent_ok");
    const u = await until(again, "receipt_update");
    expect(u).toMatchObject({
      msg_id: r.msg_id,
      state: "expired",
      reason: "recipient_closed",
    });
    await sync(again);
    expect(again.seen.filter((f) => f.type === "receipt_update").length).toBe(
      1,
    );
  });

  it("drops delivered notices' bodies; leaves pending mail from its agents alone", async () => {
    const h = freshHub();
    const n = ns("notice");
    const v = await agentOn(h, "Victim", "victim", n);
    const s = await agentOn(h, "Sender", "sender", n);
    // A notice the victim acked (body kept for fetch).
    s.d.send(send(s.ref, "victim", "y".repeat(LIMITS.inlineBodyBytes + 1)));
    const r = await until(s.d, "receipt");
    const d = await until(v.d, "deliver");
    v.d.send({ v: 1, id: "a", type: "ack", msg_id: d.msg_id });
    await until(s.d, "receipt_update");
    expect(await mailCount(h, [r.msg_id])).toBe(1);
    // Mail the victim sent the sender, still pending.
    s.d.ws.close(1000, "bye");
    await tick();
    v.d.send(send(v.ref, "sender", "from victim"));
    const out = await until(v.d, "receipt");

    expect(await h.revokeMachine(v.m.id)).toBe(true);
    expect(await mailCount(h, [r.msg_id])).toBe(0);
    expect(await receiptRow(h, r.msg_id)).toMatchObject({
      state: "delivered",
    });
    expect(await receiptRow(h, out.msg_id)).toMatchObject({
      state: "pending",
    });
    expect(await mailCount(h, [out.msg_id])).toBe(1);
  });

  it("new sends get revoked in scope, B8 refusals out of scope", async () => {
    const h = freshHub();
    const n = ns("scope");
    const other = ns("other");
    const v = await agentOn(h, "Victim", "victim", n);
    const s = await agentOn(h, "Sender", "sender", n);
    const g = await agentOn(h, "Global", "gsender", ns("gh"), true);
    const far = await agentOn(h, "Far", "far", other);
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    await v.d.closed;

    s.d.send(send(s.ref, "victim", "x"));
    expect(await until(s.d, "receipt")).toMatchObject({
      state: "refused",
      reason: "revoked",
    });
    s.d.send(send(s.ref, "VICTIM", "x", n));
    expect(await until(s.d, "receipt")).toMatchObject({
      state: "refused",
      reason: "revoked",
    });
    // A global sender sees every namespace.
    g.d.send(send(g.ref, "victim", "x"));
    expect(await until(g.d, "receipt")).toMatchObject({ reason: "revoked" });
    g.d.send(send(g.ref, "victim", "x", n));
    expect(await until(g.d, "receipt")).toMatchObject({ reason: "revoked" });
    // Outside the sender's scope: B8 rules, no existence leak.
    far.d.send(send(far.ref, "victim", "x"));
    expect(await until(far.d, "receipt")).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    far.d.send(send(far.ref, "victim", "x", n));
    expect(await until(far.d, "receipt")).toMatchObject({
      state: "refused",
      reason: "other_namespace",
    });
  });

  it("a name reused after a revoke, then closed normally, is closed (L1)", async () => {
    const h = freshHub();
    const n = ns("reuse");
    const v = await agentOn(h, "Victim", "bob", n);
    const s = await agentOn(h, "Sender", "sender", n);
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    await v.d.closed;
    // #451: the revoke holds bob in n for the grace; reused after it.
    await inHub(h, (i) =>
      Hub.setTestClock(i, Date.now() + LIMITS.formerNameGraceMs + 1000),
    );
    const b2 = await agentOn(h, "New", "bob", n);
    s.d.send(send(s.ref, "bob", "hi"));
    expect((await until(s.d, "receipt")).state).toBe("pending");
    b2.d.send({ v: 1, id: "dn", type: "agent_down", agent_ref: b2.ref });
    await sync(b2.d);
    s.d.send(send(s.ref, "bob", "hi"));
    expect(await until(s.d, "receipt")).toMatchObject({
      state: "refused",
      reason: "closed",
    });
    // A global sender, without and with to_namespace, agrees.
    const g = await agentOn(h, "Global", "gsender", ns("gh"), true);
    g.d.send(send(g.ref, "bob", "hi"));
    expect(await until(g.d, "receipt")).toMatchObject({ reason: "closed" });
    g.d.send(send(g.ref, "bob", "hi", n));
    expect(await until(g.d, "receipt")).toMatchObject({ reason: "closed" });
  });

  it("revoked wins over closed for the same name", async () => {
    const h = freshHub();
    const n = ns("both");
    const c = await agentOn(h, "Closer", "dup", n);
    c.d.send({ v: 1, id: "dn", type: "agent_down", agent_ref: c.ref });
    await sync(c.d);
    // #451: the close holds dup in n for the grace; reused after it.
    await inHub(h, (i) =>
      Hub.setTestClock(i, Date.now() + LIMITS.formerNameGraceMs + 1000),
    );
    const v = await agentOn(h, "Victim", "dup", n);
    const s = await agentOn(h, "Sender", "sender", n);
    expect(await h.revokeMachine(v.m.id)).toBe(true);
    s.d.send(send(s.ref, "dup", "x"));
    expect(await until(s.d, "receipt")).toMatchObject({ reason: "revoked" });
  });
});

// ---------------------------------------------------- reconnect, mid-flight

describe("after revoke", () => {
  it("verifyToken refuses the token and a /hub reconnect gets 401", async () => {
    const m = await machine("Gone");
    const owner = hub(e);
    expect(await owner.revokeMachine(m.id)).toBe(true);
    expect(await owner.verifyToken(await sha256Hex(m.token))).toBeNull();
    const res = await upgrade(m.token);
    expect(res.status).toBe(401);
    // The DO's own forward refuses it too.
    const direct = await fetchOf(owner)("https://hub.internal/hub", {
      headers: { Upgrade: "websocket", "X-Ob-Machine-Id": m.id },
    });
    expect(direct.status).toBe(401);
  });

  it("a frame on a revoked socket is never processed", async () => {
    const h = freshHub();
    const n = ns("race");
    const v = await agentOn(h, "Victim", "victim", n);
    const t = await agentOn(h, "Target", "target", n);
    // Revoked in storage only: the socket has not been closed yet.
    await inHub(h, (_, s) =>
      s.storage.sql.exec(
        "update machines set revoked_at = ? where id = ?",
        Date.now(),
        v.m.id,
      ),
    );
    v.d.send(send(v.ref, "target", "late"));
    expect((await v.d.closed).code).toBe(LIMITS.revokeCloseCode);
    await sync(t.d);
    expect(t.d.seen.some((f) => f.type === "deliver")).toBe(false);
    expect(v.d.seen.some((f) => f.type === "receipt")).toBe(false);
  });

  it("a frame racing revokeMachine is never processed", async () => {
    const h = freshHub();
    const n = ns("race2");
    const v = await agentOn(h, "Victim", "victim", n);
    const t = await agentOn(h, "Target", "target", n);
    const revoked = h.revokeMachine(v.m.id);
    v.d.send(send(v.ref, "target", "late"));
    expect(await revoked).toBe(true);
    expect((await v.d.closed).code).toBe(LIMITS.revokeCloseCode);
    await sync(t.d);
    // The send either landed before the revoke (mail from the victim is left
    // alone) or was dropped; never processed after it.
    const rows = await inHub(h, (_, s) =>
      s.storage.sql
        .exec<{ created_at: number }>(
          "select r.created_at from receipts r join machines m on m.id = ? where r.from_name = 'victim' and r.created_at > m.revoked_at",
          v.m.id,
        )
        .toArray(),
    );
    expect(rows).toEqual([]);
  });
});
