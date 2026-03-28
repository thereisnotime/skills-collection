/**
 * Loki Mode Dashboard UI - TypeScript Type Definitions
 *
 * Provides comprehensive type definitions for the dashboard-ui web components
 * library. Enables type-safe consumption in React, VS Code extensions, and
 * other TypeScript projects.
 *
 * @version 1.2.0
 */

// =============================================================================
// THEME TYPES
// =============================================================================

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
 * Detection context for theme auto-detection
 */
export type ThemeContext = 'browser' | 'vscode' | 'cli';

/**
 * CSS custom property names used in themes
 */
export type CSSCustomProperty =
  // Background colors
  | '--loki-bg-primary'
  | '--loki-bg-secondary'
  | '--loki-bg-tertiary'
  | '--loki-bg-card'
  | '--loki-bg-hover'
  | '--loki-bg-active'
  | '--loki-bg-overlay'
  // Accent colors
  | '--loki-accent'
  | '--loki-accent-hover'
  | '--loki-accent-active'
  | '--loki-accent-light'
  | '--loki-accent-muted'
  // Text colors
  | '--loki-text-primary'
  | '--loki-text-secondary'
  | '--loki-text-muted'
  | '--loki-text-disabled'
  | '--loki-text-inverse'
  // Border colors
  | '--loki-border'
  | '--loki-border-light'
  | '--loki-border-focus'
  // Status colors
  | '--loki-success'
  | '--loki-success-muted'
  | '--loki-warning'
  | '--loki-warning-muted'
  | '--loki-error'
  | '--loki-error-muted'
  | '--loki-info'
  | '--loki-info-muted'
  // Legacy status colors
  | '--loki-green'
  | '--loki-green-muted'
  | '--loki-yellow'
  | '--loki-yellow-muted'
  | '--loki-red'
  | '--loki-red-muted'
  | '--loki-blue'
  | '--loki-blue-muted'
  | '--loki-purple'
  | '--loki-purple-muted'
  // Model colors
  | '--loki-opus'
  | '--loki-sonnet'
  | '--loki-haiku'
  // Shadows
  | '--loki-shadow-sm'
  | '--loki-shadow-md'
  | '--loki-shadow-lg'
  | '--loki-shadow-focus';

/**
 * Theme definition with CSS custom properties
 */
export type ThemeDefinition = {
  [K in CSSCustomProperty]: string;
};

/**
 * All theme definitions mapped by name
 */
export type ThemeDefinitions = {
  [K in ThemeName]: ThemeDefinition;
};

// =============================================================================
// DESIGN TOKEN TYPES
// =============================================================================

/**
 * Spacing scale values
 */
export interface SpacingScale {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  '3xl': string;
}

/**
 * Border radius scale values
 */
export interface RadiusScale {
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}

/**
 * Typography configuration
 */
export interface TypographyConfig {
  fontFamily: {
    sans: string;
    mono: string;
  };
  fontSize: {
    xs: string;
    sm: string;
    base: string;
    md: string;
    lg: string;
    xl: string;
    '2xl': string;
    '3xl': string;
  };
  fontWeight: {
    normal: string;
    medium: string;
    semibold: string;
    bold: string;
  };
  lineHeight: {
    tight: string;
    normal: string;
    relaxed: string;
  };
}

/**
 * Animation timing configuration
 */
export interface AnimationConfig {
  duration: {
    fast: string;
    normal: string;
    slow: string;
    slower: string;
  };
  easing: {
    default: string;
    in: string;
    out: string;
    bounce: string;
  };
}

/**
 * Responsive breakpoints
 */
export interface BreakpointsConfig {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
}

/**
 * Z-index scale
 */
export interface ZIndexScale {
  base: string;
  dropdown: string;
  sticky: string;
  modal: string;
  popover: string;
  tooltip: string;
  toast: string;
}

// =============================================================================
// KEYBOARD SHORTCUT TYPES
// =============================================================================

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  key: string;
  modifiers: Array<'Ctrl' | 'Meta' | 'Shift' | 'Alt'>;
}

