import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  X,
  FileText,
  MessageSquare,
  Eye,
  LayoutTemplate,
  Rocket,
  ListChecks,
} from 'lucide-react';

const LS_STEPS_KEY = 'pl_getting_started_steps';
const LS_DISMISSED_KEY = 'pl_getting_started_dismissed';
const LS_COLLAPSED_KEY = 'pl_getting_started_collapsed';

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const STEPS: ChecklistStep[] = [
  {
    id: 'create_project',
    label: 'Create your first project',
    description: 'Describe what you want to build or pick a template to get started.',
    icon: FileText,
  },
  {
    id: 'try_chat',
    label: 'Try the AI chat',
    description: 'Ask the AI to modify, explain, or improve your code.',
    icon: MessageSquare,
  },
  {
    id: 'preview_app',
    label: 'Preview your app',
    description: 'Open the Preview tab to see your application running live.',
    icon: Eye,
  },
  {
    id: 'explore_templates',
    label: 'Explore templates',
    description: 'Browse the template gallery for inspiration and quick starts.',
    icon: LayoutTemplate,
  },
  {
    id: 'deploy_app',
    label: 'Deploy your app',
    description: 'Push your project live with one click using the Deploy tab.',
    icon: Rocket,
  },
];

function loadCompleted(): Set<string> {
  try {
    const stored = localStorage.getItem(LS_STEPS_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    // ignore
  }
  return new Set();
}

function saveCompleted(completed: Set<string>) {
  try {
    localStorage.setItem(LS_STEPS_KEY, JSON.stringify([...completed]));
  } catch {
    // ignore
  }
}

/** Mark a getting-started step as complete from anywhere in the app. */
export function markStepComplete(stepId: string) {
  const completed = loadCompleted();
  if (!completed.has(stepId)) {
    completed.add(stepId);
    saveCompleted(completed);
    // Dispatch a custom event so the checklist re-renders
    window.dispatchEvent(new CustomEvent('pl_step_complete', { detail: stepId }));
  }
}

export function GettingStarted() {
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  // Load initial state
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_DISMISSED_KEY) === '1') {
        setDismissed(true);
        return;
      }
      setCollapsed(localStorage.getItem(LS_COLLAPSED_KEY) === '1');
    } catch {
      // ignore
    }
    setCompleted(loadCompleted());
  }, []);

  // Listen for external step completions
  useEffect(() => {
    const handler = () => setCompleted(loadCompleted());
    window.addEventListener('pl_step_complete', handler);
    return () => window.removeEventListener('pl_step_complete', handler);
  }, []);

  const toggleStep = useCallback(
    (id: string) => {
      setCompleted((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        saveCompleted(next);
        return next;
      });
    },
    [],
  );

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(LS_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  };

  const handleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  if (dismissed) return null;

  const completedCount = completed.size;
  const totalCount = STEPS.length;
  const progressPct = (completedCount / totalCount) * 100;
  const allDone = completedCount === totalCount;

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={handleCollapse}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-hover transition-colors"
      >
        <ListChecks size={16} className="text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-heading font-bold text-ink">Getting Started</span>
            <span className="text-[11px] text-muted-accessible font-mono">
              {completedCount}/{totalCount}
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-border rounded-full mt-1.5 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          {collapsed ? (
            <ChevronDown size={14} className="text-muted" />
          ) : (
            <ChevronUp size={14} className="text-muted" />
          )}
        </div>
      </button>

      {/* Step list */}
      {!collapsed && (
        <div className="border-t border-border">
          <div className="px-3 py-2 space-y-0.5">
            {STEPS.map((step) => {
              const isDone = completed.has(step.id);
              const Icon = step.icon;
              return (
                <button
                  key={step.id}
                  onClick={() => toggleStep(step.id)}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isDone ? 'opacity-60 hover:opacity-80' : 'hover:bg-hover'
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    {isDone ? (
                      <CheckCircle2 size={16} className="text-success" />
                    ) : (
                      <Circle size={16} className="text-border" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-xs font-medium ${
                        isDone ? 'text-muted line-through' : 'text-ink'
                      }`}
                    >
                      {step.label}
                    </span>
                    {!isDone && (
                      <p className="text-[11px] text-muted-accessible mt-0.5 leading-relaxed">
                        {step.description}
                      </p>
                    )}
                  </div>
                  <Icon
                    size={14}
                    className={`flex-shrink-0 mt-0.5 ${isDone ? 'text-muted' : 'text-primary/50'}`}
                  />
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
            {allDone ? (
              <span className="text-xs text-success font-medium">
                All done -- you are ready to build!
              </span>
            ) : (
              <span className="text-[11px] text-muted">
                Complete each step to learn the basics.
              </span>
            )}
            <button
              onClick={handleDismiss}
              className="flex items-center gap-1 text-[11px] text-muted hover:text-ink transition-colors"
            >
              <X size={11} />
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
