import { useState, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  Download,
  Clock,
  Zap,
  PieChart,
} from 'lucide-react';
import { Button } from './ui/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsagePoint {
  date: string;
  tokens: number;
}

export interface CostBreakdown {
  provider: string;
  cost: number;
  percentage: number;
  color: string;
}

export interface TemplateUsage {
  name: string;
  count: number;
}

export interface UsageAnalyticsData {
  tokenUsage: TokenUsagePoint[];
  costBreakdown: CostBreakdown[];
  buildSuccessRate: number;
  totalBuilds: number;
  successfulBuilds: number;
  failedBuilds: number;
  templateUsage: TemplateUsage[];
  peakHours: number[][]; // 7x24 matrix (days x hours)
}

interface UsageAnalyticsProps {
  data?: UsageAnalyticsData;
  className?: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function generateSampleData(): UsageAnalyticsData {
  const now = Date.now();
  const day = 86400000;
  const tokenUsage: TokenUsagePoint[] = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(now - (29 - i) * day).toISOString().split('T')[0],
    tokens: Math.floor(Math.random() * 500000) + 100000,
  }));

  const costBreakdown: CostBreakdown[] = [
    { provider: 'Claude', cost: 124.50, percentage: 62, color: '#553DE9' },
    { provider: 'Codex', cost: 48.30, percentage: 24, color: '#1FC5A8' },
    { provider: 'Gemini', cost: 28.20, percentage: 14, color: '#F59E0B' },
  ];

  const templateUsage: TemplateUsage[] = [
    { name: 'SaaS App', count: 45 },
    { name: 'CLI Tool', count: 32 },
    { name: 'Discord Bot', count: 28 },
    { name: 'REST API', count: 21 },
    { name: 'Chrome Extension', count: 14 },
  ];

  // Generate peak hours data (7 days x 24 hours)
  const peakHours: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, h) => {
      // Simulate higher usage during work hours
      if (h >= 9 && h <= 17) return Math.floor(Math.random() * 80) + 20;
      if (h >= 18 && h <= 22) return Math.floor(Math.random() * 40) + 10;
      return Math.floor(Math.random() * 15);
    })
  );

  return {
    tokenUsage,
    costBreakdown,
    buildSuccessRate: 87,
    totalBuilds: 342,
    successfulBuilds: 298,
    failedBuilds: 44,
    templateUsage,
    peakHours,
  };
}

// ---------------------------------------------------------------------------
// SVG Line Chart
// ---------------------------------------------------------------------------

