// Compiles one Tailwind stylesheet per screen handoff in design/screens/ (D4 on):
// <page>.css from scripts/screens.css, sourcing only <page>.html.
// Run: pnpm --filter @ob/ui build:screens
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGES = ["machines", "live", "settings"];
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const base = readFileSync(here("./screens.css"), "utf8");

for (const page of PAGES) {
  const src = `../../../design/screens/${page}.html`;
  const input = here(`./.screens-${page}.css`);
  const out = here(`../../../design/screens/${page}.css`);
  // A sibling input so screens.css's relative @imports and @source lines resolve.
  writeFileSync(
    input,
    base.replace(
      '@source "../../../design/screens/machines.html";',
      `@source "${src}";`,
    ),
  );
  try {
    execFileSync("tailwindcss", ["-i", input, "-o", out, "--minify"], {
      stdio: "inherit",
      cwd: here(".."),
    });
  } finally {
    rmSync(input, { force: true });
  }
  const header = `/* Generated: do not edit. Source: packages/ui/scripts/screens.css over
   design/screens/${page}.html. Rebuild: pnpm --filter @ob/ui build:screens
   (scripts/build-screens.mjs; one tailwindcss --minify run per page) */\n`;
  writeFileSync(out, header + readFileSync(out, "utf8"));
}
