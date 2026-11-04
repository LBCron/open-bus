# Releases

release-please keeps one release PR open on `main`. The `release-cadence`
workflow (`scripts/ci/release-cadence.ts`) arms it with auto-merge once it
carries the `release-ok` label with an approval for its current head, its
checks are green, and the merge queue holds nothing but release PRs (or it has
been green for 30 minutes). The merge publishes `@open-bus/cli` to npm and
upgrades prod from CI (`deploy-prod`, then `verify-release`).

## Approving a release

Releases ship only when a person approves them, and an approval covers one
exact head (#435, #445). Add the `release-ok` label to the release PR:

    gh pr edit <release PR> --add-label release-ok

`release-label.yml` then records a `release-ok` commit status on the head the
label was added on. The cadence arms the PR only when it carries the label
**and** its current head carries that status, created by `github-actions`
(the workflow's token), pinned with `--match-head-commit`. release-please
force-pushes the same PR whenever main changes; the new head has no status,
so the old approval no longer counts. To approve the new head, remove the
label and add it again. If a push lands between adding the label and the job,
the job approves nothing; add it again.

Every job in `release-label.yml` runs only for this repo's release-please
branch (`head.ref` and same repo), because each one runs the PR's own copy of
`release-label.ts` with a write token.

Without an approval on the current head, or with a hold:

- `plan` does not arm the PR, and logs which is missing (the label, or an
  approval for this head).
- `arm` re-reads the labels right before it enqueues.
- Any arm is taken back, whoever set it: a person's too. If the PR is not
  queued, the next run disables auto-merge. If it is queued, the next run
  dequeues it and disables auto-merge.
- A push to the release branch runs the `disarm` job, which does the same at
  once: auto-merge set on the old head would otherwise enqueue the new one.
- No 24-hour `blocker` issue: waiting for approval isn't stuck. After 3 days a
  gentle `blocker` reminder opens. Failing checks still open one.

Arming the release PR by hand still skips the label, but no longer survives
it: while the head is unapproved or held, the cadence and these jobs take the
arm back. To ship by hand, approve the head first.

### Trust boundary

The approval is as strong as repo write access. Anyone with write can add
`release-ok`, so the status check only stops a token that can write statuses
but isn't the workflow's from forging an approval. A status with the right
context but another creator doesn't approve.

## Holding a release

The `release-hold` label stops the cadence even with `release-ok` on. Adding
it, or removing `release-ok`, runs the `dequeue` job in `release-label.yml`:
it takes the release PR out of the merge queue if it's queued, and disables
auto-merge whoever set it, so GitHub can't enqueue it again once it's green.

- The job dequeues with `GITHUB_TOKEN`; that hasn't been exercised live. If
  GitHub refuses it, the job fails, and the cadence's next run (every 15
  minutes, App token) dequeues and disarms instead. Or remove the PR from the
  queue in GitHub by hand.
- A label added by another workflow with `GITHUB_TOKEN` triggers no workflow,
  so `release-label.yml` never sees that hold. The cadence still does, on
  its next run.

Remove the hold to release:

    gh pr edit <release PR> --remove-label release-hold

## Card keys

The agent card (spec `2026-10-29-agent-card-design.md`) uses three Worker
secrets. Setup adds them to any Worker that lacks them: on install, on a
plain rerun, and on the CI upgrade, which preflight allows.

- **`CARD_SIGNING_KEY`** is the Ed25519 private key that signs cards and link
  assertions. Its `kid` (`ob-<UTC time>-<hex>`) records when it was made.
- **`CARD_SIGNING_KEY_PREV`** is the previous key's public half, so cards
  signed before a rotation still verify until they expire.
- **`CARD_OWNER_SALT`** derives the owner id every linked app sees. It is
  never rotated, because a new salt would break every link. The id is
  `base64url(HMAC-SHA256(key, "owner\n" + aud))`, where `key` is the UTF-8
  bytes of the salt string exactly as stored, not its base64url-decoded bytes.
  The id is fixed once the first app links, so neither the salt nor the
  derivation may change.

To rotate the key (it leaked, say), run this from the repo:

    pnpm -s ob:setup --name <instance> --rotate-card-key

- Setup reads the current key back from `https://<host>/.well-known/jwks.json`
  and puts it as `_PREV` alongside the new key. If it can't read the JWKS,
  nothing changes.
- It refuses to run within 24 hours of the last rotation, because the previous
  key must stay published that long. `--force` overrides this, and cards signed
  with the key being dropped stop verifying.
- A bus deployed with the shared test key refuses requests, and its `/healthz`
  reports `problem: test_card_key`. `--rotate-card-key --force` then puts a new
  key and does not keep the test key, because the test key is public. It also
  deletes any `CARD_SIGNING_KEY_PREV`, because the Worker refuses a test key
  there too.

After a rotation, expect a short gap (Backend's M6). A verifier that cached
the JWKS before the rotation can reject cards signed with the new key until
it refetches. It caches for up to an hour (`max-age=3600`), but refetches on
an unknown `kid` at most once every 5 minutes, so the gap is normally up to
5 minutes. Cards signed with the old key keep verifying throughout, because it
stays published as previous. If new cards still fail after that, check that
`https://<host>/.well-known/jwks.json` lists the new `kid` first.

`--rotate-card-key` never runs under `--check`, `--ci` or `--destroy`.
