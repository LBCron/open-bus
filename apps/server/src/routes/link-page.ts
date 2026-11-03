import { esc, type PageBase, shell } from "./approve-page.js";

/**
 * The /link confirm page and its error page (AC6.5). Same shell and card as the
 * approval page: no JavaScript, no external requests, under 8 KB. `aud` comes
 * from the request, so it goes through `esc` and is shown as text in <code>,
 * never as a link. The error page echoes nothing from the request.
 */
const BTN =
  "inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2";

export function renderLinkConfirm(
  v: PageBase & { aud: string; action: string; csrf: string },
): string {
  const aud = esc(v.aud);
  return shell(
    v,
    `Link ${v.aud}?`,
    `<main class="flex items-center justify-center"><form data-slot="card" class="flex flex-col gap-6 rounded-xl border bg-card py-6 shadow-sm" method="post" action="${esc(v.action)}"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><div data-slot="card-header" class="grid gap-2 px-6"><h1 data-slot="card-title" class="leading-none font-semibold text-xl">Let ${aud} verify your agents&#39; cards?</h1><p data-slot="card-description" class="text-sm text-muted-foreground"><code>${aud}</code> will be able to check cards your agents present, signed by <bdi>${esc(v.busHost)}</bdi>. A card names the agent, its machine, and what the agent says it is doing. It never includes your email or namespaces.</p></div><div data-slot="card-content" class="px-6"><div class="who">Signed in as <b><bdi>${esc(v.userEmail)}</bdi></b></div></div><div data-slot="card-footer" class="flex items-center px-6 gap-2 justify-end"><button data-slot="button" data-variant="outline" class="${BTN} border border-input bg-background shadow-xs hover:bg-accent dark:bg-input/30 dark:hover:bg-input/50" type="submit" name="decision" value="cancel">Cancel</button><button data-slot="button" data-variant="default" class="${BTN} bg-primary text-primary-foreground hover:bg-primary/90" type="submit" name="decision" value="allow">Allow</button></div><small class="px-6 text-center">You can unlink it any time in Settings.</small></form></main>`,
  );
}

const ERRORS = {
  bad_request: [
    "This link request isn't valid",
    "Start again from the app's settings.",
  ],
  expired: [
    "This link request expired",
    "Requests last 10 minutes. Start again from the app's settings.",
  ],
} as const;

export function renderLinkError(
  v: PageBase,
  reason: "bad_request" | "expired",
): string {
  const [title, body] = ERRORS[reason];
  return shell(
    v,
    title,
    `<main class="flex items-center justify-center"><div data-slot="card" class="flex flex-col gap-6 rounded-xl border bg-card py-6 shadow-sm"><div data-slot="card-header" class="grid gap-2 px-6"><h1 data-slot="card-title" class="leading-none font-semibold text-xl">${esc(title)}</h1><p data-slot="card-description" class="text-sm text-muted-foreground">${esc(body)}</p></div><small class="px-6 text-center">You can close this tab.</small></div></main>`,
  );
}
