import { useEffect, useRef, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import type { Notification } from '../contexts/NotificationContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface NotificationSystemProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const typeStyles: Record<NotificationType, {
  bg: string;
  border: string;
  icon: string;
  IconComponent: typeof CheckCircle;
}> = {
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    icon: 'text-green-600 dark:text-green-400',
    IconComponent: CheckCircle,
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    icon: 'text-red-600 dark:text-red-400',
    IconComponent: XCircle,
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    icon: 'text-yellow-600 dark:text-yellow-400',
    IconComponent: AlertTriangle,
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    icon: 'text-blue-600 dark:text-blue-400',
    IconComponent: Info,
  },
};

// ---------------------------------------------------------------------------
// Single toast component
// ---------------------------------------------------------------------------

function Toast({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  const { type, title, message, duration = 5000 } = notification;
  const style = typeStyles[type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDismiss = useCallback(() => {
    onDismiss(notification.id);
  }, [onDismiss, notification.id]);

  useEffect(() => {
    if (duration > 0) {
      timerRef.current = setTimeout(handleDismiss, duration);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
  }, [duration, handleDismiss]);

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border shadow-lg
        max-w-sm w-full pointer-events-auto
        animate-[slideIn_0.3s_ease-out]
        ${style.bg} ${style.border}
      `}
      role="alert"
    >
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <span className={`flex-shrink-0 mt-0.5 ${style.icon}`}>
        <style.IconComponent size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#201515] dark:text-[#E8E6E3]">
          {title}
        </p>
        {message && (
          <p className="text-xs text-[#6B6960] dark:text-[#8A8880] mt-0.5">
            {message}
          </p>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 text-[#939084] hover:text-[#36342E] dark:hover:text-[#E8E6E3] transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export function NotificationSystem({ notifications, onDismiss }: NotificationSystemProps) {
  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {notifications.map(n => (
        <Toast key={n.id} notification={n} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
