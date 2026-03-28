import { useMemo, useState, useEffect } from 'react';

export interface BarChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarChartDataPoint[];
  width?: number;
  height?: number;
  color?: string;
  live?: boolean;
}

const PADDING = { top: 16, right: 16, bottom: 36, left: 44 };

function formatValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(v % 1 === 0 ? 0 : 1);
}

export function BarChart({
  data,
  width = 400,
  height = 240,
  color = '#553DE9',
  live: _live,
}: BarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [animProgress, setAnimProgress] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimProgress(1), 50);
    return () => clearTimeout(timer);
  }, []);

  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  const { maxVal, barWidth, gap } = useMemo(() => {
    const mx = Math.max(...data.map((d) => d.value), 1);
    const totalBars = data.length;
    const g = Math.max(4, Math.min(12, chartW / totalBars * 0.2));
    const bw = (chartW - g * (totalBars + 1)) / totalBars;
    return { maxVal: mx, barWidth: Math.max(bw, 4), gap: g };
  }, [data, chartW]);

  // Y-axis scale lines (3 lines)
  const yLines = [0, 0.5, 1].map((frac) => ({
    y: PADDING.top + chartH * (1 - frac),
    label: formatValue(maxVal * frac),
  }));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="select-none">
      {/* Grid lines */}
      {yLines.map((line, i) => (
        <g key={i}>
          <line
            x1={PADDING.left}
            y1={line.y}
            x2={PADDING.left + chartW}
            y2={line.y}
            stroke="#ECEAE3"
            strokeWidth={0.5}
            strokeDasharray={i === 0 ? 'none' : '4 4'}
            className="dark:stroke-[#2A2A30]"
          />
          <text
            x={PADDING.left - 6}
            y={line.y + 3}
            textAnchor="end"
            className="fill-[#939084]"
            style={{ fontSize: 10 }}
          >
            {line.label}
          </text>
        </g>
      ))}

      {/* Bars */}
      {data.map((d, i) => {
        const barH = (d.value / maxVal) * chartH * animProgress;
        const x = PADDING.left + gap + i * (barWidth + gap);
        const y = PADDING.top + chartH - barH;
        const barColor = d.color || color;
        const isHovered = hoveredIdx === i;

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={3}
              fill={barColor}
              opacity={hoveredIdx !== null && !isHovered ? 0.4 : 0.85}
              style={{
                transition: 'y 0.6s ease-out, height 0.6s ease-out, opacity 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />

            {/* Hover highlight */}
            {isHovered && (
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={3}
                fill={barColor}
                opacity={1}
              />
            )}

            {/* X-axis label */}
            <text
              x={x + barWidth / 2}
              y={height - 8}
              textAnchor="middle"
              className="fill-[#939084]"
              style={{ fontSize: data.length > 10 ? 8 : 10 }}
            >
              {d.label}
            </text>

            {/* Tooltip */}
            {isHovered && (
              <g>
                <rect
                  x={x + barWidth / 2 - 24}
                  y={y - 24}
                  width={48}
                  height={18}
                  rx={4}
                  fill="#36342E"
                  className="dark:fill-[#E8E6E3]"
                />
                <text
                  x={x + barWidth / 2}
                  y={y - 11}
                  textAnchor="middle"
                  fill="white"
                  className="dark:fill-[#1A1A1E]"
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {formatValue(d.value)}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default BarChart;
