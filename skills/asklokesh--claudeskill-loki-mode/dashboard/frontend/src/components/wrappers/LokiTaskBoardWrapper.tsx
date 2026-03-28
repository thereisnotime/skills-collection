/**
 * React wrapper component for the loki-task-board Web Component
 *
 * Provides a type-safe React interface for the Kanban-style task board
 * with proper prop binding and event handling.
 */

import {
  useWebComponent,
  createEventHandler,
  type WebComponentEventHandler,
} from '../../hooks/useWebComponent';

// ============================================================================
// Types (mirrored from dashboard-ui/types/index.d.ts)
// ============================================================================

/**
 * Available theme names
 */
export type ThemeName =
  | 'light'
  | 'dark'
  | 'high-contrast'
  | 'vscode-light'
  | 'vscode-dark';

/**
 * Task object
 */
export interface Task {
  id: number | string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'review' | 'done';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  type?: string;
  project_id?: number;
  assigned_agent_id?: number;
  isLocal?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Task moved event detail
 */
export interface TaskMovedEventDetail {
  taskId: number | string;
  oldStatus: string;
  newStatus: string;
}

/**
 * Add task event detail
 */
export interface AddTaskEventDetail {
  status: string;
}

/**
 * Task click event detail
 */
export interface TaskClickEventDetail {
  task: Task;
}

/**
 * Props for the LokiTaskBoardWrapper component
 */
export interface LokiTaskBoardWrapperProps {
  /** API base URL (default: http://localhost:57374) */
  apiUrl?: string;
  /** Filter tasks by project ID */
  projectId?: string;
  /** Theme name for styling */
  theme?: ThemeName;
  /** Disable drag-drop and editing */
  readonly?: boolean;
  /** Callback when a task is moved between columns */
  onTaskMoved?: (detail: TaskMovedEventDetail) => void;
  /** Callback when add task button is clicked */
  onAddTask?: (detail: AddTaskEventDetail) => void;
  /** Callback when a task card is clicked */
  onTaskClick?: (detail: TaskClickEventDetail) => void;
  /** Additional CSS class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
}

// Extend JSX to recognize the custom element
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'loki-task-board': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          'api-url'?: string;
          'project-id'?: string;
          theme?: string;
          readonly?: boolean;
          ref?: React.RefObject<HTMLElement | null>;
        },
        HTMLElement
      >;
    }
  }
}

/**
 * React wrapper for the loki-task-board Web Component
 *
 * @example
 * ```tsx
 * <LokiTaskBoardWrapper
 *   apiUrl="http://localhost:57374"
 *   projectId="1"
 *   theme="dark"
 *   onTaskMoved={({ taskId, oldStatus, newStatus }) => {
 *     console.log(`Task ${taskId} moved from ${oldStatus} to ${newStatus}`);
 *   }}
 *   onTaskClick={({ task }) => {
 *     openTaskModal(task);
 *   }}
 * />
 * ```
 */
export function LokiTaskBoardWrapper({
  apiUrl = 'http://localhost:57374',
  projectId,
  theme = 'light',
  readonly = false,
  onTaskMoved,
  onAddTask,
  onTaskClick,
  className,
  style,
}: LokiTaskBoardWrapperProps) {
  // Build events object, only including handlers that are defined
  const events: Record<string, WebComponentEventHandler> = {};
  if (onTaskMoved) {
    events['task-moved'] = createEventHandler(onTaskMoved) as WebComponentEventHandler;
  }
  if (onAddTask) {
    events['add-task'] = createEventHandler(onAddTask) as WebComponentEventHandler;
  }
  if (onTaskClick) {
    events['task-click'] = createEventHandler(onTaskClick) as WebComponentEventHandler;
  }

  const { ref } = useWebComponent<{
    'api-url': string;
    'project-id'?: string;
    theme: string;
    readonly: boolean;
  }>({
    tagName: 'loki-task-board',
    props: {
      'api-url': apiUrl,
      'project-id': projectId,
      theme,
      readonly,
    },
    events,
  });

  return (
    <loki-task-board
      ref={ref as React.RefObject<HTMLElement>}
      className={className}
      style={style}
    />
  );
}

export default LokiTaskBoardWrapper;
