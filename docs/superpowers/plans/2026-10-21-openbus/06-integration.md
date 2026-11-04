# OpenBus Implementation Plan: Integration, install, release, prod (track I)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the tracks' pieces to a shipped product: an instance installer (`@ob/setup`), a real staging instance at `staging.open-bus.ai`, spec scenarios 1–7 proven, `open-bus` on npm, the landing at `open-bus.ai`, and the user's own instance at `bus.leourbina.com` installed through `llms.txt`.

**Architecture:** `scripts/setup` (`@ob/setup`) is OA's step runner cut down to OpenBus's one Worker: prereqs → access → secrets → deploy → healthcheck → selftest. It is the only thing that creates an instance. Staging, prod and every stranger's install run it. CI wraps it (`scripts/ci/prod-setup.sh`) for prod and keeps the plain `wrangler deploy` for staging. The scenario suite drives real daemons (`open-bus daemon`, each with its own `OPENBUS_HOME`, i.e. its own machine token) against staging through protocol-level fake harness sessions; scenario 1 additionally runs once with real Claude Code and OpenCode sessions.

**Tech stack:** Node 22 (`--experimental-strip-types`, no build step for `@ob/setup`, as OA), vitest, the Cloudflare REST API and `wrangler`, GitHub Actions, npm with provenance.

**Spec:** `docs/superpowers/specs/2026-10-21-openbus-design.md`, read with `00-overview.md`. Copy source: `~/code/projects/openartifacts` @ `ffba1e53` (`scripts/setup`, `scripts/ci/prod-setup.sh`, `scripts/ci/verify-release.ts`, and the plan `docs/superpowers/plans/2026-10-18-open-artifacts/05-integration.md`).

**Owner:** OpenBus Platform. The manager (`openbus-e0`) verifies I6–I9. A fix found here goes to the owning track's lead with a failing test; Platform does not edit another track's package (00-overview §Coordination).

## Global Constraints

- One Worker per instance. Its only resources: the Worker, its `Hub` Durable Object (migrations in `wrangler.jsonc`), one custom domain, one Access SaaS app. No D1, KV, R2 or Queues (spec §Architecture).
- Hosts **[user]**: landing `open-bus.ai`, staging Worker `open-bus-staging` at `staging.open-bus.ai`, prod Worker `open-bus-prod` at `bus.leourbina.com`.
- Worker config (02-backend B11 `wrangler.jsonc`): vars `ENVIRONMENT=production`, `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_CLIENT_ID`, `APP_HOST` (no scheme), `VERSION`; secrets `ACCESS_CLIENT_SECRET`, `SESSION_SECRET` (≥ 32 chars).
- Setup output: one JSON line per step, `{"step","status","message","data"}`, `status ∈ ok | skipped | action_required | error`; exit 0 all done, 2 action required, 1 error. It stops at the first non-ok. With `--json` it never prompts.
- No token, `ob_machine_…` value or secret ever appears in setup output, CI logs or an issue. Tokens arrive in files under `~/.openbus/` (0600) or env, never as flags.
- The user only approves in a browser (spec Goal 3). Every other step is the agent's.
- Releases: release-please manifest mode, continuous from `0.1.0` (the cadence cuts them); M3 is the **first npm release**, at whatever version is current; npm package `open-bus`; `/healthz` reports `{version}`; prod deploys stable tags only.
- Workers Free: every request under 10 ms CPU (00-overview §Global Constraints).

## Review Focus

1. **Rerunning setup on an existing instance.** An agent reruns the install, or CI runs `--upgrade`. Expected: every resource step `skipped`, the Access app and `SESSION_SECRET` are kept (rotating the secret logs every user out and orphans nothing else; a new Access app breaks login). Pinned in I2 (`access.test.ts` "adopts the existing app by name") and I3 (`secrets.test.ts` "never rotates an existing SESSION_SECRET").
2. **A host that is not on the account.** `--host bus.example.com` where the zone is missing or on another account. Expected: `action_required` naming the zone before any write; nothing half-created. Pinned in I3 (`deploy.test.ts` "refuses a host whose zone is not on the account").
3. **Pointing at the wrong instance.** Staging CI or a scratch run given `open-bus-prod` or `bus.leourbina.com`. Expected: refused before any write. Pinned in I4 (`prod-setup.test.ts` "scratch and staging refuse the prod name or host").
4. **A stranger with several Cloudflare accounts.** `wrangler whoami` lists more than one. Expected: `action_required` asking for `--account-id`, never a guess. Pinned in I1 (`prereqs.test.ts` "asks for --account-id when several accounts").
5. **Secrets leaking into output.** A token in an API error body, or `wrangler` echoing a secret. Expected: scrubbed to `***` on every line. Pinned in I1 (`json.test.ts` "scrubs every secret env value and ob_machine_ token").

