import { useState, useCallback } from 'react';
import {
  Users,
  Search,
  UserPlus,
  Mail,
  Shield,
  ChevronRight,
  X,
  Check,
  Clock,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { Button } from './ui/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'editor' | 'viewer';
export type UserStatus = 'active' | 'inactive' | 'invited';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  role: UserRole;
  status: UserStatus;
  lastActive: string | null;
  joinedAt: string;
}

interface UserManagementProps {
  users?: ManagedUser[];
  onChangeRole?: (userId: string, role: UserRole) => Promise<void>;
  onToggleStatus?: (userId: string, active: boolean) => Promise<void>;
  onInviteUser?: (email: string, role: UserRole) => Promise<void>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_USERS: ManagedUser[] = [
  {
    id: 'u-1',
    name: 'Alex Chen',
    email: 'alex@company.com',
    role: 'admin',
    status: 'active',
    lastActive: new Date(Date.now() - 300000).toISOString(),
    joinedAt: new Date(Date.now() - 180 * 86400000).toISOString(),
  },
  {
    id: 'u-2',
    name: 'Sarah Johnson',
    email: 'sarah@company.com',
    role: 'editor',
    status: 'active',
    lastActive: new Date(Date.now() - 3600000).toISOString(),
    joinedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
  },
  {
    id: 'u-3',
    name: 'Mike Davis',
    email: 'mike@company.com',
    role: 'editor',
    status: 'active',
    lastActive: new Date(Date.now() - 86400000).toISOString(),
    joinedAt: new Date(Date.now() - 60 * 86400000).toISOString(),
  },
  {
    id: 'u-4',
    name: 'Emily Park',
    email: 'emily@company.com',
    role: 'viewer',
    status: 'inactive',
    lastActive: new Date(Date.now() - 30 * 86400000).toISOString(),
    joinedAt: new Date(Date.now() - 120 * 86400000).toISOString(),
  },
  {
    id: 'u-5',
    name: 'Jordan Lee',
    email: 'jordan@company.com',
    role: 'editor',
    status: 'invited',
    lastActive: null,
    joinedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_META: Record<UserRole, { label: string; color: string }> = {
  admin: { label: 'Admin', color: '#553DE9' },
  editor: { label: 'Editor', color: '#1FC5A8' },
  viewer: { label: 'Viewer', color: '#939084' },
};

const STATUS_META: Record<UserStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: '#1FC5A8' },
  inactive: { label: 'Inactive', color: '#939084' },
  invited: { label: 'Invited', color: '#F59E0B' },
};

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Invite Form
// ---------------------------------------------------------------------------

function InviteForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (email: string, role: UserRole) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('editor');

