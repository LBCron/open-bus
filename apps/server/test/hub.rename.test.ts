// R393b (#393): the hub side of renames. `rename` answers `renamed` or an
// error; a former name keeps reaching its agent for LIMITS.formerNameGraceMs,
// a chosen one stays reserved for it, a default name is minted
// `<base>-<4 hex>` and never minted again; resolution looks in the sender's
// own namespace first. `former_names` and a former-name `to_name` go only to
// daemons at or above RENAME_MIN_CLIENT. Time is Hub.setTestClock, always
// set ahead of real time and reset after each test.
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  AGENT_CARD_MIN_CLIENT,
  type ClientFrame,
  LIMITS,
  RENAME_MESSAGES,
  RENAME_MIN_CLIENT,
  type ServerFrame,
} from "@ob/shared";
import { afterEach, describe, expect, it } from "vitest";
import { Hub } from "../src/hub/do.js";
import { migrateHub } from "../src/hub/schema.js";
import { hub } from "../src/hub/stub.js";
import { type Daemon, daemon, e, machine, ns, waitFor } from "./helpers.js";

const stub = () => hub(e) as unknown as DurableObjectStub<Hub>;
const inHub = <R>(fn: (i: Hub, s: DurableObjectState) => R) =>
  runInDurableObject(stub(), fn);
const setClock = (ms: number | null) => inHub((i) => Hub.setTestClock(i, ms));

afterEach(async () => {
  await setClock(null);
});

const GRACE = LIMITS.formerNameGraceMs;
let seq = 0;
const id = (t: string) => `${t}${++seq}`;
const uniq = (t: string) => `${t}-${++seq}x${Date.now() % 1e8}`;

type Renamed = Extract<ServerFrame, { type: "renamed" }>;
type ErrorFrame = Extract<ServerFrame, { type: "error" }>;
type Receipt = Extract<ServerFrame, { type: "receipt" }>;
type Roster = Extract<ServerFrame, { type: "roster" }>;

/** A daemon that said hello as `version` (the rename gate by default). */
async function at(version = RENAME_MIN_CLIENT): Promise<Daemon> {
  const m = await machine();
  const d = await daemon(m.token);
  d.send({
    v: 1,
    id: id("h"),
    type: "hello",
    machine_label: "MacBook",
    client_version: version,
  });
  await waitFor(d, "hello_ok");
  return d;
}

async function reg(
  d: Daemon,
  ref: string,
  name: string,
  namespace: string,
  opts: { global?: boolean; kind?: "default" | "chosen" } = {},
): Promise<string> {
  d.send({
    v: 1,
    id: id("u"),
    type: "agent_up",
    agent_ref: ref,
    kind: "pi",
    proposed_name: name,
    namespace,
    global: opts.global ?? false,
    ...(opts.kind === undefined ? {} : { name_kind: opts.kind }),
  });
  return (await waitFor(d, "agent_ok")).bus_name;
}

/** Sends `rename`; resolves with the `renamed` or `error` that answers it. */
async function rename(
  d: Daemon,
  ref: string,
  name: string,
  kind?: "default" | "chosen",
): Promise<Renamed | ErrorFrame> {
  const fid = id("r");
  d.send({
    v: 1,
    id: fid,
    type: "rename",
    agent_ref: ref,
    proposed_name: name,
    ...(kind === undefined ? {} : { name_kind: kind }),
  });
  for (;;) {
    const f = await d.next();
    if ((f.type === "renamed" || f.type === "error") && f.id === fid) return f;
  }
}

async function renamed(
  d: Daemon,
  ref: string,
  name: string,
  kind?: "default" | "chosen",
): Promise<Renamed> {
  const r = await rename(d, ref, name, kind);
  expect(r.type, JSON.stringify(r)).toBe("renamed");
  return r as Renamed;
}

async function send(
  d: Daemon,
  from: string,
  to: string,
  toNamespace?: string,
): Promise<Receipt> {
  const fid = id("s");
  d.send({
    v: 1,
    id: fid,
    type: "send",
    from_ref: from,
    to_name: to,
    body: "hi",
    ...(toNamespace === undefined ? {} : { to_namespace: toNamespace }),
  } as ClientFrame);
  for (;;) {
    const f = await d.next();
    if (f.type === "receipt" && f.id === fid) return f;
  }
}

async function list(d: Daemon, from: string): Promise<Roster> {
  const fid = id("l");
  d.send({ v: 1, id: fid, type: "list", from_ref: from });
  for (;;) {
    const f = await d.next();
    if (f.type === "roster" && f.id === fid) return f;
  }
}

const row = (r: Roster, name: string) =>
  r.agents.find((a) => a.bus_name === name);

/** The deliver frame for `msgId`, from frames already received or still to come. */
async function delivered(d: Daemon, msgId: string) {
  for (;;) {
    const f = await d.next();
    if (f.type === "deliver" && f.msg_id === msgId) return f;
  }
}

/** The former names stored for the agent now (or last) named `name`. */
const formerRows = (name: string) =>
  inHub((_, s) =>
    s.storage.sql
      .exec(
        "select f.name from former_names f join agents a on a.id = f.agent_id where a.name = ?",
        name,
      )
      .toArray()
      .map((r) => String(r.name)),
  );

/**
 * `times` name changes by `rename`, alternating between two fresh names so
 * at most two chosen former names pile up (the agent's own former name is
 * free to it, and taking it back drops its row). Returns the current name.
 */
async function churn(d: Daemon, ref: string, times: number): Promise<string> {
  const pair = [uniq("Ping"), uniq("Pong")];
  let cur = "";
  for (let i = 0; i < times; i++) {
    cur = pair[i % 2] as string;
    expect((await renamed(d, ref, cur)).bus_name).toBe(cur);
  }
  return cur;
}

