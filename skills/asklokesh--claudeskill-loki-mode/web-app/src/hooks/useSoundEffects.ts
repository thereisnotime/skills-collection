import { useCallback, useMemo } from 'react';

const STORAGE_KEY = 'purple-lab-sounds-enabled';

function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', gain = 0.15) {
  if (!isSoundEnabled()) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    vol.gain.value = gain;
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Web Audio API not available -- silent fallback
  }
}

export function useSoundEffects() {
  const playBuildComplete = useCallback(() => {
    // Pleasant ascending chime: two quick sine tones
    playTone(523, 0.15, 'sine', 0.12);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.12), 100);
    setTimeout(() => playTone(784, 0.25, 'sine', 0.10), 200);
  }, []);

  const playError = useCallback(() => {
    // Soft low tone
    playTone(220, 0.3, 'sine', 0.1);
  }, []);

  const playNotification = useCallback(() => {
    // Gentle ping
    playTone(880, 0.12, 'sine', 0.08);
  }, []);

  const sounds = useMemo(() => ({
    buildComplete: playBuildComplete,
    error: playError,
    notification: playNotification,
    enabled: isSoundEnabled(),
    setEnabled: setSoundEnabled,
  }), [playBuildComplete, playError, playNotification]);

  return sounds;
}
