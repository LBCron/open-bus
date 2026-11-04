// #422: a machine offline for over OFFLINE_REAP_MS (24 h) has its live agents
// closed by the alarm, exactly as agent_down closes one. machines
// .disconnected_at records when its last socket went; a connect clears it; a
// replaced socket never sets it. A hub that predates the column (an offline
// machine with live agents and no disconnected_at) starts counting at its
// first wake or alarm, so a deploy never reaps at once. Time is
// Hub.setTestClock, always set ahead of real time and reset after each test.
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  type ClientFrame,
  RENAME_MIN_CLIENT,
  type ServerFrame,
} from "@ob/shared";
import { afterEach, describe, expect, it } from "vitest";
import { Hub, OFFLINE_REAP_MS } from "../src/hub/do.js";
import { hub } from "../src/hub/stub.js";
import { type Daemon, daemon, e, machine, ns, waitFor } from "./helpers.js";

const stub = () => hub(e) as unknown as DurableObjectStub<Hub>;
const inHub = <R>(fn: (i: Hub, s: DurableObjectState) => R) =>
  runInDurableObject(stub(), fn);
const setClock = (ms: number | null) => inHub((i) => Hub.setTestClock(i, ms));
const runAlarm = () => runDurableObjectAlarm(stub());
const alarmAt = () => inHub((_, s) => s.storage.getAlarm());

afterEach(async () => {
  await setClock(null);
});

let seq = 0;
const id = (t: string) => `${t}${++seq}`;
const uniq = (t: string) => `${t}-${++seq}x${Date.now() % 1e8}`;
/** A frozen hub time ahead of real time, distinct per test. */
const base = () => Date.now() + 3_600_000 + ++seq * 1000;

type Roster = Extract<ServerFrame, { type: "roster" }>;
type Receipt = Extract<ServerFrame, { type: "receipt" }>;

async function connect(token: string): Promise<Daemon> {
  const d = await daemon(token);
  d.send({
    v: 1,
    id: id("h"),
    type: "hello",
    machine_label: "MacBook",
    client_version: RENAME_MIN_CLIENT,
  });
  await waitFor(d, "hello_ok");
  return d;
}

async function reg(
  d: Daemon,
  ref: string,
  name: string,
  namespace: string,
): Promise<string> {
  d.send({
    v: 1,
    id: id("u"),
    type: "agent_up",
    agent_ref: ref,
    kind: "pi",
    proposed_name: name,
    namespace,
    global: false,
  });
  return (await waitFor(d, "agent_ok")).bus_name;
}

async function list(d: Daemon, from: string): Promise<Roster> {
  const fid = id("l");
  d.send({ v: 1, id: fid, type: "list", from_ref: from });
  for (;;) {
    const f = await d.next();
    if (f.type === "roster" && f.id === fid) return f;
  }
}

async function send(d: Daemon, from: string, to: string): Promise<Receipt> {
  const fid = id("s");
  d.send({
    v: 1,
    id: fid,
    type: "send",
    from_ref: from,
    to_name: to,
    body: "hi",
  } as ClientFrame);
  for (;;) {
    const f = await d.next();
    if (f.type === "receipt" && f.id === fid) return f;
  }
}

const stateOf = (r: Roster, name: string) =>
  r.agents.find((a) => a.bus_name === name)?.state;

const disconnectedAt = (machineId: string) =>
  inHub((_, s) => {
    const r = s.storage.sql
      .exec("select disconnected_at as t from machines where id = ?", machineId)
      .toArray()[0];
    return r === undefined ? undefined : (r.t as number | null);
  });

const liveOf = (machineId: string) =>
  inHub((_, s) =>
    s.storage.sql
      .exec(
        "select name from agents where machine_id = ? and live = 1 order by name",
        machineId,
      )
      .toArray()
      .map((r) => String(r.name)),
  );

