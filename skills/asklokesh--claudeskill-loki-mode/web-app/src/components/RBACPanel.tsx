import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Plus,
  Save,
  Trash2,
  Clock,
  User,
  Activity,
  ChevronDown,
  ChevronRight,
  Lock,
} from 'lucide-react';
import { Button } from './ui/Button';
import { api } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Permission {
  id: string;
  label: string;
  description: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[]; // permission IDs
  isSystem?: boolean; // built-in roles cannot be deleted
}

export interface AuditEntry {
  id: string;
  action: string;
  user: string;
  target?: string;
  timestamp: string;
  details?: string;
}

interface RBACPanelProps {
  teamId?: string;
}

// ---------------------------------------------------------------------------
// Default permissions & roles
// ---------------------------------------------------------------------------

const DEFAULT_PERMISSIONS: Permission[] = [
  { id: 'project.create', label: 'Create Projects', description: 'Create new projects' },
  { id: 'project.edit', label: 'Edit Projects', description: 'Modify project files and settings' },
  { id: 'project.delete', label: 'Delete Projects', description: 'Delete projects permanently' },
  { id: 'project.view', label: 'View Projects', description: 'View project files and status' },
  { id: 'project.deploy', label: 'Deploy Projects', description: 'Trigger deployments' },
  { id: 'team.manage', label: 'Manage Team', description: 'Add/remove team members' },
  { id: 'team.invite', label: 'Invite Members', description: 'Send team invitations' },
  { id: 'role.manage', label: 'Manage Roles', description: 'Create and modify roles' },
  { id: 'audit.view', label: 'View Audit Log', description: 'Access audit history' },
  { id: 'settings.edit', label: 'Edit Settings', description: 'Modify team settings' },
];

const DEFAULT_ROLES: Role[] = [
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full access to all features',
    permissions: DEFAULT_PERMISSIONS.map(p => p.id),
    isSystem: true,
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Can create and edit projects',
    permissions: ['project.create', 'project.edit', 'project.view', 'project.deploy', 'team.invite'],
    isSystem: true,
  },
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access',
    permissions: ['project.view'],
    isSystem: true,
  },
];

// ---------------------------------------------------------------------------
// Role editor
// ---------------------------------------------------------------------------

