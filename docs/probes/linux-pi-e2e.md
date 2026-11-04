# Pi on Linux, end to end (C22)

**Result: works, no code change.** The Pi extension and the daemon agree on `TZ=UTC LC_ALL=C ps -o lstart=` under procps on Linux, even when the system zone is not UTC, and a full hello, attest, send, receive and ack ran with the real daemon and the real extension.

**What ran.** `scripts/pi-linux-e2e.test.ts`, with the Pi host `scripts/test/pi-host.ts`. No model and no credentials.

- A temp `HOME` and `OPENBUS_HOME`; the harness sentinel home stays empty.
- `open-bus install`'s adapter step (`installAdapters`, only `pi` on PATH) writes the shipped extension to the temp `~/.pi/agent/extensions/openbus.ts`; the test checks it is byte-identical to the asset.
- `open-bus login` (device flow) against the in-process fake hub (`e2e/staging/fake-hub.ts`), then `runDaemon` with its default attest: Pi is checked by `procStartOf` (`ps -o lstart=` on the hello's pid).
- Each Pi session is its own Node process (`--experimental-strip-types`) that loads the installed extension file with a minimal Pi API (`registerTool`, `on(session_start/session_shutdown)`, `sendMessage`, a `ctx` with `cwd` and `sessionManager`). The Pi processes run with `TZ=America/New_York`; so does the test process that hosts the daemon.

Checks:

1. The lstart the extension's process gets (`TZ=UTC LC_ALL=C`) equals the daemon's `procStartOf` for that pid, read from the other process. Without the override the same `ps` prints New York time, so the override is what makes them equal.
2. Two Pi sessions say hello and are attested; `self` names `pi-alpha` in namespace `e2e-pi`; `list_agents` shows `pi-beta`.
3. `pi-alpha` sends to `pi-beta`. `pi-beta`'s `sendMessage` gets the delivered text (`customType: openbus`, `deliverAs: steer`, `triggerTurn: true`), its extension acks, the daemon acks the hub, and `pi-alpha`'s send returns `✓  Delivered to pi-beta.`
4. A hello for a live process with a forged `proc_start` is refused: `pi process start time moved`.

**Linux run.** A throwaway `node:22` container with only a fresh copy of the repo (tracked and untracked files, no `.superpowers`, no host mounts), run as the image's `node` user with `TZ=America/New_York`:

    docker run -d --name c22-pi-linux -e TZ=America/New_York node:22 sleep 3600
    docker cp repo.tar c22-pi-linux:/tmp/repo.tar   # then untar to /src, chown node
    docker exec -u node -w /src c22-pi-linux sh -c '
      corepack enable --install-directory ~/bin && pnpm install --frozen-lockfile &&
      pnpm --filter @ob/shared build &&
      npx vitest run scripts/pi-linux-e2e.test.ts'
    docker rm -f c22-pi-linux

- Debian 12 (bookworm), Node v22.23.4, `ps from procps-ng 4.0.2`, pnpm 10.11.1.
- `scripts/pi-linux-e2e.test.ts`: 4 of 4 passed, three runs in a row (about 2 s each).
- Also in the container: `packages/adapters/pi` 43 of 43, `packages/daemon` 432 of 432.
- The root suite had 24 failures, all in `scripts/ops/staging-vars`, `scripts/ci/staging-smoke` and `scripts/ci/prod-setup`: those scripts need `jq`, which the `node:22` image lacks (CI's ubuntu-latest has it). Unrelated to Pi.
- Sample, same process, zone `America/New_York`: `ps -o lstart=` gives `Sun Oct 25 08:34:28 2026`; `TZ=UTC LC_ALL=C ps -o lstart=` gives `Sun Oct 25 12:34:28 2026`.

**macOS.** The same test passes on macOS (BSD `ps`), so it is not skipped there.

**CI.** It is a root `scripts/**/*.test.ts` file, so `pnpm test` in the existing test job (ubuntu-latest) runs it; nothing skips it. No new workflow. It is typechecked by `e2e/tsconfig.json`, like `scripts/e2e-harness.test.ts`, since it imports daemon sources the root project's `erasableSyntaxOnly` rejects.
