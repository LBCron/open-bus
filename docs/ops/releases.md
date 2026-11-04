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

`release-label.yml` (label events only) then records a `release-ok` commit
status on the head the label was added on. The cadence arms the PR only when
it carries the label **and** its current head carries that status, pinned
with `--match-head-commit`. release-please force-pushes the same PR whenever
main changes; the new head has no status, so the old approval no longer
counts. To approve the new head, remove the label and add it again. If a push
lands between adding the label and the job, the job approves nothing; add it
again.

Without an approval on the current head:

- `plan` does not arm the PR, and logs which is missing (the label, or an
  approval for this head).
- `arm` re-reads the labels right before it enqueues.
- If the cadence already armed the PR and it is not yet in the queue, the next
  run disables auto-merge. It never touches an arm a person set.
- No 24-hour `blocker` issue: waiting for approval isn't stuck. After 3 days a
  gentle `blocker` reminder opens. Failing checks still open one.

Arming the release PR by hand skips all of this, by design: the gate only
covers the cadence.

## Holding a release

The `release-hold` label stops the cadence even with `release-ok` on. Adding
it, or removing `release-ok`, while the release PR is in the merge queue takes
it out of the queue (the `dequeue` job in `release-label.yml`). If that job
fails, remove the PR from the queue in GitHub by hand. Remove the hold to
release:

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
