import { useState } from 'react';
import { Terminal, ScrollText, Bot, ShieldCheck, Check, X, Clock, Users, ChevronRight, Activity } from 'lucide-react';
import { TerminalOutput } from './TerminalOutput';
import { TerminalEmulator } from './TerminalEmulator';
import { BuildActivityFeed } from './BuildActivityFeed';
import type { BuildEvent } from './BuildActivityFeed';
import type { LogEntry, Agent, ChecklistSummary } from '../types/api';

interface ActivityPanelProps {
  logs: LogEntry[] | null;
  logsLoading: boolean;
  agents: Agent[] | null;
  checklist: ChecklistSummary | null;
  sessionId: string;
  isRunning?: boolean;
  subscribe?: (type: string, callback: (data: unknown) => void) => () => void;
  buildMode?: 'quick' | 'standard' | 'max';
  buildEvents?: BuildEvent[];
  onFileClick?: (path: string) => void;
}

type TabId = 'terminal' | 'activity' | 'build' | 'agents' | 'quality';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  alwaysShow?: boolean;
}

const TABS: TabDef[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal, alwaysShow: true },
  { id: 'activity', label: 'Activity', icon: Activity, alwaysShow: true },
  { id: 'build', label: 'Build Log', icon: ScrollText },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'quality', label: 'Quality', icon: ShieldCheck },
];

function GateIcon({ status }: { status: string }) {
  switch (status) {
    case 'pass':
      return <Check size={14} className="text-success" />;
    case 'fail':
      return <X size={14} className="text-danger" />;
    default:
      return <Clock size={14} className="text-muted" />;
  }
}

function AgentsTab({ agents }: { agents: Agent[] | null }) {
  if (!agents || agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center h-full">
        <Users size={24} className="text-muted/30 mb-2" />
        <p className="text-xs text-muted font-medium">No agents active</p>
        <p className="text-[11px] text-muted/70 mt-0.5">Agents appear here during active builds</p>
      </div>
    );
  }
  return (
    <div className="p-2 space-y-1 overflow-y-auto terminal-scroll">
      {agents.map(agent => (
        <div key={agent.id} className="flex items-center gap-2 px-3 py-2 rounded-btn bg-hover text-xs">
          <span className="font-semibold text-ink truncate">{agent.name}</span>
          <span className="text-xs font-mono text-muted-accessible px-1.5 py-0.5 rounded-btn bg-card">{agent.type}</span>
          <span className={`text-xs font-semibold ${agent.status === 'running' ? 'text-success' : 'text-muted'}`}>
            {agent.status}
          </span>
          <span className="ml-auto text-xs text-muted-accessible font-mono truncate max-w-[200px]">{agent.task}</span>
        </div>
      ))}
    </div>
  );
}

function QualityTab({ checklist }: { checklist: ChecklistSummary | null }) {
  if (!checklist || !checklist.items || checklist.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center h-full">
        <ShieldCheck size={24} className="text-muted/30 mb-2" />
        <p className="text-xs text-muted font-medium">No quality gate data</p>
        <p className="text-[11px] text-muted/70 mt-0.5">Quality gates appear during active builds</p>
      </div>
    );
  }
  return (
    <div className="p-2 space-y-1 overflow-y-auto terminal-scroll">
      <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted-accessible font-semibold uppercase">
        <span>Gate</span>
        <span className="ml-auto">{checklist.passed}/{checklist.total} passed</span>
      </div>
      {checklist.items.map(item => (
        <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 rounded-btn hover:bg-hover text-xs">
          <GateIcon status={item.status} />
          <span className="text-ink">{item.label}</span>
          {item.details && (
            <span className="ml-auto text-xs text-muted-accessible truncate max-w-[200px]">{item.details}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ActivityPanel({
  logs,
  logsLoading,
  agents,
  checklist,
  sessionId,
  isRunning,
  subscribe,
  buildEvents,
  onFileClick,
}: ActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('terminal');

  // Show build-related tabs only when there's data or a build is running
  const hasAgents = agents && agents.length > 0;
  const hasChecklist = checklist && checklist.items && checklist.items.length > 0;
  const hasLogs = logs && logs.length > 0;

  const visibleTabs = TABS.filter(tab => {
    if (tab.alwaysShow) return true;
    if (tab.id === 'build' && (hasLogs || isRunning)) return true;
    if (tab.id === 'agents' && (hasAgents || isRunning)) return true;
    if (tab.id === 'quality' && (hasChecklist || isRunning)) return true;
    return false;
  });

  // If active tab is hidden, switch to terminal
  if (!visibleTabs.find(t => t.id === activeTab)) {
    setActiveTab('terminal');
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Tab bar */}
      <div role="tablist" className="flex items-center border-b border-border px-2 flex-shrink-0">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <Icon size={14} />
              {tab.label}
              {tab.id === 'agents' && hasAgents && (
                <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
                  {agents!.length}
                </span>
              )}
              {tab.id === 'quality' && hasChecklist && (
                <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-success/10 text-success">
                  {checklist!.passed}/{checklist!.total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div role="tabpanel" aria-label={TABS.find(t => t.id === activeTab)?.label} className="flex-1 min-h-0 overflow-hidden relative">
        <div
          className="absolute inset-0"
          style={{ visibility: activeTab === 'terminal' ? 'visible' : 'hidden', zIndex: activeTab === 'terminal' ? 1 : 0 }}
        >
          <TerminalEmulator sessionId={sessionId} isActive={activeTab === 'terminal'} />
        </div>
        {activeTab === 'build' && <TerminalOutput logs={logs} loading={logsLoading} subscribe={subscribe} />}
        {activeTab === 'agents' && <AgentsTab agents={agents} />}
        {activeTab === 'activity' && <BuildActivityFeed events={buildEvents || []} onFileClick={onFileClick} />}
        {activeTab === 'quality' && <QualityTab checklist={checklist} />}
      </div>
    </div>
  );
}
