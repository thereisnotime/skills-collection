import type { StatusResponse } from '../types/api';

interface StatusOverviewProps {
  status: StatusResponse | null;
}

// A count the server did not report (null/absent) is not a measured 0.
const count = (v: number | null | undefined) => (typeof v === 'number' ? v.toString() : '--');

export function StatusOverview({ status }: StatusOverviewProps) {
  const stats = [
    {
      label: 'Iteration',
      value: count(status?.iteration),
      color: 'text-primary',
    },
    {
      label: 'Agents',
      value: count(status?.running_agents),
      color: (status?.running_agents ?? 0) > 0 ? 'text-success' : 'text-muted',
    },
    {
      label: 'Pending',
      value: count(status?.pending_tasks),
      color: (status?.pending_tasks ?? 0) > 0 ? 'text-warning' : 'text-muted',
    },
    {
      label: 'Provider',
      value: status?.provider || '--',
      color: 'text-primary',
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map((stat) => (
        <div key={stat.label} className="card p-4 text-center">
          <div className={`text-2xl font-bold font-mono ${stat.color}`}>
            {stat.value}
          </div>
          <div className="text-xs text-muted font-medium mt-1 uppercase tracking-wider">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
