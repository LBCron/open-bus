# OpenBus F2: `packages/shared` Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@ob/shared`, the one contract every other track compiles against: IDs and tokens, limits, names, namespaces, config, wire frames, REST DTOs, dashboard feed events (a WebSocket since the B10-ws ruling; originally SSE), error codes and MSW mocks.

> **B10-ws manager ruling (2026-10-24):** the dashboard feed `GET /api/v1/events` is a hibernatable WebSocket, not SSE (hibernation lets the hub sleep while a dashboard idles; SSE would hold a Worker invocation against the 10 ms CPU limit on Free). `@ob/shared` adds `LIMITS.dashboardSessionClose = 4401`, `EVENTS_DO_PATH = "/events"` `SESSION_EXP_HEADER = "x-ob-session-exp"` and `SESSION_GEN_HEADER = "x-ob-session-gen"`; `BusEventSchema` is unchanged. The MSW mock is now `ws.link("*/api/v1/events")` with `createWsHandler`, `eventsHandler`, `broadcast` and `closeAll`; `handlers` is `[...restHandlers, eventsWsHandler]`. Every SSE mention below is historical; `packages/shared/CONTRACT.md` ("Dashboard feed") is the source of truth.

**Architecture:** A dependency-light TypeScript package (`zod` only) built with `tsc -b`, exactly as `openartifacts/packages/shared`. It holds **pure** functions and Zod schemas: no `fs`, no `crypto.subtle`, no network. The daemon, the Worker, the hub and the dashboard all import it. Wire frames are `snake_case` (pinned by the overview); REST/SSE DTOs are `camelCase` and timestamps are ISO 8601 strings, mirroring Open Artifacts.

**Tech stack:** TypeScript 5.x strict, Zod 4, Vitest, pnpm 10, Biome. Copied patterns from `~/code/projects/openartifacts/packages/shared`.

**Depends on:** F1 (repo scaffold) on `origin/main`. Worktree `~/code/projects/openbus-be`, branch `fo/f2-shared-contract`, PR title `feat(shared): OpenBus contract`.

**Reference files to read before starting:** `~/code/projects/openartifacts/packages/shared/{package.json,tsconfig.json}`, `src/ids.ts`, `src/limits.ts`, `src/errors.ts`, `src/routes.ts`, `src/mocks/handlers.ts`.

---

## File structure

```
packages/shared/
  package.json              # @ob/shared, exports "." and "./mocks"
  tsconfig.json             # tsc -b, declaration + composite (copy OA)
  tsconfig.typecheck.json
  CONTRACT.md               # human summary of the values, frames and routes
  src/
    index.ts                # barrel: re-exports every module below
    ids.ts                  # newId/isId, machine tokens, user codes, msg ids
    limits.ts               # LIMITS (all pinned values), utf8 byte helpers
    meta.ts                 # REPO_URL, PRODUCT_NAME, API_VERSION, OWNER_ORG_ID
    kinds.ts                # AgentKind
    errors.ts               # ERROR_CODES, ApiErrorSchema, STATUS_FOR
    names.ts                # bus-name rules, suffixing, namespace schema
    namespace.ts            # normalizeRemote, namespaceFrom
    config.ts               # .openbus.json schema + CONFIG_FILE
    receipts.ts             # ReceiptState, RefusalReason, labels
    protocol.ts             # daemon <-> hub frames (pinned), encode/decode
    rest.ts                 # R, CSRF_HEADER, Me/Machine/Agent DTOs, device DTOs, SSE
    mocks/fixtures.ts       # sample machines/agents
    mocks/handlers.ts       # MSW handlers
    mocks/index.ts
    *.test.ts               # colocated unit tests
```

---

### Task F2.1: Package skeleton, IDs, tokens, limits, meta

**Files:**
- Create: `packages/shared/package.json`, `tsconfig.json`, `tsconfig.typecheck.json`
- Create: `src/ids.ts`, `src/limits.ts`, `src/meta.ts`, `src/kinds.ts`, `src/index.ts`
- Test: `src/ids.test.ts`, `src/limits.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isId,
  isMachineToken,
  newId,
  newMachineToken,
  newMsgId,
  newDeviceSecret,
  isDeviceSecret,
  newUserCode,
  formatUserCode,
  normalizeUserCode,
  isUserCode,
} from "./ids.js";

describe("ids", () => {
  it("mints 16 base58 chars and validates them", () => {
    const id = newId();
    expect(id).toHaveLength(16);
    expect(isId(id)).toBe(true);
    expect(isId("0OIl" + id.slice(4))).toBe(false);
    expect(isId(id.slice(1))).toBe(false);
  });
  it("mints ob_machine_ plus 32 base58 chars", () => {
    const t = newMachineToken();
    expect(t).toMatch(/^ob_machine_[1-9A-HJ-NP-Za-km-z]{32}$/);
    expect(isMachineToken(t)).toBe(true);
    expect(isMachineToken(t.replace("ob_machine_", "oa_pat_"))).toBe(false);
    expect(isMachineToken(t + "x")).toBe(false);
  });
  it("mints a 16-char msg id", () => {
    expect(newMsgId()).toHaveLength(16);
    expect(isId(newMsgId())).toBe(true);
  });
  it("mints a 43-char device secret", () => {
    const s = newDeviceSecret();
    expect(s).toHaveLength(43);
    expect(isDeviceSecret(s)).toBe(true);
    expect(isDeviceSecret(s.slice(1))).toBe(false);
  });
  it("mints an 8-char user code from A-Z2-9, shown XXXX-XXXX", () => {
    const raw = newUserCode();
    expect(raw).toMatch(/^[A-Z2-9]{8}$/);
    expect(formatUserCode(raw)).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(isUserCode(formatUserCode(raw))).toBe(true);
  });
  it("normalizes typed user codes", () => {
    expect(normalizeUserCode(" ab2c-d3e4 ")).toBe("AB2CD3E4");
    expect(normalizeUserCode("AB2C D3E4")).toBe("AB2CD3E4");
    expect(normalizeUserCode("AB2CD3E")).toBeNull();
    expect(normalizeUserCode("AB2CD3E0")).toBeNull(); // 0 is not in the alphabet
  });
});
```

`src/limits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LIMITS, utf8Bytes, utf8Exceeds } from "./limits.js";

describe("limits", () => {
  it("pins the spec values", () => {
    expect(LIMITS.inlineBodyBytes).toBe(32 * 1024);
    expect(LIMITS.maxMessageBytes).toBe(1024 * 1024);
    expect(LIMITS.mailTtlSec).toBe(3600);
    expect(LIMITS.inboxCap).toBe(50);
    expect(LIMITS.ackTimeoutMs).toBe(10_000);
    expect(LIMITS.deviceCodeTtlSec).toBe(600);
    expect(LIMITS.devicePollIntervalSec).toBe(5);
    expect(LIMITS.revokeCloseCode).toBe(4403);
  });
  it("measures UTF-8 bytes, not characters", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("🙂")).toBe(4);
    expect(utf8Exceeds("🙂".repeat(9000), LIMITS.inlineBodyBytes)).toBe(true);
    expect(utf8Exceeds("a".repeat(LIMITS.inlineBodyBytes), LIMITS.inlineBodyBytes)).toBe(false);
  });
});
```

