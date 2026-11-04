# Testing

How OpenBus is tested and where each kind of test lives. The CI side of this is
`.github/workflows/ci.yml` (jobs `test`, `e2e`); the CPU bar is
`docs/ops/cpu-budget.md`.

## Layout

| Kind | Where | Runner | Naming |
|---|---|---|---|
| Unit and integration | every package's `test/` | vitest (`*.test.ts`), each package its own `vitest.config.ts` | `*.test.ts` |
| Worker + Durable Object | `apps/server/test/` | `@cloudflare/vitest-plugin` (miniflare, in-process bindings) | `*.test.ts` |
| Repo and pipeline invariants | `scripts/**/*.test.ts`, `scripts/ops/*.test.ts`, `scripts/ci/*.test.ts` | root `vitest.config.ts` | `*.test.ts` |
| Real-browser | `apps/dashboard/e2e/`, `apps/landing/test-browser/` | Playwright | `*.spec.ts` |
| CPU budgets | `apps/server/test/code-cpu/` | `pnpm --filter @ob/server test:cpu` (serial) | `*.test.ts` |

`pnpm test` runs the root suite (scripts) and then every package's suite through
`pnpm -r test`. `pnpm typecheck` and `pnpm lint` (biome) run over everything.

## Rules

- **No secrets, no network.** The Worker suite runs a local `wrangler dev` or the
  vitest plugin's in-process bindings (ENVIRONMENT=dev in a generated temp
  config) — never staging (00-overview). Playwright drives a local server only.
- **Hermetic by construction.** A suite that needs files another track owns gets
  fixtures, not real paths: the CI scripts take env overrides
  (`WRANGLER_CONFIG`, `ENV_TS`, `E2E_DASHBOARD`, `E2E_UI`, `E2E_LANDING`,
  `DASHBOARD_DIST`, `HOSTS_FILE`) and their tests point those at fixtures. No
  suite reads another track's working files at import time. See
  `scripts/ci/staging-deploy.test.ts` and `scripts/ci/e2e.test.ts`.
- **Stubs over mocks for shell.** `scripts/ci/stubs.ts` puts fake `pnpm`,
  `sudo`, `curl`, `gh` on PATH and logs argv; assertions are made on the log,
  so a wrong command line fails the test.
- **Secrets never appear in output.** Token-shaped strings in captured output
  fail the suite (`scripts/ci/prod-setup.test.ts` when 06 lands it).
- **The review-focus tests are permanent.** Each failure mode in 00-overview
  §Review Focus has a pinned test in the track that owns the code (identity
  spoofing, namespace leak, reconnect mid-delivery, revoke-while-live, waking a
  closed session). Those tests document intent: rename them, never delete them.

## Local hub with seeded machines (`dev:e2e`)

`pnpm --filter @ob/server dev:e2e` runs `wrangler dev` on `apps/server/wrangler.e2e.jsonc`. It is local only: it binds 127.0.0.1:8787 (`dev.ip`), and its entry `apps/server/test/e2e/entry.ts` adds `POST /__e2e/machine`. Send `X-OB-E2E: 1` and a JSON body `{label?}`. The route answers the daemon's `machine.json` shape (`hub`, `machine_id`, `label`, `machine_token`):

    curl -X POST -H 'X-OB-E2E: 1' http://127.0.0.1:8787/__e2e/machine -d '{"label":"t"}'

- It answers 403 when the URL host is not loopback or the header is missing, and 409 `machine_limit` when the hub is full.
- Hub state persists in `apps/server/.wrangler/state`. Run `pnpm --filter @ob/server dev:e2e:reset` with wrangler stopped to start from an empty hub.
- No deploy path may use this config. `apps/server/test/e2e-guards.node.test.ts` enforces that.
- Always address it as `http://127.0.0.1:8787`, never `localhost`: the e2e harness's seed mode accepts only loopback IP literals (`127.0.0.1`, `[::1]`).

Running the scenario suite (`e2e/staging`) against it, stopping wrangler by its PID only (other leads run workerd on the same machine):

    pnpm --filter @ob/server dev:e2e:reset
    pnpm --filter @ob/server dev:e2e & pid=$!
    E2E_HUB=http://127.0.0.1:8787 E2E_SEED=1 pnpm e2e:staging
    kill $pid   # and its child processes, by PID

`E2E_SEED` accepts only `1`; with it, each machine comes from `POST /__e2e/machine` instead of the device flow, no browser session is needed, and `dispose` skips the revoke (the reset clears the hub). The revoke scenario (5) is skipped in seed mode: it needs an owner session.

## Codex and Claude Code end to end (`e2e:codex`)

`pnpm e2e:codex` runs the real Codex CLI and Claude Code against fake model servers, the real server under `wrangler dev`, and a real daemon, with no API key and no network after install (C26g). CI runs it as the `codex-e2e` job on ubuntu (`.github/workflows/ci.yml`); it takes about 30 s after the install.

- **Pinned CLIs.** `e2e/codex/setup.ts` pins `@openai/codex` and `@anthropic-ai/claude-code` and npm-installs each into its own prefix under `~/.cache/ob-e2e-clis` (or `$OB_E2E_PREFIX`), never globally. CI caches that folder on the hash of `setup.ts`; bump a version there.
- **Published shape.** Setup builds `packages/cli/dist/index.js` with the root's release version (`OB_CLI_VERSION`); a 0.0.0 daemon is below `KIND_TOKEN_MIN_CLIENT` and would not see codex rows. The daemon (`open-bus daemon`) and both MCP servers (`open-bus mcp codex`, `open-bus mcp claude`) run from that bundle.
- **Temp state only.** HOME, OPENBUS_HOME and CODEX_HOME are temp dirs; `~/.codex` and `~/.claude` are never read. `wrangler dev` gets a free port and its own `--persist-to`, so it never meets `dev:e2e`'s 8787 or another run. Every process is stopped by its own process group's pid. A failing test prints each process's log tail; a passing run deletes its temp root.
- **Fakes.** `fake-model.ts` (OpenAI Responses, `[model_providers.stub]`) and `fake-anthropic.ts` (Messages, `ANTHROPIC_BASE_URL`) script one turn: a line `ob-e2e send <to> <text>` calls `list_agents`, then `send_message`, then answers. They record what the model saw, which the tests assert on.
- **Covered.** `codex exec` (joins as `codex`, attested, list, Delivered; after exit the thread expires mail and gets no `codex queue`), `codex app-server` over stdio (the desktop app's mode: the same, plus a wake by `codex queue` whose turn replies over the bus, and a forged caller refused) and `claude -p`.

    pnpm e2e:codex

## CPU budgets

`test:cpu` runs **serially** in CI (its own step, outside the parallel suite):
wall-clock CPU cannot be measured under parallel load. The bar and the
measurement method live in `docs/ops/cpu-budget.md`.

## E2E harness

`scripts/ci/e2e.sh` orchestrates the Playwright suites (`version`, `install`,
`hosts`, `mock`, `real`, `ui`, `landing`). A suite that isn't ready yet exits 0
with `skip:`: the dashboard suites until `apps/dashboard` has `@playwright/test`
installed, `ui` and `landing` until their package has a `test:browser` script.
The `e2e` check passes while tracks land their suites, and starts reporting for
real once those exist. Reports
land in `playwright-report/<suite>` and are uploaded on failure.
