import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FilePlus, Package, CheckCircle2, XCircle, MessageSquare,
  ChevronDown, ChevronUp, Clock, FileCode2, Terminal,
  Wrench, Rocket, AlertTriangle, Info,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuildEventType =
  | 'file_created'
  | 'file_modified'
  | 'dependency_install'
  | 'test_pass'
  | 'test_fail'
  | 'error'
  | 'narration'
  | 'command'
  | 'phase_change'
  | 'deploy'
  | 'warning'
  | 'info';

export interface BuildEvent {
  id: string;
  type: BuildEventType;
  message: string;
  timestamp: string;
  /** For file events, the relative file path */
  filePath?: string;
  /** For narration events, extended explanation text */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const typeConfig: Record<BuildEventType, {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;        // dot / accent color
  bgColor: string;      // icon background
  labelColor: string;   // text label color
}> = {
  file_created:       { icon: FilePlus,       color: 'bg-blue-500',    bgColor: 'bg-blue-500/10',    labelColor: 'text-blue-600' },
  file_modified:      { icon: FileCode2,      color: 'bg-blue-400',    bgColor: 'bg-blue-400/10',    labelColor: 'text-blue-500' },
  dependency_install: { icon: Package,        color: 'bg-teal-500',    bgColor: 'bg-teal-500/10',    labelColor: 'text-teal-600' },
  test_pass:          { icon: CheckCircle2,   color: 'bg-green-500',   bgColor: 'bg-green-500/10',   labelColor: 'text-green-600' },
  test_fail:          { icon: XCircle,        color: 'bg-red-500',     bgColor: 'bg-red-500/10',     labelColor: 'text-red-500' },
  error:              { icon: XCircle,        color: 'bg-red-500',     bgColor: 'bg-red-500/10',     labelColor: 'text-red-500' },
  narration:          { icon: MessageSquare,  color: 'bg-purple-500',  bgColor: 'bg-purple-500/10',  labelColor: 'text-purple-600' },
  command:            { icon: Terminal,        color: 'bg-gray-500',    bgColor: 'bg-gray-500/10',    labelColor: 'text-gray-600' },
  phase_change:       { icon: Rocket,         color: 'bg-primary',     bgColor: 'bg-primary/10',     labelColor: 'text-primary' },
  deploy:             { icon: Rocket,         color: 'bg-primary',     bgColor: 'bg-primary/10',     labelColor: 'text-primary' },
  warning:            { icon: AlertTriangle,  color: 'bg-yellow-500',  bgColor: 'bg-yellow-500/10',  labelColor: 'text-yellow-600' },
  info:               { icon: Info,           color: 'bg-gray-400',    bgColor: 'bg-gray-400/10',    labelColor: 'text-gray-500' },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

function EventRow({
  event,
  isLast,
  onFileClick,
}: {
  event: BuildEvent;
  isLast: boolean;
  onFileClick?: (path: string) => void;
}) {
  const cfg = typeConfig[event.type] || typeConfig.info;
  const Icon = cfg.icon;
  const isNarration = event.type === 'narration';

  return (
    <div className="flex gap-3 group">
      {/* Timeline rail */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${cfg.bgColor}`}>
          <Icon size={14} className={cfg.labelColor} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-border min-h-[16px]" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 pb-4 ${isLast ? '' : ''}`}>
        {isNarration ? (
          /* Speech bubble style for narration */
          <div className="relative bg-purple-500/5 border border-purple-500/20 rounded-lg px-3 py-2 mt-0.5">
            <div className="absolute -left-1.5 top-2.5 w-2.5 h-2.5 bg-purple-500/5 border-l border-b border-purple-500/20 rotate-45" />
            <p className="text-xs text-ink leading-relaxed">{event.message}</p>
            {event.detail && (
              <p className="text-[11px] text-muted mt-1 leading-relaxed">{event.detail}</p>
            )}
            <span className="text-[10px] text-muted/60 mt-1.5 flex items-center gap-1">
              <Clock size={10} />
              {formatTimestamp(event.timestamp)}
            </span>
          </div>
        ) : (
          /* Standard event row */
          <div className="mt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-medium ${cfg.labelColor}`}>
                {event.message}
              </span>
              {event.filePath && onFileClick && (
                <button
                  onClick={() => onFileClick(event.filePath!)}
                  className="text-[11px] font-mono text-primary hover:text-primary/80 hover:underline truncate max-w-[200px]"
                  title={event.filePath}
                >
                  {event.filePath}
                </button>
              )}
            </div>
            <span className="text-[10px] text-muted/60 flex items-center gap-1 mt-0.5">
              <Clock size={10} />
              {formatTimestamp(event.timestamp)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const COLLAPSE_THRESHOLD = 20;
const VISIBLE_RECENT = 10;

interface BuildActivityFeedProps {
  events: BuildEvent[];
  /** Called when user clicks a file link */
  onFileClick?: (path: string) => void;
  /** Maximum height CSS value (default: 100%) */
  maxHeight?: string;
}

export function BuildActivityFeed({ events, onFileClick, maxHeight }: BuildActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);

  // Auto-scroll to latest event
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  // Auto-collapse when list gets long
  useEffect(() => {
    if (events.length > COLLAPSE_THRESHOLD && collapsed) {
      // keep collapsed
    }
  }, [events.length, collapsed]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Wrench size={28} className="text-muted/30 mb-3" />
        <p className="text-xs text-muted font-medium">No build events yet</p>
        <p className="text-[11px] text-muted/70 mt-1">
          Events will appear here as the build progresses.
        </p>
      </div>
    );
  }

  const shouldCollapse = events.length > COLLAPSE_THRESHOLD && collapsed;
  const visibleEvents = shouldCollapse
    ? events.slice(-VISIBLE_RECENT)
    : events;
  const hiddenCount = shouldCollapse ? events.length - VISIBLE_RECENT : 0;

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto terminal-scroll px-3 py-3"
      style={{ maxHeight: maxHeight || '100%' }}
    >
      {/* Collapsed indicator */}
      {shouldCollapse && hiddenCount > 0 && (
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 font-medium mb-3 ml-9"
        >
          <ChevronUp size={12} />
          Show {hiddenCount} earlier event{hiddenCount !== 1 ? 's' : ''}
        </button>
      )}

      {/* Expanded collapse button */}
      {!collapsed && events.length > COLLAPSE_THRESHOLD && (
        <button
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 font-medium mb-3 ml-9"
        >
          <ChevronDown size={12} />
          Collapse older events
        </button>
      )}

      {/* Event list */}
      {visibleEvents.map((event, index) => (
        <EventRow
          key={event.id}
          event={event}
          isLast={index === visibleEvents.length - 1}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}
