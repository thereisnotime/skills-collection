import { useState, useCallback } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Download,
  RefreshCw,
  Clock,
  Key,
  Users,
  FileText,
  Lock,
  Database,
  Eye,
} from 'lucide-react';
import { Button } from './ui/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceStatus = 'pass' | 'fail' | 'warning';

export interface ComplianceItem {
  id: string;
  title: string;
  description: string;
  status: ComplianceStatus;
  category: 'security' | 'access' | 'data' | 'audit';
  lastChecked: string;
  remediationUrl?: string;
  details?: string;
}

interface ComplianceDashboardProps {
  items?: ComplianceItem[];
  onRefresh?: () => Promise<ComplianceItem[]>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: ComplianceStatus }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={18} className="text-[#1FC5A8]" />;
    case 'fail':
      return <XCircle size={18} className="text-[#C45B5B]" />;
    case 'warning':
      return <AlertTriangle size={18} className="text-[#F59E0B]" />;
  }
}

const CATEGORY_ICONS: Record<ComplianceItem['category'], typeof Key> = {
  security: Lock,
  access: Users,
  data: Database,
  audit: Eye,
};

// ---------------------------------------------------------------------------
// Gauge Chart (SVG)
// ---------------------------------------------------------------------------

function ComplianceGauge({ score }: { score: number }) {
  const size = 140;
  const center = size / 2;
  const radius = 56;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;

  // Only show 270 degrees (3/4 of circle)
  const maxAngle = 270;
  const dashLength = (maxAngle / 360) * circumference;
  const filledLength = (score / 100) * dashLength;

  const color = score >= 80 ? '#1FC5A8' : score >= 60 ? '#F59E0B' : '#C45B5B';

  // Rotate to start from bottom-left (135 degrees)
  const rotation = 135;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeWidth={strokeWidth}
          strokeDasharray={`${dashLength} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${center} ${center})`}
        />
        {/* Filled arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${filledLength} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(${rotation} ${center} ${center})`}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[#36342E] dark:text-[#E8E6E3]">{score}%</span>
        <span className="text-xs text-[#939084]">Compliant</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ComplianceDashboard({
  items: externalItems,
  onRefresh,
  className = '',
}: ComplianceDashboardProps) {
  // No sample fallback: with no compliance checks wired there is nothing to score.
  const [items, setItems] = useState<ComplianceItem[]>(externalItems ?? []);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const passCount = items.filter(i => i.status === 'pass').length;
  const warnCount = items.filter(i => i.status === 'warning').length;
  const failCount = items.filter(i => i.status === 'fail').length;
  // Zero checks is not a 0% score: there is no score at all.
  const score = items.length > 0 ? Math.round((passCount / items.length) * 100) : null;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (onRefresh) {
        const updated = await onRefresh();
        setItems(updated);
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const handleGenerateReport = useCallback(() => {
    setGenerating(true);

    const report = {
      generatedAt: new Date().toISOString(),
      overallScore: score,
      summary: { pass: passCount, warning: warnCount, fail: failCount, total: items.length },
      items: items.map(item => ({
        title: item.title,
        status: item.status,
        category: item.category,
        details: item.details,
        lastChecked: item.lastChecked,
      })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setTimeout(() => setGenerating(false), 1000);
  }, [items, score, passCount, warnCount, failCount]);

  // Group by category
  const categories = ['security', 'access', 'data', 'audit'] as const;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            Compliance
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={handleRefresh} loading={refreshing}>
              Refresh
            </Button>
          )}
          {score !== null && (
            <Button size="sm" variant="secondary" icon={Download} onClick={handleGenerateReport} loading={generating}>
              Generate Report
            </Button>
          )}
        </div>
      </div>

      {score === null ? (
        <div className="card p-6 text-center">
          <p className="text-sm font-medium text-[#36342E] dark:text-[#E8E6E3]">Not connected</p>
          <p className="text-xs text-[#939084] mt-1">
            No compliance checks are wired to this server, so there is no score. Nothing here has been checked.
          </p>
        </div>
      ) : (
      <div className="card p-6">
        <div className="flex items-center gap-8">
          <ComplianceGauge score={score} />

          <div className="flex-1 space-y-3">
            <h4 className="text-sm font-medium text-[#36342E] dark:text-[#E8E6E3]">
              Compliance Score
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[#1FC5A8]" />
                <div>
                  <span className="text-lg font-bold text-[#36342E] dark:text-[#E8E6E3]">{passCount}</span>
                  <span className="text-xs text-[#939084] ml-1">Passing</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-[#F59E0B]" />
                <div>
                  <span className="text-lg font-bold text-[#36342E] dark:text-[#E8E6E3]">{warnCount}</span>
                  <span className="text-xs text-[#939084] ml-1">Warnings</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <XCircle size={16} className="text-[#C45B5B]" />
                <div>
                  <span className="text-lg font-bold text-[#36342E] dark:text-[#E8E6E3]">{failCount}</span>
                  <span className="text-xs text-[#939084] ml-1">Failing</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Checklist by category */}
      {categories.map(category => {
        const categoryItems = items.filter(i => i.category === category);
        if (categoryItems.length === 0) return null;
        const CategoryIcon = CATEGORY_ICONS[category];

        return (
          <div key={category} className="space-y-2">
            <div className="flex items-center gap-2">
              <CategoryIcon size={14} className="text-[#553DE9]" />
              <h4 className="text-xs font-semibold text-[#6B6960] uppercase tracking-wider">
                {category}
              </h4>
            </div>

            <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden divide-y divide-[#ECEAE3] dark:divide-[#2A2A30]">
              {categoryItems.map(item => (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
                  >
                    <StatusIcon status={item.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                        {item.title}
                      </p>
                      <p className="text-xs text-[#939084] truncate">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-[#939084] flex-shrink-0">
                      <Clock size={10} />
                      Checked {new Date(item.lastChecked).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                      })}
                    </div>
                  </button>

                  {expandedId === item.id && (
                    <div className="px-4 pb-3 pt-1 bg-[#F8F4F0] dark:bg-[#222228]">
                      {item.details && (
                        <p className="text-sm text-[#6B6960] mb-2">{item.details}</p>
                      )}
                      {item.remediationUrl && item.status !== 'pass' && (
                        <a
                          href={item.remediationUrl}
                          className="inline-flex items-center gap-1 text-xs text-[#553DE9] hover:underline"
                        >
                          <ExternalLink size={12} />
                          Fix this issue
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
