import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingMessagesProps {
  context?: 'ai' | 'build' | 'deploy' | 'general';
  className?: string;
}

const messagesByContext: Record<string, string[]> = {
  ai: [
    'Warming up the AI...',
    'Reading your code...',
    'Thinking about the best approach...',
    'Running quality checks...',
    'Almost there...',
  ],
  build: [
    'Setting things up...',
    'Installing dependencies...',
    'Compiling your project...',
    'Running the build pipeline...',
    'Finishing touches...',
  ],
  deploy: [
    'Preparing containers...',
    'Pushing to the cloud...',
    'Configuring services...',
    'Running health checks...',
    'Almost live...',
  ],
  general: [
    'Loading...',
    'Getting things ready...',
    'Just a moment...',
    'Fetching data...',
    'Almost there...',
  ],
};

export function LoadingMessages({ context = 'general', className = '' }: LoadingMessagesProps) {
  const messages = messagesByContext[context] || messagesByContext.general;
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex(i => (i + 1) % messages.length);
        setFading(false);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Loader2 size={14} className="animate-spin text-primary/60" />
      <span
        className={`text-xs text-muted transition-opacity duration-300 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {messages[index]}
      </span>
    </div>
  );
}