---

## File structure

```
scripts/setup/                     @ob/setup (I1–I3), copied from OA and cut down
  package.json  vitest.config.ts  token-page.html
  src/index.ts                     flags, STEPS, JSON-line output, exit codes
  src/step.ts  src/cf.ts  src/state.ts  src/token-files.ts  src/token-page.ts   OA copies
  src/steps/{prereqs,access,secrets,deploy,selftest}.ts
  test/{fakes,world}.ts  test/*.test.ts
scripts/ci/prod-setup.sh (+ .test.ts)        I4
scripts/ci/staging-smoke.sh                  I4 (adds the device check)
scripts/ci/verify-release.ts (+ .test.ts)    I5 (npm + healthz + llms.txt)
.github/workflows/{deploy-staging,release-please}.yml   I4, I5, I6
e2e/staging/                                 I7, I8: scenario suite
  harness.ts  scenarios.test.ts  vitest.config.ts
docs/ops/{staging,prod}.md                   I4, I9
docs/security/2026-review.md                 I8
```

`e2e/staging` is a root vitest project, excluded from `pnpm test` (it needs staging and a machine token) and run by `pnpm e2e:staging`.

---

### Task I1: `@ob/setup` runner and prereqs

**Files:**
- Copy from OA `scripts/setup`: `src/step.ts`, `src/cf.ts`, `src/state.ts`, `src/token-files.ts`, `src/token-page.ts`, `token-page.html`, `test/fakes.ts`, `test/world.ts`, `vitest.config.ts`. Replacement table: `oa` → `ob`, `@oa/` → `@ob/`, `.open-artifacts` → `.openbus`, `OA_ACCESS_TOKEN` → `OB_ACCESS_TOKEN`, `oa_pat_` → `ob_machine_`.
- Create: `scripts/setup/package.json` (`@ob/setup`, private, `"start": "node src/index.ts"`, `"test": "vitest run"`), `src/index.ts`, `src/steps/prereqs.ts`
- Modify: root `package.json` adds `"ob:setup": "pnpm --filter @ob/setup start --"`
- Test: `scripts/setup/test/{json,prereqs,framework}.test.ts`

