# Staging

Public (no Access gate). Worker `open-bus-staging` on the custom domain `https://staging.open-bus.ai` (user decision, #9). `deploy-staging.yml` pins the host as `STAGING_HOST`. `ENVIRONMENT=production` — staging never runs dev mode.

## Resources (no secrets)

| Resource | Name | Notes |
|---|---|---|
| Worker | `open-bus-staging` | name pinned in `apps/server/wrangler.jsonc` (02-backend.md) |
| Durable Object | `Hub` | created by the migrations in `wrangler.jsonc` at deploy |
| Custom domain | `staging.open-bus.ai` | `routes: [{ "pattern": "staging.open-bus.ai", "custom_domain": true }]` in `wrangler.jsonc`; the deploy creates the DNS record |
| Access SaaS app | `open-bus-staging` | the owner login, created by `pnpm ob:setup`; its team domain and client id are the `STAGING_*` vars below |

No D1, R2 or KV (spec §Architecture: not used). Config: `apps/server/wrangler.jsonc` —
single-env, top-level `vars`, Durable Object migrations applied by `wrangler deploy`
itself. There is no `--env staging` anywhere.

## GitHub secrets

| Secret | Used by | Needed for |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy-staging | Account \| Workers Scripts: Edit; Account \| Access: Apps and Policies: Edit; Zone \| Workers Routes: Edit and Zone \| DNS: Edit on `open-bus.ai` and `leourbina.com` |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-staging | the account owning the Worker |
| `RELEASE_APP_ID` | release-please, release-cadence | the release GitHub App |
| `RELEASE_APP_PRIVATE_KEY` | release-please, release-cadence | same |

All four are tracked as blocker issue #4. Until the release App secrets exist, release-please skips with a notice instead of failing. Never put a secret in an issue or a PR:
ask for `! gh secret set …` instead (`scripts/ob-blocker.sh` files the request).

## Instance setup (one time)

Staging becomes a real instance (login and device flow) by running setup once, with
the Cloudflare token in `~/.openbus/` (never a flag):

```sh
pnpm -s ob:setup --json --name open-bus-staging --host staging.open-bus.ai --owner-email <owner>
```

It adopts the Worker that `deploy-staging` created, makes the Access app, and puts
`ACCESS_CLIENT_SECRET` and `SESSION_SECRET` on the Worker. Each `action_required`
line goes to the user through `scripts/ob-blocker.sh`; rerun until exit 0.

Setup also generates staging's own agent card keys, `CARD_SIGNING_KEY` and
`CARD_OWNER_SALT`. They are never copied to or from prod. OA's red-line suite
verifies cards against staging's JWKS. Rotation is covered in
[releases.md](releases.md#card-keys).

## Repo variables

Non-secret, read by `deploy-staging.yml` as `vars.STAGING_*`:
`STAGING_OWNER_EMAIL`, `STAGING_ACCESS_TEAM_DOMAIN`, `STAGING_ACCESS_CLIENT_ID`.
Set them from setup's state file `~/.openbus/setup-open-bus-staging.json`
(`ownerEmail`, `teamDomain`, `accessClientId`) with

```sh
bash scripts/ops/staging-vars.sh
```

which refuses any state whose `host`/`name` are not staging's, runs `gh variable set` for the three and prints only their names. By hand:
`gh variable set STAGING_OWNER_EMAIL`, `STAGING_ACCESS_TEAM_DOMAIN` and
`STAGING_ACCESS_CLIENT_ID`, each with `--body`.

## Deploy

`deploy-staging.yml` on every push to `main`: install, build, `scripts/ci/ensure-dashboard-dist.sh`,
preflight (required Worker secrets, `scripts/ci/staging-preflight.sh`), clear secrets
that clash with config vars (`scripts/ci/staging-clear-conflicts.sh`), then

```sh
pnpm --filter @ob/server exec wrangler deploy -c wrangler.jsonc \
  --var "APP_HOST:<host>" --var "VERSION:<version>-<sha>"
```

`APP_HOST` (`staging.open-bus.ai`, no scheme) and `VERSION` are written at deploy
time (see the comment in `wrangler.jsonc`).
Once `apps/server/src/env.ts` declares the Access vars (`OWNER_EMAIL`,
`ACCESS_TEAM_DOMAIN`, `ACCESS_CLIENT_ID`), they are written the same way from
the repo vars `STAGING_*`, and the deploy skips with a notice until those exist
(set them from the `pnpm ob:setup` run against staging). The preflight requires
only the secrets `Env` declares that are not vars, so a Worker with none (B2a)
deploys without listing secrets. Both jobs gate on
`apps/server/wrangler.jsonc` existing and skip cleanly before Backend's first task
lands — a red staging pauses merges for everyone (00-overview §Delivery).

Manual deploy:

```sh
cd apps/server
pnpm exec wrangler deploy -c wrangler.jsonc
```

## Smoke

`deploy-staging.yml`'s `smoke` job runs after every deploy:

```sh
bash scripts/ci/staging-smoke.sh healthz "https://staging.open-bus.ai" "<version>"
```

`/healthz` must answer JSON with a `"version"` field matching the deployed version.
A second step runs `staging-smoke.sh device <base>` once `apps/server/src/auth/route-policy.ts` lists
`"POST /device/code"` (a notice otherwise): it POSTs `{"machine_label":"smoke"}` and passes
only on a `user_code` of the form `XXXX-XXXX` (alphabet `A-Z2-9`), `expires_in` 600,
`interval` 5 and a present `device_code`, which it never prints.
The `robots` and `login` checks return when the landing and the Access login exist
(tracks B and 06). There is no analytics step: deployed instances send no telemetry
(spec §Anti-goals).

## Repo settings

Live since 2026-10-23 (task F4d; set by the user from blocker #16):

- **Ruleset `main`** (active, `refs/heads/main`, `bypass_actors: []`: admins are held
  to the same rules, 00-overview §Delivery):
  - no deletion, no force-push; a pull request for every change (0 approvals)
  - merge queue: squash, `ALLGREEN`, 1–5 entries per merge, 5 built at once, a
    5-minute wait, a 60-minute check timeout
  - strict required checks `lint`, `typecheck`, `test`, `build`, `e2e`, `codex-e2e`,
    accepted only from GitHub Actions (`integration_id` 15368). `codex-e2e` became
    required on 2026-10-29 after 10 green runs. `release-dry-run` is not required.
- **Merging** is `gh pr merge <n> --squash`, which enqueues the PR; the queue reruns
  CI on the `merge_group` event. Repo auto-merge (`allow_auto_merge`) is ON, so
  `gh pr merge --squash --auto` (used by `release-cadence.ts arm`) enqueues once the
  required checks are green.
- **Settings → Actions → General:** default workflow permissions `read`, and "Allow
  GitHub Actions to create and approve pull requests" ON (release-please opens the
  release PR with the App token).
- **Label `blocker`** exists (created on first use by `scripts/ob-blocker.sh`).

To inspect: `gh api repos/open-artifacts-ai/open-bus/rulesets`.

## Releases

`release-please.yml` keeps a release PR open (release App token — `GITHUB_TOKEN` PRs
never trigger CI). `release-cadence.yml` arms it (enqueues it) once its checks are
green and the queue holds no other entries, and opens one `blocker` issue while a
release is stuck. Release-only PRs take the CI fast path: `scripts/ci/release-only.ts`
is copied from the **base** commit and the heavy jobs skip their heavy steps.

`deploy-prod` and `verify-release` stay skipped until 06-integration sets
`vars.PROD_ENABLED`, `vars.PROD_APP_HOST` and friends (the user's own instance at M3,
with `scripts/ci/prod-setup.sh` next to them). Pre-release tags never deploy.

**If staging goes red after a merge, merges pause until it is green again.** Platform
watches staging and owns the pipeline.
