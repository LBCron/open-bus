# CPU budget

OpenBus targets the Cloudflare Workers **Free** plan, where an invocation must
stay under **10 ms of CPU** (00-overview §Global Constraints). This page records
the bar and how it is measured. Methodology adopted from open-artifacts'
`docs/ops/cpu-budget.md` (`ffba1e53`); their history does not apply here.

## The bar

Two conditions, both required:

1. **Zero CPU-limit kills on the Free plan at realistic load.** Any request the
   runtime stops for CPU (outcome `exceededCpu`, error 1102) fails the bar. The
   hub is built so it cannot get close: WebSocket Hibernation API only, no
   `setInterval`, no outbound sockets, pings answered with
   `setWebSocketAutoResponse`, and one alarm multiplexed for expiry
   (00-overview §Global Constraints).
2. **Code CPU ≤ 2 ms per route (p95)**, pinned by
   `pnpm --filter @ob/server test:cpu` (`apps/server/test/code-cpu/`): the real
   Worker in Node against in-process bindings, thread CPU minus DO time (DO
   rows meter the DO invocation), p95 of 20 requests, median of 5 runs. A stall
   in a handler fails its row. The 2 ms is on the reference laptop; a slower
   runner (CI is about 3×) scales it by its own baseline route p95, at most 4×.

Staging `cpuTime` is deliberately **not** the bar: it carries 8–15 ms of runtime
overhead the code does not control, so a p95 on it measures the isolate, not us.
What we control is our own code's CPU; what users feel is whether the runtime
kills a request. The two conditions measure those directly.

## Rules that keep the budget

- The Worker does login, device approval, dashboard assets and WebSocket
  routing only; the hub does the work, in bounded slices.
- Write on miss keeps steady-state sends off SQLite (ack timeout 10 s).
- Every Worker request path stays under 10 ms — including the upgrade route,
  which does no mail work.

## Measurements

Recorded here as `apps/server/test/code-cpu/` lands (track B). Table columns:
route, p95 code CPU, scaled CI bar, pass. CI runs the CPU suite **serially**
(`test:cpu`, outside the parallel suite's load): wall-clock CPU budgets cannot
be measured under parallel load (docs/ops/testing.md).
