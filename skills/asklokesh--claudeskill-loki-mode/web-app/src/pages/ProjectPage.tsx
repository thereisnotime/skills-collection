import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ProjectWorkspace } from '../components/ProjectWorkspace';
import type { SessionDetail } from '../api/client';

export default function ProjectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    api.getSessionDetail(sessionId)
      .then(detail => {
        setSession(detail);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load session');
        setLoading(false);
      });
  }, [sessionId]);

  if (loading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-muted animate-pulse text-sm">Loading project...</div>
          <div className="text-xs font-mono text-muted/50 mt-2">{sessionId}</div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-danger text-sm font-medium">Project not found</p>
          <p className="text-xs text-muted mt-1">{error || `Session ${sessionId} does not exist`}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 rounded-btn text-sm font-semibold border border-primary/30 text-primary hover:bg-primary/5 transition-all"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      <div className="flex-1 min-h-0">
        <ErrorBoundary name="ProjectWorkspace">
          <ProjectWorkspace session={session} onClose={() => navigate('/')} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
