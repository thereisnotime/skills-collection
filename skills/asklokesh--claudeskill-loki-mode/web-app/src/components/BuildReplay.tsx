import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, History } from 'lucide-react';
import { api } from '../api/client';
import type { Checkpoint } from '../types/api';

// Steps through the checkpoints the server recorded for this session, one per
// step. Nothing is synthesized: no phases, file appearances, gate results or
// iteration markers that were not recorded as a checkpoint.
interface BuildReplayProps {
  sessionId: string;
}

const STEP_MS = 800;
const SPEEDS = [1, 2, 5] as const;

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return ts && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString() : '--';
}

export function BuildReplay({ sessionId }: BuildReplayProps) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0); // number of checkpoints revealed
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const speed = SPEEDS[speedIndex];
  const total = checkpoints?.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    api.getCheckpoints(sessionId)
      .then(data => { if (!cancelled) setCheckpoints(data); })
      .catch(() => { if (!cancelled) setError('Failed to load checkpoints'); });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep(s => s + 1), STEP_MS / speed);
    return () => clearTimeout(t);
  }, [playing, step, total, speed]);

  if (error) return <div className="text-xs text-danger py-6 text-center">{error}</div>;
  if (checkpoints === null) return <div className="text-xs text-muted py-6 text-center">Loading checkpoints...</div>;
  if (total === 0) return <div className="text-xs text-muted py-6 text-center">No checkpoints recorded for this build.</div>;

  const shown = checkpoints.slice(0, step);

  return (
    <div className="card overflow-hidden">
      <div className="p-3 overflow-y-auto terminal-scroll max-h-[300px] space-y-1">
        {shown.length === 0 ? (
          <div className="text-xs text-muted py-4 text-center">
            Press play to step through {total} recorded checkpoint{total !== 1 ? 's' : ''}.
          </div>
        ) : shown.map(cp => (
          <div key={cp.id} className="flex items-center gap-2 text-xs animate-fade-in">
            <History size={11} className="text-muted flex-shrink-0" />
            <span className="font-mono text-muted flex-shrink-0">{formatTimestamp(cp.timestamp)}</span>
            <span className="truncate text-secondary">{cp.description}</span>
            {(cp.iteration ?? 0) > 0 && <span className="font-mono text-muted flex-shrink-0">Iter {cp.iteration}</span>}
            {(cp.files_changed ?? 0) > 0 && (
              <span className="text-muted flex-shrink-0">
                {cp.files_changed} file{cp.files_changed !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-border">
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (step >= total) setStep(0);
              setPlaying(!playing);
            }}
            className="p-1.5 rounded-card hover:bg-hover transition-colors text-ink"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={() => { setPlaying(false); setStep(0); }}
            className="p-1.5 rounded-card hover:bg-hover transition-colors text-muted"
            title="Reset"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={() => setSpeedIndex((speedIndex + 1) % SPEEDS.length)}
            className="px-2 py-1 rounded-card hover:bg-hover transition-colors text-xs font-mono text-muted"
            title="Playback speed"
          >
            {speed}x
          </button>
        </div>
        <span className="text-xs font-mono text-muted">Checkpoint {step}/{total}</span>
      </div>
    </div>
  );
}
