# @ob/dashboard

The OpenBus dashboard: two routes, machines (with revoke) and the live agents/namespaces view.
- `pnpm dev`: Vite on :5173; `vite.config.ts` proxies `/api` and `/auth` to :8787 (`wrangler dev`).
- `VITE_MOCK=1 pnpm dev`: no server. MSW serves the `@ob/shared/mocks` fixtures; `window.__obMock` pushes roster frames (used by e2e). A production build refuses `VITE_MOCK=1`.
- `pnpm test`: vitest (node + jsdom).
- `pnpm test:e2e`: Playwright (chromium + webkit) against Vite with `VITE_MOCK=1`; set `E2E_PORT` to change the port.
- All UI comes from `@ob/ui` (shadcn superset). Style import order: `fonts.css`, `tokens.css`, `shadcn.css`.

The approval page is the Worker's (Backend); the landing page is `apps/landing` (Design).

## Real-server smoke

`pnpm test:real` runs `e2e/real` (chromium and webkit) against a real Worker; nothing is mocked. `OB_E2E_BASE` sets the target (default `https://127.0.0.1:8787`). The mocked `pnpm test:e2e` never picks these up.
- Local (default; also CI): `pnpm test:real` starts the Worker itself through the config's `webServer` (`e2e/real/serve.mjs`): it builds `@ob/shared` and the dashboard, then runs the server's own `dev:e2e` (`wrangler.e2e.jsonc`, loopback only, never deployed) after `dev:e2e:reset`, with `--local-protocol https` on `https://127.0.0.1:8787` and `ENVIRONMENT=dev` placeholder vars and the built dashboard as `--assets` layered on as CLI flags. It listens on 8787 only (the script fixes the port). https is needed because the Worker's origin checks and the "Not you?" form want `https://APP_HOST`; Playwright trusts the self-signed cert on loopback. Outside CI an already-running server on that URL is reused. `E2E_NOT_YOU=1` also runs `not-you` here: each run leaves one pending device code (10 min cap), so restart the server if it 429s.
- Staging: set `E2E_STORAGE_STATE` to a storageState file from one real Access login (`~/.openbus/e2e-staging-state.json`, shared with I7; never commit or print it). Optional: `E2E_OWNER_EMAIL`, `E2E_ACCESS_TEAM_DOMAIN`.
- `smoke.spec.ts` is read-only and safe on staging. It checks `/api/v1/me`, the Machines page and live stream, the Agents page (summary, and the "Status (agent says)" column once there are rows), `/api/v1/linked-apps` (parses as `{ apps }`), Settings › Linked apps (empty state or rows, never the "aren't available" note or a load error), and `GET /link` with a malformed request (400 error page, echoes none of the request values; never a valid request or POST), all with no console errors or CSP violations.
- `not-you.spec.ts` is destructive: logout signs out everywhere (#154), so it kills the shared storage state for every browser and for I7. It is skipped unless `E2E_NOT_YOU=1`. Chromium only (it applies form-action to redirects; each run consumes the owner's login): run `--project chromium`; webkit skips it. It leaves its device code unapproved.
