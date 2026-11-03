import {
  type Agent,
  AgentSchema,
  type Machine,
  MachineSchema,
} from "@ob/shared";
import type { AgentRow, MachineRow } from "./rows.js";
import { statusFields } from "./status.js";

export type { Agent, Machine };

/**
 * Epoch ms to ISO 8601 (UTC, `Z`); null stays null. Never throws: an
 * out-of-range or non-finite value gives "", which fails the schema, so that
 * row is skipped (keepValid) instead of breaking the whole list.
 */
export function iso(ms: number): string;
export function iso(ms: number | null): string | null;
export function iso(ms: number | null): string | null {
  if (ms === null) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * The DTOs that parse with `schema`; the rest are skipped and counted in one
 * log line (no row contents) per call.
 */
export function keepValid<T>(
  schema: { safeParse: (x: unknown) => { success: boolean } },
  dtos: T[],
  what: string,
): T[] {
  const ok = dtos.filter((d) => schema.safeParse(d).success);
  if (ok.length < dtos.length)
    console.warn(
      `hub: skipped ${dtos.length - ok.length} invalid ${what} row(s)`,
    );
  return ok;
}

/** A hub machine row as `MachineSchema` (strict) describes it. */
export const machineDto = (m: MachineRow): Machine => ({
  id: m.id,
  label: m.label,
  createdAt: iso(m.createdAt),
  lastUsed: iso(m.lastUsedAt),
  revokedAt: iso(m.revokedAt),
  connected: m.revokedAt === null && m.connected,
});

/** An open agent row joined with its (unrevoked) machine's label. */
export type AgentWithMachine = Omit<AgentRow, "sessionStartRowid"> & {
  machineLabel: string;
};

/**
 * An open agent as `AgentSchema` (strict) describes it. `connected` is whether
 * its machine holds a daemon socket: live if so, queued otherwise. Callers
 * omit closed agents and agents of revoked machines. `status*` is its applied
 * status (AC3), omitted when none.
 */
export const agentDto = (a: AgentWithMachine, connected: boolean): Agent => ({
  id: a.id,
  namespace: a.namespace,
  name: a.name,
  kind: a.kind as Agent["kind"],
  machineId: a.machineId,
  machineLabel: a.machineLabel,
  global: a.global === 1,
  state: connected ? "live" : "queued",
  updatedAt: iso(a.updatedAt),
  ...statusFields(a),
});

/** Machine rows as validated DTOs (the dashboard feed; the REST route can reuse it). */
export const machineDtos = (rows: MachineRow[]): Machine[] =>
  keepValid(MachineSchema, rows.map(machineDto), "machine");

/** Agent DTOs that parse with AgentSchema. */
export const validAgents = (dtos: Agent[]): Agent[] =>
  keepValid(AgentSchema, dtos, "agent");
