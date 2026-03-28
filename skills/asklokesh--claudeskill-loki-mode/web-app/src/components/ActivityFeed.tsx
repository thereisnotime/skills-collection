import { useState, useEffect, useCallback } from 'react';
import {
  Hammer,
  CheckCircle2,
  FilePlus,
  FileCode2,
  Rocket,
  MessageSquare,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityType =
  | 'build_started'
  | 'build_completed'
  | 'file_created'
  | 'file_modified'
  | 'deploy'
  | 'chat_sent'
  | 'system';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  message: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const typeConfig: Record<
  ActivityType,
  {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    color: string;
    dotColor: string;
  }
> = {
  build_started: { icon: Hammer, color: 'text-primary', dotColor: 'bg-primary' },
  build_completed: { icon: CheckCircle2, color: 'text-success', dotColor: 'bg-success' },
  file_created: { icon: FilePlus, color: 'text-blue-500', dotColor: 'bg-blue-500' },
  file_modified: { icon: FileCode2, color: 'text-blue-400', dotColor: 'bg-blue-400' },
  deploy: { icon: Rocket, color: 'text-green-500', dotColor: 'bg-green-500' },
  chat_sent: { icon: MessageSquare, color: 'text-primary', dotColor: 'bg-primary' },
  system: { icon: Activity, color: 'text-muted', dotColor: 'bg-muted' },
};

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ---------------------------------------------------------------------------
// Global activity store (simple in-memory + event-based)
// ---------------------------------------------------------------------------

let activityItems: ActivityItem[] = [];

export function pushActivity(type: ActivityType, message: string) {
  const item: ActivityItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    timestamp: new Date().toISOString(),
  };
  activityItems = [item, ...activityItems].slice(0, 100);
  window.dispatchEvent(new CustomEvent('pl_activity', { detail: item }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ActivityFeedProps {
  maxItems?: number;
  collapsible?: boolean;
}

export function ActivityFeed({ maxItems = 20, collapsible = true }: ActivityFeedProps) {
  const [items, setItems] = useState<ActivityItem[]>(activityItems);
  const [collapsed, setCollapsed] = useState(false);

  // Listen for new activity events
  useEffect(() => {
    const handler = () => setItems([...activityItems]);
    window.addEventListener('pl_activity', handler);
    return () => window.removeEventListener('pl_activity', handler);
  }, []);

  // Re-render timestamps periodically
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const displayed = items.slice(0, maxItems);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      {collapsible ? (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-hover transition-colors"
        >
          <Activity size={14} className="text-primary flex-shrink-0" />
          <span className="text-sm font-heading font-bold text-ink flex-1">
            Activity
          </span>
          {items.length > 0 && (
            <span className="text-[11px] text-muted-accessible font-mono mr-2">
              {items.length}
            </span>
          )}
          {collapsed ? (
            <ChevronDown size={14} className="text-muted" />
          ) : (
            <ChevronUp size={14} className="text-muted" />
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Activity size={14} className="text-primary" />
          <span className="text-sm font-heading font-bold text-ink">Activity</span>
        </div>
      )}

      {/* Feed */}
      {!collapsed && (
        <div className="max-h-[300px] overflow-y-auto terminal-scroll">
          {displayed.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Clock size={20} className="text-muted/30 mx-auto mb-2" />
              <p className="text-xs text-muted">No activity yet</p>
              <p className="text-[11px] text-muted/70 mt-0.5">
                Actions you take will appear here.
              </p>
            </div>
          ) : (
            <div className="px-3 py-2">
              {displayed.map((item) => {
                const config = typeConfig[item.type] || typeConfig.system;
                const Icon = config.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 py-2 group"
                  >
                    {/* Timeline dot + line */}
                    <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center ${config.color} bg-hover`}
                      >
                        <Icon size={12} />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-ink leading-relaxed">
                        {item.message}
                      </p>
                      <span className="text-[11px] text-muted">
                        {formatRelativeTime(item.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
