import { useCallback } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { Badge } from './ui/Badge';
import type { SessionHistoryItem } from '../api/client';

interface SessionHistoryProps {
  onLoadSession?: (item: SessionHistoryItem) => void;
}

function mapStatusToBadge(status: string): 'completed' | 'running' | 'failed' | 'started' | 'empty' {
  switch (status) {
    case 'completed':
    case 'complete':
    case 'done':
      return 'completed';
    case 'in_progress':
      return 'running';
    case 'started':
      return 'started';
    case 'error':
    case 'failed':
      return 'failed';
    default:
      return 'empty';
  }
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  complete: 'Completed',
  done: 'Completed',
  in_progress: 'In Progress',
  started: 'Started',
  error: 'Failed',
  failed: 'Failed',
  empty: 'Empty',
};

export function SessionHistory({ onLoadSession }: SessionHistoryProps) {
  const fetchHistory = useCallback(() => api.getSessionsHistory(), []);
  const { data: sessions, loading } = usePolling(fetchHistory, 60000, true);

  if (loading && !sessions) {
    return (
      <div className="card p-4 rounded-card">
        <h3 className="text-sm font-semibold text-ink uppercase tracking-wider mb-3">Past Builds</h3>
        <div className="text-sm text-muted">Loading...</div>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return null;
  }

  return (
    <div className="card p-4 rounded-card">
      <h3 className="text-sm font-semibold text-ink uppercase tracking-wider mb-3">Past Builds</h3>
      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto terminal-scroll">
        {sessions.map((item) => {
          const fileCount = (item as unknown as Record<string, unknown>).file_count as number | undefined;
          return (
            <button
              key={item.id}
              onClick={() => onLoadSession?.(item)}
              className="text-left px-4 py-3 rounded-card card hover:bg-hover transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono text-muted-accessible">{item.date}</span>
                <div className="flex items-center gap-2">
                  {fileCount !== undefined && fileCount > 0 && (
                    <span className="text-xs font-mono text-muted-accessible">
                      {fileCount} files
                    </span>
                  )}
                  <Badge status={mapStatusToBadge(item.status)}>
                    {STATUS_LABELS[item.status] || item.status}
                  </Badge>
                </div>
              </div>
              <div className="text-xs text-ink truncate group-hover:text-primary transition-colors">
                {item.prd_snippet || item.id}
              </div>
              <div className="text-xs font-mono text-muted-accessible mt-0.5 truncate">
                {item.path}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
