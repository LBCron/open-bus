import { readFileSync, statSync } from "node:fs";
import { cn } from "cn";
import { describe, expect, it } from "vitest";
import { toggleVariants } from "#shadcn/ui/toggle";

const file = new URL(
  "../../../design/screens/device-approval.html",
  import.meta.url,
);
const html = readFileSync(file, "utf8");

describe("design/screens/device-approval.html is the Worker's template", () => {
  it("is under 8 KB", () => {
    expect(statSync(file).size).toBeLessThan(8192);
  });

  it("has no JavaScript and no external requests", () => {
    expect(html).not.toMatch(/<script|javascript:/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/@import|url\(/);
  });

  it("offers exactly the approved placeholder set", () => {
    const used = [
      ...new Set([...html.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])),
    ].sort();
    expect(used).toEqual([
      "bus_host",
      "client_version",
      "csrf_token",
      "form_action",
      "machine_label",
      "switch_url",
      "user_code",
      "user_email",
    ]);
  });

  it("posts an approve or deny decision with CSRF", () => {
    expect(html).toMatch(/method="post" action="\{\{form_action\}\}"/);
    expect(html).toMatch(/name="csrf" value="\{\{csrf_token\}\}"/);
    expect(html).toMatch(/name="decision" value="deny"/);
    expect(html).toMatch(/name="decision" value="approve"/);
  });

  it("states its own contract in the header comment", () => {
    expect(html).toMatch(/HTML-escape every value/);
    expect(html).toMatch(/prefers-color-scheme only/);
  });

  it("isolates every body machine_label in <bdi>", () => {
    const body = html
      .replace(/<!--.*?-->/s, "")
      .replace(/<title>.*?<\/title>/s, "");
    const all = body.match(/\{\{machine_label\}\}/g) ?? [];
    const isolated = body.match(/<bdi>\{\{machine_label\}\}<\/bdi>/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(isolated.length).toBe(all.length);
  });
});

/** Every class token in a class="" attribute has a selector in the inline <style>. */
function undefinedClasses(page: string): string[] {
  const style = [...page.matchAll(/<style>(.*?)<\/style>/gs)]
    .map((m) => m[1])
    .join("");
  const tokens = new Set(
    [...page.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) =>
      m[1].split(/\s+/).filter(Boolean),
    ),
  );
  return [...tokens].filter((t) => {
    const sel = `.${t.replace(/[^\w-]/g, "\\$&")}`;
    // the selector must end there: next char is not part of a class name
    return !new RegExp(
      `${sel.replace(/[\\.[\]()*+?^$|{}]/g, "\\$&")}(?![\\w-])`,
    ).test(style);
  });
}

