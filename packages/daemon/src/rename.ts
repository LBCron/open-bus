import type { Unframed } from "@ob/ipc";
import {
  frameId,
  type NameKind,
  RENAME_MIN_CLIENT,
  semverGte,
} from "@ob/shared";
import type { AgentRecord, AgentTable } from "./agents.ts";

/**
 * Whether a hub, from its `hello_ok` version, takes the `rename` frame
 * (#393). Unknown (no `hello_ok` yet, or a link that dropped) counts as old:
 * the rename goes out as a re-sent `agent_up`, which every hub reads. A
 * version that is not a release (`dev`) counts as new, as it does for the
 * card gate: a hub that cannot read the frame answers `bad_frame`, and the
 * rename is re-sent as `agent_up` once.
 */
export const hubRenames = (version: string | undefined): boolean => {
  if (version === undefined) return false;
  const core = version.replace(/[-+].*$/, "");
  return !semverGte(core, "0.0.0") || semverGte(core, RENAME_MIN_CLIENT);
};

/**
 * This daemon offers the `rename` tool (#393): its build is at or above the
 * gate. An older daemon answers the frame as bad_frame.
 */
export const offersRename = (version: string): boolean =>
  semverGte(version, RENAME_MIN_CLIENT);

/**
 * Whether a name is the harness's own fallback, which nobody chose (#393):
 * `pi`, `omp`, `opencode`, `codex`, or Claude's `claude-<pid>` file default.
 * The hub mints such a name with a never-reused suffix and does not reserve
 * it after a rename; only a chosen name is reserved. Absent means chosen at
 * the hub, so saying `default` is only ever a narrowing.
 */
export function nameKindOf(kind: string, name: string): NameKind {
  if (kind === "claude-code" && /^claude-\d+$/.test(name)) return "default";
  if (kind === "claude-code") return "chosen";
  return name === kind ? "default" : "chosen";
}

/** Answers a local request: whoever asked hears the outcome. */
export type RenameReply = (f: Unframed) => unknown;

type Pending = {
  ref: string;
  reply?: RenameReply;
  /** Re-sent as `agent_up`: never falls back a second time. */
  viaUp?: boolean;
};

export type RenamesOptions = {
  agents: AgentTable;
  /** The hub's version from its last `hello_ok`; undefined before one. */
  hubVersion: () => string | undefined;
  /** Whether a frame can go out at all. */
  open: () => boolean;
  /** Sends the hub `rename` for the record's proposed name under `id`; false when it never left. */
  sendRename: (rec: AgentRecord, id: string) => boolean;
  /** Re-sends `agent_up` with the record's proposed name under `id`; false when it never left. */
  sendUp: (rec: AgentRecord, id: string) => boolean;
  /** The `agent` frame content for rec, as `self` answers it. */
  info: (rec: AgentRecord) => Unframed;
  /** Pushes `renamed` to the agent's persistent links that read it (Pi/omp at the gate). */
  push: (rec: AgentRecord, name: string, former?: string) => void;
  log?: (msg: string) => void;
};

/**
 * The daemon's name state (#393). Two values are kept apart: `harnessName`,
 * the last value the harness reported, and `proposedName`, what was last asked
 * of the hub. A harness rename is an *edge* on `harnessName`; reading the same
 * value again proposes nothing. A tool rename sets `proposedName` and leaves
 * `harnessName` alone, so a later harness edge overrides it (both are
 * deliberate acts, and the latest wins).
 */
export class Renames {
  /** Hub frames whose answer settles a rename, by frame id. */
  readonly #pending = new Map<string, Pending>();
  /** The ids in flight per agent_ref: a newer proposal supersedes an older one. */
  readonly #byRef = new Map<string, Set<string>>();

  constructor(private readonly opts: RenamesOptions) {}

  /** Whether the hub link takes `rename` frames right now. */
  get gated(): boolean {
    return hubRenames(this.opts.hubVersion());
  }

  /**
   * A name the harness reports now. Only a change is a rename: the same value
   * read again (every 2 s, every tool call) proposes nothing.
   */
  harness(rec: AgentRecord, name: string | undefined): void {
    if (name === undefined || name === rec.harnessName) return;
    rec.harnessName = name;
    this.propose(rec, name, nameKindOf(rec.kind, name));
  }

