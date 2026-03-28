import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  CircleDot, Search, RefreshCw, ArrowLeft, ExternalLink,
  Tag, MessageSquare, User, Loader2, CheckCircle2, AlertCircle,
  GitPullRequest, Wand2, RotateCcw, CircleOff,
} from 'lucide-react';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Skeleton } from './ui/Skeleton';
import type { GitHubIssue } from '../types/api';
type GitHubIssueDetail = GitHubIssue & { assignees: any[]; comments_data: any[] };
type GitHubIssueLabel = { name: string; color: string };
type GitHubFixResult = { branch: string; pr_url: string; pr_number: number; task_id: string };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubIssuesPanelProps {
  sessionId: string;
}

type IssueStateFilter = 'open' | 'closed' | 'all';

type FixStatus =
  | 'idle'
  | 'creating-branch'
  | 'analyzing'
  | 'writing-fix'
  | 'running-tests'
  | 'creating-pr'
  | 'success'
  | 'error';

interface FixState {
  status: FixStatus;
  result?: GitHubFixResult;
  error?: string;
}

const FIX_STEP_LABELS: Record<string, string> = {
  'creating-branch': 'Creating branch...',
  analyzing: 'Analyzing issue...',
  'writing-fix': 'Writing fix...',
  'running-tests': 'Running tests...',
  'creating-pr': 'Creating PR...',
};

const FIX_STEPS: FixStatus[] = [
  'creating-branch',
  'analyzing',
  'writing-fix',
  'running-tests',
  'creating-pr',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function initials(login: string): string {
  return login.slice(0, 2).toUpperCase();
}

/** Resolve a hex color string to a contrasting text color. */
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff';
}

/** Render very basic markdown: **bold**, `code`, and - lists. */
function renderBasicMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // List items
    if (/^\s*[-*]\s/.test(line)) {
      const content = line.replace(/^\s*[-*]\s/, '');
      elements.push(
        <li key={i} className="ml-4 list-disc text-xs text-secondary leading-relaxed">
          {renderInline(content)}
        </li>,
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<br key={i} />);
      continue;
    }

    elements.push(
      <p key={i} className="text-xs text-secondary leading-relaxed">
        {renderInline(line)}
      </p>,
    );
  }
  return elements;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Split by **bold** and `code`
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <code
          key={match.index}
          className="px-1 py-0.5 rounded bg-hover text-xs font-mono text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LabelBadge({ label }: { label: GitHubIssueLabel }) {
  const bg = `#${label.color}`;
  const fg = contrastColor(label.color);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-btn px-2 py-0.5 text-[11px] font-medium leading-none"
      style={{ backgroundColor: bg, color: fg }}
    >
      <Tag size={10} />
      {label.name}
    </span>
  );
}

function AuthorAvatar({ login }: { login: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex-shrink-0"
      title={login}
    >
      {initials(login)}
    </span>
  );
}