/**
 * All available keyboard shortcuts
 */
export interface KeyboardShortcuts {
  // Navigation
  'navigation.nextItem': KeyboardShortcut;
  'navigation.prevItem': KeyboardShortcut;
  'navigation.nextSection': KeyboardShortcut;
  'navigation.prevSection': KeyboardShortcut;
  'navigation.confirm': KeyboardShortcut;
  'navigation.cancel': KeyboardShortcut;
  // Actions
  'action.refresh': KeyboardShortcut;
  'action.search': KeyboardShortcut;
  'action.save': KeyboardShortcut;
  'action.close': KeyboardShortcut;
  // Theme
  'theme.toggle': KeyboardShortcut;
  // Tasks
  'task.create': KeyboardShortcut;
  'task.complete': KeyboardShortcut;
  // View
  'view.toggleLogs': KeyboardShortcut;
  'view.toggleMemory': KeyboardShortcut;
}

/**
 * Keyboard shortcut action name
 */
export type KeyboardAction = keyof KeyboardShortcuts;

// =============================================================================
// ARIA PATTERN TYPES
// =============================================================================

/**
 * ARIA pattern attribute definitions
 */
export interface AriaPattern {
  role?: string;
  tabIndex?: number;
  ariaSelected?: boolean;
  ariaLive?: 'polite' | 'assertive' | 'off';
  ariaAtomic?: boolean;
  ariaModal?: boolean;
  ariaRelevant?: string;
}

/**
 * Available ARIA patterns
 */
export interface AriaPatterns {
  button: AriaPattern;
  tablist: AriaPattern;
  tab: AriaPattern;
  tabpanel: AriaPattern;
  list: AriaPattern;
  listitem: AriaPattern;
  livePolite: AriaPattern;
  liveAssertive: AriaPattern;
  dialog: AriaPattern;
  alertdialog: AriaPattern;
  status: AriaPattern;
  alert: AriaPattern;
  log: AriaPattern;
}

// =============================================================================
// API CLIENT TYPES
// =============================================================================

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl?: string;
  wsUrl?: string;
  pollInterval?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * API event types emitted by LokiApiClient
 */
export interface ApiEventTypes {
  CONNECTED: 'api:connected';
  DISCONNECTED: 'api:disconnected';
  ERROR: 'api:error';
  STATUS_UPDATE: 'api:status-update';
  TASK_CREATED: 'api:task-created';
  TASK_UPDATED: 'api:task-updated';
  TASK_DELETED: 'api:task-deleted';
  PROJECT_CREATED: 'api:project-created';
  PROJECT_UPDATED: 'api:project-updated';
  AGENT_UPDATE: 'api:agent-update';
  LOG_MESSAGE: 'api:log-message';
  MEMORY_UPDATE: 'api:memory-update';
}

/**
 * API event names (union type)
 */
export type ApiEventName = ApiEventTypes[keyof ApiEventTypes];

/**
 * Task filter parameters
 */
export interface TaskFilters {
  projectId?: number;
  status?: string;
  priority?: string;
}

/**
 * Task object returned by API
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
 * Project object returned by API
 */
