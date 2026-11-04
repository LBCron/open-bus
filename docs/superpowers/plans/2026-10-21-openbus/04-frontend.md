# OpenBus Frontend (FE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two dashboard surfaces the spec asks for — a machines page with revoke, and a live view of agents and namespaces — with unit and end-to-end tests, against the F2 contract and MSW mocks, without waiting on Backend or Design.

**Architecture:** `apps/dashboard` is a Vite + React 19 SPA that reads three REST endpoints (`/api/v1/machines`, `/api/v1/agents`, `/api/v1/me`) with TanStack Query, and keeps both caches current from a hibernatable WebSocket to the hub DO (`/api/v1/events`; manager ruling 2026-10-24). Every event is applied by a pure reducer (`src/live/busEvents.ts`); an event type the reducer does not know forces a refetch, so a contract drift can never leave stale rows on screen. Revoke is optimistic with rollback, and idempotent: a 404 means "already revoked", which is success. The Worker renders the approval page (Backend's B-track); the frontend never renders it, and the landing page is Design's D-track.

**Tech Stack:** React 19, Vite 8, TanStack Router + Query v5, Tailwind 4 with `@ob/ui` (shadcn), Zod 4 (`@ob/shared`), Vitest (node + jsdom projects), MSW 2 (`msw/node` and `msw/browser`), Playwright 1.64 + axe-core.

---

## Scope, and what this plan does not do

**In scope (FE\*):** the dashboard shell, sign-in hand-off, machines list + revoke + confirm, live agents/namespaces view, the live-updates WebSocket client (was SSE; manager ruling 2026-10-24), the browser mock server used by dev and e2e, unit tests, Playwright e2e.

**Out of scope, owned elsewhere:**

| Surface | Owner |
|---|---|
| `/approve/:user_code` (Worker-rendered, no JS) | Backend (B) |
| `POST /auth/logout`, session cookie, `GET /me` | Backend (B) |
| `packages/shared` schemas, `R`, `AUTH` | Backend (F2) |
| `packages/ui` tokens, components, brand assets | Design (D) |
| Landing page, `llms.txt` | Design (D) |

The FE never edits `packages/shared` or `packages/ui`. A missing export is a message to that package's owner, not a patch.

## Decisions locked here (send these to the manager with the plan)

1. **Two routes, no settings tree.** `/` is Machines, `/agents` is the live view. A settings area can come later; the spec's dashboard is these two pages plus Design's approval screen.
2. **Snapshot events, not deltas.** The WebSocket (was SSE; manager ruling 2026-10-24) carries full `machines[]` / `agents[]` snapshots as JSON text frames: `hello`, then `machines`, then `agents`, then both on change. `"pong"` answers the client's `"ping"` and is not a frame. On `hello` the client waits for the greeting snapshots instead of refetching.
   - Close codes: 1013 evicted and 1011 send failure reconnect with backoff, like any other close; 4401 (session ended) signs out (manager ruling 2026-10-24).
   - At most 16 sockets per owner; the 17th evicts the oldest with 1013 (manager ruling 2026-10-24).
   - Snapshots are throttled to at most one per 500 ms (manager ruling 2026-10-24).
   - The roster is small (one owner, tens of agents); snapshots make reconnect correctness free and keep the reducer trivial. Any unrecognised frame ⇒ refetch both lists.
3. **Revoked machines stay listed.** `revoked_at` exists in the schema, so a revoked machine renders in place with a "Revoked" status, the revoke date and no actions (not struck-through). This is how a user confirms a revoke took effect.
4. **Live updates are advisory.** The initial `GET` is the source of truth on every mount; the WebSocket only patches (was SSE; manager ruling 2026-10-24). A dead stream shows a "Live updates paused" chip with retry, never an empty page.
5. **The FE owns its browser mocks.** `apps/dashboard/src/mocks/` builds fixtures from the F2 Zod schemas and drives both the vitest harness and the dev/e2e `VITE_MOCK=1` worker. When F2 ships `@ob/shared/mocks`, `fixtures.ts` becomes a re-export (one commit, no call-site changes).

## Contract the FE needs from F2

Ask OpenBus Backend for exactly these exports from `@ob/shared`; the whole FE touches them through one file (`apps/dashboard/src/api/contract.ts`, Task FE1), so a rename is a one-file change.

```ts
MachineSchema          // { id, label, createdAt, lastUsed: string|null, revokedAt: string|null }
MachinesResponseSchema // { machines: Machine[] }
AgentSchema            // { id, namespace, name, kind: "claude-code"|"opencode"|"pi",
                       //   machineId, machineLabel, global: boolean, live: boolean, updatedAt }
AgentsResponseSchema   // { agents: Agent[] }
MeSchema               // { user: { id, email, name: string|null } }
BusEventSchema         // see Task FE1 — if F2 has no event schema, define it in contract.ts
R                      // R.me, R.machines, R.machine(id), R.agents, R.events, R.login
AUTH                   // AUTH.login, AUTH.logout
```

Also needed from Backend: the CSRF header name on cookie-authenticated `DELETE` (this plan assumes `X-OB-Request: 1`, following OA's `X-OA-Request: 1`), and `DELETE /api/v1/machines/:id` answering `204` on success and `404` when the machine is unknown *or already revoked*.

## File structure

```
apps/dashboard/
  index.html                      (F1)
  vite.config.ts                  (F1; + msw worker drop, Task FE4)
  playwright.config.ts            (new, FE8)
  public/mockServiceWorker.js     (generated, Task FE4)
  e2e/
    a11y.spec.ts                  (new, FE8)
    agents.spec.ts                (new, FE8)
    machines.spec.ts              (new, FE8)
  src/
    main.tsx                      (F1; + mock bootstrap, FE4)
    router.tsx                    (new, FE5)
    styles.css                    (F1; Design owns tokens)
    api/
      contract.ts                 (new, FE1)  the only @ob/shared REST import
      client.ts                   (new, FE1)  fetch + typed errors + CSRF header
      qk.ts                       (new, FE1)  query keys
      queries.ts                  (new, FE2)  useMe/useMachines/useAgents/useRevokeMachine
    live/
      busEvents.ts                (new, FE3)  pure reducer + WebSocket runner (was EventSource; manager ruling 2026-10-24)
      useBusEvents.ts             (new, FE3)  hook: patches caches, live flag
    layout/
      AppLayout.tsx               (new, FE5)  header, nav, sign-in gate
      useDocumentTitle.ts         (new, FE5)
    pages/
      SignIn.tsx                  (new, FE5)  Design restyles; links to AUTH.login
      NotFound.tsx                (new, FE5)
    machines/
      Machines.tsx                (new, FE6)
      MachineRow.tsx              (new, FE6)
      RevokeDialog.tsx            (new, FE6)
    agents/
      Agents.tsx                  (new, FE7)
      AgentRow.tsx                (new, FE7)
      ClaimBadge.tsx              (shipped in src/ui, FE7; replaces LiveChip)
    mocks/
      fixtures.ts                 (new, FE4)
      handlers.ts                 (new, FE4)
      browser.ts                  (new, FE4)  VITE_MOCK=1 bootstrap + window.__obMock
      global.d.ts                 (new, FE4)
  test/
    harness.tsx                   (new or F1) msw server, fetch shim, mount()
    fakeWebSocket.ts              (FE3; was fakeEventSource.ts, manager ruling 2026-10-24)
    client.test.ts                (FE1)
    queries.test.tsx              (FE2)
    bus-events.test.ts            (FE3)
    mocks.test.ts                 (FE4)
    shell.test.tsx                (FE5)
    machines.test.tsx             (FE6)
    agents.test.tsx               (FE7)
```

---

### Task FE0: Worktree and scaffold check

**Files:** none (verification only)

- [x] **Step 1: Create the worktree** (only once F1 is on `origin/main`)

```bash
cd ~/code/projects/openbus
git fetch origin
git worktree add ~/code/projects/openbus-fe -b fe/fe0-scaffold-check origin/main
cd ~/code/projects/openbus-fe && pnpm install
```

- [x] **Step 2: Record the real package names and scripts**

```bash
cat package.json | head -30
cat apps/dashboard/package.json
ls packages/shared/src packages/ui/src
```

Expected: a pnpm workspace with `apps/dashboard`, `packages/shared`, `packages/ui`. Write the **actual** names into a scratch note; this plan says `@ob/dashboard`, `@ob/shared`, `@ob/ui`. If they differ, substitute everywhere and say so in the PR body.

- [x] **Step 3: Confirm the dashboard runs**

```bash
pnpm --filter @ob/dashboard dev    # expect Vite on :5173 and an empty shell
pnpm --filter @ob/dashboard test   # expect the F1 smoke test to pass
pnpm --filter @ob/dashboard typecheck
```

Expected: all three succeed. If `test` or `typecheck` scripts are missing, add them to `apps/dashboard/package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [x] **Step 4: Confirm the F2 exports exist**

```bash
grep -rn "MachinesResponseSchema\|AgentsResponseSchema\|BusEvent\|const R =" packages/shared/src | head -20
```

Expected: the shapes in **Contract the FE needs from F2** exist. Missing ones are a message to `OpenBus Backend`, not a workaround in `packages/shared`. `BusEventSchema` is the likeliest gap and has a defined fallback in Task FE1.

- [x] **Step 5: Commit**

```bash
git commit --allow-empty -m "chore(dashboard): start the frontend track"
```

---

### Task FE1: API contract, client and query keys

**Files:**
- Create: `apps/dashboard/src/api/contract.ts`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/qk.ts`
- Test: `apps/dashboard/test/client.test.ts`

- [x] **Step 1: Write the failing test**

`apps/dashboard/test/client.test.ts`:

```ts
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { z } from "zod";
import { ApiClientError, api } from "../src/api/client";
import { BusEventSchema } from "../src/api/contract";
import { installHarness, server } from "./harness";

installHarness();

const wire = (body: unknown, status = 200) => HttpResponse.json(body, { status });

test("parses a valid body through its schema", async () => {
  server.use(http.get("*/api/v1/me", () => wire({ user: { id: "u1" } })));
  const me = await api.get("/api/v1/me", z.object({ user: z.object({ id: z.string() }) }));
  expect(me.user.id).toBe("u1");
});

test("a 404 becomes ApiClientError(not_found) carrying the server message", async () => {
  server.use(
    http.delete("*/api/v1/machines/m1", () =>
      HttpResponse.json({ error: { code: "not_found", message: "No such machine" } }, { status: 404 }),
    ),
  );
  const err = await api.send("DELETE", "/api/v1/machines/m1").catch((e) => e);
  expect(err).toBeInstanceOf(ApiClientError);
  expect(err).toMatchObject({ code: "not_found", status: 404, message: "No such machine" });
});

test("mutations carry the CSRF header", async () => {
  let seen: string | null = null;
  server.use(
    http.delete("*/api/v1/machines/m1", ({ request }) => {
      seen = request.headers.get("X-OB-Request");
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await api.send("DELETE", "/api/v1/machines/m1");
  expect(seen).toBe("1");
});

test("an unparseable body is an internal error, not a crash", async () => {
  server.use(http.get("*/api/v1/me", () => wire({ nope: true })));
  const err = await api.get("/api/v1/me", z.object({ user: z.string() })).catch((e) => e);
  expect(err).toMatchObject({ code: "internal" });
});

test("BusEventSchema accepts a snapshot frame and rejects an unknown type", () => {
  expect(BusEventSchema.safeParse({ type: "agents", agents: [] }).success).toBe(true);
  expect(BusEventSchema.safeParse({ type: "wat" }).success).toBe(false);
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ob/dashboard test -- client.test.ts
```

Expected: FAIL — cannot resolve `../src/api/client`.

- [x] **Step 3: Create the contract file**

`apps/dashboard/src/api/contract.ts` — the single place the FE names F2's REST schemas:

```ts
/**
 * The FE's view of the F2 contract (packages/shared). Everything the dashboard
 * imports from @ob/shared for REST lives here, so a rename is one edit.
 */
import { z } from "zod";

export {
  AgentKindSchema,
  AgentSchema,
  AgentsResponseSchema,
  MachineSchema,
  MachinesResponseSchema,
  McpErrorSchema as ErrorSchema,
  MeSchema,
  R,
} from "@ob/shared";

export type { Agent, AgentKind, Machine, Me } from "@ob/shared";

/**
 * One frame on the /api/v1/events WebSocket (a JSON text frame; was SSE, manager ruling 2026-10-24). Snapshots, not deltas:
 * the hub sends the full list it wants the page to show. `hello` only means
 * "the stream is up"; the hook waits for the greeting snapshots that follow it and refetches only a list whose snapshot doesn't arrive (manager ruling 2026-10-24).
 * Close codes: 1013 evicted (16 sockets per owner, oldest goes) and 1011 send failure reconnect with backoff; 4401 session ended signs out (manager ruling 2026-10-24).
 * The hub throttles snapshots to at most one per 500 ms (manager ruling 2026-10-24).
 *
 * If F2 ships its own event schema, delete this and re-export theirs.
 */
export const BusEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({ type: z.literal("machines"), machines: z.array(MachineSchema) }),
  z.object({ type: z.literal("agents"), agents: z.array(AgentSchema) }),
]);
export type BusEvent = z.infer<typeof BusEventSchema>;
```

If `McpErrorSchema` is not F2's error name, drop that line and let `client.ts` parse loosely (it does).

- [x] **Step 4: Create the client**

`apps/dashboard/src/api/client.ts`:

```ts
import type { z } from "zod";

/** Server error codes we show copy for; anything else falls back to the message. */
export type ClientErrorCode =
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "internal"
  | "network";

export class ApiClientError extends Error {
  code: ClientErrorCode;
  status: number;
  constructor(code: ClientErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

/** Cookie-authenticated mutations need this header (Backend's csrf()). */
export const CSRF_HEADER = "X-OB-Request";

const KNOWN: readonly string[] = [
  "unauthorized",
  "not_found",
  "bad_request",
  "rate_limited",
  "internal",
];

/** Accepts `{error:{code,message}}` (OA's shape) or `{code,message}`. */
function toError(text: string, status: number): ApiClientError {
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {}
  const box = (raw as { error?: unknown })?.error ?? raw;
  const code = (box as { code?: unknown })?.code;
  const message = (box as { message?: unknown })?.message;
  let out: ClientErrorCode = "internal";
  if (typeof code === "string" && KNOWN.includes(code)) out = code as ClientErrorCode;
  else if (status === 401) out = "unauthorized";
  return new ApiClientError(
    out,
    typeof message === "string" && message ? message : `Unexpected response (HTTP ${status})`,
    status,
  );
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiClientError("network", "Couldn't reach the bus.", 0);
  }
  if (res.ok) return res;
  throw toError(await res.text().catch(() => ""), res.status);
}

async function parse<T>(res: Response, schema: z.ZodType<T> | undefined): Promise<T> {
  if (!schema || res.status === 204) return undefined as T;
  const out = schema.safeParse(await res.json().catch(() => null));
  if (out.success) return out.data;
  const fields = [...new Set(out.error.issues.map((i) => i.path.join(".") || "(root)"))];
  throw new ApiClientError("internal", `Invalid response: ${fields.join(", ")}`, res.status);
}

export const api = {
  async get<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return parse(await request(path, { method: "GET", signal }), schema);
  },
  async send<T = void>(
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = { [CSRF_HEADER]: "1" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    return parse(res, schema);
  },
};
```

- [x] **Step 5: Create the query keys**

`apps/dashboard/src/api/qk.ts`:

```ts
/** Every cache key the dashboard uses. The SSE hook writes these directly. */
export const qk = {
  me: ["me"] as const,
  machines: ["machines"] as const,
  agents: ["agents"] as const,
};
```

- [x] **Step 6: Add the test's MSW server**

If F1 has no `test/harness.tsx`, create it (Task FE5 adds `mount`):

`apps/dashboard/test/harness.tsx`:

```tsx
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const server = setupServer();

/** Registers msw for a test file. `onUnhandledRequest: "error"` catches typo'd paths. */
export const installHarness = () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => server.close());
  afterEach(() => server.resetHandlers());
};
```

- [x] **Step 7: Run the test to verify it passes**

```bash
pnpm --filter @ob/dashboard test -- client.test.ts
pnpm --filter @ob/dashboard typecheck
```

Expected: 5 passing; typecheck clean.

- [x] **Step 8: Commit**

```bash
git add apps/dashboard/src/api apps/dashboard/test/client.test.ts apps/dashboard/test/harness.tsx
git commit -m "feat(dashboard): API client, contract and query keys"
```

---

### Task FE2: Queries, including optimistic revoke

**Files:**
- Create: `apps/dashboard/src/api/queries.ts`
- Test: `apps/dashboard/test/queries.test.tsx`

- [x] **Step 1: Write the failing test**

`apps/dashboard/test/queries.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { makeQueryClient } from "../src/api/queryClient";
import { useMachines, useRevokeMachine } from "../src/api/queries";
import { installHarness, server } from "./harness";

installHarness();

const machines = [
  { id: "m1", label: "studio-mbp", createdAt: "2026-10-21T10:00:00Z", lastUsed: null, revokedAt: null },
];

const wrap = (client = makeQueryClient()) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

test("useMachines loads the list", async () => {
  server.use(http.get("*/api/v1/machines", () => HttpResponse.json({ machines })));
  const { wrapper } = wrap();
  const { result } = renderHook(() => useMachines(), { wrapper });
  await waitFor(() => expect(result.current.data?.machines).toHaveLength(1));
  expect(result.current.data?.machines?.[0]?.label).toBe("studio-mbp");
});

test("revoke marks the row revoked before the server answers", async () => {
  server.use(
    http.get("*/api/v1/machines", () => HttpResponse.json({ machines })),
    http.delete("*/api/v1/machines/m1", () => new Promise((r) => setTimeout(() => r(new HttpResponse(null, { status: 204 })), 50))),
  );
  const { client, wrapper } = wrap();
  const { result: list } = renderHook(() => useMachines(), { wrapper });
  await waitFor(() => expect(list.current.data).toBeDefined());
  const revoke = renderHook(() => useRevokeMachine(), { wrapper });

  await act(async () => {
    void revoke.result.current.mutateAsync("m1");
  });
  await waitFor(() =>
    expect(client.getQueryData<{ machines: typeof machines }>(["machines"])?.machines[0]?.revokedAt).not.toBeNull(),
  );
  await waitFor(() => expect(revoke.result.current.isSuccess).toBe(true));
});

test("a failed revoke rolls the row back", async () => {
  server.use(
    http.get("*/api/v1/machines", () => HttpResponse.json({ machines })),
    http.delete("*/api/v1/machines/m1", () =>
      HttpResponse.json({ error: { code: "internal", message: "Boom" } }, { status: 500 }),
    ),
  );
  const { client, wrapper } = wrap();
  const { result: list } = renderHook(() => useMachines(), { wrapper });
  await waitFor(() => expect(list.current.data).toBeDefined());
  const revoke = renderHook(() => useRevokeMachine(), { wrapper });

  await act(async () => {
    await revoke.result.current.mutateAsync("m1").catch(() => {});
  });
  const row = client.getQueryData<{ machines: typeof machines }>(["machines"])?.machines[0];
  expect(row?.revokedAt).toBeNull();
});

test("a 404 on revoke is success: the machine was already revoked", async () => {
  server.use(
    http.get("*/api/v1/machines", () => HttpResponse.json({ machines })),
    http.delete("*/api/v1/machines/m1", () =>
      HttpResponse.json({ error: { code: "not_found", message: "No such machine" } }, { status: 404 }),
    ),
  );
  const { wrapper } = wrap();
  const { result: list } = renderHook(() => useMachines(), { wrapper });
  await waitFor(() => expect(list.current.data).toBeDefined());
  const revoke = renderHook(() => useRevokeMachine(), { wrapper });

  await act(async () => {
    await revoke.result.current.mutateAsync("m1");
  });
  expect(revoke.result.current.isSuccess).toBe(true);
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ob/dashboard test -- queries.test.tsx
```

Expected: FAIL — cannot resolve `../src/api/queries`.

- [x] **Step 3: Create `queryClient.ts` if F1 has none**

`apps/dashboard/src/api/queryClient.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "./client";

/** 4xx never retries (a revoked session just re-loops); otherwise at most twice. */
export const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
};

export const makeQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });
```

- [x] **Step 4: Create the queries**

`apps/dashboard/src/api/queries.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@ob/ui/shadcn";
import { ApiClientError, api } from "./client";
import {
  type Agent,
  AgentsResponseSchema,
  type Machine,
  MachinesResponseSchema,
  MeSchema,
  R,
} from "./contract";
import { qk } from "./qk";

export type MachinesData = { machines: Machine[] };
export type AgentsData = { agents: Agent[] };

export const useMe = () =>
  useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => api.get(R.me, MeSchema, signal),
    staleTime: 60_000,
    retry: false,
  });

export const useMachines = () =>
  useQuery({
    queryKey: qk.machines,
    queryFn: ({ signal }) => api.get(R.machines, MachinesResponseSchema, signal),
    staleTime: 10_000,
  });

export const useAgents = () =>
  useQuery({
    queryKey: qk.agents,
    queryFn: ({ signal }) => api.get(R.agents, AgentsResponseSchema, signal),
    staleTime: 10_000,
  });

/**
 * DELETE /api/v1/machines/:id. Optimistic: the row shows as revoked at once.
 * A 404 means the machine was already revoked (another tab, a double click),
 * which is the same end state, so it is success rather than an error.
 */
export const useRevokeMachine = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await api.send("DELETE", R.machine(id));
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) return;
        throw e;
      }
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.machines });
      const before = qc.getQueryData<MachinesData>(qk.machines);
      const at = new Date().toISOString();
      if (before)
        qc.setQueryData<MachinesData>(qk.machines, {
          machines: before.machines.map((m) => (m.id === id ? { ...m, revokedAt: at } : m)),
        });
      return { before };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.before) qc.setQueryData(qk.machines, ctx.before);
      toast({
        title: "Couldn't revoke that machine",
        description: e instanceof ApiClientError ? e.message : "Try again.",
      });
    },
    onSuccess: () => {
      toast({ title: "Machine revoked", description: "Its agents left the roster." });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.machines });
      void qc.invalidateQueries({ queryKey: qk.agents });
    },
  });
};
```

If `toast` is not exported by `@ob/ui/shadcn`, use `sonner`'s `toast.error` and `toast.success` directly; the test does not assert on toasts.

- [x] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @ob/dashboard test -- queries.test.tsx
```

Expected: 4 passing.

- [x] **Step 6: Commit**

```bash
git add apps/dashboard/src/api apps/dashboard/test/queries.test.tsx
git commit -m "feat(dashboard): machines, agents and me queries with optimistic revoke"
```

---

### Task FE3: The live stream (reducer, runner, hook)

**Files:**
- Create: `apps/dashboard/src/live/busEvents.ts`, `apps/dashboard/src/live/useBusEvents.ts`, `apps/dashboard/test/fakeEventSource.ts`
- Test: `apps/dashboard/test/bus-events.test.ts`

- [x] **Step 1: Write the failing test**

`apps/dashboard/test/fakeEventSource.ts`:

```ts
/**
 * jsdom has no EventSource. This fake records instances and lets a test push
 * frames or fail the connection. Installed at module scope by the tests that
 * need it, and removed again in `afterEach`.
 */
export class FakeEventSource {
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  /** Server-side frame. */
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  fail() {
    this.onerror?.({});
  }
}

export const installFakeEventSource = () => {
  FakeEventSource.all = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  return () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  };
};

export const lastSource = () => FakeEventSource.all.at(-1)!;
```

`apps/dashboard/test/bus-events.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { type BusEventsOptions, connectBusEvents, patchFor } from "../src/live/busEvents";
import { FakeEventSource, installFakeEventSource, lastSource } from "./fakeEventSource";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  vi.useRealTimers();
});

