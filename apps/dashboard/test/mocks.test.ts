import { ApiErrorSchema, CSRF_HEADER, CSRF_VALUE, LIMITS } from "@ob/shared";
import { expect, test } from "vitest";
import { fixtures } from "../src/mocks/fixtures";
import { createMockBus, handlersFor } from "../src/mocks/handlers";
import { installHarness, server } from "./harness";

installHarness();

const live = fixtures.machines.find((m) => !m.revokedAt);
const dead = fixtures.machines.find((m) => m.revokedAt);
const queued = fixtures.agents.find((a) => a.state === "queued");
const away = fixtures.machines.find((m) => m.id === queued?.machineId);
if (!live || !dead || !queued || !away)
  throw new Error(
    "fixtures need a live and a revoked machine, and a queued agent",
  );
const CSRF = { [CSRF_HEADER]: CSRF_VALUE };

test("the fixtures cover two namespaces, a global agent, a queued agent and a revoked machine", () => {
  expect(fixtures.machines).toHaveLength(3);
  expect(new Set(fixtures.agents.map((a) => a.namespace)).size).toBe(2);
  expect(fixtures.agents.some((a) => a.global)).toBe(true);
  expect(fixtures.machines.some((m) => m.revokedAt)).toBe(true);
});

test("the queued agent sits on an active machine that runs no live agent (it is offline)", () => {
  expect(away.revokedAt).toBeNull();
  expect(
    fixtures.agents.some((a) => a.machineId === away.id && a.state === "live"),
  ).toBe(false);
  expect(fixtures.agents.some((a) => a.state === "live")).toBe(true);
});

test("revoking a machine drops its agents and tells the stream", async () => {
  const bus = createMockBus();
  const seen: unknown[] = [];
  const off = bus.subscribe((e) => seen.push(e));

  expect(bus.machines().find((m) => m.id === live.id)?.connected).toBe(true);
  const res = await bus.revoke(live.id);
  expect(res.status).toBe(204);
  expect(bus.machines().find((m) => m.id === live.id)?.connected).toBe(false);
  expect(
    bus.machines().find((m) => m.id === live.id)?.revokedAt,
  ).not.toBeNull();
  expect(bus.agents().some((a) => a.machineId === live.id)).toBe(false);
  expect(seen).toEqual([
    { type: "agents", agents: bus.agents() },
    { type: "machines", machines: bus.machines() },
  ]);

  expect((await bus.revoke(live.id)).status).toBe(404);
  expect((await bus.revoke(dead.id)).status).toBe(404);
  expect((await bus.revoke("nope")).status).toBe(404);
  off();
});

test("events are per subscriber and unsubscribe cleanly", () => {
  const bus = createMockBus();
  const a: unknown[] = [];
  const b: unknown[] = [];
  const offA = bus.subscribe((e) => a.push(e));
  bus.subscribe((e) => b.push(e));
  bus.push({ type: "hello" });
  offA();
  bus.push({ type: "hello" });
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(2);
});

test("GET endpoints answer from the fixtures, live and queued agents, newest machine first", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const machines = await (await fetch("/api/v1/machines")).json();
  expect(machines.machines.map((m: { id: string }) => m.id)).toEqual([
    live.id,
    away.id,
    dead.id,
  ]);
  const me = await (await fetch("/api/v1/me")).json();
  expect(me.user.name).toBeNull();
  const all = await (await fetch("/api/v1/agents")).json();
  // The mock adds statuses on top of the shared fixtures.
  expect(all.agents).toEqual(
    fixtures.agents.map((a) => expect.objectContaining(a)),
  );
  expect(new Set(all.agents.map((a: { state: string }) => a.state))).toEqual(
    new Set(["live", "queued"]),
  );
});

test("a new stream's agents snapshot carries live and queued agents", async () => {
  server.use(...handlersFor(createMockBus()));
  const c = connect();
  await c.until(() => c.frames.length >= 3);
  expect(c.frames[2]).toEqual({
    type: "agents",
    agents: fixtures.agents.map((a) => expect.objectContaining(a)),
  });
  expect(fixtures.agents.some((a) => a.id === queued.id)).toBe(true);
  c.sock.close(1000);
});

