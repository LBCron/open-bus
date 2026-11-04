/**
 * The dashboard's view of the REST/WebSocket contract: re-exports from @ob/shared/web
 * (F2.4). The single place the FE names the shared schemas, so a rename
 * upstream is one edit here. Never add local schema copies.
 */
export {
  type Agent,
  type AgentKind,
  AgentSchema,
  AgentsResponseSchema,
  ApiErrorSchema,
  AUTH,
  type BusEvent,
  BusEventSchema,
  BusNameSchema,
  CSRF_HEADER,
  CSRF_VALUE,
  ERROR_CODES,
  type ErrorCode,
  LIMITS,
  type LinkedApp,
  LinkedAppsResponseSchema,
  type Machine,
  MachineSchema,
  MachinesResponseSchema,
  type Me,
  MeSchema,
  R,
  type StatusState,
  WireNamespaceSchema,
} from "@ob/shared/web";