/** Connect and let the deferred open (a 0 ms timer, so StrictMode can't connect) fire. */
const start = (opts: BusEventsOptions) => {
  const c = connectBusEvents(opts);
  vi.advanceTimersByTime(0);
  return c;
};

const agent = {
  id: "a1", namespace: "repo:github.com/acme/app", name: "claude-1", kind: "claude-code" as const,
  machineId: "m1", machineLabel: "studio-mbp", global: false, live: true, updatedAt: "2026-10-21T10:00:00Z",
};

test("patchFor maps snapshots and refuses frames it does not know", () => {
  expect(patchFor({ type: "agents", agents: [agent] })).toEqual({ agents: [agent] });
  expect(patchFor({ type: "hello" })).toBeNull();
  expect(patchFor({ type: "agent_up" } as never)).toBeNull();
});

test("hello refetches, snapshots patch", () => {
  vi.useFakeTimers();
  restore = installFakeEventSource();
  const onHello = vi.fn();
  const onSnapshot = vi.fn();
  const c = start({ onHello, onSnapshot, onDown: vi.fn(), onUnknown: vi.fn() });
  const es = lastSource();
  expect(es.url).toBe("/api/v1/events");
  es.push({ type: "hello" });
  expect(onHello).toHaveBeenCalledOnce();
  es.push({ type: "agents", agents: [agent] });
  expect(onSnapshot).toHaveBeenCalledWith({ agents: [agent] });
  c.close();
});

