import { useState, useCallback } from 'react';
import { X, FolderGit2, Loader2, CheckCircle2, AlertCircle, GitBranch } from 'lucide-react';
import { api } from '../api/client';

interface RepoImportProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (sessionId: string) => void;
}

/**
 * Parse a GitHub repo string from various formats into owner/repo.
 * Accepts: "owner/repo", "https://github.com/owner/repo", "github.com/owner/repo"
 */
function parseRepo(input: string): string {
  let repo = input.trim();
  // Strip common prefixes
  for (const prefix of [
    'https://github.com/',
    'http://github.com/',
    'github.com/',
    'git@github.com:',
  ]) {
    if (repo.startsWith(prefix)) {
      repo = repo.slice(prefix.length);
      break;
    }
  }
  // Strip trailing .git and slashes
  repo = repo.replace(/\.git$/, '').replace(/\/+$/, '');
  return repo;
}

function isValidRepo(repo: string): boolean {
  const parts = repo.split('/');
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  return owner.length > 0 && name.length > 0 && /^[a-zA-Z0-9._-]+$/.test(owner) && /^[a-zA-Z0-9._-]+$/.test(name);
}

type ImportPhase = 'idle' | 'cloning' | 'analyzing' | 'ready' | 'error';

export function RepoImport({ open, onClose, onSuccess }: RepoImportProps) {
  const [repoInput, setRepoInput] = useState('');
  const [branch, setBranch] = useState('main');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [filesCount, setFilesCount] = useState(0);

  const resetState = useCallback(() => {
    setRepoInput('');
    setBranch('main');
    setPhase('idle');
    setError(null);
    setFilesCount(0);
  }, []);

  const handleClose = useCallback(() => {
    if (phase === 'cloning' || phase === 'analyzing') return; // Don't close during import
    resetState();
    onClose();
  }, [phase, onClose, resetState]);

  const handleImport = useCallback(async () => {
    const parsed = parseRepo(repoInput);
    if (!isValidRepo(parsed)) {
      setError('Invalid repository format. Use owner/repo or a GitHub URL.');
      return;
    }

    setError(null);
    setPhase('cloning');

    // Generate a session ID from the repo name
    const repoName = parsed.split('/')[1];
    const sessionId = `${repoName}-${Date.now()}`;

    try {
      setPhase('cloning');
      const result = await api.importGitHubRepo(sessionId, parsed, branch);

      if (result.success) {
        setPhase('analyzing');
        setFilesCount(result.files_count);
        // Brief pause to show the analyzing state
        await new Promise(r => setTimeout(r, 800));
        setPhase('ready');
        // Navigate after showing success briefly
        setTimeout(() => {
          onSuccess(sessionId);
        }, 1200);
      }
    } catch (e) {
      setPhase('error');
      if (e instanceof Error) {
        // Try to extract the error message from API response
        const match = e.message.match(/- (.+)$/);
        setError(match ? match[1] : e.message);
      } else {
        setError('Import failed. Please check the repository URL and try again.');
      }
    }
  }, [repoInput, branch, onSuccess]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-card dark:bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderGit2 size={18} className="text-primary" />
            <h3 className="font-heading text-base font-semibold text-ink">Import from GitHub</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={phase === 'cloning' || phase === 'analyzing'}
            className="text-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Progress states */}
          {phase === 'cloning' && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/15">
              <Loader2 size={18} className="text-primary animate-spin" />
              <span className="text-sm font-medium text-primary">Cloning repository...</span>
            </div>
          )}
          {phase === 'analyzing' && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/15">
              <Loader2 size={18} className="text-primary animate-spin" />
              <span className="text-sm font-medium text-primary">
                Analyzing project... ({filesCount} files found)
              </span>
            </div>
          )}
          {phase === 'ready' && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/5 border border-green-500/20 dark:bg-green-500/10">
              <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">
                Ready! {filesCount} files imported. Opening workspace...
              </span>
            </div>
          )}
          {phase === 'error' && error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/5 border border-red-500/20 dark:bg-red-500/10">
              <AlertCircle size={18} className="text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-400">
                <p className="font-medium">Import failed</p>
                <p className="mt-1 text-red-600/80 dark:text-red-400/80">{error}</p>
              </div>
            </div>
          )}

          {/* Repo input */}
          <div>
            <label htmlFor="repo-input" className="block text-xs font-medium text-muted mb-1.5">
              Repository
            </label>
            <input
              id="repo-input"
              type="text"
              value={repoInput}
              onChange={(e) => { setRepoInput(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && phase === 'idle') handleImport(); }}
              placeholder="owner/repo or https://github.com/owner/repo"
              disabled={phase !== 'idle' && phase !== 'error'}
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-surface dark:bg-surface border border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 text-ink placeholder:text-muted disabled:opacity-50 transition-colors"
              autoFocus
            />
          </div>

          {/* Branch input */}
          <div>
            <label htmlFor="branch-input" className="block text-xs font-medium text-muted mb-1.5">
              <span className="flex items-center gap-1">
                <GitBranch size={12} />
                Branch
              </span>
            </label>
            <input
              id="branch-input"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              disabled={phase !== 'idle' && phase !== 'error'}
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-surface dark:bg-surface border border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 text-ink placeholder:text-muted disabled:opacity-50 transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-hover/30">
          <button
            onClick={handleClose}
            disabled={phase === 'cloning' || phase === 'analyzing'}
            className="px-4 py-2 text-sm font-medium text-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={phase === 'error' ? () => { setPhase('idle'); setError(null); } : handleImport}
            disabled={
              (phase === 'idle' && !repoInput.trim()) ||
              phase === 'cloning' ||
              phase === 'analyzing' ||
              phase === 'ready'
            }
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {phase === 'error' ? 'Try Again' : phase === 'cloning' || phase === 'analyzing' ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