function TokenLineChart({ data }: { data: TokenUsagePoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxTokens = Math.max(...data.map(d => d.tokens));
  const minTokens = 0;
  const range = maxTokens - minTokens || 1;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartWidth,
    y: padding.top + chartHeight - ((d.tokens - minTokens) / range) * chartHeight,
    ...d,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return String(n);
  };

  // Y-axis ticks
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = minTokens + (range * i) / 4;
    return {
      value: val,
      y: padding.top + chartHeight - (i / 4) * chartHeight,
    };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {yTicks.map((tick, i) => (
        <g key={i}>
          <line
            x1={padding.left}
            y1={tick.y}
            x2={width - padding.right}
            y2={tick.y}
            stroke="currentColor"
            strokeOpacity="0.08"
            strokeDasharray="4 4"
          />
          <text
            x={padding.left - 8}
            y={tick.y + 4}
            textAnchor="end"
            className="text-[10px] fill-[#939084]"
          >
            {formatTokens(tick.value)}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaD} fill="url(#tokenGradient)" opacity="0.15" />

      {/* Line */}
      <path d={pathD} fill="none" stroke="#553DE9" strokeWidth="2" strokeLinejoin="round" />

      {/* Gradient definition */}
      <defs>
        <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#553DE9" />
          <stop offset="100%" stopColor="#553DE9" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Hover points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={p.x}
            cy={p.y}
            r={hoveredIndex === i ? 5 : 3}
            fill={hoveredIndex === i ? '#553DE9' : 'white'}
            stroke="#553DE9"
            strokeWidth="2"
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
          {hoveredIndex === i && (
            <g>
              <rect
                x={p.x - 50}
                y={p.y - 36}
                width="100"
                height="24"
                rx="4"
                fill="#36342E"
              />
              <text
                x={p.x}
                y={p.y - 20}
                textAnchor="middle"
                className="text-[10px] fill-white font-mono"
              >
                {formatTokens(p.tokens)} | {p.date.slice(5)}
              </text>
            </g>
          )}
        </g>
      ))}

      {/* X-axis labels */}
      {[0, Math.floor(data.length / 2), data.length - 1].map(i => (
        <text
          key={i}
          x={points[i].x}
          y={height - 4}
          textAnchor="middle"
          className="text-[10px] fill-[#939084]"
        >
          {data[i].date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SVG Donut Chart
// ---------------------------------------------------------------------------

function CostDonutChart({ data }: { data: CostBreakdown[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.cost, 0);

  const size = 160;
  const center = size / 2;
  const radius = 60;
  const innerRadius = 40;

  let currentAngle = -90; // Start from top

  const slices = data.map((d, i) => {
    const angle = (d.percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const largeArc = angle > 180 ? 1 : 0;

    const outerR = hovered === i ? radius + 4 : radius;

    const path = [
      `M ${center + innerRadius * Math.cos(startRad)} ${center + innerRadius * Math.sin(startRad)}`,
      `L ${center + outerR * Math.cos(startRad)} ${center + outerR * Math.sin(startRad)}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${center + outerR * Math.cos(endRad)} ${center + outerR * Math.sin(endRad)}`,
      `L ${center + innerRadius * Math.cos(endRad)} ${center + innerRadius * Math.sin(endRad)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${center + innerRadius * Math.cos(startRad)} ${center + innerRadius * Math.sin(startRad)}`,
      'Z',
    ].join(' ');

    return { ...d, path, index: i };
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map(s => (
          <path
            key={s.index}
            d={s.path}
            fill={s.color}
            opacity={hovered !== null && hovered !== s.index ? 0.4 : 1}
            className="cursor-pointer transition-opacity"
            onMouseEnter={() => setHovered(s.index)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        {/* Center text */}
        <text x={center} y={center - 6} textAnchor="middle" className="text-xs fill-[#939084]">
          Total
        </text>
        <text x={center} y={center + 12} textAnchor="middle" className="text-sm fill-[#36342E] dark:fill-[#E8E6E3] font-semibold">
          ${total.toFixed(0)}
        </text>
      </svg>

      <div className="flex flex-col gap-2">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-sm"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-[#36342E] dark:text-[#E8E6E3]">{d.provider}</span>
            <span className="text-[#939084] ml-auto font-mono">${d.cost.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peak Hours Heatmap
// ---------------------------------------------------------------------------

function PeakHoursHeatmap({ data }: { data: number[][] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const maxVal = Math.max(...data.flat());

  const getColor = (val: number) => {
    const intensity = maxVal > 0 ? val / maxVal : 0;
    if (intensity === 0) return 'bg-[#F8F4F0] dark:bg-[#1A1A1E]';
    if (intensity < 0.25) return 'bg-[#553DE9]/10';
    if (intensity < 0.5) return 'bg-[#553DE9]/25';
    if (intensity < 0.75) return 'bg-[#553DE9]/50';
    return 'bg-[#553DE9]/80';
  };

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {/* Hour labels */}
        <div className="flex gap-0.5 mb-1 ml-10">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="w-4 text-center text-[9px] text-[#939084]">
              {h % 6 === 0 ? `${h}` : ''}
            </div>
          ))}
        </div>
        {data.map((row, dayIdx) => (
          <div key={dayIdx} className="flex items-center gap-0.5 mb-0.5">
            <span className="w-8 text-right text-[10px] text-[#939084] mr-1">
              {days[dayIdx]}
            </span>
            {row.map((val, hourIdx) => (
              <div
                key={hourIdx}
                className={`w-4 h-4 rounded-sm ${getColor(val)} transition-colors`}
                title={`${days[dayIdx]} ${hourIdx}:00 - ${val} builds`}
              />
            ))}
          </div>
        ))}
        {/* Legend */}
        <div className="flex items-center gap-1 mt-2 ml-10">
          <span className="text-[10px] text-[#939084]">Less</span>
          {['bg-[#F8F4F0] dark:bg-[#1A1A1E]', 'bg-[#553DE9]/10', 'bg-[#553DE9]/25', 'bg-[#553DE9]/50', 'bg-[#553DE9]/80'].map((cls, i) => (
            <div key={i} className={`w-3 h-3 rounded-sm ${cls}`} />
          ))}
          <span className="text-[10px] text-[#939084]">More</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function UsageAnalytics({ data: externalData, className = '' }: UsageAnalyticsProps) {
  const data = externalData || generateSampleData();

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usage-analytics-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            Usage Analytics
          </h3>
        </div>
        <Button size="sm" variant="ghost" icon={Download} onClick={handleExport}>
          Export
        </Button>
      </div>

      {/* Token Usage Over Time */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-[#553DE9]" />
          <h4 className="text-sm font-medium text-[#36342E] dark:text-[#E8E6E3]">Token Usage (30 Days)</h4>
        </div>
        <TokenLineChart data={data.tokenUsage} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cost Breakdown */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <PieChart size={14} className="text-[#553DE9]" />
            <h4 className="text-sm font-medium text-[#36342E] dark:text-[#E8E6E3]">Cost by Provider</h4>
          </div>
          <CostDonutChart data={data.costBreakdown} />
        </div>

        {/* Build Success Rate */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-[#553DE9]" />
            <h4 className="text-sm font-medium text-[#36342E] dark:text-[#E8E6E3]">Build Success Rate</h4>
          </div>

          <div className="flex items-center gap-4 mb-4">
            <span className="text-3xl font-bold text-[#36342E] dark:text-[#E8E6E3]">
              {data.buildSuccessRate}%
            </span>
            <div className="text-xs text-[#939084]">
              <div>{data.successfulBuilds} passed</div>
              <div>{data.failedBuilds} failed</div>
              <div>{data.totalBuilds} total</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-[#F8F4F0] dark:bg-[#1A1A1E] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${data.buildSuccessRate}%`,
                background: data.buildSuccessRate >= 80
                  ? '#1FC5A8'
                  : data.buildSuccessRate >= 60
                  ? '#F59E0B'
                  : '#C45B5B',
              }}
            />
          </div>

          {/* Most Used Templates */}
          <div className="mt-6">
            <h4 className="text-xs font-medium text-[#939084] uppercase tracking-wider mb-2">
              Top Templates
            </h4>
            <div className="space-y-2">
              {data.templateUsage.slice(0, 5).map((t, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-[#36342E] dark:text-[#E8E6E3]">
                    {i + 1}. {t.name}
                  </span>
                  <span className="text-xs font-mono text-[#939084]">{t.count} builds</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Peak Usage Hours */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-[#553DE9]" />
          <h4 className="text-sm font-medium text-[#36342E] dark:text-[#E8E6E3]">Peak Usage Hours</h4>
        </div>
        <PeakHoursHeatmap data={data.peakHours} />
      </div>
    </div>
  );
}
