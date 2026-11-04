import type { Kind } from "@ob/ipc";
import type { NameKind } from "@ob/shared";

export type AgentRecord = {
  ref: string;
  kind: Kind;
  /** What the daemon last asked the hub for (#393): a tool rename sets it, a harness edge overrides it. */
  proposedName: string;
  /** Whose name `proposedName` is: a harness fallback or something chosen. Absent: chosen. */
  nameKind?: NameKind;
  /**
   * The last name the harness itself reported (#393). A change is a rename;
   * the same value is not. A tool rename writes the name back into a Pi or
   * omp session, so it moves this too (#430).
   */
  harnessName?: string;
  busName: string;
  namespace: string;
  global: boolean;
  pid: number;
  cwd: string;
  live: boolean;
};

export class AgentTable {
  #byRef = new Map<string, AgentRecord>();
  up(rec: AgentRecord): AgentRecord {
    this.#byRef.set(rec.ref, rec);
    return rec;
  }
  down(ref: string): void {
    this.#byRef.delete(ref);
  }
  byRef(ref: string): AgentRecord | undefined {
    return this.#byRef.get(ref);
  }
  byName(name: string): AgentRecord | undefined {
    for (const a of this.#byRef.values()) if (a.busName === name) return a;
    return undefined;
  }
  all(): AgentRecord[] {
    return [...this.#byRef.values()];
  }
  openRefs(): string[] {
    return this.all()
      .filter((a) => a.live)
      .map((a) => a.ref);
  }
  closedRefs(): string[] {
    return this.all()
      .filter((a) => !a.live)
      .map((a) => a.ref);
  }
}
