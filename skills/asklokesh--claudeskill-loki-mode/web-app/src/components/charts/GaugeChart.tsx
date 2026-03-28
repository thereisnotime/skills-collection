import { useMemo, useState, useEffect } from 'react';

export interface GaugeThresholds {
  warning?: number;
  danger?: number;
}

export interface GaugeChartProps {
  value: number;
  label?: string;
  thresholds?: GaugeThresholds;
  size?: number;
  live?: boolean;
}

export function GaugeChart({
  value,
  label = 'Score',
  thresholds = { warning: 60, danger: 30 },
  size = 180,
  live: _live,
}: GaugeChartProps) {
  const [animValue, setAnimValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimValue(Math.min(100, Math.max(0, value))), 80);
    return () => clearTimeout(timer);
  }, [value]);

  const center = size / 2;
  const radius = size * 0.38;
  const strokeWidth = size * 0.09;

  // Semi-circle from 180 degrees (left) to 0 degrees (right)
  const startAngle = 180;
  const endAngle = 0;
  const totalAngle = 180;

  const { dangerEnd, warningEnd } = useMemo(() => {
    const danger = thresholds.danger ?? 30;
    const warning = thresholds.warning ?? 60;
    return {
      dangerEnd: (danger / 100) * totalAngle,
      warningEnd: (warning / 100) * totalAngle,
    };
  }, [thresholds]);

  const toXY = (angleDeg: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center - radius * Math.sin(rad),
    };
  };

  const makeArc = (startDeg: number, endDeg: number) => {
    const s = toXY(startDeg);
    const e = toXY(endDeg);
    const sweep = startDeg - endDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${sweep} 1 ${e.x} ${e.y}`;
  };

  // Needle angle: value 0 -> 180deg (left), value 100 -> 0deg (right)
  const needleAngle = startAngle - (animValue / 100) * totalAngle;
  const needleTip = toXY(needleAngle);

  // Color zones
  const dangerColor = '#C07A5E';   // warm terracotta, not harsh red
  const warningColor = '#D4A843';  // warm amber
  const goodColor = '#1FC5A8';     // teal green

  const currentColor = useMemo(() => {
    if (animValue < (thresholds.danger ?? 30)) return dangerColor;
    if (animValue < (thresholds.warning ?? 60)) return warningColor;
    return goodColor;
  }, [animValue, thresholds]);

  const svgH = size * 0.6;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={svgH} viewBox={`0 0 ${size} ${svgH}`} className="select-none">
        {/* Danger zone (0-30%) */}
        <path
          d={makeArc(startAngle, startAngle - dangerEnd)}
          fill="none"
          stroke={dangerColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.3}
        />

        {/* Warning zone (30-60%) */}
        <path
          d={makeArc(startAngle - dangerEnd, startAngle - warningEnd)}
          fill="none"
          stroke={warningColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.3}
        />

        {/* Good zone (60-100%) */}
        <path
          d={makeArc(startAngle - warningEnd, endAngle)}
          fill="none"
          stroke={goodColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.3}
        />

        {/* Active arc (filled portion) */}
        {animValue > 0 && (
          <path
            d={makeArc(startAngle, needleAngle)}
            fill="none"
            stroke={currentColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{ transition: 'all 0.8s ease-out' }}
          />
        )}

        {/* Needle */}
        <line
          x1={center}
          y1={center}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke={currentColor}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ transition: 'all 0.8s ease-out' }}
        />
        <circle
          cx={center}
          cy={center}
          r={5}
          fill={currentColor}
          style={{ transition: 'fill 0.3s' }}
        />
        <circle cx={center} cy={center} r={2.5} fill="white" className="dark:fill-[#1A1A1E]" />

        {/* Value text */}
        <text
          x={center}
          y={center + radius * 0.45}
          textAnchor="middle"
          style={{ fontSize: 24, fontWeight: 700, transition: 'fill 0.3s' }}
          fill={currentColor}
        >
          {Math.round(animValue)}
        </text>

        {/* Min/Max labels */}
        <text
          x={center - radius - 8}
          y={center + 4}
          textAnchor="middle"
          className="fill-[#939084]"
          style={{ fontSize: 9 }}
        >
          0
        </text>
        <text
          x={center + radius + 8}
          y={center + 4}
          textAnchor="middle"
          className="fill-[#939084]"
          style={{ fontSize: 9 }}
        >
          100
        </text>
      </svg>

      {/* Label */}
      <span className="text-xs text-[#6B6960] dark:text-[#8A8880] -mt-1">{label}</span>
    </div>
  );
}

export default GaugeChart;
