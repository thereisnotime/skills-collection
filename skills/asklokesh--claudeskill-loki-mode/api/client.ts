/**
 * Loki Mode API Client
 *
 * TypeScript/JavaScript client for interacting with the Loki Mode API.
 * Works in browsers, Node.js, and Deno.
 *
 * Usage:
 *   const client = new LokiClient("http://localhost:8420");
 *   const session = await client.startSession({ provider: "claude" });
 *   client.subscribe((event) => console.log(event));
 */

import type {
  Session,
  Task,
  StartSessionRequest,
  StartSessionResponse,
  SessionStatusResponse,
  HealthResponse,
} from "./types/api.ts";
import type { AnySSEEvent, EventFilter, EventType } from "./types/events.ts";

export interface ClientConfig {
  baseUrl: string;
  token?: string;
  timeout?: number;
}

export class LokiClient {
  private baseUrl: string;
  private token?: string;
  private timeout: number;
  private eventSource: EventSource | null = null;
  private eventCallbacks: ((event: AnySSEEvent) => void)[] = [];

  constructor(config: string | ClientConfig) {
    if (typeof config === "string") {
      this.baseUrl = config.replace(/\/$/, "");
      this.timeout = 30000;
    } else {
      this.baseUrl = config.baseUrl.replace(/\/$/, "");
      this.token = config.token;
      this.timeout = config.timeout || 30000;
    }
  }

  /**
   * Make an authenticated request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: response.statusText,
          code: "UNKNOWN",
        }));
        throw new LokiApiClientError(
          error.error || response.statusText,
          error.code || "UNKNOWN",
          response.status
        );
      }

      return response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof LokiApiClientError) {
        throw err;
      }
      throw new LokiApiClientError(
        err instanceof Error ? err.message : "Request failed",
        "NETWORK_ERROR"
      );
    }
  }

  // ============================================================
  // Health Endpoints
  // ============================================================

  /**
   * Check API health
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  /**
   * Get detailed status
   */
  async status(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/api/status");
  }

  // ============================================================
  // Session Endpoints
  // ============================================================

  /**
   * Start a new session
   */
  async startSession(
    options: StartSessionRequest = {}
  ): Promise<StartSessionResponse> {
    return this.request<StartSessionResponse>("POST", "/api/sessions", options);
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<{ sessions: Session[]; total: number }> {
    return this.request<{ sessions: Session[]; total: number }>(
      "GET",
      "/api/sessions"
    );
  }

  /**
   * Get session details
   */
  async getSession(sessionId: string): Promise<SessionStatusResponse> {
    return this.request<SessionStatusResponse>(
      "GET",
      `/api/sessions/${sessionId}`
    );
  }

  /**
   * Stop a session
   */
  async stopSession(
    sessionId: string
  ): Promise<{ sessionId: string; status: string; message: string }> {
    return this.request<{ sessionId: string; status: string; message: string }>(
      "POST",
      `/api/sessions/${sessionId}/stop`
    );
  }

  /**
   * Inject human input into a session
   */
  async injectInput(
    sessionId: string,
    input: string,
    context?: string
  ): Promise<{ sessionId: string; message: string }> {
    return this.request<{ sessionId: string; message: string }>(
      "POST",
      `/api/sessions/${sessionId}/input`,
      { input, context }
    );
  }

  // ============================================================
  // Task Endpoints
  // ============================================================

  /**
   * List tasks for a session
   */
  async getTasks(
    sessionId: string,
    options: { status?: string; limit?: number; offset?: number } = {}
  ): Promise<{ tasks: Task[]; pagination: unknown }> {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));

    const query = params.toString();
    return this.request<{ tasks: Task[]; pagination: unknown }>(
      "GET",
      `/api/sessions/${sessionId}/tasks${query ? `?${query}` : ""}`
    );
  }

  /**
   * Get active tasks across all sessions
   */
  async getActiveTasks(): Promise<{ tasks: Task[]; count: number }> {
    return this.request<{ tasks: Task[]; count: number }>(
      "GET",
      "/api/tasks/active"
    );
  }

  /**
   * Get queued tasks
   */
  async getQueuedTasks(): Promise<{ tasks: Task[]; count: number }> {
    return this.request<{ tasks: Task[]; count: number }>(
      "GET",
      "/api/tasks/queue"
    );
  }

  // ============================================================
  // SSE Event Streaming
  // ============================================================

  /**
   * Subscribe to real-time events
   */
  subscribe(
    callback: (event: AnySSEEvent) => void,
    filter: EventFilter = {}
  ): () => void {
    this.eventCallbacks.push(callback);

    // Connect if not already connected
    if (!this.eventSource) {
      this.connectEventSource(filter);
    }

    // Return unsubscribe function
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }

      // Disconnect if no more subscribers
      if (this.eventCallbacks.length === 0) {
        this.disconnectEventSource();
      }
    };
  }

  /**
   * Connect to SSE endpoint
   */
  private connectEventSource(filter: EventFilter): void {
    const params = new URLSearchParams();
    if (filter.sessionId) params.set("sessionId", filter.sessionId);
    if (filter.types) params.set("types", filter.types.join(","));
    if (filter.minLevel) params.set("minLevel", filter.minLevel);

    const query = params.toString();
    const url = `${this.baseUrl}/api/events${query ? `?${query}` : ""}`;

    this.eventSource = new EventSource(url);

    // Handle all event types
    const eventTypes: EventType[] = [
      "session:started",
      "session:paused",
      "session:resumed",
      "session:stopped",
      "session:completed",
      "session:failed",
      "phase:started",
      "phase:completed",
      "phase:failed",
      "task:created",
      "task:started",
      "task:progress",
      "task:completed",
      "task:failed",
      "agent:spawned",
      "agent:output",
      "agent:completed",
      "agent:failed",
      "log:info",
      "log:warn",
      "log:error",
      "log:debug",
      "metrics:update",
      "input:requested",
      "heartbeat",
    ];

    for (const eventType of eventTypes) {
      this.eventSource.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as AnySSEEvent;
          for (const callback of this.eventCallbacks) {
            callback(event);
          }
        } catch {
          console.warn("Failed to parse SSE event:", e.data);
        }
      });
    }

    this.eventSource.onerror = (err) => {
      console.error("SSE connection error:", err);
      // Reconnect after delay
      setTimeout(() => {
        if (this.eventCallbacks.length > 0) {
          this.disconnectEventSource();
          this.connectEventSource(filter);
        }
      }, 5000);
    };
  }

  /**
   * Disconnect from SSE endpoint
   */
  private disconnectEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Get event history
   */
  async getEventHistory(
    filter: EventFilter = {},
    limit = 100
  ): Promise<{ events: AnySSEEvent[]; count: number }> {
    const params = new URLSearchParams();
    if (filter.sessionId) params.set("sessionId", filter.sessionId);
    if (filter.types) params.set("types", filter.types.join(","));
    params.set("limit", String(limit));

    return this.request<{ events: AnySSEEvent[]; count: number }>(
      "GET",
      `/api/events/history?${params.toString()}`
    );
  }

  /**
   * Close all connections
   */
  close(): void {
    this.disconnectEventSource();
    this.eventCallbacks = [];
  }
}

/**
 * API Client Error
 */
export class LokiApiClientError extends Error {
  code: string;
  status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "LokiApiClientError";
    this.code = code;
    this.status = status;
  }
}

// Export default instance factory
export function createClient(config: string | ClientConfig): LokiClient {
  return new LokiClient(config);
}
