import { z } from "zod";
import {
  IsoTimeSchema,
  MAX_LINKED_APPS,
  OriginSchema,
  StatusLabelSchema,
  StatusStateSchema,
} from "./card.js";
import { IdSchema, isDeviceSecret, isId, isUserCode } from "./ids.js";
import { KindTokenSchema } from "./kinds.js";
import { LIMITS } from "./limits.js";
import { BusNameSchema } from "./names.js";
import { BAD_NS_CHARS, WireNamespaceSchema } from "./namespace.js";
import { MachineLabelSchema } from "./refs.js";

/** Session-cookie mutations must carry this header (PAT-free: there are no PATs). */
export const CSRF_HEADER = "X-OB-Request";
export const CSRF_VALUE = "1";

const ISO = IsoTimeSchema;
const seg = (s: string): string => {
  if (s === "." || s === "..")
    throw new RangeError(`Unsafe path segment: ${JSON.stringify(s)}`);
  return encodeURIComponent(s);
};

/** Access OIDC routes the Worker owns (copied from openartifacts). */
export const AUTH = {
  login: "/auth/login",
  callback: "/auth/callback",
  logout: "/auth/logout",
  /** Mounted only when ENVIRONMENT=dev; 404 everywhere else. */
  devLogin: "/auth/dev-login",
} as const;

export const R = {
  healthz: "/healthz",
  deviceCode: "/device/code",
  deviceToken: "/device/token",
  approve: (userCode: string) => {
    if (!isUserCode(userCode))
      throw new RangeError("R.approve: invalid user code");
    return `/approve/${seg(userCode)}`;
  },
  me: "/api/v1/me",
  machines: "/api/v1/machines",
  machine: (id: string) => {
    if (!isId(id)) throw new RangeError("R.machine: invalid machine id");
    return `/api/v1/machines/${seg(id)}`;
  },
  agents: "/api/v1/agents",
  /** Session cookie + Origin; WebSocket upgrade only (else 426). The dashboard's live feed. */
  events: "/api/v1/events",
  /** Bearer machine token; WebSocket upgrade. */
  hub: "/hub",
  /** Sign-in entry point (the same URL as AUTH.login; the dashboard links here). */
  login: AUTH.login,
  /** Server-side redirect target once a device code is approved. */
  dashboard: "/",
  linkedApps: "/api/v1/linked-apps",
  linkedApp: (aud: string) => {
    if (!OriginSchema.safeParse(aud).success)
      throw new RangeError("R.linkedApp: invalid aud");
    return `/api/v1/linked-apps/${seg(aud)}`;
  },
  /** `GET /link?aud&state&redirect_uri`: the one-time link flow. */
  link: "/link",
  linkConfirm: "/link/confirm",
  jwks: "/.well-known/jwks.json",
} as const;

/** `{ user: { id, email, name } }`: one owner; `id` is a short opaque string (the Worker sends "owner"). */
export const MeSchema = z.strictObject({
  user: z.strictObject({
    id: z.string().min(1).max(32),
    email: z.email(),
    name: z.string().max(128).nullable(),
  }),
});
export type Me = z.infer<typeof MeSchema>;

/**
 * A machine the owner approved. GET /api/v1/machines lists active machines
 * first, then revoked ones, each newest first, at most 100 (so every active
 * machine stays visible); revoked ones carry `revokedAt` (ISO).
 * DELETE /api/v1/machines/:id returns 204 on first revoke and 404 when the
 * machine is unknown or already revoked. `lastUsed` is the last /hub upgrade.
 */
export const MachineSchema = z
  .strictObject({
    id: IdSchema,
    label: MachineLabelSchema,
    createdAt: ISO,
    lastUsed: ISO.nullable(),
    revokedAt: ISO.nullable(),
    /** True while the machine's daemon holds its hub socket; always false when `revokedAt` is set. */
    connected: z.boolean(),
  })
  .refine((m) => !(m.connected && m.revokedAt !== null), {
    message: "a revoked machine cannot be connected",
    path: ["connected"],
  });
export type Machine = z.infer<typeof MachineSchema>;

export const MachinesResponseSchema = z.strictObject({
  machines: z.array(MachineSchema).max(LIMITS.maxMachinesListed),
});
export type MachinesResponse = z.infer<typeof MachinesResponseSchema>;

