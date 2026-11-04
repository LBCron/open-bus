import {
  AGENT_CARD_MIN_CLIENT,
  RENAME_MIN_CLIENT,
  semverGte,
} from "@ob/shared";
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

/**
 * Whether a client's IPC marker is at or above the rename gate (#393): it
 * decodes `former_names`, a former-name receipt `to_name` and the `renamed`
 * push, and its adapter offers the `rename` tool. Absent is a 0.44.x client.
 */
export const seesRename = (clientVersion: string | undefined): boolean =>
  clientVersion !== undefined && semverGte(clientVersion, RENAME_MIN_CLIENT);

/**
 * Whether the daemon an adapter talks to takes the `rename` frame (#393),
 * from the `daemon_version` its `agent` answer carries: the same gate as an
 * adapter's IPC marker, because one release carries the frame and the copy
 * that goes with it. Unknown (no answer yet, or a daemon that predates the
 * field) is below the gate.
 */
export const daemonRenames = (daemonVersion: string | undefined): boolean =>
  seesRename(daemonVersion);

/**
 * A daemon frame as a client below RENAME_MIN_CLIENT must receive it (#393):
 * no former names on a roster, self or status row, and no former-name
 * `to_name` on a receipt. A `renamed` push never goes to such a client at all
 * (the daemon pushes it only to links at the gate).
 */
export function withoutRename<F extends DaemonFrame>(f: F): F {
  const noFormer = <R extends { former_names?: unknown }>(row: R) => {
    const { former_names: _f, ...rest } = row;
    return rest as R;
  };
  switch (f.type) {
    case "roster":
      return { ...f, agents: f.agents.map(noFormer) };
    case "agent":
      return f.agent ? { ...f, agent: noFormer(f.agent) } : f;
    case "status":
      return {
        ...f,
        namespaces: f.namespaces.map((n) => ({
          ...n,
          agents: n.agents.map(noFormer),
        })),
      };
    case "receipt": {
      const { to_name: _to, ...receipt } = f;
      return receipt as F;
    }
    default:
      return f;
  }
}

/** A daemon frame as the client with this marker (absent: 0.44.x) decodes it. */
export function forClient<F extends DaemonFrame>(
  f: F,
  clientVersion: string | undefined,
): F {
  let out = f;
  if (!seesCard(clientVersion)) out = withoutCard(out);
  if (!seesRename(clientVersion)) out = withoutRename(out);
  return clientVersion === undefined ? forOldClient(out) : out;
}
