import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Filter,
  RefreshCw,
  User,
  Clock,
  Globe,
  FileText,
} from 'lucide-react';
import { Button } from './ui/Button';
import { Avatar } from './Avatar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  target: string;
  details: string;
  ip: string;
  category: 'auth' | 'project' | 'admin' | 'deploy' | 'api' | 'system';
}

interface AuditTrailProps {
  events?: AuditEvent[];
  onFetch?: (filters: AuditFilters) => Promise<AuditEvent[]>;
  pollInterval?: number;
  className?: string;
}

interface AuditFilters {
  search: string;
  user: string;
  actionType: string;
  dateFrom: string;
  dateTo: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_ACTIONS = [
  'user.login', 'user.logout', 'user.invited',
  'project.created', 'project.deleted', 'project.deployed',
  'key.created', 'key.revoked',
  'role.changed', 'settings.updated',
  'build.started', 'build.completed', 'build.failed',
];

function generateSampleEvents(): AuditEvent[] {
  const users = ['admin@company.com', 'dev@company.com', 'lead@company.com', 'ops@company.com'];
  const ips = ['192.168.1.10', '10.0.0.42', '172.16.0.5', '192.168.1.22'];
  const targets = ['my-saas-app', 'cli-tool', 'api-service', 'staging', 'production'];
  const categories: AuditEvent['category'][] = ['auth', 'project', 'admin', 'deploy', 'api', 'system'];

  return Array.from({ length: 50 }, (_, i) => {
    const action = SAMPLE_ACTIONS[Math.floor(Math.random() * SAMPLE_ACTIONS.length)];
    const category = action.startsWith('user') ? 'auth'
      : action.startsWith('project') ? 'project'
      : action.startsWith('key') ? 'api'
      : action.startsWith('build') ? 'deploy'
      : action.startsWith('role') || action.startsWith('settings') ? 'admin'
      : categories[Math.floor(Math.random() * categories.length)];

    return {
      id: `evt-${i}`,
      timestamp: new Date(Date.now() - i * 1800000 - Math.random() * 600000).toISOString(),
      user: users[Math.floor(Math.random() * users.length)],
      action,
      target: targets[Math.floor(Math.random() * targets.length)],
      details: `${action.replace('.', ': ')} by user on ${targets[Math.floor(Math.random() * targets.length)]}`,
      ip: ips[Math.floor(Math.random() * ips.length)],
      category,
    };
  });
}

// ---------------------------------------------------------------------------
// Category badge
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<AuditEvent['category'], string> = {
  auth: '#553DE9',
  project: '#1FC5A8',
  admin: '#F59E0B',
  deploy: '#C45B5B',
  api: '#6366F1',
  system: '#939084',
};

function CategoryBadge({ category }: { category: AuditEvent['category'] }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
      style={{
        backgroundColor: `${CATEGORY_COLORS[category]}15`,
        color: CATEGORY_COLORS[category],
      }}
    >
      {category}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AuditTrail({
  events: externalEvents,
  onFetch,
  pollInterval = 30000,
  className = '',
}: AuditTrailProps) {
  const [allEvents, setAllEvents] = useState<AuditEvent[]>(externalEvents || generateSampleEvents());
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PAGE_SIZE = 15;

  // Polling for real-time updates
  useEffect(() => {
    if (!onFetch || pollInterval <= 0) return;

    const poll = async () => {
      try {
        const events = await onFetch({ search, user: userFilter, actionType: actionFilter, dateFrom, dateTo });
        setAllEvents(events);
      } catch {
        // silently ignore polling errors
      }
    };

    pollRef.current = setInterval(poll, pollInterval);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [onFetch, pollInterval, search, userFilter, actionFilter, dateFrom, dateTo]);

  // Derive unique users and actions for filter dropdowns
  const uniqueUsers = [...new Set(allEvents.map(e => e.user))].sort();
  const uniqueActions = [...new Set(allEvents.map(e => e.action))].sort();

  // Filter events
  const filtered = allEvents.filter(event => {
    if (search) {
      const s = search.toLowerCase();
      const match = event.action.toLowerCase().includes(s)
        || event.user.toLowerCase().includes(s)
        || event.target.toLowerCase().includes(s)
        || event.details.toLowerCase().includes(s)
        || event.ip.includes(s);
      if (!match) return false;
    }
    if (userFilter && event.user !== userFilter) return false;
    if (actionFilter && event.action !== actionFilter) return false;
    if (dateFrom && event.timestamp < dateFrom) return false;
    if (dateTo && event.timestamp > dateTo + 'T23:59:59') return false;
    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEvents = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, userFilter, actionFilter, dateFrom, dateTo]);

  // Export CSV
  const handleExportCSV = useCallback(() => {
    const headers = ['Timestamp', 'User', 'Action', 'Target', 'Details', 'IP', 'Category'];
    const rows = filtered.map(e => [
      e.timestamp, e.user, e.action, e.target,
      `"${e.details.replace(/"/g, '""')}"`,
      e.ip, e.category,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const handleRefresh = useCallback(async () => {
    if (!onFetch) return;
    setLoading(true);
    try {
      const events = await onFetch({ search, user: userFilter, actionType: actionFilter, dateFrom, dateTo });
      setAllEvents(events);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [onFetch, search, userFilter, actionFilter, dateFrom, dateTo]);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-[#553DE9]" />
          <h3 className="text-sm font-semibold text-[#201515] dark:text-[#E8E6E3] uppercase tracking-wider">
            Audit Trail
          </h3>
          <span className="text-xs text-[#939084] ml-1">
            {filtered.length} event{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={handleRefresh} loading={loading}>
            Refresh
          </Button>
          <Button size="sm" variant="ghost" icon={Download} onClick={handleExportCSV}>
            CSV
          </Button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#939084]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3] placeholder-[#939084]"
            />
          </div>
          <Button
            size="sm"
            variant={showFilters ? 'secondary' : 'ghost'}
            icon={Filter}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters
          </Button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg bg-[#F8F4F0] dark:bg-[#222228]">
            <div>
              <label className="block text-xs font-medium text-[#6B6960] mb-1">User</label>
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
              >
                <option value="">All Users</option>
                {uniqueUsers.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B6960] mb-1">Action</label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
              >
                <option value="">All Actions</option>
                {uniqueActions.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B6960] mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B6960] mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-[#ECEAE3] dark:border-[#2A2A30] bg-white dark:bg-[#1A1A1E] text-[#201515] dark:text-[#E8E6E3]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Event table */}
      <div className="border border-[#ECEAE3] dark:border-[#2A2A30] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F8F4F0] dark:bg-[#222228]">
              <th className="w-8 px-2 py-2.5" />
              <th className="text-left px-3 py-2.5 text-xs font-medium text-[#6B6960]">Timestamp</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-[#6B6960]">User</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-[#6B6960]">Action</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-[#6B6960]">Target</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-[#6B6960] hidden md:table-cell">IP</th>
            </tr>
          </thead>
          <tbody>
            {pageEvents.map(event => (
              <>
                <tr
                  key={event.id}
                  className="border-t border-[#ECEAE3] dark:border-[#2A2A30] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] transition-colors cursor-pointer"
                  onClick={() => setExpandedRow(expandedRow === event.id ? null : event.id)}
                >
                  <td className="px-2 py-2.5 text-center">
                    {expandedRow === event.id ? (
                      <ChevronDown size={12} className="text-[#939084]" />
                    ) : (
                      <ChevronRight size={12} className="text-[#939084]" />
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-[#939084]">
                      <Clock size={12} />
                      <span className="font-mono">{formatTime(event.timestamp)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Avatar name={event.user.split('@')[0]} size="sm" />
                      <span className="text-[#201515] dark:text-[#E8E6E3] truncate max-w-[150px]">
                        {event.user}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <CategoryBadge category={event.category} />
                      <span className="text-[#201515] dark:text-[#E8E6E3] font-medium">
                        {event.action}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[#6B6960] truncate max-w-[120px] block">
                      {event.target || '--'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <div className="flex items-center gap-1 text-xs text-[#939084]">
                      <Globe size={12} />
                      <span className="font-mono">{event.ip}</span>
                    </div>
                  </td>
                </tr>
                {expandedRow === event.id && (
                  <tr key={`${event.id}-details`} className="bg-[#F8F4F0] dark:bg-[#222228]">
                    <td colSpan={6} className="px-6 py-3">
                      <div className="flex items-start gap-2">
                        <FileText size={14} className="text-[#939084] flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-[#6B6960]">
                          <p className="font-medium text-[#201515] dark:text-[#E8E6E3] mb-1">Details</p>
                          <p>{event.details}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-[#939084]">
                            <span>Event ID: {event.id}</span>
                            <span>Full timestamp: {new Date(event.timestamp).toISOString()}</span>
                            <span>IP: {event.ip}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {pageEvents.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#939084]">
                  No events match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#939084]">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg text-[#939084] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] disabled:opacity-40 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                    page === pageNum
                      ? 'bg-[#553DE9] text-white'
                      : 'text-[#939084] hover:bg-[#F8F4F0] dark:hover:bg-[#222228]'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg text-[#939084] hover:bg-[#F8F4F0] dark:hover:bg-[#222228] disabled:opacity-40 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
