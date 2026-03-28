import { useMemo, useState, useRef, useEffect } from 'react';

export interface LineChartDataPoint {
  label: string;
  value: number;
}

export interface LineChartProps {
  data: LineChartDataPoint[];
  width?: number;
  height?: number;
  color?: string;
  live?: boolean;
}

const PADDING = { top: 20, right: 20, bottom: 40, left: 50 };

function formatValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(v % 1 === 0 ? 0 : 2);
}

export function LineChart({
  data,
  width = 400,
  height = 240,
  color = '#553DE9',
  live: _live,
}: LineChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Animate stroke-dasharray on mount
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = mounted ? '0' : `${len}`;
  }, [mounted, data]);

  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  const { pathD, gradientPath, points, minVal, maxVal } = useMemo(() => {
    if (data.length < 2) {
      return { pathD: '', gradientPath: '', points: [], minVal: 0, maxVal: 0 };
    }

    const values = data.map((d) => d.value);
    const mn = Math.min(...values);
    const mx = Math.max(...values);
    const range = mx - mn || 1;
    const step = chartW / (data.length - 1);

    const pts = data.map((d, i) => ({
      x: PADDING.left + i * step,
      y: PADDING.top + chartH - ((d.value - mn) / range) * chartH,
    }));

    // Build smooth bezier path
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
      const cpx2 = curr.x - (curr.x - prev.x) * 0.4;
      d += ` C ${cpx1},${prev.y} ${cpx2},${curr.y} ${curr.x},${curr.y}`;
    }

    // Gradient fill area path
    const gd =
      d +
      ` L ${pts[pts.length - 1].x},${PADDING.top + chartH} L ${pts[0].x},${PADDING.top + chartH} Z`;

    return { pathD: d, gradientPath: gd, points: pts, minVal: mn, maxVal: mx };
  }, [data, chartW, chartH]);

  if (data.length < 2) {
    return (
      <svg width={width} height={height}>
        <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-[#939084] text-sm">
          Not enough data
        </text>
      </svg>
    );
  }

  const gradientId = `line-grad-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="select-none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* Y-axis labels */}
      <text
        x={PADDING.left - 8}
        y={PADDING.top + 4}
        textAnchor="end"
        className="fill-[#939084]"
        style={{ fontSize: 10 }}
      >
        {formatValue(maxVal)}
      </text>
      <text
        x={PADDING.left - 8}
        y={PADDING.top + chartH + 4}
        textAnchor="end"
        className="fill-[#939084]"
        style={{ fontSize: 10 }}
      >
        {formatValue(minVal)}
      </text>

      {/* Grid lines */}
      <line
        x1={PADDING.left}
        y1={PADDING.top}
        x2={PADDING.left + chartW}
        y2={PADDING.top}
        stroke="#ECEAE3"
        strokeWidth={0.5}
        className="dark:stroke-[#2A2A30]"
      />
      <line
        x1={PADDING.left}
        y1={PADDING.top + chartH}
        x2={PADDING.left + chartW}
        y2={PADDING.top + chartH}
        stroke="#ECEAE3"
        strokeWidth={0.5}
        className="dark:stroke-[#2A2A30]"
      />
      <line
        x1={PADDING.left}
        y1={PADDING.top + chartH / 2}
        x2={PADDING.left + chartW}
        y2={PADDING.top + chartH / 2}
        stroke="#ECEAE3"
        strokeWidth={0.5}
        strokeDasharray="4 4"
        className="dark:stroke-[#2A2A30]"
      />

      {/* Gradient fill */}
      <path d={gradientPath} fill={`url(#${gradientId})`} style={{ transition: 'd 0.4s ease' }} />

      {/* Line */}
      <path
        ref={pathRef}
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transition: 'stroke-dashoffset 1.2s ease-out, d 0.4s ease',
        }}
      />

      {/* X-axis labels */}
      {data.map((d, i) => {
        const step = chartW / (data.length - 1);
        const x = PADDING.left + i * step;
        // Show max 6 labels to avoid crowding
        const showLabel = data.length <= 6 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1;
        if (!showLabel) return null;
        return (
          <text
            key={i}
            x={x}
            y={height - 8}
            textAnchor="middle"
            className="fill-[#939084]"
            style={{ fontSize: 10 }}
          >
            {d.label}
          </text>
        );
      })}

      {/* Interactive hover areas and points */}
      {points.map((pt, i) => (
        <g key={i}>
          <rect
            x={pt.x - (chartW / data.length) / 2}
            y={PADDING.top}
            width={chartW / data.length}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{ cursor: 'pointer' }}
          />
          <circle
            cx={pt.x}
            cy={pt.y}
            r={hoveredIdx === i ? 5 : 3}
            fill="white"
            stroke={color}
            strokeWidth={2}
            style={{
              opacity: hoveredIdx === i ? 1 : 0,
              transition: 'opacity 0.15s, r 0.15s',
            }}
          />
        </g>
      ))}

      {/* Tooltip */}
      {hoveredIdx !== null && (
        <g>
          <line
            x1={points[hoveredIdx].x}
            y1={PADDING.top}
            x2={points[hoveredIdx].x}
            y2={PADDING.top + chartH}
            stroke={color}
            strokeWidth={0.5}
            strokeDasharray="3 3"
            opacity={0.4}
          />
          <rect
            x={points[hoveredIdx].x - 30}
            y={points[hoveredIdx].y - 28}
            width={60}
            height={20}
            rx={4}
            fill="#36342E"
            className="dark:fill-[#E8E6E3]"
          />
          <text
            x={points[hoveredIdx].x}
            y={points[hoveredIdx].y - 14}
            textAnchor="middle"
            fill="white"
            className="dark:fill-[#1A1A1E]"
            style={{ fontSize: 11, fontWeight: 600 }}
          >
            {formatValue(data[hoveredIdx].value)}
          </text>
        </g>
      )}
    </svg>
  );
}

export default LineChart;
