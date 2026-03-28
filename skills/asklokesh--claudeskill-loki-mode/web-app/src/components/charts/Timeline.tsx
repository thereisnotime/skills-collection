import { useMemo, useState } from 'react';

export interface TimelinePhase {
  name: string;
  duration: number;
  color: string;
  status: 'completed' | 'active' | 'pending';
}

export interface TimelineProps {
  phases: TimelinePhase[];
  width?: number;
  height?: number;
  live?: boolean;
}

export function Timeline({
  phases,
  width = 500,
  height = 64,
  live: _live,
}: TimelineProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const totalDuration = useMemo(
    () => phases.reduce((sum, p) => sum + p.duration, 0),
    [phases]
  );

  const barY = 24;
  const barH = 24;
  const padding = 12;
  const usableW = width - padding * 2;

  const segments = useMemo(() => {
    if (totalDuration === 0) return [];
    let cumX = padding;
    return phases.map((phase, i) => {
      const segW = (phase.duration / totalDuration) * usableW;
      const x = cumX;
      cumX += segW;
      return { ...phase, x, width: segW, index: i };
    });
  }, [phases, totalDuration, usableW, padding]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="select-none"
    >
      {/* Background track */}
      <rect
        x={padding}
        y={barY}
        width={usableW}
        height={barH}
        rx={6}
        fill="#F2F0EB"
        className="dark:fill-[#222228]"
      />

      {/* Phase segments */}
      {segments.map((seg, i) => {
        const isFirst = i === 0;
        const isLast = i === segments.length - 1;
        const isHovered = hoveredIdx === i;

        return (
          <g key={i}>
            <rect
              x={seg.x}
              y={barY}
              width={seg.width}
              height={barH}
              rx={isFirst || isLast ? 6 : 0}
              fill={seg.color}
              opacity={seg.status === 'pending' ? 0.25 : isHovered ? 1 : 0.75}
              style={{
                transition: 'opacity 0.15s',
                cursor: 'pointer',
              }}
              className={seg.status === 'active' ? 'phase-active' : ''}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />

            {/* Completed checkmark */}
            {seg.status === 'completed' && seg.width > 18 && (
              <text
                x={seg.x + seg.width / 2}
                y={barY + barH / 2 + 4}
                textAnchor="middle"
                fill="white"
                style={{ fontSize: 12, fontWeight: 700 }}
              >
                &#10003;
              </text>
            )}

            {/* Active indicator dot */}
            {seg.status === 'active' && seg.width > 10 && (
              <circle
                cx={seg.x + seg.width / 2}
                cy={barY + barH / 2}
                r={4}
                fill="white"
                opacity={0.9}
              />
            )}

            {/* Time label above */}
            {seg.width > 30 && (
              <text
                x={seg.x + seg.width / 2}
                y={barY - 6}
                textAnchor="middle"
                className="fill-[#939084]"
                style={{ fontSize: 9 }}
              >
                {seg.duration}s
              </text>
            )}

            {/* Phase name below */}
            {seg.width > 40 && (
              <text
                x={seg.x + seg.width / 2}
                y={barY + barH + 14}
                textAnchor="middle"
                className="fill-[#6B6960] dark:fill-[#8A8880]"
                style={{ fontSize: 10, fontWeight: 500 }}
              >
                {seg.name}
              </text>
            )}

            {/* Tooltip for narrow segments */}
            {isHovered && (
              <g>
                <rect
                  x={seg.x + seg.width / 2 - 44}
                  y={barY - 28}
                  width={88}
                  height={20}
                  rx={4}
                  fill="#36342E"
                  className="dark:fill-[#E8E6E3]"
                />
                <text
                  x={seg.x + seg.width / 2}
                  y={barY - 14}
                  textAnchor="middle"
                  fill="white"
                  className="dark:fill-[#1A1A1E]"
                  style={{ fontSize: 10, fontWeight: 500 }}
                >
                  {seg.name} ({seg.duration}s)
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default Timeline;
