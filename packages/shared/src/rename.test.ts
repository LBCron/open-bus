// R393a (#393): rename frames, roster former_names, the gate and the limits.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LIMITS } from "./limits.js";
import { BusNameSchema } from "./names.js";
import {
  CLIENT_FRAMES,
  decodeClientFrame,
  decodeServerFrame,
  encodeFrame,
  SERVER_FRAMES,
} from "./protocol.js";
import {
  FormerNamesSchema,
  RENAME_MESSAGES,
  RENAME_MIN_CLIENT,
} from "./rename.js";
import { semverGte } from "./semver.js";

const id = "7Yb3kQmZ1xRt9PvA";
const at = (h: number) => new Date(Date.UTC(2026, 10, 4, h)).toISOString();
const row = (former_names?: unknown) => ({
  bus_name: "beta",
  kind: "pi",
  namespace: "ns",
  global: false,
  state: "live",
  ...(former_names === undefined ? {} : { former_names }),
});
const roster = (agents: unknown[]) =>
  JSON.stringify({ v: 1, id, type: "roster", agents });

describe("limits and gate (R393a)", () => {
  it("pins the grace, the roster cap and the rate", () => {
    expect(LIMITS.formerNameGraceMs).toBe(3_600_000);
    expect(LIMITS.formerNameGraceMs).toBe(LIMITS.mailTtlSec * 1000);
    expect(LIMITS.maxFormerNames).toBe(5);
    expect(LIMITS.renamesPerHour).toBe(10);
    expect(RENAME_MESSAGES).toEqual({ rate: "Too many renames" });
  });

  it("gates above the latest release, 0.63.0", () => {
    expect(RENAME_MIN_CLIENT).toBe("0.64.0");
    expect(semverGte("0.63.0", RENAME_MIN_CLIENT)).toBe(false);
    expect(semverGte("0.64.0", RENAME_MIN_CLIENT)).toBe(true);
  });
});

describe("rename / renamed frames (R393a)", () => {
  const rename = {
    v: 1,
    id,
    type: "rename",
    agent_ref: "s1",
    proposed_name: "OpenBus Backend",
  } as const;

  it("lists both frames", () => {
    expect(CLIENT_FRAMES).toContain("rename");
    expect(SERVER_FRAMES).toContain("renamed");
  });

  it("round-trips rename (client) and renamed (server)", () => {
    const r = decodeClientFrame(encodeFrame(rename));
    expect(r).toEqual({ ok: true, frame: rename });
    const renamed = {
      v: 1,
      id,
      type: "renamed",
      agent_ref: "s1",
      bus_name: "OpenBus Backend",
      former: "agent-2",
    } as const;
    expect(decodeServerFrame(encodeFrame(renamed))).toEqual({
      ok: true,
      frame: renamed,
    });
    // Each decoder accepts only its own direction.
    expect(decodeServerFrame(encodeFrame(rename)).ok).toBe(false);
    expect(decodeClientFrame(encodeFrame(renamed)).ok).toBe(false);
  });

  it("parses renamed without former (a no-op)", () => {
    const f = { v: 1, id, type: "renamed", agent_ref: "s1", bus_name: "a" };
    expect(decodeServerFrame(JSON.stringify(f)).ok).toBe(true);
  });

  it("refuses a renamed whose former is its own bus_name", () => {
    const f = {
      v: 1,
      id,
      type: "renamed",
      agent_ref: "s1",
      bus_name: "a",
      former: "a",
    };
    expect(decodeServerFrame(JSON.stringify(f)).ok).toBe(false);
  });

  it("bounds proposed_name like agent_up, and rejects an empty or extra field", () => {
    const enc = (o: object) => JSON.stringify({ ...rename, ...o });
    expect(decodeClientFrame(enc({ proposed_name: "x".repeat(256) })).ok).toBe(
      true,
    );
    expect(decodeClientFrame(enc({ proposed_name: "x".repeat(257) })).ok).toBe(
      false,
    );
    expect(decodeClientFrame(enc({ proposed_name: "" })).ok).toBe(false);
    expect(decodeClientFrame(enc({ proposed_name: "\ud800" })).ok).toBe(false);
    expect(decodeClientFrame(enc({ name: "x" })).ok).toBe(false);
  });
});