`src/kinds.test.ts`:

```ts
import { expect, it } from "vitest";
import { AGENT_KINDS, AgentKindSchema } from "./kinds.js";

it("accepts exactly the three harnesses", () => {
  expect(AGENT_KINDS).toEqual(["claude-code", "opencode", "pi"]);
  for (const k of AGENT_KINDS) expect(AgentKindSchema.parse(k)).toBe(k);
  expect(AgentKindSchema.safeParse("cursor").success).toBe(false);
  expect(AgentKindSchema.safeParse("Claude").success).toBe(false);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/shared test -- src/ids.test.ts`
Expected: FAIL — `Cannot find module './ids.js'` (or "no such filter" if F1 has not named the package `@ob/shared`; fix the name in `packages/shared/package.json` to `@ob/shared` first).

- [ ] **Step 3: Write the implementation**

`packages/shared/package.json` (mirrors OA's, renamed):

```json
{
  "name": "@ob/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./mocks": {
      "types": "./dist/mocks/index.d.ts",
      "import": "./dist/mocks/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.typecheck.json"
  },
  "dependencies": { "zod": "^4.6.7" },
  "devDependencies": { "msw": "^2.15.0", "typescript": "^5.9.3", "vitest": "^4.1.12" },
  "peerDependencies": { "msw": "^2.15.0" },
  "peerDependenciesMeta": { "msw": { "optional": true } }
}
```

`src/ids.ts`:

```ts
// base58 (Bitcoin alphabet, no 0 O I l), unbiased rejection sampling.
// Copied from openartifacts/packages/shared/src/ids.ts; PAT prefix -> machine token.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_UNBIASED = 256 - (256 % 58);

function randomBase58(n: number): string {
  let out = "";
  const buf = new Uint8Array(Math.max(n * 2, 16));
  while (out.length < n) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < n; i++) {
      const b = buf[i] as number;
      if (b < MAX_UNBIASED) out += ALPHABET[b % 58];
    }
  }
  return out;
}

const ID_RE = /^[1-9A-HJ-NP-Za-km-z]{16}$/;
const MACHINE_TOKEN_RE = /^ob_machine_[1-9A-HJ-NP-Za-km-z]{32}$/;
/** The user-code alphabet: 32 symbols, no 0/1, so O/0 and I/1 cannot be mistyped. */
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export function newId(): string {
  return randomBase58(16);
}
export function isId(s: string): boolean {
  return ID_RE.test(s);
}
export const newMsgId = newId;

export function newMachineToken(): string {
  return `ob_machine_${randomBase58(32)}`;
}
export function isMachineToken(s: string): boolean {
  return MACHINE_TOKEN_RE.test(s);
}

/** The device flow's secret half (`device_code`): 43 base58 chars, never shown to a human. */
const DEVICE_SECRET_RE = /^[1-9A-HJ-NP-Za-km-z]{43}$/;
export function newDeviceSecret(): string {
  return randomBase58(43);
}
export function isDeviceSecret(s: string): boolean {
  return DEVICE_SECRET_RE.test(s);
}

/** 8 unformatted chars, e.g. "AB2CD3E4". */
export function newUserCode(): string {
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < 8) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < 8; i++) {
      const b = buf[i] as number;
      if (b < 256 - (256 % 32)) out += USER_CODE_ALPHABET[b % 32];
    }
  }
  return out;
}
/** "AB2CD3E4" -> "AB2C-D3E4". */
export function formatUserCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
export function isUserCode(s: string): boolean {
  return USER_CODE_RE.test(s);
}
/** Accepts "ab2c-d3e4", "AB2C D3E4", "ab2cd3e4"; null when it cannot be a code. */
export function normalizeUserCode(input: string): string | null {
  const raw = input.trim().toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-9]{8}$/.test(raw) ? raw : null;
}
```

`src/limits.ts`:

```ts
const KB = 1024;

/** Every pinned value from the spec and the plan overview. Do not tune per instance. */
export const LIMITS = {
  /** A body at or below this arrives inline in `deliver`; above it, a notice + fetch. */
  inlineBodyBytes: 32 * KB,
  /** Hard cap on one message body (below SQLite's 2 MB row limit). */
  maxMessageBytes: 1024 * KB,
  /** Undelivered mail expires this long after it was sent. */
  mailTtlSec: 3600,
  /** Undelivered messages per agent, then `refused: inbox_full`. */
  inboxCap: 50,
  /** The hub stops holding a pushed-but-unacked message after this. */
  ackTimeoutMs: 10_000,
  deviceCodeTtlSec: 600,
  devicePollIntervalSec: 5,
  /** WebSocket close code on revoke (and on any socket the hub invalidates). */
  revokeCloseCode: 4403,
  /** WebSocket close code for a protocol violation. */
  protocolCloseCode: 1008,
  /** One live daemon socket per machine: a reconnect replaces the previous one. */
  maxSocketsPerMachine: 1,
  /** Bare-string keepalive: the daemon sends PING, the hub auto-answers PONG. */
  pingIntervalMs: 25_000,
  maxBusNameChars: 64,
  maxNamespaceChars: 128,
  maxAgentRefChars: 128,
  maxLabelChars: 64,
} as const;

export const PING = "ping";
export const PONG = "pong";

const enc = new TextEncoder();
export const utf8Bytes = (s: string): number => enc.encode(s).length;
/** True when `s` exceeds `max` UTF-8 bytes. Allocation-free for ASCII-only input. */
export const utf8Exceeds = (s: string, max: number): boolean =>
  s.length > max ? utf8Bytes(s) > max : false;
```

`src/kinds.ts`:

```ts
import { z } from "zod";

export const AGENT_KINDS = ["claude-code", "opencode", "pi"] as const;
export const AgentKindSchema = z.enum(AGENT_KINDS);
export type AgentKind = z.infer<typeof AgentKindSchema>;
```

`src/meta.ts`:

```ts
export const REPO_URL = "https://github.com/open-artifacts-ai/open-bus";
export const PRODUCT_NAME = "OpenBus";
export const API_VERSION = "v1";
/**
 * The owner id, stamped on every hub row as `org_id`. One owner per instance
 * today; a future org->hub directory keys hubs by org id instead.
 */
export const OWNER_ORG_ID = "owner";
/** The bus name every agent falls back to when its proposal is unusable. */
export const FALLBACK_BUS_NAME = "agent";
```

`src/index.ts` (barrel, grown by later tasks):

```ts
export * from "./errors.js";
export * from "./ids.js";
export * from "./kinds.js";
export * from "./limits.js";
export * from "./meta.js";
```

`src/errors.ts`:

```ts
import { z } from "zod";

export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "csrf",
  "not_found",
  "conflict",
  "too_large",
  "rate_limited",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const STATUS_FOR: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  csrf: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  internal: 500,
};
```

Copy `tsconfig.json` / `tsconfig.typecheck.json` from `openartifacts/packages/shared` unchanged (`composite: true`, `outDir: dist`, `strict`, `module: nodenext`).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @ob/shared test -- src/ids.test.ts src/limits.test.ts src/kinds.test.ts`
Expected: PASS (3 files, 11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): ids, machine tokens, user codes and pinned limits"
```

---

### Task F2.2: Bus names, namespaces and `.openbus.json`

**Files:**
- Create: `src/names.ts`, `src/namespace.ts`, `src/config.ts`
- Test: `src/names.test.ts`, `src/namespace.test.ts`, `src/config.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing tests**

`src/names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BusNameSchema, candidateName, suffixName } from "./names.js";

