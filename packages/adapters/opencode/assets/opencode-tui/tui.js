// OpenBus OpenCode TUI plugin: publishes which root sessions this TUI has
// opened, so the daemon delivers to a session only while a TUI has it, and
// each root session's title, which is how an OpenCode agent is named.
// Ported from agent-bus's opencode presence plugin; only the home changed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const POLL_MS = 500;

function setup(api) {
  try {
    const home = path.resolve(
      process.env.OPENBUS_HOME || path.join(os.homedir(), ".openbus"),
    );
    const dir = path.join(home, "opencode-tui");
    const file = path.join(dir, `${process.pid}.json`);
    const roots = new Set();
    /** The title last published per root: retitling a root is a rename (#393). */
    const titles = new Map();

    // The root session behind `id`, with the title it has right now. Walking
    // to the root is cheap at 500 ms and the title is what changes.
    const root = (id) => {
      const seen = new Set();
      while (typeof id === "string" && !seen.has(id)) {
        seen.add(id);
        const session = api.data.session.get(id);
        if (!session) return undefined;
        if (!session.parentID)
          return {
            id,
            title: typeof session.title === "string" ? session.title : "",
          };
        id = session.parentID;
      }
      return undefined;
    };

    // True once the file says this; false on any fs error, so the caller
    // records nothing and the next tick tries again.
    const write = (ids, named) => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        const body = {
          pid: process.pid,
          sessionIDs: ids,
          titles: Object.fromEntries(named),
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(tmp, JSON.stringify(body));
        fs.renameSync(tmp, file);
        return true;
      } catch {
        return false;
      }
    };

    const tick = () => {
      try {
        const route = api.ui.router.current();
        if (route?.type !== "session") return;
        const found = root(route.sessionID);
        if (!found) return;
        // A session already listed keeps its place; only a new one is added.
        const known = roots.has(found.id);
        if (known && titles.get(found.id) === found.title) return;
        const ids = known ? [...roots] : [...roots, found.id];
        const named = new Map(titles).set(found.id, found.title);
        if (!write(ids, named)) return;
        roots.add(found.id);
        titles.set(found.id, found.title);
      } catch {}
    };

    process.once("exit", () => {
      try {
        fs.rmSync(file, { force: true });
      } catch {}
    });
    setInterval(tick, POLL_MS).unref?.();
  } catch {}
}

export default { id: "openbus.opencode.presence", setup };
