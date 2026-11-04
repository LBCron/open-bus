import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeAll, expect, test } from "vitest";
import { StatusCell } from "../src/agents/StatusCell";
import type { Agent } from "../src/api/contract";
import { makeQueryClient } from "../src/api/queryClient";
import { fixtures } from "../src/mocks/fixtures";
import { createMockBus, handlersFor } from "../src/mocks/handlers";
import { createAppRouter } from "../src/router";
import { FakeWebSocket, lastSocket } from "./fakeWebSocket";
import { installHarness, server } from "./harness";
import { warmApp } from "./warm";

installHarness();
// Cold first render out of the first test's findBy budget (see warmApp).
beforeAll(warmApp, 30_000);

// Fixture names (src/mocks/fixtures.ts). GET /agents lists every agent that
// can receive mail: live ones and queued ones (machine offline, session open).
const APP = "github.com/acme/app";
const DOCS = "github.com/acme/docs";
const [CLAUDE, OPENCODE, SCOUT] = fixtures.agents;
if (
  CLAUDE?.name !== "claude-1" ||
  CLAUDE.machineLabel !== "studio-mbp" ||
  OPENCODE?.name !== "opencode-1" ||
  OPENCODE.state !== "queued" ||
  OPENCODE.machineLabel !== "laptop" ||
  SCOUT?.name !== "scout" ||
  !SCOUT.global ||
  SCOUT.namespace !== DOCS
)
  throw new Error("fixtures changed: update agents.test.tsx");

const agent = (over: Partial<Agent>): Agent => ({
  ...CLAUDE,
  id: "AgentExtra1Ddddd",
  name: "claude-2",
  updatedAt: new Date().toISOString(),
  ...over,
});

/** A non-global docs agent, so the docs namespace has a group of its own. */
const WRITER = agent({
  id: "AgentWriter1Ffff",
  name: "writer",
  namespace: DOCS,
});

/** Signed-in app at `/agents`, backed by a fresh mock bus. No retries. */
const mount = (client: QueryClient = makeQueryClient(), path = "/agents") => {
  const bus = createMockBus();
  server.use(...handlersFor(bus));
  client.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createAppRouter(
          createMemoryHistory({ initialEntries: [path] }),
        )}
      />
    </QueryClientProvider>,
  );
  return bus;
};

const push = (agents: Agent[]) =>
  act(() => {
    lastSocket().push({ type: "agents", agents });
  });

const NS_TABLE = "Agents in this namespace";
const GLOBAL_TABLE = "Agents every namespace sees";

/** The body rows of a roster table, as text. */
const rowsOf = (name: string) => {
  const table = screen.getByRole("table", { name });
  const [, body] = within(table).getAllByRole("rowgroup");
  return within(body as HTMLElement)
    .queryAllByRole("row")
    .map((r) => r.textContent ?? "");
};
const nsRows = () => rowsOf(NS_TABLE);
const globalRows = () => rowsOf(GLOBAL_TABLE);

const chips = () => screen.getByRole("radiogroup", { name: "Namespaces" });
const chip = (name: string | RegExp) =>
  within(chips()).getByRole("radio", { name });
const filters = () => screen.getByRole("radiogroup", { name: "Filter" });
/** The roster summary line. */
const summary = () => {
  const el = document.querySelector<HTMLElement>("p[data-summary]");
  if (!el) throw new Error("no summary line");
  return el;
};

/** Counts agents GETs from here on, holding each until released. */
const countAgentGets = (bus: ReturnType<typeof createMockBus>) => {
  const seen = { gets: 0 };
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  server.use(
    http.get("*/api/v1/agents", async () => {
      seen.gets++;
      await gate;
      return HttpResponse.json({ agents: bus.agents() });
    }),
  );
  return { seen, release: () => act(async () => release()) };
};