test("a reconnect sees state changed through setMachines", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const first = connect();
  await first.until(() => first.frames.length >= 3);
  first.sock.close(1000);
  bus.setMachines([{ ...live, label: "renamed" }]);
  const second = connect();
  await second.until(() => second.frames.length >= 3);
  expect(second.frames[1]).toEqual({
    type: "machines",
    machines: [{ ...live, label: "renamed" }],
  });
  second.sock.close(1000);
});

test("setAgents rejects an agent without a state, or with the old live flag", () => {
  const bus = createMockBus();
  const { state: _, ...noState } = queued;
  expect(() => bus.setAgents([noState])).toThrow();
  expect(() => bus.setAgents([{ ...noState, live: true }])).toThrow();
  expect(() => bus.setAgents([{ ...queued, state: "offline" }])).toThrow();
});

test("the namespace filter keeps global agents", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const globalAgent = fixtures.agents.find((a) => a.global);
  const other = fixtures.agents.find(
    (a) => a.namespace !== globalAgent?.namespace,
  );
  const ns = other?.namespace ?? "";
  const res = await (
    await fetch(`/api/v1/agents?namespace=${encodeURIComponent(ns)}`)
  ).json();
  const ids = res.agents.map((a: { id: string }) => a.id);
  expect(ids).toContain(globalAgent?.id);
  expect(
    res.agents.every(
      (a: { namespace: string; global: boolean }) =>
        a.namespace === ns || a.global,
    ),
  ).toBe(true);
});

test("setAgents and setMachines reject input the contract would", () => {
  const bus = createMockBus();
  expect(() => bus.setAgents([{ id: "x" }])).toThrow();
  expect(() => bus.setMachines([{ id: "x" }])).toThrow();
  expect(() => bus.push({ type: "agents", agents: [{}] } as never)).toThrow();
  const seen: unknown[] = [];
  bus.subscribe((e) => seen.push(e));
  bus.setAgents(fixtures.agents);
  bus.setMachines(fixtures.machines);
  expect(seen).toHaveLength(2);
});

test("DELETE needs X-OB-Request, then 204 once, then 404", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const url = `/api/v1/machines/${live.id}`;

  const noCsrf = await fetch(url, { method: "DELETE" });
  expect(noCsrf.status).toBe(403);
  expect((await noCsrf.json()).error.code).toBe("csrf");
  expect(bus.machines().find((m) => m.id === live.id)?.revokedAt).toBeNull();

  expect((await fetch(url, { method: "DELETE", headers: CSRF })).status).toBe(
    204,
  );
  const again = await fetch(url, { method: "DELETE", headers: CSRF });
  expect(again.status).toBe(404);
  expect((await again.json()).error.code).toBe("not_found");
  const after = await (await fetch("/api/v1/agents")).json();
  expect(
    after.agents.some((a: { machineId: string }) => a.machineId === live.id),
  ).toBe(false);
});

/** A socket on the mock link (msw's node interceptor answers it). */
const connect = () => {
  const sock = new WebSocket("ws://localhost/api/v1/events");
  const frames: unknown[] = [];
  const texts: string[] = [];
  const waiters: (() => void)[] = [];
  let closed: number | null = null;
  sock.addEventListener("message", (m) => {
    texts.push(m.data);
    if (m.data !== "pong") frames.push(JSON.parse(m.data));
    for (const w of waiters.splice(0)) w();
  });
  sock.addEventListener("close", (e) => {
    closed = e.code;
    for (const w of waiters.splice(0)) w();
  });
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise<void>((r) => waiters.push(r));
  };
  return { sock, frames, texts, until, closedWith: () => closed };
};

