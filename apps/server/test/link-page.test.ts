// AC6.5: the /link confirm and error pages (pure renderers).

import { R } from "@ob/shared";
import { expect, it } from "vitest";
import {
  linkSwitchUrl,
  renderLinkConfirm,
  renderLinkError,
} from "../src/routes/link-page.js";

const base = { busHost: "bus.example", userEmail: "me@example.com" };
const SWITCH =
  "https://bus.example/auth/logout?then=login&next=%2Flink%2Fconfirm";
const confirm = (aud: string, v: Partial<typeof base> = {}) =>
  renderLinkConfirm({
    ...base,
    ...v,
    aud,
    action: "/link/confirm",
    csrf: "tok123",
    switchUrl: SWITCH,
  });
const bytes = (s: string) => new TextEncoder().encode(s).length;

it("renders Design's 4A confirm page", () => {
  const html = confirm("https://oa.example:8443");
  expect(html).toContain("<title>Link oa.example:8443? · OpenBus</title>");
  expect(html).toContain(
    '<b class="mono"><bdi>https://oa.example:8443</bdi></b><small>asked to link to your bus</small>',
  );
  expect(html).toContain(
    "Let <bdi>oa.example:8443</bdi> verify your agents&#39; cards?",
  );
  expect(html).toContain(
    "When one of your agents shows it a card, it can confirm:",
  );
  expect(html).toContain("<b>The agent&#39;s name, kind and machine</b>");
  expect(html).toContain("<b>What the agent says it&#39;s doing</b>");
  expect(html).toContain(
    '<li class="no"><p><b>Never your email or namespaces</b>',
  );
  expect(html).toContain("Signed in as <b><bdi>me@example.com</bdi></b>");
  expect(html).toContain("<bdi>bus.example</bdi>");
  expect(html).toContain('method="post" action="/link/confirm"');
  expect(html).toContain('<input type="hidden" name="csrf" value="tok123">');
  expect(html).toContain('name="decision" value="allow">Allow<');
  expect(html).toContain('name="decision" value="cancel">Cancel<');
  expect(html).toContain("You can unlink it any time in Settings.");
  expect(html).toContain('li.no:before{content:"×"');
  expect(html).not.toMatch(/\brole\b(?!=)/);
});

it("Not you? is a same-origin form POST to logout, outside the decision form", () => {
  const html = confirm("https://oa.example");
  expect(html).toContain(
    '<button type="submit" form="switch">Not you?</button>',
  );
  expect(html).toContain(
    '</form><form id="switch" method="post" action="https://bus.example/auth/logout?then=login&amp;next=%2Flink%2Fconfirm"></form></main>',
  );
  expect(html).not.toMatch(/<a[\s>]/);
});

it("escapes aud and never links it", () => {
  const html = confirm('https://a.example/"><script>');
  expect(html).not.toContain("<script");
  expect(html).toContain("https://a.example/&quot;&gt;&lt;script&gt;");
  expect(html).not.toMatch(/<a[\s>]/);
  expect(html).toContain("<title>Link a.example? · OpenBus</title>");
});

it("escapes the email and bus host", () => {
  const html = confirm("https://oa.example", {
    busHost: "<b>",
    userEmail: '"><img src=x>',
  });
  expect(html).not.toContain("<img");
  expect(html).toContain("<bdi>&lt;b&gt;</bdi>");
  expect(html).toContain("<bdi>&quot;&gt;&lt;img src=x&gt;</bdi>");
});

it("sets the same-origin referrer policy", () => {
  expect(confirm("https://oa.example")).toContain(
    '<meta name="referrer" content="same-origin">',
  );
  expect(renderLinkError(base, "expired")).toContain(
    '<meta name="referrer" content="same-origin">',
  );
});

it("loads nothing external", () => {
  for (const html of [
    confirm("https://oa.example:8443"),
    renderLinkError(base, "bad_request"),
    renderLinkError(base, "expired"),
  ]) {
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).not.toMatch(/url\(\s*["']?https?:/);
  }
});

it("stays under 8 KB at max placeholder lengths", () => {
  // link-confirm.html: aud 267, aud_host 259, bus_host 253, user_email 254,
  // csrf_token 64; form_action and switch_url as served.
  const label = (n: number) => "a".repeat(n);
  const host = `${[label(63), label(63), label(63), label(61)].join(".")}:65535`;
  expect(host.length).toBe(259);
  const aud = `https://${host}`;
  expect(aud.length).toBe(267);
  const html = renderLinkConfirm({
    busHost: "b".repeat(253),
    userEmail: `${"u".repeat(64)}@${"e".repeat(189)}`,
    aud,
    action: R.linkConfirm,
    csrf: "c".repeat(64),
    // The real one, from a 253-byte APP_HOST (longer than the template's 200).
    switchUrl: linkSwitchUrl({ APP_HOST: "b".repeat(253) }),
  });
  expect(bytes(html)).toBeLessThan(8 * 1024);
  expect(bytes(renderLinkError(base, "expired"))).toBeLessThan(8 * 1024);
});

it("error pages name the reason and no aud", () => {
  const bad = renderLinkError(base, "bad_request");
  expect(bad).toContain("This link request isn&#39;t valid");
  expect(bad).toContain("Start again from the app&#39;s settings.");
  const exp = renderLinkError(base, "expired");
  expect(exp).toContain("This link request expired");
  expect(exp).toContain(
    "Requests last 10 minutes. Start again from the app&#39;s settings.",
  );
});
