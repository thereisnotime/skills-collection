import { Check, AlertCircle, Clock } from 'lucide-react';

type BadgeStatus =
  | 'completed'
  | 'running'
  | 'failed'
  | 'started'
  | 'empty'
  | 'version';

interface BadgeProps {
  status: BadgeStatus;
  children: React.ReactNode;
  className?: string;
}

const statusClasses: Record<BadgeStatus, string> = {
  completed: 'bg-[#1FC5A8]/10 text-[#1FC5A8]',
  running: 'bg-[#553DE9]/10 text-[#553DE9]',
  failed: 'bg-[#C45B5B]/10 text-[#C45B5B]',
  started: 'bg-[#D4A03C]/10 text-[#D4A03C]',
  empty: 'bg-[#F8F4F0] text-[#6B6960]',
  version: 'bg-[#553DE9]/10 text-[#553DE9]',
};

function StatusIcon({ status }: { status: BadgeStatus }) {
  switch (status) {
    case 'completed':
      return <Check size={12} />;
    case 'running':
      return (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      );
    case 'failed':
      return <AlertCircle size={12} />;
    case 'started':
      return <Clock size={12} />;
    default:
      return null;
  }
}

export function Badge({ status, children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-btn px-2.5 py-0.5 text-xs font-semibold',
        statusClasses[status],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <StatusIcon status={status} />
      {children}
    </span>
  );
}
