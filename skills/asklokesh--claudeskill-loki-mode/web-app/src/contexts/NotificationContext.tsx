import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { NotificationSystem, type NotificationType } from '../components/NotificationSystem';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // ms, default 5000; 0 = persistent
}

interface NotificationContextType {
  notify: (n: Omit<Notification, 'id'>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const NotificationContext = createContext<NotificationContextType>({
  notify: () => '',
  dismiss: () => {},
  dismissAll: () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

let counter = 0;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const notify = useCallback((n: Omit<Notification, 'id'>) => {
    const id = `notif-${++counter}-${Date.now()}`;
    const notification: Notification = { ...n, id };
    setNotifications(prev => [...prev, notification]);

    // Browser notification when tab not focused
    if (document.hidden && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        try {
          new Notification(n.title, { body: n.message || '' });
        } catch {
          // Browser notifications may not be available in all contexts
        }
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            try {
              new Notification(n.title, { body: n.message || '' });
            } catch {
              // ignore
            }
          }
        });
      }
    }

    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const value = useMemo(
    () => ({ notify, dismiss, dismissAll }),
    [notify, dismiss, dismissAll],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationSystem notifications={notifications} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotification() {
  return useContext(NotificationContext);
}
