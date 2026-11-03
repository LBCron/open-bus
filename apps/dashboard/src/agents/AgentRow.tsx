import { Badge, TableCell, TableRow } from "@ob/ui/shadcn";
import type { Agent, AgentKind } from "../api/contract";
import { ClaimBadge } from "../ui/ClaimBadge";
import { updated } from "./roster";
import { StatusCell } from "./StatusCell";

/** Labels for the known kinds; a newer kind shows as its own token (C26h). */
const KIND: Record<AgentKind, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "oh-my-pi",
  codex: "Codex",
};

/**
 * Own keys only: a token like `constructor` is a kind too. The roster's
 * schema (KindTokenSchema) already holds a kind to `[a-z0-9-]`, 32 at most.
 */
const kindLabel = (kind: string): string =>
  Object.hasOwn(KIND, kind) ? KIND[kind as AgentKind] : kind;

/** Design D5's presence dot; greyed while the roster is muted. */
const DOT: Record<Agent["state"], string> = {
  live: "bg-(--ob-success)",
  queued: "bg-(--ob-warning)",
};

/** Design D5's row; below md it stacks into a two-column card. */
const ROW =
  "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-4 max-md:py-3";

/**
 * One agent: presence dot and name, kind, machine, its Live or Queued claim
 * (from `Agent.state`) and when it last changed. A global agent gets the
 * accent `global` badge; its home namespace is never shown. `muted` is the
 * as-of time while live updates are paused (ClaimBadge).
 */
export function AgentRow({
  agent,
  muted,
}: {
  agent: Agent;
  muted: string | null;
}) {
  const { name, machineLabel: machine, state } = agent;
  return (
    <TableRow className={ROW}>
      <TableCell className="w-full min-w-0 whitespace-normal px-4 py-2 max-md:p-0">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className={`mt-[7px] size-1.5 shrink-0 rounded-full ${muted ? "bg-(--ob-border-strong)" : DOT[state]}`}
          />
          <div className="grid min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <bdi className="font-mono font-medium [overflow-wrap:anywhere]">
                {name}
              </bdi>
              {agent.global && (
                <Badge
                  variant="secondary"
                  className="font-mono font-medium bg-(--ob-accent-soft) text-(--ob-accent-fg)"
                >
                  global
                </Badge>
              )}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="min-w-0 whitespace-normal px-4 [overflow-wrap:anywhere] md:min-w-32 max-md:col-start-1 max-md:row-start-2 max-md:p-0 max-md:pl-4">
        {kindLabel(agent.kind)}
      </TableCell>
      <TableCell className="min-w-0 whitespace-normal px-4 [overflow-wrap:anywhere] md:min-w-40 max-md:col-span-2 max-md:row-start-3 max-md:p-0 max-md:pl-4">
        <span aria-hidden="true" className="text-muted-foreground md:hidden">
          Status (agent says){" "}
        </span>
        <StatusCell agent={agent} />
      </TableCell>
      <TableCell className="min-w-0 whitespace-normal px-4 md:min-w-44 max-md:col-span-2 max-md:row-start-4 max-md:p-0 max-md:pl-4">
        <span aria-hidden="true" className="text-muted-foreground md:hidden">
          Machine{" "}
        </span>
        <bdi className="font-mono [overflow-wrap:anywhere]">{machine}</bdi>
      </TableCell>
      <TableCell className="px-4 md:min-w-28 max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end max-md:p-0">
        <ClaimBadge
          status={state}
          subject={`${name} on ${machine}`}
          muted={muted}
        />
      </TableCell>
      <TableCell className="px-4 text-muted-foreground md:min-w-24 max-md:col-start-2 max-md:row-start-2 max-md:p-0 max-md:text-right">
        {updated(agent.updatedAt)}
      </TableCell>
    </TableRow>
  );
}
