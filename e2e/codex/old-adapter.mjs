// Test-only (C27k): `node --import` this before the CLI bundle to run
// `open-bus mcp codex` as an adapter from before C27a (0.61.0), which sent no
// item id and no turn id: each request's `_meta.itemId` and its turn
// metadata's `turn_id` are dropped before the adapter reads stdin, and its
// hello says 0.61.0. It runs in the adapter's own process, so the adapter
// stays Codex's child.
import { Socket } from "node:net";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

const TURN_META = "x-codex-turn-metadata";

/** The turn metadata with `turn_id` gone; untouched when it is not JSON. */
function withoutTurnId(header) {
  if (typeof header !== "string") return header;
  try {
    const { turn_id: _, ...rest } = JSON.parse(header);
    return JSON.stringify(rest);
  } catch {
    return header;
  }
}

const real = process.stdin;
const fed = new PassThrough();
createInterface({ input: real })
  .on("line", (line) => {
    let out = line;
    try {
      const m = JSON.parse(line);
      const meta = m?.params?._meta;
      if (meta) {
        const { itemId: _, [TURN_META]: header, ...rest } = meta;
        m.params._meta = { ...rest, [TURN_META]: withoutTurnId(header) };
        out = JSON.stringify(m);
      }
    } catch {}
    fed.write(`${out}\n`);
  })
  .on("close", () => fed.end());
Object.defineProperty(process, "stdin", { value: fed, configurable: true });

const write = Socket.prototype.write;
Socket.prototype.write = function (chunk, ...rest) {
  const out =
    typeof chunk === "string" && chunk.includes('"type":"hello"')
      ? chunk.replace(/"client_version":"[^"]*"/, '"client_version":"0.61.0"')
      : chunk;
  return write.call(this, out, ...rest);
};
