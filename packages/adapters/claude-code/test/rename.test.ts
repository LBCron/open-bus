// #393, R393d: the rename tool, its gate, and the former-name copy.
import type { DaemonClient, DaemonFrame } from "@ob/ipc";
import { CARD_COPY, RENAME_COPY, untilText } from "@ob/ipc";
import { RENAME_MIN_CLIENT } from "@ob/shared";
import { describe, expect, it, vi } from "vitest";
import { callTool, offeredTools, TOOLS } from "../src/tools.ts";

/** The patch release after the gate: above it, whatever it is pinned to. */
const ABOVE_GATE = RENAME_MIN_CLIENT.replace(/\d+$/, (p) =>
  String(Number(p) + 1),
);

type Frame = { type: string } & Record<string, unknown>;

/** A daemon that answers `answer`, and whose welcome named `bus` at hello. */
function daemon(answer: (f: Frame) => Record<string, unknown>, bus?: string) {
  const frames: Frame[] = [];
  const request = vi.fn(async (f: Frame) => {
    frames.push(f);
    return { v: 1, id: "1", ...answer(f) } as DaemonFrame;
  });
  return {
    frames,
    client: {
      request,
      ...(bus === undefined ? {} : { welcome: { bus_name: bus } }),
    } as unknown as DaemonClient,
  };
}

const agent = (r: Record<string, unknown> = {}) => ({
  name: "lane-6",
  namespace: "default",
  kind: "claude-code",
  live: true,
  global: false,
  ...r,
});

const rename = async (
  args: Record<string, unknown>,
  answer: (f: Frame) => Record<string, unknown>,
  bus?: string,
) => {
  const d = daemon(answer, bus);
  const out = await callTool("rename", args, d.client);
  return { out, frames: d.frames };
};

describe("the rename tool at the gate (#393)", () => {
  it("is in TOOLS, and its copy is Design's", () => {
    const tool = TOOLS.find((t) => t.name === "rename");
    expect(tool?.description).toBe(RENAME_COPY.description);
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      required: ["name"],
      additionalProperties: false,
    });
    expect(tool?.inputSchema.properties.name).toEqual({
      type: "string",
      maxLength: 64,
      description: RENAME_COPY.name_arg,
    });
  });

  it("is offered only to a daemon at or above RENAME_MIN_CLIENT", () => {
    for (const v of [RENAME_MIN_CLIENT, ABOVE_GATE, "1.0.0"]) {
      expect(offeredTools(v).map((t) => t.name)).toContain("rename");
      expect(offeredTools(v)).toHaveLength(TOOLS.length);
    }
    for (const v of [
      "0.65.0",
      "0.63.0",
      "0.54.0",
      "0.44.0",
      undefined,
      "dev",
    ]) {
      expect(offeredTools(v).map((t) => t.name)).not.toContain("rename");
      expect(offeredTools(v)).toHaveLength(TOOLS.length - 1);
    }
  });

  it("is hidden below the gate: every other tool is still offered", () => {
    expect(offeredTools("0.63.0").map((t) => t.name)).toEqual(
      TOOLS.map((t) => t.name).filter((n) => n !== "rename"),
    );
  });
});

