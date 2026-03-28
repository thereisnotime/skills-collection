/**
 * SSE Events Route
 *
 * Server-Sent Events endpoint for real-time streaming.
 */

import { eventBus } from "../services/event-bus.ts";
import type { EventFilter, EventType, AnySSEEvent } from "../types/events.ts";

/**
 * GET /api/events - SSE stream
 *
 * Query parameters:
 * - sessionId: Filter by session ID
 * - types: Comma-separated event types to subscribe to
 * - history: Number of historical events to replay (default: 0)
 * - minLevel: Minimum log level (debug, info, warn, error)
 */
export function streamEvents(req: Request): Response {
  const url = new URL(req.url);

  // Parse filter from query parameters
  const filter: EventFilter = {};

  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) {
    filter.sessionId = sessionId;
  }

  const types = url.searchParams.get("types");
  if (types) {
    filter.types = types.split(",") as EventType[];
  }

  const minLevel = url.searchParams.get("minLevel");
  if (minLevel) {
    filter.minLevel = minLevel as "debug" | "info" | "warn" | "error";
  }

  const historyCount = parseInt(url.searchParams.get("history") || "0", 10);

  // Create readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Helper to send an event
      const sendEvent = (event: AnySSEEvent) => {
        const data = JSON.stringify(event);
        const message = `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // Send comment to establish connection
      controller.enqueue(
        encoder.encode(`: connected to loki-mode event stream\n\n`)
      );

      // Replay historical events if requested
      if (historyCount > 0) {
        const history = eventBus.getHistory(filter, historyCount);
        for (const event of history) {
          sendEvent(event);
        }
        controller.enqueue(
          encoder.encode(`: replayed ${history.length} historical events\n\n`)
        );
      }

      // Subscribe to new events
      const subscriptionId = eventBus.subscribe(filter, (event) => {
        try {
          sendEvent(event);
        } catch {
          // Client disconnected
          eventBus.unsubscribe(subscriptionId);
        }
      });

      // Handle client disconnect
      req.signal.addEventListener("abort", () => {
        eventBus.unsubscribe(subscriptionId);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });

      // Send periodic keep-alive comments
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`: keep-alive ${Date.now()}\n\n`)
          );
        } catch {
          clearInterval(keepAliveInterval);
          eventBus.unsubscribe(subscriptionId);
        }
      }, 15000); // Every 15 seconds

      // Store cleanup function
      req.signal.addEventListener("abort", () => {
        clearInterval(keepAliveInterval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}

/**
 * GET /api/events/history - Get historical events
 */
export function getEventHistory(req: Request): Response {
  const url = new URL(req.url);

  const filter: EventFilter = {};

  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) {
    filter.sessionId = sessionId;
  }

  const types = url.searchParams.get("types");
  if (types) {
    filter.types = types.split(",") as EventType[];
  }

  const limit = parseInt(url.searchParams.get("limit") || "100", 10);

  const events = eventBus.getHistory(filter, limit);

  return new Response(
    JSON.stringify({
      events,
      count: events.length,
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * GET /api/events/stats - Get event statistics
 */
export function getEventStats(_req: Request): Response {
  return new Response(
    JSON.stringify({
      subscribers: eventBus.getSubscriberCount(),
      historySize: eventBus.getHistory({}).length,
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}