test("an unknown frame type asks for a refetch instead of guessing", () => {
  vi.useFakeTimers();
  restore = installFakeEventSource();
  const onUnknown = vi.fn();
  start({ onHello: vi.fn(), onSnapshot: vi.fn(), onDown: vi.fn(), onUnknown });
  lastSource().push({ type: "roster_changed" });
  expect(onUnknown).toHaveBeenCalledOnce();
});

test("a drop after hello reconnects with backoff", () => {
  vi.useFakeTimers();
  restore = installFakeEventSource();
  const onDown = vi.fn();
  start({ onHello: vi.fn(), onSnapshot: vi.fn(), onDown, onUnknown: vi.fn() });
  lastSource().push({ type: "hello" });
  lastSource().fail();
  expect(onDown).toHaveBeenCalledOnce();
  expect(FakeEventSource.all).toHaveLength(1);
  vi.advanceTimersByTime(1_000);
  expect(FakeEventSource.all).toHaveLength(2);
});

test("a failure before the first hello waits for retry(), not a storm", () => {
  vi.useFakeTimers();
  restore = installFakeEventSource();
  const c = start({ onHello: vi.fn(), onSnapshot: vi.fn(), onDown: vi.fn(), onUnknown: vi.fn() });
  lastSource().fail();
  vi.advanceTimersByTime(60_000);
  expect(FakeEventSource.all).toHaveLength(1);
  c.retry();
  expect(FakeEventSource.all).toHaveLength(2);
  c.close();
});

test("close stops reconnecting", () => {
  vi.useFakeTimers();
  restore = installFakeEventSource();
  const c = start({ onHello: vi.fn(), onSnapshot: vi.fn(), onDown: vi.fn(), onUnknown: vi.fn() });
  lastSource().push({ type: "hello" });
  c.close();
  lastSource().fail();
  vi.advanceTimersByTime(60_000);
  expect(FakeEventSource.all).toHaveLength(1);
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ob/dashboard test -- bus-events.test.ts
```

Expected: FAIL — cannot resolve `../src/live/busEvents`.

- [x] **Step 3: Write the reducer and runner**

`apps/dashboard/src/live/busEvents.ts`:

```ts
import { type Agent, type BusEvent, BusEventSchema, type Machine, R } from "../api/contract";

const BASE_MS = 1_000;
const CAP_MS = 30_000;

export type Snapshot = { machines: Machine[] } | { agents: Agent[] };

/**
 * What to do with one frame: a snapshot to write into the cache, or null for
 * "don't guess" (hello, or a type this build doesn't know). The hook refetches
 * on null, so a deploy that adds frame types can never strand stale rows.
 */
export function patchFor(e: BusEvent): Snapshot | null {
  if (e.type === "machines") return { machines: e.machines };
  if (e.type === "agents") return { agents: e.agents };
  return null;
}

export type BusEventsOptions = {
  onHello(): void;
  onSnapshot(s: Snapshot): void;
  /** The stream dropped or never opened; the lists on screen are now stale. */
  onDown(): void;
  onUnknown(): void;
};

/**
 * One EventSource for the page. We do our own backoff instead of the browser's
 * built-in retry, so a 401 (a signed-out session) stops instead of hammering:
 * a failure before the first `hello` parks the stream until `retry()`.
 */
export function connectBusEvents(opts: BusEventsOptions) {
  let es: EventSource | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let idle = false;
  let hello = false;

  const schedule = () => {
    const delay = Math.min(CAP_MS, BASE_MS * 2 ** attempt++);
    timer = setTimeout(open, delay);
  };

  const open = () => {
    if (stopped) return;
    idle = false;
    const sock = new EventSource(R.events);
    es = sock;
    sock.onopen = () => {
      attempt = 0;
    };
    sock.onmessage = (m) => {
      if (es !== sock || typeof m.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(m.data);
      } catch {
        return;
      }
      const f = BusEventSchema.safeParse(raw);
      if (!f.success) return;
      if (f.data.type === "hello") {
        hello = true;
        attempt = 0;
        opts.onHello();
        return;
      }
      const p = patchFor(f.data);
      if (p) opts.onSnapshot(p);
      else opts.onUnknown();
    };
    sock.onerror = () => {
      if (es !== sock || stopped) return;
      es = null;
      sock.close();
      opts.onDown();
      if (!hello) {
        idle = true;
        return;
      }
      schedule();
    };
  };

  timer = setTimeout(open, 0);
  return {
    /** After a failed connect (a sleep, a focus): one more try now. */
    retry() {
      if (stopped || !idle) return;
      open();
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      const s = es;
      es = null;
      s?.close();
    },
  };
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ob/dashboard test -- bus-events.test.ts
```

Expected: 6 passing.

- [x] **Step 5: Write the hook (no test of its own; FE7 covers it end to end)**

`apps/dashboard/src/live/useBusEvents.ts`:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { qk } from "../api/qk";
import { connectBusEvents } from "./busEvents";

/**
 * Keeps the machines and agents caches current from /api/v1/events.
 * `live` is false while the stream is down: the page shows a chip, the data
 * on screen stays (the initial GET is the source of truth on every mount).
 */
export function useBusEvents() {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  useEffect(() => {
    const refetchBoth = () => {
      void qc.invalidateQueries({ queryKey: qk.machines });
      void qc.invalidateQueries({ queryKey: qk.agents });
    };
    const events = connectBusEvents({
      onHello: () => {
        setLive(true);
        refetchBoth();
      },
      onSnapshot: (s) => {
        setLive(true);
        if ("machines" in s) qc.setQueryData(qk.machines, { machines: s.machines });
        else qc.setQueryData(qk.agents, { agents: s.agents });
      },
      onDown: () => setLive(false),
      onUnknown: refetchBoth,
    });
    const onFocus = () => events.retry();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      events.close();
    };
  }, [qc]);

  return { live };
}
```

- [x] **Step 6: Commit**

```bash
git add apps/dashboard/src/live apps/dashboard/test/fakeEventSource.ts apps/dashboard/test/bus-events.test.ts
git commit -m "feat(dashboard): SSE client that patches the machines and agents caches"
```

---

### Task FE4: Browser mocks (dev and e2e)

**Files:**
- Create: `apps/dashboard/src/mocks/fixtures.ts`, `apps/dashboard/src/mocks/handlers.ts`, `apps/dashboard/src/mocks/browser.ts`, `apps/dashboard/src/mocks/global.d.ts`, `apps/dashboard/public/mockServiceWorker.js`
- Modify: `apps/dashboard/src/main.tsx`, `apps/dashboard/vite.config.ts`
- Test: `apps/dashboard/test/mocks.test.ts`

- [x] **Step 1: Write the failing test**

`apps/dashboard/test/mocks.test.ts`:

```ts
import { expect, test } from "vitest";
import { createMockBus } from "../src/mocks/handlers";
import { fixtures } from "../src/mocks/fixtures";

test("the fixtures cover two machines, two namespaces, a global agent and a revoked one", () => {
  expect(new Set(fixtures.machines.map((m) => m.id)).size).toBe(2);
  expect(new Set(fixtures.agents.map((a) => a.namespace)).size).toBe(2);
  expect(fixtures.agents.some((a) => a.global)).toBe(true);
  expect(fixtures.machines.some((m) => m.revokedAt)).toBe(true);
});

test("revoking a machine drops its agents and tells the stream", async () => {
  const bus = createMockBus();
  const seen: unknown[] = [];
  const off = bus.subscribe((e) => seen.push(e));

  const res = await bus.revoke("studio-mbp");
  expect(res.status).toBe(204);
  expect(bus.machines().find((m) => m.id === "studio-mbp")?.revokedAt).not.toBeNull();
  expect(bus.agents().some((a) => a.machineId === "studio-mbp")).toBe(false);
  expect(seen).toEqual([
    { type: "agents", agents: bus.agents() },
    { type: "machines", machines: bus.machines() },
  ]);

  // Second revoke: already revoked is 404, as the API says.
  expect((await bus.revoke("studio-mbp")).status).toBe(404);
  off();
});

test("events are per subscriber and unsubscribe cleanly", () => {
  const bus = createMockBus();
  const a: unknown[] = [];
  const b: unknown[] = [];
  const offA = bus.subscribe((e) => a.push(e));
  bus.subscribe((e) => b.push(e));
  bus.push({ type: "hello" });
  offA();
  bus.push({ type: "hello" });
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(2);
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ob/dashboard test -- mocks.test.ts
```

Expected: FAIL — cannot resolve `../src/mocks/handlers`.

- [x] **Step 3: Write the fixtures**

`apps/dashboard/src/mocks/fixtures.ts` — shaped by the F2 schemas, checked at import:

```ts
import { AgentSchema, MachineSchema } from "../api/contract";

const machine = (m: unknown) => MachineSchema.parse(m);
const agent = (a: unknown) => AgentSchema.parse(a);

const T = "2026-10-21T10:00:00.000Z";

export const fixtures = {
  machines: [
    machine({ id: "m1", label: "studio-mbp", createdAt: T, lastUsed: "2026-10-21T09:58:00.000Z", revokedAt: null }),
    machine({ id: "m2", label: "old-thinkpad", createdAt: T, lastUsed: null, revokedAt: "2026-10-20T12:00:00.000Z" }),
  ],
  agents: [
    agent({ id: "a1", namespace: "repo:github.com/acme/app", name: "claude-1", kind: "claude-code", machineId: "m1", machineLabel: "studio-mbp", global: false, live: true, updatedAt: T }),
    agent({ id: "a2", namespace: "repo:github.com/acme/app", name: "opencode-1", kind: "opencode", machineId: "m1", machineLabel: "studio-mbp", global: false, live: false, updatedAt: T }),
    agent({ id: "a3", namespace: "repo:github.com/acme/docs", name: "scout", kind: "pi", machineId: "m1", machineLabel: "studio-mbp", global: true, live: true, updatedAt: T }),
  ],
  me: { user: { id: "u1", email: "ada@example.com", name: "Ada Lovelace" } },
};
```

If the F2 `AgentSchema` uses `lastSeen` rather than `updatedAt`, change only these three lines.

- [x] **Step 4: Write the mock bus and handlers**

`apps/dashboard/src/mocks/handlers.ts`:

```ts
import { type Agent, type BusEvent, type Machine } from "../api/contract";
import { fixtures } from "./fixtures";

/**
 * Mutable mock state plus the frame bus the SSE handler and the e2e hook share.
 * Revoke here mirrors the hub: the machine keeps its row, its agents go.
 */
export function createMockBus() {
  let machines: Machine[] = structuredClone(fixtures.machines);
  let agents: Agent[] = structuredClone(fixtures.agents);
  const subscribers = new Set<(e: BusEvent) => void>();

  const push = (e: BusEvent) => {
    for (const fn of subscribers) fn(e);
  };

  return {
    machines: () => machines,
    agents: () => agents,
    push,
    subscribe(fn: (e: BusEvent) => void) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    /** Mirrors DELETE /api/v1/machines/:id: 204, or 404 when unknown/already revoked. */
    async revoke(id: string) {
      const m = machines.find((x) => x.id === id);
      if (!m || m.revokedAt) return new Response(null, { status: 404 });
      machines = machines.map((x) => (x.id === id ? { ...x, revokedAt: new Date().toISOString() } : x));
      agents = agents.filter((a) => a.machineId !== id);
      push({ type: "agents", agents });
      push({ type: "machines", machines });
      return new Response(null, { status: 204 });
    },
    /** Test/dev hook: pretend the hub announced a new roster. */
    setAgents(next: Agent[]) {
      agents = next;
      push({ type: "agents", agents });
    },
  };
}

export type MockBus = ReturnType<typeof createMockBus>;

/** The MSW handlers for one bus. `revoke` is reachable from tests, too. */
export function handlersFor(bus: MockBus, origin = "") {
  void origin;
  return [];
}
```

Replace `handlersFor` with the real thing in the next step; the test above only needs `createMockBus`.

- [x] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @ob/dashboard test -- mocks.test.ts
```

Expected: 3 passing.

- [x] **Step 6: Wire MSW handlers (HTTP + SSE)**

Replace `handlersFor` in `apps/dashboard/src/mocks/handlers.ts` with:

```ts
import { HttpResponse, http } from "msw";

/** HTTP handlers: me, machines, agents, revoke, and the SSE stream. */
export function handlersFor(bus: MockBus) {
  const json = (body: unknown) => HttpResponse.json(body);
  return [
    http.get("*/api/v1/me", () => json(fixtures.me)),
    http.get("*/api/v1/machines", () => json({ machines: bus.machines() })),
    http.get("*/api/v1/agents", ({ request }) => {
      const ns = new URL(request.url).searchParams.get("namespace");
      const all = bus.agents();
      return json({ agents: ns ? all.filter((a) => a.namespace === ns) : all });
    }),
    http.delete("*/api/v1/machines/:id", ({ params }) => bus.revoke(String(params.id))),
    http.get("*/api/v1/events", () => {
      const enc = new TextEncoder();
      let off: (() => void) | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const send = (e: BusEvent) => {
            try {
              controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
            } catch {
              /* the client went away */
            }
          };
          off = bus.subscribe(send);
          send({ type: "hello" });
        },
        cancel() {
          off?.();
        },
      });
      return new HttpResponse(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
      });
    }),
  ];
}
```

Add a test to `mocks.test.ts` for the HTTP surface:

```ts
import { handlersFor } from "../src/mocks/handlers";
import { installHarness, server } from "./harness";

