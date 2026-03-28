import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Loader,
  ChevronDown,
  ChevronRight,
  Terminal,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Ban,
  SkipForward,
  Timer,
} from 'lucide-react';
import { Button } from './ui/Button';
import { api } from '../api/client';
import type { WorkflowRun, Workflow } from '../types/api';
type WorkflowRunDetail = WorkflowRun & { jobs: any[] };
type WorkflowJob = any;
type WorkflowStep = any;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CICDPanelProps {
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Status mapping helpers
// ---------------------------------------------------------------------------

type NormalizedStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'skipped';

function normalizeRunStatus(run: WorkflowRun): NormalizedStatus {
  if (run.status === 'completed') {
    switch (run.conclusion) {
      case 'success': return 'success';
      case 'failure': return 'failed';
      case 'cancelled': return 'cancelled';
      case 'skipped': return 'skipped';
      case 'timed_out': return 'failed';
      default: return 'failed';
    }
  }
  if (run.status === 'in_progress') return 'running';
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'requested' || run.status === 'pending') return 'pending';
  return 'running';
}

function normalizeJobStatus(job: WorkflowJob): NormalizedStatus {
  if (job.status === 'completed') {
    switch (job.conclusion) {
      case 'success': return 'success';
      case 'failure': return 'failed';
      case 'cancelled': return 'cancelled';
      case 'skipped': return 'skipped';
      default: return 'failed';
    }
  }
  if (job.status === 'in_progress') return 'running';
  if (job.status === 'queued' || job.status === 'waiting') return 'pending';
  return 'running';
}

function normalizeStepStatus(step: WorkflowStep): NormalizedStatus {
  if (step.status === 'completed') {
    switch (step.conclusion) {
      case 'success': return 'success';
      case 'failure': return 'failed';
      case 'cancelled': return 'cancelled';
      case 'skipped': return 'skipped';
      default: return 'failed';
    }
  }
  if (step.status === 'in_progress') return 'running';
  return 'pending';
}

