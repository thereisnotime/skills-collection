import { useEffect, useState } from 'react';
import { PartyPopper, Rocket, Star } from 'lucide-react';

type CelebrationType = 'build-complete' | 'deploy-success' | 'first-project';

interface CelebrationProps {
  type: CelebrationType;
  onDismiss?: () => void;
}

const celebrationContent: Record<CelebrationType, {
  icon: React.ReactNode;
  title: string;
  description: string;
}> = {
  'build-complete': {
    icon: <PartyPopper size={24} className="text-teal" />,
    title: 'Build complete!',
    description: 'Your code is ready. Time to ship it.',
  },
  'deploy-success': {
    icon: <Rocket size={24} className="text-primary" />,
    title: 'Your app is live!',
    description: 'Successfully deployed. The world can see your work now.',
  },
  'first-project': {
    icon: <Star size={24} className="text-warning" />,
    title: 'First build complete!',
    description: 'Welcome to Purple Lab. This is just the beginning.',
  },
};

const CONFETTI_COLORS = ['#553DE9', '#1FC5A8', '#D63384', '#2F71E3', '#D4A03C', '#E8E4FD'];
const CONFETTI_COUNT = 40;

function ConfettiPiece({ index }: { index: number }) {
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const left = Math.random() * 100;
  const delay = Math.random() * 1.5;
  const duration = 2 + Math.random() * 1.5;
  const size = 4 + Math.random() * 6;
  const isCircle = index % 3 === 0;
  const rotation = Math.random() * 360;

  return (
    <div
      className="confetti-piece"
      style={{
        position: 'absolute',
        left: `${left}%`,
        top: '-10px',
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: color,
        borderRadius: isCircle ? '50%' : '1px',
        opacity: 0,
        transform: `rotate(${rotation}deg)`,
        animation: `confetti-fall ${duration}s ease-in ${delay}s forwards`,
      }}
    />
  );
}

export function Celebration({ type, onDismiss }: CelebrationProps) {
  const [visible, setVisible] = useState(true);
  const content = celebrationContent[type];

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, 3500);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Confetti layer */}
      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
          <ConfettiPiece key={i} index={i} />
        ))}
      </div>

      {/* Message banner */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 pointer-events-auto celebration-banner-enter">
        <div className="bg-card border border-border rounded-card shadow-lg px-6 py-4 flex items-center gap-3">
          {content.icon}
          <div>
            <p className="text-sm font-bold text-ink">{content.title}</p>
            <p className="text-xs text-muted">{content.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