test("the header names the page; the first namespace's agents fill the table, live first", async () => {
  mount();
  const banner = await screen.findByRole("banner");
  expect(
    await within(banner).findByRole("heading", { level: 1, name: "Agents" }),
  ).toBeInTheDocument();
  await screen.findByText("claude-1");
  expect(chip(/^github\.com\/acme\/app\b/)).toBeChecked();
  const rows = nsRows();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("claude-1");
  expect(rows[0]).toContain("Claude Code");
  expect(rows[0]).toContain("studio-mbp");
  expect(rows[1]).toContain("opencode-1");
  expect(rows[1]).toContain("OpenCode");
  expect(rows[1]).toContain("Queued");
  expect(summary()).toHaveTextContent(
    /^2 agents in github\.com\/acme\/app · 1 live$/,
  );
  const table = screen.getByRole("table", { name: NS_TABLE });
  for (const head of [
    "Agent",
    "Kind",
    "Status, agent says",
    "Machine",
    "Reachable",
    "Updated",
  ])
    expect(
      within(table).getByRole("columnheader", { name: head }),
    ).toBeInTheDocument();
});

test("global agents sit only in the Global agents section, with no home namespace", async () => {
  mount();
  await screen.findByText("claude-1");
  const global = screen.getByRole("region", { name: "Global agents" });
  expect(global).toHaveTextContent(
    "Seen by every namespace. Any agent can message them.",
  );
  expect(globalRows()).toHaveLength(1);
  expect(globalRows()[0]).toContain("scout");
  expect(within(global).getByText("global")).toBeInTheDocument();
  expect(
    within(screen.getByRole("table", { name: NS_TABLE })).queryByText("global"),
  ).not.toBeInTheDocument();
  expect(global).not.toHaveTextContent(DOCS);
  expect(nsRows().join(" ")).not.toContain("scout");
  // The legend, verbatim.
  expect(
    screen.getByText(
      "Live agents receive at once. Queued agents get messages if their machine reconnects within 1 hour; after that the sender is told it expired. Closed sessions leave the roster.",
    ),
  ).toBeInTheDocument();
});

test("nothing says connected", async () => {
  mount();
  await screen.findByText("claude-1");
  expect(screen.getByRole("main")).not.toHaveTextContent(/connected/i);
  push([]);
  await screen.findByText("No agents in this namespace");
  expect(screen.getByRole("main")).not.toHaveTextContent(/connected/i);
});

test("rows carry a StatusBadge labeled with the agent and its machine", async () => {
  mount();
  await screen.findByText("claude-1");
  const live = screen.getByLabelText("claude-1 on studio-mbp is live");
  expect(live).toHaveTextContent("Live");
  expect(live).toHaveAttribute("data-status", "live");
  const queued = screen.getByLabelText("opencode-1 on laptop is queued");
  expect(queued).toHaveTextContent("Queued");
  expect(queued).toHaveAttribute("data-status", "queued");
  expect(
    within(
      screen.getByRole("region", { name: "Global agents" }),
    ).getByLabelText("scout on studio-mbp is live"),
  ).toBeInTheDocument();
});

test("same-named agents on two machines get distinct labels", async () => {
  mount();
  await screen.findByText("claude-1");
  push([
    CLAUDE,
    agent({
      id: "AgentTwin1Kkkkkk",
      name: "claude-1",
      // An active machine: agents on revoked ones are not listed.
      machineId: fixtures.machines[1]?.id,
      machineLabel: "laptop",
    }),
  ]);
  expect(
    await screen.findByLabelText("claude-1 on laptop is live"),
  ).toBeInTheDocument();
  expect(
    screen.getByLabelText("claude-1 on studio-mbp is live"),
  ).toBeInTheDocument();
});

test("an agent that turns queued in a frame sorts after the live ones", async () => {
  mount();
  await screen.findByText("claude-1");
  push([
    agent({ id: "AgentAaaDwn1Eeee", name: "aaa-q", state: "queued" }),
    ...fixtures.agents,
  ]);
  await waitFor(() => expect(nsRows()).toHaveLength(3));
  expect(nsRows()[0]).toContain("claude-1");
  expect(nsRows()[1]).toContain("aaa-q");
  expect(nsRows()[2]).toContain("opencode-1");
});

