import { useCallback } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

interface MetricsPanelProps {
  visible: boolean;
}

export function MetricsPanel({ visible }: MetricsPanelProps) {
  const fetchMetrics = useCallback(() => api.getMetrics(), []);
  const { data: metrics, loading } = usePolling(fetchMetrics, 15000, visible);

  if (!visible) return null;

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
            <div className="text-xl font-bold text-ink">{metrics.iterations ?? 0}</div>
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
              {(metrics.tokens_used ?? 0).toLocaleString()}
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
