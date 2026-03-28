import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { ContextualHelp, HELP_TOOLTIPS } from './ContextualHelp';

interface ProviderPanelProps {
  currentProvider?: string;
  isRunning: boolean;
  onProviderChange?: (provider: string) => void;
}

export function ProviderPanel({ currentProvider, isRunning, onProviderChange }: ProviderPanelProps) {
  const [provider, setProvider] = useState(currentProvider || 'claude');
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync from parent or fetch from backend
  useEffect(() => {
    if (currentProvider) {
      setProvider(currentProvider);
      return;
    }
    api.getCurrentProvider()
      .then(({ provider: p }) => setProvider(p))
      .catch(() => {});
  }, [currentProvider]);

  const handleSet = useCallback(async (p: string) => {
    setSetting(true);
    setError(null);
    try {
      await api.setProvider(p);
      setProvider(p);
      onProviderChange?.(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set provider');
    } finally {
      setSetting(false);
    }
  }, [onProviderChange]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-muted-accessible uppercase tracking-wider">Provider</span>
        <ContextualHelp text={HELP_TOOLTIPS.providerSelector} position="right" size={12} />
      </div>
      <div className="flex items-center gap-1 card rounded-card p-1">
        {['claude', 'codex', 'gemini'].map((p) => (
          <button
            key={p}
            onClick={() => !isRunning && handleSet(p)}
            disabled={setting || isRunning}
            title={isRunning ? 'Stop the build to switch provider' : undefined}
            className={`px-3 py-1.5 text-xs font-semibold rounded-btn transition-all ${
              provider === p
                ? 'bg-primary text-white shadow-sm'
                : isRunning
                ? 'text-muted cursor-not-allowed'
                : 'text-muted hover:text-ink hover:bg-hover cursor-pointer'
            }`}
          >
            {p === 'claude' ? 'Claude' : p === 'codex' ? 'Codex' : 'Gemini'}
          </button>
        ))}
      </div>
      {isRunning && (
        <div className="text-xs text-muted-accessible">Stop build to switch provider</div>
      )}
      {error && (
        <div className="text-xs text-danger">{error}</div>
      )}
    </div>
  );
}
