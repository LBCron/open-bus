import { broadcast, closeAll, createWsHandler } from "@ob/shared/mocks";
import { HttpResponse, http, ws } from "msw";
import {
  type Agent,
  AgentsResponseSchema,
  type BusEvent,
  BusEventSchema,
  CSRF_HEADER,
  CSRF_VALUE,
  type LinkedApp,
  type Machine,
  MachinesResponseSchema,
  R,
  WireNamespaceSchema,
} from "../api/contract";
import { fixtures } from "./fixtures";

/** Our own link (not the shared one), so push/closeAll reach only our clients. */
const link = ws.link(`*${R.events}`);

type Err = "bad_request" | "conflict" | "csrf" | "not_found";
const fail = (
  status: number,
  code: Err,
  message: string,
  details?: { field: string },
) =>
  HttpResponse.json(
    { error: details ? { code, message, details } : { code, message } },
    { status },
  );

/**
 * Mutable mock state plus the frame bus the WebSocket link and the e2e hook share.
 * Revoke mirrors the hub: the machine keeps its row (revokedAt set), its agents go.
 */
export function createMockBus() {
  let machineRows: Machine[] = structuredClone(fixtures.machines);
  const T = new Date().toISOString();
  // Fixtures carry no self-reported status; the mock adds some.
  let agentRows: Agent[] = structuredClone(fixtures.agents).map((a, i) =>
    i === 0
      ? { ...a, status: "working", statusLabel: "writing tests", statusAt: T }
      : i === 1
        ? { ...a, status: "idle", statusAt: T }
        : a,
  );
  let appRows: LinkedApp[] = [{ aud: "https://oa.example", linkedAt: T }];
  const subscribers = new Set<(e: BusEvent) => void>();

  // Like the hub: active machines first, then revoked, each newest first.
  // Every agent that can receive mail is listed, live and queued (closed
  // agents never reach the roster).
  const machines = () =>
    [...machineRows].sort(
      (a, b) =>
        Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const agents = () => [...agentRows];
  const apps = () => [...appRows];

  /** Every frame goes through the schema, so a bad e2e push throws here. */
  const push = (e: BusEvent) => {
    const frame = BusEventSchema.parse(e);
    for (const fn of subscribers) fn(frame);
    broadcast(frame, link);
  };

  function subscribe(fn: (e: BusEvent) => void) {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }

  // The shared handler owns the greeting and ping/pong; it reads our live state
  // on every connect. Our own link keeps broadcast/closeAll off the shared one.
  const events = createWsHandler({ machines, agents }, link);

  return {
    machines,
    agents,
    push,
    subscribe,
    /** The msw handler for the events WebSocket (see handlersFor). */
    events,
    /**
     * Test/dev hook: the hub closes every open stream with `code` (4401 the
     * session ended, 1013 evicted, 1011 a send failed).
     */
    closeAll(code: number) {
      closeAll(code, link, "mock");
    },
    /** DELETE /api/v1/machines/:id: 204, or 404 when unknown or already revoked. */
    async revoke(id: string) {
      const m = machineRows.find((x) => x.id === id);
      if (!m || m.revokedAt) {
        return fail(404, "not_found", "No such machine");
      }
      machineRows = machineRows.map((x) =>
        x.id === id
          ? { ...x, revokedAt: new Date().toISOString(), connected: false }
          : x,
      );
      agentRows = agentRows.filter((a) => a.machineId !== id);
      push({ type: "agents", agents: agents() });
      push({ type: "machines", machines: machines() });
      return new HttpResponse(null, { status: 204 });
    },
    apps,
    /** DELETE /api/v1/linked-apps/:aud: 204, or 404 when already gone. */
    async unlink(aud: string) {
      if (!appRows.some((a) => a.aud === aud))
        return fail(404, "not_found", "No such linked app");
      appRows = appRows.filter((a) => a.aud !== aud);
      return new HttpResponse(null, { status: 204 });
    },
    /**
     * Test/dev hook: pretend the hub announced a new roster. Validates the
     * whole input (schema and list cap) before touching state; throws on bad input.
     */
    setAgents(next: unknown) {
      agentRows = AgentsResponseSchema.parse({ agents: next }).agents;
      push({ type: "agents", agents: agents() });
    },
    /** Test/dev hook: pretend the hub announced new machines. Same rules as setAgents. */
    setMachines(next: unknown) {
      machineRows = MachinesResponseSchema.parse({ machines: next }).machines;
      push({ type: "machines", machines: machines() });
    },
  };
}

export type MockBus = ReturnType<typeof createMockBus>;

/** Handlers: me, machines, agents, revoke, linked apps, and the events WebSocket. */
export function handlersFor(bus: MockBus) {
  return [
    http.get("*/api/v1/me", () => HttpResponse.json(fixtures.me)),
    http.get("*/api/v1/machines", () =>
      HttpResponse.json({ machines: bus.machines() }),
    ),
    http.get("*/api/v1/agents", ({ request }) => {
      const ns = new URL(request.url).searchParams.get("namespace");
      // Like the hub: ?namespace= is exact and must already be canonical.
      if (ns !== null && !WireNamespaceSchema.safeParse(ns).success) {
        return fail(400, "bad_request", "Invalid namespace", {
          field: "namespace",
        });
      }
      const all = bus.agents();
      return HttpResponse.json({
        agents: ns ? all.filter((a) => a.namespace === ns || a.global) : all,
      });
    }),
    http.post("*/auth/logout", ({ request }) =>
      request.headers.get(CSRF_HEADER) === CSRF_VALUE
        ? new HttpResponse(null, { status: 204 })
        : fail(403, "csrf", `Missing ${CSRF_HEADER} header`),
    ),
    http.delete("*/api/v1/machines/:id", ({ request, params }) => {
      if (request.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
        return fail(403, "csrf", `Missing ${CSRF_HEADER} header`);
      }
      return bus.revoke(String(params.id));
    }),
    http.get("*/api/v1/linked-apps", () =>
      HttpResponse.json({ apps: bus.apps() }),
    ),
    http.delete("*/api/v1/linked-apps/:aud", ({ request, params }) => {
      if (request.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
        return fail(403, "csrf", `Missing ${CSRF_HEADER} header`);
      }
      return bus.unlink(decodeURIComponent(String(params.aud)));
    }),
    bus.events,
  ];
}
