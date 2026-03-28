import { useState } from 'react';
import {
  X,
  Link2,
  Copy,
  Check,
  Mail,
  ChevronDown,
  Send,
  Users,
  UserPlus,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Share dialog (H91)
// ---------------------------------------------------------------------------

interface ShareProjectProps {
  open: boolean;
  onClose: () => void;
  projectName?: string;
}

export function ShareProject({ open, onClose, projectName }: ShareProjectProps) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/shared/${encodeURIComponent(
    projectName || 'project',
  )}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-primary" />
            <h2 className="text-sm font-heading font-bold text-ink">
              Share Project
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink transition-colors p-1 rounded-btn hover:bg-hover"
          >
            <X size={14} />
          </button>
        </div>

        {/* Shareable link */}
        <div className="px-5 py-4">
          <label className="text-xs font-medium text-ink block mb-2">
            Shareable link
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-hover border border-border rounded-btn">
              <Link2 size={14} className="text-muted flex-shrink-0" />
              <span className="text-xs text-ink truncate font-mono">
                {shareUrl}
              </span>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-btn bg-primary text-white hover:bg-primary-hover transition-colors flex-shrink-0"
            >
              {copied ? (
                <>
                  <Check size={14} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy
                </>
              )}
            </button>
          </div>
          <p className="text-[11px] text-muted mt-2">
            Anyone with this link can view the project. They will need to sign
            in to make changes.
          </p>
        </div>

        {/* Invite by email (H93) */}
        <ProjectInvitation />

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-btn text-ink hover:bg-hover transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project invitation form (H93)
// ---------------------------------------------------------------------------

function ProjectInvitation() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor' | 'admin'>('editor');
  const [sent, setSent] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);

  const handleInvite = () => {
    if (!email.trim() || !email.includes('@')) return;
    // Placeholder -- would send API request in production
    setSent(true);
    setTimeout(() => {
      setSent(false);
      setEmail('');
    }, 2000);
  };

  const roles = [
    { value: 'viewer' as const, label: 'Viewer', desc: 'Can view project' },
    { value: 'editor' as const, label: 'Editor', desc: 'Can edit files and chat' },
    { value: 'admin' as const, label: 'Admin', desc: 'Full access including settings' },
  ];

  return (
    <div className="px-5 py-4 border-t border-border">
      <label className="text-xs font-medium text-ink block mb-2">
        <div className="flex items-center gap-1.5">
          <UserPlus size={12} className="text-primary" />
          Invite teammates
        </div>
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 relative flex items-center">
          <Mail size={14} className="absolute left-3 text-muted" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleInvite();
            }}
            placeholder="teammate@company.com"
            className="w-full pl-9 pr-3 py-2 text-xs bg-card border border-border rounded-btn outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Role selector */}
        <div className="relative">
          <button
            onClick={() => setRoleOpen(!roleOpen)}
            className="flex items-center gap-1 px-3 py-2 text-xs border border-border rounded-btn hover:bg-hover transition-colors capitalize"
          >
            {role}
            <ChevronDown size={12} className="text-muted" />
          </button>
          {roleOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-lg shadow-lg py-1 z-50">
              {roles.map((r) => (
                <button
                  key={r.value}
                  onClick={() => {
                    setRole(r.value);
                    setRoleOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-hover transition-colors ${
                    role === r.value ? 'text-primary' : 'text-ink'
                  }`}
                >
                  <span className="font-medium">{r.label}</span>
                  <span className="text-muted ml-1">-- {r.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleInvite}
          disabled={!email.trim() || !email.includes('@')}
          className="flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-btn bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {sent ? (
            <>
              <Check size={14} />
              Sent
            </>
          ) : (
            <>
              <Send size={14} />
              Invite
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team presence indicators (H92)
// ---------------------------------------------------------------------------

interface TeamMember {
  name: string;
  avatar_url?: string;
  online: boolean;
}

interface TeamPresenceProps {
  members: TeamMember[];
}

export function TeamPresence({ members }: TeamPresenceProps) {
  if (members.length === 0) return null;

  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);

  return (
    <div className="flex items-center gap-1">
      <Users size={12} className="text-muted mr-1" />
      {/* Online avatars */}
      {online.map((m) => (
        <div key={m.name} className="relative" title={`${m.name} (online)`}>
          {m.avatar_url ? (
            <img
              src={m.avatar_url}
              alt={m.name}
              className="w-6 h-6 rounded-full ring-2 ring-card"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-card">
              {m.name[0]?.toUpperCase()}
            </div>
          )}
          {/* Green online dot */}
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-card" />
        </div>
      ))}
      {/* Offline avatars (dimmed) */}
      {offline.slice(0, 3).map((m) => (
        <div key={m.name} className="relative opacity-50" title={`${m.name} (offline)`}>
          {m.avatar_url ? (
            <img
              src={m.avatar_url}
              alt={m.name}
              className="w-6 h-6 rounded-full ring-2 ring-card"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-card">
              {m.name[0]?.toUpperCase()}
            </div>
          )}
        </div>
      ))}
      {offline.length > 3 && (
        <span className="text-[10px] text-muted ml-0.5">
          +{offline.length - 3}
        </span>
      )}
    </div>
  );
}