describe("bus names", () => {
  it("accepts human names with spaces", () => {
    for (const n of ["OpenBus Backend", "agent-2", "Pi", "a.b_c"]) {
      expect(BusNameSchema.safeParse(n).success).toBe(true);
    }
  });
  it("rejects address-shaped, control or oversized names", () => {
    for (const n of [
      "a@b.com", "host:1234", "a/b", "a\\b", "", " lead", "trail ",
      "..", ".", "x".repeat(65), "tab\there", "<script>",
    ]) {
      expect(BusNameSchema.safeParse(n).success).toBe(false);
    }
  });
  it("suffixes without exceeding 64 chars", () => {
    expect(suffixName("Artifacts Manager", 2)).toBe("Artifacts Manager-2");
    const long = "n".repeat(64);
    const out = suffixName(long, 12);
    expect(out.length).toBe(64);
    expect(out.endsWith("-12")).toBe(true);
  });
  it("turns any proposal into a usable candidate", () => {
    expect(candidateName("  My  Agent ")).toBe("My Agent");
    expect(candidateName("a@b.com")).toBe("agent");
    expect(candidateName("")).toBe("agent");
    expect(candidateName("x".repeat(80)).length).toBe(64);
  });
});
```

`src/namespace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeRemote, namespaceFrom } from "./namespace.js";

describe("normalizeRemote", () => {
  it("makes the same repo equal across machines", () => {
    const forms = [
      "git@github.com:Acme/Widgets.git",
      "https://github.com/acme/widgets",
      "https://github.com/acme/widgets.git",
      "ssh://git@github.com/acme/widgets.git",
      "https://user:tok@GitHub.com/acme/widgets/",
    ];
    const out = forms.map(normalizeRemote);
    expect(new Set(out)).toEqual(new Set(["github.com/acme/widgets"]));
  });
  it("returns null for local paths and junk", () => {
    for (const u of ["/Users/me/repo", "../x", "file:///tmp/x", "", "not a url"]) {
      expect(normalizeRemote(u)).toBeNull();
    }
  });
});

describe("namespaceFrom", () => {
  it("prefers the remote", () => {
    expect(namespaceFrom({ remoteUrl: "git@github.com:A/B.git", gitRootName: "b", cwd: "/x/b" }))
      .toBe("github.com/a/b");
  });
  it("falls back to the git root name, then the cwd basename", () => {
    expect(namespaceFrom({ remoteUrl: null, gitRootName: "Widgets", cwd: "/x/y" })).toBe("widgets");
    expect(namespaceFrom({ remoteUrl: null, gitRootName: null, cwd: "/x/My Repo" })).toBe("my-repo");
  });
  it("never returns an empty namespace", () => {
    expect(namespaceFrom({ remoteUrl: null, gitRootName: null, cwd: "/" })).toBe("default");
  });
});
```

`src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONFIG_FILE, OpenBusConfigSchema } from "./config.js";

describe(".openbus.json", () => {
  it("is named exactly that", () => expect(CONFIG_FILE).toBe(".openbus.json"));
  it("accepts both keys and neither", () => {
    expect(OpenBusConfigSchema.parse({})).toEqual({});
    expect(OpenBusConfigSchema.parse({ namespace: "github.com/a/b", global: true }))
      .toEqual({ namespace: "github.com/a/b", global: true });
  });
  it("rejects unknown keys and bad values", () => {
    expect(OpenBusConfigSchema.safeParse({ global: "yes" }).success).toBe(false);
    expect(OpenBusConfigSchema.safeParse({ namespace: "" }).success).toBe(false);
    expect(OpenBusConfigSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/shared test -- src/names.test.ts src/namespace.test.ts src/config.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/names.ts`:

```ts
import { z } from "zod";
import { LIMITS } from "./limits.js";
import { FALLBACK_BUS_NAME } from "./meta.js";

/**
 * A bus name: 1..64 chars, letters/digits/space/._-, starting with a letter or
 * digit, not ending in space or dot. No `@`, `/`, `\`, `:` or control chars, so
 * a name can never look like an address or a URL (spec: "Address-shaped names
 * are rejected").
 */
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,62}[A-Za-z0-9._-])?$/;

export const BusNameSchema = z
  .string()
  .max(LIMITS.maxBusNameChars)
  .refine((s) => NAME_RE.test(s) && s !== "." && s !== "..", "invalid bus name");
export type BusName = z.infer<typeof BusNameSchema>;

/** "Base-2": trims the base so the suffix fits inside maxBusNameChars. */
export function suffixName(base: string, n: number): string {
  const suffix = `-${n}`;
  const room = LIMITS.maxBusNameChars - suffix.length;
  const stem = base.slice(0, room).replace(/[ .]+$/, "");
  return `${stem || FALLBACK_BUS_NAME}${suffix}`;
}

/** A harness proposal made safe: control chars stripped, trimmed, capped. */
export function candidateName(proposed: string): string {
  const cleaned = proposed
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, LIMITS.maxBusNameChars)
    .replace(/[ .]+$/, "");
  return BusNameSchema.safeParse(cleaned).success ? cleaned : FALLBACK_BUS_NAME;
}
```

`src/namespace.ts`:

```ts
import { z } from "zod";
import { LIMITS } from "./limits.js";

/**
 * Normalized repo identity: `host/owner/repo`, lowercased, no scheme, no user,
 * no port, no `.git`, no trailing slash. `github.com/Acme/Widgets.git` on one
 * machine equals `https://github.com/acme/widgets` on another.
 */
export function normalizeRemote(remote: string): string | null {
  let s = remote.trim();
  if (!s || s.startsWith("/") || s.startsWith(".") || s.startsWith("file:")) return null;
  const scp = /^(?:[^@/\s]+@)?([A-Za-z0-9.-]+\.[A-Za-z]{2,}):(?!\/\/)(.+)$/.exec(s);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    if (!/^(?:https?|ssh|git):\/\//i.test(s)) return null;
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    s = `${u.hostname}${u.pathname}`;
  }
  s = s
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}\/[a-z0-9._\/-]*[a-z0-9._-]$/.test(s)) return null;
  return s.slice(0, LIMITS.maxNamespaceChars);
}

const sanitize = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-./]+|[-./]+$/g, "")
    .slice(0, LIMITS.maxNamespaceChars);

/**
 * The spec's fallback chain: normalized remote -> git root directory name ->
 * cwd basename -> "default". Pure: the caller supplies what it found on disk.
 */
export function namespaceFrom(input: {
  remoteUrl: string | null;
  gitRootName: string | null;
  cwd: string;
}): string {
  const remote = input.remoteUrl ? normalizeRemote(input.remoteUrl) : null;
  if (remote) return remote;
  const root = input.gitRootName ? sanitize(input.gitRootName) : "";
  if (root) return root;
  const base = input.cwd.split("/").filter(Boolean).pop() ?? "";
  return sanitize(base) || "default";
}

