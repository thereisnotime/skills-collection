import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Plus,
  Activity,
  FolderKanban,
} from 'lucide-react';
import { TeamPanel, type TeamInfo, type TeamRole } from '../components/TeamPanel';
import { RBACPanel, type AuditEntry } from '../components/RBACPanel';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/Avatar';
import { ActivityFeed } from '../components/ActivityFeed';
import { useNotification } from '../contexts/NotificationContext';
import { api } from '../api/client';

// ---------------------------------------------------------------------------
// Teams Page
//
// Everything here is read from /api/teams and /api/audit-log. A failed read
// renders an error, never sample rows; a team or member appears only after the
// server stored it. Remove-member and change-role have no endpoint, so their
// controls are not offered.
// ---------------------------------------------------------------------------

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'roles' | 'activity'>('members');
  // null while loading; the team's own audit entries once read.
  const [activities, setActivities] = useState<AuditEntry[] | null>(null);
  const [activityError, setActivityError] = useState(false);
  const { notify } = useNotification();

  // Reload the team list; keeps (or moves to) `selectId` when it is present.
  const loadTeams = useCallback((selectId?: string) => {
    setLoading(true);
    return api.getTeams()
      .then(data => {
        setTeams(data);
        setLoadError(false);
        setSelectedTeam(prev => data.find(t => t.id === (selectId ?? prev?.id)) ?? data[0] ?? null);
      })
      .catch(() => {
        setTeams([]);
        setSelectedTeam(null);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  // Activity is this team's slice of the audit log: entries the server tagged
  // with the team's id. A brand-new team has exactly its own team.created.
  useEffect(() => {
    if (!selectedTeam || activeTab !== 'activity') return;
    let cancelled = false;
    setActivities(null);
    setActivityError(false);
    api.getAuditLog()
      .then(entries => { if (!cancelled) setActivities(entries.filter(e => e.team_id === selectedTeam.id)); })
      .catch(() => { if (!cancelled) setActivityError(true); });
    return () => { cancelled = true; };
  }, [selectedTeam, activeTab]);

  const handleCreateTeam = useCallback(() => {
    const name = newTeamName.trim();
    if (!name || creating) return;
    setCreating(true);
    api.createTeam(name)
      .then(res => loadTeams(res.id).then(() => {
        setNewTeamName('');
        setShowCreateForm(false);
        notify({ type: 'success', title: 'Team created', message: `"${name}" is ready` });
      }))
      .catch(() => notify({ type: 'error', title: 'Could not create team', message: 'The server did not store it, so nothing was added.' }))
      .finally(() => setCreating(false));
  }, [newTeamName, creating, loadTeams, notify]);

  const handleInviteMember = useCallback(
    (email: string, role: TeamRole) => {
      if (!selectedTeam) return;
      const teamId = selectedTeam.id;
      api.addTeamMember(teamId, email, role)
        .then(() => loadTeams(teamId))
        .then(() => notify({ type: 'success', title: 'Member added', message: `${email} added as ${role}` }))
        .catch(() => notify({ type: 'error', title: 'Could not add member', message: `${email} was not added` }));
    },
    [selectedTeam, loadTeams, notify],
  );

  return (
    <div className="max-w-6xl mx-auto px-6 max-md:px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#201515] dark:text-[#E8E6E3]">Teams</h1>
          <p className="text-sm text-[#939084] mt-1">Manage team members, roles, and access control</p>
        </div>
        {!showCreateForm && (
          <Button icon={Plus} onClick={() => setShowCreateForm(true)}>
            New Team
          </Button>
        )}
      </div>

      {/* Create team form */}
      {showCreateForm && (
        <div className="card p-4 mb-6">
          <h3 className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3] mb-3">Create Team</h3>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084] focus:outline-none focus:ring-2 focus:ring-[#553DE9]/30"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTeam(); }}
            />
            <Button size="sm" onClick={handleCreateTeam} disabled={!newTeamName.trim() || creating}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 max-md:gap-4">
        {/* Team list sidebar */}
        <div className="md:col-span-1">
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-[#6B6960] uppercase tracking-wider mb-3">
              Your Teams
            </h3>
            {loading && (
              <div className="text-center py-4 text-[#939084] text-sm">Loading...</div>
            )}
            {!loading && loadError && (
              <div className="text-center py-4 text-[#C45B5B] text-sm">Could not load teams</div>
            )}
            {!loading && !loadError && teams.length === 0 && (
              <div className="text-center py-4 text-[#939084] text-sm">No teams yet</div>
            )}
            <div className="space-y-1">
              {teams.map(team => (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeam(team)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded-lg transition-colors ${
                    selectedTeam?.id === team.id
                      ? 'bg-[#553DE9]/10 text-[#553DE9] font-medium'
                      : 'text-[#36342E] dark:text-[#C5C0B8] hover:bg-[#F8F4F0] dark:hover:bg-[#222228]'
                  }`}
                >
                  <Avatar name={team.name} size="sm" />
                  <span className="truncate flex-1">{team.name}</span>
                  <span className="text-xs text-[#939084]">{team.members.length}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Team content */}
        <div className="md:col-span-3 space-y-6">
          {selectedTeam && (
            <>
              {/* Team dashboard header */}
              <div className="card p-4">
                <div className="flex items-center gap-4">
                  <Avatar name={selectedTeam.name} size="lg" />
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-[#201515] dark:text-[#E8E6E3]">
                      {selectedTeam.name}
                    </h2>
                    <div className="flex items-center gap-4 text-xs text-[#939084] mt-0.5">
                      <span>{selectedTeam.members.length} members</span>
                      <span>Created {new Date(selectedTeam.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-[#ECEAE3] dark:border-[#2A2A30]">
                {([
                  { id: 'members' as const, label: 'Members', icon: Users },
                  { id: 'roles' as const, label: 'Roles & Permissions', icon: FolderKanban },
                  { id: 'activity' as const, label: 'Activity', icon: Activity },
                ]).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-[#553DE9] text-[#553DE9]'
                        : 'border-transparent text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3]'
                    }`}
                  >
                    <tab.icon size={16} />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {activeTab === 'members' && (
                <TeamPanel
                  team={selectedTeam}
                  onInviteMember={handleInviteMember}
                  loading={loading}
                />
              )}

              {activeTab === 'roles' && (
                <RBACPanel teamId={selectedTeam.id} />
              )}

              {activeTab === 'activity' && (
                <div className="space-y-4">
                  {/* Inline recent activity list */}
                  <div className="card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Activity size={18} className="text-[#553DE9]" />
                      <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
                        Recent Activity
                      </h3>
                    </div>
                    {activityError ? (
                      <div className="text-center py-8 text-[#C45B5B] text-sm">Could not load activity</div>
                    ) : activities === null ? (
                      <div className="text-center py-8 text-[#939084] text-sm">Loading...</div>
                    ) : activities.length === 0 ? (
                      <div className="text-center py-8 text-[#939084] text-sm">No recent activity</div>
                    ) : (
                      <div className="space-y-3">
                        {activities.map(a => (
                          <div
                            key={a.id}
                            className="flex items-center gap-3 p-3 rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors"
                          >
                            <Avatar name={a.user} size="sm" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-[#201515] dark:text-[#E8E6E3]">
                                {a.action}{a.target ? ` ${a.target}` : ''}
                              </p>
                              <p className="text-xs text-[#939084]">{a.user}</p>
                            </div>
                            <span className="text-xs text-[#939084] flex-shrink-0">
                              {new Date(a.timestamp).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Global activity feed */}
                  <ActivityFeed maxItems={10} collapsible />
                </div>
              )}
            </>
          )}

          {!selectedTeam && !loading && (
            <div className="text-center py-16">
              <Users size={48} className="mx-auto text-[#939084]/40 mb-4" />
              <p className="text-[#939084] text-sm">
                {loadError ? 'Could not load teams. Is the server running?' : 'Select a team or create a new one'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
