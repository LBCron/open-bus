# omp live probe (C23b), 2026-10-25

The real oh-my-pi (`omp` 18.12.6, bun) loading the OpenBus omp extension,
against a real daemon (`runDaemon`, real attest, version 0.45.0) and the
in-process fake hub (`e2e/staging/fake-hub.ts`). macOS arm64.

## Isolation

- Temp `HOME`, `OPENBUS_HOME` and `PI_CODING_AGENT_DIR`; the agent dir held only
  `extensions/openbus.ts` (runs 1-2: a build with a stamped kind switch, since
  replaced; run 3: the shipped file as is, `stampPi(asset, "0.45.0")`)
  and a `models.yml`.
- No credentials, no network: `models.yml` named one provider, `stub`
  (`api: openai-completions`, `auth: none`), served by a scripted
  OpenAI-compatible stub on 127.0.0.1 in the driver process.
- One run: `omp -p --model stub/stub-1 --no-session --no-title --no-lsp
  --auto-approve "start"`, spawned by the driver, exit 0, then the daemon, hub
  and stub stopped. No process left behind; the real `~/.omp`, `~/.openbus` and
  the user's daemon untouched.

## The stub's script

Every session (root or subagent): call `self`; then `task` with one item; then
`wait`; then answer text. omp adds a required `i` ("intent") string to every
tool's parameters; the stub sends it, and our tools ignore it.

## Results

1. **Plain JSON-Schema `parameters` load.** The first model request listed
   `list_agents`, `send_message`, `fetch` and `self` as top-level tools
   (`loadMode: "essential"`; omp's default would have left them discoverable),
   each with our schema plus omp's `i`. Example, as sent to the model:

   ```json
   "send_message": {"type": "object", "properties": {"i": {"type": "string",
     "description": "concise intent"}, "to": {"type": "string"}, "text":
     {"type": "string"}, "to_namespace": {"type": "string", "description":
     "The recipient's namespace, when a global agent's target name exists in
     several."}}, "required": ["to", "text", "i"], "additionalProperties": false}
   ```

2. **`session_start` fires.** The root session said hello as `omp` and was
   attested by `ps -o lstart=` on the bun process. The root's `self` returned:

   ```json
   {"name": "omp", "namespace": "omp-probe", "kind": "omp", "live": true, "global": false}
   ```

   The hub registered one agent, `kind: "omp"`, name `omp` (no session name).

3. **The subagent guard holds.** `task` spawned a subagent in the same process
   (`AlternativeBobcat`), which spawned its own (`AlternativeBobcat.DeterminedWombat`).
   Both had our tools (omp rebinds extensions per subagent), and each one's
   `self` call returned, verbatim:

   ```
   openbus: a subagent is not on the bus; only the main omp session can use OpenBus
   ```

   Sampled every 100 ms while omp ran, the hub never held more than the one
   root agent, and at the end the daemon's table held one record (the root's
   ref). Both subagents completed; when omp exited the daemon closed the root
   agent (`live: false`).

## Every session_start, observed

A second run added a probe-only extension (beside ours) that logged each
`session_start` and `session_shutdown` with `ctx.sessionManager.getSessionId()`,
`process.pid`, `ctx.agent` and `ctx.mode` (`print`). Session ids and the pid
are shortened here; all six events came from one and the same process:

```
session_start     <root>   pid P  agent {kind: main, id: Main,                     name: main, depth: 0}
session_start     <sub-1>  pid P  agent {kind: sub,  id: GoverningPanda,           name: task, depth: 1, parentId: Main}
session_start     <sub-2>  pid P  agent {kind: sub,  id: GoverningPanda.HappyGoat, name: task, depth: 2, parentId: GoverningPanda}
session_shutdown  <sub-2>  pid P  agent {kind: sub, ... depth: 2}
session_shutdown  <sub-1>  pid P  agent {kind: sub, ... depth: 1}
session_shutdown  <root>   pid P  agent {kind: main, ... depth: 0}
```

So each `task` subagent fires its own `session_start`, with a new session id
and the root's pid, and `ctx.agent.kind` tells the root (`main`) from a
subagent (`sub`, with `parentId`). Subagents also fire `session_shutdown`
before the root does. The guard therefore skips both events for `sub`; if it
didn't, a subagent's shutdown would close the root's link whenever omp hands
both to one instance. The hub held only `<root>` (kind `omp`) in this run too.

The marker used is `ctx.agent.kind === "sub"`
(`src/extensibility/extensions/types.ts:520-537`, set at `src/sdk.ts:3499`
from `isSubagentSession`, `src/sdk.ts:2198`).

## Run 3: one file, kind told at load (fix round 1)

The extension now picks its kind when it loads: omp's extension API has
`arktype` (its omptype builder, `ConcreteExtensionAPI` in omp's
`src/extensibility/extensions/loader.ts:182`, typed at `types.ts:1636`), and
Pi's has none. Run 3 used the very file Pi gets, unchanged. Same script, same
results: the four tools were top-level (`loadMode: "essential"`), the root said
hello as `omp` (its `self`: `"kind": "omp"`), the same six session events came
from one pid with `ctx.agent` `main` / `sub` (depth 1 and 2), both subagents got
the guard error, and the hub held only the root, kind `omp`.

Run 4 (fix round 2), same script: the kind now comes from `ctx.agent` at
`session_start`, and `loadMode` from the three builders omp's loader injects
(`arktype`, `zod`, `typebox`). The results matched run 3: tools were top-level,
the root was `omp`, both subagents got the guard error, and the hub held only
the root.