describe("rename (R393b)", () => {
  it("A→B: renamed with former; a send to A is delivered to it, with to_name B", async () => {
    const d = await at();
    const n = ns("rn");
    const a = uniq("Alpha");
    const b = uniq("Bravo");
    await reg(d, "s", uniq("Sender"), n);
    await reg(d, "a", a, n);
    const r = await renamed(d, "a", b);
    expect(r).toMatchObject({ agent_ref: "a", bus_name: b, former: a });

    const rc = await send(d, "s", a);
    expect(rc).toMatchObject({ state: "pending", to_name: b });
    const dl = await delivered(d, rc.msg_id);
    expect(dl.to_ref).toBe("a");
    // Any case of the former name resolves.
    expect(await send(d, "s", a.toUpperCase())).toMatchObject({
      state: "pending",
      to_name: b,
    });
    // The current name carries no to_name.
    const cur = await send(d, "s", b);
    expect(cur.state).toBe("pending");
    expect(cur.to_name).toBeUndefined();

    const ro = await list(d, "s");
    expect(row(ro, a)).toBeUndefined();
    const fn = row(ro, b)?.former_names;
    expect(fn).toHaveLength(1);
    expect(fn?.[0]?.name).toBe(a);
    const exp = Date.parse(fn?.[0]?.expires_at ?? "");
    expect(exp).toBeGreaterThan(Date.now() + GRACE - 60_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + GRACE + 1000);
    d.close();
  });

  it("a rename keeps status and the socket; others get roster_changed", async () => {
    const d = await at();
    const watcher = await at();
    const n = ns("rn");
    await reg(d, "a", uniq("Stat"), n);
    await reg(watcher, "w", uniq("Watch"), n);
    d.send({
      v: 1,
      id: id("st"),
      type: "status",
      from_ref: "a",
      state: "working",
      label: "busy",
    });
    const b = uniq("Stat2");
    await renamed(d, "a", b);
    const rc = await waitFor(watcher, "roster_changed");
    expect(rc.namespace).toBe(n);
    const ro = await list(d, "a");
    expect(row(ro, b)).toMatchObject({
      status: "working",
      status_label: "busy",
    });
    watcher.close();
    d.close();
  });

  it("after the grace, A is unknown_agent and the alarm purges the row", async () => {
    const t0 = Date.now() + 10 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    const a = uniq("Gone");
    await reg(d, "s", uniq("Sender"), n);
    await reg(d, "a", a, n);
    const here = uniq("Here");
    await renamed(d, "a", here);
    await setClock(t0 + GRACE - 1);
    expect((await send(d, "s", a)).state).toBe("pending");
    await setClock(t0 + GRACE);
    expect(await send(d, "s", a)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    // No former_names once expired, even before the purge.
    const ro = await list(d, "s");
    expect(ro.agents.every((x) => x.former_names === undefined)).toBe(true);
    await runDurableObjectAlarm(stub());
    expect(await formerRows(here)).toEqual([]);
    d.close();
  });

  it("a chosen former name is reserved for the grace: a new agent asking for it gets A-2", async () => {
    const t0 = Date.now() + 20 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    const a = uniq("Kept");
    await reg(d, "a", a, n);
    await renamed(d, "a", uniq("Moved"));
    expect(await reg(d, "x", a, n)).toBe(`${a}-2`);
    // A rename to it is de-collided the same way.
    await reg(d, "y", uniq("Other"), n);
    expect((await renamed(d, "y", a)).bus_name).toBe(`${a}-3`);
    // After the grace the name is free again.
    await setClock(t0 + GRACE);
    expect(await reg(d, "z", a, n)).toBe(a);
    d.close();
  });

  it("A→B→A is allowed and keeps former names distinct and never the current name", async () => {
    const d = await at();
    const n = ns("rn");
    const a = uniq("Ping");
    const b = uniq("Pong");
    await reg(d, "s", uniq("Sender"), n);
    await reg(d, "a", a, n);
    await renamed(d, "a", b);
    expect(await renamed(d, "a", a)).toMatchObject({ bus_name: a, former: b });
    await renamed(d, "a", b);
    const fn = row(await list(d, "s"), b)?.former_names;
    expect(fn?.map((f) => f.name)).toEqual([a]);
    expect(await formerRows(b)).toEqual([a]);
    d.close();
  });

  it("former names are newest first, at most maxFormerNames; a default one is dropped first, a chosen one never in its grace", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const c0 = uniq("C0");
    await reg(d, "a", c0, n);
    const c1 = uniq("C1");
    await renamed(d, "a", c1);
    // Four minted names in turn: each leaves a default former name.
    const minted: string[] = [];
    for (let i = 0; i < 4; i++)
      minted.push((await renamed(d, "a", uniq(`pb${i}`), "default")).bus_name);
    const current = uniq("C2");
    await renamed(d, "a", current);
    // Six left (c0, c1, four minted): the oldest DEFAULT one is dropped.
    const left = [c0, c1, ...minted];
    const kept = left.filter((x) => x !== minted[0]);
    expect((await formerRows(current)).sort()).toEqual([...kept].sort());
    const fn = row(await list(d, "s"), current)?.former_names ?? [];
    expect(fn.map((f) => f.name)).toEqual([...kept].reverse());
    for (let i = 1; i < fn.length; i++)
      expect(Date.parse(fn[i]?.expires_at ?? "")).toBeLessThanOrEqual(
        Date.parse(fn[i - 1]?.expires_at ?? ""),
      );
    // The dropped default name no longer resolves, and still is never handed
    // on; the oldest chosen one still resolves and stays reserved.
    expect(await send(d, "s", minted[0] as string)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    expect(await reg(d, "x", minted[0] as string, n)).toBe(`${minted[0]}-2`);
    expect(await send(d, "s", c0)).toMatchObject({
      state: "pending",
      to_name: current,
    });
    expect(await reg(d, "y", c0, n)).toBe(`${c0}-2`);
    d.close();
  });

  it("with maxFormerNames chosen names in grace, a 6th chosen rename is rate_limited; the oldest stays reserved (#449 B1)", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const mine = uniq("Mine");
    await reg(d, "a", mine, n);
    let cur = mine;
    for (let i = 0; i < LIMITS.maxFormerNames; i++) {
      cur = uniq(`M${i}`);
      await renamed(d, "a", cur);
    }
    expect(await formerRows(cur)).toHaveLength(LIMITS.maxFormerNames);
    expect(await rename(d, "a", uniq("Sixth"))).toMatchObject({
      type: "error",
      code: "rate_limited",
      message: RENAME_MESSAGES.room,
    });
    expect(await reg(d, "x", mine, n)).toBe(`${mine}-2`);
    const rc = await send(d, "s", mine);
    expect(rc).toMatchObject({ state: "pending", to_name: cur });
    expect((await delivered(d, rc.msg_id)).to_ref).toBe("a");
    // Back to one of its own former names is allowed: it frees that row.
    expect(await renamed(d, "a", mine)).toMatchObject({
      bus_name: mine,
      former: cur,
    });
    expect(await formerRows(mine)).toHaveLength(LIMITS.maxFormerNames);
    d.close();
  });

  it("the 11th rename in an hour is rate_limited with the pinned message; no-ops are free", async () => {
    const t0 = Date.now() + 30 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    let cur = uniq("Rate");
    await reg(d, "a", cur, n);
    const pair = [uniq("RateP"), uniq("RateQ")];
    for (let i = 0; i < LIMITS.renamesPerHour; i++) {
      // A no-op between every rename never counts.
      expect(await renamed(d, "a", cur)).not.toHaveProperty("former");
      cur = pair[i % 2] as string;
      await renamed(d, "a", cur);
    }
    const r = await rename(d, "a", uniq("Over"));
    expect(r).toMatchObject({
      type: "error",
      code: "rate_limited",
      message: RENAME_MESSAGES.rate,
    });
    // Still free at the limit.
    expect(await renamed(d, "a", cur)).toEqual(
      expect.not.objectContaining({ former: expect.anything() }),
    );
    // A rolling hour.
    await setClock(t0 + GRACE + 1);
    expect((await renamed(d, "a", uniq("Later"))).former).toBe(cur);
    d.close();
  });

  it("a no-op answers renamed without former and records nothing", async () => {
    const d = await at();
    const n = ns("rn");
    const a = uniq("Same");
    await reg(d, "a", a, n);
    const r = await renamed(d, "a", `  ${a} `);
    expect(r).toEqual({
      v: 1,
      id: r.id,
      type: "renamed",
      agent_ref: "a",
      bus_name: a,
    });
    expect(await formerRows(a)).toEqual([]);
    d.close();
  });

  it("a case-only change is a rename, with no former row (same name, any case)", async () => {
    const d = await at();
    const n = ns("rn");
    const a = uniq("Casey");
    await reg(d, "s", uniq("Sender"), n);
    await reg(d, "a", a, n);
    const r = await renamed(d, "a", a.toLowerCase());
    expect(r).toMatchObject({ bus_name: a.toLowerCase(), former: a });
    expect(await formerRows(a.toLowerCase())).toEqual([]);
    const rc = await send(d, "s", a);
    expect(rc.state).toBe("pending");
    expect(rc.to_name).toBeUndefined();
    d.close();
  });

  it("close drops former names: the name is free at once (agent_down, sessions, revoke)", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const a = uniq("Closer");
    await reg(d, "a", a, n);
    const a2 = uniq("Closer2");
    await renamed(d, "a", a2);
    expect(await formerRows(a2)).toEqual([a]);
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "a" });
    expect(await reg(d, "x", a, n)).toBe(a);
    expect(await formerRows(a2)).toEqual([]);

    const b = uniq("Sess");
    await reg(d, "b", b, n);
    const b2 = uniq("Sess2");
    await renamed(d, "b", b2);
    d.send({ v: 1, id: id("c"), type: "sessions", open: [], closed: ["b"] });
    expect(await reg(d, "y", b, n)).toBe(b);
    expect(await formerRows(b2)).toEqual([]);

    const m = await machine();
    const v = await daemon(m.token);
    v.send({
      v: 1,
      id: id("h"),
      type: "hello",
      machine_label: "M",
      client_version: RENAME_MIN_CLIENT,
    });
    await waitFor(v, "hello_ok");
    const c = uniq("Revoked");
    await reg(v, "rv", c, n);
    const c2 = uniq("Revoked2");
    await renamed(v, "rv", c2);
    expect(await hub(e).revokeMachine(m.id)).toBe(true);
    expect(await reg(d, "z", c, n)).toBe(c);
    expect(await formerRows(c2)).toEqual([]);
    d.close();
  });

  it("rename from a non-live agent is not_registered", async () => {
    const d = await at();
    const n = ns("rn");
    expect(await rename(d, "nobody", "X")).toMatchObject({
      type: "error",
      code: "not_registered",
    });
    await reg(d, "a", uniq("Closed"), n);
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "a" });
    expect(await rename(d, "a", "X")).toMatchObject({
      type: "error",
      code: "not_registered",
    });
    // The socket stays usable.
    await reg(d, "b", uniq("After"), n);
    d.close();
  });

  it("a namespace-hidden former name is unknown_agent; a global's follows its visibility", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    const a = uniq("Hidden");
    const g = uniq("GlobalOld");
    await reg(d, "a", a, n1);
    await reg(d, "g", g, n1, { global: true });
    await reg(d, "s", uniq("Outsider"), n2);
    await renamed(d, "a", uniq("Hidden2"));
    const gNew = uniq("GlobalNew");
    await renamed(d, "g", gNew);
    expect(await send(d, "s", a)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    expect(await send(d, "s", a, n1)).toMatchObject({
      state: "refused",
      reason: "other_namespace",
    });
    // A global's former name is visible wherever its current name is.
    expect(await send(d, "s", g)).toMatchObject({
      state: "pending",
      to_name: gNew,
    });
    expect(await send(d, "s", g, n1)).toMatchObject({
      state: "pending",
      to_name: gNew,
    });
    // ...and reserved globally.
    expect(await reg(d, "x", g, n2)).toBe(`${g}-2`);
    d.close();
  });

  it("the sender's own namespace comes first: its former name beats a live name elsewhere", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    const shared = uniq("Shared");
    const moved = uniq("Moved");
    await reg(d, "g", uniq("Global"), n1, { global: true });
    await reg(d, "l", uniq("Local"), n1);
    await reg(d, "own", shared, n1);
    await renamed(d, "own", moved);
    // Not reserved in another namespace: a non-global there may take it.
    expect(await reg(d, "far", shared, n2)).toBe(shared);
    for (const from of ["g", "l"])
      expect(await send(d, from, shared)).toMatchObject({
        state: "pending",
        to_name: moved,
      });
    // The global sender reaches the other one only by naming its namespace.
    const there = await send(d, "g", shared, n2);
    expect(there.state).toBe("pending");
    expect(there.to_name).toBeUndefined();
    d.close();
  });

  it("a daemon below the gate gets no former_names and no to_name, and resolves the same", async () => {
    const d = await at();
    for (const version of [AGENT_CARD_MIN_CLIENT, "0.64.0"]) {
      const old = await at(version);
      const n = ns("rn");
      const a = uniq("Old");
      const b = uniq("New");
      await reg(old, "s", uniq("Sender"), n);
      await reg(d, "a", a, n);
      await renamed(d, "a", b);
      const rc = await send(old, "s", a);
      expect(rc.state).toBe("pending");
      expect(rc).not.toHaveProperty("to_name");
      // No to_name either for a plain send (#394 removed the role case).
      expect(await send(old, "s", b)).not.toHaveProperty("to_name");
      const ro = await list(old, "s");
      expect(row(ro, b)).toBeDefined();
      expect(ro.agents.every((x) => !("former_names" in x))).toBe(true);
      expect(old.raw.join("")).not.toContain("former_names");
      old.close();
      d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "a" });
    }
    d.close();
  });

  it("a resend of a send through a former name repeats its to_name", async () => {
    const d = await at();
    const n = ns("rn");
    const a = uniq("Re");
    const b = uniq("Re2");
    await reg(d, "s", uniq("Sender"), n);
    await reg(d, "a", a, n);
    await renamed(d, "a", b);
    const f = {
      v: 1,
      id: id("s"),
      type: "send",
      from_ref: "s",
      to_name: a,
      body: "hi",
    } as ClientFrame;
    d.send(f);
    const first = await waitFor(d, "receipt");
    d.send(f);
    const again = await waitFor(d, "receipt");
    expect(again).toMatchObject({ msg_id: first.msg_id, to_name: b });
    d.close();
  });
});

