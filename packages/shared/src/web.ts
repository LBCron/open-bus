/**
 * `@ob/shared/web`: the REST and dashboard-feed contract only, for the dashboard bundle (and
 * the Worker's HTTP layer). Re-exports from `rest.ts`, `errors.ts` and the
 * small modules those depend on. It must never import `protocol.ts` or
 * `receipts.ts` (the WebSocket frames), or a browser bundle would ship them;
 * `web.test.ts` bundles it with esbuild to prove that.
 */

export {
  type AgentStatus,
  AgentStatusSchema,
  OriginSchema,
  STATUS_STATES,
  StatusLabelSchema,
  type StatusState,
  StatusStateSchema,
} from "./card.js";
export {
  ApiErrorSchema,
  ERROR_CODES,
  type ErrorCode,
  STATUS_FOR,
} from "./errors.js";
export { IdSchema, isId, isMachineToken } from "./ids.js";
export {
  type AgentKind,
  AgentKindSchema,
  KindTokenSchema,
} from "./kinds.js";
export { LIMITS } from "./limits.js";
export { BusNameSchema } from "./names.js";
export { WireNamespaceSchema } from "./namespace.js";
export { MachineLabelSchema } from "./refs.js";
export {
  type Agent,
  AgentListQuerySchema,
  AgentSchema,
  type AgentsResponse,
  AgentsResponseSchema,
  AUTH,
  type BusEvent,
  BusEventSchema,
  CSRF_HEADER,
  CSRF_VALUE,
  EVENTS_DO_PATH,
  type LinkedApp,
  LinkedAppSchema,
  type LinkedAppsResponse,
  LinkedAppsResponseSchema,
  type Machine,
  MachineSchema,
  type MachinesResponse,
  MachinesResponseSchema,
  type Me,
  MeSchema,
  R,
  SESSION_EXP_HEADER,
  SESSION_GEN_HEADER,
} from "./rest.js";