export interface Project {
  id: number;
  name: string;
  description?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * System status returned by API
 */
export interface SystemStatus {
  status: string;
  version?: string;
  uptime_seconds?: number;
  running_agents?: number;
  pending_tasks?: number;
  phase?: string;
  iteration?: number;
  complexity?: string;
}

/**
 * Memory summary returned by API
 */
export interface MemorySummary {
  episodic?: {
    count: number;
    latestDate?: string;
  };
  semantic?: {
    patterns: number;
    antiPatterns: number;
  };
  procedural?: {
    skills: number;
  };
  tokenEconomics?: TokenEconomics;
}

/**
 * Token economics data
 */
export interface TokenEconomics {
  discoveryTokens?: number;
  readTokens?: number;
  savingsPercent?: number;
}

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
 * Learning metrics query parameters
 */
export interface LearningMetricsParams {
  timeRange?: '1h' | '24h' | '7d' | '30d';
  signalType?: string;
  source?: string;
}

/**
 * Learning signals query parameters
 */
export interface LearningSignalsParams extends LearningMetricsParams {
  limit?: number;
  offset?: number;
}

/**
 * Learning metrics response
 */
export interface LearningMetrics {
  totalSignals?: number;
  signalsByType?: Record<string, number>;
  signalsBySource?: Record<string, number>;
  avgConfidence?: number;
  aggregation?: {
    preferences?: UserPreference[];
    error_patterns?: ErrorPattern[];
    success_patterns?: SuccessPattern[];
    tool_efficiencies?: ToolEfficiency[];
  };
}

/**
 * User preference aggregation
 */
export interface UserPreference {
  preference_key: string;
  preferred_value: unknown;
  frequency: number;
  confidence: number;
  alternatives_rejected?: string[];
  sources?: string[];
  first_seen?: string;
  last_seen?: string;
}

/**
 * Error pattern aggregation
 */
export interface ErrorPattern {
  error_type: string;
  resolution_rate: number;
  frequency: number;
  confidence: number;
  common_messages?: string[];
  resolutions?: string[];
  sources?: string[];
  first_seen?: string;
  last_seen?: string;
}

/**
 * Success pattern aggregation
 */
export interface SuccessPattern {
  pattern_name: string;
  avg_duration_seconds: number;
  frequency: number;
  confidence: number;
  common_actions?: string[];
  sources?: string[];
  first_seen?: string;
  last_seen?: string;
}

/**
 * Tool efficiency aggregation
 */
export interface ToolEfficiency {
  tool_name: string;
  usage_count: number;
  success_rate: number;
  avg_execution_time_ms: number;
  total_tokens_used: number;
  efficiency_score: number;
  alternative_tools?: string[];
  sources?: string[];
  first_seen?: string;
  last_seen?: string;
}

/**
 * Learning signal object
 */
export interface LearningSignal {
  type: string;
  action: string;
  source: string;
  outcome: 'success' | 'failure' | 'partial' | 'unknown';
  timestamp: string;
  confidence?: number;
}

/**
 * Trend data response
 */
export interface TrendData {
  period: string;
  maxValue: number;
  dataPoints: Array<{
    label: string;
    count: number;
  }>;
}

/**
 * Memory consolidation result
 */
export interface ConsolidationResult {
  patternsCreated: number;
  patternsMerged: number;
  episodesProcessed: number;
}

/**
 * Loki API Client class
 */
export declare class LokiApiClient extends EventTarget {
  static getInstance(config?: ApiClientConfig): LokiApiClient;
  static clearInstances(): void;

  constructor(config?: ApiClientConfig);

  readonly baseUrl: string;
  readonly isConnected: boolean;

  // Connection management
  connect(): Promise<void>;
  disconnect(): void;
  startPolling(callback?: (status: SystemStatus) => void, interval?: number): void;
  stopPolling(): void;

  // Status API
  getStatus(): Promise<SystemStatus>;
  healthCheck(): Promise<{ status: string }>;

  // Projects API
  listProjects(status?: string | null): Promise<Project[]>;
  getProject(projectId: number): Promise<Project>;
  createProject(data: Partial<Project>): Promise<Project>;
  updateProject(projectId: number, data: Partial<Project>): Promise<Project>;
  deleteProject(projectId: number): Promise<void>;

  // Tasks API
  listTasks(filters?: TaskFilters): Promise<Task[]>;
  getTask(taskId: number): Promise<Task>;
  createTask(data: Partial<Task>): Promise<Task>;
  updateTask(taskId: number, data: Partial<Task>): Promise<Task>;
  moveTask(taskId: number, status: string, position: number): Promise<Task>;
  deleteTask(taskId: number): Promise<void>;