describe("design/screens/device-approval.html uses shadcn markup", () => {
  it("stays under 8 KB served: comment stripped, placeholders at max", () => {
    const max: Record<string, string> = {
      machine_label: "m".repeat(128),
      user_email: `${"u".repeat(242)}@example.com`,
      bus_host: "h".repeat(253),
      csrf_token: "c".repeat(64),
      client_version: "v".repeat(16),
      user_code: "XXXX-XXXX",
      form_action: "/approve/XXXX-XXXX",
      switch_url: "s".repeat(200),
    };
    const served = html
      .replace(/^(<!doctype html>\n)<!--.*?-->\n/s, "$1")
      .replace(/\{\{(\w+)\}\}/g, (_, k: string) => max[k]);
    expect(served).not.toMatch(/<!--|\{\{/);
    expect(new TextEncoder().encode(served).length).toBeLessThan(8192);
  });

  it("styles a link Button for the not-you state", () => {
    expect(html).toContain("a[data-slot=button]{text-decoration:none}");
  });

  it("renders a shadcn Card with shadcn Buttons", () => {
    expect(html).toMatch(/data-slot="card"/);
    for (const slot of [
      "card-header",
      "card-title",
      "card-content",
      "card-footer",
    ])
      expect(html).toContain(`data-slot="${slot}"`);
    expect(html.match(/data-slot="button"/g)?.length).toBe(2);
    expect(html).toMatch(
      /data-slot="button" data-variant="outline"[^>]*value="deny"|value="deny"[^>]*data-variant="outline"/s,
    );
  });

  it("defines every class it uses in the inline <style>", () => {
    expect(html).toMatch(/\sclass="/);
    expect(undefinedClasses(html)).toEqual([]);
  });

  it("isolates bus_host and user_email in <bdi>", () => {
    const body = html.replace(/<!--.*?-->/s, "");
    for (const p of ["bus_host", "user_email"]) {
      const all = body.match(new RegExp(`\\{\\{${p}\\}\\}`, "g")) ?? [];
      const iso =
        body.match(new RegExp(`<bdi>\\{\\{${p}\\}\\}</bdi>`, "g")) ?? [];
      expect(all.length).toBeGreaterThan(0);
      expect(iso.length).toBe(all.length);
    }
  });

  it("shows the user code in the anti-phishing note", () => {
    expect(html).toMatch(/role="note">(?:(?!<\/div>).)*\{\{user_code\}\}/s);
  });
});

const edgeFile = new URL(
  "../../../design/screens/edge-pages.html",
  import.meta.url,
);
const edge = readFileSync(edgeFile, "utf8");

describe("design/screens/edge-pages.html uses shadcn markup", () => {
  it("keeps the four states, each in a shadcn Card", () => {
    for (const s of ["expired", "approved", "denied", "not-you"])
      expect(edge).toContain(`data-state="${s}"`);
    expect(edge.match(/data-slot="card"/g)?.length).toBe(4);
    expect(edge).toMatch(
      /data-slot="button"[^>]*href="\{\{switch_url\}\}"|href="\{\{switch_url\}\}"[^>]*data-slot="button"/,
    );
  });

  it("defines every class it uses in the inline <style>", () => {
    expect(undefinedClasses(edge)).toEqual([]);
  });
});

const machinesFile = new URL(
  "../../../design/screens/machines.html",
  import.meta.url,
);
const machines = readFileSync(machinesFile, "utf8");
const rows = [...machines.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map(
  (m) => m[0],
);

describe("design/screens/machines.html (D4)", () => {
  it("links the tokens and its generated Tailwind CSS", () => {
    expect(machines).toContain(
      '<link rel="stylesheet" href="../../packages/ui/src/tokens/tokens.css">',
    );
    expect(machines).toContain('<link rel="stylesheet" href="machines.css">');
    const css = readFileSync(
      new URL("../../../design/screens/machines.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/^\/\* Generated[\s\S]*build:screens/);
  });

  it("uses the shadcn primitives and the StatusBadge markup", () => {
    for (const slot of [
      "sidebar",
      "table",
      "table-row",
      "button",
      "dropdown-menu-content",
      "alert-dialog-content",
      "skeleton",
      "card",
      "avatar",
      "badge",
      "status-badge-dot",
    ])
      expect(machines).toContain(`data-slot="${slot}"`);
    expect(machines).toContain("data-sonner-toaster");
  });

  it("gives every live or offline row a visible Revoke, and revoked rows none", () => {
    const body = rows.filter((r) => r.includes('data-slot="table-cell"'));
    const real = body.filter((r) => !r.includes('data-slot="skeleton"'));
    expect(real.length).toBe(4);
    for (const r of real) {
      const revoked = r.includes('data-status="revoked"');
      expect(r.includes("data-revoke=")).toBe(!revoked);
      if (revoked) expect(r).toMatch(/>Revoked [A-Z][a-z]{2} \d{1,2}, \d{4}</);
    }
    // never hover-only
    expect(machines).not.toMatch(/data-revoke[^>]*(opacity-0|invisible)/);
  });

  it("keeps the summary's live count equal to the Live rows, before and after revoke", () => {
    const live = (variant: "none" | "revoked") =>
      rows.filter(
        (r) =>
          !r.includes('data-slot="skeleton"') &&
          r.includes('data-status="live"') &&
          !r.includes(
            `data-show-toast="${variant === "none" ? "revoked" : "none"}"`,
          ),
      ).length;
    const count = (variant: string) =>
      Number(
        new RegExp(
          `data-show-toast="${variant}" data-live-count="(\\d+)"`,
        ).exec(machines)?.[1],
      );
    expect(count("none")).toBe(live("none"));
    expect(count("revoked")).toBe(live("revoked"));
    expect(machines).toMatch(
      new RegExp(
        `data-live-count="${live("none")}"><span[^>]*>${live(
          "none",
        )}</span> live`,
      ),
    );
  });

  it("wraps the first cell explicitly, as TableCell needs through cn", () => {
    const first = rows
      .filter((r) => r.includes('<bdi class="font-mono'))
      .map(
        (r) => /<td data-slot="table-cell" class="([^"]*)"/.exec(r)?.[1] ?? "",
      );
    expect(first.length).toBe(4);
    for (const td of first) expect(td).toContain("whitespace-normal");
  });

  it("names the machine in the confirm dialog, modal, with Cancel", () => {
    expect(machines).toMatch(/role="alertdialog" aria-modal="true"/);
    expect(machines).toMatch(
      /Revoke “<bdi data-confirm-label[^>]*>leo-macbook-pro<\/bdi>”\?/,
    );
    expect(machines).toContain(">Cancel</button>");
  });

  it("isolates machine labels in <bdi> and has no em dashes", () => {
    for (const label of ["leo-macbook-pro", "leo-mac-mini", "build-vm-01"]) {
      const shown = rows.join("").match(new RegExp(`>${label}<`, "g")) ?? [];
      const iso =
        rows.join("").match(new RegExp(`<bdi[^>]*>${label}</bdi>`, "g")) ?? [];
      expect(shown.length).toBeGreaterThan(0);
      expect(iso.length).toBe(shown.length);
    }
    expect(machines).not.toContain("—");
  });
});

const liveFile = new URL("../../../design/screens/live.html", import.meta.url);
const live = (() => {
  try {
    return readFileSync(liveFile, "utf8");
  } catch {
    return "";
  }
})();
const liveRows = [...live.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)]
  .map((m) => m[0])
  .filter(
    (r) =>
      r.includes(' data-ns="') &&
      r.includes('data-slot="table-cell"') &&
      !r.includes('data-slot="skeleton"'),
  );
const rowsIn = (ns: string) =>
  liveRows.filter((r) => r.includes(` data-ns="${ns}"`));
const chips = [
  ...live.matchAll(
    /<button\b[^>]*data-slot="toggle-group-item"[^>]*data-ns="([\w-]+)"[^>]*data-count="(\d+)" data-empty-count="(\d+)"[^>]*>(.*?)<\/button>/gs,
  ),
].map((m) => ({
  ns: m[1],
  count: Number(m[2]),
  empty: Number(m[3]),
  body: m[4],
}));

describe("design/screens/live.html (D5)", () => {
  it("links the tokens and its generated Tailwind CSS", () => {
    expect(live).toContain(
      '<link rel="stylesheet" href="../../packages/ui/src/tokens/tokens.css">',
    );
    expect(live).toContain('<link rel="stylesheet" href="live.css">');
    const css = readFileSync(
      new URL("../../../design/screens/live.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/^\/\* Generated[\s\S]*build:screens/);
    expect(css).toContain("live.html");
  });

  it("uses the shadcn primitives and the StatusBadge markup", () => {
    for (const slot of [
      "sidebar",
      "table",
      "table-row",
      "toggle-group",
      "toggle-group-item",
      "separator",
      "button",
      "skeleton",
      "card",
      "badge",
      "status-badge-dot",
    ])
      expect(live).toContain(`data-slot="${slot}"`);
  });

  it("has the namespace chips openbus, medical-wiki, then global after a divider", () => {
    expect(chips.map((c) => c.ns)).toEqual([
      "openbus",
      "medical-wiki",
      "global",
    ]);
    const bar =
      /aria-label="Namespaces"[\s\S]*?<\/div>\s*<\/div>/.exec(live)?.[0] ?? "";
    expect(bar.indexOf('data-slot="separator"')).toBeGreaterThan(
      bar.indexOf('data-ns="medical-wiki"'),
    );
    expect(bar.indexOf('data-slot="separator"')).toBeLessThan(
      bar.indexOf('data-ns="global"'),
    );
  });

  it("makes each namespace chip's count equal its rows, in default and empty", () => {
    expect(chips.length).toBe(3);
    for (const c of chips) {
      expect(c.count).toBe(rowsIn(c.ns).length);
      expect(c.body).toContain(`<span data-show="default">${c.count}</span>`);
      expect(c.body).toContain(`<span data-show="empty">${c.empty}</span>`);
      // Empty means no namespace agents; global agents stay.
      expect(c.empty).toBe(c.ns === "global" ? c.count : 0);
    }
    expect(rowsIn("openbus").length).toBe(5);
    expect(rowsIn("medical-wiki").length).toBe(3);
    expect(rowsIn("global").length).toBe(2);
    expect(liveRows.length).toBe(10);
  });

  it("keeps the summary and sidebar counts equal to the rows", () => {
    const total = chips.reduce((n, c) => n + c.count, 0);
    const totalEmpty = chips.reduce((n, c) => n + c.empty, 0);
    expect(live).toMatch(
      new RegExp(
        `<span data-show="default" data-agent-count="${total}">${total}</span><span data-show="empty" data-agent-count="${totalEmpty}">${totalEmpty}</span>`,
      ),
    );
    for (const c of chips) {
      const n = rowsIn(c.ns).length;
      const up = rowsIn(c.ns).filter((r) =>
        r.includes('data-status="live"'),
      ).length;
      const m = new RegExp(
        `data-summary-ns="${c.ns}" data-total="(\\d+)" data-live="(\\d+)">(.*?) live</span>`,
        "s",
      ).exec(live);
      expect(m, c.ns).not.toBeNull();
      expect(Number(m?.[1])).toBe(n);
      expect(Number(m?.[2])).toBe(up);
      const text = `${(m?.[3] ?? "").replace(/<[^>]+>/g, "")} live`;
      expect(text).toContain(`${n} `);
      expect(text).toContain(`${up} live`);
    }
  });

  it("names the nav item Agents, counting every listed agent, on both pages", () => {
    for (const page of [live, machines]) {
      expect(page).toMatch(/<span>Agents<\/span>/);
      expect(page).not.toMatch(/<span>Live<\/span>/);
    }
    expect(live).toContain("<title>Agents · OpenBus</title>");
    expect(live).toMatch(/<h1 class="[^"]*">Agents<\/h1>/);
    // Revoking a machine is final: its agents leave the roster (sends refused: revoked).
    const onMbp = liveRows.filter((r) =>
      r.includes(">leo-macbook-pro</bdi>"),
    ).length;
    expect(onMbp).toBeGreaterThan(0);
    expect(machines).toContain(
      `<span data-show="default"><span data-show-toast="none" data-agent-count="${
        liveRows.length
      }">${
        liveRows.length
      }</span><span data-show-toast="revoked" data-agent-count="${
        liveRows.length - onMbp
      }">${liveRows.length - onMbp}</span></span>`,
    );
    expect(machines).toContain("its agents leave the roster");
    // Agents sit only on machines D4 shows as not revoked; Queued only on the offline one.
    for (const r of liveRows.filter((x) => x.includes('data-status="queued"')))
      expect(r).toContain(">leo-mac-mini</bdi>");
    for (const r of liveRows) expect(r).not.toContain("build-vm-01");
  });

  it("speaks only Live and Queued, each a badge with its word", () => {
    // Idle is only ever what an agent says (D16), never a Reachable word.
    const claims = live
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(
        /data-says="idle" class="[^"]*"><span class="sr-only">agent says: <\/span>Idle</g,
        "",
      );
    expect(claims).not.toMatch(/\b(away|idle)\b/i);
    const words: Record<string, string> = {
      live: "Live",
      queued: "Queued",
    };
    const seen = new Set<string>();
    for (const r of liveRows) {
      const b = [
        ...r.matchAll(
          /data-slot="badge" data-variant="secondary" data-status="(\w+)" class="[^"]*"><span data-slot="status-badge-dot" aria-hidden="true" class="[^"]*"><\/span>(?:<span class="group-data-\[paused=true\]\/roster:hidden">(\w+)<\/span><span class="hidden group-data-\[paused=true\]\/roster:inline">Last seen live<\/span>|(\w+))<\/span>/g,
        ),
      ];
      expect(b.length, r.slice(0, 120)).toBe(1);
      const [, status, pausedWord, plainWord] = b[0];
      const word = pausedWord ?? plainWord;
      // Only Live rows carry the paused wording.
      expect(pausedWord !== undefined).toBe(status === "live");
      expect(Object.keys(words)).toContain(status);
      expect(word).toBe(words[status]);
      seen.add(status);
    }
    expect([...seen].sort()).toEqual(["live", "queued"]);
    // Closed sessions are not listed (agent DTO state: "live" | "queued").
    for (const r of liveRows)
      expect(r).not.toMatch(/data-status="closed"|>Closed</);
    // The filter offers exactly All, Live and Queued.
    expect(live).toContain('filter: ["none", "live", "queued"]');
    expect(live).toContain(
      "Messages to live agents are pushed immediately. Queued agents get messages if their machine reconnects within 1 hour; after that the sender is told it expired. Closed sessions leave the roster.",
    );
  });

  it("renders global agents once, each with the accent global Badge", () => {
    const g = rowsIn("global");
    for (const r of g)
      expect(r).toMatch(
        /data-slot="badge" data-variant="secondary" class="[^"]*bg-\(--ob-accent-soft\) text-\(--ob-accent-fg\)[^"]*">global<\/span>/,
      );
    for (const r of liveRows.filter((x) => !x.includes(' data-ns="global"')))
      expect(r).not.toContain(">global</span>");
    expect(live.match(/>Global agents</g)?.length).toBe(1);
  });

  it("isolates agent names, machine labels and refs in <bdi>, with no em dashes", () => {
    for (const r of liveRows) {
      const bdis =
        r.match(/<bdi class="[^"]*\[overflow-wrap:anywhere\][^"]*"/g) ?? [];
      expect(bdis.length, r.slice(0, 120)).toBeGreaterThanOrEqual(3);
    }
    expect(live).not.toContain("—");
  });

  it("wraps the namespace chips instead of scrolling them", () => {
    expect(live).toMatch(
      /data-slot="toggle-group"[^>]*aria-label="Namespaces"[^>]*class="[^"]*flex-wrap/,
    );
    expect(live).not.toMatch(/aria-label="Namespaces"[^>]*overflow-x-auto/);
  });
  it("keeps global agents out of every namespace table, without a home namespace", () => {
    const nsCard =
      /<div data-show="default" data-ns-only="openbus medical-wiki"[\s\S]*?<\/table>/.exec(
        live,
      )?.[0] ?? "";
    expect(nsCard).toContain('data-ns="openbus"');
    expect(nsCard).not.toContain('data-ns="global"');
    const globalNames = rowsIn("global").map(
      (r) =>
        /<bdi class="font-mono font-medium[^"]*">([^<]+)<\/bdi>/.exec(r)?.[1],
    );
    expect(globalNames.length).toBe(2);
    for (const n of globalNames) expect(nsCard).not.toContain(`>${n}<`);
    const section =
      /<section data-global-section[\s\S]*?<\/section>/.exec(live)?.[0] ?? "";
    expect(section.match(/<tr data-ns="global"/g)?.length).toBe(2);
    expect(section).not.toMatch(/openbus<|medical-wiki</);
    expect(section).not.toMatch(/<tr data-ns="(?!global)/);
  });

  it("offers state=paused: a muted banner with Retry, muted badges, same words", () => {
    expect(live).toContain(
      'state: ["default", "empty", "loading", "error", "paused"]',
    );
    expect(live).toMatch(
      /data-paused-banner[\s\S]*?Live updates paused\. Showing the roster as of <time datetime="[^"]+">[^<]+<\/time>\.[\s\S]*?data-retry[^>]*>/,
    );
    for (const r of liveRows)
      expect(r).toMatch(
        /data-status="\w+" class="[^"]*group-data-\[paused=true\]\/roster:bg-secondary group-data-\[paused=true\]\/roster:text-muted-foreground/,
      );
    expect(live).toMatch(/class="group\/roster[^"]*" data-roster/);
  });
  it("matches the summary to the filter: shown of total, and live", () => {
    for (const c of chips)
      for (const f of ["live", "queued"]) {
        const shown = rowsIn(c.ns).filter((r) =>
          r.includes(`data-status="${f}"`),
        ).length;
        const up = rowsIn(c.ns).filter((r) =>
          r.includes('data-status="live"'),
        ).length;
        const m = new RegExp(
          `data-summary-ns="${c.ns}" data-summary-filter="${f}" data-shown="(\\d+)" data-total="(\\d+)" data-live="(\\d+)">(.*?) live</span>`,
          "s",
        ).exec(live);
        expect(m, `${c.ns} ${f}`).not.toBeNull();
        expect(Number(m?.[1])).toBe(shown);
        expect(Number(m?.[2])).toBe(c.count);
        expect(Number(m?.[3])).toBe(up);
        const text = (m?.[4] ?? "").replace(/<[^>]+>/g, "");
        expect(text).toMatch(new RegExp(`^${shown} of ${c.count} `));
      }
  });

  it("says when a filter matches nothing, reachable at ns=medical-wiki&filter=live", () => {
    const empties =
      live.match(
        /<tr data-filter-empty[\s\S]*?>\s*<td data-slot="table-cell" colspan="6" class="[^"]*">No agents match this filter\.<\/td>\s*<\/tr>/g,
      ) ?? [];
    expect(empties.length).toBe(2);
    expect(
      rowsIn("medical-wiki").filter((r) => r.includes('data-status="live"'))
        .length,
    ).toBe(0);
  });

  it("builds every chip as cn(ToggleGroupItem size sm, its className)", () => {
    const item = cn(
      toggleVariants({ variant: "default", size: "sm" }),
      "w-auto min-w-0 shrink-0 px-3 focus:z-10 focus-visible:z-10",
      "data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l",
    );
    const items = [
      ...live.matchAll(
        /<button\b[^>]*data-slot="toggle-group-item"[^>]*class="([^"]*)"/g,
      ),
    ].map((m) => m[1]);
    expect(items.length).toBe(6);
    // A fixed point: merging the base back in changes nothing.
    for (const c of items) expect(cn(item, c)).toBe(c);
    const nsChips = [
      ...live.matchAll(/<button\b[^>]*data-ns="[\w-]+"[^>]*class="([^"]*)"/g),
    ].map((m) => m[1]);
    expect(nsChips.length).toBe(3);
    for (const c of nsChips) expect(c.split(" ")).toContain("h-auto");
    expect(nsChips[0].split(" ")).toContain("hover:bg-muted");
    expect(nsChips[2].split(" ")).toContain("hover:bg-(--ob-accent-soft)");
  });
});

