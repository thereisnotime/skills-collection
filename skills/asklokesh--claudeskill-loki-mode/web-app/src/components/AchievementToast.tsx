import { useState, useEffect, useCallback } from 'react';
import { Star } from 'lucide-react';

interface Achievement {
  id: string;
  name: string;
  description: string;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-build', name: 'First Build', description: 'You completed your first build. Welcome aboard!' },
  { id: 'five-projects', name: 'Prolific Builder', description: 'Five projects created. You are on a roll.' },
  { id: 'first-deploy', name: 'Ship It', description: 'First deployment complete. Your code is out in the world.' },
  { id: 'all-providers', name: 'Provider Explorer', description: 'You have used every available AI provider.' },
  { id: 'first-teammate', name: 'Team Player', description: 'You invited your first teammate. Better together.' },
];

const STORAGE_KEY = 'purple-lab-achievements';

function getUnlockedAchievements(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function markAchievement(id: string): void {
  const unlocked = getUnlockedAchievements();
  if (!unlocked.includes(id)) {
    unlocked.push(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unlocked));
  }
}

export function useAchievements() {
  const [toastQueue, setToastQueue] = useState<Achievement[]>([]);

  const unlock = useCallback((id: string) => {
    const unlocked = getUnlockedAchievements();
    if (unlocked.includes(id)) return;

    const achievement = ACHIEVEMENTS.find(a => a.id === id);
    if (!achievement) return;

    markAchievement(id);
    setToastQueue(prev => [...prev, achievement]);
  }, []);

  const dismissCurrent = useCallback(() => {
    setToastQueue(prev => prev.slice(1));
  }, []);

  return { unlock, toastQueue, dismissCurrent };
}

interface AchievementToastProps {
  achievement: Achievement;
  onDismiss: () => void;
}

export function AchievementToast({ achievement, onDismiss }: AchievementToastProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => {
      setExiting(true);
    }, 3500);

    const removeTimer = setTimeout(() => {
      onDismiss();
    }, 4000);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(removeTimer);
    };
  }, [onDismiss]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 ${
        exiting ? 'achievement-toast-exit' : 'achievement-toast-enter'
      }`}
    >
      <div className="bg-card border border-border rounded-card shadow-lg px-4 py-3 flex items-center gap-3 min-w-[280px]">
        <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
          <Star size={16} className="text-warning" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-ink">{achievement.name}</p>
          <p className="text-[11px] text-muted leading-snug">{achievement.description}</p>
        </div>
      </div>
    </div>
  );
}

/** Renders the current achievement toast from the queue */
export function AchievementToastContainer({
  toastQueue,
  onDismiss,
}: {
  toastQueue: Achievement[];
  onDismiss: () => void;
}) {
  if (toastQueue.length === 0) return null;
  return <AchievementToast achievement={toastQueue[0]} onDismiss={onDismiss} />;
}
