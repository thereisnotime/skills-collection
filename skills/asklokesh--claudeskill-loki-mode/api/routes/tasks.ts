/**
 * Task Routes
 *
 * REST endpoints for task management.
 */

import { cliBridge } from "../services/cli-bridge.ts";
import type { Task } from "../types/api.ts";
import {
  LokiApiError,
  ErrorCodes,
  successResponse,
} from "../middleware/error.ts";

/**
 * GET /api/sessions/:id/tasks - List tasks for a session
 */
export async function listTasks(
  _req: Request,
  sessionId: string
): Promise<Response> {
  const session = await cliBridge.getSession(sessionId);

  if (!session) {
    throw new LokiApiError(
      `Session not found: ${sessionId}`,
      ErrorCodes.SESSION_NOT_FOUND
    );
  }

  const tasks = await cliBridge.getTasks(sessionId);

  // Parse query parameters for filtering
  const url = new URL(_req.url);
  const status = url.searchParams.get("status");
  const limit = parseInt(url.searchParams.get("limit") || "100", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  let filteredTasks = tasks;

  // Filter by status
  if (status) {
    filteredTasks = tasks.filter((t) => t.status === status);
  }

  // Paginate
  const paginatedTasks = filteredTasks.slice(offset, offset + limit);

  return successResponse({
    tasks: paginatedTasks,
    pagination: {
      total: filteredTasks.length,
      limit,
      offset,
      hasMore: offset + limit < filteredTasks.length,
    },
    summary: {
      pending: tasks.filter((t) => t.status === "pending").length,
      running: tasks.filter((t) => t.status === "running").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
    },
  });
}

/**
 * GET /api/sessions/:sessionId/tasks/:taskId - Get a specific task
 */
export async function getTask(
  _req: Request,
  sessionId: string,
  taskId: string
): Promise<Response> {
  const session = await cliBridge.getSession(sessionId);

  if (!session) {
    throw new LokiApiError(
      `Session not found: ${sessionId}`,
      ErrorCodes.SESSION_NOT_FOUND
    );
  }

  const tasks = await cliBridge.getTasks(sessionId);
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    throw new LokiApiError(
      `Task not found: ${taskId}`,
      ErrorCodes.NOT_FOUND
    );
  }

  return successResponse({ task });
}

/**
 * GET /api/tasks - List all tasks across sessions
 */
export async function listAllTasks(req: Request): Promise<Response> {
  const sessions = await cliBridge.listSessions();
  const allTasks: Task[] = [];

  for (const session of sessions) {
    const tasks = await cliBridge.getTasks(session.id);
    allTasks.push(...tasks);
  }

  // Parse query parameters
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = parseInt(url.searchParams.get("limit") || "100", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  let filteredTasks = allTasks;

  if (status) {
    filteredTasks = allTasks.filter((t) => t.status === status);
  }

  // Sort by creation time (newest first)
  filteredTasks.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const paginatedTasks = filteredTasks.slice(offset, offset + limit);

  return successResponse({
    tasks: paginatedTasks,
    pagination: {
      total: filteredTasks.length,
      limit,
      offset,
      hasMore: offset + limit < filteredTasks.length,
    },
  });
}

/**
 * GET /api/tasks/active - Get currently running tasks
 */
export async function getActiveTasks(_req: Request): Promise<Response> {
  const sessions = await cliBridge.listSessions();
  const activeTasks: Task[] = [];

  for (const session of sessions) {
    if (session.status === "running") {
      const tasks = await cliBridge.getTasks(session.id);
      activeTasks.push(...tasks.filter((t) => t.status === "running"));
    }
  }

  return successResponse({
    tasks: activeTasks,
    count: activeTasks.length,
  });
}

/**
 * GET /api/tasks/queue - Get queued tasks
 */
export async function getQueuedTasks(_req: Request): Promise<Response> {
  const sessions = await cliBridge.listSessions();
  const queuedTasks: Task[] = [];

  for (const session of sessions) {
    if (session.status === "running") {
      const tasks = await cliBridge.getTasks(session.id);
      queuedTasks.push(
        ...tasks.filter((t) => t.status === "pending" || t.status === "queued")
      );
    }
  }

  // Sort by priority
  queuedTasks.sort((a, b) => b.priority - a.priority);

  return successResponse({
    tasks: queuedTasks,
    count: queuedTasks.length,
  });
}