installHarness();

test("GET /api/v1/agents and DELETE /api/v1/machines/:id answer like the API", async () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const list = await (await fetch("http://localhost/api/v1/agents")).json();
  expect(list.agents).toHaveLength(3);
  const del = await fetch("http://localhost/api/v1/machines/m1", { method: "DELETE" });
  expect(del.status).toBe(204);
  const after = await (await fetch("http://localhost/api/v1/agents")).json();
  expect(after.agents).toHaveLength(1);
});
```

(The `handlersFor` import is already at the top of `mocks.test.ts` by then; do not duplicate it.)

- [x] **Step 7: Write the browser bootstrap**

`apps/dashboard/src/mocks/global.d.ts`:

```ts
import type { MockBus } from "./handlers";

declare global {
  interface Window {
    /** VITE_MOCK only: the mock bus, so an e2e test can push roster frames. */
    __obMock?: MockBus;
  }
}
```

`apps/dashboard/src/mocks/browser.ts`:

```ts
import { setupWorker } from "msw/browser";
import { createMockBus, handlersFor } from "./handlers";

/**
 * Dev and e2e only (`VITE_MOCK=1`). Exposes the bus on `window.__obMock` so a
 * Playwright test can push a roster frame without a real hub.
 */
export async function startMocks() {
  const bus = createMockBus();
  const worker = setupWorker(...handlersFor(bus));
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
  window.__obMock = bus;
}
```

- [x] **Step 8: Call it from `main.tsx`**

At the top of `apps/dashboard/src/main.tsx`, before rendering:

```ts
if (import.meta.env.VITE_MOCK === "1") {
  const { startMocks } = await import("./mocks/browser");
  await startMocks();
}
```

`main.tsx` must therefore be an async module or wrap the render in a promise:

```ts
async function boot() {
  if (import.meta.env.VITE_MOCK === "1") {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />,
    </StrictMode>,
  );
}
void boot();
```

- [x] **Step 9: Generate the service worker and keep it out of production builds**

```bash
pnpm --filter @ob/dashboard exec msw init public --save
```

Add to `apps/dashboard/vite.config.ts` (inside `plugins`), copying OA's guard:

```ts
{
  // The MSW worker is a dev/e2e artifact; never ship it.
  name: "ob-drop-mock-worker",
  apply: "build",
  closeBundle() {
    rmSync(new URL("./dist/mockServiceWorker.js", import.meta.url), { force: true });
  },
}
```

- [x] **Step 10: Verify dev and the tests**

```bash
pnpm --filter @ob/dashboard test -- mocks.test.ts
pnpm exec biome check --write apps/dashboard/src/mocks apps/dashboard/test
VITE_MOCK=1 pnpm --filter @ob/dashboard dev &
curl -s localhost:5173/api/v1/machines   # expect both fixtures
```

Expected: tests pass; biome sorts the imports in the mock files; dev serves two machines; `curl` answers JSON through the worker.

- [x] **Step 11: Commit**

```bash
git add apps/dashboard/src/mocks apps/dashboard/public/mockServiceWorker.js apps/dashboard/src/main.tsx apps/dashboard/vite.config.ts apps/dashboard/test/mocks.test.ts
git commit -m "feat(dashboard): mock bus for dev and e2e, with a streaming SSE endpoint"
```

---

### Task FE5: Shell, routes and sign-in hand-off

**Files:**
- Create: `apps/dashboard/src/router.tsx`, `src/layout/AppLayout.tsx`, `src/layout/useDocumentTitle.ts`, `src/pages/SignIn.tsx`, `src/pages/NotFound.tsx`
- Modify: `apps/dashboard/src/main.tsx` (render `<RouterProvider>`)
- Test: `apps/dashboard/test/shell.test.tsx`

- [x] **Step 1: Write the failing test**

`apps/dashboard/test/shell.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { makeQueryClient } from "../src/api/queryClient";
import { createAppRouter } from "../src/router";
import { fixtures } from "../src/mocks/fixtures";
import { handlersFor, createMockBus } from "../src/mocks/handlers";
import { installHarness, server } from "./harness";

installHarness();

const mount = (path: string) =>
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: [path] }))} />
    </QueryClientProvider>,
  );

test("an anonymous visitor gets the sign-in page, not an empty dashboard", async () => {
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({ error: { code: "unauthorized", message: "Sign in" } }, { status: 401 }),
    ),
  );
  mount("/");
  expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /continue with cloudflare/i })).toHaveAttribute(
    "href",
    expect.stringContaining("/auth/login"),
  );
});

test("a signed-in visitor sees the machines page", async () => {
  server.use(...handlersFor(createMockBus()));
  mount("/");
  expect(await screen.findByRole("heading", { name: "Machines" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/agents");
});

test("an unknown path is a 404 inside the shell", async () => {
  server.use(...handlersFor(createMockBus()));
  mount("/nope");
  expect(await screen.findByText(/not found/i)).toBeInTheDocument();
});
```

Add `test/setup.ts` if F1 has none. jsdom has no `EventSource`, and every mounted page opens one, so the setup installs the fake from Task FE3 and clears it per test:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { FakeEventSource } from "./fakeEventSource";

afterEach(() => {
  cleanup();
  FakeEventSource.all = [];
});

globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

if (!window.matchMedia)
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
```

`FakeEventSource` is created in Task FE3, so if FE5 runs first, write `test/fakeEventSource.ts` from FE3 Step 1 now.

- [x] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ob/dashboard test -- shell.test.tsx
```

Expected: FAIL — cannot resolve `../src/router`.

- [x] **Step 3: Write the pages**

`apps/dashboard/src/pages/SignIn.tsx` (Design replaces the markup; the link is the contract):

```tsx
import { AUTH } from "@ob/shared";
import { Button } from "@ob/ui/shadcn";
import { useDocumentTitle } from "../layout/useDocumentTitle";

/** Sign-in hands off to the Worker's OIDC start; the approval page is the Worker's too. */
export function SignIn({ failed = false }: { failed?: boolean }) {
  useDocumentTitle("Sign in");
  return (
    <main className="mx-auto mt-24 max-w-[400px] px-6">
      <h1 className="text-[length:var(--ob-text-xl,1.5rem)] font-semibold">Sign in</h1>
      <p className="mt-2 text-[color:var(--ob-text-2,#454c56)]">
        OpenBus is self-hosted. Sign in with the account your Access policy allows.
      </p>
      {failed && (
        <p role="alert" className="mt-4 text-[color:var(--ob-warn,#8a5a00)]">
          Sign-in didn't finish. Try again.
        </p>
      )}
      <Button asChild className="mt-6 w-full">
        <a href={`${AUTH.login}?next=${encodeURIComponent("/")}`}>Continue with Cloudflare Access</a>
      </Button>
    </main>
  );
}
```

`apps/dashboard/src/pages/NotFound.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { useDocumentTitle } from "../layout/useDocumentTitle";

export function NotFound() {
  useDocumentTitle("Not found");
  return (
    <main className="mx-auto mt-24 max-w-[400px] px-6">
      <h1 className="text-[length:var(--ob-text-xl,1.5rem)] font-semibold">Not found</h1>
      <p className="mt-2">That page isn't part of the bus.</p>
      <Link to="/" className="mt-6 inline-block underline">
        Back to machines
      </Link>
    </main>
  );
}
```

`apps/dashboard/src/layout/useDocumentTitle.ts`:

```ts
import { useEffect } from "react";

/** `<page> · OpenBus`, and back to the bare name on unmount. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = `${title} · OpenBus`;
    return () => {
      document.title = before;
    };
  }, [title]);
}
```

- [x] **Step 4: Write the layout**

`apps/dashboard/src/layout/AppLayout.tsx`:

```tsx
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMe } from "../api/queries";
import { SignIn } from "../pages/SignIn";

const TAB = "px-3 py-2 text-sm rounded-[var(--ob-radius-6,6px)] aria-[current=page]:bg-[var(--ob-surface-2,#f6f7f9)]";

/** Design owns the chrome; this keeps two tabs and one sign-in gate. */
export function AppLayout() {
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (me.isPending) return <div className="p-6 text-sm opacity-60">Loading…</div>;
  if (me.isError) {
    const unauthorized = (me.error as { status?: number })?.status === 401;
    return <SignIn failed={!unauthorized} />;
  }
  if (!me.data) return <SignIn />;

  return (
    <>
      <header className="flex items-center gap-4 border-b border-[var(--ob-divider,#e0e3e8)] px-6 py-3">
        <span className="font-semibold">OpenBus</span>
        <nav aria-label="Main" className="flex gap-1">
          <Link to="/" className={TAB} aria-current={path === "/" ? "page" : undefined}>
            Machines
          </Link>
          <Link to="/agents" className={TAB} aria-current={path === "/agents" ? "page" : undefined}>
            Agents
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-[880px] px-6 py-6">
        <Outlet />
      </main>
    </>
  );
}
```

- [x] **Step 5: Write the router**

`apps/dashboard/src/router.tsx`:

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { Agents } from "./agents/Agents";
import { AppLayout } from "./layout/AppLayout";
import { Machines } from "./machines/Machines";
import { NotFound } from "./pages/NotFound";
import { SignIn } from "./pages/SignIn";

const root = createRootRoute({ component: AppLayout, notFoundComponent: NotFound });
const route = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => root, path, component });

const routeTree = root.addChildren([
  route("/", Machines),
  route("/agents", Agents),
  route("/sign-in", () => <SignIn failed={new URLSearchParams(location.search).has("error")} />),
  route("*", NotFound),
]);

export const createAppRouter = (history?: RouterHistory) => createRouter({ routeTree, history });
export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

`Machines` and `Agents` do not exist until FE6/FE7 — create one-line stubs now so this task compiles, and replace them in the next tasks:

```tsx
// apps/dashboard/src/machines/Machines.tsx
export function Machines() {
  return <h1 className="text-[length:var(--ob-text-xl,1.5rem)] font-semibold">Machines</h1>;
}
```

```tsx
// apps/dashboard/src/agents/Agents.tsx
export function Agents() {
  return <h1 className="text-[length:var(--ob-text-xl,1.5rem)] font-semibold">Agents</h1>;
}
```

- [x] **Step 6: Render the router in `main.tsx`**

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { makeQueryClient } from "./api/queryClient";
import { router } from "./router";
import "./styles.css";

async function boot() {
  if (import.meta.env.VITE_MOCK === "1") {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
```

- [x] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @ob/dashboard test -- shell.test.tsx
pnpm --filter @ob/dashboard typecheck
```

Expected: 3 passing; typecheck clean. If TanStack Router types complain about `createRootRoute` ordering, move `routeTree` above `router` (it already is) and ensure `router.tsx` is the only place `createAppRouter` lives.

- [x] **Step 8: Commit**

```bash
git add apps/dashboard/src/router.tsx apps/dashboard/src/layout apps/dashboard/src/pages apps/dashboard/src/main.tsx apps/dashboard/src/machines apps/dashboard/src/agents apps/dashboard/test/shell.test.tsx apps/dashboard/test/setup.ts
git commit -m "feat(dashboard): app shell, routes and sign-in hand-off"
```

---

### Task FE6: The machines page with revoke

**Files:**
- Create: `apps/dashboard/src/machines/Machines.tsx`, `src/machines/MachineRow.tsx`, `src/machines/RevokeDialog.tsx`
- Test: `apps/dashboard/test/machines.test.tsx`

- [x] **Step 1: Write the failing test**

`apps/dashboard/test/machines.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { makeQueryClient } from "../src/api/queryClient";
import { createMockBus, handlersFor } from "../src/mocks/handlers";
import { createAppRouter } from "../src/router";
import { installHarness, server } from "./harness";

installHarness();

const mount = () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ["/"] }))} />
    </QueryClientProvider>,
  );
  return bus;
};