describe("review fixes (R393b)", () => {
  it("an ordinary send never carries to_name, at any version", async () => {
    const d = await at();
    const n = ns("rn");
    const target = uniq("Plain");
    await reg(d, "t", target, n);
    for (const version of ["0.1.0", AGENT_CARD_MIN_CLIENT, RENAME_MIN_CLIENT]) {
      const s = await at(version);
      await reg(s, "s", uniq("Sender"), n);
      for (const to of [target, target.toUpperCase()]) {
        const rc = await send(s, "s", to);
        expect(rc.state).toBe("pending");
        expect(rc).not.toHaveProperty("to_name");
      }
      s.close();
    }
    d.close();
  });

  it("a rename of another machine's live agent_ref is not_registered", async () => {
    const mine = await at();
    const other = await at();
    const n = ns("rn");
    const a = uniq("Theirs");
    await reg(other, "theirs", a, n);
    expect(await rename(mine, "theirs", uniq("Stolen"))).toMatchObject({
      type: "error",
      code: "not_registered",
    });
    const r = await list(other, "theirs");
    expect(row(r, a)).toBeDefined();
    mine.close();
    other.close();
  });

  it("a chosen name never takes another agent's minted name, in or after its grace (#446)", async () => {
    const t0 = Date.now() + 60 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const minted = await reg(d, "x", uniq("pi"), n, { kind: "default" });
    const xc = uniq("Xc");
    await renamed(d, "x", xc);
    // A new agent and a rename alike are de-collided, in any case.
    expect(await reg(d, "z", minted, n)).toBe(`${minted}-2`);
    expect((await renamed(d, "z", minted.toUpperCase())).bus_name).toBe(
      `${minted.toUpperCase()}-2`,
    );
    // The renamed agent still gets its mail, from no rival holder.
    const rc = await send(d, "s", minted);
    expect(rc).toMatchObject({ state: "pending", to_name: xc });
    expect((await delivered(d, rc.msg_id)).to_ref).toBe("x");
    // After the grace, and after its agent closed, still never reused.
    await setClock(t0 + GRACE);
    // (z holds -2.)
    expect(await reg(d, "w", minted, n)).toBe(`${minted}-3`);
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "x" });
    expect(await reg(d, "v", minted, n)).toBe(`${minted}-4`);
    // Its own agent may take it back.
    expect(await reg(d, "x", minted, n)).toBe(minted);
    d.close();
  });

  it("a global agent never takes a namespace's default former name (#446)", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    await reg(d, "s", uniq("Sender"), n1);
    const minted = await reg(d, "x", uniq("pi"), n1, { kind: "default" });
    const xc = uniq("Xc");
    await renamed(d, "x", xc);
    expect(await reg(d, "g", minted, n2, { global: true })).toBe(`${minted}-2`);
    expect(await formerRows(xc)).toEqual([minted]);
    expect(await send(d, "s", minted)).toMatchObject({
      state: "pending",
      to_name: xc,
    });
    d.close();
  });

  it("two agents holding one former name in a scope is ambiguous, never either", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const a = uniq("Twice");
    await reg(d, "a", a, n);
    await renamed(d, "a", uniq("A2"));
    const b2 = uniq("B2");
    await reg(d, "b", b2, n);
    // Seeded: commitName and the reservation keep this from happening.
    await inHub((_, st) =>
      st.storage.sql.exec(
        `insert into former_names (agent_id, org_id, name, lname, kind, expires_at, namespace, global)
         select id, org_id, ?, ?, 'chosen', ?, namespace, global from agents where name = ?`,
        a,
        a.toLowerCase(),
        Date.now() + GRACE,
        b2,
      ),
    );
    expect(await send(d, "s", a)).toMatchObject({
      state: "refused",
      reason: "ambiguous",
    });
    d.close();
  });

  it("a namespace move or global flip keeps chosen former names in the old scope, resolving to no one (#451)", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    const foo = uniq("foo");
    await reg(d, "x", foo, n1);
    const x2 = uniq("X2");
    await renamed(d, "x", x2);
    await reg(d, "y", foo, n2);
    const y2 = uniq("Y2");
    await renamed(d, "y", y2);
    await reg(d, "s", uniq("Sender"), n2);
    // X flips global: its former `foo` stays reserved in n1 only, so it is
    // neither visible nor delivered in n2.
    expect(await reg(d, "x", x2, n1, { global: true })).toBe(x2);
    expect(await formerRows(x2)).toEqual([foo]);
    expect(await send(d, "s", foo)).toMatchObject({
      state: "pending",
      to_name: y2,
    });
    // A namespace move keeps them too (default ones go).
    const y3 = uniq("Y3");
    await renamed(d, "y", y3);
    expect(await formerRows(y3)).toHaveLength(2);
    expect(await reg(d, "y", y3, n1)).toBe(y3);
    expect((await formerRows(y3)).sort()).toEqual([foo, y2].sort());
    const minted = await reg(d, "p", uniq("pi"), n1, { kind: "default" });
    await renamed(d, "p", uniq("Pc"));
    const pc = uniq("Pc2");
    await renamed(d, "p", pc);
    expect(await reg(d, "p", pc, n2)).toBe(pc);
    expect(await formerRows(pc)).toHaveLength(1);
    expect(await reg(d, "q", minted, n1)).toBe(`${minted}-2`);
    d.close();
  });

  it("close keeps the rename log; a reopen within the hour is still limited (#446)", async () => {
    const t0 = Date.now() + 70 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const a = uniq("Log");
    await reg(d, "a", a, n);
    const first = uniq("Log0");
    await renamed(d, "a", first);
    const cur = await churn(d, "a", LIMITS.renamesPerHour - 1);
    const log = () =>
      inHub(
        (_, st) =>
          st.storage.sql
            .exec(
              "select count(*) as n from rename_rl r join agents a on a.id = r.agent_id where a.native_ref = ? and a.namespace = ?",
              "a",
              n,
            )
            .one().n,
      );
    expect(await log()).toBe(LIMITS.renamesPerHour);
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "a" });
    // Its former names went with the close: free at once, never resolving.
    expect(await reg(d, "b", a, n)).toBe(a);
    // At the limit a reopen keeps its name (#449 N1), counting nothing.
    expect(await reg(d, "a", uniq("Reopened"), n)).toBe(cur);
    const reopened = cur;
    expect(await log()).toBe(LIMITS.renamesPerHour);
    expect(await rename(d, "a", uniq("Over"))).toMatchObject({
      type: "error",
      code: "rate_limited",
    });
    expect(await formerRows(reopened)).toEqual([]);
    expect(await send(d, "s", first)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    // A rolling hour: the alarm purges the log, and renames work again.
    await setClock(t0 + GRACE + 1);
    await runDurableObjectAlarm(stub());
    expect(await log()).toBe(0);
    await renamed(d, "a", uniq("Later"));
    d.close();
  });

  it("revoke drops the rename log", async () => {
    const m = await machine();
    const v = await daemon(m.token);
    v.send({
      v: 1,
      id: id("h"),
      type: "hello",
      machine_label: "M",
      client_version: RENAME_MIN_CLIENT,
    });
    await waitFor(v, "hello_ok");
    await reg(v, "rv", uniq("Rv"), ns("rn"));
    await renamed(v, "rv", uniq("Rv2"));
    const log = () =>
      inHub(
        (_, st) =>
          st.storage.sql
            .exec(
              "select count(*) as n from rename_rl r join agents a on a.id = r.agent_id where a.machine_id = ?",
              m.id,
            )
            .one().n,
      );
    expect(await log()).toBe(1);
    expect(await hub(e).revokeMachine(m.id)).toBe(true);
    expect(await log()).toBe(0);
  });

  it("at the limit, a re-sent name the agent holds as foo-2 is a no-op", async () => {
    const t0 = Date.now() + 40 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    const foo = uniq("Foo");
    await reg(d, "o", foo, n);
    await reg(d, "a", uniq("Fa"), n);
    await churn(d, "a", LIMITS.renamesPerHour - 1);
    expect((await renamed(d, "a", foo)).bus_name).toBe(`${foo}-2`);
    const again = await renamed(d, "a", foo);
    expect(again.bus_name).toBe(`${foo}-2`);
    expect(again).not.toHaveProperty("former");
    expect(await rename(d, "a", uniq("Over"))).toMatchObject({
      code: "rate_limited",
    });
    d.close();
  });

  it("at the limit, a default rename to a different minted name is rate_limited and mints nothing", async () => {
    const t0 = Date.now() + 50 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    await reg(d, "x", uniq("Fx"), n);
    await churn(d, "x", LIMITS.renamesPerHour);
    const base = uniq("pibase");
    expect(await rename(d, "x", base, "default")).toMatchObject({
      type: "error",
      code: "rate_limited",
      message: RENAME_MESSAGES.rate,
    });
    const mints = await inHub(
      (_, st) =>
        st.storage.sql
          .exec(
            "select count(*) as n from minted_names where lbase = ?",
            base.toLowerCase(),
          )
          .one().n,
    );
    expect(mints).toBe(0);
    d.close();
  });
});

