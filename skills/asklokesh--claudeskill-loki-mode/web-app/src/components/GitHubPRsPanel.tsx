import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitPullRequest,
  RefreshCw,
  AlertCircle,
  Check,
  X,
  Clock,
  Loader,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Search,
  GitBranch,
  ArrowRight,
  FileDiff,
  MessageSquare,
  GitMerge,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Plus,
  Minus,
  FileCode2,
  ExternalLink,
  Send,
} from 'lucide-react';
import { api } from '../api/client';
import { Button } from './ui/Button';
import type { GitHubPR } from '../types/api';
type GitHubPRDetail = GitHubPR & { body: string; comments: any[]; reviews: any[]; files: any[]; commits: any[] };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GitHubPRsPanelProps {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PRStateFilter = 'open' | 'closed' | 'merged' | 'all';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function reviewDecisionStyle(decision: string): { className: string; label: string } {
  switch (decision?.toUpperCase()) {
    case 'APPROVED':
      return { className: 'bg-green-500/10 text-green-500 border-green-500/20', label: 'Approved' };
    case 'CHANGES_REQUESTED':
      return { className: 'bg-red-400/10 text-red-400 border-red-400/20', label: 'Changes Requested' };
    case 'REVIEW_REQUIRED':
      return { className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', label: 'Review Required' };
    default:
      return { className: 'bg-muted/10 text-muted border-muted/20', label: decision || 'No Reviews' };
  }
}

function reviewStateStyle(state: string): { className: string; label: string; Icon: typeof Check } {
  switch (state?.toUpperCase()) {
    case 'APPROVED':
      return { className: 'text-green-500', label: 'Approved', Icon: ShieldCheck };
    case 'CHANGES_REQUESTED':
      return { className: 'text-red-400', label: 'Changes Requested', Icon: ShieldAlert };
    case 'COMMENTED':
      return { className: 'text-muted', label: 'Commented', Icon: MessageSquare };
    case 'DISMISSED':
      return { className: 'text-muted/60', label: 'Dismissed', Icon: XCircle };
    default:
      return { className: 'text-muted', label: state || 'Pending', Icon: ShieldQuestion };
  }
}

function checkStatusIcon(conclusion: string): React.ReactNode {
  switch (conclusion?.toLowerCase()) {
    case 'success':
      return <Check size={12} className="text-green-500" />;
    case 'failure':
    case 'error':
      return <X size={12} className="text-red-400" />;
    case 'pending':
    case 'in_progress':
    case 'queued':
      return <Loader size={12} className="text-yellow-500 animate-spin" />;
    case 'neutral':
    case 'skipped':
      return <Clock size={12} className="text-muted" />;
    default:
      return <Clock size={12} className="text-muted" />;
  }
}

function overallCheckStatus(checks: any[]): { label: string; className: string } {
  if (!checks || checks.length === 0) return { label: 'No checks', className: 'text-muted' };
  const allPassing = checks.every(c => c.conclusion === 'success');
  const someFailing = checks.some(c => c.conclusion === 'failure' || c.conclusion === 'error');
  if (allPassing) return { label: 'All passing', className: 'text-green-500' };
  if (someFailing) return { label: 'Some failing', className: 'text-red-400' };
  return { label: 'In progress', className: 'text-yellow-500' };
}

// ---------------------------------------------------------------------------
// Diff parser
// ---------------------------------------------------------------------------

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;
  lines: DiffLineEntry[];
}

interface DiffLineEntry {
  type: 'add' | 'delete' | 'context' | 'header';
  content: string;
  oldLine?: number;
  newLine?: number;
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!raw) return files;

  const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    // Extract file path from "a/path b/path"
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    const path = headerMatch ? headerMatch[2] : 'unknown';

    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Hunk header
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
      if (hunkMatch) {
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);
        currentHunk.lines.push({ type: 'header', content: line });
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+')) {
        additions++;
        currentHunk.lines.push({ type: 'add', content: line.slice(1), newLine: newLine });
        newLine++;
      } else if (line.startsWith('-')) {
        deletions++;
        currentHunk.lines.push({ type: 'delete', content: line.slice(1), oldLine: oldLine });
        oldLine++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLine: oldLine, newLine: newLine });
        oldLine++;
        newLine++;
      }
      // Skip other lines (index, ---, +++ etc.)
    }

    files.push({ path, additions, deletions, hunks });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PRStatusCheckIcon({ pr }: { pr: GitHubPR }) {
  const checks = ((pr.statusCheckRollup as any)?.contexts as any[] || []);
  if (!checks || checks.length === 0) {
    return <span title="No status checks"><Clock size={13} className="text-muted" /></span>;
  }
  const allPassing = checks.every(c => c.conclusion === 'success');
  const someFailing = checks.some(c => c.conclusion === 'failure' || c.conclusion === 'error');
  if (allPassing) return <span title="All checks passing"><Check size={13} className="text-green-500" /></span>;
  if (someFailing) return <span title="Some checks failing"><X size={13} className="text-red-400" /></span>;
  return <span title="Checks in progress"><Loader size={13} className="text-yellow-500 animate-spin" /></span>;
}

