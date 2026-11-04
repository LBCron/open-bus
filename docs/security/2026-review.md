# Security review, 2026 (I8)

The adversarial pass before the first prod install (06-integration I8 Step 3). There were three reviews, each briefed: *"Your job is to break this. Find inputs, sequences, or environments where it fails, leaks across namespaces, spoofs identity, double-delivers, or contradicts the spec. Write the failing test for each finding."* Each finding went to the lead who owns the code, and each fix lands with the test that pins it.

**Totals:** 0 critical, 1 high, 11 medium or important, 18 low. Every finding is fixed except R2, a low that is accepted, and C19, which is pending.

## Hub and auth (Backend, whole-server review of main at bb7e75b)

| id | issue | severity | fix | pinning test |
|---|---|---|---|---|
| M1 | Closed agent rows grow without bound under ref churn | medium | #207 | hub.final-hub "M1: closed agents are purged once idle, and capped per machine" |
| M2 | The revoke drain scanned the whole closed-agent history | medium | #207 | hub.final-hub "M2: the revoke drain is driven from agents with work" |
| R1 | At the cap, the idle search only checked the 50 oldest closed agents | low | #207 | hub.final-hub "R1: at the cap, an idle closed agent past the 50 oldest is found" |
| W1 | `/hub` called `verifyToken` with no rate limit | medium | #203 | final-worker "W1: GET /hub is rate-limited per client before the hub" |
| W2 | OIDC state was stored before redeem, so code-less callbacks could fill the cap | medium | #203 | signin "W2: the OIDC state is stored only after redeem succeeds" |
| L1 | `roster()` counted replaced or closing sockets as live | low | #207 | hub.final-hub "L1: roster state counts only open, current sockets" |
| R2 | A purged name answers `unknown_agent` 24 h after close or revoke | low | accepted, documented in CONTRACT.md (#207) | none |
| flake | The b11 eviction mid-drain test ran on the wall clock | low | #207 | hub.b11 "an eviction mid-drain still finishes…" |
| W3 | CONTRACT.md said logout needs `X-OB-Request` | low | #203 | docs only |
| W4 | `/hub` refusals came back as plain text | low | #203 | final-worker "W4: /hub refusals from the hub get the JSON envelope" |
| W5 | No HSTS and no SPA CSP | low | #203, #216 | final-worker "W5: HSTS outside dev, enforcing CSP on the SPA" |

These were re-tested on merged main, and all held:
- **from_ref spoofing:** a spoofed ref gets `not_registered` (`hub.from_ref`).
- **Token hashing:** tokens are stored only as SHA-256 (`hub.machines`, `device`).
- **Revoke races:** the right behaviour holds (`hub.revoke`, M2).
- **Device-code brute force:** RL_DEVICE limits per IPv4 address or IPv6 /64, each client may hold 5 live codes inside a global cap of 100, failed approvals are capped, codes use a 32-character alphabet, and errors don't reveal whether a code exists (`device`).
- **CSRF on approve:** an HMAC form token bound to the code, uid and gen, a 10-minute TTL, a same-origin check, and `Origin: null` refused (the `device` CSRF matrix, `machines` "Origin null").

## Client (Client, daemon and CLI)

| issue | severity | fix | pinning test |
|---|---|---|---|
| A stale revoked marker blocks a newer valid token after `login` | important | #224 | client.i8.test.ts "stale revoked marker"; hub.test.ts "revoke paths…" |
| A repo's `.openbus.json` `global: true` widens an untrusted clone | important | C19 (global is honoured only from the user's allowlist) | C19's tests |
| The CLI dials the short socket folder without checking it (another uid could pose as the daemon) | minor | #224 | socket-dir.i8.test.ts |
| `.openbus.json` is checked and read in separate lookups (symlink-swap TOCTOU, FIFO hang) | minor | #224 | namespace.i8.test.ts |
| Any 403 at the `/hub` upgrade was treated as a permanent revoke | minor | #224 | hub.test.ts "an upgrade answered 403 is transient…" |
| A machine.json without `hub` sends the token to OPENBUS_HUB | minor | #224 | client.i8.test.ts "no hub" |
| An unreadable nested session file lets an outer Claude session be claimed | minor | #224 | client.i8.test.ts "unreadable session file" |
| Claude's socket folder isn't checked before peerToken and body injection | minor | #224 | client.i8.test.ts "claude socket folder" |

These areas came back clean: pid reuse, OpenCode `_meta`, and the C16 resend id.

## Install and CI (Platform, setup, CI secrets and the install doc)

| id | issue | severity | fix | pinning test (scripts/setup/test or scripts/ci adversarial-i8.test.ts) |
|---|---|---|---|---|
| I8-01 | `--destroy` after a failed first run force-deleted a Worker setup never deployed | high | #222, #223 | "I8-01 --destroy after a failed first run does not delete a Worker setup never deployed" |
| I8-03 | A first install overwrote an existing non-OpenBus Worker named `--name` | medium | #222, #223 | "I8-03 …", "I8-03b … holds no secrets", "I8-03c a foreign Worker and a run that fails at secrets: destroy leaves the Worker and says why", "I8-03d …" |
| I8-04 | `--ci`: a new Access app whose secret bulk failed was reported done on the rerun (stale secret) | medium | #222 | "I8-04 …" |
| I8-08 | deploy-staging exposed CLOUDFLARE_API_TOKEN to `pnpm install` and build | medium | #222 | "I8-08 deploy-staging: pnpm install/build (dependency scripts) never see CLOUDFLARE_API_TOKEN" |
| I8-09 | Tag checkouts without `refs/tags/` could be shadowed by a branch of the same name (prod token, npm) | medium | #222 | "I8-09 release-please: tag checkouts use refs/tags/…" |
| I8-11 | prod-setup.sh scratch modes accepted the staging name and host | medium | #222 | "I8-11 scratch-install and scratch-destroy refuse the staging Worker name and host" |
| I8-02 | Destroy put API-provided domain ids into the DELETE path without encoding them | low | #222 | "I8-02 a crafted custom-domain id cannot turn destroy into a DELETE of another Worker" |
| I8-05 | The selftest followed redirects on `POST /device/code` | low | #222 | "I8-05 selftest does not follow a redirect on POST /device/code" |
| I8-06 | An invalid `--host` (a mis-pasted token) was echoed in the error | low | #222 | "I8-06 an invalid --host value (a mis-pasted token) is not echoed" |
| I8-07 | `--upgrade` with no existing instance did a full fresh install | low | #222 | "I8-07 --upgrade with no existing instance refuses instead of creating one" |
| I8-10 | deploy-prod inherited the workflow's write scopes while the prod token ran | low | #222 | "I8-10 release-please: deploy-prod … runs with contents: read…" |

The review also checked one case it couldn't make fail: destroy after the login has switched to another account. Setup uses the account saved in state and asks for action rather than deleting.

The I7 staging harness found two more items while running against B4: approval must be a same-origin form POST, and unsafe REST calls must send `Origin`. Both are correct server behaviour; the fix was harness-only (#214).

## Accepted

- R2 (low): a purged agent name answers `unknown_agent` 24 h after its close or revoke. It's documented in CONTRACT.md.
- The only open item is C19, which closes when its PR merges.
