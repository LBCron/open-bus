import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as shared from "./index.js";
import {
  AgentRefSchema,
  AUTH,
  CLIENT_FRAMES,
  CSRF_HEADER,
  CSRF_VALUE,
  isReservedBusName,
  LIMITS,
  PROTOCOL_VERSION,
  R,
  REFUSAL_REASONS,
  RESERVED_BUS_NAMES,
  SERVER_FRAMES,
} from "./index.js";

const doc = readFileSync(new URL("../CONTRACT.md", import.meta.url), "utf8");

describe("contract is pinned", () => {
  it("is protocol version 1", () => expect(PROTOCOL_VERSION).toBe(1));

  it("keeps the spec values", () => {
    expect(LIMITS).toMatchObject({
      inlineBodyBytes: 32768,
      maxMessageBytes: 1048576,
      mailTtlSec: 3600,
      inboxCap: 50,
      deviceCodeTtlSec: 600,
      devicePollIntervalSec: 5,
      revokeCloseCode: 4403,
      dashboardSessionClose: 4401,
      maxRosterAgents: 1000,
      maxMachinesListed: 100,
    });
    expect("maxRoles" in LIMITS).toBe(false);
    expect(shared.MAX_RAW_FRAME_CHARS).toBe(2 * 1048576 + 4096);
  });

  it("pins the frame lists", () => {
    expect(CLIENT_FRAMES).toEqual([
      "hello",
      "agent_up",
      "agent_down",
      "sessions",
      "send",
      "ack",
      "refuse",
      "list",
      "fetch",
      "status",
      "card_request",
      "rename",
    ]);
    expect(SERVER_FRAMES).toEqual([
      "hello_ok",
      "agent_ok",
      "receipt",
      "roster",
      "body",
      "error",
      "deliver",
      "receipt_update",
      "roster_changed",
      "card",
      "card_refused",
      "renamed",
    ]);
  });

  it("pins the 8 refusal reasons, in order", () => {
    expect(REFUSAL_REASONS).toEqual([
      "unknown_agent",
      "closed",
      "inbox_full",
      "too_large",
      "other_namespace",
      "revoked",
      "ambiguous",
      "role_vacant",
    ]);
  });

  it("pins the agent card (status, card, gate)", () => {
    expect(shared.AGENT_CARD_MIN_CLIENT).toBe("0.55.0");
    expect(shared.semverGte("0.54.0", shared.AGENT_CARD_MIN_CLIENT)).toBe(
      false,
    );
    expect(shared.STATUS_STATES).toEqual([
      "working",
      "idle",
      "blocked",
      "waiting_on_owner",
    ]);
    expect(shared.CARD_REFUSAL_CODES).toEqual([
      "not_linked",
      "bad_nonce",
      "rate_limited",
    ]);
    expect(shared.CARD_TYP).toBe("ob-card+jwt");
    expect(shared.LINK_TYP).toBe("ob-link+jwt");
    expect(shared.CARD_TTL_SEC).toBe(300);
    expect(shared.STATUS_WINDOW_MS).toBe(5000);
    expect(shared.CARDS_PER_MINUTE).toBe(6);
    expect(R.linkedApps).toBe("/api/v1/linked-apps");
    expect(R.link).toBe("/link");
    expect(R.linkConfirm).toBe("/link/confirm");
    expect(R.jwks).toBe("/.well-known/jwks.json");
    // The private test key lives only in @ob/shared/mocks.
    expect("TEST_CARD_JWK" in shared).toBe(false);
  });

  it("keeps public routes unversioned and the API under /api/v1", () => {
    expect(R.healthz).toBe("/healthz");
    expect(R.deviceCode).toBe("/device/code");
    expect(R.deviceToken).toBe("/device/token");
    expect(R.me).toBe("/api/v1/me");
    expect(R.machines).toBe("/api/v1/machines");
    // The SPA's Machines page (router.tsx path "/"); not /machines, which 404s.
    expect(R.dashboard).toBe("/");
    expect(R.agents).toBe("/api/v1/agents");
    expect(R.events).toBe("/api/v1/events");
    expect(R.hub).toBe("/hub");
    expect(AUTH.logout).toBe("/auth/logout");
  });

  it("pins the dashboard WebSocket feed (B10-ws)", () => {
    expect(shared.EVENTS_DO_PATH).toBe("/events");
    expect(shared.SESSION_EXP_HEADER).toBe("x-ob-session-exp");
    expect(shared.SESSION_GEN_HEADER).toBe("x-ob-session-gen");
    expect(LIMITS.dashboardSessionClose).toBe(4401);
  });

  it("pins the CSRF header", () => {
    expect(CSRF_HEADER).toBe("X-OB-Request");
    expect(CSRF_VALUE).toBe("1");
  });

  it("pins the reserved bus names", () => {
    expect(RESERVED_BUS_NAMES).toEqual(["openbus", "open-bus"]);
    expect(isReservedBusName("open--bus")).toBe(true);
  });
});

describe("renames (#393) are pinned", () => {
  it("pins the gate, the limits and the message", () => {
    expect(shared.RENAME_MIN_CLIENT).toBe("0.66.0");
    expect(shared.LIMITS.formerNameGraceMs).toBe(3_600_000);
    expect(shared.LIMITS.maxFormerNames).toBe(5);
    expect(shared.LIMITS.renamesPerHour).toBe(10);
    expect(shared.RENAME_MESSAGES.rate).toBe("Too many renames");
  });
});

describe("CONTRACT.md", () => {
  it("lists every refusal reason as a standalone token", () => {
    for (const t of REFUSAL_REASONS) expect(doc, t).toContain(`\`${t}\``);
  });
  it("mentions every frame and the CSRF header", () => {
    for (const t of [
      ...CLIENT_FRAMES,
      ...SERVER_FRAMES,
      CSRF_HEADER,
      "4403",
      "recipient_closed",
      "AGENT_CARD_MIN_CLIENT",
      "0.55.0",
      "RENAME_MIN_CLIENT",
      "0.66.0",
      "former_names",
      "name_kind",
      "Too many renames",
      "ob-card+jwt",
      "ob-link+jwt",
      "TEST_CARD_JWK",
      "/.well-known/jwks.json",
    ])
      expect(doc, t).toContain(t);
  });
  it("describes the dashboard feed as a WebSocket, not SSE", () => {
    for (const t of [
      "4401",
      "1013",
      "1011",
      "x-ob-session-exp",
      "x-ob-session-gen",
      "at most 16 digits",
      "restHandlers",
      "createWsHandler",
      "before awaiting",
      "`/events`",
      "426",
      "ws.link",
    ])
      expect(doc, t).toContain(t);
    expect(doc).not.toMatch(/event-stream|EventSource|data: <json>/);
  });
});

describe("agent refs", () => {
  it("reject prototype-pollution names", () => {
    for (const r of ["__proto__", "constructor", "prototype"])
      expect(AgentRefSchema.safeParse(r).success, r).toBe(false);
    expect(AgentRefSchema.safeParse("ses_abc:1").success).toBe(true);
  });
});
