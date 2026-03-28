import { useState, useCallback } from 'react';
import {
  Rocket, ExternalLink, Copy, Check, Globe, GitBranch,
  Loader2, AlertCircle, CheckCircle2, Link,
} from 'lucide-react';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { DeployConnections, type AllConnectionStatuses } from './DeployConnections';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeployPlatform = 'vercel' | 'netlify' | 'github-pages';

interface PlatformConfig {
  id: DeployPlatform;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  bgColor: string;
  connectionKey: 'vercel' | 'netlify' | 'github';
}

type DeployStatus = 'idle' | 'deploying' | 'success' | 'error';

interface DeployState {
  status: DeployStatus;
  url?: string;
  error?: string;
}

interface DeployPanelProps {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Platform configurations
// ---------------------------------------------------------------------------

const platforms: PlatformConfig[] = [
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Optimized for Next.js, React, and static sites. Global CDN with instant rollbacks.',
    icon: Globe,
    color: 'text-ink',
    bgColor: 'bg-ink/5',
    connectionKey: 'vercel',
  },
  {
    id: 'netlify',
    name: 'Netlify',
    description: 'Deploy with CI/CD, serverless functions, and form handling built in.',
    icon: Globe,
    color: 'text-teal-600',
    bgColor: 'bg-teal-500/5',
    connectionKey: 'netlify',
  },
  {
    id: 'github-pages',
    name: 'GitHub Pages',
    description: 'Free hosting for static sites directly from a GitHub repository.',
    icon: GitBranch,
    color: 'text-purple-600',
    bgColor: 'bg-purple-500/5',
    connectionKey: 'github',
  },
];

// ---------------------------------------------------------------------------
// Platform card
// ---------------------------------------------------------------------------