test("lists active and revoked machines, revoking only the active ones", async () => {
  mount();
  expect(await screen.findByText("studio-mbp")).toBeInTheDocument();
  expect(screen.getByText("old-thinkpad")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revoke studio-mbp" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Revoke old-thinkpad" })).not.toBeInTheDocument();
  expect(screen.getByText("Revoked")).toBeInTheDocument();
});

test("revoking asks first, names the machine, and needs a second click", async () => {
  const user = userEvent.setup();
  const bus = mount();
  await screen.findByText("studio-mbp");
  await user.click(screen.getByRole("button", { name: "Revoke studio-mbp" }));

  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/studio-mbp/)).toBeInTheDocument();
  expect(within(dialog).getByText(/can't be undone/i)).toBeInTheDocument();
  expect(bus.machines().find((m) => m.id === "m1")?.revokedAt).toBeNull();

  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(bus.machines().find((m) => m.id === "m1")?.revokedAt).toBeNull();

  await user.click(screen.getByRole("button", { name: "Revoke studio-mbp" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke machine" }));
  await waitFor(() => expect(bus.machines().find((m) => m.id === "m1")?.revokedAt).not.toBeNull());
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Revoke studio-mbp" })).not.toBeInTheDocument(),
  );
});

test("a failed list shows a retry, not an empty page", async () => {
  server.use(
    http.get("*/api/v1/me", () => HttpResponse.json({ user: { id: "u1", email: "a@b.co", name: null } })),
    http.get("*/api/v1/machines", () =>
      HttpResponse.json({ error: { code: "internal", message: "Boom" } }, { status: 500 }),
    ),
  );
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ["/"] }))} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/couldn't load your machines/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("no machines yet shows the install command", async () => {
  server.use(
    http.get("*/api/v1/me", () => HttpResponse.json({ user: { id: "u1", email: "a@b.co", name: null } })),
    http.get("*/api/v1/machines", () => HttpResponse.json({ machines: [] })),
  );
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ["/"] }))} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/no machines yet/i)).toBeInTheDocument();
  expect(screen.getByText("npx open-bus")).toBeInTheDocument();
});
```

`@testing-library/user-event` must be a devDependency of `apps/dashboard` (OA's `packages/ui` has it but the dashboard needs its own):

```bash
pnpm --filter @ob/dashboard add -D @testing-library/user-event
```

- [x] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ob/dashboard test -- machines.test.tsx
```

Expected: FAIL — no "studio-mbp" (the Machines page is still the stub).

- [x] **Step 3: Write the revoke dialog**

`apps/dashboard/src/machines/RevokeDialog.tsx`:

```tsx
import { Button } from "@ob/ui/shadcn";
import { useEffect, useRef } from "react";
import { useRevokeMachine } from "../api/queries";

/**
 * Revoking is irreversible from the dashboard: the machine must run
 * `npx open-bus` and be approved again. So: name the machine, say so, and
 * require a second, explicitly worded click. Escape closes it (the opener gets
 * focus back); focus starts on the panel, never on the destructive button.
 */
export function RevokeDialog({
  id,
  label,
  onClose,
}: {
  id: string;
  label: string;
  onClose: () => void;
}) {
  const revoke = useRevokeMachine();
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const panel = useRef<HTMLDivElement>(null);

  const close = () => {
    onClose();
    opener.current?.focus();
  };

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `close` reads refs and the caller's stable setter; re-binding per render
    // would drop a keypress that lands mid-render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-title"
        aria-describedby="revoke-desc"
        className="w-full max-w-[440px] rounded-[var(--ob-radius-8,8px)] bg-[var(--ob-surface,#fff)] p-6 shadow-lg outline-none"
      >
        <h2 id="revoke-title" className="text-base font-semibold">
          Revoke {label}?
        </h2>
        <p id="revoke-desc" className="mt-2 text-sm">
          Its agents leave the roster, its connection closes, and mail to them is refused. It can
          join again only by running <code>npx open-bus</code> and being approved. This can't be
          undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={revoke.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(id, { onSuccess: close })}
          >
            {revoke.isPending ? "Revoking…" : "Revoke machine"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

Using a plain dialog rather than Radix keeps this test free of portals; Design may swap in `@ob/ui/shadcn`'s `Dialog`, keeping the `role="dialog"`, the panel-first focus, and the two button names.

- [x] **Step 4: Write the row**

`apps/dashboard/src/machines/MachineRow.tsx`:

```tsx
import { Button } from "@ob/ui/shadcn";
import type { Machine } from "../api/contract";

/** "Last used 3 minutes ago"; never "Invalid Date". */
export const lastUsed = (iso: string | null) => {
  if (!iso) return "never used";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "last used unknown";
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 60) return "used just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const [n, unit]: [number, Intl.RelativeTimeFormatUnit] =
    secs < 3600 ? [Math.round(secs / 60), "minute"] : secs < 86400 ? [Math.round(secs / 3600), "hour"] : [Math.round(secs / 86400), "day"];
  return `used ${rtf.format(-n, unit)}`;
};

export function MachineRow({ machine, onRevoke }: { machine: Machine; onRevoke(id: string): void }) {
  const revoked = machine.revokedAt !== null;
  return (
    <li className="flex items-center gap-4 border-b border-[var(--ob-divider,#e0e3e8)] py-3">
      <div className="min-w-0 flex-1">
        <p className={revoked ? "truncate line-through opacity-60" : "truncate font-medium"}>
          {machine.label}
        </p>
        <p className="text-xs text-[color:var(--ob-muted,#5f6670)]">
          {revoked
            ? `Revoked ${lastUsed(machine.revokedAt).replace(/^used /, "")}`
            : lastUsed(machine.lastUsed)}
          {" · "}
          <code>{machine.id}</code>
        </p>
      </div>
      {revoked ? (
        <span className="rounded-full bg-[var(--ob-surface-2,#f6f7f9)] px-2 py-0.5 text-xs">Revoked</span>
      ) : (
        <Button variant="outline" size="sm" onClick={() => onRevoke(machine.id)} aria-label={`Revoke ${machine.label}`}>
          Revoke
        </Button>
      )}
    </li>
  );
}
```

- [x] **Step 5: Write the page**

`apps/dashboard/src/machines/Machines.tsx`:

```tsx
import { Button } from "@ob/ui/shadcn";
import { useState } from "react";
import { useMachines } from "../api/queries";
import { useDocumentTitle } from "../layout/useDocumentTitle";
import { useBusEvents } from "../live/useBusEvents";
import { MachineRow } from "./MachineRow";
import { RevokeDialog } from "./RevokeDialog";

export function Machines() {
  useDocumentTitle("Machines");
  const { data, error, isPending, refetch } = useMachines();
  const { live } = useBusEvents();
  const [pending, setPending] = useState<string | null>(null);
  const target = data?.machines.find((m) => m.id === pending);
  const active = data?.machines.filter((m) => !m.revokedAt) ?? [];

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--ob-text-xl,1.5rem)] font-semibold">Machines</h1>
          <p className="mt-1 text-sm text-[color:var(--ob-muted,#5f6670)]">
            Every machine with a token for this bus. {active.length === 1 ? "1 is active" : `${active.length} are active`}.
          </p>
        </div>
        {!live && (
          <span className="text-xs text-[color:var(--ob-muted,#5f6670)]" role="status">
            Live updates paused
          </span>
        )}
      </div>

      {isPending && <p className="mt-6 text-sm opacity-60">Loading…</p>}

      {error && (
        <div className="mt-6 rounded-[var(--ob-radius-8,8px)] border border-[var(--ob-border,#bec4cd)] p-4">
          <p className="text-sm">Couldn't load your machines.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}

      {data && data.machines.length === 0 && (
        <div className="mt-6 rounded-[var(--ob-radius-8,8px)] border border-dashed border-[var(--ob-border,#bec4cd)] p-6">
          <p className="font-medium">No machines yet</p>
          <p className="mt-1 text-sm">On the machine you want to connect, run:</p>
          <pre className="mt-3 overflow-x-auto rounded-[var(--ob-radius-6,6px)] bg-[var(--ob-surface-2,#f6f7f9)] p-3 text-sm">
            <code>npx open-bus</code>
          </pre>
        </div>
      )}

      {data && data.machines.length > 0 && (
        <ul className="mt-4">
          {data.machines.map((m) => (
            <MachineRow key={m.id} machine={m} onRevoke={setPending} />
          ))}
        </ul>
      )}

      {target && (
        <RevokeDialog id={target.id} label={target.label} onClose={() => setPending(null)} />
      )}
    </>
  );
}
```

- [x] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @ob/dashboard test -- machines.test.tsx
pnpm --filter @ob/dashboard typecheck
```

Expected: 4 passing; typecheck clean.

- [x] **Step 7: Commit**

```bash
git add apps/dashboard/src/machines apps/dashboard/test/machines.test.tsx apps/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(dashboard): machines page with confirmed, optimistic revoke"
```

---

### Task FE7: The live agents and namespaces view

**Files:**
- Create: `apps/dashboard/src/agents/Agents.tsx`, `src/agents/AgentRow.tsx`, `src/agents/LiveChip.tsx`
- Test: `apps/dashboard/test/agents.test.tsx`

- [x] **Step 1: Write the failing test**