const statusConfig: Record<NormalizedStatus, {
  color: string;
  bg: string;
  Icon: typeof CheckCircle;
  label: string;
}> = {
  pending: { color: 'text-[#939084]', bg: 'bg-[#939084]/10', Icon: Clock, label: 'Queued' },
  running: { color: 'text-[#553DE9]', bg: 'bg-[#553DE9]/10', Icon: Loader, label: 'Running' },
  success: { color: 'text-[#1FC5A8]', bg: 'bg-[#1FC5A8]/10', Icon: CheckCircle, label: 'Success' },
  failed: { color: 'text-[#C45B5B]', bg: 'bg-[#C45B5B]/10', Icon: XCircle, label: 'Failed' },
  cancelled: { color: 'text-[#939084]', bg: 'bg-[#939084]/10', Icon: Ban, label: 'Cancelled' },
  skipped: { color: 'text-[#939084]', bg: 'bg-[#939084]/10', Icon: SkipForward, label: 'Skipped' },
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function duration(start: string, end: string | null): string {
  if (!end) return '--';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '--';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: NormalizedStatus }) {
  const cfg = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <cfg.Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Step row inside a job
// ---------------------------------------------------------------------------

function StepRow({ step }: { step: WorkflowStep }) {
  const status = normalizeStepStatus(step);
  const cfg = statusConfig[status];
  return (
    <div className="flex items-center gap-2 py-1 px-3 text-xs">
      <cfg.Icon size={12} className={`${cfg.color} flex-shrink-0 ${status === 'running' ? 'animate-spin' : ''}`} />
      <span className="text-[#201515] dark:text-[#E8E6E3] flex-1 truncate">
        {step.name}
      </span>
      {step.startedAt && step.completedAt && (
        <span className="text-[#939084] font-mono flex-shrink-0">
          {duration(step.startedAt, step.completedAt)}
        </span>
      )}
      <StatusBadge status={status} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job card inside a run detail
// ---------------------------------------------------------------------------

function JobCard({ job }: { job: WorkflowJob }) {
  const [expanded, setExpanded] = useState(false);
  const status = normalizeJobStatus(job);
  const cfg = statusConfig[status];

  return (
    <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
      >
        {expanded
          ? <ChevronDown size={14} className="text-[#939084]" />
          : <ChevronRight size={14} className="text-[#939084]" />
        }
        <cfg.Icon size={14} className={`${cfg.color} ${status === 'running' ? 'animate-spin' : ''}`} />
        <span className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3] flex-1 truncate">
          {job.name}
        </span>
        {job.startedAt && (
          <span className="text-xs text-[#939084] font-mono flex-shrink-0">
            {duration(job.startedAt, job.completedAt)}
          </span>
        )}
        <StatusBadge status={status} />
      </button>

      {expanded && job.steps && job.steps.length > 0 && (
        <div className="border-t border-[#ECEAE3] dark:border-[#2A2A30] bg-[#FAFAF8] dark:bg-[#1A1A1F] divide-y divide-[#ECEAE3] dark:divide-[#2A2A30]">
          {job.steps.map((step: any) => (
            <StepRow key={step.number} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log viewer for a run
// ---------------------------------------------------------------------------

function LogViewer({ sessionId, runId }: { sessionId: string; runId: number }) {
  const [logs, setLogs] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.getWorkflowRunLogs(sessionId, runId);
      setLogs(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [sessionId, runId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (loading) {
    return (
      <div className="bg-[#0F0F11] rounded-lg p-4 text-center">
        <Loader size={16} className="animate-spin text-[#939084] inline-block" />
        <span className="text-xs text-[#939084] ml-2">Loading logs...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#0F0F11] rounded-lg p-4">
        <p className="text-xs text-[#C45B5B] font-mono">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0F0F11] rounded-lg p-3 max-h-80 overflow-y-auto terminal-scroll">
      <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-[#E8E6E3]">
        {logs || '(No log output)'}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow run card (expanded shows jobs+steps+logs)
// ---------------------------------------------------------------------------

function RunCard({ run, sessionId }: { run: WorkflowRun; sessionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const status = normalizeRunStatus(run);

  const loadDetail = useCallback(async () => {
    if (detail || detailLoading) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await api.getWorkflowRunDetail(sessionId, run.databaseId);
      setDetail(d as any);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load run details');
    } finally {
      setDetailLoading(false);
    }
  }, [sessionId, run.databaseId, detail, detailLoading]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadDetail();
  };

  return (
    <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden">
      {/* Run header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
      >
        {expanded
          ? <ChevronDown size={14} className="text-[#939084] flex-shrink-0" />
          : <ChevronRight size={14} className="text-[#939084] flex-shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3] truncate">
              {run.name}
            </span>
            <StatusBadge status={status} />
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="inline-flex items-center gap-1 text-xs text-[#939084]">
              <GitBranch size={12} />
              {run.headBranch}
            </span>
            <span className="text-xs text-[#939084]">{run.event}</span>
            <span className="text-xs text-[#939084]">{timeAgo(run.createdAt)}</span>
          </div>
        </div>
        <a
          href={run.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[#939084] hover:text-[#553DE9] transition-colors flex-shrink-0"
          title="Open on GitHub"
        >
          <ExternalLink size={14} />
        </a>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[#ECEAE3] dark:border-[#2A2A30] px-4 pb-4 pt-3 space-y-3">
          {/* Loading state */}
          {detailLoading && (
            <div className="text-center py-4">
              <Loader size={16} className="animate-spin text-[#553DE9] inline-block" />
              <span className="text-xs text-[#939084] ml-2">Loading jobs...</span>
            </div>
          )}

          {/* Error state */}
          {detailError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[#C45B5B]/10 text-[#C45B5B]">
              <AlertTriangle size={14} />
              <span className="text-xs">{detailError}</span>
            </div>
          )}

          {/* Jobs list */}
          {detail && detail.jobs && detail.jobs.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-[#939084] uppercase tracking-wider">Jobs</h4>
              {detail.jobs.map((job: any) => (
                <JobCard key={job.databaseId} job={job} />
              ))}
            </div>
          )}

          {detail && (!detail.jobs || detail.jobs.length === 0) && !detailLoading && (
            <p className="text-xs text-[#939084]">No jobs found for this run.</p>
          )}

          {/* Log toggle */}
          {detail && (
            <div className="pt-1">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="inline-flex items-center gap-1.5 text-xs text-[#553DE9] hover:text-[#4432c4] transition-colors"
              >
                <Terminal size={12} />
                {showLogs ? 'Hide full logs' : 'View full logs'}
              </button>
              {showLogs && (
                <div className="mt-2">
                  <LogViewer sessionId={sessionId} runId={run.databaseId} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch workflow dialog
// ---------------------------------------------------------------------------

function DispatchDialog({
  sessionId,
  workflows,
  onClose,
  onDispatched,
}: {
  sessionId: string;
  workflows: Workflow[];
  onClose: () => void;
  onDispatched: () => void;
}) {
  const [selected, setSelected] = useState(workflows[0]?.name || '');
  const [ref, setRef] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDispatch = async () => {
    if (!selected) return;
    setDispatching(true);
    setError(null);
    try {
      await api.dispatchWorkflow(sessionId, selected, ref);
      onDispatched();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dispatch failed');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg p-4 bg-[#FAFAF8] dark:bg-[#1A1A1F] space-y-3">
      <h4 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3]">
        Run Workflow
      </h4>

      <div>
        <label className="block text-xs text-[#939084] mb-1">Workflow</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#0F0F11] text-[#201515] dark:text-[#E8E6E3] focus:outline-none focus:ring-2 focus:ring-[#553DE9]/40"
        >
          {workflows.map((w: any) => (
            <option key={w.id} value={w.name}>
              {w.name} ({w.name})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-[#939084] mb-1">
          Branch / ref (leave empty for default)
        </label>
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="main"
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#0F0F11] text-[#201515] dark:text-[#E8E6E3] focus:outline-none focus:ring-2 focus:ring-[#553DE9]/40"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 rounded bg-[#C45B5B]/10 text-[#C45B5B]">
          <AlertTriangle size={12} />
          <span className="text-xs">{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" icon={Play} onClick={handleDispatch} loading={dispatching}>
          Dispatch
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CI/CD Panel
// ---------------------------------------------------------------------------

type PanelError = {
  type: 'gh_not_found' | 'not_authenticated' | 'no_repo' | 'no_workflows' | 'generic';
  message: string;
};

export function CICDPanel({ sessionId }: CICDPanelProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [repo, setRepo] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [panelError, setPanelError] = useState<PanelError | null>(null);
  const [showDispatch, setShowDispatch] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Determine if any run is in progress
  const hasActiveRun = runs.some(
    (r) => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting' || r.status === 'requested' || r.status === 'pending',
  );

  // -------------------------------------------------------------------------
  // Fetch runs
  // -------------------------------------------------------------------------
  const fetchRuns = useCallback(async (showLoading = false) => {
    if (!sessionId) return;
    if (showLoading) setLoading(true);
    setPanelError(null);

    try {
      const resp = await api.getWorkflowRuns(sessionId);
      setRuns(resp);
      setRepo('');
      setLastUpdated(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('gh CLI not found')) {
        setPanelError({ type: 'gh_not_found', message: 'The gh CLI is not installed. Install it from https://cli.github.com/ to enable CI/CD integration.' });
      } else if (msg.includes('not authenticated') || msg.includes('401')) {
        setPanelError({ type: 'not_authenticated', message: 'The gh CLI is not authenticated. Run "gh auth login" in your terminal.' });
      } else if (msg.includes('Could not detect')) {
        setPanelError({ type: 'no_repo', message: 'No GitHub remote detected. Push this project to GitHub first.' });
      } else {
        setPanelError({ type: 'generic', message: msg });
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // -------------------------------------------------------------------------
  // Fetch workflows (for dispatch dialog)
  // -------------------------------------------------------------------------
  const fetchWorkflows = useCallback(async () => {
    if (!sessionId) return;
    try {
      const resp = await api.getWorkflows(sessionId);
      setWorkflows(resp.filter((w: any) => w.state === 'active'));
    } catch {
      // Non-critical -- dispatch button will just be disabled
      setWorkflows([]);
    }
  }, [sessionId]);

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------
  useEffect(() => {
    fetchRuns(true);
    fetchWorkflows();
  }, [fetchRuns, fetchWorkflows]);

  // -------------------------------------------------------------------------
  // Auto-poll when active runs exist
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (hasActiveRun && sessionId) {
      pollRef.current = setInterval(() => fetchRuns(false), 10_000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasActiveRun, sessionId, fetchRuns]);

  // -------------------------------------------------------------------------
  // Counts for summary
  // -------------------------------------------------------------------------
  const successCount = runs.filter((r) => normalizeRunStatus(r) === 'success').length;
  const failedCount = runs.filter((r) => normalizeRunStatus(r) === 'failed').length;
  const activeCount = runs.filter((r) => {
    const s = normalizeRunStatus(r);
    return s === 'running' || s === 'pending';
  }).length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            CI/CD Pipelines
          </h3>
          {repo && (
            <span className="text-xs text-[#939084] font-mono">{repo}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-[#939084] flex items-center gap-1">
              <Timer size={10} />
              {timeAgo(lastUpdated.toISOString())}
            </span>
          )}
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => fetchRuns(true)}>
            Refresh
          </Button>
          {workflows.length > 0 && (
            <Button
              size="sm"
              icon={Play}
              onClick={() => setShowDispatch(!showDispatch)}
            >
              Run Workflow
            </Button>
          )}
        </div>
      </div>

      {/* Dispatch dialog */}
      {showDispatch && sessionId && workflows.length > 0 && (
        <div className="mb-4">
          <DispatchDialog
            sessionId={sessionId}
            workflows={workflows}
            onClose={() => setShowDispatch(false)}
            onDispatched={() => {
              // Refetch after a short delay so the dispatched run appears
              setTimeout(() => fetchRuns(false), 3000);
            }}
          />
        </div>
      )}

      {/* Error states */}
      {panelError && (
        <div className="mb-4">
          {panelError.type === 'gh_not_found' && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-[#939084]/5 border border-[#ECEAE3] dark:border-[#2A2A30]">
              <AlertTriangle size={18} className="text-[#939084] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                  GitHub CLI not installed
                </p>
                <p className="text-xs text-[#939084] mt-1">{panelError.message}</p>
                <a
                  href="https://cli.github.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#553DE9] hover:text-[#4432c4] mt-2"
                >
                  Install GitHub CLI <ExternalLink size={10} />
                </a>
              </div>
            </div>
          )}
          {panelError.type === 'not_authenticated' && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-[#C45B5B]/5 border border-[#C45B5B]/20">
              <AlertTriangle size={18} className="text-[#C45B5B] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                  Not authenticated
                </p>
                <p className="text-xs text-[#939084] mt-1">{panelError.message}</p>
                <code className="inline-block text-xs bg-[#0F0F11] text-[#E8E6E3] px-2 py-1 rounded mt-2 font-mono">
                  gh auth login
                </code>
              </div>
            </div>
          )}
          {panelError.type === 'no_repo' && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-[#939084]/5 border border-[#ECEAE3] dark:border-[#2A2A30]">
              <GitBranch size={18} className="text-[#939084] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                  No GitHub repository
                </p>
                <p className="text-xs text-[#939084] mt-1">{panelError.message}</p>
              </div>
            </div>
          )}
          {panelError.type === 'generic' && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-[#C45B5B]/5 border border-[#C45B5B]/20">
              <AlertTriangle size={18} className="text-[#C45B5B] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                  Failed to load workflow runs
                </p>
                <p className="text-xs text-[#939084] mt-1">{panelError.message}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary stats */}
      {!loading && !panelError && runs.length > 0 && (
        <div className="flex items-center gap-4 mb-4 text-xs">
          <span className="flex items-center gap-1 text-[#1FC5A8]">
            <CheckCircle size={12} />
            {successCount} passed
          </span>
          <span className="flex items-center gap-1 text-[#C45B5B]">
            <XCircle size={12} />
            {failedCount} failed
          </span>
          <span className="flex items-center gap-1 text-[#553DE9]">
            <Loader size={12} className={activeCount > 0 ? 'animate-spin' : ''} />
            {activeCount} active
          </span>
          {hasActiveRun && (
            <span className="text-[#939084] italic">Auto-refreshing every 10s</span>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-[#ECEAE3] dark:bg-[#2A2A30] rounded" />
                <div className="flex-1">
                  <div className="h-4 bg-[#ECEAE3] dark:bg-[#2A2A30] rounded w-48" />
                  <div className="h-3 bg-[#ECEAE3] dark:bg-[#2A2A30] rounded w-32 mt-2" />
                </div>
                <div className="h-5 bg-[#ECEAE3] dark:bg-[#2A2A30] rounded-full w-16" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !panelError && runs.length === 0 && (
        <div className="text-center py-8">
          <p className="text-[#939084] text-sm">No workflow runs found</p>
          <p className="text-[#939084]/60 text-xs mt-1">
            Push commits or trigger a workflow to see runs here
          </p>
        </div>
      )}

      {/* Runs list */}
      {!loading && !panelError && runs.length > 0 && sessionId && (
        <div className="space-y-3 max-h-[600px] overflow-y-auto terminal-scroll">
          {runs.map((run) => (
            <RunCard key={run.databaseId} run={run} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  );
}
