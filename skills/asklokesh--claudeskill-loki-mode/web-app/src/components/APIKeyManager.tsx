import { useState, useCallback } from 'react';
import {
  Key,
  Plus,
  Copy,
  Trash2,
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Clock,
  Shield,
} from 'lucide-react';
import { Button } from './ui/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface APIKey {
  id: string;
  name: string;
  prefix: string; // first 4 chars
  createdAt: string;
  lastUsed: string | null;
  scopes: APIKeyScope[];
  expiresAt?: string;
}

export type APIKeyScope = 'read' | 'write' | 'admin' | 'deploy';

interface APIKeyManagerProps {
  keys?: APIKey[];
  onCreateKey?: (name: string, scopes: APIKeyScope[]) => Promise<string>;
  onRevokeKey?: (id: string) => Promise<void>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_KEYS: APIKey[] = [
  {
    id: 'key-1',
    name: 'Production CI/CD',
    prefix: 'pk_l',
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    lastUsed: new Date(Date.now() - 3600000).toISOString(),
    scopes: ['read', 'write', 'deploy'],
  },
  {
    id: 'key-2',
    name: 'Staging Environment',
    prefix: 'pk_s',
    createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
    lastUsed: new Date(Date.now() - 86400000).toISOString(),
    scopes: ['read', 'write'],
  },
  {
    id: 'key-3',
    name: 'Monitoring Dashboard',
    prefix: 'pk_m',
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    lastUsed: null,
    scopes: ['read'],
  },
];

const SCOPE_META: Record<APIKeyScope, { label: string; description: string; color: string }> = {
  read: { label: 'Read', description: 'View projects, status, and logs', color: '#1FC5A8' },
  write: { label: 'Write', description: 'Create and modify projects', color: '#553DE9' },
  admin: { label: 'Admin', description: 'Manage users and settings', color: '#F59E0B' },
  deploy: { label: 'Deploy', description: 'Trigger deployments', color: '#C45B5B' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDaysOld(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const days = getDaysOld(dateStr);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ---------------------------------------------------------------------------
// Create Key Dialog
// ---------------------------------------------------------------------------

function CreateKeyDialog({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, scopes: APIKeyScope[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<APIKeyScope>>(new Set(['read']));

  const toggleScope = (scope: APIKeyScope) => {
    setSelectedScopes(prev => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  return (
    <div className="border border-[#553DE9]/20 bg-[#553DE9]/5 dark:bg-[#553DE9]/10 rounded-lg p-4 space-y-4">
      <h4 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3]">
        Create New API Key
      </h4>

      <div>
        <label className="block text-xs font-medium text-[#6B6960] mb-1">Key Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production CI/CD"
          className="w-full px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084]"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[#6B6960] mb-2">Scopes</label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.entries(SCOPE_META) as [APIKeyScope, typeof SCOPE_META[APIKeyScope]][]).map(
            ([scope, meta]) => (
              <button
                key={scope}
                type="button"
                onClick={() => toggleScope(scope)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                  selectedScopes.has(scope)
                    ? 'border-[#553DE9] bg-[#553DE9]/5 dark:bg-[#553DE9]/10'
                    : 'border-[#ECEAE3] dark:border-[#2A2A30] hover:bg-[#F8F4F0] dark:hover:bg-[#222228]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedScopes.has(scope)}
                  readOnly
                  className="rounded border-[#ECEAE3] text-[#553DE9] focus:ring-[#553DE9]"
                />
                <div>
                  <div className="font-medium text-[#201515] dark:text-[#E8E6E3]">{meta.label}</div>
                  <div className="text-xs text-[#939084]">{meta.description}</div>
                </div>
              </button>
            )
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          icon={Key}
          onClick={() => onSubmit(name, Array.from(selectedScopes))}
          disabled={!name.trim() || selectedScopes.size === 0}
        >
          Generate Key
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revoke Confirmation
// ---------------------------------------------------------------------------

function RevokeConfirmation({
  keyName,
  onConfirm,
  onCancel,
}: {
  keyName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border border-[#C45B5B]/30 bg-[#C45B5B]/5 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-[#C45B5B] flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
            Revoke &quot;{keyName}&quot;?
          </p>
          <p className="text-xs text-[#939084] mt-1">
            This action cannot be undone. Any applications using this key will immediately lose access.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" variant="danger" icon={Trash2} onClick={onConfirm}>
              Revoke Key
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function APIKeyManager({
  keys: externalKeys,
  onCreateKey,
  onRevokeKey,
  className = '',
}: APIKeyManagerProps) {
  const [keys, setKeys] = useState<APIKey[]>(externalKeys || SAMPLE_KEYS);
  const [creating, setCreating] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showPrefix, setShowPrefix] = useState<Record<string, boolean>>({});

  const handleCreate = useCallback(
    async (name: string, scopes: APIKeyScope[]) => {
      let fullKey: string;

      if (onCreateKey) {
        fullKey = await onCreateKey(name, scopes);
      } else {
        // Generate a sample key locally
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const rand = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        fullKey = `pk_live_${rand}`;
      }

      const newKey: APIKey = {
        id: `key-${Date.now()}`,
        name,
        prefix: fullKey.slice(0, 4),
        createdAt: new Date().toISOString(),
        lastUsed: null,
        scopes,
      };

      setKeys(prev => [newKey, ...prev]);
      setNewKeyValue(fullKey);
      setCreating(false);
    },
    [onCreateKey]
  );

  const handleRevoke = useCallback(
    async (id: string) => {
      if (onRevokeKey) {
        await onRevokeKey(id);
      }
      setKeys(prev => prev.filter(k => k.id !== id));
      setRevokingId(null);
    },
    [onRevokeKey]
  );

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            API Keys
          </h3>
        </div>
        {!creating && !newKeyValue && (
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
            New Key
          </Button>
        )}
      </div>

      {/* New key display (shown only once on creation) */}
      {newKeyValue && (
        <div className="border border-[#1FC5A8]/30 bg-[#1FC5A8]/5 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Check size={18} className="text-[#1FC5A8] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                API Key Created
              </p>
              <p className="text-xs text-[#939084] mt-1">
                Copy this key now. You will not be able to see it again.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 px-3 py-2 text-sm font-mono bg-[#36342E] text-[#1FC5A8] rounded-lg truncate">
                  {newKeyValue}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copied ? Check : Copy}
                  onClick={() => handleCopy(newKeyValue)}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <button
                onClick={() => setNewKeyValue(null)}
                className="text-xs text-[#553DE9] hover:underline mt-2"
              >
                I have saved this key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      {creating && (
        <CreateKeyDialog
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Key list */}
      <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F8F4F0] dark:bg-[#222228]">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-[#6B6960]">Name</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-[#6B6960]">Key</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-[#6B6960]">Scopes</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-[#6B6960]">Created</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-[#6B6960]">Last Used</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-[#6B6960]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(key => {
              const daysOld = getDaysOld(key.createdAt);
              const needsRotation = daysOld >= 90;

              return (
                <tr
                  key={key.id}
                  className="border-t border-[#ECEAE3] dark:border-[#2A2A30] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-[#553DE9] flex-shrink-0" />
                      <span className="text-[#201515] dark:text-[#E8E6E3] font-medium">{key.name}</span>
                      {needsRotation && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-[#F59E0B]/10 text-[#F59E0B]"
                          title="This key is over 90 days old. Consider rotating it."
                        >
                          <RefreshCw size={10} />
                          {daysOld}d old
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs font-mono text-[#939084]">
                        {showPrefix[key.id] ? `${key.prefix}****...` : `${key.prefix}****...`}
                      </code>
                      <button
                        onClick={() =>
                          setShowPrefix(prev => ({ ...prev, [key.id]: !prev[key.id] }))
                        }
                        className="text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3]"
                        title={showPrefix[key.id] ? 'Hide' : 'Show'}
                      >
                        {showPrefix[key.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map(scope => (
                        <span
                          key={scope}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor: `${SCOPE_META[scope].color}15`,
                            color: SCOPE_META[scope].color,
                          }}
                        >
                          {SCOPE_META[scope].label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-xs text-[#939084]">
                      <Clock size={12} />
                      {formatRelativeDate(key.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[#939084]">
                      {formatRelativeDate(key.lastUsed)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {revokingId === key.id ? (
                      <RevokeConfirmation
                        keyName={key.name}
                        onConfirm={() => handleRevoke(key.id)}
                        onCancel={() => setRevokingId(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setRevokingId(key.id)}
                        className="text-xs text-[#C45B5B] hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#939084]">
                  No API keys yet. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
