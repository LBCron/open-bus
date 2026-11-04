# OpenBus Design Track (D\*) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give OpenBus its whole visual layer: Studio adopted as the direction, `--ob-*` design tokens, the device-approval page and the dashboard screens (machines first, then the live agents and namespaces view), the `npx open-bus` terminal palette and transcript, and the landing page with `llms.txt`.

**Architecture:** OpenBus copies open-artifacts in tech and ops, so this track copies its design track. Everything visual derives from one record, `design/DIRECTION.md` (Studio, adopted verbatim from `openartifacts/design/DIRECTION.md`, no mockup round). `packages/ui/src/tokens` is the single source of color, type and shape; every screen, the CLI palette and the landing consume it. Screens are static HTML handoffs, one file per surface, that Frontend and Backend match. The device-approval page is not a mockup: it is the exact file the Worker renders.

**Tech Stack:** TypeScript 5.x, pnpm 10 workspaces, vitest, Biome, Geist + Geist Mono (Google Fonts, system fallback), Astro 5 (landing only), static HTML + CSS for everything in `design/`.

**Spec:** `docs/superpowers/specs/2026-10-21-openbus-design.md` §Visual identity, §Login, §Verification. **Overview:** `docs/superpowers/plans/2026-10-21-openbus/00-overview.md` (contracts, delivery, review focus). Executors read all three together.

---

## Before you start

**Dependency:** nothing in this plan can start until **F1** (repo scaffold, test harness, CI) is on `origin/main`. Then, once, create the worktree:

```bash
cd /Users/leonardourbina/code/projects/openbus
git fetch origin
git worktree add /Users/leonardourbina/code/projects/openbus-de -b de
```

Every task branches from an up-to-date `origin/main`:

```bash
cd /Users/leonardourbina/code/projects/openbus-de
git fetch origin
git switch -c de/d<N>-<slug> origin/main
```

**Copy before you write.** The source of truth for every visual decision is `~/code/projects/openartifacts`. Where a step says "copy X", read X first and reproduce it, with only the listed edits.

**Execution loop** (overview §"How each lead executes", unchanged): implementer subagent working TDD where there are tests → spec-compliance reviewer → adversarial reviewer ("find inputs, sequences or environments where it breaks, leaks, misleads, or contradicts the spec") → fix until both pass → one PR per task → CI green → merge through the queue → staging smoke → superpowers:verification-before-completion with output pasted.

**Showing the user anything.** Every page the user reads goes to **artifacts.leourbina.com through the `open-artifacts` MCP**, never a localhost companion. Publish rules for this track:
- One artifact per page. `publish_artifact` with `files`: the page plus, when the page links them, `tokens.css` (the contents of `packages/ui/src/tokens/tokens.css`).
- Publishing rewrites exactly one thing: the stylesheet `href="../../packages/ui/src/tokens/tokens.css"` becomes `href="tokens.css"`. Everything else ships byte-identical to the repo file. A step that publishes says so explicitly.
- Visibility stays **private**. Never call `set_visibility` without the user asking.
- Each publish ends by sending the manager (`openbus-e0`) the artifact URL in one line.

**Screenshots** (every task that produces UI, overview PR rule "light and dark screenshots for UI changes"): run the `proofshot` skill against the published artifact URL or the local file, capture **light and dark at 1280 px and 390 px**, save under `logs/design/d<N>-<slug>/` (gitignored), and put both the artifact URL and the screenshot paths in the PR body.

**Contract messages.** `packages/ui` exports are contract (overview §Contracts). D2 and D6 change them: before merging, message `openbus-e0`, `OpenBus Frontend`, `OpenBus Backend` and (D6 only) `OpenBus Frontend-2` with what changed and how to consume it.

## File map

| File                                            | Responsibility                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `design/DIRECTION.md`                           | The one record of the visual direction and the `--ob-*` mapping                               |
| `packages/ui/src/tokens/tokens.css`             | Every CSS custom property, light and dark                                                     |
| `packages/ui/src/tokens/index.ts`               | The same colors as `tokens`, for tests and code                                               |
| `packages/ui/src/tokens/terminal.ts`            | The CLI terminal palette and its ANSI fallback                                                |
| `packages/ui/src/brand/mark.svg`, `favicon.svg` | The minimum brand the pages need                                                              |
| `packages/ui/test/contrast.test.ts`             | WCAG bars for the tokens                                                                      |
| `packages/ui/test/sync.test.ts`                 | `tokens.css` and `index.ts` cannot drift                                                      |
| `packages/ui/test/terminal.test.ts`             | WCAG bars and shape for the terminal palette                                                  |
| `packages/ui/test/screens.test.ts`              | The device-approval contract (no JS, no external requests, under 8 KB, fixed placeholder set) |
| `design/screens/device-approval.html`           | The Worker's template, handoff to Backend                                                     |
| `design/screens/edge-pages.html`                | Expired, denied, unknown and not-you states                                                   |
| `design/screens/machines.html`                  | Machines page with revoke, handoff to Frontend                                                |
| `design/screens/live.html`                      | Live agents and namespaces view, handoff to Frontend                                          |
| `design/screens/README.md`                      | Index: how to view, params, per-screen notes                                                  |
| `design/cli/PALETTE.md`                         | Terminal palette rules for the client track                                                   |
| `design/cli/transcript.md`                      | Exact `npx open-bus` output, every state                                                      |
| `design/cli/npx-open-bus.html`                  | Visual mock of that transcript, light and dark                                                |
| `design/landing/landing.html`                   | Landing design mock, light and dark                                                           |
| `apps/landing/**`                               | The Astro landing site and `llms.txt`                                                         |

## Contracts this track owns and consumes

**Owns (announce before merge):** `packages/ui` exports (`tokens`, `terminal`, `terminalAnsi`, and `import "@ob/ui/tokens.css"`), and the placeholder set of `design/screens/device-approval.html`.

**Consumes, never edits:** `packages/shared` (`REPO_URL` from `src/meta.ts`, F2), the REST routes and wire frames (overview §Contracts), the adapter tool manifest (client track, C\*), the setup scripts' install procedure (client/platform). When a consumed contract disagrees with a page, change the page and tell the manager; never edit the other track's package.

**Pinned values this track must show exactly** (from the overview, do not invent):

| Thing                   | Value                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Machine token           | `ob_machine_` + 32 base58 chars (show at most 4 trailing chars anywhere)                                    |
| Device code             | 8 chars `[A-Z2-9]`, shown as `XXXX-XXXX`, expires in 10 minutes                                             |
| Mail expiry / inbox cap | 1 hour / 50 undelivered                                                                                     |
| Receipt states          | `pending` \| `delivered` \| `expired` \| `refused`                                                          |
| Refusal reasons         | `unknown_agent` \| `closed` \| `inbox_full` \| `too_large` \| `other_namespace` \| `revoked` \| `ambiguous` |
| Revoke close code       | WebSocket `4403`                                                                                            |
| MCP tools               | `list_agents`, `send_message`, `fetch`, `self`                                                              |

**PR titles for this track:** `docs(ui): …` for `design/` files, `feat(ui): …` for `packages/ui`, `feat(landing): …` for `apps/landing`, each with ` (D<N>)` appended. Branches `de/d<N>-<slug>`.

---

### Task D1: DIRECTION.md and the minimum brand

**Files:**
- Create: `design/DIRECTION.md`
- Create: `packages/ui/src/brand/mark.svg`
- Create: `packages/ui/src/brand/favicon.svg`

There is no decision round. The user adopted Studio verbatim on 2026-10-21 (spec §Visual identity), so D1 is the record, not a proposal.
- [ ] **Step 1: Write `design/DIRECTION.md`.**

