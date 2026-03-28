import { useMemo, useState } from 'react';

export interface RadarAxis {
  label: string;
}

export interface RadarDataset {
  label: string;
  values: number[];
  color: string;
}

export interface RadarChartProps {
  axes: RadarAxis[];
  datasets: RadarDataset[];
  size?: number;
  live?: boolean;
}

export function RadarChart({
  axes,
  datasets,
  size = 260,
  live: _live,
}: RadarChartProps) {
  const [hoveredDataset, setHoveredDataset] = useState<number | null>(null);

  const center = size / 2;
  const radius = size * 0.34;
  const labelRadius = size * 0.44;
  const n = axes.length;

  // Calculate vertex positions
  const vertices = useMemo(() => {
    return axes.map((_, i) => {
      const angle = (i * 2 * Math.PI) / n - Math.PI / 2; // start from top
      return {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle),
        labelX: center + labelRadius * Math.cos(angle),
        labelY: center + labelRadius * Math.sin(angle),
      };
    });
  }, [axes, n, center, radius, labelRadius]);

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0];

  const ringPolygons = useMemo(() => {
    return rings.map((frac) => {
      const pts = axes
        .map((_, i) => {
          const angle = (i * 2 * Math.PI) / n - Math.PI / 2;
          const x = center + radius * frac * Math.cos(angle);
          const y = center + radius * frac * Math.sin(angle);
          return `${x},${y}`;
        })
        .join(' ');
      return pts;
    });
  }, [axes, n, center, radius]);

  // Data polygons
  const dataPolygons = useMemo(() => {
    return datasets.map((ds) => {
      const pts = ds.values
        .map((v, i) => {
          const val = Math.min(Math.max(v, 0), 100) / 100;
          const angle = (i * 2 * Math.PI) / n - Math.PI / 2;
          const x = center + radius * val * Math.cos(angle);
          const y = center + radius * val * Math.sin(angle);
          return `${x},${y}`;
        })
        .join(' ');
      return pts;
    });
  }, [datasets, n, center, radius]);

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="select-none">
        {/* Grid rings */}
        {ringPolygons.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill="none"
            stroke="#ECEAE3"
            strokeWidth={0.5}
            className="dark:stroke-[#2A2A30]"
          />
        ))}

        {/* Axis lines */}
        {vertices.map((v, i) => (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={v.x}
            y2={v.y}
            stroke="#ECEAE3"
            strokeWidth={0.5}
            className="dark:stroke-[#2A2A30]"
          />
        ))}

        {/* Data areas */}
        {dataPolygons.map((pts, i) => {
          const ds = datasets[i];
          const isHovered = hoveredDataset === i;
          const isOther = hoveredDataset !== null && hoveredDataset !== i;

          return (
            <polygon
              key={i}
              points={pts}
              fill={ds.color}
              fillOpacity={isHovered ? 0.35 : isOther ? 0.08 : 0.2}
              stroke={ds.color}
              strokeWidth={isHovered ? 2.5 : 1.5}
              strokeOpacity={isOther ? 0.3 : 1}
              strokeLinejoin="round"
              style={{
                transition: 'fill-opacity 0.2s, stroke-width 0.2s, stroke-opacity 0.2s',
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredDataset(i)}
              onMouseLeave={() => setHoveredDataset(null)}
            />
          );
        })}

        {/* Data points */}
        {datasets.map((ds, di) => {
          const isOther = hoveredDataset !== null && hoveredDataset !== di;
          return ds.values.map((v, vi) => {
            const val = Math.min(Math.max(v, 0), 100) / 100;
            const angle = (vi * 2 * Math.PI) / n - Math.PI / 2;
            const x = center + radius * val * Math.cos(angle);
            const y = center + radius * val * Math.sin(angle);
            return (
              <circle
                key={`${di}-${vi}`}
                cx={x}
                cy={y}
                r={3}
                fill={ds.color}
                opacity={isOther ? 0.3 : 1}
                style={{ transition: 'opacity 0.2s' }}
              />
            );
          });
        })}

        {/* Axis labels */}
        {vertices.map((v, i) => {
          // Determine text anchor based on position
          let anchor: 'start' | 'middle' | 'end' = 'middle';
          if (v.labelX > center + 10) anchor = 'start';
          else if (v.labelX < center - 10) anchor = 'end';

          return (
            <text
              key={i}
              x={v.labelX}
              y={v.labelY + (v.labelY > center ? 8 : -2)}
              textAnchor={anchor}
              className="fill-[#6B6960] dark:fill-[#8A8880]"
              style={{ fontSize: 11, fontWeight: 500 }}
            >
              {axes[i].label}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
        {datasets.map((ds, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 text-xs cursor-pointer"
            onMouseEnter={() => setHoveredDataset(i)}
            onMouseLeave={() => setHoveredDataset(null)}
            style={{
              opacity: hoveredDataset !== null && hoveredDataset !== i ? 0.5 : 1,
            }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: ds.color }}
            />
            <span className="text-[#6B6960] dark:text-[#8A8880]">{ds.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RadarChart;