function PRCard({
  pr,
  onClick,
}: {
  pr: GitHubPR;
  onClick: () => void;
}) {
  const decision = reviewDecisionStyle(pr.reviewDecision || "PENDING");

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 border-b border-border hover:bg-hover transition-colors"
    >
      <div className="flex items-start gap-2">
        <GitPullRequest
          size={14}
          className={`mt-0.5 flex-shrink-0 ${
            pr.state === 'open' ? 'text-green-500' :
            pr.state === 'merged' ? 'text-purple-500' :
            'text-red-400'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-ink truncate">{pr.title}</span>
            <span className="text-[10px] font-mono text-muted flex-shrink-0">#{pr.number}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-muted">{pr.author?.login}</span>
            <span className="text-[10px] font-mono text-primary/60 truncate max-w-[120px]" title={pr.headRefName}>
              {pr.headRefName}
            </span>
            <span className="flex items-center gap-0.5 flex-shrink-0">
              <PRStatusCheckIcon pr={pr} />
            </span>
            <span className={`inline-flex items-center px-1.5 py-0 text-[9px] font-medium rounded border ${decision.className}`}>
              {decision.label}
            </span>
            <span className="text-[10px] text-muted ml-auto flex-shrink-0 flex items-center gap-1">
              <span className="text-green-500">+{pr.additions}</span>
              <span className="text-red-400">-{pr.deletions}</span>
            </span>
            <span className="text-[10px] text-muted flex-shrink-0">
              {timeAgo(pr.createdAt)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function StatusChecksSection({ checks }: { checks: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const status = overallCheckStatus(checks);

  if (!checks || checks.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted">No status checks configured.</div>
    );
  }

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-hover transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-semibold text-ink">Status Checks</span>
        <span className={`text-[10px] font-medium ${status.className}`}>{status.label}</span>
        <span className="text-[10px] text-muted ml-auto">{checks.length} checks</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {checks.map((check, i) => (
            <div key={i} className="flex items-center gap-2 py-1 text-xs">
              {checkStatusIcon(check.conclusion)}
              <span className="text-ink flex-1 truncate">{check.name}</span>
              <span className="text-[10px] text-muted capitalize">{check.conclusion || 'pending'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewsSection({ reviews }: { reviews: any[] }) {
  if (!reviews || reviews.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted border-b border-border">No reviews yet.</div>
    );
  }

  return (
    <div className="border-b border-border">
      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider border-b border-border">
        Reviews ({reviews.length})
      </div>
      {reviews.map((review, i) => {
        const style = reviewStateStyle(review.state);
        return (
          <div key={i} className="px-3 py-2 border-b border-border last:border-b-0">
            <div className="flex items-center gap-2">
              <style.Icon size={13} className={style.className} />
              <span className="text-xs font-medium text-ink">{review.author?.login}</span>
              <span className={`text-[10px] ${style.className}`}>{style.label}</span>
            </div>
            {review.body && (
              <p className="mt-1 text-xs text-muted leading-relaxed pl-5">{review.body}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DiffFileItem({
  file,
  isSelected,
  onClick,
}: {
  file: DiffFile | any;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
        isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-hover text-ink'
      }`}
    >
      <FileCode2 size={12} className={isSelected ? 'text-primary' : 'text-muted'} />
      <span className="font-mono truncate flex-1">{file.path}</span>
      <span className="flex items-center gap-1 flex-shrink-0">
        <span className="text-green-500 text-[10px]">+{file.additions}</span>
        <span className="text-red-400 text-[10px]">-{file.deletions}</span>
      </span>
    </button>
  );
}

