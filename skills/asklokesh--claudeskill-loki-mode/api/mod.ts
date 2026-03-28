/**
 * Loki Mode API Module
 *
 * Exports for programmatic use
 */

// Types
export type {
  Session,
  SessionStatus,
  Phase,
  Task,
  TaskStatus,
  StartSessionRequest,
  StartSessionResponse,
  SessionStatusResponse,
  TaskSummary,
  AgentSummary,
  InjectInputRequest,
  ApiError,
  HealthResponse,
} from "./types/api.ts";

export type {
  SSEEvent,
  EventType,
  EventFilter,
  SessionEventData,
  PhaseEventData,
  TaskEventData,
  AgentEventData,
  LogEventData,
  MetricsEventData,
  InputRequestedEventData,
  HeartbeatEventData,
  AnySSEEvent,
} from "./types/events.ts";

// Services
export { eventBus } from "./services/event-bus.ts";
export { cliBridge } from "./services/cli-bridge.ts";
export { stateWatcher } from "./services/state-watcher.ts";

// Middleware
export { authMiddleware, configureAuth, generateToken } from "./middleware/auth.ts";
export { corsMiddleware, configureCors } from "./middleware/cors.ts";
export {
  errorMiddleware,
  LokiApiError,
  ErrorCodes,
  handleError,
  validateBody,
  errorResponse,
  successResponse,
} from "./middleware/error.ts";

// Server
export { createHandler, routeRequest, parseArgs } from "./server.ts";
