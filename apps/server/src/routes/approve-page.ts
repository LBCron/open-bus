import { AUTH, R } from "@ob/shared";
import type { Env } from "../env.js";
import { appOrigin } from "../http/errors.js";

/**
 * The approval page and its edge states, server-rendered from Design's D3
 * template (design/screens/device-approval.html and edge-pages.html). No
 * JavaScript, no external requests, styles inlined; under 8 KB (size.test.ts).
 *
 * Every interpolated value goes through `esc`, attributes and text alike.
 * Host, email and switch_url come from configuration (APP_HOST, OWNER_EMAIL),
 * never from the request. The CLI sends no version, so the template's
 * {{client_version}} is left out.
 */
const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ESC[ch] as string);

export const STYLE = `:root{color-scheme:light dark;--background:#eef0f3;--foreground:#15181c;--card:#fff;--secondary:#f6f7f9;--muted-foreground:#5f6670;--accent:#eceef1;--border:#e0e3e8;--input:#848b95;--ring:#2350d0;--warn:#8a5a00;--warn-soft:#fbf0d9}@media (prefers-color-scheme:dark){:root{--background:#131518;--foreground:#e9ebee;--card:#1c1f23;--secondary:#212429;--muted-foreground:#9097a1;--accent:#181a1e;--border:#2c3037;--input:#676e78;--ring:#7f9cff;--warn:#e7b44f;--warn-soft:#352914}}*,::after,::before{box-sizing:border-box;margin:0;padding:0;border:0 solid var(--border)}body{min-height:100vh;display:flex;flex-direction:column;background:var(--background);color:var(--foreground);font:15px/1.5 "Geist",system-ui,sans-serif}button{font:inherit;cursor:pointer}svg{display:block;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}.mono,code{font-family:"Geist Mono",ui-monospace,Menlo,monospace}header{min-height:56px;padding:8px 16px;background:var(--secondary);border-bottom-width:1px;font-weight:600;font-size:16px}header span{margin-left:auto;font-weight:400;font-size:13px;color:var(--muted-foreground);text-align:right;overflow-wrap:anywhere;min-width:0}main{flex:1;padding:40px 16px 72px}main>*{width:100%;max-width:448px;overflow-wrap:anywhere}.client{padding:10px 12px;border-radius:6px;background:var(--secondary);border-width:1px}b{display:block;font-weight:500;color:var(--foreground)}small{display:block;color:var(--muted-foreground);font-size:13px}li{display:flex;gap:8px;padding:12px 0;border-bottom-width:1px}li:before{content:"✓";color:var(--ring)}li.no:before{content:"×";color:var(--muted-foreground)}.who{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:13px;color:var(--muted-foreground);margin:16px 0}.who button{margin-left:auto;color:inherit;background:none;font-size:inherit;text-decoration:underline}a[data-slot=button]{text-decoration:none}.flex{display:flex}.inline-flex{display:inline-flex}.grid{display:grid}.flex-col{flex-direction:column}.items-center{align-items:center}.justify-center{justify-content:center}.justify-end{justify-content:flex-end}.gap-2{gap:8px}.gap-6{gap:24px}.px-4{padding-inline:16px}.px-6{padding-inline:24px}.py-2{padding-block:8px}.py-6{padding-block:24px}.h-9{height:36px}.h-px{height:1px}.w-full{width:100%}.rounded-md{border-radius:6px}.rounded-xl{border-radius:12px}.border{border-width:1px}.border-input{border-color:var(--input)}.bg-background{background:var(--background)}.bg-card{background:var(--card)}.bg-border{background:var(--border)}.bg-primary{background:var(--foreground)}.text-primary-foreground{color:var(--background)}.text-muted-foreground{color:var(--muted-foreground)}.shadow-sm{box-shadow:0 1px 3px 0 #0000001a,0 1px 2px -1px #0000001a}.shadow-xs{box-shadow:0 1px 2px 0 #0000000d}.text-sm{font-size:14px;line-height:1.429}.text-xl{font-size:20px;line-height:1.4}.text-center{text-align:center}.leading-none{line-height:1}.font-medium{font-weight:500}.font-semibold{font-weight:600}:focus-visible{outline:2px solid var(--ring);outline-offset:2px}.hover\\:bg-primary\\/90:hover{background:color-mix(in oklab,var(--foreground) 90%,transparent)}.hover\\:bg-accent:hover{background:var(--accent)}@media (prefers-color-scheme:dark){.dark\\:bg-input\\/30{background:color-mix(in oklab,var(--input) 30%,transparent)}.dark\\:hover\\:bg-input\\/50:hover{background:color-mix(in oklab,var(--input) 50%,transparent)}}@media (max-width:480px){main{padding:24px 16px 48px}[data-slot=button]{flex:1}}`;