`apps/dashboard/test/agents.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { makeQueryClient } from "../src/api/queryClient";
import { createMockBus, handlersFor } from "../src/mocks/handlers";
import { fixtures } from "../src/mocks/fixtures";
import { createAppRouter } from "../src/router";
import { lastSource } from "./fakeEventSource";
import { installHarness, server } from "./harness";

installHarness();

const mount = () => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  const client = makeQueryClient();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ["/agents"] }))} />
    </QueryClientProvider>,
  );
  return { bus, client };
};

test("agents are grouped by namespace, live ones first, global ones badged", async () => {
  mount();
  const app = await screen.findByRole("region", { name: "repo:github.com/acme/app" });
  const names = within(app).getAllByRole("listitem").map((li) => li.textContent);
  expect(names[0]).toContain("claude-1");
  expect(names[1]).toContain("opencode-1");
  const docs = screen.getByRole("region", { name: "repo:github.com/acme/docs" });
  expect(within(docs).getByText("global")).toBeInTheDocument();
});

test("the live dot is labeled for screen readers", async () => {
  mount();
  const app = await screen.findByRole("region", { name: "repo:github.com/acme/app" });
  expect(within(app).getByLabelText("claude-1 is live")).toBeInTheDocument();
  expect(within(app).getByLabelText("opencode-1 is offline")).toBeInTheDocument();
});

test("a pushed roster frame updates the page without a reload", async () => {
  mount();
  await screen.findByText("claude-1");
  const extra = {
    id: "a9", namespace: "repo:github.com/acme/app", name: "claude-2", kind: "claude-code" as const,
    machineId: "m2", machineLabel: "old-thinkpad", global: false, live: true,
    updatedAt: new Date().toISOString(),
  };
  act(() => {
    lastSource().push({ type: "agents", agents: [...fixtures.agents, extra] });
  });
  expect(await screen.findByText("claude-2")).toBeInTheDocument();
});

test("the namespace filter narrows the groups", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText("claude-1");
  await user.selectOptions(screen.getByLabelText("Namespace"), "repo:github.com/acme/docs");
  expect(screen.queryByRole("region", { name: "repo:github.com/acme/app" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "repo:github.com/acme/docs" })).toBeInTheDocument();
});

test("a dropped stream shows a paused chip and the rows stay", async () => {
  mount();
  await screen.findByText("claude-1");
  act(() => {
    lastSource().push({ type: "hello" });
    lastSource().fail();
  });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/live updates paused/i));
  expect(screen.getByText("claude-1")).toBeInTheDocument();
});

test("no agents shows how to start one", async () => {
  mount();
  await screen.findByText("claude-1");
  act(() => {
    lastSource().push({ type: "agents", agents: [] });
  });
  expect(await screen.findByText(/no agents connected/i)).toBeInTheDocument();
  expect(screen.getByText(/npx open-bus/)).toBeInTheDocument();
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ob/dashboard test -- agents.test.tsx
```

Expected: FAIL — no region named after a namespace.

- [x] **Step 3: Write the chip and the row**

`apps/dashboard/src/agents/LiveChip.tsx`:

```tsx
/** One dot per agent: a filled ring when live, a hollow one when offline. */
export function LiveChip({ name, live }: { name: string; live: boolean }) {
  return (
    <span
      aria-label={`${name} is ${live ? "live" : "offline"}`}
      title={live ? "Live" : "Offline"}
      className={
        live
          ? "inline-block size-2 rounded-full bg-[var(--ob-ok,#1a7f37)]"
          : "inline-block size-2 rounded-full border border-[var(--ob-border-strong,#848b95)]"
      }
    />
  );
}
```

`apps/dashboard/src/agents/AgentRow.tsx`:

```tsx
import type { Agent } from "../api/contract";
import { LiveChip } from "./LiveChip";

const KIND: Record<Agent["kind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  pi: "Pi",
};

export function AgentRow({ agent }: { agent: Agent }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <LiveChip name={agent.name} live={agent.live} />
      <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
      {agent.global && (
        <span className="rounded-full bg-[var(--ob-surface-2,#f6f7f9)] px-2 py-0.5 text-xs">global</span>
      )}
      <span className="text-xs text-[color:var(--ob-muted,#5f6670)]">
        {KIND[agent.kind] ?? agent.kind} · {agent.machineLabel}
      </span>
    </li>
  );
}
```

- [x] **Step 4: Write the page**

`apps/dashboard/src/agents/Agents.tsx`:

```tsx
import type { Agent } from "../api/contract";
import { useAgents } from "../api/queries";
import { useDocumentTitle } from "../layout/useDocumentTitle";
import { useBusEvents } from "../live/useBusEvents";
import { AgentRow } from "./AgentRow";

/** Live first, then by name; namespaces alphabetical. */
export function groupByNamespace(agents: Agent[]): [string, Agent[]][] {
  const by = new Map<string, Agent[]>();
  for (const a of agents) by.set(a.namespace, [...(by.get(a.namespace) ?? []), a]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ns, list]) => [
      ns,
      [...list].sort(
        (x, y) => Number(y.live) - Number(x.live) || x.name.localeCompare(y.name),
      ),
    ]);
}

export function Agents() {
  useDocumentTitle("Agents");
  const { data, error, isPending, refetch } = useAgents();
  const { live } = useBusEvents();
  const all = data?.agents ?? [];
  const [ns, setNs] = useState<string>("");
  const shown = ns ? all.filter((a) => a.namespace === ns) : all;
  const groups = groupByNamespace(shown);
  const namespaces = [...new Set(all.map((a) => a.namespace))].sort();

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--ob-text-xl,1.5rem)] font-semibold">Agents</h1>
          <p className="mt-1 text-sm text-[color:var(--ob-muted,#5f6670)]">
            {all.filter((a) => a.live).length} live of {all.length} connected.
          </p>
        </div>
        {!live && (
          <span role="status" className="text-xs text-[color:var(--ob-muted,#5f6670)]">
            Live updates paused
          </span>
        )}
      </div>

      {isPending && <p className="mt-6 text-sm opacity-60">Loading…</p>}

      {error && (
        <div className="mt-6 rounded-[var(--ob-radius-8,8px)] border border-[var(--ob-border,#bec4cd)] p-4">
          <p className="text-sm">Couldn't load the roster.</p>
          <button type="button" className="mt-3 underline" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      )}

      {data && all.length === 0 && (
        <div className="mt-6 rounded-[var(--ob-radius-8,8px)] border border-dashed border-[var(--ob-border,#bec4cd)] p-6">
          <p className="font-medium">No agents connected</p>
          <p className="mt-1 text-sm">
            Start a session in a repo after running <code>npx open-bus</code>. Agents appear here as they
            come up.
          </p>
        </div>
      )}

      {namespaces.length > 1 && (
        <label className="mt-4 flex items-center gap-2 text-sm">
          Namespace
          <select
            aria-label="Namespace"
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            className="rounded-[var(--ob-radius-6,6px)] border border-[var(--ob-border,#bec4cd)] bg-transparent px-2 py-1"
          >
            <option value="">All namespaces</option>
            {namespaces.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {groups.map(([namespace, list]) => (
        <section key={namespace} aria-label={namespace} className="mt-6">
          <h2 className="truncate font-mono text-sm text-[color:var(--ob-muted,#5f6670)]">{namespace}</h2>
          <ul className="mt-1 divide-y divide-[var(--ob-divider,#e0e3e8)]">
            {list.map((a) => (
              <AgentRow key={a.id} agent={a} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
```

Add `useState` to the React import at the top: `import { useState } from "react";`.

- [x] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @ob/dashboard test -- agents.test.tsx
pnpm --filter @ob/dashboard typecheck
```

Expected: 6 passing. If a pushed-frame test fails because the frame arrives before the first render, `await screen.findByText("claude-1")` must come before every `lastSource().push(...)` — the fake only holds frames that the runner has a handler for.

- [x] **Step 6: Commit**

```bash
git add apps/dashboard/src/agents apps/dashboard/test/agents.test.tsx
git commit -m "feat(dashboard): live agents view grouped by namespace"
```

---

### Task FE8: End-to-end tests

**Files:**
- Create: `apps/dashboard/playwright.config.ts`, `e2e/machines.spec.ts`, `e2e/agents.spec.ts`, `e2e/a11y.spec.ts`

- [x] **Step 1: Write the Playwright config**

`apps/dashboard/playwright.config.ts` (mirrors OA's mock runner):

```ts
import { defineConfig } from "@playwright/test";

const port = 5199;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${port}`, browserName: "chromium" },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    env: { VITE_MOCK: "1" },
    reuseExistingServer: false,
  },
});
```

`axe-core` comes from `packages/ui`; add `@playwright/test` and `playwright` to `apps/dashboard` if F1 hasn't:

```bash
pnpm --filter @ob/dashboard add -D @playwright/test@1.64.1
pnpm --filter @ob/dashboard exec playwright install chromium
```