/** Closes the daemon and waits until the hub has recorded the machine offline. */
async function goOffline(d: Daemon, machineId: string): Promise<number> {
  d.close();
  await d.closed;
  for (let k = 0; k < 200; k++) {
    const t = await disconnectedAt(machineId);
    if (typeof t === "number") return t;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("machine never recorded offline");
}

/** Runs the alarm at hub time `t` (armed first, so it always runs). */
async function alarmAtTime(t: number): Promise<void> {
  await setClock(t);
  await inHub(async (_, s) => {
    if ((await s.storage.getAlarm()) === null) await s.storage.setAlarm(t);
  });
  await runAlarm();
}

describe("offline reap (#422)", () => {
  it("closes a machine's agents after 24 h offline, not before; others untouched", async () => {
    const t0 = base();
    await setClock(t0);
    const away = await machine("Away");
    const watch = await machine("Watch");
    const other = await machine("Other");
    const n = ns("reap");
    const n2 = ns("reap2");
    const a = await connect(away.token);
    const w = await connect(watch.token);
    const o = await connect(other.token);
    const gone = await reg(a, "ga", uniq("Gone"), n);
    await reg(w, "wa", uniq("Watch"), n);
    const stay = await reg(o, "oa", uniq("Stay"), n2);

    expect(await disconnectedAt(away.id)).toBeNull();
    expect(await goOffline(a, away.id)).toBe(t0);
    // Another machine offline, but only for an hour at the reap time.
    await setClock(t0 + OFFLINE_REAP_MS - 3_600_000);
    await goOffline(o, other.id);

    // The reap deadline is armed.
    const at = await alarmAt();
    expect(at).not.toBeNull();
    expect(at as number).toBeLessThanOrEqual(t0 + OFFLINE_REAP_MS);

    await alarmAtTime(t0 + OFFLINE_REAP_MS - 1);
    expect(stateOf(await list(w, "wa"), gone)).toBe("queued");
    expect(await liveOf(away.id)).toEqual([gone]);

    await alarmAtTime(t0 + OFFLINE_REAP_MS);
    expect(await liveOf(away.id)).toEqual([]);
    expect(stateOf(await list(w, "wa"), gone)).toBeUndefined();
    expect(await send(w, "wa", gone)).toMatchObject({
      state: "refused",
      reason: "closed",
    });
    // The other offline machine's agent is still open (queued).
    expect(await liveOf(other.id)).toEqual([stay]);
    expect(await disconnectedAt(other.id)).toBe(
      t0 + OFFLINE_REAP_MS - 3_600_000,
    );
    // No hot loop: nothing re-arms at now + 1 for the reaped machine.
    const next = await alarmAt();
    expect(next === null || next > t0 + OFFLINE_REAP_MS + 1).toBe(true);
    w.close();
  });

  it("a machine that reconnects before 24 h is not reaped", async () => {
    const t0 = base();
    await setClock(t0);
    const m = await machine("Back");
    const n = ns("back");
    const d = await connect(m.token);
    const name = await reg(d, "b", uniq("Back"), n);
    await goOffline(d, m.id);
    await setClock(t0 + 3_600_000);
    const d2 = await connect(m.token);
    expect(await disconnectedAt(m.id)).toBeNull();
    await alarmAtTime(t0 + 2 * OFFLINE_REAP_MS);
    expect(await liveOf(m.id)).toEqual([name]);
    expect(stateOf(await list(d2, "b"), name)).toBe("live");
    d2.close();
  });

  it("a replaced socket never marks the machine offline", async () => {
    const t0 = base();
    await setClock(t0);
    const m = await machine("Twice");
    const d1 = await connect(m.token);
    const name = await reg(d1, "t", uniq("Twice"), ns("twice"));
    const d2 = await connect(m.token);
    const c = await d1.closed;
    expect(c.reason).toBe("replaced");
    await new Promise((r) => setTimeout(r, 20));
    expect(await disconnectedAt(m.id)).toBeNull();
    await alarmAtTime(t0 + 2 * OFFLINE_REAP_MS);
    expect(await liveOf(m.id)).toEqual([name]);
    d2.close();
  });

  it("a reaped agent comes back live, with its name, when the daemon re-announces it", async () => {
    const t0 = base();
    await setClock(t0);
    const m = await machine("Return");
    const n = ns("ret");
    const d = await connect(m.token);
    const name = await reg(d, "r", uniq("Return"), n);
    await goOffline(d, m.id);
    await alarmAtTime(t0 + OFFLINE_REAP_MS);
    expect(await liveOf(m.id)).toEqual([]);

    await setClock(t0 + OFFLINE_REAP_MS + 60_000);
    const d2 = await connect(m.token);
    expect(await disconnectedAt(m.id)).toBeNull();
    expect(await reg(d2, "r", name, n)).toBe(name);
    expect(stateOf(await list(d2, "r"), name)).toBe("live");
    d2.close();
  });

  it("drops a reaped agent's former names and rename log", async () => {
    const t0 = base();
    await setClock(t0);
    const m = await machine("Renamed");
    const n = ns("fn");
    const d = await connect(m.token);
    const old = uniq("Old");
    await reg(d, "f", old, n);
    const fid = id("r");
    const now = uniq("New");
    d.send({
      v: 1,
      id: fid,
      type: "rename",
      agent_ref: "f",
      proposed_name: now,
    });
    expect((await waitFor(d, "renamed")).bus_name).toBe(now);
    const agentId = await inHub(
      (_, s) =>
        s.storage.sql
          .exec("select id from agents where name = ?", now)
          .toArray()[0]?.id as string,
    );
    // Kept past the reap, so only the close can drop them.
    await inHub((_, s) => {
      s.storage.sql.exec(
        "update former_names set expires_at = ? where agent_id = ?",
        t0 + 10 * OFFLINE_REAP_MS,
        agentId,
      );
      s.storage.sql.exec(
        "update rename_rl set at = ? where agent_id = ?",
        t0 + 10 * OFFLINE_REAP_MS,
        agentId,
      );
    });
    const count = (table: string) =>
      inHub(
        (_, s) =>
          s.storage.sql
            .exec(
              `select count(*) as n from ${table} where agent_id = ?`,
              agentId,
            )
            .toArray()[0]?.n as number,
      );
    expect(await count("former_names")).toBe(1);
    expect(await count("rename_rl")).toBeGreaterThan(0);
    await goOffline(d, m.id);
    await alarmAtTime(t0 + OFFLINE_REAP_MS);
    expect(await liveOf(m.id)).toEqual([]);
    expect(await count("former_names")).toBe(0);
    expect(await count("rename_rl")).toBe(0);
  });

  it("an offline machine with no live agents arms no reap deadline", async () => {
    const t0 = base();
    await setClock(t0);
    const m = await machine("Empty");
    const d = await connect(m.token);
    await goOffline(d, m.id);
    await alarmAtTime(t0 + 1);
    const at = await alarmAt();
    expect(at).not.toBe(t0 + OFFLINE_REAP_MS);
  });

  it("a machine offline before the deploy (no disconnected_at) is not reaped on the first alarm", async () => {
    const t0 = base();
    await setClock(t0);
    const m = await machine("Legacy");
    const d = await connect(m.token);
    const name = await reg(d, "l", uniq("Legacy"), ns("legacy"));
    await goOffline(d, m.id);
    // As a hub that predates the column: offline, live agents, no timestamp.
    await inHub((_, s) =>
      s.storage.sql.exec(
        "update machines set disconnected_at = null where id = ?",
        m.id,
      ),
    );
    const later = t0 + 3 * OFFLINE_REAP_MS;
    await alarmAtTime(later);
    expect(await liveOf(m.id)).toEqual([name]);
    // Counting starts now: reaped 24 h later, not before.
    expect(await disconnectedAt(m.id)).toBe(later);
    await alarmAtTime(later + OFFLINE_REAP_MS - 1);
    expect(await liveOf(m.id)).toEqual([name]);
    await alarmAtTime(later + OFFLINE_REAP_MS);
    expect(await liveOf(m.id)).toEqual([]);
  });
});