  // Memory API
  getMemorySummary(): Promise<MemorySummary>;
  getMemoryIndex(): Promise<unknown>;
  getMemoryTimeline(): Promise<unknown>;
  listEpisodes(params?: { limit?: number }): Promise<Episode[]>;
  getEpisode(episodeId: string): Promise<Episode>;
  listPatterns(params?: Record<string, unknown>): Promise<Pattern[]>;
  getPattern(patternId: string): Promise<Pattern>;
  listSkills(): Promise<Skill[]>;
  getSkill(skillId: string): Promise<Skill>;
  retrieveMemories(query: string, taskType?: string | null, topK?: number): Promise<unknown>;
  consolidateMemory(sinceHours?: number): Promise<ConsolidationResult>;
  getTokenEconomics(): Promise<TokenEconomics>;

  // Registry API
  listRegisteredProjects(includeInactive?: boolean): Promise<unknown[]>;
  registerProject(path: string, name?: string | null, alias?: string | null): Promise<unknown>;
  discoverProjects(maxDepth?: number): Promise<unknown[]>;
  syncRegistry(): Promise<unknown>;
  getCrossProjectTasks(projectIds?: number[] | null): Promise<Task[]>;

  // Learning API
  getLearningMetrics(params?: LearningMetricsParams): Promise<LearningMetrics>;
  getLearningTrends(params?: LearningMetricsParams): Promise<TrendData>;
  getLearningSignals(params?: LearningSignalsParams): Promise<LearningSignal[]>;
  getLatestAggregation(): Promise<unknown>;
  triggerAggregation(params?: Record<string, unknown>): Promise<unknown>;
  getAggregatedPreferences(limit?: number): Promise<UserPreference[]>;
  getAggregatedErrors(limit?: number): Promise<ErrorPattern[]>;
  getAggregatedSuccessPatterns(limit?: number): Promise<SuccessPattern[]>;
  getToolEfficiency(limit?: number): Promise<ToolEfficiency[]>;
}

// =============================================================================
// STATE MANAGEMENT TYPES
// =============================================================================

/**
 * UI state structure
 */
export interface UIState {
  theme: ThemeName;
  sidebarCollapsed: boolean;
  activeSection: string;
  terminalAutoScroll: boolean;
}

/**
 * Session state structure
 */
export interface SessionState {
  connected: boolean;
  lastSync: string | null;
  mode: string;
  phase: string | null;
  iteration: number | null;
}

/**
 * Cache state structure
 */
export interface CacheState {
  projects: Project[];
  tasks: Task[];
  agents: unknown[];
  memory: unknown | null;
  lastFetch: string | null;
}

/**
 * User preferences structure
 */
export interface PreferencesState {
  pollInterval: number;
  notifications: boolean;
  soundEnabled: boolean;
}

/**
 * Local task (not synced to server)
 */
export interface LocalTask extends Partial<Task> {
  id: string;
  createdAt: string;
  status: string;
}

/**
 * Complete state structure
 */
export interface AppState {
  ui: UIState;
  session: SessionState;
  localTasks: LocalTask[];
  cache: CacheState;
  preferences: PreferencesState;
}

/**
 * State change callback function
 */
export type StateChangeCallback = (
  newValue: unknown,
  oldValue: unknown,
  path: string
) => void;

/**
 * State change event detail
 */
export interface StateChangeEventDetail {
  path: string | null;
  value: unknown;
  oldValue: unknown;
}

/**
 * Loki State class for client-side state management
 */
export declare class LokiState extends EventTarget {
  static STORAGE_KEY: string;
  static getInstance(): LokiState;

  constructor();

  // State access
  get(path?: string | null): unknown;
  set(path: string, value: unknown, persist?: boolean): void;
  update(updates: Record<string, unknown>, persist?: boolean): void;
  subscribe(path: string, callback: StateChangeCallback): () => void;
  reset(path?: string | null): void;

