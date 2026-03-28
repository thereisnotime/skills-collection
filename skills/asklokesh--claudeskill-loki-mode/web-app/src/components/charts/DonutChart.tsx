import { useMemo, useState, useEffect } from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  live?: boolean;
}

function formatTotal(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toString();
}

export function DonutChart({
  segments,
  size = 200,
  thickness = 32,
  live: _live,
}: DonutChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [animProgress, setAnimProgress] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimProgress(1), 50);
    return () => clearTimeout(timer);
  }, []);

  const total = useMemo(() => segments.reduce((s, seg) => s + seg.value, 0), [segments]);
  const center = size / 2;
  const radius = (size - thickness) / 2 - 4;

  const arcs = useMemo(() => {
    if (total === 0) return [];
    let cumAngle = -90; // start from top
    return segments.map((seg) => {
      const angle = (seg.value / total) * 360;
      const startAngle = cumAngle;
      cumAngle += angle;
      const endAngle = cumAngle;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;

      const x1 = center + radius * Math.cos(startRad);
      const y1 = center + radius * Math.sin(startRad);
      const x2 = center + radius * Math.cos(endRad);
      const y2 = center + radius * Math.sin(endRad);

      const largeArc = angle > 180 ? 1 : 0;

      const d = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
      const percentage = ((seg.value / total) * 100).toFixed(1);

      return { d, percentage, startAngle, endAngle };
    });
  }, [segments, total, center, radius]);

  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="select-none">
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#ECEAE3"
          strokeWidth={thickness}
          className="dark:stroke-[#2A2A30]"
        />

        {/* Segments */}
        {arcs.map((arc, i) => {
          const seg = segments[i];
          const angle = (seg.value / total) * 360;
          const segLen = (angle / 360) * circumference;
          const segOffset = circumference - segLen * animProgress;

          // Calculate rotation to position segment correctly
          let cumAngle = -90;
          for (let j = 0; j < i; j++) {
            cumAngle += (segments[j].value / total) * 360;
          }

          return (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={hoveredIdx === i ? thickness + 6 : thickness}
              strokeDasharray={`${segLen} ${circumference - segLen}`}
              strokeDashoffset={segOffset}
              strokeLinecap="butt"
              transform={`rotate(${cumAngle} ${center} ${center})`}
              style={{
                transition: 'stroke-dashoffset 0.8s ease-out, stroke-width 0.15s ease',
                cursor: 'pointer',
                opacity: hoveredIdx !== null && hoveredIdx !== i ? 0.5 : 1,
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          );
        })}

        {/* Center text */}
        <text
          x={center}
          y={center - 6}
          textAnchor="middle"
          className="fill-[#36342E] dark:fill-[#E8E6E3]"
          style={{ fontSize: 22, fontWeight: 700 }}
        >
          {formatTotal(total)}
        </text>
        <text
          x={center}
          y={center + 14}
          textAnchor="middle"
          className="fill-[#939084]"
          style={{ fontSize: 11 }}
        >
          {hoveredIdx !== null
            ? `${segments[hoveredIdx].label} (${arcs[hoveredIdx]?.percentage}%)`
            : 'Total'}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
        {segments.map((seg, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 text-xs cursor-pointer"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{ opacity: hoveredIdx !== null && hoveredIdx !== i ? 0.5 : 1 }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-[#6B6960] dark:text-[#8A8880]">
              {seg.label}
            </span>
            <span className="text-[#36342E] dark:text-[#C5C0B8] font-medium">
              {formatTotal(seg.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DonutChart;
