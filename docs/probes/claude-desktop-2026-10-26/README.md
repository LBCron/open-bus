# Claude desktop Code tab vs the claude-code adapter (I10)

Probed 2026-10-26 on macOS arm64: Claude.app **3.6556.2**, which runs its own
Claude Code **2.1.308**. The terminal `claude` on the same machine is 2.1.310.
Read-only: no session was started and nothing was killed.

## Verdict: works with gaps (static evidence; see the live check below)

No Code-tab session has ever run on this machine. No `claude` process descends
from Claude.app, no transcript has `"entrypoint":"claude-desktop"`, and the app
log has no "Using Claude Code binary" line. The verdict therefore comes from the
app's and CLI's shipped code. The run below would confirm it.

| question                | answer                                                                                                                                                                                                                                                                                                                                                                              | evidence                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Same CLI?               | Yes. The same signed `com.anthropic.claude-code` binary, downloaded to `~/Library/Application Support/Claude/claude-code/<ver>/`, is driven through the Agent SDK with `CLAUDE_CODE_ENTRYPOINT=claude-desktop`.                                                                                                                                                                     | `bundle.txt`, static A1 A4                     |
| Loads our MCP?          | Yes for a normal local spawn: `settingSources: ["user","project","local"]` and no `strictMcpConfig`, so `~/.claude.json` `mcpServers.openbus` loads as a child of `claude`. **Gap:** when the app starts the CLI "through the host CLI launcher", it sets `strictMcpConfig = true` and our server does not load.                                                                    | static A2 A3, `desktop-config.redacted.txt`    |
| `sessions/<pid>.json`?  | Yes, the same writer as the CLI. The gate is "not diskless, not a teammate, not a child session", and the entrypoint plays no part. Fields: `pid sessionId cwd startedAt procStart version kind:"interactive" entrypoint:"claude-desktop" pidDomain messagingSocketPath name …`, and no `tmux`. The app sets none of the env vars that would skip it.                               | static B1 A6                                   |
| Delivery (socket + key) | Yes, the same inbox code: it binds the socket and publishes `<pid>.<sha256(socket)>.key` with `peerToken`, `procStart` and `pidDomain`. CLI baseline on this machine: socket mode 0600 and owner me, dir 0700, key 0600, 108 B, `peerToken` 32 chars.                                                                                                                               | static B2, `registry.redacted.jsonl`           |
| Wake                    | Expected yes. The app holds the CLI's stdin open as an SDK host, like the headless peer in `../claude-2.1.306/wake-probe.mjs`, which woke in 4.0 s on injection alone. **Gap:** inbound messages can be _held_ by the permission-mode parity rule (`mode-mismatch` / `no-mode-asserted`), and the Code tab often runs auto or bypass. A held message waits for approval in the app. | static B4                                      |
| Adapter unchanged?      | Yes. `findSession` walks from `open-bus mcp` up to the nearest `<pid>.json` and needs only `sessionId` + `procStart` (+ `messagingSocketPath` and the key). It never reads `kind`, `entrypoint` or `tmux`. The optional `disclaimer --pgroup` wrapper sits above `claude`, so the walk never reaches it.                                                                            | `packages/adapters/claude-code/src/session.ts` |

Side notes:

- The desktop app reads `~/.claude/sessions` itself to show CLI liveness (static A5).
- The CLI's own peer list labels these sessions `desktop` (static B3).
- The app pins its CLI version independently of `~/.local/bin/claude`, so Code-tab sessions can lag behind or run ahead of the terminal's peer protocol.

## Live check (2026-10-26, the user started one Code-tab session)

A local session in `~/tmp/probe-dir` started from the Code tab: pid 37491, its parent is Claude.app's `disclaimer` helper, and it runs bundled Claude Code 2.1.308.

- **sessions json:** `~/.claude/sessions/37491.json` has `kind: interactive`, `entrypoint: claude-desktop`, `procStart`, `cwd` and `messagingSocketPath: /tmp/cc-socks/37491.sock`, with no `tmux`.
- **Socket and key:** the socket is `srw-------`. The key is `~/.claude/sessions/37491.<hash>.key`, mode 0600, 108 bytes, with its value not read.
- **MCP:** the session's children include `~/.openbus/bin/dist/index.js mcp claude`, so the openbus server loaded. The strict-MCP path (#252) wasn't taken on this launch.
- **Attestation:** `npx @open-bus/cli status` shows the session as **probe-dir-dc**, live in namespace `probe-dir`. The adapter needed no changes.
- **Permission mode:** the app launched the session with `--permission-mode=auto`, not default.
- **Wake:** confirmed. A desktop session in auto mode (`probe-dir-e5`) received a bus message and replied without a click, so auto mode doesn't hold messages (#253). The other permission modes are still untested.

Updated verdict: **works**: discovery, attestation, MCP and wake were all confirmed live. Open gaps: #252 (the launcher path's strict MCP config) and #253 (permission modes other than auto).

## Run that would confirm it (needs a human click)

1. `mkdir -p ~/tmp/probe-dir`
2. Open Claude.app → **Code** tab → new **local** session (not SSH or cloud), folder `~/tmp/probe-dir`, permission mode **default** → send `hi` and let it go idle.
3. Then, read-only:
   - `ps -axo pid,ppid,command | grep -E 'claude|index.js mcp'`: expect Claude → [disclaimer] → claude → `index.js mcp claude`.
   - `python3 -I registry.py | grep Claude.app`: expect `entrypoint: claude-desktop` and a socket 0600 with a key.
   - `npx @open-bus/cli status`: expect the session listed under this machine.
   - From a terminal session, send it a bus message; it should answer without a prompt. Repeat once in **auto** mode to see whether the parity hold fires.

## Files

| file                          | what                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `bundle.txt`                  | app and CLI versions, paths, how the app launches a session                  |
| `process-tree.txt`            | Claude.app descendants, plus the terminal session baseline                   |
| `registry.py`                 | redacted `~/.claude/sessions` snapshot (no tokens, names, cwds or key names) |
| `registry.redacted.jsonl`     | its output: 22 live sessions, all `entrypoint: cli`, none under Claude.app   |
| `desktop-config.redacted.txt` | key shapes of the app's config and of `~/.claude.json` MCP                   |
| `static-evidence.txt`         | the shipped-code excerpts behind each answer                                 |
