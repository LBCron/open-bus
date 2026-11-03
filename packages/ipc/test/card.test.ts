import { AGENT_CARD_MIN_CLIENT } from "@ob/shared";
import { describe, expect, it } from "vitest";
import {
  AdapterFrame,
  DaemonFrame,
  forClient,
  seesCard,
} from "../src/index.ts";

const set = (over: object) => ({
  v: 1,
  id: "s",
  type: "set_status",
  state: "working",
  ...over,
});
const card = (over: object) => ({
  v: 1,
  id: "c",
  type: "card",
  aud: "https://artifacts.example.com",
  nonce: "n".repeat(16),
  ...over,
});
const ok = (f: object) => AdapterFrame.safeParse(f).success;

describe("set_status and card requests (AC5a)", () => {
  it("takes the four states and a label of up to 64 characters", () => {
    for (const state of ["working", "idle", "blocked", "waiting_on_owner"])
      expect(ok(set({ state }))).toBe(true);
    expect(ok(set({ label: "é".repeat(64) }))).toBe(true);
    expect(ok(set({ state: "done" }))).toBe(false);
    expect(ok(set({ label: "x".repeat(65) }))).toBe(false);
    // Cleaned like machine labels: no control characters.
    expect(ok(set({ label: "a\nb" }))).toBe(false);
    expect(ok(set({ label: "a\u001b[31mb" }))).toBe(false);
  });

  it("takes a nonce of 16 to 128 URL-safe characters", () => {
    expect(ok(card({ nonce: "A-_z".repeat(4) }))).toBe(true);
    expect(ok(card({ nonce: "x".repeat(128) }))).toBe(true);
    expect(ok(card({ nonce: "x".repeat(15) }))).toBe(false);
    expect(ok(card({ nonce: "x".repeat(129) }))).toBe(false);
    expect(ok(card({ nonce: `${"x".repeat(16)}=` }))).toBe(false);
  });

  it("takes only an exact https origin as aud", () => {
    expect(ok(card({ aud: "https://a.example:8443" }))).toBe(true);
    for (const aud of [
      "https://a.example/",
      "https://a.example/path",
      "https://a.example?x=1",
      "http://a.example",
      "https://user@a.example",
      "https://A.example",
      "https://a.example:443",
    ])
      expect(ok(card({ aud })), aud).toBe(false);
  });

  it("decodes the replies: status_set and card", () => {
    expect(DaemonFrame.parse({ v: 1, id: "s", type: "status_set" })).toEqual({
      v: 1,
      id: "s",
      type: "status_set",
    });
    const earlier = { code: "bad_frame", message: "m" };
    expect(
      DaemonFrame.parse({ v: 1, id: "s", type: "status_set", earlier }),
    ).toMatchObject({ earlier });
    expect(
      DaemonFrame.parse({ v: 1, id: "c", type: "card", jwt: "a.b.c" }),
    ).toMatchObject({ type: "card", jwt: "a.b.c" });
  });
});

const row = {
  name: "code-96",
  namespace: "ns",
  kind: "omp",
  live: true,
  state: "live" as const,
  global: false,
  status: "working" as const,
  status_label: "writing tests",
  status_at: "2026-10-29T12:00:00.000Z",
};
const roster = {
  v: 1 as const,
  id: "l",
  type: "roster" as const,
  agents: [row],
};

describe("forClient: the agent card gate (AC5a)", () => {
  it("passes status to a client at the gate", () => {
    expect(seesCard(AGENT_CARD_MIN_CLIENT)).toBe(true);
    expect(forClient(roster, AGENT_CARD_MIN_CLIENT)).toEqual(roster);
  });

  it("strips it below the gate", () => {
    for (const marker of ["0.53.0", "0.0.0", "dev"]) {
      expect(seesCard(marker)).toBe(false);
      const { status, status_label, status_at, ...plain } = row;
      expect(forClient(roster, marker)).toEqual({ ...roster, agents: [plain] });
    }
  });

  it("strips it for a marker-less 0.44.x client too, kinds rewritten", () => {
    const out = forClient(roster, undefined);
    expect(out.agents[0]).not.toHaveProperty("status");
    expect(out.agents[0]?.kind).toBe("pi");
  });

  it("a refusal passes as it is", () => {
    const amb = {
      v: 1 as const,
      id: "r",
      type: "receipt" as const,
      msg_id: "m",
      state: "refused" as const,
      reason: "ambiguous" as const,
    };
    expect(forClient(amb, "0.53.0")).toEqual(amb);
  });
});