function DiffViewer({ diffFiles, selectedFile }: { diffFiles: DiffFile[]; selectedFile: string | null }) {
  const file = diffFiles.find(f => f.path === selectedFile);
  if (!file) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted">
        Select a file to view its diff.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto terminal-scroll">
      {file.hunks.map((hunk, hi) => (
        <div key={hi} className="mb-2">
          {hunk.lines.map((line, li) => {
            if (line.type === 'header') {
              return (
                <div key={li} className="px-3 py-1 bg-primary/5 text-primary text-[11px] font-mono border-y border-border">
                  {line.content}
                </div>
              );
            }

            const lineClasses =
              line.type === 'add'
                ? 'bg-green-500/8 text-ink'
                : line.type === 'delete'
                ? 'bg-red-400/8 text-ink'
                : 'text-ink';

            return (
              <div key={li} className={`flex text-[11px] font-mono leading-5 ${lineClasses}`}>
                <span className="w-10 flex-shrink-0 text-right pr-2 text-muted/50 select-none border-r border-border">
                  {line.oldLine ?? ''}
                </span>
                <span className="w-10 flex-shrink-0 text-right pr-2 text-muted/50 select-none border-r border-border">
                  {line.newLine ?? ''}
                </span>
                <span className={`w-4 flex-shrink-0 text-center select-none ${
                  line.type === 'add' ? 'text-green-500' :
                  line.type === 'delete' ? 'text-red-400' :
                  'text-transparent'
                }`}>
                  {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                </span>
                <span className="flex-1 px-2 whitespace-pre">{line.content}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ReviewCommentForm({
  onSubmit,
  loading,
  action,
}: {
  onSubmit: (comment: string) => void;
  loading: boolean;
  action: string;
}) {
  const [comment, setComment] = useState('');

  const handleSubmit = () => {
    onSubmit(comment);
    setComment('');
  };

  return (
    <div className="p-3 space-y-2 border-t border-border bg-hover">
      <p className="text-[11px] font-semibold text-ink capitalize">{action.replace('_', ' ')} Review</p>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Review comment (optional for approve, required for request changes)..."
        rows={3}
        className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded-btn outline-none focus:border-primary transition-colors resize-none font-mono"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted">{comment.length} characters</span>
        <Button
          size="sm"
          icon={Send}
          onClick={handleSubmit}
          disabled={loading || (action === 'request_changes' && !comment.trim())}
          loading={loading}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GitHubPRsPanel({ sessionId }: GitHubPRsPanelProps) {
  // List view state
  const [prs, setPrs] = useState<GitHubPR[]>([]);
  const [stateFilter, setStateFilter] = useState<PRStateFilter>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail view state
  const [selectedPR, setSelectedPR] = useState<GitHubPRDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Diff state
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  // Action states
  const [reviewAction, setReviewAction] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<string>('squash');
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch PR list
  // ---------------------------------------------------------------------------

  const fetchPRs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getGitHubPRs(
        sessionId,
        stateFilter === 'all' ? undefined : stateFilter
      );
      setPrs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pull requests');
    }
    setLoading(false);
  }, [sessionId, stateFilter]);

  useEffect(() => {
    fetchPRs();
  }, [fetchPRs]);

  // ---------------------------------------------------------------------------
  // Fetch PR detail + diff
  // ---------------------------------------------------------------------------

  const openPRDetail = useCallback(async (prNumber: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setDiffFiles([]);
    setSelectedDiffFile(null);
    setActionMessage(null);
    setReviewAction(null);
    setShowMergeConfirm(false);

    try {
      const [detail, rawDiff] = await Promise.all([
        api.getGitHubPR(sessionId, prNumber),
        api.getGitHubPRDiff(sessionId, prNumber),
      ]);
      setSelectedPR(detail as any);
      const parsed = parseDiff(rawDiff);
      setDiffFiles(parsed);
      if (parsed.length > 0) {
        setSelectedDiffFile(parsed[0].path);
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load PR details');
    }
    setDetailLoading(false);
  }, [sessionId]);

  const closePRDetail = () => {
    setSelectedPR(null);
    setDetailError(null);
    setDiffFiles([]);
    setSelectedDiffFile(null);
    setActionMessage(null);
    setReviewAction(null);
    setShowMergeConfirm(false);
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleReview = async (comment: string) => {
    if (!selectedPR || !reviewAction) return;
    setReviewLoading(true);
    setActionMessage(null);
    try {
      await api.reviewGitHubPR(sessionId, selectedPR.number, reviewAction, comment);
      setActionMessage({ type: 'success', text: `Review submitted: ${reviewAction.replace('_', ' ')}` });
      setReviewAction(null);
      // Refresh detail
      const detail = await api.getGitHubPR(sessionId, selectedPR.number);
      setSelectedPR(detail as any);
    } catch (e) {
      setActionMessage({ type: 'error', text: e instanceof Error ? e.message : 'Review failed' });
    }
    setReviewLoading(false);
  };

  const handleMerge = async () => {
    if (!selectedPR) return;
    setMergeLoading(true);
    setActionMessage(null);
    try {
      await api.mergeGitHubPR(sessionId, selectedPR.number, mergeMethod);
      setActionMessage({ type: 'success', text: `PR #${selectedPR.number} merged via ${mergeMethod}` });
      setShowMergeConfirm(false);
      // Refresh list
      fetchPRs();
      // Refresh detail
      const detail = await api.getGitHubPR(sessionId, selectedPR.number);
      setSelectedPR(detail as any);
    } catch (e) {
      setActionMessage({ type: 'error', text: e instanceof Error ? e.message : 'Merge failed' });
    }
    setMergeLoading(false);
  };

  const handleClose = async () => {
    if (!selectedPR) return;
    setCloseLoading(true);
    setActionMessage(null);
    try {
      await api.reviewGitHubPR(sessionId, selectedPR.number, 'comment', 'Closed via Purple Lab');
      setActionMessage({ type: 'success', text: `PR #${selectedPR.number} closed` });
      fetchPRs();
      const detail = await api.getGitHubPR(sessionId, selectedPR.number);
      setSelectedPR(detail as any);
    } catch (e) {
      setActionMessage({ type: 'error', text: e instanceof Error ? e.message : 'Close failed' });
    }
    setCloseLoading(false);
  };

  // ---------------------------------------------------------------------------
  // Filtered PRs
  // ---------------------------------------------------------------------------

  const filteredPRs = useMemo(() => {
    if (!searchQuery.trim()) return prs;
    const q = searchQuery.toLowerCase();
    return prs.filter(pr =>
      pr.title.toLowerCase().includes(q) ||
      pr.author?.login.toLowerCase().includes(q) ||
      pr.headRefName.toLowerCase().includes(q) ||
      `#${pr.number}`.includes(q)
    );
  }, [prs, searchQuery]);

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------

  if (selectedPR || detailLoading || detailError) {
    return (
      <div className="h-full flex flex-col">
        {/* Detail header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-hover flex-shrink-0">
          <button
            onClick={closePRDetail}
            className="p-1 text-muted hover:text-ink rounded transition-colors"
            title="Back to list"
          >
            <ChevronLeft size={14} />
          </button>
          <GitPullRequest size={14} className="text-primary" />
          <span className="text-xs font-semibold text-ink truncate">
            {selectedPR ? `#${selectedPR.number} ${selectedPR.title}` : 'Loading...'}
          </span>
        </div>

        {/* Detail loading */}
        {detailLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw size={20} className="text-muted animate-spin" />
              <span className="text-xs text-muted">Loading PR details...</span>
            </div>
          </div>
        )}

        {/* Detail error */}
        {detailError && !detailLoading && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertCircle size={32} className="text-muted/40" />
              <p className="text-sm text-muted">{detailError}</p>
              <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => selectedPR && openPRDetail(selectedPR.number)}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Detail content */}
        {selectedPR && !detailLoading && (
          <div className="flex-1 overflow-y-auto terminal-scroll">
            {/* PR info */}
            <div className="px-3 py-2 border-b border-border space-y-1.5">
              <h3 className="text-sm font-semibold text-ink">{selectedPR.title}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded capitalize ${
                  selectedPR.state === 'open' ? 'bg-green-500/10 text-green-500' :
                  selectedPR.state === 'merged' ? 'bg-purple-500/10 text-purple-500' :
                  'bg-red-400/10 text-red-400'
                }`}>
                  <GitPullRequest size={10} />
                  {selectedPR.state}
                </span>
                <span className="text-[10px] text-muted">{selectedPR.author?.login}</span>
                <span className="flex items-center gap-1 text-[10px] font-mono text-primary/60">
                  <GitBranch size={10} />
                  {selectedPR.headRefName}
                  <ArrowRight size={10} className="text-muted" />
                  {selectedPR.baseRefName}
                </span>
                <span className="text-[10px] text-muted ml-auto">
                  {selectedPR.changedFiles} files, +{selectedPR.additions} -{selectedPR.deletions}
                </span>
              </div>
              {selectedPR.body && (
                <div className="mt-2 text-xs text-ink/80 leading-relaxed whitespace-pre-wrap bg-hover p-2 rounded-btn border border-border">
                  {selectedPR.body}
                </div>
              )}
            </div>

            {/* Action message */}
            {actionMessage && (
              <div className={`px-3 py-2 text-xs border-b ${
                actionMessage.type === 'success'
                  ? 'bg-green-500/5 border-green-500/20 text-green-500'
                  : 'bg-red-400/5 border-red-400/20 text-red-400'
              }`}>
                {actionMessage.text}
              </div>
            )}

            {/* Status checks */}
            <StatusChecksSection checks={((selectedPR.statusCheckRollup as any)?.contexts as any[] || [])} />

            {/* Reviews */}
            <ReviewsSection reviews={selectedPR.reviews || []} />

            {/* File list + Diff */}
            <div className="border-b border-border">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider border-b border-border flex items-center gap-1">
                <FileDiff size={11} />
                Changed Files ({diffFiles.length || selectedPR.files?.length || 0})
              </div>

              {/* File list from parsed diff, fallback to PR file list */}
              {(diffFiles.length > 0 ? diffFiles : (selectedPR.files || [])).map((f: any, i: number) => (
                <DiffFileItem
                  key={i}
                  file={f}
                  isSelected={selectedDiffFile === f.path}
                  onClick={() => setSelectedDiffFile(f.path)}
                />
              ))}

              {diffLoading && (
                <div className="px-3 py-4 text-center">
                  <Loader size={14} className="text-muted animate-spin mx-auto" />
                  <span className="text-xs text-muted">Loading diff...</span>
                </div>
              )}

              {/* Diff viewer */}
              {diffFiles.length > 0 && selectedDiffFile && (
                <div className="border-t border-border">
                  <DiffViewer diffFiles={diffFiles} selectedFile={selectedDiffFile} />
                </div>
              )}
            </div>

            {/* Actions */}
            {selectedPR.state === 'open' && (
              <div className="p-3 space-y-2 border-b border-border">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={ShieldCheck}
                    onClick={() => setReviewAction(reviewAction === 'approve' ? null : 'approve')}
                    className={reviewAction === 'approve' ? 'ring-1 ring-green-500' : ''}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={ShieldAlert}
                    onClick={() => setReviewAction(reviewAction === 'request_changes' ? null : 'request_changes')}
                    className={reviewAction === 'request_changes' ? 'ring-1 ring-red-400' : ''}
                  >
                    Request Changes
                  </Button>
                  <Button
                    size="sm"
                    icon={GitMerge}
                    onClick={() => setShowMergeConfirm(!showMergeConfirm)}
                    className={showMergeConfirm ? 'ring-1 ring-primary' : ''}
                  >
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={XCircle}
                    onClick={handleClose}
                    loading={closeLoading}
                    disabled={closeLoading}
                  >
                    Close
                  </Button>
                </div>

                {/* Review comment form */}
                {reviewAction && (
                  <ReviewCommentForm
                    onSubmit={handleReview}
                    loading={reviewLoading}
                    action={reviewAction}
                  />
                )}

                {/* Merge confirm */}
                {showMergeConfirm && (
                  <div className="p-3 border border-border rounded-btn bg-hover space-y-2">
                    <p className="text-[11px] font-semibold text-ink">Merge Method</p>
                    <div className="flex items-center gap-2">
                      {(['merge', 'squash', 'rebase'] as const).map(method => (
                        <button
                          key={method}
                          onClick={() => setMergeMethod(method)}
                          className={`px-2.5 py-1 text-[11px] font-medium rounded-btn border transition-colors capitalize ${
                            mergeMethod === method
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted hover:text-ink'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      icon={GitMerge}
                      onClick={handleMerge}
                      loading={mergeLoading}
                      disabled={mergeLoading}
                    >
                      Confirm Merge ({mergeMethod})
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Commits */}
            {selectedPR.commits && selectedPR.commits.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider border-b border-border">
                  Commits ({selectedPR.commits.length})
                </div>
                {selectedPR.commits.map((commit: any, i: number) => (
                  <div key={i} className="px-3 py-2 border-b border-border hover:bg-hover transition-colors">
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary/40 mt-1.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-ink truncate">{commit.message}</p>
                        <span className="text-[10px] font-mono text-muted">{commit.sha?.slice(0, 7)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-hover flex-shrink-0">
        <GitPullRequest size={14} className="text-primary" />
        <span className="text-xs font-semibold text-ink">Pull Requests</span>
        <span className="text-[10px] text-muted font-mono">{filteredPRs.length}</span>
        <div className="flex-1" />
        <button
          onClick={fetchPRs}
          className="p-1 text-muted hover:text-ink rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border flex-shrink-0">
        {([
          { id: 'open' as const, label: 'Open' },
          { id: 'closed' as const, label: 'Closed' },
          { id: 'merged' as const, label: 'Merged' },
          { id: 'all' as const, label: 'All' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setStateFilter(tab.id)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-btn transition-colors ${
              stateFilter === tab.id ? 'bg-primary/10 text-primary' : 'text-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border flex-shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search PRs..."
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-card border border-border rounded-btn outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-500/5 border-b border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto terminal-scroll">
        {/* Loading */}
        {loading && prs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <RefreshCw size={20} className="text-muted animate-spin" />
            <span className="text-xs text-muted mt-2">Loading pull requests...</span>
          </div>
        )}

        {/* Empty */}
        {!loading && filteredPRs.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <GitPullRequest size={28} className="text-muted/30 mb-2" />
            <p className="text-xs text-muted">
              {searchQuery ? 'No PRs match your search.' : `No ${stateFilter === 'all' ? '' : stateFilter + ' '}pull requests.`}
            </p>
            {!searchQuery && stateFilter !== 'all' && (
              <button
                onClick={() => setStateFilter('all')}
                className="text-[11px] text-primary hover:text-primary/80 mt-1"
              >
                Show all PRs
              </button>
            )}
          </div>
        )}

        {/* PR list */}
        {filteredPRs.map(pr => (
          <PRCard key={pr.number} pr={pr} onClick={() => openPRDetail(pr.number)} />
        ))}
      </div>
    </div>
  );
}