function RoleEditor({
  role,
  permissions,
  onSave,
  onDelete,
  onCancel,
}: {
  role: Role | null;
  permissions: Permission[];
  onSave: (role: Role) => void;
  onDelete?: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(
    new Set(role?.permissions || []),
  );

  const togglePerm = (permId: string) => {
    setSelectedPerms(prev => {
      const next = new Set(prev);
      if (next.has(permId)) {
        next.delete(permId);
      } else {
        next.add(permId);
      }
      return next;
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: role?.id || `role-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      permissions: Array.from(selectedPerms),
    });
  };

  return (
    <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3]">
          {role ? 'Edit Role' : 'Create Role'}
        </h4>
        <button
          onClick={onCancel}
          className="text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3]"
        >
          <span className="text-xs">Cancel</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#6B6960] mb-1">Role Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Deployer"
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084]"
            disabled={role?.isSystem}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6B6960] mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description"
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084]"
          />
        </div>
      </div>

      {/* Permission matrix */}
      <div>
        <label className="block text-xs font-medium text-[#6B6960] mb-2">Permissions</label>
        <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F8F4F0] dark:bg-[#222228]">
                <th className="text-left px-3 py-2 text-xs font-medium text-[#6B6960]">Permission</th>
                <th className="text-center px-3 py-2 text-xs font-medium text-[#6B6960] w-20">Granted</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map(perm => (
                <tr
                  key={perm.id}
                  className="border-t border-[#ECEAE3] dark:border-[#2A2A30] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
                >
                  <td className="px-3 py-2">
                    <p className="text-sm text-[#201515] dark:text-[#E8E6E3]">{perm.label}</p>
                    <p className="text-xs text-[#939084]">{perm.description}</p>
                  </td>
                  <td className="text-center px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedPerms.has(perm.id)}
                      onChange={() => togglePerm(perm.id)}
                      className="rounded border-[#ECEAE3] text-[#553DE9] focus:ring-[#553DE9]"
                      disabled={role?.isSystem}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!role?.isSystem && (
          <Button size="sm" icon={Save} onClick={handleSave} disabled={!name.trim()}>
            {role ? 'Update Role' : 'Create Role'}
          </Button>
        )}
        {role && !role.isSystem && onDelete && (
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => onDelete(role.id)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log viewer
// ---------------------------------------------------------------------------

function AuditLogViewer({ entries, loading }: { entries: AuditEntry[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="text-center py-8 text-[#939084] text-sm">Loading audit log...</div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-[#939084] text-sm">No audit entries</p>
        <p className="text-[#553DE9]/60 text-xs mt-1">Actions will appear here as they occur</p>
      </div>
    );
  }

  return (
    <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#F8F4F0] dark:bg-[#222228]">
            <th className="text-left px-3 py-2 text-xs font-medium text-[#6B6960]">Action</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-[#6B6960]">User</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-[#6B6960]">Target</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-[#6B6960]">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr
              key={entry.id}
              className="border-t border-[#ECEAE3] dark:border-[#2A2A30] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Activity size={12} className="text-[#553DE9]" />
                  <span className="text-[#201515] dark:text-[#E8E6E3] font-medium">{entry.action}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <User size={12} className="text-[#939084]" />
                  <span className="text-[#201515] dark:text-[#E8E6E3]">{entry.user}</span>
                </div>
              </td>
              <td className="px-3 py-2 text-[#6B6960]">
                {entry.target || '--'}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5 text-[#939084]">
                  <Clock size={12} />
                  <span className="text-xs font-mono">{entry.timestamp}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RBAC Panel
// ---------------------------------------------------------------------------

export function RBACPanel({ teamId }: RBACPanelProps) {
  const [roles, setRoles] = useState<Role[]>(DEFAULT_ROLES);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [activeSection, setActiveSection] = useState<'roles' | 'audit'>('roles');
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  // Load audit log
  useEffect(() => {
    if (activeSection !== 'audit') return;
    setAuditLoading(true);
    api.getAuditLog()
      .then(entries => setAuditEntries(entries))
      .catch(() => {
        // Use sample data when endpoint is not yet available
        setAuditEntries([
          { id: '1', action: 'member.invited', user: 'admin@example.com', target: 'dev@example.com', timestamp: new Date().toISOString(), details: 'Invited as editor' },
          { id: '2', action: 'role.created', user: 'admin@example.com', target: 'Deployer', timestamp: new Date(Date.now() - 3600000).toISOString() },
          { id: '3', action: 'project.created', user: 'editor@example.com', target: 'my-app', timestamp: new Date(Date.now() - 7200000).toISOString() },
        ]);
      })
      .finally(() => setAuditLoading(false));
  }, [activeSection, teamId]);

  const handleSaveRole = useCallback((role: Role) => {
    setRoles(prev => {
      const idx = prev.findIndex(r => r.id === role.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = role;
        return next;
      }
      return [...prev, role];
    });
    setEditingRole(null);
    setCreatingRole(false);
  }, []);

  const handleDeleteRole = useCallback((id: string) => {
    setRoles(prev => prev.filter(r => r.id !== id));
    setEditingRole(null);
  }, []);

  const toggleRoleExpand = (id: string) => {
    setExpandedRoles(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={18} className="text-[#553DE9]" />
        <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
          Access Control
        </h3>
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-1 border-b border-[#ECEAE3] dark:border-[#2A2A30] mb-4">
        <button
          onClick={() => setActiveSection('roles')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeSection === 'roles'
              ? 'border-[#553DE9] text-[#553DE9]'
              : 'border-transparent text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3]'
          }`}
        >
          <Lock size={14} />
          Roles & Permissions
        </button>
        <button
          onClick={() => setActiveSection('audit')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeSection === 'audit'
              ? 'border-[#553DE9] text-[#553DE9]'
              : 'border-transparent text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3]'
          }`}
        >
          <Activity size={14} />
          Audit Log
        </button>
      </div>

      {/* Roles section */}
      {activeSection === 'roles' && (
        <div className="space-y-3">
          {(editingRole || creatingRole) && (
            <RoleEditor
              role={editingRole}
              permissions={DEFAULT_PERMISSIONS}
              onSave={handleSaveRole}
              onDelete={editingRole ? handleDeleteRole : undefined}
              onCancel={() => { setEditingRole(null); setCreatingRole(false); }}
            />
          )}

          {!editingRole && !creatingRole && (
            <div className="flex justify-end mb-2">
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreatingRole(true)}>
                New Role
              </Button>
            </div>
          )}

          {roles.map(role => (
            <div
              key={role.id}
              className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden"
            >
              <button
                onClick={() => toggleRoleExpand(role.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
              >
                {expandedRoles.has(role.id) ? (
                  <ChevronDown size={14} className="text-[#939084]" />
                ) : (
                  <ChevronRight size={14} className="text-[#939084]" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
                      {role.name}
                    </span>
                    {role.isSystem && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F8F4F0] dark:bg-[#2A2A30] text-[#939084]">
                        System
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#939084]">{role.description}</p>
                </div>
                <span className="text-xs text-[#939084] font-mono">
                  {role.permissions.length} permissions
                </span>
                {!role.isSystem && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingRole(role); }}
                    className="text-xs text-[#553DE9] hover:underline"
                  >
                    Edit
                  </button>
                )}
              </button>
              {expandedRoles.has(role.id) && (
                <div className="px-4 pb-3 border-t border-[#ECEAE3] dark:border-[#2A2A30]">
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {role.permissions.map(permId => {
                      const perm = DEFAULT_PERMISSIONS.find(p => p.id === permId);
                      return perm ? (
                        <span
                          key={permId}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[#553DE9]/10 text-[#553DE9]"
                          title={perm.description}
                        >
                          {perm.label}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Audit log section */}
      {activeSection === 'audit' && (
        <AuditLogViewer entries={auditEntries} loading={auditLoading} />
      )}
    </div>
  );
}