/** Rules only the approval form uses (its `code` chips and warning note), kept out of the other pages' 8 KB. */
const APPROVE_STYLE = `code{padding:1px 5px;border-radius:4px;background:var(--card);border-width:1px;font-weight:500;white-space:nowrap}.note{display:flex;gap:8px;padding:10px 12px;border-radius:6px;background:var(--warn-soft);font-size:13px}.note svg{color:var(--warn);margin-top:2px}`;

/** Configuration-derived values shared by every state. */
export type PageBase = { busHost: string; userEmail: string };

export function pageBase(env: Pick<Env, "APP_HOST" | "OWNER_EMAIL">): PageBase {
  return { busHost: env.APP_HOST, userEmail: env.OWNER_EMAIL };
}

/**
 * "Not you?": the action of a same-origin form POST to logout in its
 * then=login mode, which signs out (logout's origin and session checks
 * apply) and 303s to sign-in with next = this approval page. A POST, not a
 * link, because signing out is a mutation. Built from APP_HOST only.
 */
export function switchUrl(
  env: Pick<Env, "APP_HOST">,
  userCode: string,
): string {
  return `${appOrigin(env)}${AUTH.logout}?then=login&next=${encodeURIComponent(R.approve(userCode))}`;
}

/**
 * same-origin, not no-referrer (FE9): under no-referrer a browser sends
 * `Origin: null` on this page's form POSTs, and logout's isSameOrigin refuses
 * a null Origin (403), so "Not you?" broke in Chromium and WebKit. same-origin
 * still sends no referrer to any other origin. Also sent as a header (approve.ts).
 */
export const REFERRER_POLICY = "same-origin";