test("a row says when it was updated", async () => {
  mount();
  await screen.findByText("claude-1");
  push([agent({ name: "fresh-one" }), SCOUT]);
  await screen.findByText("fresh-one");
  expect(nsRows()[0]).toMatch(/now$/);
});

test("namespace chips: one per namespace with its count, then global; the full name is the title", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText("claude-1");
  push([...fixtures.agents, WRITER]);
  await screen.findByRole("radio", { name: /^github\.com\/acme\/docs\b/ });
  const radios = within(chips()).getAllByRole("radio");
  expect(radios.map((r) => r.textContent)).toEqual([
    `${APP}, 2 agents`,
    `${DOCS}, 1 agent`,
    "global, 1 agent",
  ]);
  expect(chip(/^github\.com\/acme\/app\b/)).toHaveAttribute("title", APP);

  await user.click(chip(/^github\.com\/acme\/docs\b/));
  expect(nsRows()).toHaveLength(1);
  expect(nsRows()[0]).toContain("writer");
  expect(summary()).toHaveTextContent(
    /^1 agent in github\.com\/acme\/docs · 1 live$/,
  );
  // Global agents stay under every namespace.
  expect(globalRows()[0]).toContain("scout");

  // global shows only the Global agents section.
  await user.click(chip(/^global\b/));
  expect(
    screen.queryByRole("table", { name: NS_TABLE }),
  ).not.toBeInTheDocument();
  expect(globalRows()[0]).toContain("scout");
  expect(summary()).toHaveTextContent(/^1 global agent · 1 live$/);
});

test("the Live and Queued filters narrow every table and the summary counts what shows", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText("claude-1");
  expect(within(filters()).getByRole("radio", { name: "All" })).toBeChecked();

  await user.click(within(filters()).getByRole("radio", { name: "Live" }));
  expect(nsRows()).toHaveLength(1);
  expect(nsRows()[0]).toContain("claude-1");
  expect(summary()).toHaveTextContent(
    /^1 of 2 agents in github\.com\/acme\/app · 1 live$/,
  );
  expect(globalRows()[0]).toContain("scout");

  await user.click(within(filters()).getByRole("radio", { name: "Queued" }));
  expect(nsRows()).toHaveLength(1);
  expect(nsRows()[0]).toContain("opencode-1");
  // Nothing global is queued.
  expect(globalRows()).toEqual(["No agents match this filter."]);

  await user.click(chip(/^global\b/));
  expect(summary()).toHaveTextContent(/^0 of 1 global agent · 1 live$/);

  await user.click(within(filters()).getByRole("radio", { name: "All" }));
  expect(globalRows()).toHaveLength(1);
});

test("a picked namespace that leaves the roster resets to the first and stays there", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText("claude-1");
  push([...fixtures.agents, WRITER]);
  await screen.findByRole("radio", { name: /^github\.com\/acme\/docs\b/ });
  await user.click(chip(/^github\.com\/acme\/docs\b/));
  expect(nsRows()[0]).toContain("writer");

  push([...fixtures.agents]);
  await waitFor(() => expect(nsRows()[0]).toContain("claude-1"));
  expect(chip(/^github\.com\/acme\/app\b/)).toBeChecked();

  // docs comes back: the view does not snap back to it.
  push([...fixtures.agents, WRITER]);
  await screen.findByRole("radio", { name: /^github\.com\/acme\/docs\b/ });
  expect(chip(/^github\.com\/acme\/app\b/)).toBeChecked();
  expect(nsRows().join(" ")).not.toContain("writer");
});

