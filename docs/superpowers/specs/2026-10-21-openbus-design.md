# OpenBus: design

Status: approved 2026-10-21. The builder check ran the same day, and all of its questions are resolved below. Repo: https://github.com/open-artifacts-ai/open-bus Designed page: https://artifacts.leourbina.com/a/wWN32sUbZpMefFzz

Provenance tags: **[user]** decided by the user; **[call]** the manager's call, from research (the user can override); **[risk]** unverified.

## Intent

Connect all of one person's AI coding agents, on any machine and in any harness, so they can see each other and message each other. Harnesses first: Claude Code, OpenCode (v2), and Pi. **[user]**

It extends agent-bus (`~/code/projects/agent-bus`), which works only on a single machine. OpenBus is a new TypeScript project, not a port. agent-bus's lessons carry over; its code does not. **[user]**

## Goals

1. An agent on any authorized machine appears in the roster for its namespace and can message any agent there. **[user]**
2. Adding a machine takes as little friction as possible: run `npx open-bus`, approve in the browser that opens, and the MCP server, plugin or extension is configured globally for every harness found. **[user]**
3. Self-hosted: each person deploys OpenBus to their own Cloudflare account, following the open-artifacts pattern. Their agent reads `llms.txt` and runs `npx wrangler login` itself, so the user only approves in a browser. **[user]**
4. Messages arrive in full, in the receiving agent's conversation. Only a message over the size cap arrives as a notice plus fetch-by-id. **[user]**
5. Namespaces (projects) inside an owner. An agent sees and reaches only its own namespace. Some agents are global. **[user]**

## Non-goals (for now)

- Organizations or sharing agents between people. This is planned for later, and the data model must not block it. **[user]**
- Message history or search. **[user]**
- Headless sessions (`opencode run`). Harnesses beyond Claude Code, OpenCode and Pi.
- A hosted, multi-tenant service. **[user]**

## Anti-goals (failures even if it "works")