describe("design/screens/live.html status column (D16)", () => {
  const heads = [...live.matchAll(/<thead\b[\s\S]*?<\/thead>/g)].map(
    (m) => m[0],
  );
  const badges = [
    ...live.matchAll(
      /<span data-slot="badge" data-variant="agent-says" data-says="(\w+)" class="([^"]*)"><span class="sr-only">agent says: <\/span>([^<]+)<\/span>/g,
    ),
  ].map((m) => ({ state: m[1], cls: m[2].split(" "), word: m[3] }));

  it("puts Status after Kind in every table, tagged agent says once", () => {
    expect(heads.length).toBe(3);
    for (const h of heads) {
      const cols = [
        ...h.matchAll(/<th data-slot="table-head" class="[^"]*">(.*?)<\/th>/g),
      ].map((m) =>
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      expect(cols.slice(0, 4)).toEqual([
        "Agent",
        "Kind",
        "Status agent says",
        "Machine",
      ]);
      expect(h.match(/agent says/g)?.length).toBe(1);
    }
  });

  it("gives every roster row one status cell, folded under the name below md", () => {
    for (const r of liveRows) {
      const cell =
        /<td data-slot="table-cell" class="[^"]*max-md:row-start-3[^"]*">([\s\S]*?)<\/td>/.exec(
          r,
        )?.[1] ?? "";
      expect(cell).toContain(
        '<span aria-hidden="true" class="text-muted-foreground md:hidden">Status (agent says) </span>',
      );
      expect(cell).toContain('data-says-in="');
      expect(r).toMatch(
        /max-md:row-start-4[^"]*"><span class="text-muted-foreground md:hidden">Machine /,
      );
    }
  });

  it("draws status as a dashed, unfilled outline Badge with its word, never a Reachable badge", () => {
    const words: Record<string, string> = {
      working: "Working",
      idle: "Idle",
      blocked: "Blocked",
      waiting_on_owner: "Waiting on you",
    };
    expect(new Set(badges.map((b) => b.state))).toEqual(
      new Set([...Object.keys(words), "reviewing"]),
    );
    for (const b of badges) {
      expect(b.cls).toEqual(
        expect.arrayContaining(["border", "border-dashed", "bg-transparent"]),
      );
      expect(b.cls.some((c) => /^bg-\(--ob-/.test(c))).toBe(false);
      // A newer state shows its raw token.
      expect(b.word).toBe(words[b.state] ?? b.state);
    }
  });

  it("offers status=default|none|long|unknown, with a 64-character label and None", () => {
    expect(live).toContain('status: ["default", "none", "long", "unknown"]');
    const long = [
      ...live.matchAll(/<div data-says-in="long"[\s\S]*?<bdi>([^<]+)<\/bdi>/g),
    ].map((m) => m[1]);
    expect(long.length).toBeGreaterThan(0);
    for (const l of long) expect(l.length).toBe(64);
    expect(live).toMatch(
      /data-says-in="unknown"[^>]*>.*?data-says="reviewing"/,
    );
    const nones =
      live.match(
        /<span data-says-in="[^"]*" role="img" aria-label="No status" class="text-muted-foreground">None<\/span>/g,
      ) ?? [];
    expect(nones.length).toBe(liveRows.length);
  });
});