Start from `openartifacts/design/DIRECTION.md` and reproduce every table unchanged (type pairing, neutral ramp, accent, radius scale, measured contrasts, notes for D2, rationale). Then make exactly these edits:
1. Replace the H1 and first paragraph with:

```markdown
# Visual direction: Studio (adopted)

Adopted verbatim from Open Artifacts' Studio direction
(`~/code/projects/openartifacts/design/DIRECTION.md`) on 2026-10-21, by user decision
recorded in `docs/superpowers/specs/2026-10-21-openbus-design.md` §Visual identity.
There was no mockup round: OpenBus does not pick its own direction, it inherits Studio.
```

2. In the "Notes for D2" section, rename every `--oa-` to `--ob-`, and change "D2's `--oa-border`" style wording to "D2's `--ob-border`".
3. Append this section at the end:

```markdown
## OpenBus additions

- **Prefix.** Every custom property is `--ob-*`. `packages/ui/src/tokens/tokens.css` is the
  only definition; `packages/ui/src/tokens/index.ts` mirrors its colors and
  `packages/ui/test/sync.test.ts` fails if they drift.
- **State colors carry bus semantics.** `success` is a live or delivered thing (a connected
  machine, a `delivered` receipt), `warning` is waiting (a queued message, an expiring code),
  `danger` is refused or revoked, `accent` marks namespace and global state and focus.
  A machine row is never green because it is important; it is green because it is connected.
- **Terminal.** The `open-bus` CLI derives its palette from this ramp. See
  `design/cli/PALETTE.md`. The one exception to "one accent": the terminal's success,
  warning and danger map to ANSI green, yellow and red, because a terminal has no badges.
- **No-JS pages.** `design/screens/device-approval.html` inlines these values and loads
  nothing (no font request, no favicon dependency beyond same-origin). It is under 8 KB.
```

- [ ] **Step 2: Write the brand minimum.** No brand round: the pages need a mark and a favicon, nothing more.

`packages/ui/src/brand/mark.svg` (the bus: one hub, two endpoints):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
  <path d="M5 12h14"/>
  <circle cx="5" cy="12" r="2.25"/>
  <circle cx="19" cy="12" r="2.25"/>
  <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>
</svg>
```

`packages/ui/src/brand/favicon.svg` (the same glyph on an ink plate, legible at 16 px):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#15181C"/>
  <g stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" fill="none">
    <path d="M8 16h16"/>
    <circle cx="8" cy="16" r="2.5"/>
    <circle cx="24" cy="16" r="2.5"/>
  </g>
  <circle cx="16" cy="16" r="3.4" fill="#FFFFFF"/>
</svg>
```

The wordmark is not an asset: it is the text "OpenBus" in `--ob-font-mono` at 500 weight with `letter-spacing: -0.01em`. Every page in this track uses that rule.
- [ ] **Step 3: Verify.**

Run: `xmllint --noout packages/ui/src/brand/mark.svg packages/ui/src/brand/favicon.svg && wc -c packages/ui/src/brand/*.svg`
Expected: no errors, both files under 800 bytes.
- [ ] **Step 4: Commit.**

```bash
git add design/DIRECTION.md packages/ui/src/brand
git commit -m "docs(ui): adopt Studio direction and brand minimum (D1)"
```

---

### Task D2: Design tokens (`@ob/ui`)

**Files:**
- Create: `packages/ui/src/tokens/tokens.css`, `packages/ui/src/tokens/index.ts`, `packages/ui/src/index.ts`, `packages/ui/vitest.config.ts`
- Modify: `packages/ui/package.json` (created by F1)
- Test: `packages/ui/test/contrast.test.ts`, `packages/ui/test/sync.test.ts`

**Prerequisite check:** `ls packages/ui/package.json` exists (F1 scaffold) and `pnpm --filter @ob/ui test` is wired. If F1 named the package differently, use F1's name everywhere below and say so in the contract message. If `packages/ui` does not exist at all, stop and tell `openbus-e0`: F1 has not landed.
- [ ] **Step 1: Write the failing contrast test.**

`packages/ui/test/contrast.test.ts` (this is the whole file):

```ts
import { describe, expect, it } from "vitest";
import { tokens } from "../src/index";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const pairs: [fg: string, bg: string, min: number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["accent-text", "accent", 4.5],
  ["text-muted", "bg", 4.5],
  ["text-muted", "surface", 4.5],
  ["border", "bg", 1.5],
  ["border-strong", "bg", 3],
  ["border-strong", "surface", 3],
  ["border-strong", "surface-2", 3],
  ["success", "success-soft", 4.5],
  ["success-fg", "success-soft", 4.5],
  ["danger", "danger-soft", 4.5],
  ["warning", "warning-soft", 4.5],
];

describe.each(["light", "dark"] as const)("%s theme", (theme) => {
  it.each(pairs)("%s on %s is at least %s:1", (fg, bg, min) => {
    const a = tokens[fg]?.[theme];
    const b = tokens[bg]?.[theme];
    expect(a, fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(b, bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(a as string, b as string)).toBeGreaterThanOrEqual(min);
  });
});
```

- [ ] **Step 2: Write the failing sync test.**

`packages/ui/test/sync.test.ts` (this is the whole file):

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokens } from "../src/index";