- Two sessions sharing an identity, or seeing each other's mail or replies. This is the lesson from agent-bus's OpenCode v2 work.
- A sender choosing its own name through tool arguments (agent-bus #156). Identity always comes from what the harness and daemon attest.
- Waking a closed OpenCode session and spending tokens.
- A receipt that says "delivered" when the message wasn't.
- Treating a message from another agent as the user's consent to act.

## Architecture (option A) **[user]**

- **Worker:** login, device approval, the dashboard and landing assets, and routing of each WebSocket upgrade to the owner's hub.
- **Hub Durable Object, one per owner** (later one per org), on SQLite, using the WebSocket Hibernation API. It holds:
  - the roster and presence
  - namespaces and global agents
  - machine tokens, stored as sha256 hashes
  - in-flight mail
- **Daemon, one per machine:** holds one WebSocket to the hub and one machine token. It owns local identity, liveness and per-harness delivery. Thin per-session adapters talk to it over a local socket, and MCP servers never connect to the cloud directly. **[call]**
- **Not used:** the Agents SDK (its state broadcast doesn't fit namespace isolation), D1, KV, R2 and Queues. D1 comes back later as a directory mapping orgs to hubs. **[call]**
- **Scaling escape hatch:** option C, one Durable Object per machine plus one per namespace, for an org above about 1,000 messages a second. To keep that path open **[call]**:
  - tag every row with `org_id` and `namespace` from day one
  - keep routing behind one "deliver to agent X" interface
- Option B is rejected: it adds a hop to every message and doesn't raise the throughput ceiling.

### Login **[user]** + **[call]**

Cloudflare Access is used as an OIDC identity provider only (a SaaS app, as open-artifacts does), not as a proxy in front of the Worker.

1. `npx open-bus` asks the Worker for a device code and opens `/approve/<code>` in the browser. With no browser, it prints the URL and code instead.
2. The user signs in through Access (the Worker's OIDC callback, which honours `next`) and approves the machine on a page the Worker renders, as open-artifacts' consent page is.
3. The CLI polls and receives a long-lived `ob_machine_<random>` token. The hub stores only its hash, together with a label, `last_used` and `revoked_at`.
4. The daemon opens its WebSocket with that bearer token. Revoking the token closes that machine's sockets.

Setup needs a Cloudflare API token with "Access: Apps and Policies: Edit", because `wrangler login` can't create Access apps. Use open-artifacts' pre-filled dashboard link and hidden-input flow. **[risk: friction]**

### Messages and retention

- A message is delivered in full. The size cap for inline delivery is the builder's call, around 32 KB. Anything larger arrives as a notice plus fetch. The hard maximum is 1 MB, below SQLite's 2 MB row limit, so no R2 is needed. **[user]** / **[call]**
- A message is deleted once it's delivered, meaning the daemon confirmed the harness accepted it. Undelivered mail expires after **1 hour** and the sender is told. **[user]**
- Each inbox holds at most 50 undelivered messages; past that, sends are refused with "inbox full". Mirrors agent-bus. **[call]**
- Write on miss: if the recipient's machine is connected, the hub pushes and holds the message in memory until the daemon acks. Only on a miss or ack timeout does it write the message to SQLite. Receipts stay `pending` until the ack. **[call]**
- Receipts: `pending | delivered | expired | refused(reason)`. Sending to an agent that has never existed is refused, not queued.
- An agent reads only its own inbox.

### Namespaces **[call]**

- An agent's namespace defaults to its git root's remote URL, normalized so the same repo on two machines is one namespace. The fallback is the git root's directory name, then the cwd. It can be overridden in config.
- Global is an explicit setting, never a default. A global agent sees and reaches every namespace, and any agent can message a global one.
- The namespace can be set by a `.openbus.json` (`{"namespace": "..."}`) in the directory, or any parent, where the session starts. This works for every harness, including Claude, which has no OpenBus config of its own. **[call]**
- Global comes only from the user's own allowlist on each machine, `~/.openbus/global.json`, managed with `npx @open-bus/cli global add|rm|list`. A directory and its subdirectories are global when the list names it. A `global` key in `.openbus.json` is still parsed but ignored, with a warning: anyone who can write to a repo, such as the author of a clone, could otherwise widen what its agents see (C19). A session reads the list when it registers, so a change applies when the session restarts. A dashboard toggle can come later. **[call]**

### Data model **[call]**

Every row carries `org_id`, which for now is the owner. The tables:

- `machines(id, org_id, label, token_hash, created_at, last_used, revoked_at)`
- `agents(id, org_id, namespace, name, kind, machine_id, native_ref, global, last_name, live, updated_at)`
- `mail(id, org_id, namespace, to_agent, from_agent, body, created_at, expires_at)`

Names are unique per namespace. **[call]**
- The hub owns the bus name. If the name a harness proposes (Claude's session name, or an OpenCode or Pi `register`) is taken, the hub assigns `<name>-2`, `-3` and so on, as agent-bus does. The agent learns its bus name from `self`. Inbound frames show the sender's bus name, so replies route by bus name.
- A closed session's name is freed, and reclaimed when the session reopens if still free.
- Address-shaped names are rejected.

Queue or refuse **[call]**:
- If the recipient is registered and the daemon last reported it open, but its machine is disconnected, the message is **queued** (1 h).
- If the daemon reports the recipient closed (TUI closed, Claude process gone, Pi shutdown), the message is **refused**.
- On reconnect the daemon reports which sessions are open and which closed. Queued mail for closed sessions expires at once, and each sender gets `expired: recipient closed`.
- Mail isn't kept for a session that is reopened later.

## Per-harness delivery

| Harness | Sends | Woken by | Identity |
|---|---|---|---|
| Claude Code | **[user]** An OpenBus MCP server, installed globally, provides namespace-scoped `list_agents`, `send_message`, `fetch` and `self`. Native `SendMessage` is not used to reach remote peers. | The daemon dials the Claude session's own UDS socket and injects the frame natively, with a per-peer return socket so that native replies route back. No published fake peers and no per-peer processes. | `~/.claude/sessions/<pid>.json`, pid + `procStart`; the MCP server finds its session through its ancestor pid |
| OpenCode v2 | An MCP tool on the shared service MCP server. The session comes from `_meta["ai.opencode/sessionID"]` on each call and maps to its root via `parentID`. | The daemon runs `opencode api session.prompt` with `delivery:"queue"`, only while a TUI plugin's presence file lists the session. | Presence files plus a pid-reuse guard |
| Pi | Extension tool, or Pi's built-in MCP via `registerMcpServer` (re-registered on every load). | `pi.sendMessage(..., {triggerTurn, deliverAs})` from the extension | `sessionManager.getSessionId()`, `ctx.cwd` |

All of agent-bus's OpenCode v2 learnings apply (`agent-bus/docs/superpowers/specs/2026-10-21-opencode-session-peers-design.md`, commit 6cb47db). The shared MCP server must never crash, and setup must run `opencode service restart`.

**Why Claude doesn't use native `SendMessage` for remote peers.** Claude builds `ListAgents` from every file in `~/.claude/sessions/`, with no per-session filter. Publishing remote peers as local session files therefore has two problems:
- Every Claude session on the machine would see the agents of every namespace hosted there, which breaks namespace isolation.
- Each published peer needs its own live pid with a matching `procStart`.

The chosen design **[user]** avoids both: MCP to list and send, native UDS injection to receive. Native replies to an injected frame still work, through the return socket. `isolatePeerMachines` is assumed off. **[user]**

Oversized messages: the notice names a `fetch` id. Claude fetches with the MCP tool, OpenCode and Pi with theirs. The message is deleted when it's fetched or when it expires. **[call]**

## Tech and ops: mirror open-artifacts **[user]**

The same stack and process as `~/code/projects/openartifacts`:

- **Stack:** a pnpm monorepo on Node 22, with biome, TypeScript and vitest (`@cloudflare/vitest-plugin`). Hono in the Worker. The dashboard uses Vite, React 19, TanStack and Tailwind/shadcn. The landing page uses Astro and serves `llms.txt`.
- **Process:**
  - Conventional Commits
  - one task per branch and PR, never `git stash`, never force-push
  - the merge queue
  - release-please and release cadence, with a staging deploy and a prod deploy, `/healthz` reporting the version, and verify-release
- **Plans:** split as open-artifacts does: `00-overview`, `01-foundation`, `02-backend`, `03-design`, `04-frontend`, `05-integration`. The daemon/CLI is its own plan.
- The leads report the details to copy. Those land in the plans, not here.

## Visual identity **[user]**

Adopt Open Artifacts' "Studio" direction verbatim, from `openartifacts/design/DIRECTION.md`: Geist and Geist Mono, the #EEF0F3/#131518 neutral ramp, accent #2350D0 (#7F9CFF on dark), and 4/6/8 px radii. Tokens are re-prefixed `--ob-*`. There is no mockup round. **[user]** All UI comes from `@ob/ui`, a superset of shadcn: shadcn's components plus OpenBus composites, themed with `--ob-*`. Apps import only from `@ob/ui`. The Worker's no-JS approval page reuses shadcn's markup and classes. **[user]** The whole design language follows open-artifacts.com: a text-led hero with agent tabs, a copyable install-command pill, real product screenshots rather than illustrations, dark code blocks, a direct second-person voice, and Docs, llms.txt and GitHub in the header and footer. The Worker renders the device-approval page with no JS and inlined tokens, under 8 KB.

## Where it runs **[user]**

- **Public:** `open-bus.ai` serves the landing page and `llms.txt`. Anyone self-deploys by pointing their agent at `https://open-bus.ai/llms.txt`.
- **The author's instance:** `bus.leourbina.com`. It's installed through that same `llms.txt` path, which makes it production and scenario 7's check.
- **Staging:** the Worker `open-bus-staging` at **`staging.open-bus.ai`**. **[user]**

## Costs

$0 for one person on Workers Free. About $0.10 a month at 1M messages a day on Paid, plus the $5 minimum. See the designed page for the tables.

## Left to the builder

- The inline-delivery size cap.
- The wire protocol between daemon and hub, and between adapter and daemon.
- Reconnect, backoff and ack timeouts.
- The presence heartbeat interval (use `setWebSocketAutoResponse` pings).
- Dashboard layout, within the Design lead's direction.
- The exact names of packages and binaries.

## Verification (what done looks like)

1. Two machines, a Claude Code session and an OpenCode TUI session, in the same repo. Each sees the other in its roster. A message each way lands in the other's conversation, and the reply comes back to the right session.
2. A second OpenCode session in the same service has its own identity and never sees the first one's mail.
3. Close the OpenCode TUI: sends to it are refused, and nothing is injected.
4. Take a machine offline: mail waits and is delivered on reconnect. After 1 hour it expires and the sender is told.
5. Revoke a machine: its socket closes and its agents leave the roster.
6. An agent in another namespace is invisible and unreachable. A global agent reaches both.
7. A fresh Cloudflare account goes from `llms.txt` to a working bus with only browser approvals from the user.
