import { useCallback } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

interface MetricsPanelProps {
  visible: boolean;
}

// `loki metrics --json` nests these (autonomy/loki cmd_metrics); the flat keys
// only come from the server's text fallback.
type LokiMetricsJson = {
  agent_activity?: { total_iterations?: unknown };
  tokens?: { total?: unknown };
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function MetricsPanel({ visible }: MetricsPanelProps) {
  const fetchMetrics = useCallback(() => api.getMetrics(), []);
  const { data: metrics, loading } = usePolling(fetchMetrics, 15000, visible);

  if (!visible) return null;

  const nested = metrics as LokiMetricsJson | null;
  const iterations = num(nested?.agent_activity?.total_iterations) ?? num(metrics?.iterations);
  // tokens.total sums absent per-iteration counts as 0, so 0 means not recorded.
  const tokens = num(nested?.tokens?.total) ?? num(metrics?.tokens_used);

  return (
    <div className="card p-4 rounded-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink uppercase tracking-wider">
          Session Metrics
        </h3>
        {loading && (
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {metrics ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="card rounded-card p-3">
            <div className="text-xs font-semibold text-muted-accessible uppercase tracking-wider mb-1">Iterations</div>
            <div className="text-xl font-bold text-ink">{iterations ?? 'N/A'}</div>
          </div>
          <div className="card rounded-card p-3">
            <div className="text-xs font-semibold text-muted-accessible uppercase tracking-wider mb-1">Gate Pass Rate</div>
            <div className="text-xl font-bold text-ink">
              {typeof metrics.quality_gate_pass_rate === 'number'
                ? `${metrics.quality_gate_pass_rate.toFixed(0)}%`
                : 'N/A'}
            </div>
          </div>
          <div className="card rounded-card p-3">
            <div className="text-xs font-semibold text-muted-accessible uppercase tracking-wider mb-1">Tokens Used</div>
            <div className="text-xl font-bold text-ink">
              {tokens !== null && tokens > 0 ? tokens.toLocaleString() : 'N/A'}
            </div>
          </div>
          <div className="card rounded-card p-3">
            <div className="text-xs font-semibold text-muted-accessible uppercase tracking-wider mb-1">Time Elapsed</div>
            <div className="text-xl font-bold text-ink">
              {metrics.time_elapsed || 'N/A'}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted py-4 text-center">
          {loading ? 'Loading metrics...' : 'No metrics available'}
        </div>
      )}
    </div>
  );
}
