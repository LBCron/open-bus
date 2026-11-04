import { Skeleton, TableBody, TableCell, TableRow } from "@ob/ui/shadcn";
import type { Agent } from "../api/contract";
import { TableFrame } from "../ui/TableFrame";
import { AgentRow } from "./AgentRow";

/** The header carries "agent says" once, as a dashed tag (like StatusCell's pill). */
const STATUS_HEAD = (
  <>
    Status<span className="sr-only">,</span>{" "}
    <span
      data-agent-says-tag
      className="ml-1 rounded-sm border border-dashed border-input px-1 py-px text-[11px] font-normal tracking-normal normal-case"
    >
      agent says
    </span>
  </>
);

const HEADS = ["Agent", "Kind", STATUS_HEAD, "Machine", "Reachable", "Updated"];

/** One roster table; when the filter hides every row it says so in place. */
export function RosterTable({
  caption,
  agents,
  muted,
}: {
  caption: string;
  agents: Agent[];
  muted: string | null;
}) {
  return (
    <TableFrame caption={caption} heads={HEADS}>
      <TableBody className="max-md:block">
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} muted={muted} />
        ))}
        {agents.length === 0 && (
          <TableRow className="max-md:block">
            <TableCell
              colSpan={6}
              className="px-4 py-6 text-center text-muted-foreground max-md:block"
            >
              No agents match this filter.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </TableFrame>
  );
}

const NAME_WIDTHS = ["w-32", "w-40", "w-36", "w-28", "w-24"] as const;

/** Five skeleton rows at the 48 px row height, no spinner. */
export function LoadingTable() {
  return (
    <TableFrame caption="Loading agents" heads={HEADS} busy>
      <TableBody aria-hidden="true" className="max-md:block">
        {NAME_WIDTHS.map((w) => (
          <TableRow
            key={w}
            className="h-12 max-md:grid max-md:h-auto max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 max-md:py-3"
          >
            <TableCell className="w-full px-4 max-md:p-0">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-1.5 rounded-full" />
                <Skeleton className={`h-3.5 ${w}`} />
              </div>
            </TableCell>
            <TableCell className="px-4 max-md:col-start-1 max-md:row-start-2 max-md:p-0">
              <Skeleton className="h-3.5 w-20" />
            </TableCell>
            <TableCell className="px-4 max-md:col-span-2 max-md:row-start-3 max-md:p-0">
              <Skeleton className="h-5 w-20 rounded-full" />
            </TableCell>
            <TableCell className="px-4 max-md:col-span-2 max-md:row-start-4 max-md:p-0">
              <Skeleton className="h-3.5 w-28" />
            </TableCell>
            <TableCell className="px-4 max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end max-md:p-0">
              <Skeleton className="h-5 w-16 rounded-full" />
            </TableCell>
            <TableCell className="px-4 max-md:col-start-2 max-md:row-start-2 max-md:justify-self-end max-md:p-0">
              <Skeleton className="h-3.5 w-14" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableFrame>
  );
}
