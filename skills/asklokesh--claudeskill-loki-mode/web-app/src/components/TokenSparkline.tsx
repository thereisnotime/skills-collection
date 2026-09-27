import { useEffect, useState, useRef } from 'react';

// B16: Token usage sparkline in header
// SVG-based tiny line chart showing last 10 data points.
// Neutral color: no token budget is configured, so there is no over/under verdict.

interface TokenSparklineProps {
  tokenHistory: number[];
  className?: string;
}

export function TokenSparkline({ tokenHistory, className = '' }: TokenSparklineProps) {
  const points = tokenHistory.slice(-10);
  if (points.length < 2) return null;

  const width = 64;
  const height = 20;
  const padding = 2;

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;

  const coords = points.map((val, i) => ({
    x: padding + (i / (points.length - 1)) * (width - padding * 2),
    y: padding + (1 - (val - min) / range) * (height - padding * 2),
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  // Fill area under the line
  const fillD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padding} L ${coords[0].x.toFixed(1)} ${height - padding} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block align-middle text-muted ${className}`}
      aria-label="Token usage trend"
    >
      <path d={fillD} fill="currentColor" fillOpacity={0.15} />
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Current value dot */}
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}

// Hook to accumulate token history from polling
export function useTokenHistory() {
  const [history, setHistory] = useState<number[]>([]);
  const lastRef = useRef(0);

  const recordTokens = (tokens: number) => {
    if (tokens !== lastRef.current) {
      lastRef.current = tokens;
      setHistory(prev => {
        const next = [...prev, tokens];
        return next.length > 20 ? next.slice(-20) : next;
      });
    }
  };

  return { history, recordTokens };
}
