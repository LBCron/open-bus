// OA's m2-a11y shape: axe on every screen, light and dark, at 1280 and 390,
// plus no sideways scroll at 390. Fails on any serious or critical violation
// on any wcag2a/wcag2aa one at any impact, and on `region`. Each screen is scanned with the
// theme forced (<html data-theme>) and with the OS preference alone.
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  AXE,
  answerRevoke,
  openLive,
  sidewaysOverflow,
  streamHooks,
} from "./helpers";

/** Signed out: GET /api/v1/me answers 401, as the Worker does without a session. */
const signedOut = (page: Page) =>
  page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (new URL(new Request(input, init).url).pathname === "/api/v1/me")
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "unauthorized", message: "Sign in" },
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          ),
        );
      return real(input, init);
    };
  });

/** GET of `path` answers 500 until the page reloads (retries included). */
const failingList = (page: Page, path: string) =>
  page.addInitScript((p) => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const req = new Request(input, init);
      if (req.method === "GET" && new URL(req.url).pathname === p)
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "internal", message: "Boom" } }),
            { status: 500, headers: { "content-type": "application/json" } },
          ),
        );
      return real(input, init);
    };
  }, path);

type Screen = {
  name: string;
  path: string;
  /** Only these widths (the drawer exists only below md). */
  widths?: number[];
  setup?: (p: Page) => Promise<unknown>;
  /** Plain goto, no wait for the stream's hello (it is blocked or signed out). */
  plain?: boolean;
  /** Waits for the screen to be what it claims (after the h1 is up). */
  ready: (p: Page) => Promise<unknown>;
};