export const AgentSchema = z.strictObject({
  id: IdSchema,
  namespace: WireNamespaceSchema,
  name: BusNameSchema,
  /**
   * Any kind token, so a dashboard tab built before a new kind keeps the
   * roster; it shows an unknown kind as Other.
   */
  kind: KindTokenSchema,
  machineId: IdSchema,
  machineLabel: MachineLabelSchema,
  global: z.boolean(),
  /**
   * Every agent that can receive mail is listed; closed agents are omitted.
   * `live`: its machine is connected. `queued`: the machine is disconnected but
   * the daemon last reported the session open, so mail waits up to 1 h.
   */
  state: z.enum(["live", "queued"]),
  updatedAt: ISO,
  /** @deprecated never sent since #394; removal tracked in #396 */
  role: BusNameSchema.optional(),
  /** Self-reported ("agent says"); cleared on close. */
  status: StatusStateSchema.optional(),
  statusLabel: StatusLabelSchema.optional(),
  statusAt: ISO.optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentsResponseSchema = z.strictObject({
  agents: z.array(AgentSchema).max(LIMITS.maxRosterAgents),
});
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;
export const LinkedAppSchema = z.strictObject({
  aud: OriginSchema,
  linkedAt: ISO,
});
export type LinkedApp = z.infer<typeof LinkedAppSchema>;
export const LinkedAppsResponseSchema = z.strictObject({
  apps: z.array(LinkedAppSchema).max(MAX_LINKED_APPS),
});
export type LinkedAppsResponse = z.infer<typeof LinkedAppsResponseSchema>;

export const AgentListQuerySchema = z.strictObject({
  namespace: WireNamespaceSchema.optional(),
});

export const DeviceCodeRequestSchema = z.strictObject({
  machine_label: MachineLabelSchema.optional(),
});
/**
 * The schema cannot know the hub origin: the CLI must also check that the
 * URI's origin equals its configured hub URL before printing or opening it.
 */
const isSafeVerificationUri = (uri: string, userCode: string): boolean => {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.username || u.password || u.href !== uri) return false;
  const dev =
    u.hostname === "localhost" ||
    u.hostname === "127.0.0.1" ||
    u.hostname === "[::1]";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && dev)))
    return false;
  return u.pathname === `/approve/${userCode}` && !u.search && !u.hash;
};

export const DeviceCodeResponseSchema = z
  .strictObject({
    device_code: z.string().refine(isDeviceSecret, "invalid device code"),
    user_code: z
      .string()
      .refine((s) => s.length === 9 && isUserCode(s), "invalid user code"),
    verification_uri: z.string().max(2048),
    expires_in: z.literal(LIMITS.deviceCodeTtlSec),
    interval: z.literal(LIMITS.devicePollIntervalSec),
  })
  .refine((v) => isSafeVerificationUri(v.verification_uri, v.user_code), {
    path: ["verification_uri"],
    message:
      "verification_uri must be https (http only for loopback) at /approve/<user_code>",
  });
export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>;

export const DeviceTokenRequestSchema = z.strictObject({
  device_code: z.string().refine(isDeviceSecret, "invalid device code"),
});
export const DeviceTokenResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending") }),
  z.strictObject({
    status: z.literal("approved"),
    token: z.string().regex(/^ob_machine_[1-9A-HJ-NP-Za-km-z]{32}$/),
    machine_id: IdSchema,
  }),
  z.strictObject({ status: z.literal("denied") }),
  z.strictObject({ status: z.literal("expired") }),
]);
export type DeviceTokenResponse = z.infer<typeof DeviceTokenResponseSchema>;

export const ApprovalBodySchema = z.strictObject({
  decision: z.enum(["approve", "deny"]),
  label: MachineLabelSchema.optional(),
});

/** The hub DO's internal path the Worker forwards a verified `/api/v1/events` upgrade to. */
export const EVENTS_DO_PATH = "/events";
/**
 * Set by the Worker on the forwarded upgrade: the session's expiry, epoch ms
 * (a decimal integer of at most 16 digits). The hub refuses `/events` with 400
 * when it is missing, malformed, past or beyond now + session max age + 1 min,
 * and closes the socket with 4401 at that time.
 */
export const SESSION_EXP_HEADER = "x-ob-session-exp";
/**
 * Set by the Worker on the forwarded upgrade: the session's generation (a
 * decimal integer). The hub refuses `/events` with 400 when it is missing,
 * malformed or not the hub's current generation.
 */
export const SESSION_GEN_HEADER = "x-ob-session-gen";

/**
 * The dashboard feed over a hibernatable WebSocket (`GET /api/v1/events`):
 * one JSON text frame per event, `type` inside the JSON. On connect the order
 * is `hello`, a full `machines` frame, then a full `agents` frame. Every later
 * change sends a full `machines` frame and a full `agents` frame, never a
 * delta. The client may send only the bare keepalive `"ping"` (auto-answered
 * `"pong"`); anything else is ignored. Close codes: 1013 evicted by the cap,
 * 1011 a send failed, `LIMITS.dashboardSessionClose` (4401) the session ended.
 */
export const BusEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello") }),
  z.strictObject({
    type: z.literal("machines"),
    machines: z.array(MachineSchema).max(LIMITS.maxMachinesListed),
  }),
  z.strictObject({
    type: z.literal("agents"),
    agents: z.array(AgentSchema).max(LIMITS.maxRosterAgents),
  }),
]);
export type BusEvent = z.infer<typeof BusEventSchema>;

const BAD_LABEL_CHARS = new RegExp(BAD_NS_CHARS.source, "gu");
const MAX_LABEL_UNITS = 2 * LIMITS.maxLabelChars;

/** Always returns a value that passes `MachineLabelSchema`. */
export const newMachineLabel = (hostname: string): string => {
  const clean = hostname
    .normalize("NFC")
    .replace(BAD_LABEL_CHARS, "")
    .normalize("NFC");
  let out = "";
  for (const ch of clean) {
    if (out.length + ch.length > MAX_LABEL_UNITS) break;
    out += ch;
  }
  return out.trim() || "machine";
};

export const isMachineId = isId;
