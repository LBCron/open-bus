# Codex probe (C26), 2026-10-29

Can OpenBus support Codex, both the CLI and the desktop app? Four questions:
MCP, attestation, wake, kind. macOS arm64.

## Versions

- CLI: `@openai/codex` 0.165.0 (npm latest), installed into a scratch prefix
  and run by full path.
- Desktop app: `ChatGPT.app` (bundle id `com.openai.codex`, 26.917.51856). It
  is Electron and bundles its own `codex` binary (`codex-cli 0.155.0-alpha.16`)
  in `Contents/Resources/`.

## Method

- Every Codex run used a temp `CODEX_HOME`. The real `~/.codex` was only
  read: names, mtimes, field names, and `sqlite3 ... ?immutable=1`. Nothing
  under it changed during the probe, and `auth.json` was never opened.
- No credentials, no network. A temp `config.toml` set
  `[model_providers.stub]` (`wire_api = "responses"`,
  `requires_openai_auth = false`). It pointed at a scripted OpenAI Responses
  stub on 127.0.0.1. The stub calls the probe MCP tool when the prompt says
  `start`, calls `exec_command` when it says `shellprobe`, and otherwise
  answers with text.
- Probe MCP server: about 50 lines of node over stdio. It logs its argv, env
  keys, ppid and ancestor chain, and every message it receives. After a tool
  call it pushes `notifications/message`, `notifications/claude/channel`,
  `tools/list_changed` and a `sampling/createMessage` request.
- Harnesses driven:
  - `codex exec`.
  - The TUI, in a pty.
  - The shared app-server daemon (`codex app-server daemon start`), through a
    websocket client on its control socket.
  - A private stdio `codex app-server`, which is how the desktop app runs Codex.
- The desktop app was never launched. Evidence for it comes from static
  inspection of `app.asar` (its main-process JS), the bundled binary's
  `strings`, and the real `~/.codex`.
- All processes were mine and were stopped by pid.

## 1. MCP

**Loads.** `[mcp_servers.probe]` in `config.toml` (command, args, env) is
spawned and initialised:

- `clientInfo` is `codex-mcp-client` 0.165.0, protocol `2025-06-18`.
- The client capabilities are `elicitation` and experimental
  `codex/auth-change`; there is no sampling.