const css = readFileSync(
  new URL("../src/tokens/tokens.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose prelude matches `prelude`. */
function block(prelude: string): Map<string, string> {
  const at = css.indexOf(prelude);
  expect(at, prelude).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    i++;
  }
  const props = new Map<string, string>();
  for (const [, name, value] of css
    .slice(open + 1, i - 1)
    .matchAll(/--ob-([\w-]+)\s*:\s*([^;]+);/g)) {
    expect(props.has(`--ob-${name}`), `duplicate --ob-${name}`).toBe(false);
    props.set(name as string, (value as string).trim().toLowerCase());
  }
  return props;
}

const light = block(":root {");
const dark = block(':root[data-theme="dark"] {');

describe("tokens.css mirrors tokens", () => {
  it("defines every exported token in :root", () => {
    expect([...light.keys()]).toEqual(
      expect.arrayContaining(Object.keys(tokens)),
    );
  });

  it.each(Object.keys(tokens))("%s matches in light and dark", (key) => {
    expect(light.get(key)).toBe(tokens[key]?.light.toLowerCase());
    expect(dark.get(key)).toBe(tokens[key]?.dark.toLowerCase());
  });

  it("keeps the dark media block identical to the dark attribute block", () => {
    const media = block(':root:not([data-theme="light"]) {');
    expect([...media.entries()].sort()).toEqual([...dark.entries()].sort());
  });
});
```

- [ ] **Step 3: Run the tests and see them fail.**

Run: `pnpm --filter @ob/ui test`
Expected: FAIL. `contrast.test.ts` and `sync.test.ts` both report `Cannot find module '../src/index'`.
- [ ] **Step 4: Implement the tokens.**

`packages/ui/src/tokens/tokens.css`: copy `openartifacts/packages/ui/src/tokens/tokens.css` exactly, then (a) replace every `--oa-` with `--ob-`, including inside `var(...)`, and (b) replace the opening comment with:

```css
/*
 * OpenBus design tokens (Studio, adopted verbatim: design/DIRECTION.md).
 * Fonts load from Google Fonts only; the system stack is the fallback.
 * Colors must stay in sync with ./index.ts (enforced by test/sync.test.ts).
 */
```

Nothing else changes: same 24 colors, same type ramp, radii 4/6/8 px, spacing, shadows, durations, and the same three blocks (`:root`, the `prefers-color-scheme: dark` block on `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`).

`packages/ui/src/tokens/index.ts` (this is the whole file):

```ts
/** Color tokens (`--ob-<key>`), mirrored from tokens.css. Values from design/DIRECTION.md. */
export const tokens: Record<string, { light: string; dark: string }> = {
  bg: { light: "#EEF0F3", dark: "#131518" },
  chrome: { light: "#F5F6F8", dark: "#17191D" },
  surface: { light: "#FFFFFF", dark: "#1C1F23" },
  "surface-2": { light: "#F6F7F9", dark: "#212429" },
  sunken: { light: "#ECEEF1", dark: "#181A1E" },
  divider: { light: "#E0E3E8", dark: "#2C3037" },
  border: { light: "#BEC4CD", dark: "#3B414A" },
  "border-strong": { light: "#848B95", dark: "#676E78" },
  text: { light: "#15181C", dark: "#E9EBEE" },
  "text-2": { light: "#454C56", dark: "#B7BDC6" },
  "text-muted": { light: "#5F6670", dark: "#9097A1" },
  accent: { light: "#2350D0", dark: "#7F9CFF" },
  "accent-fg": { light: "#1D45B8", dark: "#A3B8FF" },
  "accent-soft": { light: "#E7EDFC", dark: "#1F2A4A" },
  "accent-text": { light: "#FFFFFF", dark: "#131518" },
  focus: { light: "#2350D0", dark: "#7F9CFF" },
  success: { light: "#157A3A", dark: "#5BC77F" },
  "success-fg": { light: "#157A3A", dark: "#6FD08F" },
  "success-soft": { light: "#E3F3E8", dark: "#173022" },
  danger: { light: "#BE2F1C", dark: "#FF7F6B" },
  "danger-soft": { light: "#FBE7E3", dark: "#3A1E1A" },
  warning: { light: "#8A5A00", dark: "#E7B44F" },
  "warning-soft": { light: "#FBF0D9", dark: "#352914" },
  scrim: { light: "rgb(0 0 0 / 0.32)", dark: "rgb(0 0 0 / 0.6)" },
};
```

`packages/ui/src/index.ts` (this is the whole file):

```ts
export { tokens } from "./tokens/index";
```

`packages/ui/vitest.config.ts`, only if F1 did not create one (this is the whole file):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

`packages/ui/package.json`: keep F1's scaffold and make sure it has `"name": "@ob/ui"`, `"type": "module"`, `"exports": { ".": "./src/index.ts", "./tokens.css": "./src/tokens/tokens.css" }`, `"engines": { "node": ">=22" }`, and `"scripts": { "test": "vitest run" }`. This export map is the contract Frontend and the client track import.
- [ ] **Step 5: Run the tests and see them pass.**

Run: `pnpm --filter @ob/ui test`
Expected: PASS. 24 `tokens` keys × 2 themes in `contrast.test.ts`, 3 sync checks with 24+24+24 individual comparisons.
- [ ] **Step 6: Announce the contract.**

Send `openbus-e0`, `OpenBus Frontend` and `OpenBus Backend`: "D2 tokens live: import '@ob/ui/tokens.css' or `import { tokens } from '@ob/ui'`. Prefix is `--ob-*`. Tailwind maps them in `@theme` (Frontend owns that mapping; Design owns `packages/ui/src/tokens/*` only)."
- [ ] **Step 7: Commit.**

```bash
git add packages/ui
git commit -m "feat(ui): design tokens (D2)"
```

---

### Task D3: Device approval page (handoff to Backend) and the screen index

**Files:**
- Create: `design/screens/device-approval.html`, `design/screens/edge-pages.html`, `design/screens/README.md`
- Test: `packages/ui/test/screens.test.ts`

This is the page the Worker renders at `GET /approve/:user_code` and the states around it. It is not a mockup: Backend copies `device-approval.html` and substitutes placeholders. It must work with no JavaScript, with inlined tokens, under 8 KB (spec §Visual identity).
- [ ] **Step 1: Write the failing contract test.**

`packages/ui/test/screens.test.ts` (this is the whole file):

```ts
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = new URL(
  "../../../design/screens/device-approval.html",
  import.meta.url,
);
const html = readFileSync(file, "utf8");

describe("design/screens/device-approval.html is the Worker's template", () => {
  it("is under 8 KB", () => {
    expect(statSync(file).size).toBeLessThan(8192);
  });

  it("has no JavaScript and no external requests", () => {
    expect(html).not.toMatch(/<script|javascript:/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/@import|url\(/);
  });

  it("offers exactly the approved placeholder set", () => {
    const used = [
      ...new Set([...html.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])),
    ].sort();
    expect(used).toEqual([
      "bus_host",
      "client_version",
      "csrf_token",
      "form_action",
      "machine_label",
      "switch_url",
      "user_code",
      "user_email",
    ]);
  });

  it("posts an approve or deny decision with CSRF", () => {
    expect(html).toMatch(/method="post" action="\{\{form_action\}\}"/);
    expect(html).toMatch(/name="csrf" value="\{\{csrf_token\}\}"/);
    expect(html).toMatch(/name="decision" value="deny"/);
    expect(html).toMatch(/name="decision" value="approve"/);
  });

  it("states its own contract in the header comment", () => {
    expect(html).toMatch(/HTML-escape every value/);
    expect(html).toMatch(/prefers-color-scheme only/);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `pnpm --filter @ob/ui test`
Expected: FAIL with `ENOENT: design/screens/device-approval.html`.
- [ ] **Step 3: Write `design/screens/device-approval.html`.**

Head: copy the `<!doctype html>` comment pattern of `openartifacts/design/screens/oauth-consent.html`, then `<html lang="en">`, the same `<meta>` block (`viewport`, `robots` `noindex, nofollow`, `referrer` `no-referrer`), `<title>Approve {{machine_label}} · OpenBus</title>`, the two favicon links pointing at `/favicon.svg` and `/favicon.ico` (same-origin, allowed), the two `theme-color` metas (`#EEF0F3` light, `#131518` dark), and then the **entire `<style>` block of `openartifacts/design/screens/oauth-consent.html` unchanged** (its local names `--bg`, `--surface`, `--accent`… already hold the Studio values and are not the `--ob-*` contract). Replace only the comment that opens the file with this one:

```html
<!--
  Device approval (Task D3). Server-rendered by apps/server at GET /approve/:user_code.
  No JavaScript. Self-contained: tokens are inlined, no external requests, under 8 KB.
  Theme follows prefers-color-scheme only (no data-theme, no ?theme param).
  Placeholders (HTML-escape every value):
    {{user_code}}      8 chars shown as XXXX-XXXX, e.g. "K3M7-QW29"
    {{machine_label}}  label the CLI proposed, e.g. "leo-macbook-pro"
    {{client_version}} CLI version, e.g. "0.1.0"
    {{bus_host}}       host of this bus, e.g. "bus.northwind.dev" (no scheme)
    {{user_email}}     signed-in user's email (Cloudflare Access OIDC)
    {{form_action}}    POST target, e.g. "/approve/K3M7-QW29"
    {{csrf_token}}     CSRF token, posted as "csrf"
    {{switch_url}}     URL that signs out and restarts sign-in
  The form posts decision=approve or decision=deny.
-->
```

Body (this is the whole `<body>`):

```html
<body>
<header>OpenBus<span class="mono">{{bus_host}}</span></header>
<main>
  <form class="card" method="post" action="{{form_action}}">
    <input type="hidden" name="csrf" value="{{csrf_token}}">
    <div class="client">
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 8h10M3 8a1.5 1.5 0 1 0 0 .01M13 8a1.5 1.5 0 1 0 0 .01"/></svg></span>
      <div><b>{{machine_label}}</b><small>open-bus {{client_version}} · code <span class="mono">{{user_code}}</span></small></div>
    </div>
    <h1>Approve {{machine_label}}?</h1>
    <p>If you approve, this machine joins your bus as you:</p>
    <ul>
      <li><svg viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg><div><b>Register agents on your bus</b><small>Its agents join their namespaces and show up in every roster there.</small></div></li>
      <li><svg viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg><div><b>Send and receive messages as those agents</b><small>Each message carries the agent's attested identity, never a name it claims itself.</small></div></li>
      <li><svg viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg><div><b>Stay connected until you revoke it</b><small>The token is long-lived and kept on that machine only.</small></div></li>
    </ul>
    <div class="who">Signed in as <b>{{user_email}}</b><a href="{{switch_url}}">Not you?</a></div>
    <div class="note" role="note"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h.01"/></svg><span>Only approve if you just ran npx open-bus on {{machine_label}}.</span></div>
    <div class="actions">
      <button type="submit" name="decision" value="deny">Deny</button>
      <button type="submit" name="decision" value="approve" class="primary">Approve</button>
    </div>
    <p class="foot">You can revoke this machine anytime in Machines.</p>
  </form>
</main>
</body>
```

Copy rules for this page, in force for every later page too: no em dashes anywhere in UI copy; the machine label and the code are the only technical strings shown; "this machine" never becomes "this device" or "your computer".
- [ ] **Step 4: Run the test and see it pass.**

Run: `pnpm --filter @ob/ui test`
Expected: PASS, all five checks. If the size check fails, cut copy in the `<small>` lines; never cut a permission bullet.
- [ ] **Step 5: Write `design/screens/edge-pages.html`.**

One file, four states, same card and the same `<style>` block copied verbatim from `design/screens/device-approval.html`. It is a preview page for the states Backend renders from the same template with a `state` value, so it shows each state inside a `max-width: 440px` card on the Studio `bg`, each preceded by a `<h2>` label in `--muted` 12px uppercase. State content:

| `state`   | Heading                | Body                                                                                                                                  | Actions                                                    |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `expired` | `This code expired`    | `Device codes last 10 minutes. Run npx open-bus on {{machine_label}} again to get a new one.`                                         | one button `Close` (secondary, `type="button"`), no form   |
| `denied`  | `Machine not approved` | `{{machine_label}} was not added to your bus. Nothing was connected.`                                                                 | one button `Close`                                         |
| `unknown` | `Unknown code`         | `This approval link is not for any pending machine. If you are adding a machine, run npx open-bus on it and open the link it prints.` | one button `Close`                                         |
| `not-you` | `Not your bus`         | `You are signed in as {{user_email}}, but this bus belongs to its owner. Sign in as the owner to approve machines.`                   | one primary link `Sign in as the owner` → `{{switch_url}}` |

Each card keeps the `header` and `foot` from `device-approval.html`. The `{{...}}` placeholders used here are a subset of the approved set; add none.
- [ ] **Step 6: Write `design/screens/README.md`** (the index, grown by every later task):

```markdown
# Screens (Track D)

High-fidelity screens in the Studio direction (`design/DIRECTION.md`). Frontend matches
`machines.html` and `live.html`; Backend renders `device-approval.html` and the states in
`edge-pages.html`; the client track implements `../cli/transcript.md`.

## How to view

Open the file in a browser (`file://…/design/screens/machines.html`), or run `npx serve` from
the repo root and open `http://localhost:3000/design/screens/<file>`. Use the server if your
browser blocks the relative `tokens.css` link on `file://`. Every screen except
`device-approval.html` (which follows `prefers-color-scheme` only, because it has no
JavaScript) reads `?theme=light|dark`, plus the params below, and carries OA's
`Mockup controls` pill bar at the bottom with the same choices, so the artifacts published to
artifacts.leourbina.com are fully explorable without query strings.

Each screen is designed for 1280 px and 390 px wide, with no horizontal page scroll.

## Screens

| File                   | Screen                            | Params                                                                                                 | Notes                                                                                          |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `device-approval.html` | Device approval (Worker template) | none                                                                                                   | No JS, inlined tokens, under 8 KB. Backend substitutes the placeholders in its header comment. |
| `edge-pages.html`      | Expired, denied, unknown, not-you | `state=expired\|denied\|unknown\|not-you`                                                              | Renders every state at once when the param is omitted.                                         |
| `machines.html`        | Machines                          | `theme`, `state=default\|empty\|loading\|error`, `menu=none\|row\|confirm`, `toast=none\|revoked`      | Rows with revoke.                                                                              |
| `live.html`            | Live agents and namespaces        | `theme`, `state=default\|empty\|loading\|error`, `ns=<namespace>\|global`, `filter=none\|live\|closed` | Roster with reachability.                                                                      |

## Shared rules

- Colors come only from `../../packages/ui/src/tokens/tokens.css`. Screens add no new color.
- Copy has no em dashes. Machine labels, agent names and codes use the mono stack.
- Status is never color alone: every badge has a word and a dot.
```

- [ ] **Step 7: Publish and screenshot.**

Publish `device-approval.html` (self-contained, no `tokens.css` file needed) and `edge-pages.html` (with `tokens.css` and the href rewrite) to artifacts.leourbina.com, one artifact each, private. Then `proofshot`: light and dark at 1280 px and 390 px of `device-approval.html`, and one capture of `edge-pages.html`. Save to `logs/design/d3-device-approval/`. Send `openbus-e0` both URLs in one line.
- [ ] **Step 8: Commit.**

```bash
git add design/screens packages/ui/test/screens.test.ts
git commit -m "docs(ui): device approval screen and screen index (D3)"
```

PR body notes: "Handoff to Backend: `design/screens/device-approval.html` is the template. If F2's device payload names its fields differently, the placeholders change only at the rename level, and I update the test with it."

---

### Task D4: Machines page with revoke (handoff to Frontend)

**Files:**
- Create: `design/screens/machines.html`
- Modify: `design/screens/README.md` (row already present; fill `Notes` if changed)

**Copy sources, read first:** `openartifacts/design/screens/settings.html` for row anatomy, the overflow menu and the confirm dialog; `openartifacts/design/screens/library.html` for the app shell (sidebar, header, drawer below 960 px) and the empty state. Reproduce those patterns with `--ob-` tokens and the copy below.
- [ ] **Step 1: Write `design/screens/machines.html`.**

Structure, in order:
1. `<head>`: `<link rel="stylesheet" href="../../packages/ui/src/tokens/tokens.css">`, `<title>Machines · OpenBus</title>`, one small `<style>` block for layout only (no new colors).
2. **App shell** (from OA `settings.html` / `library.html`, renamed): sidebar with the wordmark rule (Geist Mono 500, "OpenBus") and the `mark.svg` glyph, two `NavItem`s with icons and counts: `Machines` (active, `3`) and `Live` (`5`); at the sidebar's bottom OA's identity row: a 24 px `Avatar`, the user's display name, their email, and a `Sign out` link at its right. No workspace button: this deployment is one owner. Sidebar becomes a drawer below 960 px. Header: breadcrumb `Machines`, and at the right a secondary button `Copy npx open-bus` (copies `npx open-bus`), because adding a machine happens in a terminal, not here.
3. **Summary line** under the header: `3 machines · 2 live` (mono for the counts), then a `Banner` of tone `info` shown only in `state=default`: `Adding a machine: run npx open-bus on it and approve it in the browser that opens.`
4. **Table** with columns `Machine`, `Added`, `Last used`, `Status`, and an actions column. Column headers are `--ob-text-muted` 12 px uppercase, as in OA `settings.html` rows. Row anatomy (OA `settings.html` OAuth-clients and tokens rows, which carry exactly the label / date / relative-time / Revoke shape we need):
   - Machine: a 32 px round `Avatar` seeded from the label (same hue rule as OA), the label in `--ob-text` 500, under it the machine id in `--ob-font-mono` `--ob-text-muted` (12 px, 8 leading chars plus `…`).
   - Added: `Oct 21, 2026`. Last used: `2 min ago`, or `Never` in `--ob-text-muted`.
   - Status: `Badge` with a 6 px dot and a word: `Live` (success-soft, success-fg, filled dot), `Offline` (neutral, `--ob-border-strong` dot), `Revoked` (danger-soft, danger-fg, hollow dot).
   - Actions: a **persistent** `Revoke` pill button in `danger-soft` with `danger-fg` text (OA's revoke button style, always visible, never hover-only), plus an overflow menu with one item, `Copy machine id`. Rows whose status is `Revoked` show `Revoked Oct 21, 2026` in place of the buttons.
5. **Revoke confirm dialog** (`menu=confirm`), OA `share-dialog.html` dialog anatomy: `role="dialog" aria-modal="true"`, centered `--ob-surface` card on a `--ob-scrim`, `--ob-radius-lg`, `--ob-shadow-2`, an `h2` title that names the machine in curly quotes, `Revoke “leo-macbook-pro”?`, one paragraph of body, and a footer row with `Cancel` (secondary, left) and `Revoke` (danger, right). Body copy: `Its connection closes at once and its agents leave the roster. Messages to them are refused. This cannot be undone.` The dialog names the machine in the title, never a bare "this machine".
6. **Toast** (`toast=revoked`): OA's toast, tone `success`, title `{label} revoked`, description `Its sockets closed and its agents left the roster.`, 8 s.

State matrix (every one designed):

| Param   | Value     | What it shows                                                                                                                                                                                                                                                                                                                              |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state` | `default` | 3 rows: `leo-macbook-pro` Live, `leo-mac-mini` Offline, `build-vm-01` Revoked                                                                                                                                                                                                                                                              |
| `state` | `empty`   | OA `library.html` empty state, centered in the table's place: the `mark.svg` glyph, `h2` `No machines yet`, paragraph `Run npx open-bus on a machine to add it. It opens a browser approval and connects.`, a mono chip `npx open-bus` with a `Copy command` button (OA's "Copy MCP URL" chip), and one primary button `Copy npx open-bus` |
| `state` | `loading` | 4 skeleton rows at the row height (48 px), no spinner in the table                                                                                                                                                                                                                                                                         |
| `state` | `error`   | Banner `danger`, title `Couldn't load machines`, body `The bus answered with an error. Nothing changed.`, action `Retry`                                                                                                                                                                                                                   |
| `menu`  | `row`     | The first non-revoked row's overflow menu open                                                                                                                                                                                                                                                                                             |
| `menu`  | `confirm` | The confirm dialog open over `state=default`                                                                                                                                                                                                                                                                                               |
| `toast` | `revoked` | `state=default` with the success toast, and `leo-macbook-pro` shown as `Revoked` in its row                                                                                                                                                                                                                                                |

Counts in the summary line change with the state: `empty` shows `No machines`.
- [ ] **Step 2: The mock harness.** OA screens carry a `Mockup controls` group fixed at the bottom of the page: one pill radiogroup per param (see `openartifacts/design/screens/settings.html`, bottom of page). Reproduce that pattern. Every screen from D4 on ends `<body>` with this block (it is the mock scaffolding, not part of the handoff UI):

```html
<div class="mockbar" role="group" aria-label="Mockup controls"></div>
<script>
  // One entry per param; the first value is the default.
  const spec = {
    theme: ["auto", "light", "dark"],
    state: ["default", "empty", "loading", "error"],
    menu: ["none", "row", "confirm"],
    toast: ["none", "revoked"],
  };
  const q = new URLSearchParams(location.search);
  const bar = document.querySelector(".mockbar");
  const get = (k) => q.get(k) ?? spec[k][0];

  for (const [param, values] of Object.entries(spec)) {
    const group = document.createElement("div");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", param);
    for (const value of values) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.setAttribute("role", "radio");
      pill.textContent = value;
      pill.onclick = () => {
        if (value === spec[param][0]) q.delete(param);
        else q.set(param, value);
        history.replaceState(null, "", `?${q}`);
        render();
      };
      group.append(pill);
    }
    bar.append(group);
  }

  function render() {
    if (get("theme") === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = get("theme");
    for (const el of document.querySelectorAll("[data-show]"))
      el.hidden = el.dataset.show !== get("state");
    for (const el of document.querySelectorAll("[data-show-menu]"))
      el.hidden = el.dataset.showMenu !== get("menu");
    for (const el of document.querySelectorAll("[data-show-toast]"))
      el.hidden = el.dataset.showToast !== get("toast");
    for (const pill of bar.querySelectorAll('[role="radio"]')) {
      const param = pill.parentElement.getAttribute("aria-label");
      pill.setAttribute("aria-checked", String(get(param) === pill.textContent));
    }
  }
  render();
</script>
```

Variant markup is marked with attributes, never with classes: `data-show="error"` for a state, `data-show-menu="confirm"`, `data-show-toast="revoked"`, and for `live.html` the same three plus `data-show-ns` and `data-show-filter` (extend `spec` and `render()` with two more pairs of lines each). Screens with params of their own list them in their `<head>` as `<meta name="mock-params" content="menu=none|row|confirm, toast=none|revoked">`. The `.mockbar` styling: fixed bottom center, `--ob-surface` with `--ob-shadow-2`, radius `--ob-radius-md`, 12 px labels, pills as `--ob-surface-2` with `--ob-border-strong` when `aria-checked="true"` (copy OA's mockup-controls styling); it must never overlap the table at 390 px.
- [ ] **Step 3: Show the user.** Publish `machines.html` with `tokens.css` (href rewrite), private. `proofshot`: light and dark at 1280 px and 390 px for `state=default`, plus one capture each of `empty`, `error` and `menu=confirm`, into `logs/design/d4-machines/`. Send `openbus-e0` the URL.

- [ ] **Step 4: Adversarial pass on the screen.** Check, and fix: the `Revoke` pill is always visible and reachable by keyboard alone (never hover-only); the confirm dialog traps the eye on its named machine and can be dismissed with Escape (`aria-modal="true"`, a focusable `Cancel`); `Revoked` rows expose no revoke action; nothing on the page shows a token value (only `Copy machine id`); at 390 px the table becomes stacked rows with no horizontal scroll and the mock controls stay reachable.

- [ ] **Step 5: Commit.**

```bash
git add design/screens
git commit -m "docs(ui): machines screen with revoke (D4)"
```

---

### Task D5: Live agents and namespaces view (handoff to Frontend)

**Files:**
- Create: `design/screens/live.html`
- Modify: `design/screens/README.md` (row already present)

**Copy source:** `design/screens/machines.html` for the app shell and the mock harness (copy the whole `<style>` layout block, the shell markup and the `<script>` block, then change only what this task lists).
- [ ] **Step 1: Write `design/screens/live.html`.**

1. **App shell** as in D4 with `Live` active instead of `Machines`. Header breadcrumb `Live`.
2. **Namespace bar** under the header: a horizontal set of chips, each with the namespace name in mono and a count: `openbus 5`, `medical-wiki 3`, and last, separated by a divider, `global 2` (accent-soft chip, accent-fg text, with a `global` badge). The selected chip uses `--ob-surface-2` and `--ob-border-strong`; the URL param is `ns`.
3. **Filter chips** to the right (or below at 390 px): `All · Live · Closed` (`filter=`).
4. **Roster table** with columns `Agent`, `Kind`, `Machine`, `Reachable`, `Updated`. Row anatomy:
   - Agent: 6 px presence dot + the **bus name** in mono 500 (`openbus-e0`), under it the harness's own ref in 12 px muted (`ses_…`, Claude `sessionId`, Pi session id) truncated to 12 chars.
   - Kind: `Claude Code`, `OpenCode`, `Pi` as plain text.
   - Machine: the machine label from D4.
   - Reachable: `Badge` + word, and this column is the product truth, matching the delivery rules: `Live` (success: messages are delivered now), `Queued` (warning-soft/warning: its machine is offline, messages wait up to 1 hour), `Closed` (neutral: sends are refused).
   - Updated: `now`, `3 min ago`, `1 h ago`.
5. **Global agents section** below the table: heading `Global agents`, description `Seen by every namespace. Any agent can message them.`, then the same row shape for the 2 global agents, each carrying an accent `global` badge next to its name.
6. **Legend line** under the table, 12 px muted: `Live agents receive at once. Queued agents get messages when their machine reconnects (1 hour). Sends to Closed agents are refused.`

State matrix:

| Param    | Value             | What it shows                                                                                                                                                                                                                                                    |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`  | `default`         | `ns=openbus`: 5 rows (`openbus-e0` OpenCode Live on `leo-macbook-pro`; `OpenBus Frontend` OpenCode Live; `Bloom Bug Hunter` Claude Code Queued on `leo-mac-mini`; `docs-writer` Pi Closed; `release-bot` OpenCode Live on `build-vm-01`), plus the 2 global rows |
| `state`  | `empty`           | OA `library.html` empty state, centered: glyph, `h2` `No agents in this namespace`, paragraph `Agents appear here while a session on an approved machine is running.`, action `Show global agents` (secondary)                                                   |
| `state`  | `loading`         | 5 skeleton rows                                                                                                                                                                                                                                                  |
| `state`  | `error`           | Banner `danger`, title `Couldn't load the roster`, body `The bus answered with an error.`, action `Retry`                                                                                                                                                        |
| `ns`     | `medical-wiki`    | 3 rows, its own counts                                                                                                                                                                                                                                           |
| `ns`     | `global`          | Only the global section, no table                                                                                                                                                                                                                                |
| `filter` | `live` / `closed` | The table filtered; the chip is `--ob-surface-2` when active                                                                                                                                                                                                     |
- [ ] **Step 2: Show the user.** Publish `live.html` with `tokens.css` (href rewrite), private. `proofshot`: light and dark at 1280 px and 390 px for `state=default`, plus `ns=global`, into `logs/design/d5-live/`. Send `openbus-e0` the URL.

- [ ] **Step 3: Adversarial pass.** Check, and fix: `Queued` is never spelled "Away" or "Idle" anywhere (the receipt vocabulary is `pending/delivered/expired/refused`, and the roster vocabulary is `Live/Queued/Closed`, consistently); the presence dot is never the only signal (each badge has the word); a global agent's row is visually identical in every namespace view; the namespace chips wrap at 390 px rather than scrolling sideways.

- [ ] **Step 4: Commit.**

```bash
git add design/screens
git commit -m "docs(ui): live agents and namespaces screen (D5)"
```

---

### Task D6: CLI terminal palette and the `npx open-bus` transcript (handoff to Frontend-2)

**Files:**
- Create: `packages/ui/src/tokens/terminal.ts`, `design/cli/PALETTE.md`, `design/cli/transcript.md`, `design/cli/npx-open-bus.html`
- Test: `packages/ui/test/terminal.test.ts`

The `open-bus` CLI is a UI surface (spec §Login). Its colors derive from Studio; its output copy is designed here and implemented by the client track.
- [ ] **Step 1: Write the failing test.**

`packages/ui/test/terminal.test.ts` (this is the whole file):

```ts
import { describe, expect, it } from "vitest";
import { terminal, terminalAnsi } from "../src/tokens/terminal";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(["light", "dark"] as const)("%s terminal theme", (theme) => {
  const bg = terminal.bg?.[theme] as string;

  it("uses hex colors", () => {
    for (const [key, pair] of Object.entries(terminal))
      for (const t of ["light", "dark"] as const)
        expect(pair[t], key).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(["ink", "muted", "accent", "success", "warning", "danger"])(
    "%s is at least 4.5:1 on bg",
    (key) => {
      expect(
        contrast(terminal[key]?.[theme] as string, bg),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("hairline is at least 1.5:1 on bg", () => {
    expect(
      contrast(terminal.hairline?.[theme] as string, bg),
    ).toBeGreaterThanOrEqual(1.5);
  });
});

describe("ANSI fallback", () => {
  it("maps only palette colors to 16-color slots", () => {
    for (const key of Object.keys(terminalAnsi))
      expect(Object.keys(terminal)).toContain(key);
    for (const pair of Object.values(terminalAnsi))
      for (const t of ["light", "dark"] as const) {
        expect(Number.isInteger(pair[t])).toBe(true);
        expect(pair[t]).toBeGreaterThanOrEqual(0);
        expect(pair[t]).toBeLessThanOrEqual(15);
      }
  });

  it("uses the bright slots on dark", () => {
    for (const pair of Object.values(terminalAnsi))
      expect(pair.dark).toBeGreaterThan(7);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `pnpm --filter @ob/ui test`
Expected: FAIL with `Cannot find module '../src/tokens/terminal'`.
- [ ] **Step 3: Implement `packages/ui/src/tokens/terminal.ts`.**

```ts
/**
 * Terminal palette for the `open-bus` CLI (design/cli/PALETTE.md).
 * Derived from the Studio ramp in ./tokens.css; bars checked by test/terminal.test.ts.
 * Measured contrast on bg: ink 17.8 / 15.3, muted 5.8 / 6.2, accent 6.7 / 7.1,
 * success 5.4 / 8.6, warning 5.9 / 9.6, danger 5.8 / 7.4, hairline 1.8 / 1.8.
 */
export const terminal: Record<string, { light: string; dark: string }> = {
  bg: { light: "#FFFFFF", dark: "#131518" },
  ink: { light: "#15181C", dark: "#E9EBEE" },
  muted: { light: "#5F6670", dark: "#9097A1" },
  accent: { light: "#2350D0", dark: "#7F9CFF" },
  success: { light: "#157A3A", dark: "#5BC77F" },
  warning: { light: "#8A5A00", dark: "#E7B44F" },
  danger: { light: "#BE2F1C", dark: "#FF7F6B" },
  hairline: { light: "#BEC4CD", dark: "#3B414A" },
};

/** ANSI 16-color fallback when the terminal has no truecolor. */
export const terminalAnsi: Record<string, { light: number; dark: number }> = {
  muted: { light: 8, dark: 8 },
  accent: { light: 4, dark: 12 },
  success: { light: 2, dark: 10 },
  warning: { light: 3, dark: 11 },
  danger: { light: 1, dark: 9 },
};
```

- [ ] **Step 4: Run the tests and see them pass.**

Run: `pnpm --filter @ob/ui test`
Expected: PASS. Add the export to `packages/ui/src/index.ts`: `export { terminal, terminalAnsi } from "./tokens/terminal";`
- [ ] **Step 5: Write `design/cli/PALETTE.md`.** The contract for the client track. It must contain, in this order:

1. **The table.** One row per `terminal` entry: name, light hex, dark hex, the Studio token it comes from, and the one thing it may color (below).
2. **Colour is state, not decoration** (the Studio rule): `success` for a completed step or a delivered receipt, `warning` for waiting and expiring, `danger` for a refusal or a revoked machine, `accent` for the device code, the URL and the current namespace, `muted` for meta and timestamps, `hairline` for rules and box borders. `ink` carries all prose. When something is coloured, it is telling you something.
3. **ANSI fallback table** (`terminalAnsi`) with the rule: truecolor when the terminal supports it, ANSI 16 otherwise, and never degrade a state to `ink` (a refusal must stay red even on a 16-colour terminal).
4. **Glyphs**, with ASCII fallbacks for terminals that are not UTF-8: `→`/`>`, `✓`/`+`, `!`, `×`/`x`, `○`/`o`, `●`/`*`, `·`/`-`.
5. **Shape rules:** 80-column safe; exactly one bordered box in the whole CLI (the device code); no box drawing around paragraphs; two spaces after a step glyph; blank line before a new phase; a spinner only while the CLI polls, and only on a TTY (non-TTY prints `Waiting for approval…` once).
6. **Copy rules:** no em dashes; the machine label and the code are the only identifiers printed; a token is never printed beyond its `ob_machine_` prefix and 4 trailing chars; every wait has an end (`10 minutes`); every failure names the next action.
7. **Theme detection:** `NO_COLOR` and `--no-color` disable colour, `FORCE_COLOR` forces it, otherwise follow `process.stdout.hasColors` and the `COLORFGBG`/`TERM` conventions; light and dark palettes are chosen by the terminal's background, defaulting to dark.

- [ ] **Step 6: Write `design/cli/transcript.md`.** The exact output, line by line, in fenced blocks, for these states of `npx open-bus` (this is what the client track implements verbatim; coloured spans are marked with the palette name as the tag: `[[accent]]…[[/accent]]`, `[[success]]…[[/success]]`, `[[warning]]…[[/warning]]`, `[[danger]]…[[/danger]]`, `[[muted]]…[[/muted]]`, and untagged text is `ink`):

1. **First run, browser opens:**

```
open-bus 0.1.0

→ Opening your browser to approve this machine
  If it did not open: [[accent]]https://bus.example.com/approve/K3M7-QW29[[/accent]]
  Code [[accent]]K3M7-QW29[[/accent]] (valid 10 minutes)

[[muted]]Waiting for approval…[[/muted]]

[[success]]✓[[/success]] Approved as leo-macbook-pro
[[success]]✓[[/success]] Token stored in ~/.openbus/credentials ([[muted]]ob_machine_…7f3a[[/muted]])
[[success]]✓[[/success]] Daemon running (pid 48213)

5 agents online in namespace [[accent]]openbus[[/accent]]
```

2. **No browser** (same, with the line `No browser found. Open this URL on any machine:` followed by the URL and code, and no "Opening your browser" line).
3. **Denied:** the waiting spinner, then `[[danger]]×[[/danger]] This machine was not approved.` and `Run npx open-bus again to get a new code.` Nothing else is printed after it.
4. **Expired:** `[[danger]]×[[/danger]] Code K3M7-QW29 expired after 10 minutes.` and `Run npx open-bus again to get a new code.`
5. **Already registered:** `[[success]]✓[[/success]] Already connected as leo-macbook-pro` then the roster count line, no approval flow.
6. **Hub unreachable:** `! Couldn't reach bus.example.com` + `Retrying in 4 s…` (warning, with the backoff schedule on `--verbose` only).

Roster line format and the trailing block are specified here too: one line per agent after success, `  openbus-e0          OpenCode   leo-macbook-pro   [[success]]live[[/success]]`, columns padded to 20/9/22, status colour per the palette. Add the two honesty rules from the spec to the file: a receipt is never `delivered` before the daemon confirmed the harness accepted the message, and a refused send prints its reason from the pinned list (`unknown_agent`, `closed`, `inbox_full`, `too_large`, `other_namespace`, `revoked`, `ambiguous`).
- [ ] **Step 7: Build `design/cli/npx-open-bus.html`, the visual mock.** A presentation page (not a handoff template): a Studio `bg` page with two terminal frames per state (light and dark), each frame a `--ob-surface`/`terminal.bg` rectangle with `--ob-radius-lg`, a 12 px title bar showing `bash — npx open-bus`, and the transcript in `--ob-font-mono` 13 px with the palette applied to the marked spans. It repeats states 1, 3, 4 and 6 in full and states 2 and 5 as one frame each, at 80 columns, plus a closing strip showing the palette table as colour chips. This file is what the user sees; `transcript.md` is what the client track implements.

- [ ] **Step 8: Publish and screenshot.** Publish `npx-open-bus.html` (self-contained; inline its colours from `terminal.ts`, do not link `tokens.css`), private. `proofshot`: the full page light and dark at 1280 px, and one 390 px capture. Save to `logs/design/d6-cli-palette/`. Send `openbus-e0` the URL.

- [ ] **Step 9: Announce the contract.** Message `openbus-e0`, `OpenBus Frontend-2` and `OpenBus Frontend`: "D6 terminal palette live: `import { terminal, terminalAnsi } from '@ob/ui'`, rules in `design/cli/PALETTE.md`, exact output in `design/cli/transcript.md`. The transcript copy is contract: change it here first."

- [ ] **Step 10: Commit.**

```bash
git add packages/ui design/cli
git commit -m "feat(ui): terminal palette and npx open-bus transcript (D6)"
```

---

### Task D7: Landing page and `llms.txt` (`apps/landing`)

**Files:**
- Create: `apps/landing/` (Astro 5, static output): `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/consts.ts`, `src/content/tools.ts`, `src/content/docs/{setup,connect-machines,mcp-tools,namespaces,security,self-hosting-costs}.md`, `src/pages/index.astro`, `src/pages/llms.txt.ts`, `src/pages/llms-full.txt.ts`, `public/favicon.svg`, `public/og.png`
- Create: `design/landing/landing.html` (the design mock shown to the user first)
- Test: `apps/landing/test/llms.test.ts`

**Dependencies, stated:** `REPO_URL` from `packages/shared/src/meta.ts` (F2); the four MCP tool names are pinned in the spec; the install procedure must match the setup scripts (client/platform). If those disagree when this task runs, the setup scripts win and the docs change here. `apps/landing` deploys only when the user provides the domain (overview gate "I (landing)"); until then it builds and previews.
- [ ] **Step 1: Write the design mock and show the user.**

`design/landing/landing.html`: one page, Studio, light and dark (the mock harness from `design/screens/machines.html`), 1280 px and 390 px. Sections in order:
1. **Hero:** one sentence, `A bus on your own Cloudflare account that lets every AI agent you run, on any machine, see the others and message them.` Under it, the single CTA as a copyable code chip: `Tell your agent: set up {{SITE_URL}}/llms.txt` with a `Copy` button, and the line `It deploys OpenBus to your Cloudflare account. You only approve in the browser.`
2. **Three steps**, numbered cards: `1 Tell your agent` (it reads `llms.txt` and runs the setup), `2 Approve in your browser` (sign in with Cloudflare Access, approve each machine), `3 Your agents see each other` (namespaced rosters, messages land in the conversation).
3. **Screens:** the D3 approval screen and the D5 live screen, cropped and framed at `--ob-radius-lg` with a `--ob-shadow-2`.
4. **Feature cards**, six, one line each: `Any harness` (Claude Code, OpenCode, Pi), `Your Cloudflare` (Workers Free, one Durable Object), `Namespaces` (a repo is a namespace; some agents are global), `Messages arrive in full` (only oversized ones become a notice plus a fetch), `Revoke any machine` (its sockets close at once), `$0 for one person`.
5. **Security model**, a quiet four-line list: identity is attested by the machine, never claimed in a message; a namespace sees only its own agents; machine tokens are stored as hashes and revocable; no telemetry leaves your deployment.
6. **Footer:** wordmark, `GitHub` link to `REPO_URL`, `llms.txt` link.

Publish it with no `tokens.css` link (its colours are inlined), private, capture light and dark at 1280 px and 390 px, and send `openbus-e0` the URL. **Wait for the user's notes on this mock before Step 2**; if the manager says the mock is approved as-is, continue.
- [ ] **Step 2: Write the failing test.**

`apps/landing/test/llms.test.ts` (this is the whole file):

```ts
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_URL, REPO_URL } from "../src/consts";

const docs = readdirSync(new URL("../src/content/docs", import.meta.url))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));
const tools = ["list_agents", "send_message", "fetch", "self"];

// The built pages, imported as text so the test does not need a running site.
const llms = readFileSync(
  new URL("../src/pages/llms.txt.ts", import.meta.url),
  "utf8",
);
const source = (await import("../src/pages/llms.txt.ts")) as {
  GET: () => Response;
};
const body = await source.GET().text();

describe("llms.txt", () => {
  it("starts with the product name and summary", () => {
    expect(body.startsWith("# OpenBus\n")).toBe(true);
  });

  it("has the exact set-up headings", () => {
    for (const h of [
      "## Set up OpenBus for your user",
      "## Update an existing install",
      "## Connect another machine",
      "## Tools",
      "## Docs",
    ])
      expect(body).toContain(h);
  });

  it("names every MCP tool", () => {
    for (const t of tools) expect(body).toContain(t);
  });

  it("installs through npx open-bus and links REPO_URL and SITE_URL", () => {
    expect(body).toContain("npx open-bus");
    expect(body).toContain(REPO_URL);
    expect(body).toContain(`${SITE_URL}/llms.txt`);
    expect(llms).toContain("REPO_URL");
  });

  it("links every doc page as .md and nothing else", () => {
    const links = [...body.matchAll(/\(([^)]+\.md)\)/g)].map((m) => m[1]);
    expect(links.sort()).toEqual(
      docs.map((d) => `${SITE_URL}/docs/${d}.md`).sort(),
    );
  });
});
```

- [ ] **Step 3: Run it and see it fail.**

Run: `pnpm --filter @ob/landing test`
Expected: FAIL with `Cannot find module '../src/consts'`.
- [ ] **Step 4: Implement `apps/landing`.**

- `src/consts.ts`: `export { REPO_URL } from "@ob/shared"` (F2 owns that package's export map; if `REPO_URL` hangs off another entry point, change this one import and nothing else), plus `export const SITE_URL = "https://github.com/open-artifacts-ai/open-bus/raw/main/apps/landing/public"` as a temporary default, with the header comment "I replaces this with the landing domain when it exists; every consumer takes it from here". `SITE_URL` is always an absolute `https:` URL.
- `src/content/tools.ts`: the four spec tools with one-line descriptions, header comment "keep in sync with the adapters' tool manifest (client track); verify-release checks the drift".
- `src/content/docs/*.md`: the six pages. `setup.md` is the agent procedure verbatim: check Node 22+ and a Cloudflare account, `npx wrangler login` (the user approves in the browser), create the Access API token the setup asks for ("Access: Apps and Policies: Edit"), deploy, wire each harness (Claude Code global MCP, OpenCode `opencode service restart`, Pi `registerMcpServer`), then `npx open-bus` on every machine and approve it. `connect-machines.md` is the device flow and revoke. `mcp-tools.md` documents the four tools with their arguments and the receipt states. `namespaces.md` covers `.openbus.json`, git-remote defaulting and global agents. `security.md` is the model from the spec (anti-goals included). `self-hosting-costs.md` is the costs section of the spec, "$0 for one person on Workers Free".
- `src/pages/index.astro`: the mock from Step 1, built for real with the Astro components in the same order, the CTA copy button as its one script (progressive: the chip is selectable text without it), `public/og.png` referenced, Lighthouse targets ≥ 95 on performance, accessibility, best practices and SEO.
- `src/pages/llms.txt.ts` and `llms-full.txt.ts`: `text/plain` GET handlers built from the docs collection so they cannot drift. `llms.txt` body order: `# OpenBus` + the summary paragraph + `## Set up OpenBus for your user` (numbered, matching `setup.md`) + `## Update an existing install` + `## Connect another machine` + `## Tools` + `## Docs` (each page as `${SITE_URL}/docs/<page>.md`).
- `public/favicon.svg`: copy of `packages/ui/src/brand/favicon.svg`. `public/og.png`: 1200×630, produced by `proofshot` from the hero of `design/landing/landing.html` cropped to 1200×630.

- [ ] **Step 5: Run the tests and see them pass.**

Run: `pnpm --filter @ob/landing test && pnpm --filter @ob/landing build`
Expected: PASS and a clean Astro build.
- [ ] **Step 6: Lighthouse.**

```bash
npx --yes lighthouse@12 http://localhost:4321 --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=logs/design/d7-lighthouse.json --chrome-flags="--headless"
```

(Start `pnpm --filter @ob/landing preview` first.) Expected: every category ≥ 95. If one is below, fix the page (almost always: heading order, contrast on a muted line, or a missing `alt`).
- [ ] **Step 7: Announce and commit.**

Message `openbus-e0`: "D7 landing + llms.txt built. The install procedure in `apps/landing/src/content/docs/setup.md` is what `llms.txt` tells agents to run; please have the setup owner confirm it matches the scripts. Domain gate stands: the site deploys when the user provides it."

```bash
git add apps/landing design/landing
git commit -m "feat(landing): site, docs, llms.txt (D7)"
```

---

## Milestone: whole-track adversarial review

After D7 (or after D4 if the manager wants an M1 review earlier), run one adversarial review over the whole track with the brief: _"Break the design: find a screen state, copy string, colour pairing or terminal line that misleads the user about what the bus did."_ Known pressure points, each must survive it: the device-approval page names the machine and the code and nothing else; `Revoked` is unmistakable and irreversible-looking; `Queued` never implies delivery; no page prints a token; every screen works at 390 px with no horizontal scroll; every badge carries a word; the transcript never claims `delivered` before confirmation.

Then report to `openbus-e0` in three lines or fewer: what shipped, what contract changed, what is blocked (expected: the landing domain).

---

### Task D16: Agent card screens (AC6, with Frontend)

Spec: `docs/superpowers/specs/2026-10-29-agent-card-design.md` (Delivery row 6). Frontend's behavior and copy: `04-frontend.md` Part 2 (#292). Options page for the user: https://artifacts.leourbina.com/a/Z9ZvBeNzmAGftQrM

**Files:** create `design/screens/roles.html`, `design/screens/link-confirm.html`; modify `design/screens/live.html` (status column, role badge), `design/screens/README.md`. The Linked apps section goes in a new `design/screens/settings.html`.
1. Publish options (done): roles (page or panel), status (column or inline), linked apps (Settings or Machines), link confirm (full or minimal). Recommended: Roles page, status column, Settings › Linked apps, full confirm.
2. On the user's pick, build the screens at 1280 and 390 px, in light and dark, with the states Frontend's tests need:
   - roles: default, empty, Vacant, the add and re-point dialogs, a 400 error inside the dialog, the remove confirm;
   - status: every state, a 64-character label, no status, an unknown state;
   - linked apps: default, empty, the unlink confirm, a punycode `aud` and an `aud` with a port;
   - link confirm: under 8 KB when filled at maximum lengths, with no JavaScript.
3. Rules:
   - Status is never colour alone, and is always tagged "agent says". It uses a dashed, unfilled pill so it never reads as the attested Reachable badge.
   - Vacant uses the warning colour plus the word.
   - Every `aud` is shown whole, in mono, inside `<bdi>`, and never as a link.
   - No em dashes, including as the empty placeholder (use "None").
4. Hand off to Frontend (AC6.2 to AC6.5). Review FE's PRs against the screens.

Copy deltas from 04-frontend.md Part 2: "None" (accessible name "No status") instead of "—" for no status; the link page's buttons are Cancel and Allow.
