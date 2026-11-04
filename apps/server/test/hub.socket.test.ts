import { runInDurableObject, SELF } from "cloudflare:test";
import { LIMITS, OWNER_ORG_ID, PING, PONG } from "@ob/shared";
import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub/do.js";
import { hub } from "../src/hub/stub.js";
import {
  daemon,
  e,
  framesSeen,
  hello,
  inOwnerHub,
  machine,
  ns,
  ready,
  up,
  upgrade,
  waitFor,
} from "./helpers.js";

type ErrorBody = { error: { code: string } };

describe("hub socket: upgrade", () => {
  it("refuses /hub without a valid machine token", async () => {
    const none = await upgrade(null);
    expect(none.status).toBe(401);
    expect(((await none.json()) as ErrorBody).error.code).toBe("unauthorized");
    const malformed = await upgrade("not-a-token");
    expect(malformed.status).toBe(401);
    const unknown = await upgrade(`ob_machine_${"a".repeat(32)}`);
    expect(unknown.status).toBe(401);
  });

  it("refuses a revoked machine's token at the upgrade", async () => {
    const m = await machine();
    await inOwnerHub((s) => {
      s.storage.sql.exec(
        "update machines set revoked_at = ? where id = ?",
        Date.now(),
        m.id,
      );
    });
    expect((await upgrade(m.token)).status).toBe(401);
  });

  it("answers 400 to a GET /hub that is not an upgrade", async () => {
    const m = await machine();
    const res = await SELF.fetch("https://app.localhost/hub", {
      headers: { Authorization: `Bearer ${m.token}` },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("bad_request");
  });

  it("ignores a client-supplied X-Ob-Machine-Id", async () => {
    const mine = await machine("Mine");
    const other = await machine("Other");
    const d = await daemon(mine.token, { "X-Ob-Machine-Id": other.id });
    d.send(hello());
    const ok = await waitFor(d, "hello_ok");
    expect(ok.machine_id).toBe(mine.id);
    expect(ok.machine_label).toBe("Mine");
    // Without a token the header alone opens nothing.
    expect((await upgrade(null, { "X-Ob-Machine-Id": other.id })).status).toBe(
      401,
    );
    d.close();
  });

  it("the hub refuses a forwarded upgrade for an unknown machine", async () => {
    const stub = e.HUB.get(e.HUB.idFromName(OWNER_ORG_ID));
    const r = await stub.fetch("https://hub.internal/hub", {
      headers: { Upgrade: "websocket", "X-Ob-Machine-Id": "1111111111111111" },
    });
    expect(r.status).toBe(401);
    const noUpgrade = await stub.fetch("https://hub.internal/hub");
    expect(noUpgrade.status).toBe(426);
    const other = await stub.fetch("https://hub.internal/elsewhere", {
      headers: { Upgrade: "websocket" },
    });
    expect(other.status).toBe(404);
  });
});

describe("hub socket: hello and agents", () => {
  it("answers hello with exactly the HelloOk fields", async () => {
    const m = await machine("Studio");
    const d = await daemon(m.token);
    d.send(hello("h1"));
    const ok = await waitFor(d, "hello_ok");
    expect(ok).toEqual({
      v: 1,
      id: "h1",
      type: "hello_ok",
      machine_id: m.id,
      machine_label: "Studio",
      server_version: "dev",
    });
    d.close();
  });

  it("registers an agent under its proposed name", async () => {
    const m = await machine();
    const d = await ready(m.token);
    d.send(up("u1", "ses_a", "OpenBus Backend", ns()));
    const reg = await waitFor(d, "agent_ok");
    expect(reg).toEqual({
      v: 1,
      id: "u1",
      type: "agent_ok",
      agent_ref: "ses_a",
      bus_name: "OpenBus Backend",
    });
    d.close();
  });

  it("suffixes a name already taken in the namespace, not in another", async () => {
    const m = await machine();
    const d = await ready(m.token);
    const a = ns();
    const b = ns();
    d.send(up("u1", "ses_a", "Claude", a));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("Claude");
    d.send(up("u2", "ses_b", "Claude", a));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("Claude-2");
    d.send(up("u3", "ses_c", "Claude", a));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("Claude-3");
    d.send(up("u4", "ses_d", "Claude", b));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("Claude");
    d.close();
  });

  it("keeps an agent's name when it re-registers", async () => {
    const m = await machine();
    const d = await ready(m.token);
    const a = ns();
    d.send(up("u1", "ses_a", "Same", a));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("Same");
    d.send(up("u2", "ses_a", "Same", a));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("Same");
    d.close();
  });

  it("keeps global names unique among live globals", async () => {
    const m = await machine();
    const d = await ready(m.token);
    const tag = `G${Date.now()}`;
    d.send(up("u1", "ses_g1", tag, ns(), true));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe(tag);
    d.send(up("u2", "ses_g2", tag, ns(), true));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe(`${tag}-2`);
    d.close();
  });

  it("maps a reserved or unusable name to the fallback", async () => {
    const m = await machine();
    const d = await ready(m.token);
    const a = ns();
    d.send(up("u1", "ses_r", "openbus", a));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("agent");
    d.send(up("u2", "ses_s", "a@b", a));
    expect((await waitFor(d, "agent_ok")).bus_name).toBe("agent-2");
    d.close();
  });

  it("holds the name for the grace on agent_down and on sessions{closed}, then frees it (#451)", async () => {
    const clock = (ms: number | null) =>
      runInDurableObject(
        hub(e) as unknown as DurableObjectStub<Hub>,
        (i: Hub) => Hub.setTestClock(i, ms),
      );
    const t0 = Date.now() + 200 * LIMITS.formerNameGraceMs;
    await clock(t0);
    try {
      const m = await machine();
      const d = await ready(m.token);
      const a = ns();
      d.send(up("u1", "ses_a", "Pi", a));
      await waitFor(d, "agent_ok");
      d.send({ v: 1, id: "d1", type: "agent_down", agent_ref: "ses_a" });
      d.send(hello("sync")); // the originating socket gets no roster_changed
      await waitFor(d, "hello_ok");
      d.send(up("u2", "ses_b", "Pi", a));
      expect((await waitFor(d, "agent_ok")).bus_name).toBe("Pi-2");
      d.send({
        v: 1,
        id: "s1",
        type: "sessions",
        open: [],
        closed: ["ses_b"],
      });
      d.send(hello("sync")); // the originating socket gets no roster_changed
      await waitFor(d, "hello_ok");
      d.send(up("u3", "ses_c", "Pi-2", a));
      expect((await waitFor(d, "agent_ok")).bus_name).toBe("Pi-2-2");
      await clock(t0 + LIMITS.formerNameGraceMs);
      d.send(up("u4", "ses_d", "Pi", a));
      expect((await waitFor(d, "agent_ok")).bus_name).toBe("Pi");
      d.send(up("u5", "ses_e", "Pi-2", a));
      expect((await waitFor(d, "agent_ok")).bus_name).toBe("Pi-2");
      d.close();
    } finally {
      await clock(null);
    }
  });
});

describe("hub socket: list and roster", () => {
  it("shows a non-global agent its namespace plus globals; a global agent sees all", async () => {
    const m = await machine();
    const d = await ready(m.token);
    const a = ns("a");
    const b = ns("b");
    const g = `Glob${Date.now()}`;
    d.send(up("u1", "ses_a1", "A1", a));
    d.send(up("u2", "ses_b1", "B1", b));
    d.send(up("u3", "ses_g", g, b, true));
    for (let i = 0; i < 3; i++) await waitFor(d, "agent_ok");

    d.send({ v: 1, id: "l1", type: "list", from_ref: "ses_a1" });
    const fromA = await waitFor(d, "roster");
    expect(fromA.id).toBe("l1");
    const namesA = fromA.agents.map((x) => x.bus_name);
    expect(namesA).toContain("A1");
    expect(namesA).toContain(g);
    expect(namesA).not.toContain("B1");
    for (const x of fromA.agents)
      expect(x.namespace === a || x.global).toBe(true);
    expect(fromA.agents.find((x) => x.bus_name === "A1")).toEqual({
      bus_name: "A1",
      kind: "opencode",
      namespace: a,
      global: false,
      state: "live",
      machine_label: "MacBook",
    });

    d.send({ v: 1, id: "l2", type: "list", from_ref: "ses_g" });
    const fromG = await waitFor(d, "roster");
    const namesG = fromG.agents.map((x) => `${x.namespace}|${x.bus_name}`);
    expect(namesG).toContain(`${a}|A1`);
    expect(namesG).toContain(`${b}|B1`);
    expect(namesG).toContain(`${b}|${g}`);
    d.close();
  });

  it("marks an agent queued while its machine has no socket", async () => {
    const away = await machine("Away");
    const here = await machine("Here");
    const a = ns();
    const x = await ready(away.token);
    x.send(up("u1", "ses_x", "Away", a));
    await waitFor(x, "agent_ok");
    const d = await ready(here.token);
    d.send(up("u2", "ses_h", "Here", a));
    await waitFor(d, "agent_ok");
    x.close();
    await x.closed;
    expect((await waitFor(d, "roster_changed")).namespace).toBe(a);
    d.send({ v: 1, id: "l1", type: "list", from_ref: "ses_h" });
    const r = await waitFor(d, "roster");
    expect(r.agents.find((g) => g.bus_name === "Away")?.state).toBe("queued");
    expect(r.agents.find((g) => g.bus_name === "Here")?.state).toBe("live");
    d.close();
  });

  it("caps the roster at LIMITS.maxRosterAgents and it still decodes", async () => {
    const m = await machine();
    const a = ns("big");
    const d = await ready(m.token);
    d.send(up("u1", "ses_me", "Me", a, true));
    await waitFor(d, "agent_ok");
    await inOwnerHub((s) => {
      for (let i = 0; i < LIMITS.maxRosterAgents + 5; i++)
        s.storage.sql.exec(
          `insert into agents (id, org_id, namespace, name, kind, machine_id, native_ref, global, live, updated_at)
           values (?, ?, ?, ?, 'claude-code', ?, ?, 0, 1, 0)`,
          `seed${i}`,
          OWNER_ORG_ID,
          a,
          `Seed ${i}`,
          m.id,
          `seed_${i}`,
        );
    });
    d.send({ v: 1, id: "l1", type: "list", from_ref: "ses_me" });
    const r = await waitFor(d, "roster");
    expect(r.agents).toHaveLength(LIMITS.maxRosterAgents);
    d.close();
    // The seed is past the live-agent caps (B11); close it so later tests on
    // the owner hub can still register agents.
    await inOwnerHub((s) =>
      s.storage.sql.exec(
        "update agents set live = 0 where machine_id = ? and native_ref like 'seed_%'",
        m.id,
      ),
    );
  });

  it("broadcasts roster_changed on agent_up and agent_down to daemons with an agent in the namespace", async () => {
    const one = await machine("One");
    const two = await machine("Two");
    const a = ns();
    const d1 = await ready(one.token);
    const d2 = await ready(two.token);
    d2.send(up("u0", "ses_2", "Second", a));
    await waitFor(d2, "agent_ok");
    d1.send(up("u1", "ses_1", "First", a));
    await waitFor(d1, "agent_ok");
    expect((await waitFor(d2, "roster_changed")).namespace).toBe(a);
    d1.send({ v: 1, id: "d1", type: "agent_down", agent_ref: "ses_1" });
    expect((await waitFor(d2, "roster_changed")).namespace).toBe(a);
    d1.close();
    d2.close();
  });
});

describe("hub socket: lifecycle", () => {
  it("keeps the last socket and closes the replaced one with 1000", async () => {
    const m = await machine();
    const first = await daemon(m.token);
    const second = await daemon(m.token);
    const c = await first.closed;
    expect(c.code).toBe(1000);
    expect(c.reason).toBe("replaced");
    second.send(hello());
    expect((await waitFor(second, "hello_ok")).machine_id).toBe(m.id);
    second.close();
  });

  it("closes a revoked machine's socket with 4403 on its next message", async () => {
    const m = await machine();
    const d = await ready(m.token);
    await inOwnerHub((s) => {
      s.storage.sql.exec(
        "update machines set revoked_at = ? where id = ?",
        Date.now(),
        m.id,
      );
    });
    d.send(hello("h2"));
    expect((await d.closed).code).toBe(LIMITS.revokeCloseCode);
  });

  it("auto-answers the bare-string PING with PONG", async () => {
    const m = await machine();
    const d = await daemon(m.token);
    d.ws.send(PING);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no pong")), 2000);
      d.ws.addEventListener("message", (ev) => {
        if (ev.data === PONG) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    d.close();
  });

  it("reports connected in listMachines while the socket is open", async () => {
    const m = await machine("Live");
    const d = await ready(m.token);
    const row = (await hub(e).listMachines()).find((r) => r.id === m.id);
    expect(row?.connected).toBe(true);
    d.close();
    await d.closed;
  });

  it("answers bad_frame to an unreadable, binary or server frame and stays open", async () => {
    const m = await machine();
    const d = await ready(m.token);
    d.ws.send("{nope");
    let err = await waitFor(d, "error");
    expect(err.code).toBe("bad_frame");
    d.ws.send(new Uint8Array([1, 2, 3]));
    err = await waitFor(d, "error");
    expect(err.code).toBe("bad_frame");
    d.ws.send(
      JSON.stringify({
        v: 1,
        id: "x1",
        type: "roster_changed",
        namespace: "a",
      }),
    );
    err = await waitFor(d, "error");
    expect(err).toMatchObject({ id: "x1", code: "bad_frame" });
    d.send(hello("h9"));
    expect((await waitFor(d, "hello_ok")).id).toBe("h9");
    d.close();
  });

  it("every frame it emitted parses with decodeServerFrame", async () => {
    const m = await machine();
    const other = await machine();
    const a = ns();
    const d = await ready(m.token);
    const watcher = await ready(other.token);
    watcher.send(up("u0", "ses_w", "Watch", a));
    await waitFor(watcher, "agent_ok");
    d.send(up("u1", "ses_a", "Emit", a));
    await waitFor(d, "agent_ok");
    d.send({ v: 1, id: "l1", type: "list", from_ref: "ses_a" });
    await waitFor(d, "roster");
    d.send({ v: 1, id: "l2", type: "list", from_ref: "ses_nobody" });
    await waitFor(d, "error");
    d.send({ v: 1, id: "d1", type: "agent_down", agent_ref: "ses_a" });
    await waitFor(watcher, "roster_changed");
    d.ws.send("garbage");
    await waitFor(d, "error");
    d.close();
    await d.closed;
    watcher.close();
    // framesSeen throws on any frame decodeServerFrame refuses.
    const types = new Set(
      [...framesSeen(d), ...framesSeen(watcher)].map((f) => f.type),
    );
    for (const t of [
      "hello_ok",
      "agent_ok",
      "roster",
      "roster_changed",
      "error",
    ])
      expect(types.has(t as never), t).toBe(true);
  });
});