- Tools reach the model as a namespace `mcp__probe` holding `whoami`.
- By default a tool call is refused under `approval_policy = "never"` ("MCP
  tool call requires approval"). Our entry needs
  `default_tools_approval_mode = "approve"`.

**Env is filtered.** The server gets only `HOME LANG LOGNAME PATH SHELL TERM
TMPDIR USER __CF_USER_TEXT_ENCODING`, plus the `env` table from its entry.
There is no `CODEX_*` var, so not even `CODEX_HOME`. `env_vars = [...]` can pass
named vars through.

**Session identity arrives per call, not at spawn.** Every `tools/call` carries
`_meta`:

- Keys: `callId`, `itemId`, `progressToken`, `sessionId`, `threadId`,
  `windowId`, and `x-codex-turn-metadata`.
- `x-codex-turn-metadata` holds `session_id`, `thread_id`, `turn_id`,
  `thread_source` (`user`), `turn_trigger` (`exec`), `sandbox`,
  `workspaces` (an object keyed by root path) and `codex_version`. There is
  no `cwd` key.
- `initialize` carries no session.

**One MCP process per thread.** Two threads in one daemon spawned two probe
servers.

**Parent process:**

| Harness | MCP server's parent |
|---|---|
| `codex exec`, `--no-daemon` | the `codex` process itself |
| TUI | the shared daemon `codex app-server --listen unix:// --managed-daemon`; the TUI starts it if it is down |
| desktop app | the app's own `codex app-server` (bundled binary, stdio child of the Electron main process) |

The desktop row comes from static evidence only. The app spawns its bundled
`codex app-server` over stdio. It uses the shared daemon only when
`CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` is set.

**The app reads the same `~/.codex`:**

- Its JS resolves `${CODEX_HOME:-$HOME/.codex}`.
- The real `config.toml` has a `[desktop]` table that the app writes
  (`followUpQueueMode` and others), next to the user's `mcp_servers`. The app
  builds its MCP config from that file (`buildMcpCodexConfig`).
- `state_5.sqlite` `threads` holds rows with `originator = "Codex Desktop"`
  (source `vscode`), and their rollouts are under `~/.codex/sessions`.

So one `[mcp_servers.openbus]` entry reaches the CLI, the TUI and the app.

## 2. Attestation

**Codex's on-disk state:**

- Rollouts are at `sessions/YYYY/MM/DD/rollout-<ts>-<thread uuid>.jsonl`. The
  first line is `session_meta`, with keys `id session_id cwd originator source
  thread_source cli_version model_provider git timestamp ...`.
- `session_index.jsonl` has the keys `id`, `thread_name` and `updated_at`.
- `state_5.sqlite` `threads` has columns including `id`, `rollout_path`,
  `source`, `originator`, `cwd`, `archived` and `agent_path`. Subagent threads
  have a JSON `source` of `{"subagent":{"thread_spawn":{"parent_thread_id":...}}}`.
- `thread-writer-locks/<thread>.lock` is an empty file that the process
  hosting the thread holds open (flock). `lsof -t` on it returned exactly the
  `codex` process that is the probe MCP's parent: the exec process, or the
  daemon pid for all three daemon threads. The same process also holds the
  rollout open.

**A Codex shell command is a sibling of the MCP server.** `exec_command`
runs `/bin/zsh -c` as a direct child of the same `codex` process. The shell
gets `CODEX_THREAD_ID`, `CODEX_SESSION_ID` and `CODEX_TOOL_CALL_ID`; the MCP
server gets none of them.

**Proposed check.** The adapter defers its hello until its first `tools/call`,
then sends `{thread_id, call_id, pid}` from `_meta`. The daemon accepts only
when all of the following hold:

1. The adapter's parent P has a `codex` comm, and its start time matches the
   one recorded at hello. This is the pid-reuse guard, as for Pi and omp.
2. P holds `<codex home>/thread-writer-locks/<thread_id>.lock` (`lsof -t`; on
   Linux, `/proc/locks`).
3. That thread's rollout, which P holds open, contains an unanswered
   `function_call` with this `call_id` in the `mcp__openbus` namespace.
   Codex writes it before calling the tool: this was observed at call time.
   Only that thread's model can create the entry.
4. The thread is not a subagent: `thread_source` in `_meta` is `user`, and
   `state_5` `source` is not `{"subagent":...}`. This is the omp-style guard.

**How it can fail:**

- A process that is not P's child fails step 1. A replayed old `call_id`
  fails step 3.
- A shell in thread A of the same daemon or app cannot claim thread B without
  step 3. With step 3, it could only race an in-flight openbus call in B, and
  B's own adapter would then collide on the same ref.
- Without step 3, the multi-thread daemon and the app fall below Claude's bar:
  ppid plus lock alone lets any sibling thread claim any other.
- `lsof` costs about 50 to 100 ms. Do it once per hello, not per frame.
- The codex home must be known. The MCP env has no `CODEX_HOME`, so put it in
  the entry's `env`, or the daemon resolves `${CODEX_HOME:-~/.codex}`.
- Liveness: the daemon keeps a thread loaded (lock held) after the TUI exits.
  So "lock held" means "Codex has it loaded", not "a user is watching".

**Live capture (C26c), 2026-10-29.** `codex exec` 0.165.0, a temp
`CODEX_HOME`, the stub model calling `send_message` in namespace
`mcp__openbus`, and a stand-in server under `[mcp_servers.openbus]` that
copied the rollout the instant `tools/call` arrived. Redacted (cwd, base
instructions) and abridged (messages, token counts):

```jsonl
{"timestamp":"2026-10-29T01:11:43.878Z","ordinal":9,"type":"response_item","payload":{"type":"function_call","id":"fc_1","name":"send_message","namespace":"mcp__openbus","arguments":"{\"to\":\"peer\",\"text\":\"hi\"}","call_id":"call_1","internal_chat_message_metadata_passthrough":{"turn_id":"01a18536-7fa0-…"}},"metadata":{"client_authored":false,"user_input_order":1}}
{"timestamp":"2026-10-29T01:11:44.519Z","ordinal":11,"type":"event_msg","payload":{"type":"item_completed","thread_id":"01a18536-7f07-…","turn_id":"…","item":{"type":"McpToolCall","id":"call_1","server":"openbus","tool":"send_message","arguments":{"to":"peer","text":"hi"},"status":"completed","result":{"content":[{"type":"text","text":"sent"}]},…}}}
{"timestamp":"2026-10-29T01:11:44.521Z","ordinal":12,"type":"response_item","payload":{"type":"function_call_output","id":"fco_…","call_id":"call_1","output":[{"type":"input_text","text":"Wall time: 0.6365 seconds\nOutput:"},{"type":"input_text","text":"sent"}],…},"metadata":{…,"mcp_attribution":{"status":"complete","sources":[{"server_name":"openbus","tool_name":"send_message",…}]}}}
```

- **Flushed before the call.** The copy taken at `tools/call` already held the
  `function_call` line, complete and newline-terminated, and nothing for
  `call_1` after it. The daemon still reads once more after 50 ms when a call
  is absent.
- **The namespace is the entry name.** `mcp__openbus` comes from the table
  name, so the installer (C26e) must write exactly `[mcp_servers.openbus]`.
- **A call closes twice:** `item_completed` (with `item.id` = the call id)
  and then `function_call_output`. The daemon treats either as answered.
- `lsof -t` on the lock returned the MCP server's parent, the native `codex`
  binary (`…/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`), not
  the npm `codex` node shim above it.
- **macOS proves "open", not "locked".** `lsof -t` lists every process with
  the lock file open, whether or not it holds the flock. A same-user process
  whose executable is named `codex` can open `<thread>.lock` read-only and pass
  check 2 for any thread; only check 3 (a call id still open in its own
  turn, written after the process started, and never admitted
  before) stands in its way. Linux reads `/proc/locks`, so there the lock
  itself is checked.
- `state_5` `source` was the plain string `exec`. The fixture
  (`packages/daemon/test/fixtures/codex-rollout-*.jsonl`) is this capture.

**What the bar assumes.** All four checks read files under `CODEX_HOME`, so
they hold only while nothing but Codex writes there. A same-user process that
can write to `CODEX_HOME` can append a `function_call` to any rollout, point
`rollout_path` in `state_5` elsewhere, or replace a lock file. The daemon
refuses a symlinked lock or rollout, but cannot tell a forged line from a
real one. Codex's sandbox should keep `CODEX_HOME` out of the model's
writable roots under `read-only` and `workspace-write` (not verified here);
under `danger-full-access` (or `--yolo`) nothing does, and there the attestation is only as strong as
the user's trust in that thread. The other harnesses have the same same-user
limit: the daemon has no peer credentials, so `hello.pid` is a claim, which
is why a codex connection is bound to its one call.

**Code mode (C27, #343), 2026-11-01.** Codex chooses code mode per model
(`tool_mode: "code_mode_only"` in the model catalog, on by ~0.145 for newer
models; or `[features] code_mode_only`), so the CLI and TUI use it too, not
only the desktop app. The model then emits a `custom_tool_call` named `exec`
whose JavaScript calls `tools.<name>(…)`, and every OpenBus call is a nested
`tools/call`. Source: openai/codex `rust-v0.166.0-alpha.5.1`
(`.superpowers/sdd/05-client/c27-probe-report.md`).

- `_meta.callId` is a fresh `exec-<uuid>` per nested call. The rollout never
  has it at request time; Codex writes it only afterwards, as the
  `item_completed` `McpToolCall` item id.
- `_meta.itemId` is the outer `exec` line's `payload.id` (`ctc_…`), written
  to the rollout before dispatch, as a `function_call` is. It is the binding.
- One exec can make many calls, and they share one `itemId`.

The adapter sends `item_id` (`_meta.itemId`) and `turn_id` (the turn
metadata's) in the hello. When no open `function_call` matches `call_id`, the
daemon accepts only if all of the following hold (steps 1, 2 and 4 above are
unchanged):

1. The rollout has a `response_item` `custom_tool_call` with `payload.id ==
   item_id`, `name == "exec"` and no `namespace`.
2. Its turn (`internal_chat_message_metadata_passthrough.turn_id`) is the
   hello's `turn_id` and the thread's latest: the last `task_started` turn
   that has not ended.
3. It is open: no `*_output` or `*_end` for its `call_id`, and its turn has
   not ended.
4. Its timestamp is at or after P's start + 1 s.
5. `call_id` matches `^exec-[0-9a-f-]{36}$`, has not been used, and Codex has
   not reported it done (`item_completed`); `item_id` has not been used.

One hello per exec: a second OpenBus call in the same exec is refused with
"this exec already made an OpenBus call. Make each OpenBus call in its own
exec." This keeps the strength at one use per model-written item, as with a
`function_call`.

**Residuals (code mode):**

- Refused, by design (fail closed): a second OpenBus call in one exec; a call
  after the exec yielded (`yield_control()`, the yield timeout) or after
  `notify()` wrote an output for it, since the exec then reads as closed; a
  call resumed by `wait` in a later turn; a turn whose `task_started` is more
  than 8 MB back in the rollout (no latest turn is known).
- An exec's `input` naming `mcp__openbus__` would narrow further, but it is
  not checked: dynamic names (`tools[name]`, `ALL_TOOLS`) never spell it.
- Single use is per daemon lifetime, as for `call_id` today.
- The e2e (`pnpm e2e:codex`, "codex exec in code mode") switches 0.165 into
  code mode with `-c features.code_mode_only=true`; the fake model emits the
  `exec` calls.

## 3. Wake

**`codex queue --thread <id> --message <text>` wakes an idle thread.** It
writes `queue_1.sqlite` (`queued_items`; a trigger bumps
`queued_thread_revisions`). The process hosting the thread sees the change
(`thread/queue/changed`) and starts a turn with that text as the user message.
Observed:

| Host | Idle thread, after `codex queue` |
|---|---|
| shared daemon (the TUI's host) | turn started within 1 s; the stub got the queued text |
| TUI attached to the daemon | same; the TUI rendered the turn and its reply |
| private stdio app-server, no daemon running (how the app runs) | turn started; the stub got the text |
| `codex exec`, after exit | stored in `queue_1.sqlite`, no turn: delivered on the next resume |

So:

- **TUI:** a real wake, like Claude channels.
- **exec:** no wake. It is one-shot, so a message waits for a resume.
- **App:** a wake is expected, because its bundled 0.155 alpha binary has
  `codex queue`, `queued_thread_revisions` and `thread/queue/changed`. This was
  not observed live, since the app was not launched. The app's
  `followUpQueueMode` (`queue`, `steer` or `send-now`) governs only prompts
  typed during a running turn.

The daemon transport would shell out to the user's own `codex queue` (or write
`queue_1.sqlite` the same way). A message sent mid-turn waits for the turn to
end.

**Ruled out:**

- MCP pushes. `notifications/claude/channel` and `notifications/message` are
  ignored, and `sampling/createMessage` returns -32601.
- `thread/inject_items` adds items without starting a turn.
- `notify` runs only after a turn completes.
- Hooks (`SessionStart`, `Stop` and others) run only inside a turn.
- App-server `turn/start` from a second client on the daemon socket does wake
  the thread, but the app's private stdio app-server has no socket. `codex
  queue` covers both.
- The app's own IPC bus (`~/.codex/ipc/ipc.sock`, with
  `thread-follower-start-turn` and similar messages) is private and
  undocumented. It was not used.

**C26d check (2026-10-29, CLI 0.165.0, temp `CODEX_HOME`, stub model).** A
first cut of the daemon's `CodexTransport` ran `codex queue` for a thread made
by `codex exec`, with a hostile body. (The shipped transport runs `codex
queue` only for a live thread whose host wakes; an exec or closed thread gets
no `codex queue` and keeps the offline semantics, so no receipt says less
than what Codex will do.)

- One row in `queued_items`, text exactly as sent: the `[openbus] Message
  from peer to you (cx). … (msg_id mmmmmmmmmmmmmmm1)` header, the body's
  `$(touch …)` and backticks literal (no file created), and a forged
  `[openbus]` body line escaped as `\[openbus]`. A second delivery of the
  same msg_id ran nothing (the daemon's `codex-queued.json`).
- `codex exec resume <thread> "second prompt"` started a turn with the queued
  text first: the stub's request carried it as a user message, before the new
  prompt; `queued_items` was then empty.
- `--message -` is taken literally (a turn with the text `-`): `codex queue`
  has no stdin or file input, so the text goes in argv. **Other local users
  can see the message text in `ps` for the queue command's lifetime** (a
  fraction of a second; at most its 10 s timeout). **Accepted by the user
  (2026-10-29)**: the only alternative is writing Codex's `queue_1.sqlite`
  directly, which D2 ruled out.
- `--thread=<ref>` and `--message=<text>` keep a value that starts with `-`
  a value: `--thread=--help` is looked up as a thread, and
  `--message=--help\n…` was queued verbatim.
- Not re-run here: the wake of a live host (§3's table covers it) and an
  end-to-end send through the real daemon from a second agent.

## 4. Kind

Readers have been kind-agnostic since 0.45.0: `KindTokenSchema` and
`displayKind` turn an unknown kind into `other`. So `codex` needs no new
version constant:

- The hub already hides any kind outside `PRE_TOKEN_KINDS` from daemons below
  `KIND_TOKEN_MIN_CLIENT` (the SQL filter).
- For adapters without the IPC marker, the daemon already rewrites any unknown
  kind to `pi` (`legacyKind`, C23c).
- What does change: `AGENT_KINDS` gains `codex` (the writer enum for `hello`
  and `agent_up`), and the daemon's fallback for an old hub that answers
  `agent_up` with `bad_frame` must cover codex too. Today that fallback is
  `ompAsPi` and is hard-wired to omp.

**Recommendation:**

- Old daemons: hidden, as today, through the hub filter. Their closed enum
  cannot hold `other`.
- Old adapters: show `codex` as `pi`, the existing `legacyKind`. The row stays
  addressable by name, which was C23c's reason. Hiding it would make a Codex
  agent unreachable from old sessions, and `other` is not in their enum. `pi`
  is a wrong label for Codex: it is the nearest kind only by default, not by
  lineage. The doc comment on `legacyKind` should say so.
- Old hubs: generalize `ompAsPi` to any kind the hub refuses, so codex
  registers as `pi` there.

## Open decisions (user)

1. **Attestation strength.** Ship with check 3 (rollout `call_id`), or accept
   ppid plus lock only? Without check 3, in the daemon and the app, one thread
   can claim another.
2. **Wake via `codex queue`.** OpenBus would invoke the user's installed
   `codex` binary, or write `~/.codex/queue_1.sqlite` directly. Both depend on
   an experimental, unversioned interface.
3. **Approval.** Is it acceptable for our installer to set
   `default_tools_approval_mode = "approve"` on the openbus entry? Without it,
   every bus tool call prompts, and calls fail under `never`.
4. **Desktop app.** Accept the static evidence, or have the user run the app
   once with the openbus entry so we can confirm the parent process and the
   queue wake live?
5. **Label for old adapters:** `pi`, or hide `codex` from them?
