import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { LIMITS, OWNER_ORG_ID } from "@ob/shared";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { activeMachine, Hub, type HubStub } from "../src/hub/do.js";
import { sha256Hex } from "../src/hub/hash.js";
import { HUB_SCHEMA } from "../src/hub/schema.js";
import { hub } from "../src/hub/stub.js";

const e = env as unknown as Env;

/** A hub of its own, so counts and ordering are not shared with other tests. */
const freshHub = (): HubStub =>
  e.HUB.get(e.HUB.newUniqueId()) as unknown as HubStub;

const inHub = <R>(h: HubStub, fn: (i: Hub, s: DurableObjectState) => R) =>
  runInDurableObject(h as unknown as DurableObjectStub<Hub>, (i: Hub, s) =>
    fn(i, s),
  );

/** Creates a machine over the stub and fails the test unless it succeeded. */
const create = async (h: HubStub, label: string) => {
  const r = await h.createMachine(label);
  if (!r.ok) throw new Error(`createMachine refused: ${r.code}`);
  return r;
};

/** The clock is instance-only (never RPC): set it inside the DO. */
const setClock = (h: HubStub, ms: number | null) =>
  inHub(h, (i) => Hub.setTestClock(i, ms));

/** The revoke lookup is module-level (not RPC); run it inside the DO. */
const lookup = (s: DurableObjectState, id: string) => activeMachine(s, id);

/** The deliberate RPC surface. Adding a public method means adding it here. */
const RPC_ALLOWLIST = [
  "approveDevice",
  "bumpSessionGeneration",
  "consumeState",
  "createDeviceCode",
  "createMachine",
  "denyDevice",
  "deviceForApproval",
  "linkApp",
  "listAgents",
  "listLinkedApps",
  "listMachines",
  "pollDevice",
  "revokeMachine",
  "sessionGeneration",
  "unlinkApp",
  "verifyToken",
];

/**
 * DurableObject handlers (B5). On the prototype, but workerd reserves these
 * names: a stub cannot call them over RPC (DurableObjectStub omits them).
 */
const DO_HANDLERS = [
  "alarm",
  "fetch",
  "webSocketClose",
  "webSocketError",
  "webSocketMessage",
];

const plan = (h: HubStub, q: string, ...b: SqlStorageValue[]) =>
  inHub(h, (_, s) =>
    s.storage.sql
      .exec<{ detail: string }>(`explain query plan ${q}`, ...b)
      .toArray()
      .map((r) => r.detail)
      .join(" | "),
  );

const revoke = (h: HubStub, id: string, at = Date.now()) =>
  inHub(h, (_, s) => {
    s.storage.sql.exec(
      "update machines set revoked_at = ? where id = ?",
      at,
      id,
    );
  });