- [x] **Step 2: Write the machines spec** (this is the pinned test for review focus #4)

`apps/dashboard/e2e/machines.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";

const row = (page: Page, label: string) =>
  page.getByRole("listitem").filter({ hasText: label });

test("revoking a live machine removes its agents from the roster", async ({ page }) => {
  await page.goto("/");
  await expect(row(page, "studio-mbp")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke studio-mbp" })).toBeVisible();

  await page.goto("/agents");
  await expect(page.getByRole("listitem").filter({ hasText: "studio-mbp" })).toHaveCount(3);

  await page.getByRole("link", { name: "Machines" }).click();
  await page.getByRole("button", { name: "Revoke studio-mbp" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("studio-mbp");
  await expect(dialog).toContainText("can't be undone");
  await dialog.getByRole("button", { name: "Revoke machine" }).click();

  await expect(row(page, "studio-mbp").getByText("Revoked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke studio-mbp" })).toHaveCount(0);

  // The spec's scenario 5: the revoked machine's agents leave the roster.
  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByText("claude-1")).toHaveCount(0);
  await expect(page.getByText("opencode-1")).toHaveCount(0);
  await expect(page.getByText("scout")).toHaveCount(0);
  await expect(page.getByText(/no agents connected/i)).toBeVisible();
});

test("cancel leaves the machine alone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Revoke studio-mbp" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Revoke studio-mbp" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a revoked machine is listed but not revocable", async ({ page }) => {
  await page.goto("/");
  await expect(row(page, "old-thinkpad").getByText("Revoked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke old-thinkpad" })).toHaveCount(0);
});

test("the revoke dialog is keyboard-operable and focus returns", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Revoke studio-mbp" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke studio-mbp" })).toBeFocused();
});

test("no horizontal scroll at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(row(page, "studio-mbp")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
```

The focus-return and Escape cases rely on Task FE6's `RevokeDialog`, which focuses its panel on open and closes on Escape.

- [x] **Step 3: Write the agents spec**

`apps/dashboard/e2e/agents.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";

const push = (page: Page, frame: unknown) =>
  page.evaluate((f) => window.__obMock?.push(f as never), frame);

const agent = (over: Record<string, unknown>) => ({
  id: "a9",
  namespace: "repo:github.com/acme/app",
  name: "claude-2",
  kind: "claude-code",
  machineId: "m1",
  machineLabel: "studio-mbp",
  global: false,
  live: true,
  updatedAt: new Date().toISOString(),
  ...over,
});

test("agents are grouped by namespace with live dots", async ({ page }) => {
  await page.goto("/agents");
  const app = page.getByRole("region", { name: "repo:github.com/acme/app" });
  await expect(app.getByRole("listitem")).toHaveCount(2);
  await expect(app.getByLabel("claude-1 is live")).toBeVisible();
  await expect(app.getByLabel("opencode-1 is offline")).toBeVisible();
  await expect(page.getByRole("region", { name: "repo:github.com/acme/docs" }).getByText("global")).toBeVisible();
});

test("a live roster push lands without a reload", async ({ page }) => {
  await page.goto("/agents");
  await expect(page.getByText("claude-1")).toBeVisible();
  await push(page, { type: "agents", agents: [agent({})] });
  await expect(page.getByText("claude-2")).toBeVisible();
  await expect(page.getByText("claude-1")).toHaveCount(0);
});

test("a machine disconnecting takes its agents with it", async ({ page }) => {
  await page.goto("/agents");
  await expect(page.getByText("claude-1")).toBeVisible();
  await page.evaluate(() => {
    const bus = window.__obMock;
    if (bus) bus.setAgents(bus.agents().filter((a) => a.machineId !== "m1"));
  });
  await expect(page.getByText("claude-1")).toHaveCount(0);
  await expect(page.getByText(/no agents connected/i)).toBeVisible();
});

test("the namespace filter narrows the view", async ({ page }) => {
  await page.goto("/agents");
  await page.getByLabel("Namespace").selectOption("repo:github.com/acme/docs");
  await expect(page.getByRole("region", { name: "repo:github.com/acme/app" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "repo:github.com/acme/docs" })).toBeVisible();
});

test("370px smaller viewport keeps the roster readable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/agents");
  await expect(page.getByText("claude-1")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
```

- [x] **Step 4: Write the a11y and no-scroll spec**

`apps/dashboard/e2e/a11y.spec.ts` (OA's shape, two routes, two themes, two widths):

```ts
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js", {
  paths: [new URL("../../../packages/ui", import.meta.url).pathname],
});

const ROUTES = ["/", "/agents"];

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 390]) {
    test(`${theme} @${width}: no axe violations, no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      for (const path of ROUTES) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.addScriptTag({ path: AXE });
        const result = (await page.evaluate(async () => {
          // @ts-expect-error injected at runtime
          return await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
          });
        })) as { violations: { id: string; nodes: unknown[] }[] };
        expect(result.violations.map((v) => v.id)).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);
      }
    });
  }
}
```

- [x] **Step 5: Run the e2e suite and fix what it finds**

```bash
pnpm --filter @ob/dashboard test:e2e -- --reporter=list
```

Expected: all specs pass. The likeliest first failures, and their fixes:
- `window.__obMock` undefined → `startMocks()` didn't run: check `VITE_MOCK=1` reached Vite (the config's `webServer.env`).
- SSE specs time out → MSW's service worker buffers the stream. Fallback: in `mocks/browser.ts`, also expose the bus via a `BroadcastChannel` and have `useBusEvents` listen when `import.meta.env.VITE_MOCK === "1"`. Do not weaken the assertion.
- Axe contrast violations in dark mode → Design's tokens, not FE markup; report to OpenBus Design with the node list.

- [x] **Step 6: Commit**

```bash
git add apps/dashboard/playwright.config.ts apps/dashboard/e2e apps/dashboard/package.json pnpm-lock.yaml apps/dashboard/src/machines/RevokeDialog.tsx
git commit -m "test(dashboard): e2e for machines revoke, live roster, a11y and no sideways scroll"
```

---

### Task FE9: Real-server smoke (gated on Backend)

> Status: blocked on B1/B9/B10.

**Files:**
- Create: `apps/dashboard/e2e/real/fixtures.ts`, `apps/dashboard/e2e/real/machines.spec.ts`, `apps/dashboard/playwright.real.config.ts`

This task does not block anything. It runs once Backend's B-track has `/api/v1/machines`, `/api/v1/agents` and `/api/v1/events` on `wrangler dev`.

- [x] **Step 1: Confirm Backend's routes are live**

```bash
cd ~/code/projects/openbus-fe
pnpm --filter @ob/server dev   # or B's documented dev command; expect :8787
curl -s localhost:8787/healthz
curl -si localhost:8787/api/v1/machines | head -1   # expect 401 without a session
```

If either 404s, stop and message OpenBus Backend with the exact route.

- [x] **Step 2: Write the real config**

`apps/dashboard/playwright.real.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

const port = Number(process.env.OB_E2E_PORT ?? 8787);

export default defineConfig({
  testDir: "e2e/real",
  use: { baseURL: `http://localhost:${port}`, browserName: "chromium" },
  // The server is started by the operator (or by B's harness); never mocked here.
});
```

- [x] **Step 3: Write a dev-login fixture**

`apps/dashboard/e2e/real/fixtures.ts`:

```ts
import { expect, test as base, type Page } from "@playwright/test";

/** B's dev-only sign-in (OA's `/auth/dev-login`); it is 404 outside ENVIRONMENT=dev. */
export const signIn = async (page: Page) => {
  const res = await page.request.get("/auth/dev-login?email=fe@example.com");
  expect(res.status()).toBeLessThan(400);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Machines" })).toBeVisible();
};

export const test = base.extend<{ signedIn: Page }>({
  signedIn: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});
export { expect };
```

- [x] **Step 4: Write the smoke spec**

`apps/dashboard/e2e/real/machines.spec.ts`:

```ts
import { expect, test } from "./fixtures";

test("a fresh instance lists no machines and offers the install command", async ({ signedIn: page }) => {
  await expect(page.getByText(/no machines yet/i)).toBeVisible();
  await expect(page.getByText("npx open-bus")).toBeVisible();
});

test("the roster endpoint answers and the page says how many are connected", async ({ signedIn: page }) => {
  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByText(/\d+ live of \d+ connected/)).toBeVisible();
});
```

- [x] **Step 5: Run it**

```bash
pnpm --filter @ob/dashboard exec playwright test -c playwright.real.config.ts --reporter=list
```

Expected: 2 passing. A 401 on every request means the dev-login cookie didn't stick: B's cookie is `__Host-` prefixed outside dev, so this only works with `ENVIRONMENT=dev`.

- [x] **Step 6: Commit**

```bash
git add apps/dashboard/e2e/real apps/dashboard/playwright.real.config.ts
git commit -m "test(dashboard): real-server smoke against wrangler dev"
```

---

### Task FE10: Track wrap-up

**Files:**
- Modify: `apps/dashboard/README.md` (or create it), `docs/superpowers/plans/2026-10-21-openbus/04-frontend.md` (this file: check boxes as you go)

- [x] **Step 1: Write the dashboard README**

```markdown
# @ob/dashboard

The OpenBus dashboard: machines (with revoke) and the live agents/namespaces view.

- `pnpm dev` — Vite on :5173 against your instance (proxies `/api`, `/auth` in `vite.config.ts`).
- `VITE_MOCK=1 pnpm dev` — no server: MSW serves `src/mocks/` (two machines, two namespaces).
  `window.__obMock` pushes roster frames, for e2e.
- `pnpm test` — vitest (node + jsdom).
- `pnpm test:e2e` — Playwright against Vite with `VITE_MOCK=1`.
- `pnpm exec playwright test -c playwright.real.config.ts` — against `wrangler dev` on :8787.