  /**
   * A name someone chose (the `rename` tool, the IPC request). Answered by
   * `agent`, the updated self, or by `error`: a hub refusal reaches the caller.
   */
  request(rec: AgentRecord, name: string, reply: RenameReply): void {
    if (rec.proposedName === name) {
      // Already asked for: nothing to send, and the hub's own answer may
      // still be on its way (a de-collided name differs from the proposal).
      reply(this.opts.info(rec));
      return;
    }
    if (!this.propose(rec, name, "chosen", reply))
      reply({
        type: "error",
        code: "hub_unavailable",
        message: "the hub is not connected",
      });
  }

  /** Sets the proposal and sends it; false when the frame never left. */
  private propose(
    rec: AgentRecord,
    name: string,
    kind: NameKind,
    reply?: RenameReply,
  ): boolean {
    rec.proposedName = name;
    rec.nameKind = kind;
    const id = frameId();
    const sent = this.gated
      ? this.opts.sendRename(rec, id)
      : this.opts.sendUp(rec, id);
    if (!sent) return false;
    this.track(rec.ref, id, reply, !this.gated);
    return true;
  }

  private track(
    ref: string,
    id: string,
    reply?: RenameReply,
    viaUp = false,
  ): void {
    this.#pending.set(id, {
      ref,
      ...(reply ? { reply } : {}),
      ...(viaUp ? { viaUp } : {}),
    });
    const ids = this.#byRef.get(ref) ?? new Set<string>();
    ids.add(id);
    this.#byRef.set(ref, ids);
  }

  /** Takes every id in flight for `ref`, and the callers waiting on them. */
  private take(ref: string): RenameReply[] {
    const ids = this.#byRef.get(ref) ?? new Set<string>();
    this.#byRef.delete(ref);
    const out: RenameReply[] = [];
    for (const id of ids) {
      const p = this.#pending.get(id);
      this.#pending.delete(id);
      if (p?.reply) out.push(p.reply);
    }
    return out;
  }

  /**
   * The hub's `renamed`, or the `agent_ok` of the `agent_up` a rename was
   * re-sent as. False when it answers nothing of ours.
   */
  renamed(frame: {
    id: string;
    agent_ref: string;
    bus_name: string;
    former?: string;
  }): boolean {
    const p = this.#pending.get(frame.id);
    if (!p) return false;
    const rec = this.opts.agents.byRef(p.ref);
    const replies = this.take(p.ref);
    if (!rec) {
      for (const reply of replies)
        reply({
          type: "error",
          code: "not_registered",
          message: "this session is not on the bus",
        });
      return true;
    }
    rec.busName = frame.bus_name;
    for (const reply of replies) reply(this.opts.info(rec));
    this.opts.push(rec, frame.bus_name, frame.former);
    return true;
  }

  /**
   * The hub refused a frame of ours. A hub with R393a but not R393b cannot
   * read `rename` and answers `bad_frame`: the same rename goes out as
   * `agent_up`, once. Anything else is the refusal, and it reaches the caller.
   */
  error(frame: { id: string; code: string; message: string }): boolean {
    const p = this.#pending.get(frame.id);
    if (!p) return false;
    const rec = this.opts.agents.byRef(p.ref);
    if (frame.code === "bad_frame" && !p.viaUp && rec && this.opts.open()) {
      this.#pending.delete(frame.id);
      this.#byRef.get(p.ref)?.delete(frame.id);
      const id = frameId();
      if (this.opts.sendUp(rec, id)) {
        this.opts.log?.(
          `the hub cannot read a rename; ${rec.busName} re-registers as ${rec.proposedName}`,
        );
        this.track(p.ref, id, p.reply, true);
        return true;
      }
    }
    const replies = this.take(p.ref);
    for (const reply of replies)
      reply({ type: "error", code: frame.code, message: frame.message });
    return true;
  }

  /** The hub link dropped: nothing in flight will be answered. */
  dropped(): void {
    for (const ref of [...this.#byRef.keys()])
      for (const reply of this.take(ref))
        reply({
          type: "error",
          code: "hub_unavailable",
          message: "the hub connection dropped",
        });
  }
}
