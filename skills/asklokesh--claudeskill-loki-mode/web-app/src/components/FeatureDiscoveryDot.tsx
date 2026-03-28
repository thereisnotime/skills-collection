import { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'pl_discovered_features';

/** Features that are tracked for discovery. */
export type DiscoverableFeature =
  | 'deploy_tab'
  | 'git_tab'
  | 'command_palette'
  | 'templates'
  | 'ai_chat';

function loadDiscovered(): Set<string> {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    // ignore
  }
  return new Set();
}

function saveDiscovered(discovered: Set<string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...discovered]));
  } catch {
    // ignore
  }
}

/** Mark a feature as discovered (removes the dot). Call from anywhere. */
export function markFeatureDiscovered(feature: DiscoverableFeature) {
  const discovered = loadDiscovered();
  if (!discovered.has(feature)) {
    discovered.add(feature);
    saveDiscovered(discovered);
    window.dispatchEvent(
      new CustomEvent('pl_feature_discovered', { detail: feature }),
    );
  }
}

interface FeatureDiscoveryDotProps {
  feature: DiscoverableFeature;
  className?: string;
}

/**
 * Pulsing dot that appears next to a feature the user has not yet tried.
 * Disappears once `markFeatureDiscovered(feature)` is called.
 */
export function FeatureDiscoveryDot({
  feature,
  className = '',
}: FeatureDiscoveryDotProps) {
  const [discovered, setDiscovered] = useState(true); // default hidden

  useEffect(() => {
    setDiscovered(loadDiscovered().has(feature));
  }, [feature]);

  // Listen for discovery events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === feature) setDiscovered(true);
    };
    window.addEventListener('pl_feature_discovered', handler);
    return () =>
      window.removeEventListener('pl_feature_discovered', handler);
  }, [feature]);

  if (discovered) return null;

  return (
    <span
      className={`relative inline-flex ${className}`}
      aria-hidden="true"
    >
      {/* Pulse ring */}
      <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-primary/40 animate-ping" />
      {/* Solid dot */}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
    </span>
  );
}