function IssueCardSkeleton() {
  return (
    <div className="px-4 py-3 border border-border rounded-card space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton variant="text" width="2.5rem" height="0.625rem" />
        <Skeleton variant="text" width="60%" height="0.75rem" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton variant="text" width="4rem" height="0.5rem" />
        <Skeleton variant="text" width="4rem" height="0.5rem" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue Card (list item)
// ---------------------------------------------------------------------------

function IssueCard({
  issue,
  onClick,
}: {
  issue: GitHubIssue;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border border-border rounded-card hover:bg-hover transition-colors cursor-pointer group"
    >
      <div className="flex items-start gap-2">
        <CircleDot
          size={16}
          className={`mt-0.5 flex-shrink-0 ${
            issue.state === 'open' ? 'text-success' : 'text-primary'
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-mono text-muted flex-shrink-0">
              #{issue.number}
            </span>
            <span className="text-sm font-medium text-ink truncate group-hover:text-primary transition-colors">
              {issue.title}
            </span>
          </div>
          <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
            {issue.labels.map((label: any) => (
              <LabelBadge key={label.name} label={label} />
            ))}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <AuthorAvatar login={issue.author.login} />
              {issue.author.login}
            </span>
            <span>{timeAgo(issue.createdAt)}</span>
            {issue.comments > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageSquare size={11} />
                {issue.comments}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Fix Progress
// ---------------------------------------------------------------------------

function FixProgress({ fixState, onRetry }: { fixState: FixState; onRetry: () => void }) {
  if (fixState.status === 'idle') return null;

  if (fixState.status === 'success' && fixState.result) {
    return (
      <div className="rounded-card border border-success/30 bg-success/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 size={16} />
          Pull request created
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <GitPullRequest size={14} className="text-success" />
          <span className="font-mono">
            PR #{fixState.result.pr_number}
          </span>
          <span className="text-secondary">on branch</span>
          <span className="font-mono bg-hover px-1.5 py-0.5 rounded-btn">
            {fixState.result.branch}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={fixState.result.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink size={12} />
            View on GitHub
          </a>
        </div>
      </div>
    );
  }

  if (fixState.status === 'error') {
    return (
      <div className="rounded-card border border-danger/30 bg-danger/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-danger">
          <AlertCircle size={16} />
          Fix failed
        </div>
        <p className="text-xs text-muted font-mono bg-danger/5 border border-danger/10 rounded px-2 py-1.5">
          {fixState.error || 'Unknown error'}
        </p>
        <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  // In-progress states
  const currentIdx = FIX_STEPS.indexOf(fixState.status);
  return (
    <div className="rounded-card border border-primary/20 bg-primary/5 p-4 space-y-2">
      {FIX_STEPS.map((step, idx) => {
        const isActive = idx === currentIdx;
        const isDone = idx < currentIdx;
        return (
          <div
            key={step}
            className={`flex items-center gap-2 text-xs ${
              isDone
                ? 'text-success'
                : isActive
                  ? 'text-primary font-medium'
                  : 'text-muted'
            }`}
          >
            {isDone ? (
              <CheckCircle2 size={14} />
            ) : isActive ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CircleOff size={14} className="opacity-40" />
            )}
            {FIX_STEP_LABELS[step]}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue Detail View
// ---------------------------------------------------------------------------

function IssueDetailView({
  sessionId,
  issueNumber,
  onBack,
}: {
  sessionId: string;
  issueNumber: number;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<GitHubIssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixState, setFixState] = useState<FixState>({ status: 'idle' });

  // Fetch detail on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const d = await api.getGitHubIssue(sessionId, issueNumber);
        if (!cancelled) {
          setDetail(d as any);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load issue');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, issueNumber]);

  const handleFix = useCallback(async () => {
    const steps: FixStatus[] = ['creating-branch', 'analyzing', 'writing-fix', 'running-tests', 'creating-pr'];
    let stepIdx = 0;

    setFixState({ status: steps[0] });

    // Advance the visual progress every 2s while the request is pending
    const timer = setInterval(() => {
      stepIdx++;
      if (stepIdx < steps.length) {
        setFixState({ status: steps[stepIdx] });
      }
    }, 2000);

    try {
      const result = await api.fixGitHubIssue(sessionId, issueNumber);
      clearInterval(timer);
      setFixState({ status: 'success', result });
    } catch (err) {
      clearInterval(timer);
      setFixState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Fix failed',
      });
    }
  }, [sessionId, issueNumber]);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
          <ArrowLeft size={14} />
          Back to issues
        </button>
        <Skeleton variant="text" width="70%" height="1rem" />
        <Skeleton variant="block" width="100%" height="6rem" />
        <Skeleton variant="text" width="40%" height="0.75rem" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 space-y-4">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
          <ArrowLeft size={14} />
          Back to issues
        </button>
        <div className="flex items-center gap-2 text-sm text-danger">
          <AlertCircle size={16} />
          {error || 'Issue not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto terminal-scroll h-full">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors"
      >
        <ArrowLeft size={14} />
        Back to issues
      </button>

      {/* Title + meta */}
      <div>
        <div className="flex items-start gap-2">
          <CircleDot
            size={18}
            className={`mt-0.5 flex-shrink-0 ${
              detail.state === 'open' ? 'text-success' : 'text-primary'
            }`}
          />
          <h3 className="text-base font-semibold text-ink leading-snug">
            <span className="text-muted font-mono mr-1.5">#{detail.number}</span>
            {detail.title}
          </h3>
        </div>
        <div className="flex items-center flex-wrap gap-2 mt-2 ml-6">
          {detail.labels.map((label: any) => (
            <LabelBadge key={label.name} label={label} />
          ))}
        </div>
        <div className="flex items-center gap-3 mt-2 ml-6 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <AuthorAvatar login={detail.author.login} />
            {detail.author.login}
          </span>
          <span>{timeAgo(detail.createdAt)}</span>
        </div>
        {detail.assignees.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 ml-6 text-[11px] text-muted">
            <User size={11} />
            Assigned to:{' '}
            {detail.assignees.map((a: any) => a.login).join(', ')}
          </div>
        )}
      </div>

      {/* Body */}
      {detail.body && (
        <div className="ml-6 border-l-2 border-border pl-4 space-y-1">
          {renderBasicMarkdown(detail.body)}
        </div>
      )}

      {/* Fix with AI button */}
      <div className="ml-6">
        {fixState.status === 'idle' ? (
          <Button variant="primary" size="md" icon={Wand2} onClick={handleFix}>
            Fix with AI
          </Button>
        ) : (
          <FixProgress fixState={fixState} onRetry={handleFix} />
        )}
      </div>

      {/* Comments */}
      {detail.comments_data && detail.comments_data.length > 0 && (
        <div className="ml-6 space-y-3">
          <h4 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
            <MessageSquare size={12} />
            Comments ({detail.comments_data.length})
          </h4>
          {detail.comments_data.map((comment: any, idx: number) => (
            <div
              key={idx}
              className="border border-border rounded-card p-3 space-y-1"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <AuthorAvatar login={comment.author.login} />
                <span className="font-medium text-ink">{comment.author.login}</span>
                <span>{timeAgo(comment.createdAt)}</span>
              </div>
              <div className="mt-1 space-y-1">
                {renderBasicMarkdown(comment.body)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function GitHubIssuesPanel({ sessionId }: GitHubIssuesPanelProps) {
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [issues, setIssues] = useState<GitHubIssue[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<number | null>(null);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = stateFilter === 'all' ? 'all' : stateFilter;
      const result = await api.getGitHubIssues(sessionId, state);
      setIssues(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load issues');
    } finally {
      setLoading(false);
    }
  }, [sessionId, stateFilter]);

  // Fetch on mount and when filter changes
  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // Change state filter -- useEffect on fetchIssues handles the refetch
  const handleFilterChange = useCallback(
    (filter: IssueStateFilter) => {
      setStateFilter(filter);
      setSelectedIssue(null);
    },
    [],
  );

  // Filtered issues (client-side search)
  const filteredIssues = useMemo(() => {
    if (!issues) return [];
    if (!searchQuery.trim()) return issues;
    const q = searchQuery.toLowerCase();
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(q) ||
        String(issue.number).includes(q) ||
        issue.labels.some((l) => l.name.toLowerCase().includes(q)),
    );
  }, [issues, searchQuery]);

  // Detail view
  if (selectedIssue !== null) {
    return (
      <IssueDetailView
        sessionId={sessionId}
        issueNumber={selectedIssue}
        onBack={() => setSelectedIssue(null)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <CircleDot size={16} className="text-primary" />
            GitHub Issues
          </h3>
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={fetchIssues}
            loading={loading}
          >
            Refresh
          </Button>
        </div>

        {/* State filter tabs */}
        <div className="flex items-center gap-1 bg-hover rounded-btn p-0.5">
          {(['open', 'closed', 'all'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => handleFilterChange(filter)}
              className={`flex-1 text-xs font-medium py-1.5 px-3 rounded-btn transition-colors capitalize ${
                stateFilter === filter
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-muted hover:text-secondary'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            placeholder="Filter issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-btn bg-white text-ink placeholder:text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
      </div>

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto terminal-scroll p-3 space-y-2">
        {/* Loading skeleton */}
        {loading && !issues && (
          <>
            <IssueCardSkeleton />
            <IssueCardSkeleton />
            <IssueCardSkeleton />
            <IssueCardSkeleton />
          </>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <AlertCircle size={24} className="text-danger mb-2" />
            <p className="text-xs font-medium text-ink">Failed to load issues</p>
            <p className="text-[11px] text-muted mt-0.5">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={fetchIssues}
              className="mt-3"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filteredIssues.length === 0 && (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <CircleDot size={24} className="text-muted/30 mb-2" />
            <p className="text-xs font-medium text-ink">No issues found</p>
            <p className="text-[11px] text-muted mt-0.5">
              {searchQuery
                ? 'Try adjusting your search query'
                : `No ${stateFilter === 'all' ? '' : stateFilter} issues in this repository`}
            </p>
          </div>
        )}

        {/* Issue cards */}
        {!error &&
          filteredIssues.map((issue) => (
            <IssueCard
              key={issue.number}
              issue={issue}
              onClick={() => setSelectedIssue(issue.number)}
            />
          ))}
      </div>
    </div>
  );
}
