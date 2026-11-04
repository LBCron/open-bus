import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

/** A reference and a name as they can be stored: bounded, printable, non-empty. */
const printable = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && !/[\r\n]/.test(v);

/** How many agents' names are kept: more than one machine has live sessions. */
export const CHOSEN_NAMES_MAX = 500;

/**
 * The bus name a `rename` chose for an agent, kept per `agent_ref`
 * (#430 item 2). The rest of the daemon's name state is memory: without this,
 * a restart re-proposes the harness's name, the hub renames the agent back,
 * and the name the user picked is reserved against them for the grace hour.
 *
 * Only a name the hub accepted is written, so a refused or never-sent rename
 * leaves nothing behind. The file is 0600 and written atomically (the
 * `sent.json` pattern), and the oldest entry goes once the map is full: a new
 * session on a re-used ref must not inherit a dead ref's name.
 */
export class ChosenNames {
  readonly #max: number;
  readonly #log: ((msg: string) => void) | undefined;
  /** Insertion order is age order: a set moves its ref to the back. */
  #all = new Map<string, string>();

  constructor(
    private readonly file?: string,
    opts: { max?: number; log?: (msg: string) => void } = {},
  ) {
    this.#max = opts.max ?? CHOSEN_NAMES_MAX;
    this.#log = opts.log;
    this.#load();
  }

  /** The name this ref last chose, if any. */
  get(ref: string): string | undefined {
    return this.#all.get(ref);
  }

  /** Drops a ref's kept name: the harness's own name has taken it over. */
  delete(ref: string): void {
    if (this.#all.delete(ref)) this.#save();
  }

  /** Records a name the hub now has for `ref`. */
  set(ref: string, name: string): void {
    if (!printable(ref, 256) || !printable(name, 64)) return;
    this.#all.delete(ref);
    this.#all.set(ref, name);
    for (let over = this.#all.size - this.#max; over > 0; over--)
      this.#all.delete(this.#all.keys().next().value as string);
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
    for (const [ref, name] of Object.entries(raw))
      if (printable(ref, 256) && printable(name, 64)) this.#all.set(ref, name);
  }

  /** Disk trouble is logged; memory still serves this daemon's lifetime. */
  #save(): void {
    if (!this.file) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      rmSync(tmp, { force: true });
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.#all)), {
        mode: 0o600,
        flag: "wx",
      });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (e) {
      this.#log?.(
        `chosen names write failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
