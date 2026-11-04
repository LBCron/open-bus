# Live probes, 2026-10-24

Measured on macOS arm64 against **Claude Code 2.1.310** and **OpenCode 2.0.32**
(`~/.opencode/bin/opencode`). Each probe starts its own processes, touches only
them, and kills them by PID.

| script | probe | evidence |
|---|---|---|
| `claude-reply-probe.mjs` | L1: the frame a native Claude reply puts on a return socket | `claude-reply.evidence.json` |
| `opencode-probe.mjs` | L2: `session.prompt` id idempotency, 409 and 404 output; L3: `ps -o comm=` | `opencode.evidence.json` |
| `opencode-replay.mjs` | L2: the captured outputs replayed through `OpenCodeTransport` | `opencode-replay.evidence.json` |
| `plist-probe.mjs` | L4: the rendered launchd plist through `plutil -lint` | `plist.evidence.json` |

Run `plist-probe.mjs` and `opencode-probe.mjs` with `node`; the other two import
workspace TypeScript, so run them from the repo root with `node_modules/.bin/jiti`.

## Isolation

- **Claude:** real HOME (it holds the credentials). One headless peer
  (`--model haiku`, `--tools SendMessage --allowedTools SendMessage`, no bypass
  mode). Only that PID's `~/.claude/sessions` entries are read; Claude removed
  them itself on exit.
- **OpenCode:** `opencode serve` on its own port with temp `HOME`, `XDG_*`,
  `TMPDIR` and its own `OPENCODE_PASSWORD`; every `opencode api` call passes
  `--server`. The background service and the user's config are never touched.
  With no credentials the server still ran the agent loop on OpenCode's free
  `big-pickle` model for the first prompt (seen in `listA`).

## Results

**L1, Claude reply frame: match.** One `type:"user"` frame on one connection,
no control frames, no auth line:

| field | seen | `transports/claude.ts` wants |
|---|---|---|
| `type` | `"user"` | `"user"` |
| `from` | `uds:/tmp/cc-socks/<pid>.sock` | the session's `uds:<messagingSocketPath>` |
| `message.content` | string, `<cross-session-message from="uds:<its socket>" hop-chain=… from-name="peer-64" from-mode="prompting">\nBODY\n</cross-session-message>` | a string matching the wrapper regex |
| `msg_id` | a fresh UUID, not the injected id | unused |
| others | `msgV:1`, `priority:"next"`, `message.role:"user"` | unused |

The real `ClaudeTransport` delivered (`{ok:true}` on silence) and `onReply`
fired with `alice`, `default`, body `OPENBUS-L1-TRANSPORT`.

**L2, OpenCode prompt ids: idempotent.** For `msg_openbus_<16 base58>_<ses>`
with `delivery:"queue"`:

- Same id twice, then again with other text: all exit 0, each returns the
  first record (original text). One copy in messages + inbox.
- Four concurrent calls with a fresh id: all exit 0, one copy (queued in the
  inbox behind the running turn).
- Same id in another session: exit 1, stderr `HTTP 409 Conflict`, stdout
  `{"_tag":"ConflictError","message":"Prompt message ID conflicts with an existing durable record: <id>","resource":"<id>"}`.
  No copy in that session. A same-session race never produced a 409.
- Missing session: exit 1, stderr `HTTP 404 Not Found`, stdout
  `{"_tag":"SessionNotFoundError","sessionID":"<ses>","message":"Session not found: <ses>"}`.
- Malformed session id: exit 1, stderr `HTTP 400 Bad Request`, stdout
  `{"_tag":"InvalidRequestError","message":"Invalid session ID","field":"sessionID"}`.

Replayed through `OpenCodeTransport`: repeat → `ok`; the 409 naming our id →
`ok` (`heldAlready`); 404 → `closed` (`goneSession`); 400 → `timeout`.
All as the code intends. The 409 path is reachable only by an id collision
across sessions, which the `_<ses>` suffix rules out.

**L3, process name: match.** `ps -o comm=` gives
`~/.opencode/bin/opencode` for both `opencode serve` and the TUI
(`opencode --server …`, on a pty); `basename` is `opencode`. The npm and bun
installs are not present locally and were not installed. Note: `ps -o comm=,args=`
truncates `comm` to 16 characters; `attest.ts` asks for `comm=` alone, which is
untruncated.

**L4, plist: `plutil -lint` OK** for the default home and for a home with
spaces and `<>&'"`. Side finding: when the home does not exist yet and its path
crosses a symlink (`/var` → `/private/var`), `ensure()` boots out
`…daemon.725e84c4` but writes `…daemon.6891873c`: `serviceNames()` hashes the
resolved path, which changes once `installCli` creates the home. Only a first install
hits it, when nothing is loaded yet: low impact.
