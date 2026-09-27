export interface StatusResponse {
  running: boolean;
  paused: boolean;
  phase: string;
  // null when no state file recorded it (web-app/server.py sends null, never
  // an invented 0 / "standard" / 10-iteration cap / $0.00).
  iteration: number | null;
  complexity: string | null;
  mode: string;
  provider: string;
  current_task: string;
  pending_tasks: number | null;
  running_agents: number | null;
  uptime: number;
  version: string;
  pid: string;
  projectDir?: string;
  max_iterations?: number | null;
  cost?: number | null;
  start_time?: number;
  // Present whenever the loki process has exited (web-app/server.py:3025-3026).
  // The server has always returned these; the type just never declared them.
  exit_code?: number | null;
  last_output?: string[];
}

export interface Agent {
  id: string;
  name: string;
  type: string;
  pid?: number;
  task: string;
  status: string;
  alive: boolean;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

export interface MemorySummary {
  episodic_count: number;
  semantic_count: number;
  skill_count: number;
  total_tokens: number;
  last_consolidation: string | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'skip' | 'pending';
  details?: string;
}

export interface ChecklistSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
  items: ChecklistItem[];
}

export interface WSMessage {
  type: string;
  data?: Record<string, unknown>;
}

export type RARVPhase = 'reason' | 'act' | 'reflect' | 'verify' | 'idle';

export interface Template {
  name: string;
  filename: string;
  content: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
}

export interface Checkpoint {
  id: string;
  timestamp: string;
  description: string;
  // null when the checkpoint recorded no count (never shown as 0).
  iteration: number | null;
  files_changed: number | null;
  is_current: boolean;
}

export interface FileDiff {
  path: string;
  action: 'add' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  old_line?: number;
  new_line?: number;
}

export interface ChangePreviewData {
  session_id: string;
  message: string;
  files: FileDiff[];
  total_additions: number;
  total_deletions: number;
}

export interface FileSearchResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

// Git integration types
export interface GitFileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  refs: string[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

// Template metadata types
export interface TemplateMetadata {
  name: string;
  filename: string;
  description: string;
  category: string;
  tech_stack: string[];
  // null when the server has no entry for the template (never a default).
  difficulty: 'beginner' | 'intermediate' | 'advanced' | null;
  build_time: string | null;
  gradient: string;
}

// GitHub Issues
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: { name: string; color: string }[];
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  comments: number;
}

// GitHub Pull Requests
export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  state: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  statusCheckRollup: { state: string } | null;
}

// GitHub Actions
export interface WorkflowRun {
  databaseId: number;
  name: string;
  workflowName: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface Workflow {
  id: number;
  name: string;
  state: string;
}

// Deploy connections
export interface ConnectionStatus {
  connected: boolean;
  user?: string;
  // web-app/server.py returns this alongside connected:false when a stored
  // token is rejected by the platform CLI (:8164, :8231, :8288, :8303).
  // Kept in sync with the structurally-duplicated declaration in
  // components/DeployConnections.tsx -- that one is what ConnectionCard is
  // typed against, so both must carry the field.
  error?: string;
}

export interface DeployStatus {
  vercel: ConnectionStatus;
  netlify: ConnectionStatus;
  github: ConnectionStatus;
}