const SCREENS: Screen[] = [
  {
    name: "machines",
    path: "/",
    ready: (p) =>
      expect(
        p.getByRole("row").filter({ hasText: "studio-mbp" }),
      ).toBeVisible(),
  },
  {
    name: "revoke dialog",
    path: "/",
    ready: async (p) => {
      await p.getByRole("button", { name: "Revoke studio-mbp" }).click();
      await expect(p.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "revoked row and toast",
    path: "/",
    ready: async (p) => {
      await p.getByRole("button", { name: "Revoke studio-mbp" }).click();
      await p
        .getByRole("alertdialog")
        .getByRole("button", { name: "Revoke machine" })
        .click();
      await expect(p.getByRole("alertdialog")).toHaveCount(0);
      await expect(
        p
          .getByRole("region", { name: /Notifications/ })
          .getByText("studio-mbp revoked"),
      ).toBeVisible();
      await expect(
        p
          .getByRole("row")
          .filter({ hasText: "studio-mbp" })
          .getByText("Revoked", { exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "revoke error inline",
    path: "/",
    setup: (p) =>
      answerRevoke(p, {
        status: 500,
        code: "internal",
        message: "The hub is unavailable.",
      }),
    ready: async (p) => {
      await p.getByRole("button", { name: "Revoke studio-mbp" }).click();
      const dlg = p.getByRole("alertdialog");
      await dlg.getByRole("button", { name: "Revoke machine" }).click();
      await expect(dlg.getByRole("alert")).toBeVisible();
    },
  },
  {
    name: "revoke dialog busy",
    path: "/",
    setup: (p) =>
      answerRevoke(p, {
        status: 500,
        code: "internal",
        message: "The hub is unavailable.",
        gated: true,
      }),
    ready: async (p) => {
      await p.getByRole("button", { name: "Revoke studio-mbp" }).click();
      const dlg = p.getByRole("alertdialog");
      await dlg.getByRole("button", { name: "Revoke machine" }).click();
      await expect(
        dlg.getByRole("button", { name: "Revoking…" }),
      ).toBeDisabled();
    },
  },
  {
    name: "agents",
    path: "/agents",
    ready: (p) =>
      expect(p.getByRole("heading", { name: "Global agents" })).toBeVisible(),
  },
  {
    name: "agents paused",
    path: "/agents",
    setup: (p) => streamHooks(p, { blocked: true }),
    plain: true,
    ready: (p) =>
      expect(
        p.getByText("Live updates paused.", { exact: false }),
      ).toBeVisible(),
  },
  {
    name: "machines paused",
    path: "/",
    setup: (p) => streamHooks(p, { blocked: true }),
    plain: true,
    ready: (p) =>
      expect(
        p.getByText("Live updates paused.", { exact: false }),
      ).toBeVisible(),
  },
  {
    name: "machines empty",
    path: "/",
    ready: async (p) => {
      await p.evaluate(() => window.__obMock?.setMachines([]));
      await expect(
        p.getByRole("heading", { name: "No machines yet" }),
      ).toBeVisible();
    },
  },
  {
    name: "machines error",
    path: "/",
    // The stream's greeting would fill the list: block it.
    setup: async (p) => {
      await failingList(p, "/api/v1/machines");
      await streamHooks(p, { blocked: true });
    },
    plain: true,
    ready: (p) =>
      expect(
        p.getByRole("alert").filter({ hasText: "Couldn't load machines" }),
      ).toBeVisible(),
  },
  {
    name: "agents empty",
    path: "/agents",
    ready: async (p) => {
      await p.evaluate(() => window.__obMock?.setAgents([]));
      await expect(
        p.getByRole("heading", { name: "No agents in this namespace" }),
      ).toBeVisible();
    },
  },
  {
    name: "agents error",
    path: "/agents",
    setup: async (p) => {
      await failingList(p, "/api/v1/agents");
      await streamHooks(p, { blocked: true });
    },
    plain: true,
    ready: (p) =>
      expect(
        p.getByRole("alert").filter({ hasText: "Couldn't load the roster" }),
      ).toBeVisible(),
  },
  {
    name: "settings",
    path: "/settings",
    ready: (p) =>
      expect(p.getByText("https://oa.example").first()).toBeVisible(),
  },
  {
    name: "unlink dialog",
    path: "/settings",
    ready: async (p) => {
      await p
        .getByRole("button", { name: "Unlink https://oa.example" })
        .click();
      await expect(p.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "mobile drawer open",
    path: "/",
    widths: [390],
    ready: async (p) => {
      await p.getByRole("button", { name: "Toggle navigation" }).click();
      await expect(
        p.getByRole("dialog").getByRole("link", { name: /^Agents\b/ }),
      ).toBeVisible();
    },
  },
  {
    name: "not found",
    path: "/nope",
    ready: (p) =>
      expect(p.getByRole("link", { name: "Back to machines" })).toBeVisible(),
  },
  {
    name: "sign-in",
    path: "/sign-in",
    setup: signedOut,
    plain: true,
    ready: (p) =>
      expect(
        p.getByRole("link", { name: "Continue with Cloudflare Access" }),
      ).toBeVisible(),
  },
  {
    name: "sign-in failed",
    path: "/sign-in?error=1",
    setup: signedOut,
    plain: true,
    ready: (p) =>
      expect(p.getByRole("alert")).toHaveText(
        "Sign-in didn't finish. Try again.",
      ),
  },
];

/**
 * Waits until every CSS transition and animation has finished: axe measuring
 * mid-transition reads blended colors and fails contrast (OA's `settled`).
 */
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );

const open = async (
  page: Page,
  s: Screen,
  theme: string,
  w: number,
  forceTheme = true,
) => {
  await page.setViewportSize({ width: w, height: 800 });
  await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
  await s.setup?.(page);
  if (s.plain) await page.goto(s.path);
  else await openLive(page, s.path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await s.ready(page);
  if (forceTheme)
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
  await settled(page);
};

/** Serious and critical violations, every wcag2a/wcag2aa one, and `region` (content outside landmarks). */
const violations = async (page: Page) => {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    type V = {
      id: string;
      impact: string;
      tags: string[];
      nodes: { target: string[] }[];
    };
    // @ts-expect-error injected
    const res = await axe.run(document, { resultTypes: ["violations"] });
    return (res.violations as V[])
      .filter(
        (x) =>
          x.id === "region" ||
          x.impact === "serious" ||
          x.impact === "critical" ||
          x.tags.includes("wcag2a") ||
          x.tags.includes("wcag2aa"),
      )
      .map(
        (x) =>
          `${x.impact} ${x.id}: ${x.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 4)
            .join(" | ")}`,
      );
  });
};

for (const s of SCREENS)
  for (const theme of ["light", "dark"]) {
    for (const w of s.widths ?? [1280, 390])
      test(`axe ${s.name} ${theme} ${w}`, async ({ page }) => {
        await open(page, s, theme, w);
        const v = await violations(page);
        expect(v, v.join("\n")).toEqual([]);
      });
    if (s.widths && !s.widths.includes(1280)) continue;
    test(`axe ${s.name} ${theme} 1280, OS preference only`, async ({
      page,
    }) => {
      await open(page, s, theme, 1280, false);
      expect(
        await page.evaluate(() =>
          document.documentElement.hasAttribute("data-theme"),
        ),
      ).toBe(false);
      const v = await violations(page);
      expect(v, v.join("\n")).toEqual([]);
    });
  }

for (const s of SCREENS)
  test(`no horizontal scroll at 390: ${s.name}`, async ({ page }) => {
    await open(page, s, "light", 390);
    const res = await sidewaysOverflow(page);
    expect(
      res.sw,
      `${res.sw} > ${res.iw}; ${res.wide.join(", ")}`,
    ).toBeLessThanOrEqual(res.iw);
  });
