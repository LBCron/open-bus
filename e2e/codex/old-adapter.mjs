// Test-only (C27k): `node --import` this before the CLI bundle to run
// `open-bus mcp codex` as an adapter from before C27a (0.61.0), which sent no
// item id: each request's `_meta.itemId` is dropped before the adapter reads
// stdin, and its hello says 0.61.0. It runs in the adapter's own process, so
// the adapter stays Codex's child.
import { Socket } from "node:net";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

const real = process.stdin;
const fed = new PassThrough();
createInterface({ input: real })
  .on("line", (line) => {
    let out = line;
    try {
      const m = JSON.parse(line);
      if (m?.params?._meta && "itemId" in m.params._meta) {
        const { itemId: _, ...meta } = m.params._meta;
        out = JSON.stringify({ ...m, params: { ...m.params, _meta: meta } });
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
