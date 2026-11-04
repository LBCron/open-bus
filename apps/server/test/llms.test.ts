import { env } from "cloudflare:workers";
import { AGENT_HABITS } from "@ob/shared";
import { describe, expect, it } from "vitest";
import { ROUTE_POLICY } from "../src/auth/route-policy.js";
import type { Env } from "../src/env.js";
import worker from "../src/index.js";

const testEnv = env as unknown as Env;
const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;
const assets = {
  fetch: async () =>
    new Response("<!doctype html>spa", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
} as unknown as Fetcher;
const bound = { ...testEnv, ASSETS: assets } as Env;

const get = (p: string, init?: RequestInit, e: Env = bound) =>
  worker.fetch(
    new Request(`https://app.localhost${p}`, init) as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    e,
    ctx,
  );

describe("GET /llms.txt", () => {
  it("is public and served as cacheable plain text", async () => {
    expect(ROUTE_POLICY["GET /llms.txt"]).toEqual({
      public: "agent setup instructions",
    });
    const r = await get("/llms.txt");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    expect((await get("/llms.txt", { method: "HEAD" })).status).toBe(200);
  });

  it("names the hub and orders the sections", async () => {
    const body = await (await get("/llms.txt")).text();
    expect(body).toContain(
      `npx @open-bus/cli --hub https://${testEnv.APP_HOST}`,
    );
    const at = [
      `# OpenBus at ${testEnv.APP_HOST}`,
      "## Connect",
      "## Restart",
      "## Verify",
      "## Troubleshoot",
      "## Working with other agents",
    ].map((h) => body.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(new TextEncoder().encode(body).length).toBeLessThan(4096);
    expect(body).not.toMatch(/<\/?(html|body|div|p|a|br|script)\b/i);
  });

  it("renders every working-with-other-agents habit (#425)", async () => {
    const body = await (await get("/llms.txt")).text();
    for (const h of AGENT_HABITS) expect(body).toContain(`\n- ${h}\n`);
  });

  it("ignores a spoofed Host header", async () => {
    const plain = await (await get("/llms.txt")).text();
    const spoof = await get("/llms.txt", { headers: { host: "evil.example" } });
    expect(await spoof.text()).toBe(plain);
    expect(plain).not.toContain("evil.example");
  });
});

describe("unknown .txt and .md paths", () => {
  it("404 as JSON, never the SPA", async () => {
    for (const p of ["/nope.txt", "/NOPE.MD", "/a%2Etxt", "/docs/x.md"]) {
      for (const method of ["GET", "HEAD"]) {
        const r = await get(p, { method });
        expect(r.status, `${method} ${p}`).toBe(404);
        expect(r.headers.get("content-type"), p).toContain("application/json");
        if (method === "GET")
          expect(await r.text(), p).not.toContain("<!doctype");
      }
    }
  });

  it("leaves robots.txt and other SPA paths alone", async () => {
    expect((await get("/robots.txt")).status).toBe(200);
    const spa = await get("/machines");
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("spa");
  });
});
