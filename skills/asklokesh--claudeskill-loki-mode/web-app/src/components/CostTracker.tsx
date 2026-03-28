import { useEffect, useState } from 'react';
import { api } from '../api/client';

const PRICING_PER_1K: Record<string, number> = {
  claude: 0.003,    // Sonnet average
  codex: 0.002,     // GPT-4o average
  gemini: 0.00125,  // Gemini Pro average
  default: 0.003,
};

interface CostTrackerProps {
  className?: string;
  provider?: string;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function getCostColor(cost: number): string {
  if (cost > 5) return 'text-danger';
  if (cost >= 1) return 'text-warning';
  return 'text-success';
}

export function CostTracker({ className = '', provider }: CostTrackerProps) {
  const [cost, setCost] = useState<number>(0);
  const [tokens, setTokens] = useState<number>(0);

  useEffect(() => {
    let mounted = true;

    const fetchMetrics = async () => {
      try {
        const metrics = await api.getMetrics();
        if (!mounted) return;
        const tokensUsed = metrics.tokens_used ?? 0;
        setTokens(tokensUsed);
        // Use explicit cost from metrics if available, otherwise estimate from provider pricing
        const explicitCost = (metrics as Record<string, unknown>).cost as number | undefined;
        if (explicitCost != null) {
          setCost(explicitCost);
        } else {
          // Determine provider: prop > metrics field > default
          const metricsProvider = (metrics as Record<string, unknown>).provider as string | undefined;
          const activeProvider = provider ?? metricsProvider ?? 'default';
          const rate = PRICING_PER_1K[activeProvider] ?? PRICING_PER_1K.default;
          setCost(tokensUsed * (rate / 1000));
        }
      } catch {
        // metrics endpoint may not be available
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [provider]);

  return (
    <span className={`text-xs font-mono ${getCostColor(cost)} ${className}`}>
      ${cost.toFixed(2)} | {formatTokens(tokens)} tokens
    </span>
  );
}