  return (
    <div className="border border-[#553DE9]/20 bg-[#553DE9]/5 dark:bg-[#553DE9]/10 rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3]">
        Invite New User
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-[#6B6960] mb-1">Email</label>
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#939084]" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084]"
              autoFocus
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6B6960] mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          icon={UserPlus}
          onClick={() => onSubmit(email, role)}
          disabled={!email.trim() || !email.includes('@')}
        >
          Send Invite
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Detail Panel
// ---------------------------------------------------------------------------

function UserDetailPanel({
  user,
  onClose,
  onChangeRole,
  onToggleStatus,
}: {
  user: ManagedUser;
  onClose: () => void;
  onChangeRole: (role: UserRole) => void;
  onToggleStatus: () => void;
}) {
  return (
    <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-10 h-10 rounded-full" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#553DE9] flex items-center justify-center text-white text-sm font-bold">
              {getInitials(user.name)}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">{user.name}</p>
            <p className="text-xs text-[#939084]">{user.email}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-[#939084] hover:bg-[#F8F4F0] dark:hover:bg-[#222228]"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <label className="block text-xs font-medium text-[#6B6960] mb-1">Role</label>
          <select
            value={user.role}
            onChange={(e) => onChangeRole(e.target.value as UserRole)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6B6960] mb-1">Status</label>
          <button
            onClick={onToggleStatus}
            className="flex items-center gap-2 px-3 py-2 w-full rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-sm text-left hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
          >
            {user.status === 'active' ? (
              <>
                <ToggleRight size={16} className="text-[#1FC5A8]" />
                <span className="text-[#1FC5A8]">Active</span>
              </>
            ) : (
              <>
                <ToggleLeft size={16} className="text-[#939084]" />
                <span className="text-[#939084]">Inactive</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 text-xs text-[#939084] pt-2 border-t border-[#ECEAE3] dark:border-[#2A2A30]">
        <div className="flex items-center gap-1">
          <Clock size={12} />
          <span>Last active: {formatRelative(user.lastActive)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={12} />
          <span>Joined: {formatRelative(user.joinedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function UserManagement({
  users: externalUsers,
  onChangeRole,
  onToggleStatus,
  onInviteUser,
  className = '',
}: UserManagementProps) {
  const [users, setUsers] = useState<ManagedUser[]>(externalUsers || SAMPLE_USERS);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [inviting, setInviting] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const filtered = users.filter(u => {
    if (search) {
      const s = search.toLowerCase();
      if (!u.name.toLowerCase().includes(s) && !u.email.toLowerCase().includes(s)) return false;
    }
    if (roleFilter && u.role !== roleFilter) return false;
    return true;
  });

  const selectedUser = users.find(u => u.id === selectedUserId) || null;

  const handleInvite = useCallback(
    async (email: string, role: UserRole) => {
      if (onInviteUser) await onInviteUser(email, role);
      const newUser: ManagedUser = {
        id: `u-${Date.now()}`,
        name: email.split('@')[0],
        email,
        role,
        status: 'invited',
        lastActive: null,
        joinedAt: new Date().toISOString(),
      };
      setUsers(prev => [...prev, newUser]);
      setInviting(false);
    },
    [onInviteUser]
  );

  const handleChangeRole = useCallback(
    async (userId: string, role: UserRole) => {
      if (onChangeRole) await onChangeRole(userId, role);
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, role } : u)));
    },
    [onChangeRole]
  );

  const handleToggleStatus = useCallback(
    async (userId: string) => {
      const user = users.find(u => u.id === userId);
      if (!user) return;
      const newActive = user.status !== 'active';
      if (onToggleStatus) await onToggleStatus(userId, newActive);
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, status: newActive ? 'active' : 'inactive' } : u
        )
      );
    },
    [users, onToggleStatus]
  );

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            User Management
          </h3>
          <span className="text-xs text-[#939084]">{users.length} users</span>
        </div>
        {!inviting && (
          <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setInviting(true)}>
            Invite User
          </Button>
        )}
      </div>

      {/* Invite form */}
      {inviting && (
        <InviteForm
          onSubmit={handleInvite}
          onCancel={() => setInviting(false)}
        />
      )}

      {/* Selected user detail */}
      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          onClose={() => setSelectedUserId(null)}
          onChangeRole={(role) => handleChangeRole(selectedUser.id, role)}
          onToggleStatus={() => handleToggleStatus(selectedUser.id)}
        />
      )}

      {/* Search and filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#939084]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084]"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          className="px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>

      {/* User list */}
      <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden divide-y divide-[#ECEAE3] dark:divide-[#2A2A30]">
        {filtered.map(user => (
          <button
            key={user.id}
            type="button"
            onClick={() => setSelectedUserId(selectedUserId === user.id ? null : user.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors ${
              selectedUserId === user.id ? 'bg-[#F8F4F0] dark:bg-[#222228]' : ''
            }`}
          >
            {/* Avatar */}
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#553DE9] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {getInitials(user.name)}
              </div>
            )}

            {/* Name and email */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3] truncate">
                {user.name}
              </p>
              <p className="text-xs text-[#939084] truncate">{user.email}</p>
            </div>

            {/* Role badge */}
            <span
              className="px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
              style={{
                backgroundColor: `${ROLE_META[user.role].color}15`,
                color: ROLE_META[user.role].color,
              }}
            >
              {ROLE_META[user.role].label}
            </span>

            {/* Status */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: STATUS_META[user.status].color }}
              />
              <span className="text-xs text-[#939084] hidden md:inline">
                {STATUS_META[user.status].label}
              </span>
            </div>

            {/* Last active */}
            <span className="text-xs text-[#939084] flex-shrink-0 hidden lg:inline w-16 text-right">
              {formatRelative(user.lastActive)}
            </span>

            <ChevronRight size={14} className="text-[#939084] flex-shrink-0" />
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[#939084]">
            No users match your search.
          </div>
        )}
      </div>
    </div>
  );
}