export const NamespaceSchema = z
  .string()
  .min(1)
  .max(LIMITS.maxNamespaceChars)
  .refine(
    (s) => s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s),
    "invalid namespace",
  );
```

`src/config.ts`:

```ts
import { z } from "zod";
import { NamespaceSchema } from "./namespace.js";

export const CONFIG_FILE = ".openbus.json";

/**
 * Read from the directory where the session starts, or any parent. Both keys
 * are optional; `global` is never implied.
 */
export const OpenBusConfigSchema = z.strictObject({
  namespace: NamespaceSchema.optional(),
  global: z.boolean().optional(),
});
export type OpenBusConfig = z.infer<typeof OpenBusConfigSchema>;

/** First file found walking up from `dir` wins: merge is not supported. */
export function mergeConfigs(configs: OpenBusConfig[]): OpenBusConfig {
  const out: OpenBusConfig = {};
  for (const c of configs) {
    if (out.namespace === undefined && c.namespace !== undefined) out.namespace = c.namespace;
    if (out.global === undefined && c.global !== undefined) out.global = c.global;
  }
  return out;
}
```

Append to `src/index.ts`: `export * from "./config.js"; export * from "./names.js"; export * from "./namespace.js";`

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @ob/shared test -- src/names.test.ts src/namespace.test.ts src/config.test.ts`
Expected: PASS (3 files, 12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): bus names, namespace normalization and .openbus.json"
```

---

### Task F2.3: Receipts, the wire protocol and its byte cap

**Files:**
- Create: `src/receipts.ts`, `src/protocol.ts`
- Test: `src/protocol.test.ts`, `src/receipts.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing tests**

`src/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CLIENT_FRAMES,
  SERVER_FRAMES,
  decodeFrame,
  encodeFrame,
  formatFrameError,
} from "./protocol.js";
import { LIMITS } from "./limits.js";

const id = "7Yb3kQmZ1xRt9PvA";

describe("frames", () => {
  it("round-trips a send and a deliver", () => {
    const send = { v: 1, id, type: "send", from_ref: "s1", to_name: "OpenBus Backend", body: "hi" } as const;
    expect(decodeFrame(encodeFrame(send))).toEqual(send);
    const deliver = {
      v: 1, id, type: "deliver", msg_id: "aaaaaaaaaaaaaaaa", to_ref: "s1",
      from_name: "Pi", namespace: "github.com/a/b", body: "hi",
    } as const;
    expect(decodeFrame(encodeFrame(deliver))).toEqual(deliver);
  });
  it("round-trips an oversized notice", () => {
    const f = {
      v: 1, id, type: "deliver", msg_id: "aaaaaaaaaaaaaaaa", to_ref: "s1",
      from_name: "Pi", namespace: "n", notice: { size: 40000, msg_id: "aaaaaaaaaaaaaaaa" },
    } as const;
    expect(decodeFrame(encodeFrame(f))).toEqual(f);
  });
  it("round-trips a refusal", () => {
    const f = { v: 1, id, type: "refuse", msg_id: "aaaaaaaaaaaaaaaa", reason: "closed", detail: "denied" } as const;
    expect(decodeFrame(encodeFrame(f))).toEqual(f);
    expect(decodeFrame(JSON.stringify({ ...f, detail: "held" }))).toBeNull();
    expect(decodeFrame(JSON.stringify({ ...f, reason: "inbox_full" }))).toBeNull();
  });
  it("rejects unknown types, wrong versions and extra keys", () => {
    expect(decodeFrame(JSON.stringify({ v: 1, id, type: "nope" }))).toBeNull();
    expect(decodeFrame(JSON.stringify({ v: 2, id, type: "hello", machine_label: "m", client_version: "0.1.0" }))).toBeNull();
    expect(decodeFrame(JSON.stringify({ v: 1, id, type: "hello", machine_label: "m", client_version: "0.1.0", x: 1 }))).toBeNull();
  });
  it("rejects a body over the hard maximum and a bare ping", () => {
    const big = { v: 1, id, type: "send", from_ref: "s1", to_name: "a", body: "x".repeat(LIMITS.maxMessageBytes + 1) };
    expect(decodeFrame(JSON.stringify(big))).toBeNull();
    expect(decodeFrame("ping")).toBeNull();
  });
  it("refuses an inbound frame over the read cap without parsing it", () => {
    expect(decodeFrame("x".repeat(LIMITS.maxMessageBytes + 2048))).toBeNull();
  });
  it("names every frame the overview pins", () => {
    expect(CLIENT_FRAMES).toEqual(["hello", "agent_up", "agent_down", "sessions", "send", "ack", "refuse", "list", "fetch"]);
    expect(SERVER_FRAMES).toEqual(["hello_ok", "agent_ok", "receipt", "roster", "body", "error", "deliver", "receipt_update", "roster_changed"]);
  });
  it("formats a rejection with the frame id when there is one", () => {
    expect(formatFrameError("bad frame", null)).toBe("bad frame");
    expect(formatFrameError("bad frame", id)).toBe(`bad frame (frame ${id})`);
  });
});
```

`src/receipts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ReceiptSchema, RECEIPT_STATES, REFUSAL_REASONS, receiptLabel } from "./receipts.js";

describe("receipts", () => {
  it("pins states and refusal reasons", () => {
    expect(RECEIPT_STATES).toEqual(["pending", "delivered", "expired", "refused"]);
    expect(REFUSAL_REASONS).toEqual([
      "unknown_agent", "closed", "inbox_full", "too_large", "other_namespace", "revoked", "ambiguous",
    ]);
  });
  it("allows a reason on refused and on expired, never on delivered", () => {
    expect(ReceiptSchema.safeParse({ msg_id: "a".repeat(16), state: "refused", reason: "inbox_full" }).success).toBe(true);
    expect(ReceiptSchema.safeParse({ msg_id: "a".repeat(16), state: "expired", reason: "recipient_closed" }).success).toBe(true);
    expect(ReceiptSchema.safeParse({ msg_id: "a".repeat(16), state: "delivered" }).success).toBe(true);
    expect(ReceiptSchema.safeParse({ msg_id: "a".repeat(16), state: "pending", reason: "closed" }).success).toBe(false);
  });
  it("has a label for every reason", () => {
    expect(receiptLabel({ msg_id: "a".repeat(16), state: "refused", reason: "closed" })).toBe("refused: closed");
    expect(receiptLabel({ msg_id: "a".repeat(16), state: "pending" })).toBe("pending");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/shared test -- src/protocol.test.ts src/receipts.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/receipts.ts`:

