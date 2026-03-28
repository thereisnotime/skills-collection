import { useMemo } from 'react';

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  live?: boolean;
}

export function Sparkline({
  data,
  width = 60,
  height = 20,
  color = '#553DE9',
  live: _live,
}: SparklineProps) {
  const points = useMemo(() => {
    if (data.length < 2) return '';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 1;
    const usableW = width - padding * 2;
    const usableH = height - padding * 2;
    const step = usableW / (data.length - 1);

    return data
      .map((v, i) => {
        const x = padding + i * step;
        const y = padding + usableH - ((v - min) / range) * usableH;
        return `${x},${y}`;
      })
      .join(' ');
  }, [data, width, height]);

  if (data.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'all 0.4s ease' }}
      />
    </svg>
  );
}

export default Sparkline;
