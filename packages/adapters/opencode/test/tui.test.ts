import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const PLUGIN = new URL("../assets/opencode-tui/tui.js", import.meta.url).href;

type Plugin = { id: string; setup: (api: unknown) => void };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("opencode tui presence plugin", () => {
  it("lists each root session it opens in OPENBUS_HOME/opencode-tui/<pid>.json", async () => {
    vi.useFakeTimers();
    const home = mkdtempSync(join(tmpdir(), "ob-tui-"));
    vi.stubEnv("OPENBUS_HOME", home);
    const parents: Record<string, { parentID?: string }> = {
      ses_child: { parentID: "ses_root" },
      ses_root: {},
      ses_other: {},
    };
    let route: { type: string; sessionID?: string } = { type: "home" };
    const api = {
      ui: { router: { current: () => route } },
      data: { session: { get: (id: string) => parents[id] } },
    };
    const plugin = (await import(PLUGIN)).default as Plugin;
    expect(plugin.id).toBe("openbus.opencode.presence");
    plugin.setup(api);

    const file = join(home, "opencode-tui", `${process.pid}.json`);
    vi.advanceTimersByTime(500);
    expect(existsSync(file)).toBe(false); // home screen: nothing open

    route = { type: "session", sessionID: "ses_child" };
    vi.advanceTimersByTime(500);
    route = { type: "session", sessionID: "ses_other" };
    vi.advanceTimersByTime(500);
    const body = JSON.parse(readFileSync(file, "utf8"));
    expect(body).toMatchObject({
      pid: process.pid,
      sessionIDs: ["ses_root", "ses_other"],
      titles: { ses_root: "", ses_other: "" },
    });
    // Written atomically: no temp file is left beside it.
    expect(readdirSync(join(home, "opencode-tui"))).toEqual([
      `${process.pid}.json`,
    ]);
  });

  it("publishes each root's title, and again when the title changes: a rename (#393)", async () => {
    vi.useFakeTimers();
    const home = mkdtempSync(join(tmpdir(), "ob-tui-t-"));
    vi.stubEnv("OPENBUS_HOME", home);
    const titles: Record<string, string> = { ses_root: "First title" };
    const sessions: Record<string, { parentID?: string; title?: string }> = {
      ses_child: { parentID: "ses_root" },
    };
    Object.defineProperty(sessions, "ses_root", {
      get: () => ({ title: titles.ses_root }),
    });
    const api = {
      ui: {
        router: {
          current: () => ({ type: "session", sessionID: "ses_child" }),
        },
      },
      data: { session: { get: (id: string) => sessions[id] } },
    };
    ((await import(PLUGIN)).default as Plugin).setup(api);
    const file = join(home, "opencode-tui", `${process.pid}.json`);
    vi.advanceTimersByTime(500);
    expect(JSON.parse(readFileSync(file, "utf8")).titles).toEqual({
      ses_root: "First title",
    });
    // No tool call, no route change: only the title moved.
    titles.ses_root = "Second title";
    vi.advanceTimersByTime(500);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      sessionIDs: ["ses_root"],
      titles: { ses_root: "Second title" },
    });
  });

  it("treats an empty OPENBUS_HOME as unset: lists in ~/.openbus, never the cwd", async () => {
    vi.useFakeTimers();
    const home = mkdtempSync(join(tmpdir(), "ob-tui-h-"));
    vi.stubEnv("OPENBUS_HOME", "");
    vi.stubEnv("HOME", home);
    const api = {
      ui: { router: { current: () => ({ type: "session", sessionID: "s" }) } },
      data: { session: { get: () => ({}) } },
    };
    ((await import(PLUGIN)).default as Plugin).setup(api);
    vi.advanceTimersByTime(500);
    expect(
      existsSync(join(home, ".openbus", "opencode-tui", `${process.pid}.json`)),
    ).toBe(true);
  });
});
