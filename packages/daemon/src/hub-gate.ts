import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hubRenames } from "./rename.ts";

/** A stored version is a release or a build tag; anything else is dropped. */
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

/**
 * The hub's version, in the two shapes the daemon needs (#430 item 1).
 *
 * The link's own version (`linkVersion`) is what `status` reports and what the
 * card gate asks for: before this link's `hello_ok` the daemon does not know
 * which hub it is, and a card request waits.
 *
 * The rename gate asks a different question, and cannot wait: `onOpen` replays
 * every live agent's `agent_up` *before* `hello_ok` arrives, and an announce
 * without `name_kind` is read as a chosen name by the hub, reserving a default
 * name for the grace hour (#393 amendment 5). So the last `hello_ok` version
 * outlives the link that carried it, and is written to `hub-version.json`
 * (0600, atomic, the `sent.json` pattern) so a cold start after an upgrade or
 * a reboot gates correctly too. Its `hello_ok` corrects it either way.
 *
 * A remembered version can be wrong — the hub may have been downgraded, or the
 * file may predate one — and that is harmless: a hub that cannot read
 * `name_kind` answers `bad_frame`, and `refused()` rewrites the record as below
 * the gate, so no further announce carries the field until a `hello_ok` says
 * otherwise. `below_gate` is written rather than a made-up version: the daemon
 * knows the hub is older than the gate, not which version it runs.
 */
export class HubGate {
  /** This link's `hello_ok` version; undefined before one and after a drop. */
  #link: string | undefined;
  /** The last one seen, across links and restarts: the rename gate reads it. */
  #version: string | undefined;
  #belowGate = false;
  #log: ((msg: string) => void) | undefined;

  constructor(
    private readonly file?: string,
    opts: { log?: (msg: string) => void } = {},
  ) {
    this.#log = opts.log;
    this.#load();
  }

  /** The hub's version on this link: `status`'s `hub_version`, and the card gate. */
  get linkVersion(): string | undefined {
    return this.#link;
  }

  /** Whether the hub reads `rename` and `name_kind` right now (#393's gate). */
  get gated(): boolean {
    return !this.#belowGate && hubRenames(this.#version);
  }

  /** The hub's `hello_ok`: its own word, so an earlier refusal is over. */
  saw(version: string): void {
    this.#link = version;
    if (this.#version === version && !this.#belowGate) return;
    this.#version = version;
    this.#belowGate = false;
    this.#save();
  }

  /** The link dropped: its version is no longer this link's, but the gate keeps it. */
  dropped(): void {
    this.#link = undefined;
  }

  /**
   * The hub refused a frame only a gated hub reads (`bad_frame` on a
   * `name_kind`): it is older than the version remembered for it.
   */
  refused(): void {
    if (this.#belowGate) return;
    this.#belowGate = true;
    this.#save();
  }

  #load(): void {
    if (!this.file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const { version, below_gate } = raw as Record<string, unknown>;
    if (typeof version === "string" && VERSION_RE.test(version))
      this.#version = version;
    this.#belowGate = below_gate === true;
  }

  /** Disk trouble is logged; memory still serves this daemon's lifetime. */
  #save(): void {
    if (!this.file) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      rmSync(tmp, { force: true });
      writeFileSync(
        tmp,
        JSON.stringify({
          ...(this.#version === undefined ? {} : { version: this.#version }),
          ...(this.#belowGate ? { below_gate: true } : {}),
        }),
        { mode: 0o600, flag: "wx" },
      );
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (e) {
      this.#log?.(
        `hub version file write failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
