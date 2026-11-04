# Releases

release-please keeps one release PR open on `main`. The `release-cadence`
workflow (`scripts/ci/release-cadence.ts`) arms it with auto-merge once it
carries the `release-ok` label, its checks are green, and the merge queue holds
nothing but release PRs (or it has been green for 30 minutes). The merge publishes `@open-bus/cli` to npm and
upgrades prod from CI (`deploy-prod`, then `verify-release`).

## Approving a release

Releases ship only when a person approves them (#435). The cadence arms the
release PR only once it carries the `release-ok` label:

    gh pr edit <release PR> --add-label release-ok

Without it:

- `plan` does not arm the PR, and logs that it has no `release-ok` label.
- `arm` re-reads the labels right before it enqueues, so taking the label off
  during a run still wins.
- If the cadence already armed the PR and it is not yet in the queue, the next
  run disables auto-merge. It never touches an arm a person set.
- An unapproved release PR doesn't get the 24-hour `blocker` issue: waiting for
  approval isn't stuck. Failing checks still open one.

Once the PR is in the merge queue, removing `release-ok` doesn't take it out.
Remove it from the queue in GitHub instead. Arming the release PR by hand
still works at any time.

## Holding a release

The `release-hold` label still stops the cadence, even with `release-ok` on:
`plan` doesn't arm the PR, `arm` re-checks it right before enqueueing, and an
arm the cadence set (not yet queued) is disabled. Remove it to release:

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
