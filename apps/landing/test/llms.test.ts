import { readdirSync, readFileSync } from "node:fs";
import { AGENT_HABITS } from "@ob/shared";
import { describe, expect, it } from "vitest";
import { REPO_URL, SITE_URL } from "../src/consts";

// setup.md is Platform's docs/install/setup.md, loaded at build time, so it
// is not in src/content/docs; it is still served as /docs/setup.md.
const docs = [
  "setup",
  ...readdirSync(new URL("../src/content/docs", import.meta.url))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, "")),
];
const tools = ["list_agents", "send_message", "fetch", "self"];

// The built pages, imported as text so the test does not need a running site.
const llms = readFileSync(
  new URL("../src/pages/llms.txt.ts", import.meta.url),
  "utf8",
);
const source = (await import("../src/pages/llms.txt.ts")) as {
  GET: () => Response;
};
const body = await source.GET().text();

describe("llms.txt", () => {
  it("renders every working-with-other-agents habit, after Tools (#425)", () => {
    expect(body).toContain("\n## Working with other agents\n");
    expect(body.indexOf("## Working with other agents")).toBeGreaterThan(
      body.indexOf("## Tools"),
    );
    for (const h of AGENT_HABITS) expect(body).toContain(`\n- ${h}\n`);
  });

  it("starts with the product name and summary", () => {
    expect(body.startsWith("# OpenBus\n")).toBe(true);
  });

  it("has the exact set-up headings", () => {
    for (const h of [
      "## Set up OpenBus for your user",
      "## Update an existing install",
      "## Connect another machine",
      "## Tools",
      "## Docs",
    ])
      expect(body).toContain(h);
  });

  it("names every MCP tool", () => {
    for (const t of tools) expect(body).toContain(t);
  });

  it("installs through npx @open-bus/cli and links REPO_URL and SITE_URL", () => {
    expect(body).toContain("npx @open-bus/cli");
    expect(body).toContain(REPO_URL);
    expect(body).toContain(`${SITE_URL}/llms.txt`);
    expect(llms).toContain("REPO_URL");
  });

  it("links every doc page as .md and nothing else", () => {
    const links = [...body.matchAll(/\(([^)]+\.md)\)/g)].map((m) => m[1]);
    expect(links.sort()).toEqual(
      docs.map((d) => `${SITE_URL}/docs/${d}.md`).sort(),
    );
  });
});