  // Convenience methods for local tasks
  addLocalTask(task: Partial<LocalTask>): LocalTask;
  updateLocalTask(taskId: string, updates: Partial<LocalTask>): LocalTask | null;
  deleteLocalTask(taskId: string): void;
  moveLocalTask(taskId: string, newStatus: string, position?: number | null): LocalTask | null;

  // Session and cache helpers
  updateSession(updates: Partial<SessionState>): void;
  updateCache(data: Partial<CacheState>): void;
  getMergedTasks(): Task[];
  getTasksByStatus(status: string): Task[];
}

/**
 * Reactive store interface
 */
export interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(callback: StateChangeCallback): () => void;
}

// =============================================================================
// THEME MANAGER TYPES
// =============================================================================

/**
 * Theme change event detail
 */
export interface ThemeChangeEventDetail {
  theme: ThemeName;
  context: ThemeContext;
}

/**
 * Unified Theme Manager class
 */
export declare class UnifiedThemeManager {
  static STORAGE_KEY: string;
  static CONTEXT_KEY: string;

  static detectContext(): ThemeContext;
  static detectVSCodeTheme(): 'light' | 'dark' | 'high-contrast' | null;
  static getTheme(): ThemeName;
  static setTheme(theme: ThemeName): void;
  static toggle(): ThemeName;
  static getVariables(theme?: ThemeName | null): ThemeDefinition;
  static generateCSS(theme?: ThemeName | null): string;
  static init(): void;
}

/**
 * Keyboard Handler class
 */
export declare class KeyboardHandler {
  constructor();

  register(action: KeyboardAction, handler: (event: KeyboardEvent) => void): void;
  unregister(action: KeyboardAction): void;
  setEnabled(enabled: boolean): void;
  handleEvent(event: KeyboardEvent): boolean;
  attach(element: HTMLElement): void;
  detach(element: HTMLElement): void;
}

// =============================================================================
// WEB COMPONENT EVENT TYPES
// =============================================================================

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
 * Log entry for log stream component
 */
export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error' | 'step' | 'agent' | 'debug';
  message: string;
}

/**
 * Log received event detail
 */
export interface LogReceivedEventDetail extends LogEntry {}

/**
 * Episode select event detail
 */
export interface EpisodeSelectEventDetail extends Episode {}

/**
 * Pattern select event detail
 */
export interface PatternSelectEventDetail extends Pattern {}

/**
 * Skill select event detail
 */
export interface SkillSelectEventDetail extends Skill {}

/**
 * Metric select event detail (learning dashboard)
 */
export interface MetricSelectEventDetail {
  type: 'preference' | 'error_pattern' | 'success_pattern' | 'tool_efficiency';
  item: UserPreference | ErrorPattern | SuccessPattern | ToolEfficiency;
}

/**
 * Filter change event detail (learning dashboard)
 */
export interface FilterChangeEventDetail {
  timeRange: string;
  signalType: string;
  source: string;
}

// =============================================================================
// WEB COMPONENT CLASSES
// =============================================================================

/**
 * Base class for all Loki web components
 */
export declare class LokiElement extends HTMLElement {
  constructor();

  protected _theme: ThemeName;
  protected _keyboardHandler: KeyboardHandler;

  connectedCallback(): void;
  disconnectedCallback(): void;

  getBaseStyles(): string;
  getAriaPattern(patternName: keyof AriaPatterns): AriaPattern;
  applyAriaPattern(element: HTMLElement, patternName: keyof AriaPatterns): void;
  registerShortcut(action: KeyboardAction, handler: (event: KeyboardEvent) => void): void;
  render(): void;

  onThemeChange?(theme: ThemeName): void;
}

/**
 * LokiTaskBoard - Kanban-style task board component
 *
 * @element loki-task-board
 *
 * @attr {string} api-url - API base URL (default: http://localhost:57374)
 * @attr {string} project-id - Filter tasks by project ID
 * @attr {ThemeName} theme - Theme name (default: auto-detect)
 * @attr {boolean} readonly - Disable drag-drop and editing
 *
 * @fires task-moved - When a task is moved to a different column
 * @fires add-task - When the add task button is clicked
 * @fires task-click - When a task card is clicked
 */
