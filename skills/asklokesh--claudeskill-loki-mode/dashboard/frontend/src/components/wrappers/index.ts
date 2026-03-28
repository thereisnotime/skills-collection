/**
 * React Wrapper Components for Loki Mode Dashboard UI Web Components
 *
 * These wrappers provide a type-safe React interface for consuming
 * the dashboard-ui Web Components with proper prop binding, event
 * handling, and TypeScript support.
 *
 * @example
 * ```tsx
 * import {
 *   LokiTaskBoardWrapper,
 *   LokiSessionControlWrapper,
 *   LokiMemoryBrowserWrapper,
 * } from './components/wrappers';
 *
 * function Dashboard() {
 *   return (
 *     <div>
 *       <LokiSessionControlWrapper
 *         apiUrl="http://localhost:57374"
 *         theme="dark"
 *         onSessionStart={() => console.log('Started')}
 *       />
 *       <LokiTaskBoardWrapper
 *         apiUrl="http://localhost:57374"
 *         theme="dark"
 *         onTaskMoved={({ taskId, newStatus }) => {
 *           console.log(`Task ${taskId} moved to ${newStatus}`);
 *         }}
 *       />
 *       <LokiMemoryBrowserWrapper
 *         apiUrl="http://localhost:57374"
 *         theme="dark"
 *         tab="episodes"
 *       />
 *     </div>
 *   );
 * }
 * ```
 */

// Task Board Component
export {
  LokiTaskBoardWrapper,
  type LokiTaskBoardWrapperProps,
  type Task,
  type TaskMovedEventDetail,
  type AddTaskEventDetail,
  type TaskClickEventDetail,
} from './LokiTaskBoardWrapper';

// Session Control Component
export {
  LokiSessionControlWrapper,
  type LokiSessionControlWrapperProps,
  type SessionEventDetail,
} from './LokiSessionControlWrapper';

// Memory Browser Component
export {
  LokiMemoryBrowserWrapper,
  type LokiMemoryBrowserWrapperProps,
  type MemoryBrowserTab,
  type Episode,
  type Pattern,
  type Skill,
} from './LokiMemoryBrowserWrapper';

// Re-export ThemeName from one of the wrappers for convenience
export type { ThemeName } from './LokiTaskBoardWrapper';
