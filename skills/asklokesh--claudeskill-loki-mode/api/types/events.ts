/**
 * SSE Event Type Definitions
 *
 * All events streamed through Server-Sent Events
 */

// Base event interface
export interface SSEEvent<T = unknown> {
  id: string;
  type: EventType;
  timestamp: string;
  sessionId: string;
  data: T;
}

// All possible event types
export type EventType =
  | "session:started"
  | "session:paused"
  | "session:resumed"
  | "session:stopped"
  | "session:completed"
  | "session:failed"
  | "phase:started"
  | "phase:completed"
  | "phase:failed"
  | "task:created"
  | "task:started"
  | "task:progress"
  | "task:completed"
  | "task:failed"
  | "agent:spawned"
  | "agent:output"
  | "agent:completed"
  | "agent:failed"
  | "log:info"
  | "log:warn"
  | "log:error"
  | "log:debug"
  | "metrics:update"
  | "input:requested"
  | "heartbeat";

// Event data types
export interface SessionEventData {
  status: string;
  message?: string;
  exitCode?: number;
}

export interface PhaseEventData {
  phase: string;
  previousPhase?: string;
  progress?: number;
  eta?: number;
}

export interface TaskEventData {
  taskId: string;
  title: string;
  description?: string;
  status: string;
  progress?: number;
  output?: string;
  error?: string;
  duration?: number;
}

export interface AgentEventData {
  agentId: string;
  type: string;
  model?: string;
  task?: string;
  output?: string;
  exitCode?: number;
}

export interface LogEventData {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
  context?: Record<string, unknown>;
}

export interface MetricsEventData {
  cpuUsage?: number;
  memoryUsage?: number;
  tokensUsed?: number;
  apiCalls?: number;
  cost?: number;
}

export interface InputRequestedEventData {
  prompt: string;
  context?: string;
  timeout?: number;
  options?: string[];
}

export interface HeartbeatEventData {
  uptime: number;
  activeAgents: number;
  queuedTasks: number;
}

// Type-safe event constructors
export type SessionEvent = SSEEvent<SessionEventData>;
export type PhaseEvent = SSEEvent<PhaseEventData>;
export type TaskEvent = SSEEvent<TaskEventData>;
export type AgentEvent = SSEEvent<AgentEventData>;
export type LogEvent = SSEEvent<LogEventData>;
export type MetricsEvent = SSEEvent<MetricsEventData>;
export type InputRequestedEvent = SSEEvent<InputRequestedEventData>;
export type HeartbeatEvent = SSEEvent<HeartbeatEventData>;

// Union of all events
export type AnySSEEvent =
  | SessionEvent
  | PhaseEvent
  | TaskEvent
  | AgentEvent
  | LogEvent
  | MetricsEvent
  | InputRequestedEvent
  | HeartbeatEvent;

// Event filter for subscriptions
export interface EventFilter {
  types?: EventType[];
  sessionId?: string;
  minLevel?: "debug" | "info" | "warn" | "error";
}