```ts
import { z } from "zod";
import { newMsgId } from "./ids.js";

export const RECEIPT_STATES = ["pending", "delivered", "expired", "refused"] as const;
export const ReceiptStateSchema = z.enum(RECEIPT_STATES);
export type ReceiptState = z.infer<typeof ReceiptStateSchema>;

export const REFUSAL_REASONS = [
  "unknown_agent",
  "closed",
  "inbox_full",
  "too_large",
  "other_namespace",
  "revoked",
  "ambiguous",
] as const;
export const RefusalReasonSchema = z.enum(REFUSAL_REASONS);
export type RefusalReason = z.infer<typeof RefusalReasonSchema>;

/** `recipient_closed` is the hub's expiry reason on reconnect; not a send refusal. */
export const ReceiptReasonSchema = z.union([RefusalReasonSchema, z.literal("recipient_closed")]);
export type ReceiptReason = z.infer<typeof ReceiptReasonSchema>;

export const MsgIdSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{16}$/);
export const newReceiptId = newMsgId;

/**
 * A reason rides on `refused` (a pinned enum) and on `expired`
 * ("recipient_closed"); `pending` and `delivered` carry none.
 */
export const ReceiptSchema = z
  .strictObject({
    msg_id: MsgIdSchema,
    state: ReceiptStateSchema,
    reason: ReceiptReasonSchema.optional(),
  })
  .refine(
    (r) =>
      (r.state === "refused" && r.reason !== undefined && r.reason !== "recipient_closed") ||
      (r.state === "expired" && (r.reason === undefined || r.reason === "recipient_closed")) ||
      ((r.state === "pending" || r.state === "delivered") && r.reason === undefined),
    "reason does not match state",
  );
export type Receipt = z.infer<typeof ReceiptSchema>;

export function receiptLabel(r: Receipt): string {
  return r.reason ? `${r.state}: ${r.reason}` : r.state;
}
```

`src/protocol.ts`:

```ts
import { z } from "zod";
import { AgentRefSchema } from "./refs.js"; // see below
import { AgentKindSchema } from "./kinds.js";
import { LIMITS, utf8Exceeds } from "./limits.js";
import { BusNameSchema, NamespaceSchema } from "./names.js";
import { MsgIdSchema, ReceiptReasonSchema, ReceiptStateSchema } from "./receipts.js";
import { newId } from "./ids.js";

export const PROTOCOL_VERSION = 1;

const FrameIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const base = { v: z.literal(1), id: FrameIdSchema } as const;

/** One JSON object per WebSocket message. Bodies are capped in UTF-8 bytes. */
const BodySchema = z
  .string()
  .refine((s) => !utf8Exceeds(s, LIMITS.maxMessageBytes), "body too large");

const Hello = z.strictObject({
  ...base,
  type: z.literal("hello"),
  machine_label: z.string().min(1).max(LIMITS.maxLabelChars),
  client_version: z.string().min(1).max(32),
});

const AgentUp = z.strictObject({
  ...base,
  type: z.literal("agent_up"),
  agent_ref: AgentRefSchema,
  kind: AgentKindSchema,
  proposed_name: z.string().max(256),
  namespace: NamespaceSchema,
  global: z.boolean(),
});

const AgentDown = z.strictObject({ ...base, type: z.literal("agent_down"), agent_ref: AgentRefSchema });

const Sessions = z.strictObject({
  ...base,
  type: z.literal("sessions"),
  open: z.array(AgentRefSchema).max(64),
  closed: z.array(AgentRefSchema).max(64),
});

const Send = z.strictObject({
  ...base,
  type: z.literal("send"),
  from_ref: AgentRefSchema,
  to_name: BusNameSchema,
  body: BodySchema,
});

const Ack = z.strictObject({ ...base, type: z.literal("ack"), msg_id: MsgIdSchema });

/**
 * The harness did not take the message (Claude `peer_message_status`, a failed
 * prompt, a dead session). `held` is not a refusal: the daemon sends nothing
 * and keeps waiting. `reason` is fixed to `closed` — the spec's pinned refusal
 * reason for "the session could not take it".
 */
const Refuse = z.strictObject({
  ...base,
  type: z.literal("refuse"),
  msg_id: MsgIdSchema,
  reason: z.literal("closed"),
  detail: z.enum(["denied", "refused", "expired", "dropped"]),
});
const List = z.strictObject({ ...base, type: z.literal("list"), from_ref: AgentRefSchema });
const Fetch = z.strictObject({ ...base, type: z.literal("fetch"), from_ref: AgentRefSchema, msg_id: MsgIdSchema });

const HelloOk = z.strictObject({
  ...base,
  type: z.literal("hello_ok"),
  machine_id: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{16}$/),
  machine_label: z.string(),
  server_version: z.string(),
});

const AgentOk = z.strictObject({ ...base, type: z.literal("agent_ok"), agent_ref: AgentRefSchema, bus_name: BusNameSchema });

const ReceiptFrame = z.strictObject({
  ...base,
  type: z.literal("receipt"),
  msg_id: MsgIdSchema,
  state: ReceiptStateSchema,
  reason: ReceiptReasonSchema.optional(),
});

const RosterAgent = z.strictObject({
  bus_name: BusNameSchema,
  kind: AgentKindSchema,
  namespace: NamespaceSchema,
  global: z.boolean(),
});
const Roster = z.strictObject({ ...base, type: z.literal("roster"), agents: z.array(RosterAgent).max(500) });

const BodyFrame = z.strictObject({ ...base, type: z.literal("body"), msg_id: MsgIdSchema, body: BodySchema });

const ErrorFrame = z.strictObject({
  ...base,
  type: z.literal("error"),
  code: z.enum(["bad_frame", "not_registered", "not_found", "too_large", "rate_limited", "internal"]),
  message: z.string().max(200),
});

const Notice = z.strictObject({ size: z.number().int().positive(), msg_id: MsgIdSchema });

const Deliver = z.strictObject({
  ...base,
  type: z.literal("deliver"),
  msg_id: MsgIdSchema,
  to_ref: AgentRefSchema,
  from_name: BusNameSchema,
  namespace: NamespaceSchema,
  body: BodySchema.optional(),
  notice: Notice.optional(),
}).refine((f) => (f.body === undefined) !== (f.notice === undefined), "body xor notice");

const ReceiptUpdate = z.strictObject({
  ...base,
  type: z.literal("receipt_update"),
  msg_id: MsgIdSchema,
  state: ReceiptStateSchema,
  reason: ReceiptReasonSchema.optional(),
});

const RosterChanged = z.strictObject({ ...base, type: z.literal("roster_changed"), namespace: NamespaceSchema });

export const CLIENT_FRAMES = ["hello", "agent_up", "agent_down", "sessions", "send", "ack", "refuse", "list", "fetch"] as const;
export const SERVER_FRAMES = [
  "hello_ok", "agent_ok", "receipt", "roster", "body", "error", "deliver", "receipt_update", "roster_changed",
] as const;

export const ClientFrameSchema = z.discriminatedUnion("type", [
  Hello, AgentUp, AgentDown, Sessions, Send, Ack, Refuse, List, Fetch,
]);
export const ServerFrameSchema = z.discriminatedUnion("type", [
  HelloOk, AgentOk, ReceiptFrame, Roster, BodyFrame, ErrorFrame, Deliver, ReceiptUpdate, RosterChanged,
]);
export const FrameSchema = z.discriminatedUnion("type", [
  Hello, AgentUp, AgentDown, Sessions, Send, Ack, Refuse, List, Fetch,
  HelloOk, AgentOk, ReceiptFrame, Roster, BodyFrame, ErrorFrame, Deliver, ReceiptUpdate, RosterChanged,
]);

export type ClientFrame = z.infer<typeof ClientFrameSchema>;
export type ServerFrame = z.infer<typeof ServerFrameSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type AgentUpFrame = z.infer<typeof AgentUp>;
export type SendFrame = z.infer<typeof Send>;
export type DeliverFrame = z.infer<typeof Deliver>;
export type RefuseFrame = z.infer<typeof Refuse>;

/** Serializes a frame the caller has already built from a schema. */
export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

/** Correlation id for a new request or unsolicited push. */
export function frameId(): string {
  return newId();
}

/**
 * Never throws. Anything over the read cap is refused before JSON.parse, so a
 * hostile 1 GB frame costs one length check. Bare "ping"/"pong" are not frames.
 */
export function decodeFrame(raw: string): Frame | null {
  if (raw.length > LIMITS.maxMessageBytes + 2048) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = FrameSchema.safeParse(value);
  return r.success ? r.data : null;
}

export function formatFrameError(message: string, frameId: string | null): string {
  return frameId ? `${message} (frame ${frameId})` : message;
}
```

