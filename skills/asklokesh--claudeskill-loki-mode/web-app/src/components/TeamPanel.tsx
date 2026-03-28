import { useState, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  Eye,
  Edit3,
  Crown,
  Mail,
  X,
  ChevronDown,
} from 'lucide-react';
import { Button } from './ui/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamRole = 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: TeamRole;
  joined_at: string;
}

export interface TeamInfo {
  id: string;
  name: string;
  members: TeamMember[];
  created_at: string;
}

interface TeamPanelProps {
  team: TeamInfo | null;
  onInviteMember?: (email: string, role: TeamRole) => void;
  onRemoveMember?: (memberId: string) => void;
  onChangeRole?: (memberId: string, role: TeamRole) => void;
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

const roleMeta: Record<TeamRole, { label: string; color: string; Icon: typeof Shield }> = {
  admin: {
    label: 'Admin',
    color: 'bg-[#553DE9]/10 text-[#553DE9] border-[#553DE9]/20',
    Icon: Crown,
  },
  editor: {
    label: 'Editor',
    color: 'bg-[#1FC5A8]/10 text-[#1FC5A8] border-[#1FC5A8]/20',
    Icon: Edit3,
  },
  viewer: {
    label: 'Viewer',
    color: 'bg-[#6B6960]/10 text-[#6B6960] border-[#6B6960]/20',
    Icon: Eye,
  },
};

export function RoleBadge({ role }: { role: TeamRole }) {
  const meta = roleMeta[role];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${meta.color}`}
    >
      <meta.Icon size={12} />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------------

function InviteForm({
  onInvite,
  onCancel,
}: {
  onInvite: (email: string, role: TeamRole) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('viewer');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    onInvite(email.trim(), role);
    setEmail('');
  };

  return (
    <form onSubmit={handleSubmit} className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
          Invite Member
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#939084]" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084] focus:outline-none focus:ring-2 focus:ring-[#553DE9]/30"
            required
          />
        </div>

        <div className="relative">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] focus:outline-none focus:ring-2 focus:ring-[#553DE9]/30"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#939084] pointer-events-none" />
        </div>
      </div>

      <Button type="submit" size="sm" icon={UserPlus} disabled={!email.trim()}>
        Send Invite
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Team Panel
// ---------------------------------------------------------------------------

export function TeamPanel({
  team,
  onInviteMember,
  onRemoveMember,
  onChangeRole,
  loading,
}: TeamPanelProps) {
  const [showInvite, setShowInvite] = useState(false);

  const handleInvite = useCallback(
    (email: string, role: TeamRole) => {
      onInviteMember?.(email, role);
      setShowInvite(false);
    },
    [onInviteMember],
  );

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            Team
          </h3>
        </div>
        <div className="text-center py-8 text-[#939084] text-sm">Loading team data...</div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            Team
          </h3>
          {team && (
            <span className="text-xs text-[#939084] font-mono">
              {team.members.length} member{team.members.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {!showInvite && onInviteMember && (
          <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setShowInvite(true)}>
            Invite
          </Button>
        )}
      </div>

      {showInvite && (
        <div className="mb-4">
          <InviteForm onInvite={handleInvite} onCancel={() => setShowInvite(false)} />
        </div>
      )}

      {!team && (
        <div className="text-center py-8">
          <p className="text-[#939084] text-sm">No team configured</p>
          <p className="text-[#553DE9]/60 text-xs mt-1">Create a team to start collaborating</p>
        </div>
      )}

      {team && (
        <div className="space-y-2">
          {team.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
            >
              {member.avatar_url ? (
                <img
                  src={member.avatar_url}
                  alt=""
                  className="w-8 h-8 rounded-full flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#553DE9] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(member.name || member.email)[0].toUpperCase()}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3] truncate">
                  {member.name || member.email}
                </p>
                <p className="text-xs text-[#939084] truncate">{member.email}</p>
              </div>

              <RoleBadge role={member.role} />

              {onChangeRole && member.role !== 'admin' && (
                <select
                  value={member.role}
                  onChange={(e) => onChangeRole(member.id, e.target.value as TeamRole)}
                  className="text-xs border border-[#ECEAE3] dark:border-[#2A2A30] rounded px-1.5 py-1 bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
                  aria-label={`Change role for ${member.name || member.email}`}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              )}

              {onRemoveMember && member.role !== 'admin' && (
                <button
                  onClick={() => onRemoveMember(member.id)}
                  className="text-[#939084] hover:text-[#C45B5B] transition-colors"
                  title={`Remove ${member.name || member.email}`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Project sharing settings */}
      {team && (
        <div className="mt-6 pt-4 border-t border-[#ECEAE3] dark:border-[#2A2A30]">
          <h4 className="text-xs font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider mb-3">
            Project Sharing
          </h4>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#F8F4F0] dark:hover:bg-[#222228] cursor-pointer transition-colors">
              <input type="checkbox" defaultChecked className="rounded border-[#ECEAE3] text-[#553DE9] focus:ring-[#553DE9]" />
              <div>
                <p className="text-sm text-[#201515] dark:text-[#E8E6E3]">Allow editors to share projects</p>
                <p className="text-xs text-[#939084]">Editors can invite new viewers</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#F8F4F0] dark:hover:bg-[#222228] cursor-pointer transition-colors">
              <input type="checkbox" className="rounded border-[#ECEAE3] text-[#553DE9] focus:ring-[#553DE9]" />
              <div>
                <p className="text-sm text-[#201515] dark:text-[#E8E6E3]">Public link sharing</p>
                <p className="text-xs text-[#939084]">Anyone with the link can view</p>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
