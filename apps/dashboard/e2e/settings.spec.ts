// Settings (AC6.4): unlink a linked app with confirm, then the empty state.
import { expect, test } from "@playwright/test";
import { openLive } from "./helpers";

test("unlink an app with confirm, then the empty state", async ({ page }) => {
  await openLive(page, "/settings");
  await expect(page.getByText("https://oa.example").first()).toBeVisible();
  await page.getByRole("button", { name: "Unlink https://oa.example" }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Unlink https://oa.example?");
  await dlg.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No linked apps" }),
  ).toBeVisible();
  await expect(
    page.getByText("Link one from the app's settings.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unlink https://oa.example" }),
  ).toHaveCount(0);
});

test("cancel keeps the app linked", async ({ page }) => {
  await openLive(page, "/settings");
  await page.getByRole("button", { name: "Unlink https://oa.example" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(
    page.getByRole("button", { name: "Unlink https://oa.example" }),
  ).toBeVisible();
});