describe("the rename result (#393)", () => {
  const T = "2026-10-29T13:00:00.000Z";

  it("says what you are now, and for how long the old name still reaches you", async () => {
    const { out, frames } = await rename(
      { name: "lane-6" },
      () => ({
        type: "agent",
        agent: agent({
          former_names: [{ name: "code-96", expires_at: T }],
        }),
      }),
      "code-96",
    );
    // Over 80 columns, the two sentences take a line each.
    expect(out.content[0]?.text).toBe(
      "You are now lane-6 on the bus.\ncode-96 still reaches you until 2026-10-29 13:00 UTC.",
    );
    expect(out.isError).toBeFalsy();
    expect(frames[0]).toMatchObject({ type: "rename", name: "lane-6" });
    for (const line of (out.content[0]?.text ?? "").split("\n"))
      expect(line.length).toBeLessThanOrEqual(80);
  });

  it("with no expiry from the daemon, names the grace as a duration", async () => {
    // Today's daemon answers with the agent alone: the name it left is the
    // one this connection said hello with.
    const { out } = await rename(
      { name: "lane-6" },
      () => ({
        type: "agent",
        agent: agent(),
      }),
      "code-96",
    );
    expect(out.content[0]?.text).toBe(
      "You are now lane-6 on the bus. code-96 still reaches you for 1 hour.",
    );
  });

  it("keeps one line when both names are short", async () => {
    const { out } = await rename({ name: "a" }, () => ({
      type: "agent",
      agent: agent({ name: "a", former_names: [{ name: "b", expires_at: T }] }),
    }));
    expect(out.content[0]?.text).toBe(
      "You are now a on the bus. b still reaches you until 2026-10-29 13:00 UTC.",
    );
  });

  it("says a name was taken, and which one you got", async () => {
    const { out } = await rename({ name: "code-96" }, () => ({
      type: "agent",
      agent: agent({ name: "code-96-2" }),
    }));
    expect(out.content[0]?.text).toBe(
      "code-96 is taken, so you are now code-96-2.",
    );
  });

  it("is a no-op when the daemon hands back the name it said at hello", async () => {
    const { out } = await rename(
      { name: "lane-6" },
      () => ({
        type: "agent",
        agent: agent(),
      }),
      "lane-6",
    );
    expect(out.content[0]?.text).toBe("You are already lane-6.");
  });

  it("with no former name, says only what you are now", async () => {
    const { out } = await rename({ name: "lane-6" }, () => ({
      type: "agent",
      agent: agent(),
    }));
    expect(out.content[0]?.text).toBe("You are now lane-6 on the bus.");
  });

  it("a hub rate limit is Design's line, not the hub's", async () => {
    const { out } = await rename({ name: "lane-6" }, () => ({
      type: "error",
      code: "rate_limited",
      message: "Too many renames",
    }));
    expect(out).toMatchObject({ isError: true });
    expect(out.content[0]?.text).toBe(RENAME_COPY.rate_limited);
  });

  it("a daemon from before the frame gets the update copy", async () => {
    const { out } = await rename({ name: "lane-6" }, () => ({
      type: "error",
      code: "bad_frame",
      message: "Invalid input",
    }));
    expect(out.content[0]?.text).toBe(CARD_COPY.unsupported);
  });

  it("any other refusal is the daemon's own message", async () => {
    const { out } = await rename({ name: "lane-6" }, () => ({
      type: "error",
      code: "not_registered",
      message: "this session is not on the bus",
    }));
    expect(out).toMatchObject({ isError: true });
    expect(out.content[0]?.text).toBe("this session is not on the bus");
  });

  it("refuses bad arguments before the daemon", async () => {
    for (const args of [
      {},
      { name: "" },
      { name: "x".repeat(65) },
      { name: 5 },
    ]) {
      const { out, frames } = await rename(args, () => ({ type: "agent" }));
      expect(out).toMatchObject({ isError: true });
      expect(out.content[0]?.text).toMatch(/^openbus: name: /);
      expect(frames).toEqual([]);
    }
  });
});

describe("former names where agents read them (#393)", () => {
  it("list_agents shows the newest as (was x)", async () => {
    const d = daemon(() => ({
      type: "roster",
      agents: [
        agent({
          name: "lane-6",
          former_names: [
            { name: "code-96", expires_at: "2026-10-29T13:00:00.000Z" },
            { name: "older", expires_at: "2026-10-29T12:30:00.000Z" },
          ],
        }),
        agent({ name: "plain", kind: "pi" }),
      ],
    }));
    const out = await callTool("list_agents", {}, d.client);
    expect(out.content[0]?.text).toBe(
      "- lane-6 (was code-96) (claude-code, default)\n- plain (pi, default)",
    );
  });

  it("a former name that does not decode is dropped, never shown", async () => {
    const d = daemon(() => ({
      type: "roster",
      agents: [
        agent({
          former_names: [
            { name: "x\x1b]52;c;aGk=\x07", expires_at: "2026-10-29T13:00:00Z" },
          ],
        }),
      ],
    }));
    const out = await callTool("list_agents", {}, d.client);
    expect(out.content[0]?.text).toBe("- lane-6 (claude-code, default)");
  });

  it("a former name with no usable expiry is dropped with it", async () => {
    const d = daemon(() => ({
      type: "agent",
      agent: agent({
        former_names: [{ name: "code-96", expires_at: "not a time" }],
      }),
    }));
    const out = await callTool("self", {}, d.client);
    expect(out.content[0]?.text).not.toContain("Former names");
    // A time that does not parse is still shown as sent, never invented.
    expect(untilText("not a time")).toBe("not a time");
  });
});
