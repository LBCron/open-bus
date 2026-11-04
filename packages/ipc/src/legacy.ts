import { AGENT_CARD_MIN_CLIENT, semverGte } from "@ob/shared";
import type { z } from "zod";
import type { AgentInfo, DaemonFrame } from "./frames.ts";

/** The kinds a 0.44.x client's strict decoder accepts. */
export const LEGACY_KINDS = ["claude-code", "opencode", "pi"] as const;

/**
 * A kind as a 0.44.x client may see it: a kind it knows stays, any other
 * (omp, codex, later kinds) becomes `pi`. This keeps the agent addressable:
 * the row is kept, so an old session can still message it by name. `pi` is
 * the nearest kind by default, not by lineage: omp is a Pi fork, codex is not.
 */
export const legacyKind = (kind: string): string =>
  (LEGACY_KINDS as readonly string[]).includes(kind) ? kind : "pi";

/**
 * A daemon frame as a client without the IPC marker must receive it (C23c):
 * every kind (roster, self, status) within the three kinds it decodes.
 */
export function forOldClient<F extends DaemonFrame>(f: F): F {
  switch (f.type) {
    case "roster":
      return {
        ...f,
        agents: f.agents.map((a) => ({ ...a, kind: legacyKind(a.kind) })),
      };
    case "agent":
      return f.agent
        ? { ...f, agent: { ...f.agent, kind: legacyKind(f.agent.kind) } }
        : f;
    case "status":
      return {
        ...f,
        namespaces: f.namespaces.map((n) => ({
          ...n,
          agents: n.agents.map((a) => ({ ...a, kind: legacyKind(a.kind) })),
        })),
      };
    default:
      return f;
  }
}

type Row = z.infer<typeof AgentInfo>;
/** A roster row without the agent card fields. */
const plainRow = ({
  status: _s,
  status_label: _l,
  status_at: _a,
  ...row
}: Row): Row => row;

/**
 * A daemon frame as a client below AGENT_CARD_MIN_CLIENT must receive it
 * (AC5a): no status on a roster, self or status row.
 */
export function withoutCard<F extends DaemonFrame>(f: F): F {
  switch (f.type) {
    case "roster":
      return { ...f, agents: f.agents.map(plainRow) };
    case "agent":
      return f.agent ? { ...f, agent: plainRow(f.agent) } : f;
    case "status":
      return {
        ...f,
        namespaces: f.namespaces.map((n) => ({
          ...n,
          agents: n.agents.map(
            ({ status: _s, status_label: _l, status_at: _a, ...a }) => a,
          ),
        })),
      };
    default:
      return f;
  }
}

/** Whether a client's IPC marker is at or above the agent card gate. */
export const seesCard = (clientVersion: string | undefined): boolean =>
  clientVersion !== undefined &&
  semverGte(clientVersion, AGENT_CARD_MIN_CLIENT);

/** A daemon frame as the client with this marker (absent: 0.44.x) decodes it. */
export function forClient<F extends DaemonFrame>(
  f: F,
  clientVersion: string | undefined,
): F {
  if (seesCard(clientVersion)) return f;
  const plain = withoutCard(f);
  return clientVersion === undefined ? forOldClient(plain) : plain;
}
