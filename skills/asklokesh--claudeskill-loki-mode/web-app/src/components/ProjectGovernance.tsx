import { useState, useCallback } from 'react';
import {
  Briefcase,
  Check,
  X,
  MessageSquare,
  DollarSign,
  AlertTriangle,
  LayoutTemplate,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  Shield,
} from 'lucide-react';
import { Button } from './ui/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingProject {
  id: string;
  name: string;
  submittedBy: string;
  template: string;
  provider: string;
  estimatedCost: number;
  estimatedIterations: number;
  submittedAt: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface BudgetConfig {
  projectId: string;
  projectName: string;
  budgetLimit: number;
  budgetUsed: number;
  alertThreshold: number; // percentage
}

export interface TemplateRestriction {
  teamId: string;
  teamName: string;
  allowedTemplates: string[];
}

export interface PendingTemplate {
  id: string;
  name: string;
  submittedBy: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

interface ProjectGovernanceProps {
  pendingProjects?: PendingProject[];
  budgetConfigs?: BudgetConfig[];
  templateRestrictions?: TemplateRestriction[];
  pendingTemplates?: PendingTemplate[];
  onApproveProject?: (id: string, comment: string) => Promise<void>;
  onRejectProject?: (id: string, comment: string) => Promise<void>;
  onSetBudget?: (projectId: string, limit: number, alertThreshold: number) => Promise<void>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Approval Card
// ---------------------------------------------------------------------------

function ApprovalCard({
  project,
  onApprove,
  onReject,
}: {
  project: PendingProject;
  onApprove: (comment: string) => void;
  onReject: (comment: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [showActions, setShowActions] = useState(false);

  return (
    <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-[#939084]" />
        ) : (
          <ChevronRight size={14} className="text-[#939084]" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
              {project.name}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F59E0B]/10 text-[#F59E0B]">
              Pending
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#939084] mt-0.5">
            <span className="flex items-center gap-1">
              <User size={10} />
              {project.submittedBy}
            </span>
            <span className="flex items-center gap-1">
              <LayoutTemplate size={10} />
              {project.template}
            </span>
            <span className="flex items-center gap-1">
              <DollarSign size={10} />
              ~${project.estimatedCost.toFixed(2)}
            </span>
          </div>
        </div>
        <span className="text-xs text-[#939084] flex-shrink-0">
          {new Date(project.submittedAt).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
          })}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-[#ECEAE3] dark:border-[#2A2A30] space-y-3">
          {/* Project metadata */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <label className="block text-xs text-[#6B6960]">Template</label>
              <span className="text-[#201515] dark:text-[#E8E6E3] font-medium">{project.template}</span>
            </div>
            <div>
              <label className="block text-xs text-[#6B6960]">Provider</label>
              <span className="text-[#201515] dark:text-[#E8E6E3] font-medium">{project.provider}</span>
            </div>
            <div>
              <label className="block text-xs text-[#6B6960]">Est. Cost</label>
              <span className="text-[#201515] dark:text-[#E8E6E3] font-medium">${project.estimatedCost.toFixed(2)}</span>
            </div>
            <div>
              <label className="block text-xs text-[#6B6960]">Est. Iterations</label>
              <span className="text-[#201515] dark:text-[#E8E6E3] font-medium">{project.estimatedIterations}</span>
            </div>
          </div>

          <p className="text-sm text-[#6B6960]">{project.description}</p>

          {/* Action buttons */}
          {showActions ? (
            <div className="space-y-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment (optional)..."
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084] resize-none"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" icon={Check} onClick={() => onApprove(comment)}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" icon={X} onClick={() => onReject(comment)}>
                  Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowActions(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" icon={MessageSquare} onClick={() => setShowActions(true)}>
                Review
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget Controls
// ---------------------------------------------------------------------------

function BudgetControls({ configs }: { configs: BudgetConfig[] }) {
  return (
    <div className="space-y-3">
      {configs.map(config => {
        const usagePercent = config.budgetLimit > 0
          ? (config.budgetUsed / config.budgetLimit) * 100
          : 0;
        const isWarning = usagePercent >= config.alertThreshold;
        const isOver = usagePercent >= 100;

        return (
          <div key={config.projectId} className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                {config.projectName}
              </span>
              <div className="flex items-center gap-2">
                {isWarning && (
                  <AlertTriangle size={14} className={isOver ? 'text-[#C45B5B]' : 'text-[#F59E0B]'} />
                )}
                <span className="text-xs font-mono text-[#939084]">
                  ${config.budgetUsed.toFixed(2)} / ${config.budgetLimit.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-[#F8F4F0] dark:bg-[#1A1A1E] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(usagePercent, 100)}%`,
                  background: isOver ? '#C45B5B' : isWarning ? '#F59E0B' : '#1FC5A8',
                }}
              />
            </div>

            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-[#939084]">
                {usagePercent.toFixed(0)}% used
              </span>
              <span className="text-[10px] text-[#939084]">
                Alert at {config.alertThreshold}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function NotConnected({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-8">
      <Shield size={24} className="mx-auto text-[#939084] mb-2" />
      <p className="text-sm font-medium text-[#36342E] dark:text-[#E8E6E3]">Not connected</p>
      <p className="text-xs text-[#939084] mt-1">{children}</p>
    </div>
  );
}

export function ProjectGovernance({
  pendingProjects: externalProjects,
  budgetConfigs: externalBudgets,
  onApproveProject,
  onRejectProject,
  className = '',
}: ProjectGovernanceProps) {
  // No sample fallbacks: an unwired section says so instead of inventing rows.
  const [projects, setProjects] = useState<PendingProject[]>(externalProjects ?? []);
  const [activeTab, setActiveTab] = useState<'approvals' | 'budgets' | 'templates'>('approvals');

  const pendingCount = projects.filter(p => p.status === 'pending').length;

  // A decision is shown only after a wired handler recorded it.
  const handleApprove = useCallback(async (id: string, comment: string) => {
    if (!onApproveProject) return;
    await onApproveProject(id, comment);
    setProjects(prev => prev.map(p => p.id === id ? { ...p, status: 'approved' as const } : p));
  }, [onApproveProject]);

  const handleReject = useCallback(async (id: string, comment: string) => {
    if (!onRejectProject) return;
    await onRejectProject(id, comment);
    setProjects(prev => prev.map(p => p.id === id ? { ...p, status: 'rejected' as const } : p));
  }, [onRejectProject]);

  const tabs = [
    { id: 'approvals' as const, label: 'Approvals', icon: Check, count: pendingCount },
    { id: 'budgets' as const, label: 'Budgets', icon: DollarSign },
    { id: 'templates' as const, label: 'Templates', icon: LayoutTemplate },
  ];

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Briefcase size={18} className="text-[#553DE9]" />
        <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
          Project Governance
        </h3>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#ECEAE3] dark:border-[#2A2A30]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[#553DE9] text-[#553DE9]'
                : 'border-transparent text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3]'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-[#553DE9]/10 text-[#553DE9]">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'approvals' && !externalProjects && (
        <NotConnected>
          No project approval workflow is wired to this server, so nothing is waiting and nothing has been reviewed.
        </NotConnected>
      )}

      {activeTab === 'approvals' && externalProjects && (
        <div className="space-y-3">
          {projects.filter(p => p.status === 'pending').length === 0 ? (
            <div className="text-center py-8">
              <Shield size={24} className="mx-auto text-[#939084] mb-2" />
              <p className="text-sm text-[#939084]">No pending approvals</p>
              <p className="text-xs text-[#939084] mt-1">All project requests have been reviewed.</p>
            </div>
          ) : (
            projects
              .filter(p => p.status === 'pending')
              .map(project => (
                <ApprovalCard
                  key={project.id}
                  project={project}
                  onApprove={(comment) => handleApprove(project.id, comment)}
                  onReject={(comment) => handleReject(project.id, comment)}
                />
              ))
          )}
        </div>
      )}

      {activeTab === 'budgets' && (externalBudgets ? (
        <BudgetControls configs={externalBudgets} />
      ) : (
        <NotConnected>
          No per-project budgets are served here. A run&apos;s spend cap is set with LOKI_BUDGET_LIMIT and shown on the Metrics page.
        </NotConnected>
      ))}

      {activeTab === 'templates' && (
        <NotConnected>
          Template restrictions are not stored or enforced by this server, so none are shown.
        </NotConnected>
      )}
    </div>
  );
}
