import { toast } from "@ob/ui/shadcn";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, HttpResponse, http, type RequestHandler } from "msw";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { makeQueryClient } from "../src/api/queryClient";
import { createMockBus, handlersFor } from "../src/mocks/handlers";
import { createAppRouter } from "../src/router";
import { installHarness, server } from "./harness";
import { warmApp } from "./warm";

installHarness();
beforeAll(warmApp, 30_000);
afterEach(() => {
  toast.dismiss();
  vi.restoreAllMocks();
});

const AUD = "https://oa.example";
const PUNY = "https://xn--bcher-kva.example";
const PORT = "https://oa.example:8443";

const mount = (
  apps?: { aud: string; linkedAt: string }[],
  { keepRetry = false, extra = [] as RequestHandler[] } = {},
) => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  if (apps)
    server.use(
      http.get("*/api/v1/linked-apps", () => HttpResponse.json({ apps })),
    );
  server.use(...extra);
  const client = makeQueryClient();
  if (!keepRetry) client.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createAppRouter(
          createMemoryHistory({ initialEntries: ["/settings"] }),
        )}
      />
    </QueryClientProvider>,
  );
  return bus;
};

test("lists each aud as plain text with its link day, never a link", async () => {
  mount([
    { aud: PUNY, linkedAt: "2026-10-21T10:00:00.000Z" },
    { aud: PORT, linkedAt: "2026-10-22T10:00:00.000Z" },
  ]);
  expect(await screen.findByText(PUNY)).toBeInTheDocument();
  expect(screen.getByText(PORT)).toBeInTheDocument();
  expect(screen.getByText("Linked Oct 21, 2026")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Linked apps" }),
  ).toBeInTheDocument();
  const list = screen.getByText(PUNY).closest("section") as HTMLElement;
  expect(within(list).queryAllByRole("link")).toHaveLength(0);
  expect(list.querySelector("a")).toBeNull();
});

test("Settings is the last nav item, without a count", async () => {
  mount();
  const link = await screen.findByRole("link", {
    name: "Settings",
    hidden: true,
  });
  expect(link).toBeInTheDocument();
  const links = within(
    screen.getByRole("navigation", { name: "Main", hidden: true }),
  ).getAllByRole("link", { hidden: true });
  expect(links.at(-1)).toBe(link);
});

test("unlink confirms, then removes the row", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText(AUD);
  await user.click(screen.getByRole("button", { name: `Unlink ${AUD}` }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(`Unlink ${AUD}?`)).toBeInTheDocument();
  expect(
    within(dialog).getByText(
      `${AUD} can no longer verify your agents' cards. Cards it already has expire within 5 minutes.`,
    ),
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Unlink" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: `Unlink ${AUD}` }),
    ).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByText(
      (_, el) =>
        el?.hasAttribute("data-title") === true &&
        el.textContent === `Unlinked ${AUD}.`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Link one from the app's settings."),
  ).toBeInTheDocument();
});

test("an unlink that fails brings the row back with a toast", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText(AUD);
  server.use(
    http.delete("*/api/v1/linked-apps/:aud", () =>
      HttpResponse.json(
        { error: { code: "internal", message: "Hub unreachable" } },
        { status: 500 },
      ),
    ),
  );
  await user.click(screen.getByRole("button", { name: `Unlink ${AUD}` }));
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Unlink",
    }),
  );
  expect(await screen.findByText(`Couldn't unlink ${AUD}`)).toBeInTheDocument();
  expect(screen.getByText("Hub unreachable")).toBeInTheDocument();
  expect(await screen.findByText(AUD)).toBeInTheDocument();
});

test("empty state when nothing is linked", async () => {
  mount([]);
  expect(
    await screen.findByText("Link one from the app's settings."),
  ).toBeInTheDocument();
});

test("a 404 reads as not available yet: no error card, one GET", async () => {
  let gets = 0;
  mount(undefined, {
    keepRetry: true,
    extra: [
      http.get("*/api/v1/linked-apps", () => {
        gets++;
        return HttpResponse.json(
          { error: { code: "not_found", message: "no route" } },
          { status: 404 },
        );
      }),
    ],
  });
  expect(
    await screen.findByText("Linked apps aren't available on this bus yet."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Unlink/ })).toBeNull();
  await new Promise((r) => setTimeout(r, 300));
  expect(gets).toBe(1);
});

test("a 500 keeps the error card", async () => {
  mount(undefined, {
    extra: [
      http.get("*/api/v1/linked-apps", () =>
        HttpResponse.json(
          { error: { code: "internal", message: "Hub unreachable" } },
          { status: 500 },
        ),
      ),
    ],
  });
  expect(
    await screen.findByText("Couldn't load linked apps"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Linked apps aren't available on this bus yet."),
  ).not.toBeInTheDocument();
});

const THREE = [AUD, PUNY, PORT].map((aud) => ({
  aud,
  linkedAt: "2026-10-21T10:00:00.000Z",
}));
/** A DELETE that never answers: the unlink stays pending, its row hidden. */
const hang = http.delete("*/api/v1/linked-apps/:aud", () => delay("infinite"));

/** Opens Unlink for `aud` and presses `button` in the confirm. */
const unlinkVia = async (
  user: ReturnType<typeof userEvent.setup>,
  aud: string,
  button: "Unlink" | "Cancel",
) => {
  await user.click(
    await screen.findByRole("button", { name: `Unlink ${aud}` }),
  );
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: button,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
};

test("unlink returns focus to the next row's Unlink, else the previous", async () => {
  const user = userEvent.setup();
  mount(THREE, { extra: [hang] });
  await unlinkVia(user, PUNY, "Unlink");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `Unlink ${PORT}` }),
    ),
  );
  await unlinkVia(user, PORT, "Unlink");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `Unlink ${AUD}` }),
    ),
  );
});

test("unlinking the only app returns focus to the page, not body", async () => {
  const user = userEvent.setup();
  mount([THREE[0] as (typeof THREE)[0]], { extra: [hang] });
  await unlinkVia(user, AUD, "Unlink");
  await waitFor(() =>
    expect(document.activeElement).toBe(document.getElementById("ob-main")),
  );
});

test("cancel returns focus to the row's own Unlink", async () => {
  const user = userEvent.setup();
  mount(THREE);
  await unlinkVia(user, PUNY, "Cancel");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `Unlink ${PUNY}` }),
    ),
  );
  expect(document.activeElement).not.toBe(document.body);
});
