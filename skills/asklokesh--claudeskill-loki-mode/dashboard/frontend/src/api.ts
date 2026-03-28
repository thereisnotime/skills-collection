/**
 * API client for Loki Mode Dashboard backend.
 * Connects to FastAPI server at /api endpoints.
 */

import { Task, TaskStatus, TaskPriority } from './components/types';

const API_BASE = '/api';

// Backend response types (snake_case from Python)
interface BackendTask {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  position: number;
  assigned_agent_id: number | null;
  parent_task_id: number | null;
  estimated_duration: number | null;
  actual_duration: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface BackendProject {
  id: number;
  name: string;
  description: string | null;
  prd_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  task_count: number;
  completed_task_count: number;
}

// Transform backend task to frontend task
function transformTask(backendTask: BackendTask): Task {
  return {
    id: String(backendTask.id),
    title: backendTask.title,
    description: backendTask.description || '',
    status: backendTask.status as TaskStatus,
    priority: backendTask.priority as TaskPriority,
    type: 'feature', // Backend doesn't have type, default to feature
    assignee: backendTask.assigned_agent_id ? `Agent-${backendTask.assigned_agent_id}` : undefined,
    createdAt: backendTask.created_at,
    updatedAt: backendTask.updated_at,
    completedAt: backendTask.completed_at || undefined,
    estimatedHours: backendTask.estimated_duration ? backendTask.estimated_duration / 60 : undefined,
    tags: [],
  };
}

// Transform frontend task to backend create/update payload
function transformTaskForBackend(task: Partial<Task>, projectId: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    project_id: projectId,
  };

  if (task.title !== undefined) payload.title = task.title;
  if (task.description !== undefined) payload.description = task.description;
  if (task.status !== undefined) payload.status = task.status;
  if (task.priority !== undefined) payload.priority = task.priority;
  if (task.estimatedHours !== undefined) payload.estimated_duration = task.estimatedHours * 60;

  return payload;
}

// API error class
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

// Generic fetch wrapper with error handling
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new ApiError(errorText || response.statusText, response.status);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Projects API
export const projectsApi = {
  list: async (): Promise<BackendProject[]> => {
    return apiFetch<BackendProject[]>('/projects');
  },

  get: async (id: number): Promise<BackendProject> => {
    return apiFetch<BackendProject>(`/projects/${id}`);
  },

  create: async (data: { name: string; prd_path?: string; description?: string }): Promise<BackendProject> => {
    return apiFetch<BackendProject>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: number): Promise<void> => {
    return apiFetch<void>(`/projects/${id}`, {
      method: 'DELETE',
    });
  },
};

// Tasks API
export const tasksApi = {
  list: async (projectId?: number): Promise<Task[]> => {
    const query = projectId ? `?project_id=${projectId}` : '';
    const backendTasks = await apiFetch<BackendTask[]>(`/tasks${query}`);
    return backendTasks.map(transformTask);
  },

  get: async (id: number): Promise<Task> => {
    const backendTask = await apiFetch<BackendTask>(`/tasks/${id}`);
    return transformTask(backendTask);
  },

  create: async (task: Partial<Task>, projectId: number): Promise<Task> => {
    const payload = transformTaskForBackend(task, projectId);
    const backendTask = await apiFetch<BackendTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return transformTask(backendTask);
  },

  update: async (id: number, task: Partial<Task>): Promise<Task> => {
    const payload: Record<string, unknown> = {};
    if (task.title !== undefined) payload.title = task.title;
    if (task.description !== undefined) payload.description = task.description;
    if (task.status !== undefined) payload.status = task.status;
    if (task.priority !== undefined) payload.priority = task.priority;

    const backendTask = await apiFetch<BackendTask>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return transformTask(backendTask);
  },

  delete: async (id: number): Promise<void> => {
    return apiFetch<void>(`/tasks/${id}`, {
      method: 'DELETE',
    });
  },

  move: async (id: number, status: TaskStatus, position: number): Promise<Task> => {
    const backendTask = await apiFetch<BackendTask>(`/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ status, position }),
    });
    return transformTask(backendTask);
  },
};

// WebSocket connection for real-time updates
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  connect(): void {
    // Clear any pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const eventType = message.type;

        // Notify listeners for this event type
        const typeListeners = this.listeners.get(eventType);
        if (typeListeners) {
          typeListeners.forEach((listener) => listener(message.data));
        }

        // Notify wildcard listeners
        const wildcardListeners = this.listeners.get('*');
        if (wildcardListeners) {
          wildcardListeners.forEach((listener) => listener(message));
        }
      } catch (error) {
        console.error('WebSocket message parse error:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      this.reconnectTimeout = setTimeout(() => this.connect(), delay);
    }
  }

  on(eventType: string, listener: (data: unknown) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  disconnect(): void {
    // Clear reconnect timeout to prevent memory leaks
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton WebSocket instance
export const wsClient = new WebSocketClient();