describe("default names (R393b)", () => {
  const HEX4 = /-[0-9a-f]{4}$/;

  it("are minted <base>-<4 hex>, never minted again, and kept by their agent", async () => {
    const d = await at();
    const n = ns("rn");
    const base = uniq("pidef");
    const one = await reg(d, "p1", base, n, { kind: "default" });
    expect(one).toMatch(HEX4);
    expect(one.slice(0, -5)).toBe(base);
    const two = await reg(d, "p2", base, n, { kind: "default" });
    expect(two).toMatch(HEX4);
    expect(two).not.toBe(one);
    // A re-sent agent_up (reconnect) and a reopen keep the agent's own.
    expect(await reg(d, "p1", base, n, { kind: "default" })).toBe(one);
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "p1" });
    const three = await reg(d, "p3", base, n, { kind: "default" });
    expect(three).not.toBe(one);
    expect(await reg(d, "p1", base, n, { kind: "default" })).toBe(one);
    // A default rename back to the base is a no-op.
    expect(await renamed(d, "p1", base, "default")).not.toHaveProperty(
      "former",
    );
    // Absent name_kind is chosen: no suffix.
    const chosen = uniq("pichosen");
    expect(await reg(d, "c", chosen, n)).toBe(chosen);
    d.close();
  });

  it("a long base keeps the suffix within the name cap", async () => {
    const d = await at();
    const base = `x${"y".repeat(70)}`;
    const name = await reg(d, "long", base, ns("rn"), { kind: "default" });
    expect(name.length).toBeLessThanOrEqual(LIMITS.maxBusNameChars);
    expect(name).toMatch(HEX4);
    d.close();
  });

  it("a former default name resolves for the grace and is never handed to another agent", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const minted = await reg(d, "p", uniq("pi"), n, { kind: "default" });
    const chosen = uniq("Picked");
    expect(await renamed(d, "p", chosen, "chosen")).toMatchObject({
      bus_name: chosen,
      former: minted,
    });
    // Stored as a default former name: no reservation row semantics, the
    // minted name itself is what no one else can take (#446).
    const kind = await inHub(
      (_, st) =>
        st.storage.sql
          .exec(
            "select kind from former_names where lname = ?",
            minted.toLowerCase(),
          )
          .one().kind,
    );
    expect(kind).toBe("default");
    expect(await reg(d, "x", minted, n)).toBe(`${minted}-2`);
    const rc = await send(d, "s", minted);
    expect(rc).toMatchObject({ state: "pending", to_name: chosen });
    await delivered(d, rc.msg_id).then((f) => expect(f.to_ref).toBe("p"));
    d.close();
  });

  it("a default rename mints a name too", async () => {
    const d = await at();
    const n = ns("rn");
    const a = uniq("Named");
    await reg(d, "p", a, n);
    const base = uniq("codex");
    const r = await renamed(d, "p", base, "default");
    expect(r.bus_name).toMatch(HEX4);
    expect(r.bus_name.slice(0, -5)).toBe(base);
    expect(r.former).toBe(a);
    d.close();
  });
});