describe("hub machines", () => {
  it("creates a machine, returns a token once and verifies its hash", async () => {
    const h = hub(e);
    const m = await create(h, "MacBook");
    expect(m.token).toMatch(/^ob_machine_[1-9A-HJ-NP-Za-km-z]{32}$/);
    expect(m.id).toHaveLength(16);
    expect(await h.verifyToken(await sha256Hex(m.token))).toEqual({
      id: m.id,
      label: "MacBook",
    });
    expect(
      await h.verifyToken(await sha256Hex(`ob_machine_${"a".repeat(32)}`)),
    ).toBeNull();
  });

  it("lists machines with liveness and never the hash", async () => {
    const h = hub(e);
    const m = await create(h, "Studio");
    const rows = await h.listMachines();
    const row = rows.find((r) => r.id === m.id);
    expect(row).toMatchObject({
      label: "Studio",
      revokedAt: null,
      lastUsedAt: null,
      connected: false,
    });
    const json = JSON.stringify(rows);
    expect(json).not.toContain("tokenHash");
    expect(json).not.toContain("token_hash");
    expect(json).not.toContain(m.token);
    expect(json).not.toContain(await sha256Hex(m.token));
  });

  it("stamps org_id on every row", async () => {
    const h = hub(e);
    await create(h, "Org");
    expect((await h.listMachines()).length).toBeGreaterThan(0);
    const orgs = await inHub(h, (_, s) =>
      s.storage.sql
        .exec<{ org_id: string }>("select distinct org_id from machines")
        .toArray()
        .map((r) => r.org_id),
    );
    expect(orgs).toEqual([OWNER_ORG_ID]);
  });

  it("stores only the token's SHA-256, never the token", async () => {
    const h = freshHub();
    const m = await create(h, "Hash");
    const stored = await inHub(
      h,
      (_, s) =>
        s.storage.sql
          .exec<{ token_hash: string }>(
            "select token_hash from machines where id = ?",
            m.id,
          )
          .one().token_hash,
    );
    expect(stored).not.toBe(m.token);
    expect(stored).not.toContain(m.token);
    expect(stored).toBe(await sha256Hex(m.token));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lists revoked machines with revokedAt set and connected false", async () => {
    const h = freshHub();
    const m = await create(h, "Old laptop");
    await revoke(h, m.id, 1_700_000_000_000);
    const row = (await h.listMachines()).find((r) => r.id === m.id);
    expect(row).toMatchObject({
      revokedAt: 1_700_000_000_000,
      connected: false,
    });
    expect(await h.verifyToken(await sha256Hex(m.token))).toBeNull();
  });

  it("machine(id) is null for a revoked or unknown machine", async () => {
    const h = freshHub();
    const live = await create(h, "Live");
    const gone = await create(h, "Gone");
    await revoke(h, gone.id);
    await inHub(h, (_, s) => {
      expect(lookup(s, live.id)).toMatchObject({
        id: live.id,
        label: "Live",
        connected: false,
      });
      expect(lookup(s, gone.id)).toBeNull();
      expect(lookup(s, "1111111111111111")).toBeNull();
    });
  });

  it("reports connected from a socket tagged with the machine id, never for a revoked one", async () => {
    const h = freshHub();
    const on = await create(h, "On");
    const off = await create(h, "Off");
    const cut = await create(h, "Cut");
    // Hold the client ends for the whole test: an unreferenced end can be
    // collected or closed under load, which drops the server end's `connected`.
    // The server ends are closed inside the hub (the client ends belong to
    // another context and cannot be closed from here).
    const clients: WebSocket[] = [];
    try {
      await inHub(h, (_, s) => {
        for (const id of [on.id, cut.id]) {
          const pair = new WebSocketPair();
          const [client, server] = [pair[0], pair[1]];
          clients.push(client);
          s.acceptWebSocket(server, [id]);
        }
      });
      await revoke(h, cut.id);
      const rows = await h.listMachines();
      const by = (id: string) => rows.find((r) => r.id === id)?.connected;
      expect(by(on.id)).toBe(true);
      expect(by(off.id)).toBe(false);
      expect(by(cut.id)).toBe(false);
      await inHub(h, (_, s) => {
        expect(lookup(s, on.id)?.connected).toBe(true);
      });
    } finally {
      await inHub(h, (_, s) => {
        for (const id of [on.id, cut.id])
          for (const ws of s.getWebSockets(id)) ws.close(1000, "done");
      });
      expect(clients).toHaveLength(2);
    }
  });

  it("lists active machines newest first, then revoked newest first", async () => {
    const h = freshHub();
    const t0 = 1_800_000_000_000;
    const ids: string[] = [];
    for (let k = 0; k < 4; k++) {
      await setClock(h, t0 + k);
      ids.push((await create(h, `m${k}`)).id);
    }
    await revoke(h, ids[1] as string);
    await revoke(h, ids[3] as string);
    expect((await h.listMachines()).map((r) => r.id)).toEqual([
      ids[2],
      ids[0],
      ids[3],
      ids[1],
    ]);
  });

  it("caps active machines at maxMachinesListed and always lists every active one", async () => {
    const h = freshHub();
    const t0 = 1_800_000_000_000;
    const ids: string[] = [];
    for (let k = 0; k < LIMITS.maxMachinesListed; k++) {
      await setClock(h, t0 + k);
      ids.push((await create(h, `m${k}`)).id);
    }
    // Over the stub: the refusal is a plain result, so it survives RPC intact.
    expect(await h.createMachine("one too many")).toEqual({
      ok: false,
      code: "machine_limit",
    });
    // Revoking frees a slot; newer revoked rows never push an active one off.
    await revoke(h, ids[0] as string);
    await revoke(h, ids[1] as string);
    await setClock(h, t0 + 1000);
    const late = await create(h, "late");
    const rows = await h.listMachines();
    expect(rows).toHaveLength(LIMITS.maxMachinesListed);
    const active = rows.filter((r) => r.revokedAt === null);
    expect(active).toHaveLength(LIMITS.maxMachinesListed - 1);
    expect(rows.slice(0, active.length)).toEqual(active);
    expect(rows[0]?.id).toBe(late.id);
    expect(active.at(-1)?.id).toBe(ids[2]);
    expect(rows.at(-1)?.id).toBe(ids[1]);
  });

  it("concurrent creates never pass the active cap", async () => {
    const h = freshHub();
    const n = await inHub(h, async (i, st) => {
      for (let k = 0; k < LIMITS.maxMachinesListed - 2; k++)
        await i.createMachine(`m${k}`);
      const rs = await Promise.allSettled(
        Array.from({ length: 10 }, (_, k) => i.createMachine(`c${k}`)),
      );
      const ok = rs.filter((r) => r.status === "fulfilled" && r.value.ok);
      const refused = rs.filter(
        (r) =>
          r.status === "fulfilled" &&
          !r.value.ok &&
          r.value.code === "machine_limit",
      );
      expect(ok).toHaveLength(2);
      expect(refused).toHaveLength(8);
      return st.storage.sql
        .exec<{ n: number }>(
          "select count(*) as n from machines where revoked_at is null",
        )
        .one().n;
    });
    expect(n).toBe(LIMITS.maxMachinesListed);
  });

  it("an older active machine stays listed behind 100 newer revoked ones (ADV-2)", async () => {
    const h = freshHub();
    const live = await create(h, "Still live");
    await setClock(h, Date.now() + 10);
    for (let k = 0; k < LIMITS.maxMachinesListed; k++) {
      const m = await create(h, `burner${k}`);
      await revoke(h, m.id, 1);
    }
    expect(await h.verifyToken(await sha256Hex(live.token))).not.toBeNull();
    expect((await h.listMachines()).map((r) => r.id)).toContain(live.id);
  });

  it("list and cap queries need no temp B-tree (ADV-5)", async () => {
    const h = freshHub();
    // The exact queries listMachines and createMachine's cap run.
    for (const [q, ...b] of [
      [
        "select id from machines where org_id = ? order by (revoked_at is null) desc, created_at desc, rowid desc limit ?",
        "o",
        100,
      ],
      [
        "select count(*) as n from machines where org_id = ? and (revoked_at is null) = 1",
        "o",
      ],
    ] as [string, ...SqlStorageValue[]][]) {
      const p = await plan(h, q, ...b);
      expect(p).not.toMatch(/TEMP B-TREE/);
      expect(p).toMatch(/USING (COVERING )?INDEX machines_list/);
    }
  });

  it.each([
    ["empty", ""],
    ["control character", "Mac\u0007Book"],
    ["bidi override", "Mac‮Book"],
    ["zero-width", "Mac​Book"],
    ["surrounding whitespace", " MacBook "],
    ["over 128 characters", "a".repeat(129)],
  ])("rejects a label with %s", async (_, label) => {
    const h = freshHub();
    // On the instance: over RPC, workerd reports the awaited rejection as unhandled.
    await inHub(h, async (i) => {
      await expect(i.createMachine(label)).rejects.toThrow(
        /invalid machine label/,
      );
    });
    expect(await h.listMachines()).toEqual([]);
  });

  it("accepts a 128-character label", async () => {
    const h = freshHub();
    const label = "a".repeat(128);
    expect((await create(h, label)).label).toBe(label);
  });

  it("throttles last_used to once an hour", async () => {
    const h = freshHub();
    const m = await create(h, "Busy");
    const hash = await sha256Hex(m.token);
    const t0 = 1_900_000_000_000;
    await setClock(h, t0);
    await h.verifyToken(hash);
    await setClock(h, t0 + 60_000);
    await h.verifyToken(hash);
    expect((await h.listMachines())[0]?.lastUsedAt).toBe(t0);
    await setClock(h, t0 + 3_600_001);
    await h.verifyToken(hash);
    expect((await h.listMachines())[0]?.lastUsedAt).toBe(t0 + 3_600_001);
  });

  it("keeps the test clock off the RPC surface", async () => {
    // RPC exposes the class's prototype methods; calling a missing one over the
    // stub rejects but workerd also logs it as uncaught, so check the shape.
    const rpc = Object.getOwnPropertyNames(Hub.prototype);
    expect(rpc).not.toContain("setClock");
    expect(rpc).not.toContain("setTestClock");
    expect(typeof Hub.setTestClock).toBe("function");
    await inHub(freshHub(), (i) => {
      expect("setClock" in i).toBe(false);
      expect("setTestClock" in i).toBe(false);
    });
  });

  it("refuses the socket handlers over RPC", async () => {
    const stub = freshHub() as unknown as Record<
      string,
      (...a: unknown[]) => Promise<unknown>
    >;
    for (const n of [
      "alarm",
      "webSocketMessage",
      "webSocketClose",
      "webSocketError",
    ])
      await expect(
        Promise.resolve().then(() => stub[n]?.(null, "x")),
        n,
      ).rejects.toThrow(/reserved method/);
  });

  it("exposes exactly the allowlisted methods over RPC (ADV-1)", async () => {
    const own = Object.getOwnPropertyNames(Hub.prototype)
      .filter((n) => n !== "constructor" && !DO_HANDLERS.includes(n))
      .sort();
    expect(own).toEqual(RPC_ALLOWLIST);
    for (const n of DO_HANDLERS)
      expect(Object.getOwnPropertyNames(Hub.prototype)).toContain(n);
    await inHub(freshHub(), (i) => {
      for (const n of ["all", "one", "now", "machine", "withLiveness"])
        expect(n in i).toBe(false);
    });
  });

  it("the schema is idempotent", async () => {
    const h = freshHub();
    await create(h, "Keep");
    await inHub(h, (_, s) => {
      s.storage.sql.exec(HUB_SCHEMA);
      s.storage.sql.exec(HUB_SCHEMA);
      new Hub(s, e);
    });
    expect((await h.listMachines()).map((r) => r.label)).toEqual(["Keep"]);
  });
});
