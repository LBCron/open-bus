// Drives the CLI's own service step (realCtx().service), nothing by hand.
import { createRequire } from "node:module";
const repo = process.env.REPO;
const req = createRequire(`${repo}/packages/cli/package.json`);
const { createJiti } = await import(req.resolve("jiti"));
const jiti = createJiti(import.meta.url);
const { realCtx } = await jiti.import(`${repo}/packages/cli/src/context.ts`);
const { serviceNames } = await jiti.import(`${repo}/packages/cli/src/steps/service.ts`);
const ctx = realCtx(true);
const names = serviceNames(ctx.home, ctx.userHome);
const cmd = process.argv[2];
let r;
if (cmd === "names") r = names;
else if (cmd === "ensure") r = await ctx.service.ensure();
else if (cmd === "remove") r = await ctx.service.remove();
else if (cmd === "status") r = await ctx.status({ path: `${ctx.home}/daemon.sock`, timeoutMs: 2000 }).catch((e) => ({ error: String(e) }));
console.log(JSON.stringify({ cmd, kind: ctx.service.kind, label: names.label, r }));
process.exit(0);
