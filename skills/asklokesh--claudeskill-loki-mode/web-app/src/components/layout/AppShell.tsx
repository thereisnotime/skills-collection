import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { OnboardingOverlay } from '../OnboardingOverlay';
import { ProductTour } from '../ProductTour';
import { WhatsNew } from '../WhatsNew';
import { DocsSidebar } from '../DocsSidebar';
import { AchievementToastContainer, useAchievements } from '../AchievementToast';
import { api } from '../../api/client';
import { useWebSocket } from '../../hooks/useWebSocket';

export function AppShell() {
  const [version, setVersion] = useState('');
  const [docsOpen, setDocsOpen] = useState(false);
  const { toastQueue, dismissCurrent } = useAchievements();

  const { connected } = useWebSocket(() => {});

  useEffect(() => {
    api.getStatus().then(s => {
      setVersion(s.version || '');
    }).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen bg-[#FAF9F6]">
      <AchievementToastContainer toastQueue={toastQueue} onDismiss={dismissCurrent} />
      <OnboardingOverlay />
      <ProductTour />
      <WhatsNew />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-white focus:text-[#553DE9] focus:rounded-[3px] focus:shadow-card"
      >
        Skip to main content
      </a>
      <Sidebar wsConnected={connected} version={version} onOpenDocs={() => setDocsOpen(true)} />
      <main id="main-content" className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <DocsSidebar open={docsOpen} onClose={() => setDocsOpen(false)} />
    </div>
  );
}
