// Read-only smoke against a real Worker (local `wrangler dev` or staging).
// Mutates nothing: no revoke, no approve. Safe on staging.
import { LinkedAppsResponseSchema, MeSchema } from "@ob/shared";
import { expect, test, watchErrors } from "./fixtures";

test("the owner is signed in: /api/v1/me answers 200 with the owner email", async ({
  signedIn: page,
}) => {
  const res = await page.request.get("/api/v1/me");
  expect(res.status()).toBe(200);
  const me = MeSchema.parse(await res.json());
  if (process.env.E2E_OWNER_EMAIL)
    expect(me.user.email).toBe(process.env.E2E_OWNER_EMAIL);
});

test("Machines shows its heading and either the empty state or rows; Agents shows its summary; the stream goes live with no console errors", async ({
  signedIn: page,
}) => {
  const errors = watchErrors(page);
  // The shell's one stream is live once the hub has sent hello and both snapshots.
  const seen = new Set<string>();
  const live = new Promise<void>((resolve) => {
    page.on("websocket", (ws) => {
      if (!new URL(ws.url()).pathname.endsWith("/api/v1/events")) return;
      ws.on("framereceived", (f) => {
        try {
          const { type } = JSON.parse(String(f.payload)) as { type?: string };
          if (type) seen.add(type);
        } catch {}
        if (["hello", "machines", "agents"].every((t) => seen.has(t)))
          resolve();
      });
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Machines", exact: true, level: 1 }),
  ).toBeVisible();
  const empty = page.getByText("No machines yet");
  const rows = page.getByRole("row");
  await expect(empty.or(rows.first())).toBeVisible();
  await expect(page.getByText("Couldn't load machines")).toHaveCount(0);

  await Promise.race([
    live,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `stream never went live; frames seen: ${[...seen].join(", ") || "none"}`,
            ),
          ),
        15_000,
      ),
    ),
  ]);

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /^Agents\b/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Agents", exact: true, level: 1 }),
  ).toBeVisible();
  // "No agents" on an empty roster, else "N agents in <ns> · K live".
  await expect(page.locator("[data-summary]")).toHaveText(
    /^(No agents|.*\d+ .*· \d+ live)$/s,
  );
  // The status column header only exists once the roster has rows.
  if (
    !/^No agents/.test(
      (await page.locator("[data-summary]").textContent()) ?? "",
    )
  )
    await expect(
      page.getByRole("columnheader", { name: /Status \(agent says\)/ }).first(),
    ).toBeVisible();
  // Still live after a settle window: a drop right after hello would show here.
  await page.waitForTimeout(1_500);
  await expect(page.getByText("Live updates paused.")).toHaveCount(0);

  expect(errors, "console errors and CSP violations").toEqual([]);
});

test("GET /api/v1/linked-apps answers 200 and parses as { apps }", async ({
  signedIn: page,
}) => {
  const res = await page.request.get("/api/v1/linked-apps");
  expect(res.status()).toBe(200);
  LinkedAppsResponseSchema.parse(await res.json());
});

test("Settings shows Linked apps with either the empty state or rows, with no console errors", async ({
  signedIn: page,
}) => {
  const errors = watchErrors(page);
  // Client-side nav: the local dev:e2e server has no SPA fallback for deep links.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /^Settings\b/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Linked apps", exact: true, level: 2 }),
  ).toBeVisible();
  const section = page.getByRole("region", {
    name: "Linked apps",
    exact: true,
  });
  const empty = section.getByText("No linked apps");
  const rows = section.getByRole("listitem");
  await expect(empty.or(rows.first())).toBeVisible();
  await expect(
    page.getByText("Linked apps aren't available on this bus yet."),
  ).toHaveCount(0);
  await expect(page.getByText("Couldn't load linked apps")).toHaveCount(0);
  await page.waitForTimeout(1_000);
  expect(errors, "console errors and CSP violations").toEqual([]);
});

test("/link with a malformed request answers 400 with the error page and echoes nothing", async ({
  signedIn: page,
}) => {
  const errors = watchErrors(page);
  // GET only: a valid request would seal a cookie and 303 to the confirm page.
  // Extra params (redirect_uri) and a short state are both refused.
  const res = await page.goto(
    "/link?aud=https://oa.example/path&state=short&redirect_uri=https://evil.example/x",
  );
  expect(res?.status()).toBe(400);
  await expect(
    page.getByRole("heading", { name: "This link request isn't valid" }),
  ).toBeVisible();
  const body = await page.content();
  expect(body).not.toContain("oa.example");
  expect(body).not.toContain("evil.example");
  expect(page.url()).toContain("/link?");
  // Chromium logs the expected 400 document itself as a console error.
  expect(
    errors.filter((e) => !/status of 400 \(Bad Request\)/.test(e)),
    "console errors and CSP violations",
  ).toEqual([]);
});
