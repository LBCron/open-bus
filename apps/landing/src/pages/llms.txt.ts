import { agentHabitsMarkdown } from "@ob/shared";
import { REPO_URL, SITE_URL } from "../consts";
import { tools } from "../content/tools";
import { doc, docs, section } from "../lib/docs";
import { SUMMARY } from "../lib/llms";

// Built from the docs so it cannot drift: the set-up, update and connect
// sections are docs/install/setup.md's own (Platform owns them).
export function llmsTxt(): string {
  const setup = doc("setup");
  const body = [
    "# OpenBus",
    `> ${SUMMARY}`,
    `Source: ${REPO_URL}`,
    "## Set up OpenBus for your user",
    `### What you need\n\n${section(setup, "What you need")}`,
    `### Steps\n\n${section(setup, "Steps")}`,
    "## Update an existing install",
    section(setup, "Update an existing install"),
    "## Connect another machine",
    section(setup, "Connect another machine"),
    "## Tools",
    [
      "Every agent on the bus gets these tools, scoped to its namespace:",
      "",
      ...tools.map(
        (t) =>
          `- \`${t.name}\`${t.args.length ? ` (${t.args.join("; ")})` : ""}: ${t.description}`,
      ),
    ].join("\n"),
    agentHabitsMarkdown(),
    "## Docs",
    [
      ...docs.map(
        (d) => `- [${d.title}](${SITE_URL}/docs/${d.id}.md): ${d.description}`,
      ),
      `- [All docs in one file](${SITE_URL}/llms-full.txt)`,
    ].join("\n"),
  ].join("\n\n");
  return `${body}\n`;
}

export const GET = (): Response =>
  new Response(llmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