`src/refs.ts` (small, so `protocol.ts` and `rest.ts` agree):

```ts
import { z } from "zod";
import { LIMITS } from "./limits.js";

/**
 * The daemon's local, stable handle for one harness session: a Claude
 * `sessionId`, an OpenCode root `ses_…`, a Pi session id. Opaque to the hub.
 */
export const AgentRefSchema = z
  .string()
  .min(1)
  .max(LIMITS.maxAgentRefChars)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are forbidden
  .refine((s) => /^[\x21-\x7e]+$/.test(s), "invalid agent ref");
```

Append to `src/index.ts`: `export * from "./protocol.js"; export * from "./receipts.js"; export * from "./refs.js";`

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @ob/shared test -- src/protocol.test.ts src/receipts.test.ts`
Expected: PASS (2 files, 10 tests). If `decodeFrame("ping")` throws instead of returning null, the JSON.parse guard is missing.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): receipts and the daemon-hub wire frames"
```

---

### Task F2.4: REST routes, DTOs, device flow and SSE events

**Files:**
- Create: `src/rest.ts`
- Test: `src/rest.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing tests**

`src/rest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AUTH,
  AgentSchema,
  AgentsResponseSchema,
  BusEventSchema,
  CSRF_HEADER,
  DeviceCodeResponseSchema,
  DeviceTokenResponseSchema,
  MachineSchema,
  MachinesResponseSchema,
  MeSchema,
  R,
} from "./rest.js";

const ISO = "2026-10-21T15:32:52.652Z";
const machine = {
  id: "7Yb3kQmZ1xRt9PvA", label: "MacBook",
  createdAt: ISO, lastUsed: ISO, revokedAt: null,
};
const agent = {
  id: "8Zc4lRnA2ySu0QwB", namespace: "github.com/a/b", name: "OpenBus Backend",
  kind: "opencode", machineId: machine.id, machineLabel: machine.label,
  global: false, live: true, updatedAt: ISO,
};