export declare class LokiTaskBoard extends LokiElement {
  static readonly observedAttributes: string[];

  constructor();

  // Events (use addEventListener with these event types)
  addEventListener(
    type: 'task-moved',
    listener: (event: CustomEvent<TaskMovedEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'add-task',
    listener: (event: CustomEvent<AddTaskEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'task-click',
    listener: (event: CustomEvent<TaskClickEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
}

/**
 * LokiSessionControl - Session control panel component
 *
 * @element loki-session-control
 *
 * @attr {string} api-url - API base URL (default: http://localhost:57374)
 * @attr {ThemeName} theme - Theme name (default: auto-detect)
 * @attr {boolean} compact - Show compact version
 *
 * @fires session-start - When start is clicked
 * @fires session-pause - When pause is clicked
 * @fires session-resume - When resume is clicked
 * @fires session-stop - When stop is clicked
 */
export declare class LokiSessionControl extends LokiElement {
  static readonly observedAttributes: string[];

  constructor();

  addEventListener(
    type: 'session-start',
    listener: (event: CustomEvent<SessionEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'session-pause',
    listener: (event: CustomEvent<SessionEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'session-resume',
    listener: (event: CustomEvent<SessionEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'session-stop',
    listener: (event: CustomEvent<SessionEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
}

/**
 * LokiLogStream - Real-time log display component
 *
 * @element loki-log-stream
 *
 * @attr {string} api-url - API base URL (default: http://localhost:57374)
 * @attr {string} max-lines - Maximum log lines to keep (default: 500)
 * @attr {boolean} auto-scroll - Enable auto-scroll to bottom
 * @attr {ThemeName} theme - Theme name (default: auto-detect)
 * @attr {string} log-file - Path to log file for file-based updates
 *
 * @fires log-received - When a new log message is received
 * @fires logs-cleared - When logs are cleared
 */
export declare class LokiLogStream extends LokiElement {
  static readonly observedAttributes: string[];

  constructor();

  /**
   * Add a log entry programmatically
   */
  addLog(message: string, level?: LogEntry['level']): void;

  /**
   * Clear all logs
   */
  clear(): void;

  addEventListener(
    type: 'log-received',
    listener: (event: CustomEvent<LogReceivedEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'logs-cleared',
    listener: (event: CustomEvent<void>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
}

/**
 * LokiMemoryBrowser - Memory system browser component
 *
 * @element loki-memory-browser
 *
 * @attr {string} api-url - API base URL (default: http://localhost:57374)
 * @attr {ThemeName} theme - Theme name (default: auto-detect)
 * @attr {'summary' | 'episodes' | 'patterns' | 'skills'} tab - Initial tab
 *
 * @fires episode-select - When an episode is selected
 * @fires pattern-select - When a pattern is selected
 * @fires skill-select - When a skill is selected
 */
export declare class LokiMemoryBrowser extends LokiElement {
  static readonly observedAttributes: string[];

  constructor();

  addEventListener(
    type: 'episode-select',
    listener: (event: CustomEvent<EpisodeSelectEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'pattern-select',
    listener: (event: CustomEvent<PatternSelectEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'skill-select',
    listener: (event: CustomEvent<SkillSelectEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
}

/**
 * LokiLearningDashboard - Learning metrics dashboard component
 *
 * @element loki-learning-dashboard
 *
 * @attr {string} api-url - API base URL (default: http://localhost:57374)
 * @attr {ThemeName} theme - Theme name (default: auto-detect)
 * @attr {'1h' | '24h' | '7d' | '30d'} time-range - Time range filter (default: '7d')
 * @attr {string} signal-type - Signal type filter (default: 'all')
 * @attr {string} source - Source filter (default: 'all')
 *
 * @fires metric-select - When a metric item is selected
 * @fires filter-change - When filters are changed
 */
export declare class LokiLearningDashboard extends LokiElement {
  static readonly observedAttributes: string[];

  constructor();

  addEventListener(
    type: 'metric-select',
    listener: (event: CustomEvent<MetricSelectEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'filter-change',
    listener: (event: CustomEvent<FilterChangeEventDetail>) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
}

// =============================================================================
// LEGACY THEME TYPES (for backwards compatibility)
// =============================================================================

/**
 * Legacy theme class (prefer UnifiedThemeManager)
 * @deprecated Use UnifiedThemeManager instead
 */
export declare class LokiTheme {
  static STORAGE_KEY: string;

  static getTheme(): ThemeName;
  static setTheme(theme: ThemeName): void;
  static toggle(): ThemeName;
  static getVariables(theme?: ThemeName | null): ThemeDefinition;
  static toCSSString(theme?: ThemeName | null): string;
  static applyToElement(element: HTMLElement, theme?: ThemeName | null): void;
  static init(): void;
  static detectContext(): ThemeContext;
  static getAvailableThemes(): ThemeName[];
}

/**
 * Legacy theme variables (prefer THEMES)
 * @deprecated Use THEMES from unified styles instead
 */
export declare const THEME_VARIABLES: {
  light: ThemeDefinition;
  dark: ThemeDefinition;
};

/**
 * Legacy common styles (prefer BASE_STYLES)
 * @deprecated Use BASE_STYLES from unified styles instead
 */
export declare const COMMON_STYLES: string;

// =============================================================================
// MODULE EXPORTS
// =============================================================================

/**
 * Initialize configuration
 */
export interface InitConfig {
  apiUrl?: string;
  theme?: ThemeName;
  autoDetectContext?: boolean;
}

/**
 * Init result
 */
export interface InitResult {
  theme: ThemeName;
  context: ThemeContext;
}

/**
 * Initialize all components with default configuration
 */
export declare function init(config?: InitConfig): InitResult;

/**
 * Get the default API client instance
 */
export declare function getApiClient(config?: ApiClientConfig): LokiApiClient;

/**
 * Create a new API client instance
 */
export declare function createApiClient(config?: ApiClientConfig): LokiApiClient;

/**
 * Get the default state instance
 */
export declare function getState(): LokiState;

/**
 * Create a reactive store bound to a specific state path
 */
export declare function createStore<T = unknown>(path: string): Store<T>;

/**
 * Generate CSS custom properties from a theme
 */
export declare function generateThemeCSS(themeName: ThemeName): string;

/**
 * Generate complete CSS variables string including design tokens
 */
export declare function generateTokensCSS(): string;

// Constants
export declare const VERSION: string;
export declare const STATE_CHANGE_EVENT: 'loki-state-change';
export declare const ApiEvents: ApiEventTypes;
export declare const THEMES: ThemeDefinitions;
export declare const SPACING: SpacingScale;
export declare const RADIUS: RadiusScale;
export declare const TYPOGRAPHY: TypographyConfig;
export declare const ANIMATION: AnimationConfig;
export declare const BREAKPOINTS: BreakpointsConfig;
export declare const Z_INDEX: ZIndexScale;
export declare const KEYBOARD_SHORTCUTS: KeyboardShortcuts;
export declare const ARIA_PATTERNS: AriaPatterns;
export declare const BASE_STYLES: string;

// =============================================================================
// GLOBAL TYPE AUGMENTATION FOR CUSTOM ELEMENTS
// =============================================================================

declare global {
  interface HTMLElementTagNameMap {
    'loki-task-board': LokiTaskBoard;
    'loki-session-control': LokiSessionControl;
    'loki-log-stream': LokiLogStream;
    'loki-memory-browser': LokiMemoryBrowser;
    'loki-learning-dashboard': LokiLearningDashboard;
  }

  interface HTMLElementEventMap {
    'loki-theme-change': CustomEvent<ThemeChangeEventDetail>;
    'loki-state-change': CustomEvent<StateChangeEventDetail>;
  }
}
