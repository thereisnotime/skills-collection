/**
 * React wrapper component for the loki-memory-browser Web Component
 *
 * Provides a type-safe React interface for the memory system browser
 * with episodic, semantic, and procedural memory tabs.
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
 * Episode object from memory system
 */
export interface Episode {
  id: string;
  taskId?: string;
  agent?: string;
  phase?: string;
  outcome?: 'success' | 'failure' | 'partial';
  timestamp: string;
  durationSeconds?: number;
  tokensUsed?: number;
  goal?: string;
  actionLog?: Array<{
    t: number;
    action: string;
    target: string;
  }>;
}

/**
 * Pattern object from memory system
 */
export interface Pattern {
  id: string;
  pattern: string;
  category?: string;
  confidence: number;
  usageCount?: number;
  conditions?: string[];
  correctApproach?: string;
  incorrectApproach?: string;
}

/**
 * Skill object from memory system
 */
export interface Skill {
  id: string;
  name: string;
  description?: string;
  prerequisites?: string[];
  steps?: string[];
  exitCriteria?: string[];
}

/**
 * Available tabs in the memory browser
 */
export type MemoryBrowserTab = 'summary' | 'episodes' | 'patterns' | 'skills';

/**
 * Props for the LokiMemoryBrowserWrapper component
 */
export interface LokiMemoryBrowserWrapperProps {
  /** API base URL (default: http://localhost:57374) */
  apiUrl?: string;
  /** Theme name for styling */
  theme?: ThemeName;
  /** Initial active tab */
  tab?: MemoryBrowserTab;
  /** Callback when an episode is selected */
  onEpisodeSelect?: (episode: Episode) => void;
  /** Callback when a pattern is selected */
  onPatternSelect?: (pattern: Pattern) => void;
  /** Callback when a skill is selected */
  onSkillSelect?: (skill: Skill) => void;
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
      'loki-memory-browser': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          'api-url'?: string;
          theme?: string;
          tab?: string;
          ref?: React.RefObject<HTMLElement | null>;
        },
        HTMLElement
      >;
    }
  }
}

/**
 * React wrapper for the loki-memory-browser Web Component
 *
 * @example
 * ```tsx
 * <LokiMemoryBrowserWrapper
 *   apiUrl="http://localhost:57374"
 *   theme="dark"
 *   tab="episodes"
 *   onEpisodeSelect={(episode) => {
 *     console.log('Selected episode:', episode.id);
 *   }}
 *   onPatternSelect={(pattern) => {
 *     console.log('Selected pattern:', pattern.pattern);
 *   }}
 *   onSkillSelect={(skill) => {
 *     console.log('Selected skill:', skill.name);
 *   }}
 * />
 * ```
 */
export function LokiMemoryBrowserWrapper({
  apiUrl = 'http://localhost:57374',
  theme = 'light',
  tab = 'summary',
  onEpisodeSelect,
  onPatternSelect,
  onSkillSelect,
  className,
  style,
}: LokiMemoryBrowserWrapperProps) {
  // Build events object, only including handlers that are defined
  const events: Record<string, WebComponentEventHandler> = {};
  if (onEpisodeSelect) {
    events['episode-select'] = createEventHandler(onEpisodeSelect) as WebComponentEventHandler;
  }
  if (onPatternSelect) {
    events['pattern-select'] = createEventHandler(onPatternSelect) as WebComponentEventHandler;
  }
  if (onSkillSelect) {
    events['skill-select'] = createEventHandler(onSkillSelect) as WebComponentEventHandler;
  }

  const { ref } = useWebComponent<{
    'api-url': string;
    theme: string;
    tab: string;
  }>({
    tagName: 'loki-memory-browser',
    props: {
      'api-url': apiUrl,
      theme,
      tab,
    },
    events,
  });

  return (
    <loki-memory-browser
      ref={ref as React.RefObject<HTMLElement>}
      className={className}
      style={style}
    />
  );
}

export default LokiMemoryBrowserWrapper;