describe("#420: a reply to a renamed agent's old name", () => {
  it("reaches it across machines in one namespace during the grace", async () => {
    // OA Owner (MacBook) got a message from a default-named session on the
    // workstation, which then took its chosen name; the reply to the old
    // name must still arrive.
    const work = await at();
    const mac = await at();
    const n = ns("i420");
    const old = await reg(work, "w", "open-artifacts", n, { kind: "default" });
    expect(old).toMatch(/^open-artifacts-[0-9a-f]{4}$/);
    await reg(mac, "o", uniq("OA Owner"), n);
    const chosen = uniq("OA Product");
    await renamed(work, "w", chosen, "chosen");

    const rc = await send(mac, "o", old);
    expect(rc).toMatchObject({ state: "pending", to_name: chosen });
    expect((await delivered(work, rc.msg_id)).to_ref).toBe("w");
    work.close();
    mac.close();
  });
});

describe("#446: a rename through a live agent_up re-send", () => {
  it("records the former name, reserves it and counts in the rate limit", async () => {
    // Old daemons rename this way; resolution must be safe for them too.
    for (const version of [RENAME_MIN_CLIENT, AGENT_CARD_MIN_CLIENT]) {
      const d = await at(version);
      const n = ns("rn");
      await reg(d, "s", uniq("Sender"), n);
      const alice = uniq("Alice");
      expect(await reg(d, "a", alice, n)).toBe(alice);
      const bob = uniq("Bob");
      expect(await reg(d, "a", bob, n)).toBe(bob);
      expect(await formerRows(bob)).toEqual([alice]);
      // Reserved for the grace: a stranger gets alice-2, mail reaches bob.
      expect(await reg(d, "m", alice, n)).toBe(`${alice}-2`);
      const rc = await send(d, "s", alice);
      expect(rc.state).toBe("pending");
      expect((await delivered(d, rc.msg_id)).to_ref).toBe("a");
      // An unchanged re-send is no rename and never counts.
      expect(await reg(d, "a", bob, n)).toBe(bob);
      let cur = bob;
      const pair = [uniq("AP"), uniq("AQ")];
      for (let i = 1; i < LIMITS.renamesPerHour; i++) {
        cur = pair[i % 2] as string;
        expect(await reg(d, "a", cur, n)).toBe(cur);
      }
      // At the limit the agent_up still succeeds, keeping the current name.
      expect(await reg(d, "a", uniq("Over"), n)).toBe(cur);
      if (version === RENAME_MIN_CLIENT)
        expect(await rename(d, "a", uniq("Over2"))).toMatchObject({
          type: "error",
          code: "rate_limited",
        });
      d.close();
    }
  });

  it("a minted former name is kept as a default one, never handed on", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const minted = await reg(d, "p", uniq("pi"), n, { kind: "default" });
    const chosen = uniq("Chosen");
    expect(await reg(d, "p", chosen, n)).toBe(chosen);
    const kind = await inHub(
      (_, st) =>
        st.storage.sql
          .exec(
            "select kind from former_names where lname = ?",
            minted.toLowerCase(),
          )
          .one().kind,
    );
    expect(kind).toBe("default");
    expect(await reg(d, "q", minted, n)).toBe(`${minted}-2`);
    expect(await send(d, "s", minted)).toMatchObject({
      state: "pending",
      to_name: chosen,
    });
    d.close();
  });
});

