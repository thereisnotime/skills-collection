/**
 * Event Bus Service
 *
 * Central event distribution system for SSE streaming.
 * Implements pub/sub pattern with filtering support.
 */

import type {
  SSEEvent,
  EventType,
  EventFilter,
  AnySSEEvent,
} from "../types/events.ts";

type EventCallback = (event: AnySSEEvent) => void;

interface Subscription {
  id: string;
  filter: EventFilter;
  callback: EventCallback;
}

class EventBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private eventHistory: AnySSEEvent[] = [];
  private maxHistorySize = 1000;
  private eventCounter = 0;

  /**
   * Subscribe to events with optional filtering
   */
  subscribe(filter: EventFilter, callback: EventCallback): string {
    const id = crypto.randomUUID();
    this.subscriptions.set(id, { id, filter, callback });
    return id;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Publish an event to all matching subscribers
   */
  publish<T>(
    type: EventType,
    sessionId: string,
    data: T
  ): SSEEvent<T> {
    const event: SSEEvent<T> = {
      id: `evt_${++this.eventCounter}_${Date.now()}`,
      type,
      timestamp: new Date().toISOString(),
      sessionId,
      data,
    };

    // Store in history
    this.eventHistory.push(event as AnySSEEvent);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Dispatch to subscribers
    for (const sub of this.subscriptions.values()) {
      if (this.matchesFilter(event as AnySSEEvent, sub.filter)) {
        try {
          sub.callback(event as AnySSEEvent);
        } catch (err) {
          console.error(`Event callback error for ${sub.id}:`, err);
        }
      }
    }

    return event;
  }

  /**
   * Get recent events matching a filter
   */
  getHistory(filter: EventFilter, limit = 100): AnySSEEvent[] {
    return this.eventHistory
      .filter((event) => this.matchesFilter(event, filter))
      .slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get subscriber count
   */
  getSubscriberCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Check if event matches filter
   */
  private matchesFilter(event: AnySSEEvent, filter: EventFilter): boolean {
    // Filter by event types
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(event.type)) {
        return false;
      }
    }

    // Filter by session ID
    if (filter.sessionId && event.sessionId !== filter.sessionId) {
      return false;
    }

    // Filter by log level (for log events)
    if (filter.minLevel && event.type.startsWith("log:")) {
      const levels = ["debug", "info", "warn", "error"];
      const eventLevel = event.type.split(":")[1];
      const minIndex = levels.indexOf(filter.minLevel);
      const eventIndex = levels.indexOf(eventLevel);
      if (eventIndex < minIndex) {
        return false;
      }
    }

    return true;
  }
}

// Singleton instance
export const eventBus = new EventBus();

// Convenience functions
export function emitSessionEvent(
  type: Extract<EventType, `session:${string}`>,
  sessionId: string,
  data: { status: string; message?: string; exitCode?: number }
) {
  return eventBus.publish(type, sessionId, data);
}

export function emitPhaseEvent(
  type: Extract<EventType, `phase:${string}`>,
  sessionId: string,
  data: { phase: string; previousPhase?: string; progress?: number }
) {
  return eventBus.publish(type, sessionId, data);
}

export function emitTaskEvent(
  type: Extract<EventType, `task:${string}`>,
  sessionId: string,
  data: { taskId: string; title: string; status: string; [key: string]: unknown }
) {
  return eventBus.publish(type, sessionId, data);
}

export function emitAgentEvent(
  type: Extract<EventType, `agent:${string}`>,
  sessionId: string,
  data: { agentId: string; type: string; [key: string]: unknown }
) {
  return eventBus.publish(type, sessionId, data);
}

export function emitLogEvent(
  level: "info" | "warn" | "error" | "debug",
  sessionId: string,
  message: string,
  source?: string
) {
  return eventBus.publish(`log:${level}`, sessionId, {
    level,
    message,
    source,
  });
}

export function emitHeartbeat(
  sessionId: string,
  data: { uptime: number; activeAgents: number; queuedTasks: number }
) {
  return eventBus.publish("heartbeat", sessionId, data);
}
