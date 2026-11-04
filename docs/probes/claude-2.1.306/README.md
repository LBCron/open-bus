# Claude Code 2.1.306 UDS probes

Measured 2026-10-21 against a real headless Claude Code **2.1.306** (arm64,
`claude-haiku-4-5-20251001`, `--settings '{"crossSessionInbound":"accept"}'`).
These are the C1a probes behind `docs/superpowers/plans/2026-10-21-openbus/05-client.md`.

## What they run

All three start a headless peer with stdin held open (`--input-format stream-json`),
wait for `~/.claude/sessions/<pid>.json`, and read its `peerToken` from the
sibling `.key`. Nothing is installed on Claude's side.

| script | question | evidence |
|---|---|---|
| `probe.mjs` | Does a native `SendMessage` reply reach a return socket with **no** session file? | `return-socket.evidence.json` |
| `status-probe.mjs` | Does plain delivery produce `peer_message_status`? | `status.evidence.json` |
| `wake-probe.mjs` | Does injection alone start a turn, with no tick prompt? | printed |

Run from this directory with `node probe.mjs`, etc. Each needs an authenticated
`claude` on `PATH` and writes/removes only its own `~/.claude/sessions` entries
(`control` variant only).

## Results

`probe.mjs`, three variants against one peer:

| variant | files in `~/.claude/sessions` | connected | native reply | auth first | status-back |
|---|---|---|---|---|---|
| bare | none | yes | yes | no | no |
| key-only | `.key` only | yes | yes | no | no |
| control | `.key` + `.json` | yes | yes | no | no |

- **Bare wins.** Claude dials an arbitrary `from=uds:<path>` anonymously and
  delivers its reply as a `type:user` frame from its own socket. No session
  file, no key file, nothing visible in `ListAgents`.
- **No `peer_message_status` on plain delivery.** `status-probe.mjs` got zero
  frames in 60 s for a message the peer was told not to answer. The binary
  emits that frame only from the hold-receipt path (`held`, `denied`, `expired`,
  `delivered`-after-held, `refused`, `dropped`).
- **Injection wakes an idle session.** `wake-probe.mjs` measured a native reply
  in **4.0 s** with no tick prompt; the frame itself starts the turn.

## Consequence for OpenBus

The daemon writes the frame, waits **2 s** for a hold status, and acks on
silence. `held` stays pending and acks only on `delivered`; `denied`,
`refused`, `expired` or `dropped` is a refused receipt (`closed`), never an ack.
`wake-probe.mjs` shows no keep-alive ticker is needed.

`agent-bus/docs/UDS-protocol.md` predates this: its status-back ack rule is
stale as of 2.1.306. The auth-first frame, the user-frame shape, the half-close
and "never write on the inbound connection" still hold.
