/**
 * useWebSocket Hook - React hook for WebSocket connection
 */
import { useEffect, useRef } from 'react';
import { WebSocketService } from '../services/websocket';
import { useAnalyticsStore } from '../store/analyticsStore';
import type { ConnectionStatus } from '../types';

const WS_URL = 'ws://localhost:3456';

/**
 * Hook for WebSocket connection management
 */
export function useWebSocket() {
  const serviceRef = useRef<WebSocketService | null>(null);
  const { addEvent, setConnectionStatus } = useAnalyticsStore();

  useEffect(() => {
    const service = new WebSocketService({
      url: WS_URL,
      reconnectDelay: 3000,
      maxReconnectAttempts: Infinity,
    });

    serviceRef.current = service;

    const unsubscribeEvent = service.onEvent((event) => {
      addEvent(event);
    });

    const unsubscribeStatus = service.onStatusChange((status: ConnectionStatus) => {
      setConnectionStatus(status);
    });

    const unsubscribeError = service.onError((error) => {
      console.error('[useWebSocket] Error:', error.message);
    });

    service.connect();

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      unsubscribeError();
      service.disconnect();
      serviceRef.current = null;
    };
  }, [addEvent, setConnectionStatus]);

  return {
    status: useAnalyticsStore((state) => state.connectionStatus),
    lastEventTimestamp: useAnalyticsStore((state) => state.lastEventTimestamp),
  };
}