test("picking global, then losing every global agent, goes back to the first namespace", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText("claude-1");
  await user.click(chip(/^global\b/));
  push([CLAUDE]);
  await waitFor(() => expect(nsRows()[0]).toContain("claude-1"));
  expect(
    within(chips()).queryByRole("radio", { name: /^global\b/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Global agents" }),
  ).not.toBeInTheDocument();
  // The legend still explains the badges.
  expect(
    screen.getByText(/^Live agents receive at once\./),
  ).toBeInTheDocument();
});

test("a pushed roster frame updates the page without a reload", async () => {
  mount();
  await screen.findByText("claude-1");
  push([...fixtures.agents, agent({})]);
  expect(await screen.findByText("claude-2")).toBeInTheDocument();
});

test("no agents: the empty card, and no global section", async () => {
  mount();
  await screen.findByText("claude-1");
  push([]);
  expect(
    await screen.findByRole("heading", { name: "No agents in this namespace" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Agents appear here while a session on an approved machine is running.",
    ),
  ).toBeInTheDocument();
  expect(summary()).toHaveTextContent(/^No agents$/);
  expect(
    screen.queryByRole("button", { name: "Show global agents" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Global agents" }),
  ).not.toBeInTheDocument();
});

test('only global agents: the view opens on global, never "No agents" beside a global count', async () => {
  mount();
  await screen.findByText("claude-1");
  push([SCOUT]);
  await waitFor(() => expect(chip(/^global\b/)).toBeChecked());
  expect(globalRows()[0]).toContain("scout");
  expect(summary()).toHaveTextContent(/^1 global agent · 1 live$/);
  expect(
    screen.queryByRole("heading", { name: "No agents in this namespace" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("No agents")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("table", { name: NS_TABLE }),
  ).not.toBeInTheDocument();
});

test("connecting shows no paused flash; the status region is mounted empty", async () => {
  mount();
  await screen.findByText("claude-1");
  const region = screen.getByRole("status");
  expect(region).toBeEmptyDOMElement();
  expect(
    screen.getByLabelText("claude-1 on studio-mbp is live"),
  ).toBeInTheDocument();
});

test("a dropped stream shows a paused banner, the rows stay muted, and none claims to be live now", async () => {
  mount();
  await screen.findByText("claude-1");
  const region = screen.getByRole("status");
  const dropped = lastSocket();
  act(() => {
    lastSocket().push({ type: "hello" });
    lastSocket().fail();
  });
  await waitFor(() =>
    expect(region).toHaveTextContent(
      /^Live updates paused\. Showing the roster as of .+\.$/,
    ),
  );
  expect(screen.getByRole("status")).toBe(region);
  expect(region.querySelector("time")).toHaveAttribute("datetime");
  // The status region holds only the text; Retry sits beside it.
  expect(within(region).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.getByText("claude-1")).toBeInTheDocument();
  expect(screen.getByText("scout")).toBeInTheDocument();
  expect(screen.queryByLabelText(/ is live$/)).not.toBeInTheDocument();
  const live = screen.getByLabelText(/^claude-1 on studio-mbp, live as of .+/);
  // The badge word never changes.
  expect(live).toHaveTextContent("Live");
  expect(screen.queryByLabelText(/ is queued$/)).not.toBeInTheDocument();
  const queued = screen.getByLabelText(
    /^opencode-1 on laptop, queued as of .+/,
  );
  expect(queued).toHaveTextContent("Queued");
  // Both badges are muted (by colour, never opacity: a faded badge fails AA).
  for (const badge of [live, queued]) {
    expect(badge).toHaveAttribute("data-muted", "true");
    expect(getComputedStyle(badge).opacity).not.toMatch(/^0/);
    expect(badge.closest("[class*=opacity]")).toBeNull();
  }

  // The summary's "· K live" claim is muted the same way: colour, no opacity.
  const muted = summary().querySelector("[data-muted]");
  expect(muted).toHaveTextContent(/^· 1 live$/);
  expect(muted?.className).not.toMatch(/opacity/);
  expect(muted?.querySelector(".text-foreground")).toBeNull();

  // Back live: labels say live again and the banner clears.
  await waitFor(() => expect(lastSocket()).not.toBe(dropped), {
    timeout: 3000,
  });
  act(() => lastSocket().push({ type: "hello" }));
  expect(
    await screen.findByLabelText("claude-1 on studio-mbp is live"),
  ).toBeInTheDocument();
  expect(
    screen.getByLabelText("opencode-1 on laptop is queued"),
  ).not.toHaveAttribute("data-muted");
  expect(region).toBeEmptyDOMElement();
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  expect(summary().querySelector("[data-muted]")).toBeNull();
});

test("Retry while the stream backs off reconnects now, then refetches once, however fast you click", async () => {
  const user = userEvent.setup();
  const bus = mount();
  await screen.findByText("claude-1");
  // hello alone starts no GET (its greeting would); the drop cancels that wait.
  act(() => lastSocket().push({ type: "hello" }));
  act(() => lastSocket().fail());
  const retry = await screen.findByRole("button", { name: "Retry" });

  bus.setAgents([
    CLAUDE,
    SCOUT,
    agent({ id: "AgentNew2Hhhhhhh", name: "fresh" }),
  ]);
  const { seen, release } = countAgentGets(bus);
  const sockets = FakeWebSocket.all.length;
  await user.click(retry); // cuts the backoff short: a new socket, no GET
  expect(FakeWebSocket.all).toHaveLength(sockets + 1);
  expect(seen.gets).toBe(0);
  await user.click(retry); // the socket is up but has no hello yet: refetch
  await user.click(retry);
  expect(FakeWebSocket.all).toHaveLength(sockets + 1);
  expect(seen.gets).toBe(1);
  expect(retry).toBeDisabled();
  await release();
  expect(await screen.findByText("fresh")).toBeInTheDocument();
  expect(seen.gets).toBe(1);
});

test("Retry reconnects a parked stream and leaves the refetch to its hello", async () => {
  const user = userEvent.setup();
  const bus = mount();
  await screen.findByText("claude-1");
  // A failure before any hello backs off; Retry cuts that short.
  act(() => lastSocket().fail());
  const region = screen.getByRole("status");
  await waitFor(() => expect(region).toHaveTextContent(/live updates paused/i));
  const parked = lastSocket();
  const { seen, release } = countAgentGets(bus);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(lastSocket()).not.toBe(parked);
  expect(seen.gets).toBe(0);
  act(() => lastSocket().push({ type: "hello" }));
  await waitFor(() => expect(region).toBeEmptyDOMElement());
  // No greeting snapshot follows this hello, so the list is fetched once its window ends.
  await waitFor(() => expect(seen.gets).toBe(1), { timeout: 3000 });
  await release();
  expect(seen.gets).toBe(1);
});

test("loading shows a busy skeleton table", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  mount();
  server.use(
    http.get("*/api/v1/agents", async () => {
      await gate;
      return HttpResponse.json({ agents: [] });
    }),
  );
  expect(
    await screen.findByRole("table", { name: "Loading agents" }),
  ).toHaveAttribute("aria-busy", "true");
  expect(summary()).toHaveTextContent(/^Loading agents$/);
  await act(async () => release());
  expect(
    await screen.findByRole("heading", { name: "No agents in this namespace" }),
  ).toBeInTheDocument();
});

test("an error offers Retry, which recovers", async () => {
  const user = userEvent.setup();
  let fail = true;
  mount();
  server.use(
    http.get("*/api/v1/agents", () =>
      fail
        ? HttpResponse.json(
            { error: { code: "internal", message: "Hub unreachable" } },
            { status: 500 },
          )
        : HttpResponse.json({ agents: [CLAUDE] }),
    ),
  );
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Couldn't load the rosterThe bus answered with an error.",
  );
  fail = false;
  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("claude-1")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("the page title names the page", async () => {
  mount();
  await screen.findByText("claude-1");
  expect(document.title).toMatch(/^Agents/);
});

test("a pending revoke takes its machine's agents off the page at once, as in the nav", async () => {
  const user = userEvent.setup();
  mount(makeQueryClient(), "/");
  await screen.findByText("studio-mbp");
  let release!: (r: Response) => void;
  const gate = new Promise<Response>((r) => {
    release = r;
  });
  server.use(http.delete("*/api/v1/machines/:id", () => gate));
  await user.click(screen.getByRole("button", { name: "Revoke studio-mbp" }));
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Revoke machine",
    }),
  );
  await screen.findByRole("button", { name: "Revoking…" });
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("link", { name: /^Agents\b/ }));
  await screen.findByRole("table", { name: NS_TABLE });

  // claude-1 and scout sit on studio-mbp; only opencode-1 (laptop) stays.
  expect(nsRows()).toHaveLength(1);
  expect(nsRows()[0]).toContain("opencode-1");
  expect(screen.queryByText("claude-1")).not.toBeInTheDocument();
  expect(screen.queryByText("scout")).not.toBeInTheDocument();
  expect(summary()).toHaveTextContent(
    /^1 agent in github\.com\/acme\/app · 0 live$/,
  );
  expect(screen.getByRole("link", { name: "Agents, 1" })).toBeInTheDocument();
  expect(
    within(chips())
      .getAllByRole("radio")
      .map((r) => r.textContent),
  ).toEqual([`${APP}, 1 agent`]);
  await act(async () => release(new HttpResponse(null, { status: 204 })));
});

test("a roster that can't reach the bus says so", async () => {
  mount();
  server.use(http.get("*/api/v1/agents", () => HttpResponse.error()));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Couldn't load the rosterCouldn't reach the bus.",
  );
});

test("the summary is not a live region: only the paused notice announces", async () => {
  mount();
  await screen.findByText("claude-1");
  expect(summary()).not.toHaveAttribute("aria-live");
  expect(
    screen.getByRole("main").querySelectorAll("[aria-live]:not([role=status])"),
  ).toHaveLength(0);
});

test("an omp agent's row shows the oh-my-pi label", async () => {
  mount();
  server.use(
    http.get("*/api/v1/agents", () =>
      HttpResponse.json({
        agents: [
          ...fixtures.agents,
          agent({ id: "AgentZz7Aaaaaaaa", name: "omp-1", kind: "omp" }),
        ],
      }),
    ),
  );
  await screen.findByText("omp-1");
  expect(nsRows().find((r) => r.includes("omp-1"))).toContain("oh-my-pi");
});

test("a codex agent's row shows the Codex label (C26a)", async () => {
  mount();
  server.use(
    http.get("*/api/v1/agents", () =>
      HttpResponse.json({
        agents: [
          ...fixtures.agents,
          agent({ id: "AgentZz6Aaaaaaaa", name: "codex-1", kind: "codex" }),
        ],
      }),
    ),
  );
  await screen.findByText("codex-1");
  expect(nsRows().find((r) => r.includes("codex-1"))).toContain("Codex");
});

test("an unknown kind's row shows its own token, and the roster still renders (C26h)", async () => {
  mount();
  server.use(
    http.get("*/api/v1/agents", () =>
      HttpResponse.json({
        agents: [
          ...fixtures.agents,
          agent({ id: "AgentZz8Aaaaaaaa", name: "zz-1", kind: "zz" }),
          agent({
            id: "AgentZz9Aaaaaaaa",
            name: "ctor-1",
            kind: "constructor",
          }),
        ],
      }),
    ),
  );
  await screen.findByText("zz-1");
  const row = nsRows().find((r) => r.includes("zz-1"));
  expect(row?.replace("zz-1", "")).toContain("zz");
  expect(row).not.toContain("Other");
  expect(
    nsRows()
      .find((r) => r.includes("ctor-1"))
      ?.replace("ctor-1", ""),
  ).toContain("constructor");
  expect(screen.getByText("claude-1")).toBeInTheDocument();
});

test("D5: chips sort by agent count, then by name; global last; the biggest namespace is the default", async () => {
  const ns = (name: string, id: string, namespace: string) =>
    agent({ id, name, namespace });
  const roster = [
    ...fixtures.agents, // app: 2
    ns("w1", "AgentZz1Aaaaaaaa", DOCS), // docs: 2, ties app: alphabetical
    ns("w2", "AgentZz2Aaaaaaaa", DOCS),
    ns("b1", "AgentZz3Aaaaaaaa", "github.com/acme/zeta"), // zeta: 3
    ns("b2", "AgentZz4Aaaaaaaa", "github.com/acme/zeta"),
    ns("b3", "AgentZz5Aaaaaaaa", "github.com/acme/zeta"),
    ns("c1", "AgentZz6Aaaaaaaa", "github.com/acme/api"), // api: 1
  ];
  mount();
  // The first load already carries this roster.
  server.use(
    http.get("*/api/v1/agents", () => HttpResponse.json({ agents: roster })),
  );
  await screen.findByText("b1");
  expect(
    within(chips())
      .getAllByRole("radio")
      .map((r) => r.getAttribute("title") ?? r.textContent),
  ).toEqual([
    "github.com/acme/zeta",
    APP,
    DOCS,
    "github.com/acme/api",
    "global, 1 agent",
  ]);
  expect(chip(/^github\.com\/acme\/zeta\b/)).toBeChecked();
});

test("D5: an only-global roster shows no namespace chips, selects global and only its section", async () => {
  mount();
  await screen.findByText("claude-1");
  push([
    SCOUT,
    agent({ id: "AgentGkob2Aaaaaa", name: "scout-2", global: true }),
  ]);
  await waitFor(() => expect(chip(/^global\b/)).toBeChecked());
  expect(within(chips()).getAllByRole("radio")).toHaveLength(1);
  expect(summary()).toHaveTextContent(/^2 global agents · 2 live$/);
  expect(screen.getByRole("region", { name: "Global agents" })).toBeVisible();
  expect(screen.queryByRole("table", { name: NS_TABLE })).toBeNull();
  expect(screen.queryByText("No agents in this namespace")).toBeNull();
});

test("the default namespace is kept once the roster loads: a later snapshot never moves the view", async () => {
  mount();
  await screen.findByText("claude-1");
  expect(chip(/^github\.com\/acme\/app\b/)).toBeChecked();
  // docs now has the most agents, so it sorts first; the view stays on app.
  push([
    ...fixtures.agents,
    WRITER,
    agent({ id: "AgentWriter2Ffff", name: "writer-2", namespace: DOCS }),
    agent({ id: "AgentWriter3Ffff", name: "writer-3", namespace: DOCS }),
  ]);
  await screen.findByRole("radio", { name: /^github\.com\/acme\/docs\b/ });
  expect(within(chips()).getAllByRole("radio")[0]).toHaveAttribute(
    "title",
    DOCS,
  );
  expect(chip(/^github\.com\/acme\/app\b/)).toBeChecked();
  expect(nsRows()[0]).toContain("claude-1");
});

const statusCell = (row: string) => {
  const table = screen.getByRole("table", { name: NS_TABLE });
  const el = within(table)
    .getAllByRole("row")
    .find((r) => r.textContent?.includes(row));
  if (!el) throw new Error(`no row ${row}`);
  return el;
};

test("the status column is tagged agent says; blocked, its label and its age show", async () => {
  mount();
  await screen.findByText("claude-1");
  const table = screen.getByRole("table", { name: NS_TABLE });
  expect(
    within(table).getByRole("columnheader", { name: "Status, agent says" }),
  ).toBeInTheDocument();
  expect(table.querySelector("th [data-agent-says-tag]")).toHaveTextContent(
    "agent says",
  );
  await push([
    agent({
      id: CLAUDE.id,
      name: "claude-1",
      status: "blocked",
      statusLabel: "waiting on CI",
      statusAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    }),
  ]);
  await waitFor(() =>
    expect(statusCell("claude-1")).toHaveTextContent("Blocked"),
  );
  const row = statusCell("claude-1");
  expect(row).toHaveTextContent("waiting on CI");
  expect(row).toHaveTextContent("3 min ago");
  const pill = row.querySelector("[data-variant='agent-says']");
  // AT hears "agent says: Blocked" once: in the pill, never the mobile prefix.
  expect(pill).toHaveTextContent("agent says: Blocked");
  expect(pill?.querySelector(".sr-only")).toHaveTextContent("agent says:");
  expect(pill?.className).toContain("border-dashed");
  const prefix = within(pill?.closest("td") as HTMLElement).getByText(
    "Status (agent says)",
  );
  expect(prefix.closest("[aria-hidden='true']")).not.toBeNull();
});

test("waiting_on_owner reads Waiting on you; no status reads None; unknown shows its token", async () => {
  mount();
  await screen.findByText("claude-1");
  await push([
    agent({ id: CLAUDE.id, name: "claude-1", status: "waiting_on_owner" }),
    agent({ id: "AgentExtra3Fffff", name: "bare", status: undefined }),
  ]);
  await waitFor(() =>
    expect(statusCell("claude-1")).toHaveTextContent("Waiting on you"),
  );
  const bare = statusCell("bare");
  expect(within(bare).getByLabelText("No status")).toHaveTextContent("None");
});

test("a status label is text, wraps, and a feed frame updates the cell without a refetch", async () => {
  const bus = mount();
  await screen.findByText("claude-1");
  const gets = countAgentGets(bus);
  const long = "x".repeat(64);
  await push([
    agent({
      id: CLAUDE.id,
      name: "claude-1",
      status: "working",
      statusLabel: "<b>x</b>",
      statusAt: new Date().toISOString(),
    }),
  ]);
  await waitFor(() =>
    expect(statusCell("claude-1")).toHaveTextContent("<b>x</b>"),
  );
  const row = statusCell("claude-1");
  expect(row.querySelector("b")).toBeNull();
  await push([
    agent({
      id: CLAUDE.id,
      name: "claude-1",
      status: "idle",
      statusLabel: long,
      statusAt: new Date().toISOString(),
    }),
  ]);
  await waitFor(() => expect(statusCell("claude-1")).toHaveTextContent("Idle"));
  const cell = within(statusCell("claude-1")).getByText(long).parentElement;
  expect(cell?.className).toContain("[overflow-wrap:anywhere]");
  expect(gets.seen.gets).toBe(0);
  await gets.release();
});

// The wire schema holds the state to the known four, so a newer server's
// token cannot arrive through a frame; the cell still shows it as-is.
test("StatusCell renders an unknown state as its raw token", () => {
  render(<StatusCell agent={agent({ status: "zz" as Agent["status"] })} />);
  expect(screen.getByText("zz")).toHaveAttribute("data-variant", "agent-says");
});

test("the status cell has an aria-hidden mobile prefix", async () => {
  mount();
  await screen.findByText("claude-1");
  const prefix = within(statusCell("claude-1")).getByText(
    "Status (agent says)",
  );
  expect(prefix).toHaveAttribute("aria-hidden", "true");
  expect(prefix).toHaveClass("md:hidden");
});

test("a status with an age and no label shows no leading dot", async () => {
  mount();
  await screen.findByText("claude-1");
  push([
    agent({
      id: CLAUDE.id,
      name: "claude-1",
      status: "idle",
      statusLabel: undefined,
      statusAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    }),
  ]);
  await waitFor(() =>
    expect(statusCell("claude-1")).toHaveTextContent("3 min ago"),
  );
  expect(statusCell("claude-1")).not.toHaveTextContent("·");
});