describe("roster former_names (R393a)", () => {
  const five = [5, 4, 3, 2, 1].map((h, i) => ({
    name: `old-${i}`,
    expires_at: at(h),
  }));

  it("round-trips up to 5, newest first", () => {
    const raw = roster([row(five)]);
    const r = decodeServerFrame(raw);
    expect(r.ok).toBe(true);
    expect(r.ok && r.frame.type === "roster" && r.frame.agents[0]).toEqual(
      row(five),
    );
    expect(FormerNamesSchema.parse(five)).toEqual(five);
  });

  it("is optional: a row without it still parses", () => {
    expect(decodeServerFrame(roster([row()])).ok).toBe(true);
  });

  it("rejects over 5 former names", () => {
    const six = [...five, { name: "old-5", expires_at: at(0) }];
    expect(decodeServerFrame(roster([row(six)])).ok).toBe(false);
    expect(FormerNamesSchema.safeParse(six).success).toBe(false);
  });

  it("rejects out-of-order, duplicate, current or malformed entries", () => {
    const bad: unknown[] = [
      [five[1], five[0]], // oldest first
      [five[0], { ...five[1], name: five[0].name }], // duplicate name
      [{ name: "beta", expires_at: at(1) }], // the row's own bus_name
      [{ name: "openbus", expires_at: at(1) }], // reserved
      [{ name: "a", expires_at: "soon" }],
      [{ name: "a", expires_at: at(1), extra: 1 }],
      [],
    ];
    for (const b of bad)
      expect(decodeServerFrame(roster([row(b)])).ok, JSON.stringify(b)).toBe(
        false,
      );
  });
});

/**
 * A published 0.54.0 daemon/hub decoder, frozen: its frame type lists and its
 * strict roster row, from `git show v0.54.0:packages/shared/src/protocol.ts`.
 * It must reject both new frames and a row with `former_names`, which is why
 * the hub gates them on RENAME_MIN_CLIENT.
 */
describe("frozen 0.54.0 decoders reject the new wire (the gate is needed)", () => {
  const V054_CLIENT = [
    "hello",
    "agent_up",
    "agent_down",
    "sessions",
    "send",
    "ack",
    "refuse",
    "list",
    "fetch",
  ];
  const V054_SERVER = [
    "hello_ok",
    "agent_ok",
    "receipt",
    "roster",
    "body",
    "error",
    "deliver",
    "receipt_update",
    "roster_changed",
  ];
  const V054Row = z.strictObject({
    bus_name: BusNameSchema,
    kind: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    namespace: z.string(),
    global: z.boolean(),
    state: z.enum(["live", "queued"]),
    machine_label: z.string().optional(),
  });

  it("knows neither frame type", () => {
    expect(V054_CLIENT).not.toContain("rename");
    expect(V054_SERVER).not.toContain("renamed");
  });

  it("rejects a roster row carrying former_names, and takes one without", () => {
    const names = [{ name: "alpha", expires_at: at(1) }];
    expect(V054Row.safeParse(row(names)).success).toBe(false);
    expect(V054Row.safeParse(row()).success).toBe(true);
  });
});

describe("decoder bounds for former_names (R393a)", () => {
  const worst = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      bus_name: `agent-${i}-${"x".repeat(40)}`,
      kind: "claude-code",
      namespace: "github.com/open-artifacts-ai/open-bus",
      global: false,
      state: "queued",
      machine_label: "Leo-Workstation",
      role: `role-${i}`,
      status: "waiting_on_owner",
      status_label: "x".repeat(64),
      status_at: at(1),
      former_names: [5, 4, 3, 2, 1].map((h, j) => ({
        name: `old-${i}-${j}`,
        expires_at: at(h),
      })),
    }));

  it("a full roster of worst-case rows decodes on the daemon side", () => {
    const r = decodeServerFrame(roster(worst(LIMITS.maxRosterAgents)));
    expect(r.ok).toBe(true);
  });

  it("the server decoder allows depth 5 but not 6", () => {
    const f = (x: string) =>
      `{"v":1,"id":"${id}","type":"roster_changed","namespace":"a","x":${x}}`;
    // The pre-scan refuses without recovering the id; the schema (strict,
    // no `x`) refuses with it. So depth 5 reaches the schema, depth 6 doesn't.
    expect(decodeServerFrame(f("[[[[]]]]"))).toEqual({
      ok: false,
      error: "bad_frame",
      id,
    });
    expect(decodeServerFrame(f("[[[[[]]]]]"))).toEqual({
      ok: false,
      error: "bad_frame",
    });
  });

  it("the hub-side client decoder keeps depth 4", () => {
    // A rename never nests; a depth-5 client frame is refused before parse.
    const deep = `{"v":1,"id":"${id}","type":"ack","x":[[[[]]]]}`;
    expect(decodeClientFrame(deep)).toEqual({ ok: false, error: "bad_frame" });
  });
});
