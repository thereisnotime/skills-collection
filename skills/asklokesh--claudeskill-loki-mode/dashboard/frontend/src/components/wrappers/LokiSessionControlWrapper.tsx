/**
 * React wrapper component for the loki-session-control Web Component
 *
 * Provides a type-safe React interface for the session control panel
 * with start/stop/pause/resume functionality.
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
 * Session event detail (for start/pause/resume/stop)
 */
export interface SessionEventDetail {
  mode: string;
  phase: string | null;
  iteration: number | null;
  complexity: string | null;
  connected: boolean;
  version: string | null;
  uptime: number;
  activeAgents: number;
  pendingTasks: number;
}

/**
 * Props for the LokiSessionControlWrapper component
 */
export interface LokiSessionControlWrapperProps {
  /** API base URL (default: http://localhost:57374) */
  apiUrl?: string;
  /** Theme name for styling */
  theme?: ThemeName;
  /** Show compact version of the control panel */
  compact?: boolean;
  /** Callback when start button is clicked */
  onSessionStart?: (detail: SessionEventDetail) => void;
  /** Callback when pause button is clicked */
  onSessionPause?: (detail: SessionEventDetail) => void;
  /** Callback when resume button is clicked */
  onSessionResume?: (detail: SessionEventDetail) => void;
  /** Callback when stop button is clicked */
  onSessionStop?: (detail: SessionEventDetail) => void;
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
      'loki-session-control': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          'api-url'?: string;
          theme?: string;
          compact?: boolean;
          ref?: React.RefObject<HTMLElement | null>;
        },
        HTMLElement
      >;
    }
  }
}

/**
 * React wrapper for the loki-session-control Web Component
 *
 * @example
 * ```tsx
 * <LokiSessionControlWrapper
 *   apiUrl="http://localhost:57374"
 *   theme="dark"
 *   compact={false}
 *   onSessionStart={(status) => {
 *     console.log('Session started:', status.mode);
 *   }}
 *   onSessionStop={(status) => {
 *     console.log('Session stopped');
 *   }}
 * />
 * ```
 */
export function LokiSessionControlWrapper({
  apiUrl = 'http://localhost:57374',
  theme = 'light',
  compact = false,
  onSessionStart,
  onSessionPause,
  onSessionResume,
  onSessionStop,
  className,
  style,
}: LokiSessionControlWrapperProps) {
  // Build events object, only including handlers that are defined
  const events: Record<string, WebComponentEventHandler> = {};
  if (onSessionStart) {
    events['session-start'] = createEventHandler(onSessionStart) as WebComponentEventHandler;
  }
  if (onSessionPause) {
    events['session-pause'] = createEventHandler(onSessionPause) as WebComponentEventHandler;
  }
  if (onSessionResume) {
    events['session-resume'] = createEventHandler(onSessionResume) as WebComponentEventHandler;
  }
  if (onSessionStop) {
    events['session-stop'] = createEventHandler(onSessionStop) as WebComponentEventHandler;
  }

  const { ref } = useWebComponent<{
    'api-url': string;
    theme: string;
    compact: boolean;
  }>({
    tagName: 'loki-session-control',
    props: {
      'api-url': apiUrl,
      theme,
      compact,
    },
    events,
  });

  return (
    <loki-session-control
      ref={ref as React.RefObject<HTMLElement>}
      className={className}
      style={style}
    />
  );
}

export default LokiSessionControlWrapper;
