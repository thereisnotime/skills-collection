import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Keyboard, Search } from 'lucide-react';

interface Shortcut {
  keys: string[];
  label: string;
  category: 'navigation' | 'editor' | 'build' | 'general';
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
const mod = isMac ? 'Cmd' : 'Ctrl';

const SHORTCUTS: Shortcut[] = [
  // Navigation
  { keys: [`${mod}+K`], label: 'Open Command Palette', category: 'navigation' },
  { keys: [`${mod}+P`], label: 'Quick open file', category: 'navigation' },
  { keys: [`${mod}+,`], label: 'Open settings', category: 'navigation' },

  // Editor
  { keys: [`${mod}+S`], label: 'Save file', category: 'editor' },
  { keys: [`${mod}+Z`], label: 'Undo', category: 'editor' },
  { keys: [`${mod}+Shift+Z`], label: 'Redo', category: 'editor' },

  // Build
  { keys: [`${mod}+B`], label: 'Start / stop build', category: 'build' },
  { keys: [`${mod}+\``], label: 'Toggle terminal', category: 'build' },

  // General
  { keys: ['?'], label: 'Show keyboard shortcuts', category: 'general' },
  { keys: [`${mod}+?`], label: 'Show keyboard shortcuts (alt)', category: 'general' },
  { keys: ['Escape'], label: 'Close modals', category: 'general' },
];

const CATEGORY_LABELS: Record<string, string> = {
  navigation: 'Navigation',
  editor: 'Editor',
  build: 'Build',
  general: 'General',
};

const CATEGORY_ORDER = ['navigation', 'editor', 'build', 'general'];

export function useKeyboardShortcuts({
  onToggleTerminal,
  onToggleBuild,
}: {
  onToggleTerminal?: () => void;
  onToggleBuild?: () => void;
}) {
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isModKey = isMac ? e.metaKey : e.ctrlKey;

      // Don't trigger "?" shortcut when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      // Cmd+? / Ctrl+?
      if (isModKey && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // "?" key alone (when not in an input)
      if (e.key === '?' && !isModKey && !isInput) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // Cmd+` toggle terminal
      if (isModKey && e.key === '`') {
        e.preventDefault();
        onToggleTerminal?.();
        return;
      }

      // Cmd+B toggle build
      if (isModKey && e.key === 'b') {
        e.preventDefault();
        onToggleBuild?.();
        return;
      }

      // Escape closes modal
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
      }
    },
    [onToggleTerminal, onToggleBuild, showHelp]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { showHelp, setShowHelp };
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  // Reset search when modal opens
  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const filteredShortcuts = useMemo(() => {
    if (!search.trim()) return SHORTCUTS;
    const q = search.toLowerCase();
    return SHORTCUTS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.keys.some((k) => k.toLowerCase().includes(q)) ||
        s.category.toLowerCase().includes(q),
    );
  }, [search]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, Shortcut[]> = {};
    for (const s of filteredShortcuts) {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category].push(s);
    }
    return groups;
  }, [filteredShortcuts]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-primary" />
            <h2 className="text-sm font-heading font-bold text-ink">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink transition-colors p-1 rounded-btn hover:bg-hover"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter shortcuts..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-card border border-border rounded-btn outline-none focus:border-primary transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* Shortcuts grouped by category */}
        <div className="max-h-[400px] overflow-y-auto terminal-scroll">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped[cat];
            if (!items || items.length === 0) return null;
            return (
              <div key={cat}>
                <div className="px-5 pt-3 pb-1">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                    {CATEGORY_LABELS[cat]}
                  </span>
                </div>
                <div className="px-4 space-y-0.5 pb-2">
                  {items.map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between px-2 py-2 rounded-btn hover:bg-hover"
                    >
                      <span className="text-xs text-ink">{s.label}</span>
                      <div className="flex items-center gap-1">
                        {s.keys.map((key) => (
                          <kbd
                            key={key}
                            className="px-2 py-0.5 text-[11px] font-mono bg-hover border border-border rounded text-muted-accessible"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {filteredShortcuts.length === 0 && (
            <div className="px-5 py-8 text-center">
              <p className="text-xs text-muted">No shortcuts matching "{search}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border text-center">
          <span className="text-[11px] text-muted">
            Press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-hover border border-border rounded">Escape</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

export function ShortcutsHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Keyboard shortcuts"
      className="inline-flex items-center justify-center w-7 h-7 rounded-btn text-muted hover:text-ink hover:bg-hover transition-colors text-xs font-bold"
    >
      ?
    </button>
  );
}