test("the events socket: hello, machines, agents, then pushes as JSON text frames", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const c = connect();
  await c.until(() => c.frames.length >= 3);
  expect(c.frames).toEqual([
    { type: "hello" },
    { type: "machines", machines: bus.machines() },
    { type: "agents", agents: bus.agents() },
  ]);

  const del = await fetch(`/api/v1/machines/${live.id}`, {
    method: "DELETE",
    headers: CSRF,
  });
  expect(del.status).toBe(204);
  await c.until(() => c.frames.length >= 5);
  expect(c.frames.slice(3)).toEqual([
    { type: "agents", agents: bus.agents() },
    { type: "machines", machines: bus.machines() },
  ]);
  c.sock.close(1000);
});

test('the events socket answers "ping" with "pong"', async () => {
  server.use(...handlersFor(createMockBus()));
  const c = connect();
  await c.until(() => c.frames.length >= 3);
  c.sock.send("ping");
  await c.until(() => c.texts.includes("pong"));
  expect(c.texts.filter((t) => t === "pong")).toHaveLength(1);
  c.sock.close(1000);
});

test("closeAll closes every open socket with the code, and pushes stop", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const a = connect();
  const b = connect();
  await a.until(() => a.frames.length >= 3);
  await b.until(() => b.frames.length >= 3);
  bus.closeAll(4401);
  await a.until(() => a.closedWith() !== null);
  await b.until(() => b.closedWith() !== null);
  expect([a.closedWith(), b.closedWith()]).toEqual([4401, 4401]);
  bus.setAgents([]);
  expect(a.frames).toHaveLength(3);
});

test("an over-cap setAgents or setMachines throws and changes nothing", () => {
  const bus = createMockBus();
  const seen: unknown[] = [];
  bus.subscribe((e) => seen.push(e));
  const agentsBefore = bus.agents();
  const machinesBefore = bus.machines();
  const [a] = fixtures.agents;
  expect(() =>
    bus.setAgents(Array.from({ length: LIMITS.maxRosterAgents + 1 }, () => a)),
  ).toThrow();
  expect(() =>
    bus.setMachines(
      Array.from({ length: LIMITS.maxMachinesListed + 1 }, () => live),
    ),
  ).toThrow();
  expect(bus.agents()).toEqual(agentsBefore);
  expect(bus.machines()).toEqual(machinesBefore);
  expect(seen).toEqual([]);
});

test("a non-canonical ?namespace= is a 400 in the strict error envelope, like the hub", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  for (const ns of ["repo:github.com/acme/app", "GitHub.com/acme/app", " x"]) {
    const res = await fetch(
      `/api/v1/agents?namespace=${encodeURIComponent(ns)}`,
    );
    expect(res.status, ns).toBe(400);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details).toEqual({ field: "namespace" });
  }
  const ok = await fetch(
    `/api/v1/agents?namespace=${encodeURIComponent("github.com/acme/app")}`,
  );
  expect(ok.status).toBe(200);
});

test("revoking laptop drops its queued agent and keeps the machine listed as revoked", async () => {
  const bus = createMockBus();
  expect((await bus.revoke(away.id)).status).toBe(204);
  expect(bus.agents().some((a) => a.id === queued.id)).toBe(false);
  expect(bus.agents().some((a) => a.state === "live")).toBe(true);
  const row = bus.machines().find((m) => m.id === away.id);
  expect(row?.label).toBe("laptop");
  expect(row?.revokedAt).not.toBeNull();
});

test("the mock bus seeds a linked app and agent statuses", () => {
  const bus = createMockBus();
  expect(bus.apps()).toEqual([
    { aud: "https://oa.example", linkedAt: expect.any(String) },
  ]);
  expect(bus.agents().some((a) => a.status === "working")).toBe(true);
});

test("unlink: 204 then 404", async () => {
  const bus = createMockBus();
  expect((await bus.unlink("https://oa.example")).status).toBe(204);
  expect((await bus.unlink("https://oa.example")).status).toBe(404);
});

test("the linked-app routes demand the CSRF header", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const url = `http://x.test/api/v1/linked-apps/${encodeURIComponent("https://oa.example")}`;
  expect((await fetch(url, { method: "DELETE" })).status).toBe(403);
  const del = await fetch(url, { method: "DELETE", headers: CSRF });
  expect(del.status).toBe(204);
});