The approval page is the Worker's (`Backend`); the landing page is `apps/landing` (Design).
```

- [x] **Step 2: Run the whole gate**

```bash
pnpm lint
pnpm --filter @ob/dashboard typecheck
pnpm --filter @ob/dashboard test
pnpm --filter @ob/dashboard test:e2e
pnpm --filter @ob/dashboard build
```

Expected: all green, and `dist/` contains no `mockServiceWorker.js`.

- [x] **Step 3: Report to openbus-e0 in three lines or fewer**

State: what shipped (FE1–FE10), which contract entries were consumed or changed, and what is blocked (e.g. real-server smoke waiting on B).

- [x] **Step 4: Commit**

```bash
git add apps/dashboard/README.md docs/superpowers/plans/2026-10-21-openbus/04-frontend.md
git commit -m "docs(dashboard): dashboard README and FE track status"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Machines page with revoke (§ Login 3, Verification 5) | FE6 (UI), FE2 (idempotent optimistic DELETE), FE8 (`machines.spec.ts`, the pinned test for review focus #4) |
| Revoked machine's agents leave the roster (Verification 5) | FE4 (mock bus emits a new snapshot), FE8 (e2e asserts rows are gone), FE7 (SSE applies it) |
| Live view of agents and namespaces (§ Goals 1, 5) | FE7 (grouping, global badge, live dot, filter), FE3 (SSE), FE8 (`agents.spec.ts`) |
| Isolation is not a UI concern, but must not be implied away | FE7 shows only what `GET /api/v1/agents` returns; no client-side namespace expansion, no cross-namespace "search" |
| Device approval page | **Not FE** — Worker-rendered by Backend; the FE only links sign-in to `AUTH.login` with `next` (FE5) |
| Landing + `llms.txt` | **Not FE** — Design's D-track |
| Stack mirrors open-artifacts (§ Tech and ops) | F1 scaffold; FE1–FE8 use Vite/React/TanStack/Tailwind/MSW/Playwright in OA's shapes |
| Dashboard layout within Design's direction | FE5/FE6/FE7 use `--ob-*` tokens with literal fallbacks; Design's screens replace markup, not behavior |
| Verification 6 (another namespace invisible) | FE8 `agents.spec.ts` filter test; real isolation is Backend's `hub.namespace.matrix.test.ts` |

**Gaps accepted, with reasons:** no message history or "send a test message" button (non-goal: message history; nothing to show without the daemon). No machine rename or token reissue (not in the spec's REST routes). No pagination (one owner, tens of machines/agents).

**Placeholder scan:** every task shows complete code and an exact command with expected output. The only deferred calls are explicit and testable: the MSW-streaming fallback (FE8 Step 5) and the `BusEventSchema` fallback (FE1 Step 3), each with the failure that triggers it.

**Type consistency:** `Machine`, `Agent`, `Me`, `BusEvent` come from `contract.ts` only. `MachinesData`/`AgentsData` are defined in `queries.ts` and used by `useBusEvents`' `setQueryData` shapes and by `queries.test.tsx`. `patchFor` returns `{machines}` / `{agents}` — the same keys the hook writes. `useRevokeMachine` returns a mutation of `string → void`, and both callers (`RevokeDialog`, tests) call `mutate(id)`. `lastUsed()` is exported from `MachineRow.tsx` and used only there. Button and dialog names (`Revoke <label>`, `Revoke machine`, `Cancel`, `Machines`, `Agents`, `Namespace`, `Try again`) are identical in unit tests and e2e specs.

**Open contract asks (send to Backend with this plan):** the F2 export list above; the CSRF header name; `DELETE /api/v1/machines/:id` → `204` / `404`; `/api/v1/events` frames shaped as `hello` / `machines` / `agents` snapshots; `/auth/dev-login` available under `ENVIRONMENT=dev` for FE9.

---

# Part 2: Agent card, AC6 (dashboard)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this part task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can point roles at open agents, see each agent's self-reported status, manage linked apps, and confirm a `/link` request.

**Architecture:** Two new owner-only REST resources (roles, linked apps) join the dashboard through `contract.ts` and `queries.ts`, like machines. Status rides on the existing agent rows (REST and WebSocket feed), so the reducer needs no change. The `/link` confirm page is server-rendered by the Worker, like `/approve`; FE writes its renderer, Backend's AC4 wires the route, cookie and POST.

**Tech Stack:** unchanged from Part 1.

**Spec:** `docs/superpowers/specs/2026-10-29-agent-card-design.md` (Design › Role labels, Status, Linking OA to a bus; Delivery row 6).

## AC6 global constraints

- All UI from `@ob/ui`; never edit `packages/shared`, `packages/ui` or `design/`. Layout follows Design's AC6 screens (dependency below); copy below is binding unless Design changes it.
- Status is never shown as fact: every status cell, header and tooltip carries "agent says". Values: `working`, `idle`, `blocked`, `waiting_on_owner`; label ≤ 64 chars, rendered as text only.
- Only the owner assigns roles; the dashboard is the only writer. A role points at one agent id; a closed holder shows the role as **Vacant**, never "follows" a new session.
- Role names follow `BusNameSchema`; namespaces follow `WireNamespaceSchema`. The holder picker offers only open agents (live or queued) in that namespace plus global agents.
- Mutations send `X-OB-Request: 1` (`CSRF_HEADER`). Server 400s are shown inline with the server's message; nothing is optimistic except removal and unlink, which roll back on failure.
- Older tabs must keep working: every new agent field is optional; an unknown status value renders as its raw token in the "agent says" cell.
- The link page: no JavaScript, no external requests, styles inlined, every interpolated value through `esc`, under 8 KB, `Referrer-Policy: same-origin` (FE9 finding). `aud` is shown verbatim as an origin, never as a link.

## AC6 dependencies

| Needs | From | Blocks |
|---|---|---|
| AC1 exports in `@ob/shared/web` (names assumed below) | Backend | AC6.1 |
| AC2 roles REST, AC3 status on rows, AC4 linked-apps REST and `/link` route | Backend | AC6.2–AC6.5 against the real server; mocks unblock UI work |
| AC6 screens: roles editor, status column, Linked apps, link confirm | Design | final markup of AC6.2–AC6.5 |

AC1 names (confirmed by Backend 2026-10-29), all re-exported only through `contract.ts` (a rename is one edit there): `AgentStatusSchema` (the four values), `AgentSchema` gaining `role?`, `status?`, `statusLabel?`, `statusAt?`; `RoleSchema {namespace, role, agentId: string|null, setAt}`, `RolesResponseSchema {roles}`, `PutRoleBodySchema {agentId}`; `LinkedAppSchema {aud, linkedAt}`, `LinkedAppsResponseSchema {apps}`; `R.roles`, `R.role(ns, role)`, `R.linkedApps`, `R.linkedApp(aud)` (the last URL-encodes `aud`).

## AC6 decisions

1. **Routes:** `/roles` (Roles) and `/settings` (Linked apps), added to the sidebar after Agents. Design may merge them; behavior is unchanged.
2. **Holder state is derived, not stored:** a role's holder row comes from the agents cache by `agentId`. Missing or closed ⇒ "Vacant". The feed already refreshes agents, so a holder closing flips the role to Vacant live without a roles refetch.
3. **Roles list refresh:** there is no roles frame; `role?` rides on agent rows. Invalidate `qk.roles` after any role mutation and whenever an agents frame arrives, since vacant roles exist only in `GET /roles`.
4. **Status column** sits on the Agents page between Kind and Machine: a state chip, the label, and "· 3 min ago" from `statusAt` via `ago()`. No status ⇒ "None" with accessible name "No status" (Design: no em dashes in copy). The state pill is dashed and unfilled, so it never reads as an attested badge (Design 2026-10-29).
5. **Errors (Backend 2026-10-29):** PUT role 400 `bad_request` carries `details.field` (`agentId`: holder closed, unknown or out of scope; `role` or `namespace`: bad name); 409 `conflict` when the role equals an open agent's name or the agent already holds a role (one role per agent). DELETE 204, 404 `not_found` when already gone. The UI tells cases apart by status plus `details.field`, and puts the message on that field.

## AC6 review focus

1. A role pointed at an agent that then closes: the Roles page must read Vacant within one feed update, and Re-point must still work. (AC6.3 test.)
2. A status label containing `<b>`, emoji, or 64 unbroken characters: rendered as text, wraps, never breaks the row layout at 390 px. (AC6.2 test.)
3. Creating a role whose name equals an open agent's name: the server's 409 is shown in the dialog, the dialog stays open with input kept. (AC6.3 test.)
4. An `aud` with a port, or punycode (`https://xn--…`), shown on the link page and in Linked apps exactly as stored, escaped, not linkified. (AC6.4 and AC6.5 tests.)
5. Unlink or remove that fails (network or 5xx): the row comes back and a toast says so; a 404 counts as success (already gone). (AC6.3, AC6.4 tests.)

---

### Task AC6.1: Contract, queries and mocks

**Files:**
- Modify: `apps/dashboard/src/api/contract.ts`, `src/api/qk.ts`, `src/api/queries.ts`, `src/mocks/handlers.ts`
- Test: `apps/dashboard/test/queries.test.tsx`, `test/mocks.test.ts`

**Interfaces:**
- Produces: `qk.roles`, `qk.linkedApps`; `useRoles(): UseQueryResult<{roles: Role[]}>`; `useSetRole(): mutation<{namespace, role, agentId}, void>`; `useRemoveRole(): mutation<{namespace, role}, void>` (optimistic, 404 = success); `useLinkedApps(): UseQueryResult<{apps: LinkedApp[]}>`; `useUnlinkApp(): mutation<string /*aud*/, void>` (optimistic, 404 = success). Mock bus gains `setRole`, `removeRole`, `unlink` and seeds one role and one linked app; agent fixtures get statuses when `@ob/shared/mocks` provides them, else the handler adds them.

- [ ] **Step 1:** failing tests: `useSetRole` PUTs `R.role("ns","lane-6")` with `{agentId}` and CSRF header, then refetches roles; `useRemoveRole` drops the row at once, restores it on 500, keeps it gone on 404; same pair for `useUnlinkApp` with an `aud` containing a port (`https://oa.example:8443`) to pin URL encoding.
- [ ] **Step 2:** run `pnpm --filter @ob/dashboard exec vitest run test/queries.test.tsx`; expect FAIL (missing exports).
- [ ] **Step 3:** implement, following `useRevokeMachine`'s shape.
- [ ] **Step 4:** same command; expect PASS. Then `pnpm --filter @ob/dashboard typecheck`.
- [ ] **Step 5:** commit `feat(dashboard): roles and linked-apps queries (AC6.1)`.

### Task AC6.2: Status column on Agents

**Files:** Modify `src/agents/AgentRow.tsx`, `src/agents/RosterTable.tsx`; Test `test/agents.test.tsx`.

**Interfaces:** Consumes `Agent.status?`, `statusLabel?`, `statusAt?`. Produces `StatusCell({agent})` in `src/agents/StatusCell.tsx`.

- [ ] **Step 1:** failing tests:
  - header reads "Status (agent says)"; a `blocked` agent with label "waiting on CI" shows "Blocked", "waiting on CI" and an `ago()` time;
  - `waiting_on_owner` shows "Waiting on you";
  - no status ⇒ "None" with accessible name "No status";
  - the state pill has the dashed, unfilled variant (assert its class or `data-variant`, per Design's screen);
  - label `"<b>x</b>"` renders literally; an unknown state `"zz"` renders "zz";
  - a feed frame changing status updates the cell without a refetch.
- [ ] **Step 2:** run `vitest run test/agents.test.tsx`; expect FAIL.
- [ ] **Step 3:** implement with `@ob/ui` Badge; the cell uses `min-w-0 whitespace-normal [overflow-wrap:anywhere]` like the kind cell. Labels: Working, Idle, Blocked, Waiting on you.
- [ ] **Step 4:** expect PASS; commit `feat(dashboard): agent status column, tagged agent says (AC6.2)`.

### Task AC6.3: Roles page

**Files:** Create `src/roles/Roles.tsx`, `src/roles/RoleDialog.tsx`, `src/roles/RemoveRoleDialog.tsx`; modify `src/router.tsx`, `src/layout/AppLayout.tsx`; Test `test/roles.test.tsx`.

**Interfaces:** Consumes AC6.1 hooks and `useAgents`. Produces route `/roles`, nav item "Roles" with count.

- [ ] **Step 1:** failing tests:
  - list shows `lane-6 → code-96` with namespace and holder state (Live, Queued, or **Vacant** when the holder is absent from agents);
  - "Add role" dialog: namespace select, name input (rejects invalid `BusNameSchema` client-side), holder select listing only open agents in that namespace plus global ones; submit PUTs and closes;
  - a 409 shows its message on the name field, a 400 with `details.field: "agentId"` on the holder select; the dialog stays open with input intact;
  - agents that already hold a role are listed as disabled with "holds <role>" (one role per agent);
  - "Re-point lane-6" opens the dialog with namespace and name locked;
  - "Remove lane-6" confirms with an AlertDialog, row disappears, returns with a toast on 500;
  - holder closes via a feed frame ⇒ row reads Vacant, and an agents frame triggers a roles refetch;
  - an agent row on Agents shows its `role` as a badge.
- [ ] **Step 2:** run `vitest run test/roles.test.tsx`; expect FAIL.
- [ ] **Step 3:** implement; empty state copy: "No roles yet. A role is a name, such as lane-6, that you point at one agent."
- [ ] **Step 4:** expect PASS; typecheck; commit `feat(dashboard): roles editor (AC6.3)`.

### Task AC6.4: Linked apps

**Files:** Create `src/settings/Settings.tsx`, `src/settings/UnlinkDialog.tsx`; modify `src/router.tsx`, `src/layout/AppLayout.tsx`; Test `test/settings.test.tsx`.

- [ ] **Step 1:** failing tests: list shows each `aud` as text (not a link) and "Linked <day>"; "Unlink https://oa.example" confirms ("<aud> can no longer verify your agents' cards. Cards it already has expire within 5 minutes."), removes the row, restores it with a toast on 500; empty state "No linked apps. Link one from the app's settings."; a punycode `aud` renders verbatim.
- [ ] **Step 2:** run `vitest run test/settings.test.tsx`; expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** expect PASS; commit `feat(dashboard): linked apps with unlink (AC6.4)`.

### Task AC6.5: The /link confirm page renderer

**Files:** Create `apps/server/src/routes/link-page.ts`; Test `apps/server/test/link-page.test.ts`. Backend's AC4c owns `/link` (validation, `ob_link` cookie, POST confirm, and the CSP header whose form-action allows `aud`) and calls this renderer. Signatures agreed with Backend 2026-10-29.

**Interfaces:** Produces `renderLinkConfirm(v: PageBase & { aud: string; action: string; csrf: string }): string` and `renderLinkError(v: PageBase, reason: "bad_request" | "expired"): string`, reusing `esc`, `shell` and `STYLE` from `approve-page.ts` (export what's needed there; no copy).

- [ ] **Step 1:** failing tests: the confirm page contains "Let https://oa.example verify your agents' cards?", the signed-in email, a POST form to `action` with the CSRF hidden field, "Allow" and "Cancel"; an `aud` of `https://a"><script>` is escaped; no `<script`, no `http` URL other than the form action; size < 8 KB; the error page names no `aud`.
- [ ] **Step 2:** run `pnpm --filter @ob/server exec vitest run test/link-page.test.ts`; expect FAIL.
- [ ] **Step 3:** implement from Design's link-confirm screen.
- [ ] **Step 4:** expect PASS; commit `feat(server): /link confirm page renderer (AC6.5)`; send Backend the signatures.

### Task AC6.6: E2E, a11y and real smoke

**Files:** Create `apps/dashboard/e2e/roles.spec.ts`, `e2e/settings.spec.ts`; modify `e2e/a11y.spec.ts`, `e2e/real/smoke.spec.ts`.

- [ ] **Step 1:** mocked specs: add, re-point and remove a role; unlink an app; status column visible at 1280 and 390 with a 64-char label. axe clean on Roles, Settings and the Add-role dialog, light and dark, 1280 and 390.
- [ ] **Step 2:** real smoke (read-only): `/roles` and `/settings` render and `GET /api/v1/roles` and `/linked-apps` return 200; no console or CSP errors.
- [ ] **Step 3:** run `pnpm --filter @ob/dashboard exec playwright test e2e/roles.spec.ts e2e/settings.spec.ts e2e/a11y.spec.ts` (load < 40); expect all pass in Chromium and WebKit.
- [ ] **Step 4:** commit `test(dashboard): AC6 e2e and a11y (AC6.6)`.

## AC6 self-review

| Spec requirement | Task |
|---|---|
| Owner points a role at a live agent in the dashboard (Goal 1) | AC6.3 |
| Scoping: holder open, same namespace or global (Role labels) | AC6.3 picker; server enforces (AC2) |
| Closed holder ⇒ vacant, never follows (Anti-goals) | AC6.3, decision 2 |
| Status column tagged "agent says" (Goal 2, Status read side) | AC6.2 |
| Status within 2 s / last value of a burst (Verification) | feed already applies agent rows; AC6.2 feed test; timing is Backend's |
| `GET`/`DELETE` linked apps, unlink (Linking) | AC6.1, AC6.4 |
| Confirm page "Let <aud> verify your agents' cards?" (Linking step 3) | AC6.5 |
| Older tabs ignore new fields (Status read side) | optional fields; AC6.2 unknown-state test |

Out of FE scope: `/link` validation and cookie, card signing, JWKS (Backend AC4); OA's half.