describe("#449: review of #446", () => {
  it("an agent_up keeps the current name with maxFormerNames chosen names in grace", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const mine = uniq("Mine");
    await reg(d, "a", mine, n);
    let cur = mine;
    for (let i = 0; i < LIMITS.maxFormerNames; i++) {
      cur = uniq(`U${i}`);
      expect(await reg(d, "a", cur, n)).toBe(cur);
    }
    expect(await reg(d, "a", uniq("Sixth"), n)).toBe(cur);
    expect(await reg(d, "x", mine, n)).toBe(`${mine}-2`);
    expect(await send(d, "s", mine)).toMatchObject({
      state: "pending",
      to_name: cur,
    });
    d.close();
  });

  it("an agent_up namespace move at the limit moves, keeping the current name", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    await reg(d, "a", uniq("Mover"), n1);
    const cur = await churn(d, "a", LIMITS.renamesPerHour);
    expect(await reg(d, "a", uniq("Elsewhere"), n2)).toBe(cur);
    // #451: its chosen former names stay, reserved in n1.
    expect(await formerRows(cur)).toHaveLength(2);
    const ns2 = await inHub(
      (_, st) =>
        st.storage.sql
          .exec("select namespace from agents where name = ? and live = 1", cur)
          .one().namespace,
    );
    expect(ns2).toBe(n2);
    d.close();
  });

  it("a chosen name in another non-global namespace never takes a minted one", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    const minted = await reg(d, "x", uniq("pi"), n1, { kind: "default" });
    expect(await reg(d, "y", minted, n2)).toBe(`${minted}-2`);
    d.close();
  });

  it("an agent_up case-only change counts, with no former row", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const a = uniq("Casey");
    await reg(d, "a", a, n);
    expect(await reg(d, "a", a.toLowerCase(), n)).toBe(a.toLowerCase());
    expect(await formerRows(a.toLowerCase())).toEqual([]);
    const log = await inHub(
      (_, st) =>
        st.storage.sql
          .exec(
            "select count(*) as n from rename_rl r join agents a on a.id = r.agent_id where a.name = ?",
            a.toLowerCase(),
          )
          .one().n,
    );
    expect(log).toBe(1);
    const rc = await send(d, "s", a);
    expect(rc.state).toBe("pending");
    expect(rc.to_name).toBeUndefined();
    d.close();
  });

  it("a reopen under a new name counts in the rate limit, with no former name (N1)", async () => {
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const a = uniq("Reo");
    await reg(d, "a", a, n);
    const cur = await churn(d, "a", LIMITS.renamesPerHour - 1);
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "a" });
    const b = uniq("Reo2");
    expect(await reg(d, "a", b, n)).toBe(b);
    // The old name was freed by the close: no former row.
    expect(await formerRows(b)).toEqual([]);
    expect(await reg(d, "o", cur, n)).toBe(cur);
    // That was the 10th change: the next reopen keeps its name.
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "a" });
    expect(await reg(d, "a", uniq("Reo3"), n)).toBe(b);
    d.close();
  });
});