export function shell(
  v: PageBase,
  title: string,
  main: string,
  style = "",
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="${REFERRER_POLICY}">
<title>${esc(title)} · OpenBus</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<meta name="theme-color" content="#EEF0F3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131518" media="(prefers-color-scheme: dark)">
<style>
${STYLE}${style}
</style>
</head>
<body><header class="flex items-center gap-2"><svg width="22" viewBox="-9.25 0 18.5 18.5" aria-hidden="true"><path d="M0 7.3v-.6M-2.6 11.8l-.5.3M2.6 11.8l.5.3"/><circle cy="10.3" r="2.25"/><circle cy="3.9" r="2"/><circle cx="-5.5" cy="13.5" r="2"/><circle cx="5.5" cy="13.5" r="2"/></svg>OpenBus<span class="mono"><bdi>${esc(v.busHost)}</bdi></span></header>${main}</body></html>`;
}

export type ApproveView = PageBase & {
  userCode: string;
  label: string;
  /** How long ago the code was requested (hub clock), for "Requested N minutes ago". */
  ageMs: number;
  csrf: string;
  formAction: string;
  switchUrl: string;
};

/**
 * adv-B4 L4: when the code was requested, next to the attacker-chosen label,
 * so an approval that does not match what the owner just ran stands out.
 */
export function requestedAgo(ageMs: number): string {
  const min = Math.floor(Math.max(0, ageMs) / 60_000);
  if (min < 1) return "Requested just now";
  return min === 1 ? "Requested 1 minute ago" : `Requested ${min} minutes ago`;
}

/** D3: the pending code's approve / deny form. */
export function renderApprove(v: ApproveView): string {
  return shell(
    v,
    `Approve ${v.label}`,
    `<main class="flex items-center justify-center"><form data-slot="card" class="flex flex-col gap-6 rounded-xl border bg-card py-6 shadow-sm" method="post" action="${esc(v.formAction)}"><input type="hidden" name="csrf" value="${esc(v.csrf)}"><div data-slot="card-header" class="grid gap-2 px-6"><div class="client"><b class="mono"><bdi>${esc(v.label)}</bdi></b><small>open-bus · code <code>${esc(v.userCode)}</code> · ${esc(requestedAgo(v.ageMs))}</small></div><h1 data-slot="card-title" class="leading-none font-semibold text-xl">Approve <bdi>${esc(v.label)}</bdi>?</h1><p data-slot="card-description" class="text-sm text-muted-foreground">If you approve, this machine joins your bus as you:</p></div><div data-slot="card-content" class="px-6"><div data-slot="separator" role="none" data-orientation="horizontal" class="bg-border h-px w-full"></div><ul><li><p><b>Register agents on your bus</b><small>Its agents join their namespaces and show up in every roster there.</small></p></li><li><p><b>Send and receive messages as those agents</b><small>Each message carries the agent's attested identity, never a name it claims itself.</small></p></li><li><p><b>Stay connected until you revoke it</b><small>The token is long-lived and kept on that machine only.</small></p></li></ul><div class="who">Signed in as <b><bdi>${esc(v.userEmail)}</bdi></b><button type="submit" form="switch">Not you?</button></div><div class="note" role="note"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h.01"/></svg><span>Only approve if you just ran npx @open-bus/cli on <bdi>${esc(v.label)}</bdi> and it shows the code <code>${esc(v.userCode)}</code>.</span></div></div><div data-slot="card-footer" class="flex items-center px-6 gap-2 justify-end"><button data-slot="button" data-variant="outline" class="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 border border-input bg-background shadow-xs hover:bg-accent dark:bg-input/30 dark:hover:bg-input/50" type="submit" name="decision" value="deny">Deny</button><button data-slot="button" data-variant="default" class="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90" type="submit" name="decision" value="approve">Approve</button></div><small class="px-6 text-center">You can revoke this machine anytime in Machines.</small></form><form id="switch" method="post" action="${esc(v.switchUrl)}"></form></main>`,
    APPROVE_STYLE,
  );
}

/** An edge state from edge-pages.html: a card with no form. `body` is trusted markup. */
function edge(v: PageBase, title: string, body: string): string {
  return shell(
    v,
    title,
    `<main class="flex items-center justify-center"><div data-slot="card" class="flex flex-col gap-6 rounded-xl border bg-card py-6 shadow-sm"><div data-slot="card-header" class="grid gap-2 px-6"><h1 data-slot="card-title" class="leading-none font-semibold text-xl">${esc(title)}</h1><p data-slot="card-description" class="text-sm text-muted-foreground">${body}</p></div><small class="px-6 text-center">You can close this tab.</small></div></main>`,
  );
}

/**
 * The one error state for an unknown, expired, decided or redeemed code:
 * identical bytes in every case, so the page never reveals whether a code exists.
 */
export const renderGone = (v: PageBase): string =>
  edge(
    v,
    "This code expired",
    "This code expired or was already used. Run npx @open-bus/cli on the machine again to get a new one.",
  );

export const renderDenied = (v: PageBase & { label: string }): string =>
  edge(
    v,
    "Machine not approved",
    `<bdi>${esc(v.label)}</bdi> was not added to your bus. Nothing was connected.`,
  );

/** The session hit the failed-approval cap (or the per-IP limit). */
export const renderLimited = (v: PageBase): string =>
  edge(
    v,
    "Too many attempts",
    "Too many codes were tried from this session. Wait a few minutes, then open the link open-bus printed again.",
  );
