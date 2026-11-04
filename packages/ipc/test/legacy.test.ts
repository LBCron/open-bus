import { RENAME_MIN_CLIENT } from "@ob/shared";
import { describe, expect, it } from "vitest";
import {
  forClient,
  forOldClient,
  LEGACY_KINDS,
  legacyKind,
  seesRename,
} from "../src/index.ts";

describe("legacyKind (C23c, C26a)", () => {
  it("keeps the three kinds a 0.44.x client knows", () => {
    for (const k of LEGACY_KINDS) expect(legacyKind(k)).toBe(k);
  });

  it("shows omp, codex and later kinds as pi", () => {
    for (const k of ["omp", "codex", "zeta", "zz"])
      expect(legacyKind(k)).toBe("pi");
  });

  it("keeps a codex row, so an old session can still address it by name", () => {
    const row = {
      name: "codex-1",
      namespace: "ns",
      kind: "codex",
      live: true,
      state: "live" as const,
      global: false,
    };
    expect(
      forOldClient({ v: 1, id: "1", type: "roster", agents: [row] }),
    ).toEqual({
      v: 1,
      id: "1",
      type: "roster",
      agents: [{ ...row, kind: "pi" }],
    });
  });
});

describe("the rename gate (#393)", () => {
  const former = [{ name: "older", expires_at: "2026-11-04T12:00:00.000Z" }];
  const row = {
    name: "peer",
    namespace: "ns",
    kind: "pi",
    live: true,
    state: "live" as const,
    global: false,
    former_names: former,
  };
  const receipt = {
    v: 1 as const,
    id: "r",
    type: "receipt" as const,
    msg_id: "m",
    state: "pending" as const,
    to_name: "peer",
  };

  it("gates on the client's marker", () => {
    expect(seesRename(undefined)).toBe(false);
    expect(seesRename("0.63.0")).toBe(false);
    expect(seesRename(RENAME_MIN_CLIENT)).toBe(true);
    expect(seesRename("0.65.0")).toBe(true);
  });

  it("strips former names and a receipt's to_name below the gate", () => {
    for (const marker of [undefined, "0.54.0", "0.63.0"]) {
      const roster = forClient(
        { v: 1, id: "1", type: "roster", agents: [row] },
        marker,
      );
      expect(roster.agents[0]).not.toHaveProperty("former_names");
      expect(forClient(receipt, marker)).not.toHaveProperty("to_name");
      const status = forClient(
        {
          v: 1 as const,
          id: "s",
          type: "status" as const,
          pid: 1,
          version: "0.60.0",
          label: "laptop",
          hub: "connected" as const,
          namespaces: [
            {
              namespace: "ns",
              agents: [
                {
                  name: "peer",
                  kind: "pi",
                  machine: "laptop",
                  state: "live" as const,
                  former_names: former,
                },
              ],
            },
          ],
        },
        marker,
      );
      expect(status.namespaces[0]?.agents[0]).not.toHaveProperty(
        "former_names",
      );
    }
  });

  it("passes them through at the gate", () => {
    const roster = forClient(
      { v: 1, id: "1", type: "roster", agents: [row] },
      RENAME_MIN_CLIENT,
    );
    expect(roster.agents[0]?.former_names?.[0]?.name).toBe("older");
    expect(forClient(receipt, RENAME_MIN_CLIENT)).toHaveProperty(
      "to_name",
      "peer",
    );
  });
});
