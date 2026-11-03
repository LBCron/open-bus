# Screens (Track D)

High-fidelity screens in the Studio direction (`design/DIRECTION.md`). Frontend matches
`machines.html`, `live.html` and `settings.html`; Backend renders `device-approval.html`,
`link-confirm.html` and the states in `edge-pages.html`; the client track implements
`../cli/transcript.md`.

## How to view

Open the file in a browser (`file://…/design/screens/machines.html`), or run `npx serve` from
the repo root and open `http://localhost:3000/design/screens/<file>`. Use the server if your
browser blocks the relative `tokens.css` link on `file://`. Every screen except
`device-approval.html` and `link-confirm.html` (which follow `prefers-color-scheme` only,
because they have no JavaScript) reads `?theme=light|dark`, plus the params below, and
carries OA's `Mockup controls` pill bar at the bottom with the same choices, so the artifacts published to
artifacts.leourbina.com are fully explorable without query strings.

Each screen is designed for 1280 px and 390 px wide, with no horizontal page scroll.

## Screens

| File                   | Screen                             | Params                                                                                                                                                          | Notes                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device-approval.html` | Device approval (Worker template)  | none                                                                                                                                                            | No JS, inlined tokens, under 8 KB. Backend substitutes the placeholders in its header comment.                                                                                                                                |
| `edge-pages.html`      | Expired, approved, denied, not-you | `state=expired\|approved\|denied\|not-you`                                                                                                                      | Renders every state at once when the param is omitted. Unknown codes render as `expired`.                                                                                                                                     |
| `machines.html`        | Machines                           | `theme`, `state=default\|empty\|loading\|error`, `menu=none\|row\|confirm`, `toast=none\|revoked`                                                               | shadcn markup; CSS is `machines.css` from `pnpm --filter @ob/ui build:screens`. Status is `StatusBadge` from `@ob/ui/composites`.                                                                                             |
| `live.html`            | Live agents and namespaces         | `theme`, `state=default\|empty\|loading\|error\|paused`, `ns=openbus\|medical-wiki\|global`, `filter=none\|live\|queued`, `status=default\|none\|long\|unknown` | shadcn markup; CSS is `live.css` from the same build. Reachable is `StatusBadge` `live`, `queued` (agent `state`); closed sessions are not listed. Status (D16) is the agent-says column: a dashed outline Badge, never fact. |
| `settings.html`        | Settings: Linked apps              | `theme`, `state=default\|empty\|loading\|error`, `menu=none\|confirm`, `toast=none\|unlinked`                                                                   | D16. shadcn markup; CSS is `settings.css` from the same build. Each `aud` whole, mono, in `<bdi>`, never a link; samples include a punycode origin and one with a port.                                                       |
| `link-confirm.html`    | Link confirm (Worker template)     | none                                                                                                                                                            | D16. No JS, inlined tokens, under 8 KB at max placeholder lengths (measured size in its header comment). Posts `decision=allow\|cancel`.                                                                                      |

## Shared rules

- Colors come only from `../../packages/ui/src/tokens/tokens.css`. Screens add no new color.
- Copy has no em dashes. Machine labels, agent names and codes use the mono stack.
- Status is never color alone: every badge has a word and a dot.
