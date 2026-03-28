import { ReactNode } from 'react';
import { FolderPlus, MessageSquare, FileCode2, Users, Bell } from 'lucide-react';

type EmptyStateType = 'no-projects' | 'no-files' | 'no-chat' | 'no-team' | 'no-notifications';

interface WarmEmptyStateProps {
  type: EmptyStateType;
  action?: () => void;
  actionLabel?: string;
}

const emptyStateContent: Record<EmptyStateType, {
  icon: ReactNode;
  title: string;
  description: string;
  defaultActionLabel: string;
}> = {
  'no-projects': {
    icon: <FolderPlus size={32} className="text-primary/60" />,
    title: 'Your workspace is a blank canvas',
    description: 'What will you create today? Describe your idea and watch it come to life.',
    defaultActionLabel: 'Start a new project',
  },
  'no-files': {
    icon: <FileCode2 size={32} className="text-teal/60" />,
    title: 'This project is brand new',
    description: "Let's add some code! Start building and files will appear here as they're created.",
    defaultActionLabel: 'Open editor',
  },
  'no-chat': {
    icon: <MessageSquare size={32} className="text-primary/60" />,
    title: 'Start a conversation with Loki',
    description: "Try something like 'Add a contact form to my app' or 'Create a dark mode toggle.'",
    defaultActionLabel: 'Say hello',
  },
  'no-team': {
    icon: <Users size={32} className="text-pink/60" />,
    title: 'Building alone is great, but building together is better',
    description: 'Invite teammates to collaborate on this project in real time.',
    defaultActionLabel: 'Invite a teammate',
  },
  'no-notifications': {
    icon: <Bell size={32} className="text-teal/60" />,
    title: 'All clear!',
    description: 'No notifications right now. When something needs your attention, it will show up here.',
    defaultActionLabel: 'Dismiss',
  },
};

function DecorativeIllustration({ type }: { type: EmptyStateType }) {
  const colorMap: Record<EmptyStateType, { primary: string; secondary: string }> = {
    'no-projects': { primary: '#553DE9', secondary: '#1FC5A8' },
    'no-files': { primary: '#1FC5A8', secondary: '#553DE9' },
    'no-chat': { primary: '#553DE9', secondary: '#D63384' },
    'no-team': { primary: '#D63384', secondary: '#553DE9' },
    'no-notifications': { primary: '#1FC5A8', secondary: '#2F71E3' },
  };
  const colors = colorMap[type];

  return (
    <svg width="120" height="80" viewBox="0 0 120 80" fill="none" className="mb-4 opacity-60">
      <circle cx="60" cy="40" r="28" stroke={colors.primary} strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx="30" cy="25" r="8" fill={colors.primary} opacity="0.1" />
      <circle cx="90" cy="55" r="12" fill={colors.secondary} opacity="0.1" />
      <circle cx="60" cy="40" r="4" fill={colors.primary} opacity="0.3" />
      <line x1="20" y1="60" x2="45" y2="45" stroke={colors.secondary} strokeWidth="1" opacity="0.2" />
      <line x1="75" y1="35" x2="100" y2="20" stroke={colors.primary} strokeWidth="1" opacity="0.2" />
      <rect x="50" y="15" width="20" height="3" rx="1.5" fill={colors.secondary} opacity="0.15" />
      <rect x="42" y="62" width="36" height="3" rx="1.5" fill={colors.primary} opacity="0.15" />
    </svg>
  );
}

export function WarmEmptyState({ type, action, actionLabel }: WarmEmptyStateProps) {
  const content = emptyStateContent[type];

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center warm-empty-state-enter">
      <DecorativeIllustration type={type} />
      <div className="mb-3">{content.icon}</div>
      <h3 className="text-sm font-semibold text-ink mb-1.5">{content.title}</h3>
      <p className="text-xs text-muted max-w-[260px] leading-relaxed">{content.description}</p>
      {action && (
        <button
          onClick={action}
          className="mt-4 px-4 py-2 text-xs font-semibold rounded-btn bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          {actionLabel || content.defaultActionLabel}
        </button>
      )}
    </div>
  );
}