**Interfaces:**
- Produces: `type Opts = { name: string; host: string; ownerEmail: string; accountId?: string; json: boolean; upgrade: boolean; check: boolean; ci: boolean; destroy: boolean }`; `type Step = { name: string; check(ctx): Promise<boolean>; run(ctx): Promise<StepResult> }` (OA's shape); `STEPS: Step[]` in `src/index.ts`; `ctx.state` persisted at `~/.openbus/setup-<name>.json`.
- Flags: `--name` (`^[a-z0-9-]+$`, default `open-bus`), `--host` (FQDN), `--owner-email`, `--account-id`, `--json`, `--upgrade`, `--check`, `--ci`, `--destroy`, `--yes-destroy=<name>`, `--token-links`. DROP from OA: `--content-host`, `--solo/--team`, `--yes-paid`, `--plan`, `--browser`, `--email-domain`, `--no-email`, every D1/R2/KV/email/owner-token/agent-config step, `plan.ts`, `by-name.ts`, `rollback.ts`, `tunables.ts`.

- [ ] **Step 1: Write the failing tests.** `json.test.ts`: "prints one JSON object per line with step, status, message"; "exits 0 / 2 / 1 for ok / action_required / error"; "scrubs every secret env value and ob_machine_ token" (set `CLOUDFLARE_API_TOKEN=tok-123` and make a fake step return a message containing `tok-123` and `ob_machine_` + 32 base58; expect both replaced by `***`). `prereqs.test.ts`: "fails on Node < 22"; "asks the user to run npx wrangler login when whoami has no accounts" (`action_required`, message contains `npx wrangler login`); "asks for --account-id when several accounts" (`action_required`, `data.accounts` lists ids and names); "rejects an invalid --host or --name before any API call". `framework.test.ts`: "stops at the first action_required and records completed steps in state".
- [ ] **Step 2: Run** `pnpm --filter @ob/setup test`. Expected: FAIL (no `src/index.ts`).
- [ ] **Step 3: Implement** `src/index.ts` (parse flags with `node:util` `parseArgs`, validate, run `STEPS`, scrub, print, exit) and `steps/prereqs.ts` (Node major ≥ 22; `wrangler whoami --json` with a 3-minute timeout; one account → `ctx.state.accountId`, several → `action_required` unless `--account-id` matches).
- [ ] **Step 4: Run** `pnpm --filter @ob/setup test && pnpm test`. Expected: PASS; `scripts/check-workspace.test.ts` already lists `scripts/setup`.
- [ ] **Step 5: Commit.** `git commit -m "feat(setup): step runner and prereqs (I1)"`. Branch `in/i1-setup-runner`.

### Task I2: Access SaaS app and the Access token

**Files:**
- Copy and cut: OA `src/steps/access.ts` → `scripts/setup/src/steps/access.ts`; OA `test/access*.test.ts` → `test/access.test.ts`
- Test: `scripts/setup/test/access.test.ts`

**Interfaces:**
- Consumes: I1 `Ctx`, `tokenById("access", { name })` (OA `token-files.ts`).
- Produces: `ctx.state.access = { teamDomain: string; clientId: string; appId: string }`; the client secret only in memory as `ctx.secrets.ACCESS_CLIENT_SECRET` (consumed by I3).
- The app: an Access **SaaS** OIDC app named `OpenBus (<name>)`, redirect URI `https://<host>/auth/callback` (02-backend B1b), scopes `openid email profile`, one allow policy `OpenBus owner` including exactly `--owner-email`. Needs "Access: Apps and Policies: Edit", which `wrangler login` lacks (spec §Login): the token is read from `~/.openbus/<name>-access-token` or `OB_ACCESS_TOKEN`.

- [ ] **Step 1: Write the failing tests.** "asks for the Access token with a pre-filled dashboard link" (`action_required`, `data.url` starts `https://dash.cloudflare.com/profile/api-tokens`, `data.saveCommand` writes `~/.openbus/<name>-access-token` with `umask 077` and `read -rs`); "creates the SaaS app and the owner policy"; "adopts the existing app by name" (fake API already has `OpenBus (open-bus)`: no POST, `skipped`, same `clientId`); "updates the redirect URI when --host changes"; "never prints the client secret" (the fake returns `client_secret: "cs-1"`; no output line contains `cs-1`).
- [ ] **Step 2: Run** `pnpm --filter @ob/setup test -- access`. Expected: FAIL.
- [ ] **Step 3: Implement** by cutting OA's step: keep the token flow, SaaS-app create/adopt and policy; drop OA's team/member policies and content host. A re-adopted app has no readable secret: rotate it only when `ctx.secrets` lacks it **and** the Worker secret `ACCESS_CLIENT_SECRET` is absent (I3 reports which); otherwise keep it.
- [ ] **Step 4: Run** the suite. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(setup): Access SaaS app and token flow (I2)`. Branch `in/i2-setup-access`.

### Task I3: Secrets, deploy, healthcheck, selftest, destroy

**Files:**
- Create: `scripts/setup/src/steps/{secrets,deploy,selftest}.ts`
- Test: `scripts/setup/test/{secrets,deploy,selftest,destroy}.test.ts`

**Interfaces:**
- Consumes: I1 `Ctx`, I2 `ctx.state.access` and `ctx.secrets.ACCESS_CLIENT_SECRET`; Backend's `apps/server/wrangler.jsonc` (B2a: name `open-bus-staging`, the `staging.open-bus.ai` custom-domain route).
- Produces: a deployed Worker named `--name` on `--host`; `ctx.state.deployed = { version: string; host: string }`. Exported `deployArgs(opts, access, version): string[]`, reused by I4.

- [ ] **Step 1: Write the failing tests.**
  - `secrets.test.ts`: "sets ACCESS_CLIENT_SECRET and a 48-char SESSION_SECRET via wrangler secret bulk on stdin" (the fake exec sees no secret in argv); "never rotates an existing SESSION_SECRET" (`wrangler secret list` already has it: not in the bulk payload).
  - `deploy.test.ts`: "deploys with --name, the custom-domain route and every var" (`deployArgs` contains `--name open-bus`, `--route`/custom-domain for `--host`, `--var APP_HOST:<host>`, `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_CLIENT_ID`, `VERSION:<package version>`); "refuses a host whose zone is not on the account" (`GET /zones?name=` empty → `action_required` naming the zone; no `wrangler deploy` call); "skips under --check".
  - `selftest.test.ts`: "healthcheck waits for /healthz to report the deployed version" (retries up to 3 min); "selftest gets a user_code from POST /device/code" (`^[A-Z2-9]{4}-[A-Z2-9]{4}$`, `expires_in: 600`, `interval: 5`); "the final ok line names the next step" (`message` contains `npx open-bus install --hub https://<host>`).
  - `destroy.test.ts`: "--destroy refuses without --yes-destroy=<name>"; "deletes the Worker and the Access app, keeps the zone and DNS records it did not create".
- [ ] **Step 2: Run** `pnpm --filter @ob/setup test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `secrets`: `wrangler secret list` then `wrangler secret bulk` with JSON on stdin. `deploy`: zone lookup by the host's registrable suffix, then `pnpm --filter @ob/server exec wrangler deploy -c wrangler.jsonc` with `deployArgs`; the custom domain via `--domain <host>` if the pinned wrangler has it, else a `routes` override written to a temp config (record which in a code comment). `selftest`: `fetch` only. `--destroy`: `DELETE /accounts/{id}/workers/scripts/{name}` and the Access app by id from state.
- [ ] **Step 4: Run** `pnpm --filter @ob/setup test && pnpm test`. Expected: PASS.
- [ ] **Step 5: Live check on a scratch name** (needs issue #4's token): `pnpm -s ob:setup --json --name ob-scratch --host scratch.open-bus.ai --owner-email <user's email>`, then `--destroy --yes-destroy=ob-scratch`. Expected: exit 0 with every step `ok`, then a clean destroy. Paste both outputs (scrubbed) into the PR.
- [ ] **Step 6: Commit.** `feat(setup): secrets, deploy, selftest and destroy (I3)`. Branch `in/i3-setup-deploy`.

### Task I4: Staging becomes a real instance

**Files:**
- Modify: `.github/workflows/deploy-staging.yml`, `scripts/ci/staging-smoke.sh` (+ test), `docs/ops/staging.md`
- Create: `scripts/ci/prod-setup.sh`, `scripts/ci/prod-setup.test.ts` (copied from OA, cut to `install|preflight|upgrade|cleanup`, plus `scratch-*` modes in place of OA's `demo-*`)

**Interfaces:**
- Consumes: I3 `deployArgs`; repo vars `STAGING_OWNER_EMAIL`, `STAGING_ACCESS_TEAM_DOMAIN`, `STAGING_ACCESS_CLIENT_ID` (non-secret); Worker secrets set once by setup.
- Produces: staging serving login and the device flow; `prod-setup.sh <mode>` used by I6.

- [ ] **Step 1: Run setup against staging once** (adopts the Worker that `deploy-staging` created): `pnpm -s ob:setup --json --name open-bus-staging --host staging.open-bus.ai --owner-email <user's email>`. Relay each `action_required` to the user with `scripts/ob-blocker.sh`. Expected: exit 0. Record the three non-secret values as repo vars (`gh variable set`).
- [ ] **Step 2: Write the failing tests.** `workflows.test.ts`: "deploy-staging passes OWNER_EMAIL, ACCESS_TEAM_DOMAIN and ACCESS_CLIENT_ID from vars.STAGING_*" and "skips the deploy with a notice until those vars exist". `staging-smoke.test.ts`: "device check passes on a well-formed user_code" and "fails on any other body". `prod-setup.test.ts`: "scratch and staging refuse the prod name or host" (`open-bus-prod`, `bus.leourbina.com` → exit 2, no setup call); "never prints ob_machine_ tokens or the Access token".
- [ ] **Step 3: Implement** the three files; `staging-smoke.sh device <base>` posts `{"machine_label":"smoke"}` to `/device/code`.
- [ ] **Step 4: Run** `pnpm test` and `actionlint`. Expected: PASS.
- [ ] **Step 5: Merge, then confirm** the next `Deploy staging` run is green and `curl -fsS https://staging.open-bus.ai/healthz` reports the merge's version. Update `docs/ops/staging.md` (Resources: the Access app; Repo settings: the `STAGING_*` vars).
- [ ] **Step 6: Commit.** `ci: make staging a real instance (I4)`. Branch `in/i4-staging-instance`.

### Task I5: npm publish and verify-release

**Files:**
- Modify: `.github/workflows/release-please.yml`, `scripts/ci/workflows.test.ts`
- Copy and cut: OA `scripts/ci/verify-release.ts` (+ test) → checks npm, `/healthz` and `llms.txt`

**Interfaces:**
- Consumes: C10's `packages/cli` pack (`dist/index.js`, `version` command); secret `NPM_TOKEN` (human gate "I (release)"); release-please outputs `release_created`, `tag_name`.
- Produces: job `publish-npm` (`needs: release-please`, `if: release_created == 'true'`, `permissions: id-token: write`, `npm publish --provenance --access public` from `packages/cli` after `pnpm --filter open-bus build`). It skips with a `::notice` when `NPM_TOKEN` is absent (the #14 pattern).

- [ ] **Step 1: File the npm gate** if `NPM_TOKEN` is not set: `scripts/ob-blocker.sh "OpenBus Platform" "npm automation token for open-bus" "… ! gh secret set NPM_TOKEN -R open-artifacts-ai/open-bus (an npm Automation token with publish rights to the open-bus package) …"`.
- [ ] **Step 2: Write the failing tests.** `workflows.test.ts`: "publish-npm runs only when a release was created, with provenance"; "publish-npm skips with a notice without NPM_TOKEN". `verify-release.test.ts`: "fails when npm's latest open-bus is not the tag's version"; "fails when /healthz reports another version"; "fails when llms.txt does not mention npx open-bus".
- [ ] **Step 3: Implement.** `verify-release.ts --tag <t> --prod-url <u> --site-url <s>` reads `https://registry.npmjs.org/open-bus/latest`.
- [ ] **Step 4: Run** `pnpm test`, `actionlint`, and the release dry run (`bash scripts/ci/release-dry-run.sh`). Expected: PASS.
- [ ] **Step 5: Commit.** `ci: publish open-bus to npm and verify releases (I5)`. Branch `in/i5-npm-publish`.

### Task I6: Landing at open-bus.ai

**Files:**
- Modify: `.github/workflows/release-please.yml` (job `deploy-landing`), `scripts/ci/workflows.test.ts`
- Ask Design (D7 owner) to change `apps/landing/src/consts.ts` `SITE_URL` to `https://open-bus.ai`; D7's header comment assigns this change to I. Platform sends the one-line change as a PR for Design's review.

**Interfaces:**
- Consumes: D7's `apps/landing` static build (`dist/`), its `llms.txt` test.
- Produces: `open-bus.ai` serving the site, `/llms.txt` and `/docs/<page>.md`, deployed on every stable release as the Worker `open-bus-landing` (static assets only, no code) with custom domain `open-bus.ai`.

- [ ] **Step 1: Write the failing tests.** "deploy-landing runs only for stable releases and never on push to main"; "deploy-landing deploys apps/landing/dist as assets with the open-bus.ai custom domain".
- [ ] **Step 2: Implement** the job: `pnpm --filter @ob/landing build`, then `wrangler deploy --assets apps/landing/dist --name open-bus-landing --compatibility-date 2026-01-01` with the `open-bus.ai` custom domain; smoke `curl -fsS https://open-bus.ai/llms.txt | grep -q "npx open-bus"`.
- [ ] **Step 3: Run** `pnpm test` and `actionlint`. Expected: PASS.
- [ ] **Step 4: Commit.** `ci: deploy the landing to open-bus.ai (I6)`. Branch `in/i6-landing-deploy`.

### Task I7: Scenarios 1–3 on staging (M1)

**Files:**
- Create: `e2e/staging/harness.ts`, `e2e/staging/scenarios.test.ts`, `e2e/staging/vitest.config.ts`
- Modify: root `package.json` (`"e2e:staging": "vitest run -c e2e/staging/vitest.config.ts"`), root `vitest.config.ts` (exclude `e2e/**`)

**Interfaces:**
- Consumes: the published CLI behaviour from C2/C3 (`open-bus login --hub <url> --no-open`, `open-bus daemon --hub <url> --home <dir>`, `OPENBUS_HOME`); the local socket contract (C1b) to act as a harness session; the wire frames in 00-overview §Contracts.
- Produces: `machine(label): Promise<Machine>` (a fresh `OPENBUS_HOME` logged in to `E2E_HUB`, approved through a stored Playwright session for `/approve/:user_code`); `machine.session(kind, agent_ref, cwd): Promise<Session>` with `send(to, body)`, `roster()`, `inbox()`, `close()`. Two `machine()`s are two machines to the hub (two tokens, two sockets).
- Env: `E2E_HUB=https://staging.open-bus.ai`, `E2E_STORAGE_STATE` (a Playwright storage state from one real Access login by the user; filed as a blocker the first time).

- [ ] **Step 1: Write the scenarios as tests**, each named after the spec line:
  - "1: a Claude session and an OpenCode session on two machines see each other and a message each way lands, and the reply routes back" (same `.openbus.json` namespace; `deliver` arrives at the right `agent_ref`; the reply's `from_name` is the first session's bus name).
  - "2: a second OpenCode session in the same service has its own identity and never sees the first one's mail" (two `agent_ref`s on one machine; bus names differ; each inbox holds only its own messages).
  - "3: a closed OpenCode TUI refuses sends and nothing is injected" (presence file removed → `refused: closed`; the session's inbox stays empty).
- [ ] **Step 2: Run** `pnpm e2e:staging`. Expected: PASS three runs in a row (flakiness gate). A failure is filed with the owning lead as a failing test, and fixed there.
- [ ] **Step 3: Scenario 1 with real harnesses, once.** On the user's machine plus a second `OPENBUS_HOME`: run `npx open-bus install --hub https://staging.open-bus.ai`, open a Claude Code session and an OpenCode TUI in the same repo, and have each message the other. Record the transcripts (no tokens) in the PR and on the status page.
- [ ] **Step 4: Report M1** to `openbus-e0` in three lines.
- [ ] **Step 5: Commit.** `test(e2e): staging scenarios 1-3 (I7)`. Branch `in/i7-scenarios-m1`.

### Task I8: Scenarios 4–6 and the adversarial pass (M2)

**Files:**
- Modify: `e2e/staging/scenarios.test.ts`
- Create: `docs/security/2026-review.md`

**Interfaces:**
- Consumes: I7's harness; `DELETE /api/v1/machines/:id` with the stored session (00-overview §REST).

- [ ] **Step 1: Add the scenarios.**
  - "4: mail to an offline machine waits and is delivered on reconnect" (stop machine B's daemon, send, receipt `pending`, restart, `deliver` arrives once, receipt `delivered`).
  - "4b: undelivered mail expires after an hour and the sender is told": a separate `describe.skipIf(!process.env.E2E_SLOW)`, run once per release candidate, with a 65-minute timeout: receipt `expired`.
  - "5: revoking a machine closes its socket with 4403 and its agents leave the roster" (reconnect refused; mail to its agents `refused: revoked`).
  - "6: another namespace is invisible and unreachable; a global agent reaches both" (`refused: unknown_agent`, since another namespace is invisible; `other_namespace` is only for an explicit `to_namespace` (B8 ruling); the global agent appears in both rosters).
- [ ] **Step 2: Run** `pnpm e2e:staging` three times, and `E2E_SLOW=1 pnpm e2e:staging -t 4b` once. Expected: PASS.
- [ ] **Step 3: Adversarial pass.** Dispatch three reviewers in parallel, each with the spec, 00-overview §Review Focus and the repo: **hub and auth** (from_ref, token hash, revoke races, device-code brute force, CSRF on approve), **client** (local socket permissions, attestation, pid reuse, OpenCode `_meta`), **install** (setup idempotence, token files, CI secret handling). Brief: *"Your job is to break this. Find inputs, sequences, or environments where it fails, leaks across namespaces, spoofs identity, double-delivers, or contradicts the spec. Write the failing test for each finding."* Each finding goes to its owning lead; record issue, severity, fix and pinning test in `docs/security/2026-review.md`.
- [ ] **Step 4: Report M2** to `openbus-e0`; publish the review summary page for the user (artifacts.leourbina.com, information only).
- [ ] **Step 5: Commit.** `test(e2e): staging scenarios 4-6 and security review (I8)`. Branch `in/i8-scenarios-m2`.

### Task I9: First npm release, prod at bus.leourbina.com, scenario 7 (M3)

**Files:**
- Modify: `.github/workflows/release-please.yml` (`deploy-prod` uses `prod-setup.sh`; drop `PROD_CONTENT_HOST`), `docs/ops/prod.md` (new)

**Interfaces:**
- Consumes: I1–I8 green; D7's `llms.txt`; repo vars `PROD_ENABLED`, `PROD_APP_HOST=bus.leourbina.com`, `PROD_OWNER_EMAIL`; secret `PROD_CLOUDFLARE_API_TOKEN` (or the shared token, per issue #4).

- [ ] **Step 1: Check the release PR.** CHANGELOG lists every feature by scope with no `chore` noise; the version is release-please's. Fix entries with `fix:`/`docs:` PRs, never a hand edit. Publish the release notes page for the user (information only).
- [ ] **Step 2: Merge the release PR** (`gh pr merge <n> --squash`). Expected: a new `vX.Y.Z` tag, a GitHub release, `npm view open-bus version` = `X.Y.Z` (the first npm release), `https://open-bus.ai/llms.txt` live.
- [ ] **Step 3: Install prod through llms.txt, to the letter.** In a clean directory, follow `https://open-bus.ai/llms.txt` with `--name open-bus-prod --host bus.leourbina.com --owner-email <user's email>`. Relay each `action_required` as a blocker. Expected: exit 0, `/healthz` = `X.Y.Z`. Then set `PROD_ENABLED=true` and the `PROD_*` vars so later releases upgrade prod through `deploy-prod`.
- [ ] **Step 4: Scenario 7 from a stranger's point of view.** A fresh Cloudflare account (the user creates it; blocker) goes from `https://open-bus.ai/llms.txt` to a working bus with only browser approvals: setup exit 0, `npx open-bus install` on one machine, two sessions message each other. Destroy it afterwards with `--destroy`.
- [ ] **Step 5: Final whole-system review.** A fresh reviewer on the most capable model gets the spec, all plans and the repo. Brief: "List every spec requirement not demonstrably working on staging or prod, with evidence." Close each gap with PRs or get the user's sign-off to defer.
- [ ] **Step 6: Report M3** to `openbus-e0` and update the status page.


### Task I11: Card keys in setup (AC4-ops)

Spec: `docs/superpowers/specs/2026-10-29-agent-card-design.md`, "Keys". Backend owns AC4 itself: signing, JWKS and the link flow. Platform owns the keys' life cycle.

**Contract with Backend (agree before Step 1):**

- **Worker secrets:**
  - `CARD_SIGNING_KEY` is the current private Ed25519 JWK (`kty: OKP`, `crv: Ed25519`, `x`, `d`, `kid`, `alg: EdDSA`).
  - `CARD_SIGNING_KEY_PREV` is the previous key's public JWK only, with no `d`. It is absent before the first rotation. Old cards only need verifying, never signing.
  - `CARD_OWNER_SALT` is 36 random bytes, base64url (48 characters).
- **`kid`** is `ob-<UTC yyyymmddThhmmssZ>-<6 hex>`. Its timestamp is the key's creation time, so the 24 h rotation guard needs no state file and works from any machine and in CI.
- **JWKS:** `/.well-known/jwks.json` lists the public half of `CARD_SIGNING_KEY`, then `CARD_SIGNING_KEY_PREV` if set.
- **A Worker without card secrets:** card and link routes answer 503, and everything else is unaffected. This lets setup and the Worker ship in either order.
- **Test-key guard** (Platform writes it in `apps/server`, and Backend reviews):
  - `packages/shared/src/mocks/card.ts` also exports `TEST_CARD_KEY_X`, the public `x` alone, so the server bundle never imports the private test key.
  - Outside `ENVIRONMENT: "dev"`, a `CARD_SIGNING_KEY` whose `x` equals it makes every route except `/healthz` answer 503 `card key is the test key`. This is "refuses to start" for a Worker, which has no start.
  - The hub DO checks the same before it signs anything.
  - It is never a silent outage:
    - The Worker logs one line, `card key is the test key; refusing requests (see docs/ops/releases.md)`, at most once per isolate, with no key material.
    - `/healthz` keeps answering, now as `{version, problem: "test_card_key"}`.
    - Client's `status` and `doctor` already read `/healthz` (C26i), and they print the problem with its fix: `ob:setup --rotate-card-key --force`. Client owns that CLI change, and the order is agreed with Client before Step 3.

**Files:**
- Modify: `scripts/setup/src/steps/secrets.ts`, `scripts/setup/src/index.ts` (`--rotate-card-key`, `--force`), `scripts/ci/prod-setup.sh`, `docs/ops/releases.md`, and `docs/ops/staging.md`.
- Create: `scripts/setup/src/card-key.ts`, and the guard in `apps/server/src/card-key-guard.ts`.
- Test: `scripts/setup/test/{secrets,card-key}.test.ts`, `scripts/ci/prod-setup.test.ts` and `apps/server/test/card-key-guard.test.ts`.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  - **`card-key.test.ts`:**
    - "generates an Ed25519 private JWK with a timestamped kid". `crypto.subtle` signs and verifies with it.
    - "the public half has no d".
  - **`secrets.test.ts`:**
    - "a Worker without card secrets gets CARD_SIGNING_KEY and CARD_OWNER_SALT in the same secret bulk, on stdin". No secret value appears in argv or the notes.
    - "never rotates an existing CARD_OWNER_SALT", under every flag including `--rotate-card-key --force`.
    - "never replaces an existing CARD_SIGNING_KEY without --rotate-card-key".
    - "--check reports the missing card secrets as `todo` with the message `adds CARD_SIGNING_KEY, CARD_OWNER_SALT`".
  - **Rotation:**
    - "--rotate-card-key reads the current kid and public key from https://<host>/.well-known/jwks.json, then puts the new private key and the old public key as `_PREV` in one bulk".
    - "refuses within 24 h of the current kid's timestamp, naming when it may run". `--force` overrides it.
    - "refuses, changing nothing, when JWKS is unreachable or has no key", so the previous key is never lost silently.
    - "on a bus whose /healthz reports `problem: test_card_key`, `--rotate-card-key --force` puts a new key and no `_PREV`". The test key is public, so it is never kept. JWKS answers 503 on that bus, so this is the one path that doesn't read it. The fix that `status` and `doctor` print (#294) therefore works.
    - "never runs under --check or --ci".
  - **`prod-setup.test.ts`:**
    - "preflight passes when secrets is todo only to add the card secrets". CI upgrade adds them additively, the same way the version steps go todo (#260).
    - "preflight still fails when any other secret is missing".
  - **`card-key-guard.test.ts`:**
    - "the test key answers 503 outside dev, except /healthz".
    - "a real key, or no key, passes".
    - "dev accepts the test key".
    - "/healthz still answers, with `problem: test_card_key`".
    - "it logs the one line once per isolate, and the line holds no key material".
- [ ] **Step 2: Run** `pnpm --filter @ob/setup test`, `pnpm --filter @ob/server test` and `scripts/ci` vitest. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Key generation:** `card-key.ts` uses `crypto.subtle.generateKey("Ed25519")` and exports to JWK.
  - **Secrets step:** card secrets join `payload()`, and only when missing.
  - **Rotation:** `--rotate-card-key` is its own branch of the secrets step, and it runs only when the flag is given.
  - **Guard:** Hono middleware ahead of every route, plus the check in the DO signer.
  - **Preflight:** `prod-setup.sh` allows `preflight:secrets` todo only with the `adds CARD_` message.
- [ ] **Step 4: Run** `pnpm test`, `pnpm lint` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Live on staging.**
  1. Run `pnpm -s ob:setup --json --name open-bus-staging --host staging.open-bus.ai --owner-email <user's email>`. Expected: `secrets` ok and `set CARD_SIGNING_KEY, CARD_OWNER_SALT`.
  2. Rerun the same command. Expected: `secrets` is already done, and nothing is put.
  3. Run `--rotate-card-key`. Expected: refused, under 24 h.
  4. Once Backend's JWKS is live, run `--rotate-card-key --force`. Expected: the JWKS lists two keys, and a card signed before the rotation still verifies.
  5. Run `--rotate-card-key` once more. Expected: refused.
- [ ] **Step 5b: Prove the role gate on staging, once AC2b (roles REST) ships.**
  1. Set a role on staging.
  2. On a daemon below the gate (0.53), check that the roster decodes and no row carries `role`.
  3. On a 0.55 daemon, check that the same row carries `role`.
  Record both rosters, with names only, in the PR or issue that closes AC2b. Until AC2b, no role can be set, so prod has nothing to withhold.
- [ ] **Step 6: Prod gets its own keys** from the next CI upgrade, through the additive secrets path. The manager and the user deploy prod, never Platform's session. After-check: prod's JWKS `kid` differs from staging's, and neither key's `x` is `TEST_CARD_KEY_X`.
- [ ] **Step 7: Docs.**
  - `docs/ops/releases.md` gets a "Card keys" section: generation, rotation (`--rotate-card-key`, the 24 h guard, `--force`) and the never-rotated salt.
  - `docs/ops/staging.md` states that staging has its own keys.
- [ ] **Step 8: Commit.** Two PRs, each under 400 lines: `feat(setup): generate and rotate the card keys (I11)` on `in/i11-card-keys`, then `feat(server): refuse the test card key (I11)` on `in/i11-card-key-guard`. Merge each only when every check is green.

---

## Human gates (filed with `scripts/ob-blocker.sh` when the task reaches them)

| Gate | Task | Ask |
|---|---|---|
| CF token + account id (issue #4) | I3 Step 5, I4 | already filed |
| Access API token for staging | I4 Step 1 | save to `~/.openbus/open-bus-staging-access-token` via the `saveCommand` line |
| One Access login for e2e | I7 | a Playwright storage state, captured by the user once |
| `NPM_TOKEN` | I5 | `! gh secret set NPM_TOKEN …` |
| Prod Access token, owner email | I9 Step 3 | as the setup prompts |
| A fresh Cloudflare account | I9 Step 4 | the user creates it and approves in the browser |

## Dependencies on other tracks

- **Backend B2a:** `apps/server/wrangler.jsonc` with name `open-bus-staging` and the `staging.open-bus.ai` route (before I4). B1b's callback path `/auth/callback` is I2's redirect URI.
- **Client C2/C3/C10:** `open-bus login|daemon|install --hub`, `OPENBUS_HOME`, the packed tarball (before I5, I7).
- **Design D7:** `apps/landing` and `llms.txt`; its `setup.md` must match I1–I3's flags (`--name --host --owner-email --account-id --json`). Platform sends Design the exact procedure once I3 lands.

## Self-review

- **Spec coverage:** scenarios 1–3 (I7), 4–6 (I8), 7 (I9); `llms.txt` install path (I1–I3, I6, I9); hosts (I4, I6, I9); release, npm, verify-release (I5, I9); prod (I9); browser-only approvals (I2 token page, I9 Step 4).
- **Deviation to flag:** nothing in 00-overview assigns `scripts/setup`; this plan gives it to Platform (I1–I3). The instance has no "content host" (OA had one); `release-please.yml`'s `PROD_CONTENT_HOST` goes away in I9.