const settingsFile = new URL(
  "../../../design/screens/settings.html",
  import.meta.url,
);
const settings = readFileSync(settingsFile, "utf8");

describe("design/screens/settings.html (D16)", () => {
  it("links the tokens and its generated Tailwind CSS", () => {
    expect(settings).toContain('<link rel="stylesheet" href="settings.css">');
    const css = readFileSync(
      new URL("../../../design/screens/settings.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/^\/\* Generated[\s\S]*settings\.html/);
  });

  it("navigates Machines, Agents, Settings, with Settings current", () => {
    const nav =
      /<nav aria-label="Main">[\s\S]*?<\/nav>/.exec(settings)?.[0] ?? "";
    expect([...nav.matchAll(/<span>(\w+)<\/span>/g)].map((m) => m[1])).toEqual([
      "Machines",
      "Agents",
      "Settings",
    ]);
    expect(nav).toMatch(/href="settings.html" aria-current="page"/);
    for (const page of [live, machines])
      expect(page).toContain('<a href="settings.html"');
  });

  it("lists each aud whole, mono, in <bdi>, never as a link", () => {
    const auds = [...settings.matchAll(/<li data-app="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(auds).toEqual([
      "https://artifacts.leourbina.com",
      "https://xn--bcher-kva.example",
      "https://staging.artifacts.leourbina.com:8443",
    ]);
    for (const a of auds) {
      expect(settings).toContain(
        `<bdi class="block font-mono text-sm [overflow-wrap:anywhere]">${a}</bdi>`,
      );
      expect(settings).toContain(`aria-label="Unlink ${a}"`);
      expect(settings).not.toContain(`href="${a}`);
    }
  });

  it("has every state, the unlink confirm and the toast", () => {
    for (const s of ["default", "empty", "loading", "error"])
      expect(settings).toContain(`data-show="${s}"`);
    expect(settings).toContain(">No linked apps</h3>");
    expect(settings).toContain("Link one from the app's settings.");
    expect(settings).toContain("Couldn't load linked apps");
    expect(settings).toMatch(/role="alertdialog" aria-modal="true"/);
    expect(settings).toMatch(
      /Unlink <bdi data-confirm-aud class="font-mono">https:\/\/artifacts\.leourbina\.com<\/bdi>\?<\/h2>/,
    );
    expect(settings).toContain(
      "can no longer verify your agents' cards. Cards it already has expire within 5 minutes.",
    );
    expect(settings).toContain(">Cancel</button>");
    expect(settings).toMatch(
      /Unlinked <bdi data-toast-host class="font-mono">https:\/\/artifacts\.leourbina\.com<\/bdi>\./,
    );
  });

  it("has no em dashes, no new tabs and no role", () => {
    for (const page of [settings, live]) {
      expect(page).not.toContain("—");
      expect(page).not.toContain('target="_blank"');
      expect(
        page.replace(
          /<!--[\s\S]*?-->|role="[^"]*"|\[role="?\w+"?\]|"role"/g,
          "",
        ),
      ).not.toMatch(/\broles?\b/i);
    }
  });
});

const linkFile = new URL(
  "../../../design/screens/link-confirm.html",
  import.meta.url,
);
const link = readFileSync(linkFile, "utf8");

describe("design/screens/link-confirm.html is the Worker's /link template (D16)", () => {
  const max: Record<string, string> = {
    aud: `https://${"h".repeat(253)}:65535`,
    aud_host: `${"h".repeat(253)}:65535`,
    bus_host: "h".repeat(253),
    user_email: `${"u".repeat(242)}@example.com`,
    form_action: "f".repeat(64),
    csrf_token: "c".repeat(64),
    switch_url: "s".repeat(200),
  };
  const served = link
    .replace(/^(<!doctype html>\n)<!--.*?-->\n/s, "$1")
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => max[k]);
  const size = new TextEncoder().encode(served).length;

  it("stays under 8 KB served, and states that size in its header", () => {
    expect(served).not.toMatch(/<!--|\{\{/);
    expect(size).toBeLessThan(8192);
    expect(link).toContain(`${size} B, under 8 KB`);
  });

  it("has no JavaScript and no external requests, prefers-color-scheme only", () => {
    expect(link).not.toMatch(/<script|javascript:/i);
    expect(link).not.toMatch(/https?:\/\/(?!artifacts|xn--)/);
    expect(link).not.toMatch(/@import|url\(/);
    expect(link).toMatch(/prefers-color-scheme only/);
    expect(link).toMatch(/HTML-escape every value/);
  });

  it("offers exactly the approved placeholder set", () => {
    const used = [
      ...new Set([...link.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])),
    ].sort();
    expect(used).toEqual(Object.keys(max).sort());
  });

  it("posts allow or cancel with CSRF, Cancel then Allow", () => {
    expect(link).toMatch(/method="post" action="\{\{form_action\}\}"/);
    expect(link).toMatch(/name="csrf" value="\{\{csrf_token\}\}"/);
    expect(link).toMatch(
      /data-variant="outline"[^>]*value="cancel">Cancel<\/button><button[^>]*data-variant="default"[^>]*value="allow">Allow<\/button>/,
    );
  });

  it("shows the aud whole, mono, in <bdi>, never as a link, and isolates every value", () => {
    const body = link
      .replace(/<!--.*?-->/s, "")
      .replace(/<title>.*?<\/title>/s, "");
    expect(body).toContain('<b class="mono"><bdi>{{aud}}</bdi></b>');
    expect(body).not.toMatch(/href="\{\{aud/);
    for (const p of ["aud", "aud_host", "bus_host", "user_email"]) {
      const all = body.match(new RegExp(`\\{\\{${p}\\}\\}`, "g")) ?? [];
      const iso =
        body.match(new RegExp(`<bdi>\\{\\{${p}\\}\\}</bdi>`, "g")) ?? [];
      expect(all.length, p).toBeGreaterThan(0);
      expect(iso.length, p).toBe(all.length);
    }
  });

  it("carries the 4A copy", () => {
    for (const s of [
      "Let <bdi>{{aud_host}}</bdi> verify your agents' cards?",
      "<b>The agent's name, kind and machine</b><small>Signed by your bus, so it can show them as attested.</small>",
      "<b>What the agent says it's doing</b><small>Marked as reported by the agent, never as fact.</small>",
      '<li class="no"><p><b>Never your email or namespaces</b><small>It gets an id for you that only it uses.</small>',
      "Signed in as <b><bdi>{{user_email}}</bdi></b>",
      "You can unlink it any time in Settings.",
    ])
      expect(link).toContain(s);
    expect(link).not.toContain("—");
    expect(link.replace(/role="[^"]*"/g, "")).not.toMatch(/\broles?\b/i);
  });

  it("defines every class it uses in the inline <style>", () => {
    expect(undefinedClasses(link)).toEqual([]);
  });
});