it("#449 N3: an agent holding another's minted name (the old hole) gets -2 on replay, leaving no former row", async () => {
  const d = await at();
  const n = ns("rn");
  const minted = await reg(d, "x", uniq("pi"), n, { kind: "default" });
  await renamed(d, "x", uniq("Xc"));
  const z = uniq("Zed");
  await reg(d, "z", z, n);
  // Seeded: what the pre-#446 hub allowed.
  await inHub((_, st) =>
    st.storage.sql.exec("update agents set name = ? where name = ?", minted, z),
  );
  expect(await reg(d, "z", minted, n)).toBe(`${minted}-2`);
  expect(await formerRows(`${minted}-2`)).toEqual([]);
  // Its own agent takes it back.
  expect((await renamed(d, "x", minted)).bus_name).toBe(minted);
  d.close();
});

describe("#451: a move or global flip keeps chosen former names reserved", () => {
  /** rename_rl rows of the live agent `ref` on any machine named `name`. */
  const log = (name: string) =>
    inHub(
      (_, st) =>
        st.storage.sql
          .exec(
            "select count(*) as n from rename_rl r join agents a on a.id = r.agent_id where a.name = ?",
            name,
          )
          .one().n,
    );

  it("a namespace move: a stranger in the old namespace gets -2 and its mail is refused, until the grace ends", async () => {
    const t0 = Date.now() + 80 * GRACE;
    await setClock(t0);
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    const n3 = ns("rn");
    await reg(d, "s1", uniq("Sender"), n1);
    await reg(d, "s2", uniq("Sender"), n2);
    const mine = uniq("Mine");
    await reg(d, "a", mine, n1);
    const other = uniq("Other");
    await renamed(d, "a", other);
    expect(await reg(d, "a", other, n2)).toBe(other);
    // Still reserved in n1, and for a global; free in another namespace.
    expect(await reg(d, "x", mine, n1)).toBe(`${mine}-2`);
    expect(await reg(d, "g", mine, n3, { global: true })).toBe(`${mine}-3`);
    // It resolves to no one: not delivered to the moved agent.
    expect(await send(d, "s1", mine)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    // Nor in its new namespace, where it was never its name.
    expect(await send(d, "s2", mine)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    // The roster shows no former name the agent cannot be reached by.
    expect(row(await list(d, "s2"), other)?.former_names).toBeUndefined();
    // Taking the name back in n2 keeps the n1 reservation.
    await renamed(d, "a", mine);
    expect(await reg(d, "y", mine, n1)).toBe(`${mine}-4`);
    expect(await send(d, "s1", mine)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    // After the grace the name is free in n1.
    await setClock(t0 + GRACE);
    expect(await reg(d, "z", mine, n1)).toBe(mine);
    d.close();
  });

  it("a global flip, both ways: the old scope keeps the reservation and refuses its mail", async () => {
    const t0 = Date.now() + 90 * GRACE;
    await setClock(t0);
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    await reg(d, "s1", uniq("Sender"), n1);
    await reg(d, "s2", uniq("Sender"), n2);
    // Non-global to global.
    const mine = uniq("Mine");
    await reg(d, "a", mine, n1);
    const other = uniq("Other");
    await renamed(d, "a", other);
    expect(await reg(d, "a", other, n1, { global: true })).toBe(other);
    expect(await reg(d, "x", mine, n1)).toBe(`${mine}-2`);
    expect(await send(d, "s1", mine)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    expect(await send(d, "s1", mine, n1)).toMatchObject({
      state: "refused",
    });
    // Global to non-global: the reservation was everywhere, and stays so.
    const gmine = uniq("GMine");
    await reg(d, "b", gmine, n1, { global: true });
    const gother = uniq("GOther");
    await renamed(d, "b", gother);
    expect(await reg(d, "b", gother, n1)).toBe(gother);
    expect(await reg(d, "y", gmine, n2)).toBe(`${gmine}-2`);
    expect(await send(d, "s1", gmine)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    await setClock(t0 + GRACE);
    expect(await reg(d, "z", mine, n1)).toBe(mine);
    expect(await reg(d, "w", gmine, n2)).toBe(gmine);
    d.close();
  });

  it("a move that also changes the name reserves the old one in the old namespace", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    await reg(d, "s1", uniq("Sender"), n1);
    const mine = uniq("Mine");
    await reg(d, "a", mine, n1);
    const other = uniq("Other");
    expect(await reg(d, "a", other, n2)).toBe(other);
    expect(await log(other)).toBe(1);
    expect(await reg(d, "x", mine, n1)).toBe(`${mine}-2`);
    expect(await send(d, "s1", mine)).toMatchObject({
      state: "refused",
      reason: "unknown_agent",
    });
    d.close();
  });

  it("a same-name move with maxFormerNames chosen names in grace cannot escape the room check", async () => {
    const d = await at();
    const n1 = ns("rn");
    const n2 = ns("rn");
    const mine = uniq("Mine");
    await reg(d, "a", mine, n1);
    const left = [mine];
    let cur = mine;
    for (let i = 0; i < LIMITS.maxFormerNames; i++) {
      cur = uniq(`M${i}`);
      await renamed(d, "a", cur);
      left.push(cur);
    }
    left.pop();
    expect(await reg(d, "a", cur, n2)).toBe(cur);
    // The move counts nothing (the name did not change)...
    expect(await log(cur)).toBe(LIMITS.maxFormerNames);
    // ...and the five reservations still fill the room.
    expect(await rename(d, "a", uniq("Sixth"))).toMatchObject({
      type: "error",
      code: "rate_limited",
      message: RENAME_MESSAGES.room,
    });
    expect(await reg(d, "a", uniq("Sixth"), n2)).toBe(cur);
    for (const f of left) expect(await reg(d, id("x"), f, n1)).toBe(`${f}-2`);
    d.close();
  });
});

describe("#451 nits", () => {
  it("a reopen de-collided from its own name counts nothing (N1)", async () => {
    const d = await at();
    const n = ns("rn");
    const dup = uniq("Dup");
    await reg(d, "a", dup, n);
    d.send({ v: 1, id: id("d"), type: "agent_down", agent_ref: "a" });
    expect(await reg(d, "o", dup, n)).toBe(dup);
    expect(await reg(d, "a", dup, n)).toBe(`${dup}-2`);
    const log = await inHub(
      (_, st) =>
        st.storage.sql
          .exec(
            "select count(*) as n from rename_rl r join agents a on a.id = r.agent_id where a.name = ?",
            `${dup}-2`,
          )
          .one().n,
    );
    expect(log).toBe(0);
    d.close();
  });

  it("10 fresh renames in an hour, 5 of them minted: the defaults are dropped first at the limit (N3)", async () => {
    const t0 = Date.now() + 100 * GRACE;
    await setClock(t0);
    const d = await at();
    const n = ns("rn");
    await reg(d, "s", uniq("Sender"), n);
    const c0 = uniq("C0");
    await reg(d, "a", c0, n);
    const minted: string[] = [];
    for (let i = 0; i < 5; i++)
      minted.push((await renamed(d, "a", uniq(`pd${i}`), "default")).bus_name);
    const chosen = [c0];
    let cur = "";
    for (let i = 1; i <= 5; i++) {
      cur = uniq(`C${i}`);
      await renamed(d, "a", cur);
      chosen.push(cur);
    }
    chosen.pop();
    // Every default row went first; the five chosen ones are all kept.
    expect((await formerRows(cur)).sort()).toEqual([...chosen].sort());
    expect(await rename(d, "a", uniq("Over"))).toMatchObject({
      type: "error",
      code: "rate_limited",
      message: RENAME_MESSAGES.rate,
    });
    for (const m of minted) {
      expect(await send(d, "s", m)).toMatchObject({
        state: "refused",
        reason: "unknown_agent",
      });
      expect(await reg(d, id("x"), m, n)).toBe(`${m}-2`);
    }
    for (const c of chosen) {
      expect(await send(d, "s", c)).toMatchObject({
        state: "pending",
        to_name: cur,
      });
      expect(await reg(d, id("y"), c, n)).toBe(`${c}-2`);
    }
    d.close();
  });
});

it("#451: migrateHub anchors existing former names to their agent's scope", async () => {
  const d = await at();
  const n = ns("rn");
  const a = uniq("Mig");
  await reg(d, "a", a, n, { global: true });
  const b = uniq("Mig2");
  await renamed(d, "a", b);
  const got = await inHub((_, st) => {
    const sql = st.storage.sql;
    sql.exec("alter table former_names drop column namespace");
    sql.exec("alter table former_names drop column global");
    migrateHub(sql);
    migrateHub(sql);
    return sql
      .exec(
        "select namespace, global from former_names where lname = ?",
        a.toLowerCase(),
      )
      .one();
  });
  expect(got).toEqual({ namespace: n, global: 1 });
  d.close();
});