function PlatformCard({
  platform,
  deployState,
  onDeploy,
  disabled,
  connected,
}: {
  platform: PlatformConfig;
  deployState: DeployState;
  onDeploy: () => void;
  disabled: boolean;
  connected: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = platform.icon;

  const handleCopy = useCallback(async () => {
    if (!deployState.url) return;
    try {
      await navigator.clipboard.writeText(deployState.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select text
    }
  }, [deployState.url]);

  const isDisabled = disabled || !connected;

  return (
    <div className={`border border-border rounded-lg p-4 transition-colors ${
      deployState.status === 'success' ? 'border-green-500/30 bg-green-500/5' :
      deployState.status === 'error' ? 'border-red-500/30 bg-red-500/5' :
      !connected ? 'opacity-60' :
      'hover:border-primary/30 hover:bg-hover'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${platform.bgColor}`}>
          <Icon size={20} className={platform.color} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-ink">{platform.name}</h4>
          <p className="text-[11px] text-muted leading-snug mt-0.5">{platform.description}</p>
        </div>
        {/* Connection indicator */}
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            connected ? 'bg-green-500' : 'bg-gray-300'
          }`}
          title={connected ? 'Connected' : 'Not connected'}
        />
      </div>

      {/* Deploy action / status */}
      {deployState.status === 'idle' && (
        <div className="relative group">
          <Button
            variant="secondary"
            size="sm"
            icon={Rocket}
            onClick={onDeploy}
            disabled={isDisabled}
            className="w-full"
          >
            Deploy to {platform.name}
          </Button>
          {!connected && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="bg-ink text-white text-[10px] px-2 py-1 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity">
                Connect {platform.name} first
              </span>
            </div>
          )}
        </div>
      )}

      {deployState.status === 'deploying' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-btn bg-primary/5 border border-primary/20">
          <Loader2 size={14} className="text-primary animate-spin" />
          <span className="text-xs font-medium text-primary">Deploying to {platform.name}...</span>
        </div>
      )}

      {deployState.status === 'success' && deployState.url && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <CheckCircle2 size={14} />
            Deployed successfully
          </div>
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-btn px-3 py-2">
            <Globe size={12} className="text-muted flex-shrink-0" />
            <a
              href={deployState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-primary hover:underline truncate flex-1"
            >
              {deployState.url}
            </a>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] text-muted hover:text-ink transition-colors flex-shrink-0"
              title="Copy URL"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              href={deployState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-ink transition-colors flex-shrink-0"
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      {deployState.status === 'error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
            <AlertCircle size={14} />
            Deploy failed
          </div>
          <p className="text-[11px] text-muted bg-red-500/5 border border-red-500/10 rounded px-2 py-1.5 font-mono">
            {deployState.error || 'Unknown error'}
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon={Rocket}
            onClick={onDeploy}
            disabled={isDisabled}
            className="w-full"
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub push section
// ---------------------------------------------------------------------------

function GitHubPushSection({
  sessionId,
  disabled,
}: {
  sessionId: string;
  disabled: boolean;
}) {
  const [pushState, setPushState] = useState<{
    status: 'idle' | 'pushing' | 'success' | 'error';
    repoUrl?: string;
    error?: string;
  }>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  const handlePush = useCallback(async () => {
    setPushState({ status: 'pushing' });
    try {
      const result = await api.githubPush(sessionId);
      if (result.repo_url) {
        setPushState({ status: 'success', repoUrl: result.repo_url });
      } else {
        setPushState({ status: 'error', error: result.error || 'Push failed' });
      }
    } catch (err) {
      setPushState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Push failed',
      });
    }
  }, [sessionId]);

  const handleCopy = useCallback(async () => {
    if (!pushState.repoUrl) return;
    try {
      await navigator.clipboard.writeText(pushState.repoUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [pushState.repoUrl]);

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-ink/5">
          <GitBranch size={20} className="text-ink" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-ink">Push to GitHub</h4>
          <p className="text-[11px] text-muted leading-snug mt-0.5">
            Create a repository and push your code to GitHub.
          </p>
        </div>
      </div>

      {pushState.status === 'idle' && (
        <Button
          variant="secondary"
          size="sm"
          icon={GitBranch}
          onClick={handlePush}
          disabled={disabled}
          className="w-full"
        >
          Create Repo + Push
        </Button>
      )}

      {pushState.status === 'pushing' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-btn bg-primary/5 border border-primary/20">
          <Loader2 size={14} className="text-primary animate-spin" />
          <span className="text-xs font-medium text-primary">Creating repository and pushing...</span>
        </div>
      )}

      {pushState.status === 'success' && pushState.repoUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <CheckCircle2 size={14} />
            Pushed to GitHub
          </div>
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-btn px-3 py-2">
            <GitBranch size={12} className="text-muted flex-shrink-0" />
            <a
              href={pushState.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-primary hover:underline truncate flex-1"
            >
              {pushState.repoUrl}
            </a>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] text-muted hover:text-ink transition-colors flex-shrink-0"
              title="Copy URL"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {pushState.status === 'error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
            <AlertCircle size={14} />
            Push failed
          </div>
          <p className="text-[11px] text-muted bg-red-500/5 border border-red-500/10 rounded px-2 py-1.5 font-mono">
            {pushState.error}
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon={GitBranch}
            onClick={handlePush}
            disabled={disabled}
            className="w-full"
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DeployPanel
// ---------------------------------------------------------------------------

export function DeployPanel({ sessionId }: DeployPanelProps) {
  const [deployStates, setDeployStates] = useState<Record<DeployPlatform, DeployState>>({
    vercel: { status: 'idle' },
    netlify: { status: 'idle' },
    'github-pages': { status: 'idle' },
  });

  const [connectionStatuses, setConnectionStatuses] = useState<AllConnectionStatuses>({
    vercel: { connected: false },
    netlify: { connected: false },
    github: { connected: false },
  });

  const [showConnections, setShowConnections] = useState(false);

  const isAnyDeploying = Object.values(deployStates).some(s => s.status === 'deploying');

  const handleDeploy = useCallback(async (platform: DeployPlatform) => {
    setDeployStates(prev => ({
      ...prev,
      [platform]: { status: 'deploying' },
    }));

    try {
      const result = await api.deployProject(sessionId, platform);
      if (result.url) {
        setDeployStates(prev => ({
          ...prev,
          [platform]: { status: 'success', url: result.url },
        }));
      } else {
        setDeployStates(prev => ({
          ...prev,
          [platform]: { status: 'error', error: result.error || 'Deploy failed' },
        }));
      }
    } catch (err) {
      setDeployStates(prev => ({
        ...prev,
        [platform]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Deploy failed',
        },
      }));
    }
  }, [sessionId]);

  const isConnected = (platform: PlatformConfig) =>
    connectionStatuses[platform.connectionKey]?.connected ?? false;

  return (
    <div className="h-full overflow-y-auto terminal-scroll">
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-lg font-heading font-bold text-ink flex items-center gap-2">
            <Rocket size={20} className="text-primary" />
            Deploy Your Project
          </h3>
          <p className="text-xs text-muted mt-1">
            Choose a platform to deploy your project. One click to go live.
          </p>
        </div>

        {/* Connections toggle */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowConnections(!showConnections)}
            className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <Link size={16} className="text-primary" />
              <span className="text-sm font-medium text-ink">Platform Connections</span>
              {/* Quick status dots */}
              <div className="flex items-center gap-1 ml-2">
                {(['vercel', 'netlify', 'github'] as const).map((key) => (
                  <span
                    key={key}
                    className={`w-2 h-2 rounded-full ${
                      connectionStatuses[key]?.connected ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                    title={`${key}: ${connectionStatuses[key]?.connected ? 'Connected' : 'Not connected'}`}
                  />
                ))}
              </div>
            </div>
            <span className="text-xs text-muted">
              {showConnections ? 'Hide' : 'Manage'}
            </span>
          </button>
          {showConnections && (
            <div className="border-t border-border p-4">
              <DeployConnections compact onStatusChange={setConnectionStatuses} />
            </div>
          )}
        </div>

        {/* Platform cards */}
        <div className="space-y-3">
          {platforms.map(platform => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              deployState={deployStates[platform.id]}
              onDeploy={() => handleDeploy(platform.id)}
              disabled={isAnyDeploying}
              connected={isConnected(platform)}
            />
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* GitHub push */}
        <GitHubPushSection sessionId={sessionId} disabled={isAnyDeploying} />
      </div>
    </div>
  );
}
