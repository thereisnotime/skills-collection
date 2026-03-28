import type { StatusResponse } from '../types/api';

interface StatusOverviewProps {
  status: StatusResponse | null;
}

export function StatusOverview({ status }: StatusOverviewProps) {
  const stats = [
    {
      label: 'Iteration',
      value: status ? status.iteration.toString() : '--',
      color: 'text-primary',
    },
    {
      label: 'Agents',
      value: status ? status.running_agents.toString() : '--',
      color: status && status.running_agents > 0 ? 'text-success' : 'text-muted',
    },
    {
      label: 'Pending',
      value: status ? status.pending_tasks.toString() : '--',
      color: status && status.pending_tasks > 0 ? 'text-warning' : 'text-muted',
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
