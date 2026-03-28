import { useMemo, useState } from 'react';

export interface HeatMapCell {
  date: string;
  count: number;
}

export interface HeatMapProps {
  data: HeatMapCell[];
  columns?: number;
  rows?: number;
  color?: string;
  live?: boolean;
}

function interpolateColor(base: string, intensity: number): string {
  // Parse hex color
  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);

  // Interpolate from near-transparent to full color
  const minAlpha = 0.08;
  const alpha = minAlpha + intensity * (1 - minAlpha);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function HeatMap({
  data,
  columns = 7,
  rows = 4,
  color = '#553DE9',
  live: _live,
}: HeatMapProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const cellSize = 28;
  const cellGap = 3;
  const totalCells = columns * rows;
  const maxCount = useMemo(
    () => Math.max(...data.map((d) => d.count), 1),
    [data]
  );

  const svgW = columns * (cellSize + cellGap) - cellGap + 16;
  const svgH = rows * (cellSize + cellGap) - cellGap + 16;

  const cells = useMemo(() => {
    const result: Array<{
      x: number;
      y: number;
      count: number;
      date: string;
      intensity: number;
    }> = [];

    for (let i = 0; i < totalCells; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const cellData = data[i];
      const count = cellData?.count ?? 0;
      const date = cellData?.date ?? '';
      const intensity = count / maxCount;

      result.push({
        x: 8 + col * (cellSize + cellGap),
        y: 8 + row * (cellSize + cellGap),
        count,
        date,
        intensity,
      });
    }
    return result;
  }, [data, totalCells, columns, maxCount]);

  // Legend scale
  const legendSteps = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="flex flex-col gap-3">
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="select-none">
        {cells.map((cell, i) => (
          <g key={i}>
            <rect
              x={cell.x}
              y={cell.y}
              width={cellSize}
              height={cellSize}
              rx={4}
              fill={cell.count === 0 ? '#F2F0EB' : interpolateColor(color, cell.intensity)}
              stroke={hoveredIdx === i ? color : 'transparent'}
              strokeWidth={hoveredIdx === i ? 1.5 : 0}
              style={{
                transition: 'fill 0.3s ease, stroke 0.15s',
                cursor: 'pointer',
              }}
              className={cell.count === 0 ? 'dark:fill-[#222228]' : ''}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />

            {/* Tooltip */}
            {hoveredIdx === i && (
              <g>
                <rect
                  x={cell.x + cellSize / 2 - 40}
                  y={cell.y - 26}
                  width={80}
                  height={20}
                  rx={4}
                  fill="#36342E"
                  className="dark:fill-[#E8E6E3]"
                />
                <text
                  x={cell.x + cellSize / 2}
                  y={cell.y - 13}
                  textAnchor="middle"
                  fill="white"
                  className="dark:fill-[#1A1A1E]"
                  style={{ fontSize: 10, fontWeight: 500 }}
                >
                  {cell.date ? `${cell.date}: ${cell.count}` : `${cell.count} events`}
                </text>
              </g>
            )}
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-2 text-xs text-[#939084]">
        <span>Less</span>
        {legendSteps.map((step, i) => (
          <span
            key={i}
            className="inline-block rounded"
            style={{
              width: 12,
              height: 12,
              backgroundColor: step === 0 ? '#F2F0EB' : interpolateColor(color, step),
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export default HeatMap;
