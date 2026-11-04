import { AUTH, R } from "@ob/shared";
import type { Env } from "../env.js";
import { appOrigin } from "../http/errors.js";
import { esc, type PageBase, shell } from "./approve-page.js";

/**
 * The /link confirm page (Design's 4A, design/screens/link-confirm.html) and
 * its error page (AC6.5). Same shell and card as the approval page: no
 * JavaScript, no external requests, under 8 KB. `aud` comes from the request,
 * so it goes through `esc` and is shown whole as text, never as a link. The
 * error page echoes nothing from the request.
 */
const BTN =
  "inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2";

/**
 * "Not you?" on the confirm page: as switchUrl (approve-page.ts), a
 * same-origin form POST to logout in then=login mode, back to /link/confirm.
 * The ob_link cookie survives sign-out, so the request is kept.
 */
export function linkSwitchUrl(env: Pick<Env, "APP_HOST">): string {
  return `${appOrigin(env)}${AUTH.logout}?then=login&next=${encodeURIComponent(R.linkConfirm)}`;
}

export function renderLinkConfirm(
  v: PageBase & {
    aud: string;
    action: string;
    csrf: string;
    switchUrl: string;
  },
): string {
  // aud is a validated origin; the host is ASCII (punycode), so the <title> needs no isolation.
  const host = new URL(v.aud).host;
  return shell(
    v,
    `Link ${host}?`,
    `<main class="flex items-center justify-center"><form data-slot="card" class="flex flex-col gap-6 rounded-xl border bg-card py-6 shadow-sm" method="post" action="${esc(v.action)}"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><div data-slot="card-header" class="grid gap-2 px-6"><div class="client"><b class="mono"><bdi>${esc(v.aud)}</bdi></b><small>asked to link to your bus</small></div><h1 data-slot="card-title" class="leading-none font-semibold text-xl">Let <bdi>${esc(host)}</bdi> verify your agents&#39; cards?</h1><p data-slot="card-description" class="text-sm text-muted-foreground">When one of your agents shows it a card, it can confirm:</p></div><div data-slot="card-content" class="px-6"><div data-slot="separator" role="none" data-orientation="horizontal" class="bg-border h-px w-full"></div><ul><li><p><b>The agent&#39;s name, kind and machine</b><small>Signed by your bus, so it can show them as attested.</small></p></li><li><p><b>What the agent says it&#39;s doing</b><small>Marked as reported by the agent, never as fact.</small></p></li><li class="no"><p><b>Never your email or namespaces</b><small>It gets an id for you that only it uses.</small></p></li></ul><div class="who">Signed in as <b><bdi>${esc(v.userEmail)}</bdi></b><button type="submit" form="switch">Not you?</button></div></div><div data-slot="card-footer" class="flex items-center px-6 gap-2 justify-end"><button data-slot="button" data-variant="outline" class="${BTN} border border-input bg-background shadow-xs hover:bg-accent dark:bg-input/30 dark:hover:bg-input/50" type="submit" name="decision" value="cancel">Cancel</button><button data-slot="button" data-variant="default" class="${BTN} bg-primary text-primary-foreground hover:bg-primary/90" type="submit" name="decision" value="allow">Allow</button></div><small class="px-6 text-center">You can unlink it any time in Settings.</small></form><form id="switch" method="post" action="${esc(v.switchUrl)}"></form></main>`,
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
