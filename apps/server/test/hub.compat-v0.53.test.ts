// AC2a (Review Focus 3): a published 0.53.0 daemon's roster and receipt
// decoders, frozen at the last commit before AC1 (3f921a0). A hub with agents
// with status (AC3) must still hand it frames it decodes; roles are gone
// (#394), so a former role name is unknown_agent.
import {
  AGENT_CARD_MIN_CLIENT,
  BusNameSchema,
  KindTokenSchema,
  LIMITS,
  MachineLabelSchema,
  MsgIdSchema,
  PONG,
  semverGte,
  WireNamespaceSchema,
} from "@ob/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type Daemon,
  daemon,
  inOwnerHub,
  machine,
  ns,
  up,
  waitFor,
} from "./helpers.js";

// The imported schemas must stay at their 0.53.0 values; if one changes,
// inline its 3f921a0 definition here.
const base = {
  v: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
};
const V053_REASONS = [
  "unknown_agent",
  "closed",
  "inbox_full",
  "too_large",
  "other_namespace",
  "revoked",
  "ambiguous",
] as const;
const V053Roster = z.strictObject({
  ...base,
  type: z.literal("roster"),
  agents: z
    .array(
      z.strictObject({
        bus_name: BusNameSchema,
        kind: KindTokenSchema,
        namespace: WireNamespaceSchema,
        global: z.boolean(),
        state: z.enum(["live", "queued"]),
        machine_label: MachineLabelSchema.optional(),
      }),
    )
    .max(LIMITS.maxRosterAgents),
});
const V053Receipt = z
  .strictObject({
    ...base,
    type: z.literal("receipt"),
    msg_id: MsgIdSchema,
    state: z.enum(["pending", "delivered", "expired", "refused"]),
    reason: z
      .union([z.enum(V053_REASONS), z.literal("recipient_closed")])
      .optional(),
  })
  .refine(
    (f) =>
      (f.state === "refused" &&
        f.reason !== undefined &&
        f.reason !== "recipient_closed") ||
      (f.state === "pending" && f.reason === undefined),
    "send receipt is pending or refused",
  );

let seq = 0;
const id = (t: string) => `${t}${++seq}`;

async function at(version: string): Promise<Daemon> {
  const d = await daemon((await machine()).token);
  d.send({
    v: 1,
    id: id("h"),
    type: "hello",
    machine_label: "M",
    client_version: version,
  });
  await waitFor(d, "hello_ok");
  return d;
}

async function register(
  d: Daemon,
  ref: string,
  name: string,
  namespace: string,
): Promise<string> {
  d.send(up(id("u"), ref, name, namespace));
  expect((await waitFor(d, "agent_ok")).bus_name).toBe(name);
  return inOwnerHub(
    (s) =>
      s.storage.sql
        .exec<{ id: string }>(
          "select id from agents where native_ref = ? and live = 1 and name = ? and namespace = ?",
          ref,
          name,
          namespace,
        )
        .one().id,
  );
}

/** The raw JSON of the `type` reply to frame `fid`. */
async function rawReply(d: Daemon, type: "roster" | "receipt", fid: string) {
  for (;;) {
    const f = await waitFor(d, type);
    if (f.id !== fid) continue;
    const raw = d.raw.find(
      (t) => t !== PONG && t.includes(`"${type}"`) && t.includes(`"${fid}"`),
    ) as string;
    return JSON.parse(raw) as unknown;
  }
}

const decodes = (schema: z.ZodType, raw: unknown) => {
  const r = schema.safeParse(raw);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

describe("a 0.53.0 daemon's decoders on a hub with statuses", () => {
  it("the gate is above 0.53.0", () => {
    expect(semverGte("0.53.0", AGENT_CARD_MIN_CLIENT)).toBe(false);
  });

  it("decodes the roster, a send's receipt and an unknown-name refusal", async () => {
    const host = await at(AGENT_CARD_MIN_CLIENT);
    const old = await at("0.53.0");
    try {
      const a = ns("c53");
      await register(host, "r-h", "Holder", a);
      await register(old, "r-o", "Oldie", a);
      // AC3: statuses set on both a gated agent and the old daemon's own.
      host.send({
        v: 1,
        id: id("st"),
        type: "status",
        from_ref: "r-h",
        state: "working",
        label: "busy",
      });
      old.send({
        v: 1,
        id: id("st"),
        type: "status",
        from_ref: "r-o",
        state: "idle",
      });

      const lid = id("l");
      old.send({ v: 1, id: lid, type: "list", from_ref: "r-o" });
      decodes(V053Roster, await rawReply(old, "roster", lid));

      const sid = id("s");
      old.send({
        v: 1,
        id: sid,
        type: "send",
        from_ref: "r-o",
        to_name: "Holder",
        body: "hi",
      });
      decodes(V053Receipt, await rawReply(old, "receipt", sid));

      const vid = id("s");
      old.send({
        v: 1,
        id: vid,
        type: "send",
        from_ref: "r-o",
        to_name: "lane-7",
        body: "hi",
      });
      const unknown = await rawReply(old, "receipt", vid);
      decodes(V053Receipt, unknown);
      expect(unknown).toMatchObject({
        state: "refused",
        reason: "unknown_agent",
      });

      // The control: the gated daemon's frames fail the frozen decoders.
      const hid = id("l");
      host.send({ v: 1, id: hid, type: "list", from_ref: "r-h" });
      const gatedRoster = (await rawReply(host, "roster", hid)) as {
        agents: Record<string, unknown>[];
      };
      expect(V053Roster.safeParse(gatedRoster).success).toBe(false);
      // Not vacuous: both statuses were applied.
      expect(gatedRoster.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ bus_name: "Holder", status: "working" }),
          expect.objectContaining({ bus_name: "Oldie", status: "idle" }),
        ]),
      );
      for (const row of gatedRoster.agents)
        expect(row).not.toHaveProperty("role");
    } finally {
      for (const d of [host, old])
        try {
          d.close();
        } catch {
          // Already closed.
        }
    }
  });
});