describe("rest", () => {
  it("pins the routes", () => {
    expect(R.healthz).toBe("/healthz");
    expect(R.deviceCode).toBe("/device/code");
    expect(R.deviceToken).toBe("/device/token");
    expect(R.approve("AB2C-D3E4")).toBe("/approve/AB2C-D3E4");
    expect(R.me).toBe("/api/v1/me");
    expect(R.machines).toBe("/api/v1/machines");
    expect(R.machine(machine.id)).toBe(`/api/v1/machines/${machine.id}`);
    expect(R.agents).toBe("/api/v1/agents");
    expect(R.events).toBe("/api/v1/events");
    expect(R.hub).toBe("/hub");
    expect(R.login).toBe("/auth/login");
    expect(AUTH.login).toBe("/auth/login");
    expect(AUTH.logout).toBe("/auth/logout");
    expect(AUTH.devLogin).toBe("/auth/dev-login");
    expect(CSRF_HEADER).toBe("X-OB-Request");
  });
  it("validates DTOs with ISO timestamps", () => {
    expect(MeSchema.parse({ user: { id: "owner", email: "o@example.com", name: null } })).toBeTruthy();
    expect(MachineSchema.parse(machine)).toBeTruthy();
    expect(MachinesResponseSchema.parse({ machines: [machine] })).toBeTruthy();
    expect(AgentSchema.parse(agent)).toBeTruthy();
    expect(AgentsResponseSchema.parse({ agents: [agent] })).toBeTruthy();
    expect(MachineSchema.safeParse({ ...machine, createdAt: 1 }).success).toBe(false);
    expect(MachineSchema.safeParse({ ...machine, live: true }).success).toBe(false);
  });
  it("pins the device flow shapes", () => {
    const code = {
      device_code: "d".repeat(43), user_code: "AB2C-D3E4",
      verification_uri: "https://bus.example.com/approve/AB2C-D3E4",
      expires_in: 600, interval: 5,
    };
    expect(DeviceCodeResponseSchema.parse(code)).toBeTruthy();
    expect(DeviceTokenResponseSchema.parse({ status: "pending" })).toEqual({ status: "pending" });
    expect(DeviceTokenResponseSchema.parse({ status: "approved", token: "ob_machine_" + "a".repeat(32), machine_id: machine.id })).toBeTruthy();
    expect(DeviceTokenResponseSchema.parse({ status: "denied" })).toEqual({ status: "denied" });
    expect(DeviceTokenResponseSchema.safeParse({ status: "approved" }).success).toBe(false);
  });
  it("pins the SSE events as full snapshots", () => {
    expect(BusEventSchema.parse({ type: "hello" })).toEqual({ type: "hello" });
    expect(BusEventSchema.parse({ type: "agents", agents: [agent] })).toBeTruthy();
    expect(BusEventSchema.parse({ type: "machines", machines: [machine] })).toBeTruthy();
    expect(BusEventSchema.safeParse({ type: "roster", agents: [] }).success).toBe(false);
    expect(BusEventSchema.safeParse({ type: "ping" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/shared test -- src/rest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/rest.ts`:

```ts
import { z } from "zod";
import { AgentKindSchema } from "./kinds.js";
import { LIMITS } from "./limits.js";
import { BusNameSchema, NamespaceSchema } from "./names.js";
import { IdSchema } from "./schemas.js"; // created here: z.string().refine(isId)
import { newId, isId } from "./ids.js";

/** Session-cookie mutations must carry this header (PAT-free: there are no PATs). */
export const CSRF_HEADER = "X-OB-Request";

const ISO = z.string().datetime({ offset: true });
const seg = (s: string): string => {
  if (s === "." || s === "..") throw new RangeError(`Unsafe path segment: ${JSON.stringify(s)}`);
  return encodeURIComponent(s);
};

/** Access OIDC routes the Worker owns (copied from openartifacts). */
export const AUTH = {
  login: "/auth/login",
  callback: "/auth/callback",
  logout: "/auth/logout",
  /** Mounted only when ENVIRONMENT=dev; 404 everywhere else. */
  devLogin: "/auth/dev-login",
} as const;

export const R = {
  healthz: "/healthz",
  deviceCode: "/device/code",
  deviceToken: "/device/token",
  approve: (userCode: string) => `/approve/${seg(userCode)}`,
  me: "/api/v1/me",
  machines: "/api/v1/machines",
  machine: (id: string) => `/api/v1/machines/${seg(id)}`,
  agents: "/api/v1/agents",
  events: "/api/v1/events",
  /** Bearer machine token; WebSocket upgrade. */
  hub: "/hub",
  /** Sign-in entry point (the same URL as AUTH.login; the dashboard links here). */
  login: AUTH.login,
  /** Server-side redirect target once a device code is approved. */
  dashboard: "/machines",
} as const;

/** `{ user: { id, email, name } }`: one owner, so `id` is the constant "owner". */
export const MeSchema = z.strictObject({
  user: z.strictObject({
    id: z.string().min(1).max(32),
    email: z.string().includes("@"),
    name: z.string().nullable(),
  }),
});
export type Me = z.infer<typeof MeSchema>;

/**
 * A machine the owner approved. Only active machines are listed, so
 * `revokedAt` is normally null; `lastUsed` is the last /hub upgrade.
 */
export const MachineSchema = z.strictObject({
  id: IdSchema,
  label: z.string().min(1).max(LIMITS.maxLabelChars),
  createdAt: ISO,
  lastUsed: ISO.nullable(),
  revokedAt: ISO.nullable(),
});
export type Machine = z.infer<typeof MachineSchema>;

export const MachinesResponseSchema = z.strictObject({ machines: z.array(MachineSchema) });
export type MachinesResponse = z.infer<typeof MachinesResponseSchema>;

export const AgentSchema = z.strictObject({
  id: IdSchema,
  namespace: NamespaceSchema,
  name: BusNameSchema,
  kind: AgentKindSchema,
  machineId: IdSchema,
  machineLabel: z.string(),
  global: z.boolean(),
  live: z.boolean(),
  updatedAt: ISO,
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentsResponseSchema = z.strictObject({ agents: z.array(AgentSchema) });
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;
export const AgentListQuerySchema = z.object({ namespace: NamespaceSchema.optional() });

export const DeviceCodeRequestSchema = z.strictObject({
  machine_label: z.string().min(1).max(LIMITS.maxLabelChars).optional(),
});
export const DeviceCodeResponseSchema = z.strictObject({
  device_code: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  user_code: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
  verification_uri: z.string().url(),
  expires_in: z.literal(LIMITS.deviceCodeTtlSec),
  interval: z.literal(LIMITS.devicePollIntervalSec),
});
export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>;

export const DeviceTokenRequestSchema = z.strictObject({
  device_code: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
});
export const DeviceTokenResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending") }),
  z.strictObject({ status: z.literal("approved"), token: z.string().regex(/^ob_machine_[1-9A-HJ-NP-Za-km-z]{32}$/), machine_id: IdSchema }),
  z.strictObject({ status: z.literal("denied") }),
  z.strictObject({ status: z.literal("expired") }),
]);
export type DeviceTokenResponse = z.infer<typeof DeviceTokenResponseSchema>;

export const ApprovalBodySchema = z.strictObject({
  decision: z.enum(["approve", "deny"]),
  label: z.string().min(1).max(LIMITS.maxLabelChars).optional(),
});

/**
 * SSE: `event: <type>` and `data: <JSON>`. Every snapshot is the full list the
 * page should show. `hello` opens the stream and tells the client to refetch.
 * No ping: the Worker holds no timers.
 */
export const BusEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello") }),
  z.strictObject({ type: z.literal("machines"), machines: z.array(MachineSchema) }),
  z.strictObject({ type: z.literal("agents"), agents: z.array(AgentSchema) }),
]);
export type BusEvent = z.infer<typeof BusEventSchema>;

export const newMachineLabel = (hostname: string): string =>
  hostname.trim().slice(0, LIMITS.maxLabelChars) || `machine-${newId().slice(0, 6)}`;

export const isMachineId = isId;
```

`src/schemas.ts` (only what the contract needs):

```ts
import { z } from "zod";
import { isId } from "./ids.js";

export const IdSchema = z.string().refine(isId, "invalid id");
```

Append to `src/index.ts`: `export * from "./rest.js"; export * from "./schemas.js";`

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @ob/shared test -- src/rest.test.ts`
Expected: PASS (1 file, 4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): REST routes, DTOs, device flow and SSE events"
```

---

### Task F2.5: MSW mocks for Frontend (F2 ships before the Worker exists)

**Files:**
- Create: `src/mocks/fixtures.ts`, `src/mocks/handlers.ts`, `src/mocks/index.ts`
- Test: `src/mocks/handlers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { AgentsResponseSchema, MachinesResponseSchema } from "../rest.js";
import { handlers } from "./handlers.js";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("mocks", () => {
  it("serves me, machines and agents in the FE's shapes", async () => {
    const me = await (await fetch("https://bus.test/api/v1/me")).json();
    expect(me.user.email).toContain("@");
    const machines = MachinesResponseSchema.parse(await (await fetch("https://bus.test/api/v1/machines")).json());
    expect(machines.machines.length).toBeGreaterThan(0);
    const agents = AgentsResponseSchema.parse(
      await (await fetch("https://bus.test/api/v1/agents?namespace=github.com/acme/widgets")).json(),
    );
    expect(agents.agents.every((a) => a.namespace === "github.com/acme/widgets" || a.global)).toBe(true);
  });
  it("deletes a machine, then 404s it", async () => {
    const del = () => fetch("https://bus.test/api/v1/machines/m1aaaaaaaaaaaaa", {
      method: "DELETE",
      headers: { "X-OB-Request": "1" },
    });
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @ob/shared test -- src/mocks/handlers.test.ts`
Expected: FAIL — module not found. (MSW's node server needs `msw` installed, which F1's root devDependencies already include; if not, add it.)

- [ ] **Step 3: Write the fixtures and handlers**

`src/mocks/fixtures.ts`:

```ts
import type { Agent, Machine } from "../rest.js";

const ISO = "2026-10-21T15:32:52.652Z";

export const machines: Machine[] = [
  { id: "m1aaaaaaaaaaaaa", label: "MacBook Pro", createdAt: ISO, lastUsed: ISO, revokedAt: null },
  { id: "m2aaaaaaaaaaaaa", label: "Studio", createdAt: ISO, lastUsed: null, revokedAt: null },
];

export const agents: Agent[] = [
  {
    id: "a1aaaaaaaaaaaaa", namespace: "github.com/acme/widgets", name: "OpenBus Backend",
    kind: "opencode", machineId: machines[0]!.id, machineLabel: machines[0]!.label,
    global: false, live: true, updatedAt: ISO,
  },
  {
    id: "a2aaaaaaaaaaaaa", namespace: "github.com/acme/widgets", name: "Claude",
    kind: "claude-code", machineId: machines[0]!.id, machineLabel: machines[0]!.label,
    global: false, live: true, updatedAt: ISO,
  },
  {
    id: "a3aaaaaaaaaaaaa", namespace: "github.com/acme/api", name: "Pi",
    kind: "pi", machineId: machines[1]!.id, machineLabel: machines[1]!.label,
    global: true, live: false, updatedAt: ISO,
  },
];
```

`src/mocks/handlers.ts`:

```ts
import { http, HttpResponse } from "msw";
import { R } from "../rest.js";
import { agents, machines } from "./fixtures.js";

export const handlers = [
  http.get(`*${R.me}`, () =>
    HttpResponse.json({ user: { id: "owner", email: "owner@example.com", name: "Owner" } })),
  http.get(`*${R.machines}`, () => HttpResponse.json({ machines })),
  http.delete(`*${R.machine(":id")}`, ({ params }) => {
    if (typeof params.id !== "string" || !machines.some((m) => m.id === params.id))
      return HttpResponse.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`*${R.agents}`, ({ request }) => {
    const ns = new URL(request.url).searchParams.get("namespace");
    return HttpResponse.json({
      agents: agents.filter((a) => !ns || a.namespace === ns || a.global),
    });
  }),
];
```

`src/mocks/index.ts`: `export * from "./fixtures.js"; export * from "./handlers.js";`

- [ ] **Step 4: Run the tests and the build**

Run: `pnpm --filter @ob/shared test -- src/mocks/handlers.test.ts && pnpm --filter @ob/shared build`
Expected: PASS; `dist/index.js`, `dist/index.d.ts`, `dist/mocks/index.js` exist.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): MSW mocks and fixtures for the dashboard"
```

---

### Task F2.6: Contract doc, typecheck and the hand-off

**Files:**
- Create: `packages/shared/CONTRACT.md`
- Test: `packages/shared/src/contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { R } from "./rest.js";

describe("contract is pinned", () => {
  it("is version 1", () => expect(PROTOCOL_VERSION).toBe(1));
  it("keeps the spec values", () => {
    expect([LIMITS.inlineBodyBytes, LIMITS.maxMessageBytes, LIMITS.mailTtlSec, LIMITS.inboxCap, LIMITS.revokeCloseCode])
      .toEqual([32768, 1048576, 3600, 50, 4403]);
  });
  it("keeps the public routes unversioned and the API under /api/v1", () => {
    expect(R.healthz.startsWith("/api")).toBe(false);
    expect(R.machines.startsWith("/api/v1/")).toBe(true);
    expect(R.hub).toBe("/hub");
  });
});
```

- [ ] **Step 2: Write `CONTRACT.md`**

````markdown
# OpenBus contract (v1)

Owner: Backend. Changes here are announced to the manager and every affected lead before merge.

## Values
Machine token `ob_machine_` + 32 base58; the hub stores sha256 hex only.
IDs 16 base58 (`newId`). Device `user_code` 8 chars `[A-Z2-9]` shown `XXXX-XXXX`, 10 min, poll 5 s.
Inline delivery 32 KB UTF-8; hard max 1 MB; mail expires 3600 s; inbox cap 50.
Receipts `pending|delivered|expired|refused(reason)`; reasons `unknown_agent|closed|inbox_full|too_large|other_namespace|revoked|ambiguous` (7; see `packages/shared/CONTRACT.md`). `other_namespace` answers only an explicit `to_namespace` the sender may not target (identical whether or not the name exists there); without `to_namespace`, a name outside the sender's namespace and the globals is `unknown_agent` even if it is live elsewhere (spec goal 5, scenario 6: other namespaces are "invisible and unreachable"; B8 ruling).
Revoke close code `4403`.

## Wire (daemon <-> hub, one JSON object per message)
Every frame `{v: 1, id}`; the reply echoes the request id.
Client: `hello`, `agent_up`, `agent_down`, `sessions`, `send`, `ack`, `refuse`, `list`, `fetch`.
Server: `hello_ok`, `agent_ok`, `receipt`, `roster`, `body`, `error`, `deliver`, `receipt_update`, `roster_changed`.
Keepalive is the bare string `ping` / `pong`, never a frame.
`deliver` carries `body` xor `notice{size,msg_id}`.
`refuse{msg_id, reason:"closed", detail:"denied"|"refused"|"expired"|"dropped"}` closes a pending receipt as `refused: closed` and drops the mail. `held` is not a refusal: the daemon stays silent and acks later.

## REST
Public: `GET /healthz`, `POST /device/code`, `POST /device/token`.
Access session: `GET|POST /approve/:user_code`.
Session cookie: `GET /api/v1/me` (`{user:{id,email,name}}`), `GET /api/v1/machines` (`{machines}`), `DELETE /api/v1/machines/:id` (204, or 404 when unknown or already revoked), `GET /api/v1/agents?namespace=` (`{agents}`), `GET /api/v1/events` (WebSocket since B10-ws, was SSE: `hello|machines|agents`, each frame a complete list).
Bearer machine token: `GET /hub` (upgrade).
Cookie mutations send `X-OB-Request: 1`. `/auth/dev-login` exists only when ENVIRONMENT=dev.

## Names and namespaces
Bus name: 1..64, letters/digits/space/._-, no `@ : / \`, not address-shaped.
Namespace: `host/owner/repo` lowercased, else git root name, else cwd basename, else `default`.
`.openbus.json` `{namespace?, global?}` from the session's start dir or any parent.
````

- [ ] **Step 3: Run everything**

Run: `pnpm --filter @ob/shared test && pnpm --filter @ob/shared typecheck && pnpm lint`
Expected: all tests pass (≈40), `tsc --noEmit` clean, biome clean.

- [ ] **Step 4: Commit and open the PR**

```bash
git add packages/shared
git commit -m "docs(shared): contract summary and pinning test"
git push -u origin fo/f2-shared-contract
gh pr create --title "feat(shared): OpenBus v1 contract" --body "F2 of docs/superpowers/plans/2026-10-21-openbus/01b-shared-contract.md. Test output pasted. Unblocks Frontend, Client and Backend B4+."
```

- [ ] **Step 5: Announce the contract to the manager and the two consumers**

Send `OpenBus Frontend`, `OpenBus Frontend-2` and `openbus-e0`: *"F2 merged: `@ob/shared` exports ids/limits/names/namespace/config/protocol/rest/mocks. Wire frames snake_case, REST camelCase, timestamps ISO. Additions beyond the overview: `hello_ok` (reply to `hello`, carries `machine_id`) and `error{bad_frame|not_registered|not_found|too_large|rate_limited|internal}`. `X-OB-Request: 1` for cookie mutations. Read `packages/shared/CONTRACT.md`."*

---

## Self-review

- **Spec coverage:** values (F2.1, F2.3, F2.4), names/namespaces/config (F2.2), frames (F2.3), REST + device + SSE (F2.4), mocks for Frontend (F2.5), doc (F2.6). Frontend's contract ask (04-frontend.md) is honoured exactly: `MeSchema` `{user}`, `MachineSchema` `{id,label,createdAt,lastUsed,revokedAt}`, `MachinesResponseSchema`, `AgentSchema`, `AgentsResponseSchema`, `BusEventSchema` `hello|machines|agents`, `R.login`, `AUTH.devLogin`, `CSRF_HEADER`. No fs or crypto in the package, so the Worker bundle stays small.
- **Deviations flagged to the manager, not silent:** `refuse` (client track's request, narrowed to `denied|refused|expired|dropped`), `hello_ok` and `error` are additions (the pinned list has no success reply for `hello`, no protocol-error frame and no harness-refusal frame); `Receipt.reason` is allowed on `expired` (`recipient_closed`) per the spec's "expired: recipient closed"; SSE carries no `ping` because a Worker cannot hold a timer.
- **Type consistency:** `AgentRefSchema` lives in `refs.ts` and is imported by `protocol.ts` only; `MsgIdSchema` lives in `receipts.ts`; `IdSchema` in `schemas.ts`; `rest.ts` imports `isId` directly. No duplicated definitions.
