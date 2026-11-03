// AC6.5: the /link confirm and error pages (pure renderers).
import { expect, it } from "vitest";
import { renderLinkConfirm, renderLinkError } from "../src/routes/link-page.js";

const base = { busHost: "bus.example", userEmail: "me@example.com" };
const confirm = (aud: string) =>
  renderLinkConfirm({ ...base, aud, action: "/link", csrf: "tok123" });
const bytes = (s: string) => new TextEncoder().encode(s).length;

it("renders the confirm page", () => {
  const html = confirm("https://oa.example");
  expect(html).toContain(
    "Let https://oa.example verify your agents' cards?".replace("'", "&#39;"),
  );
  expect(html).toContain("me@example.com");
  expect(html).toContain('method="post" action="/link"');
  expect(html).toContain('<input type="hidden" name="csrf" value="tok123">');
  expect(html).toContain('name="decision" value="allow">Allow<');
  expect(html).toContain('name="decision" value="cancel">Cancel<');
  expect(html).toContain("<code>https://oa.example</code>");
  expect(html).toContain("You can unlink it any time in Settings.");
  expect(html).toContain(
    "A card names the agent, its machine, and what the agent says it is doing.",
  );
  expect(html).not.toContain("machine and role");
});

it("escapes aud and never links it", () => {
  const html = confirm('https://a"><script>');
  expect(html).not.toContain("<script");
  expect(html).toContain("https://a&quot;&gt;&lt;script&gt;");
  expect(html).not.toMatch(/<a[\s>]/);
  expect(html).toContain("<title>Link https://a&quot;&gt;&lt;script&gt;?");
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

it("stays under 8 KB", () => {
  expect(bytes(confirm("https://xn--".padEnd(200, "a")))).toBeLessThan(
    8 * 1024,
  );
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
