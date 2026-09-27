import { Square, Pause, Play } from 'lucide-react';
import type { StatusResponse } from '../types/api';

interface ControlBarProps {
  status: StatusResponse | null;
  prdSummary?: string | null;
  onStop?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  isPaused?: boolean;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function ControlBar({ status, prdSummary, onStop, onPause, onResume, isPaused }: ControlBarProps) {
  const paused = isPaused ?? status?.paused ?? false;

  return (
    <div className="card px-5 py-3 flex items-center gap-6 text-sm">
      {/* Phase */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted uppercase tracking-wider font-medium">Phase</span>
        <span className="font-mono font-semibold text-ink">
          {status?.phase || '--'}
        </span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Complexity */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted uppercase tracking-wider font-medium">Complexity</span>
        <span className={`font-mono font-semibold ${
          status?.complexity === 'complex' ? 'text-warning' :
          status?.complexity === 'simple' ? 'text-success' : 'text-ink'
        }`}>
          {status?.complexity || '--'}
        </span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Tasks */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted uppercase tracking-wider font-medium">Tasks</span>
        <span className="font-mono text-ink">
          {status?.current_task ? (
            <span className="text-xs">{status.current_task}</span>
          ) : (
            <span className="text-muted">--</span>
          )}
        </span>
        {(status?.pending_tasks ?? 0) > 0 && (
          <span className="text-xs text-primary font-mono">
            +{status?.pending_tasks} pending
          </span>
        )}
      </div>

      {/* PRD summary pill */}
      {prdSummary && (
        <>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted uppercase tracking-wider font-medium flex-shrink-0">Building</span>
            <span className="text-xs font-mono text-ink truncate max-w-[220px]" title={prdSummary}>
              {prdSummary.length > 60 ? prdSummary.slice(0, 60) + '...' : prdSummary}
            </span>
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Uptime */}
      {typeof status?.uptime === 'number' && status.uptime > 0 && (
        <span className="font-mono text-xs text-muted">
          {formatUptime(status.uptime)}
        </span>
      )}

      {/* Pause / Resume button */}
      {(onPause || onResume) && (
        <button
          onClick={paused ? onResume : onPause}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-btn text-xs font-semibold border border-warning/30 text-warning hover:bg-warning/10 transition-colors"
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      )}

      {/* Stop button */}
      {onStop && (
        <button
          onClick={onStop}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-btn text-xs font-semibold bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors"
        >
          <Square size={14} />
          Stop
        </button>
      )}
    </div>
  );
}
