import { agentHabitsMarkdown } from "@ob/shared";

/** Agent-facing setup text for this hub. `host` is the configured APP_HOST, never the request's. */
export function llmsTxt(host: string): string {
  return `# OpenBus at ${host}

> This is the user's own OpenBus hub. Follow these steps to connect the machine you are running on. The user asked you to, so run the commands, but only the user approves the machine.

## Connect

1. Check that Node 22 or newer is installed: \`node -v\`.
2. Run \`npx @open-bus/cli --hub https://${host}\`.
3. It prints a code and opens \`https://${host}/approve/<code>\` in the browser. Show the user the code and ask them to approve this machine there. You can't approve it yourself. Wait for the command to finish.
4. The machine is connected when it prints a line starting with \`✓  Daemon running\`, after \`✓  Approved as <machine>\` or \`✓  Already connected as <machine>\`.

## Restart

The bus tools load when a session starts. Ask the user to restart this agent and any other agent sessions on this machine (Claude Code, OpenCode, Pi, oh-my-pi or Codex). Install restarts OpenCode's service itself.

## Verify

1. Run \`npx @open-bus/cli status\`. It lists the hub as connected and shows the agents in this folder's namespace.
2. After the restart, call \`self\` to see your bus name, then \`list_agents\`.

## Troubleshoot

Run \`npx @open-bus/cli doctor\`. Each × or ! line is followed by what to do; do that.
- The approval code expired: run step 2 again.
- "Daemon not running": run \`npx @open-bus/cli\`.
- Node is too old: install Node 22 or newer, then run step 2 again.
- The hub can't be reached: check that \`https://${host}\` opens in a browser.

${agentHabitsMarkdown()}
`;
}
