import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateLiveEventsCache } from './useEvents';

type WSStatus = 'connecting' | 'connected' | 'disconnected';

interface WSMessage {
  type: string;
  data: any;
  ts: number;
}

const WS_RECONNECT_DELAY = 3000;
const WS_MAX_RECONNECT_DELAY = 30000;

function getWsUrl(): string {
  const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
  if (apiBase) {
    const url = new URL(apiBase.startsWith('http') ? apiBase : `${window.location.protocol}//${apiBase}`);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

let sharedSocket: WebSocket | null = null;
let sharedListeners: Set<(msg: WSMessage) => void> = new Set();
let sharedStatus: WSStatus = 'disconnected';
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statusListeners: Set<(s: WSStatus) => void> = new Set();

function setStatus(s: WSStatus) {
  sharedStatus = s;
  statusListeners.forEach(fn => fn(s));
}

function connect() {
  if (sharedSocket && (sharedSocket.readyState === WebSocket.OPEN || sharedSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setStatus('connecting');
  try {
    const ws = new WebSocket(getWsUrl());
    sharedSocket = ws;

    ws.onopen = () => {
      reconnectAttempt = 0;
      setStatus('connected');
      console.log('[WS] Connected to real-time feed');
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        sharedListeners.forEach(fn => fn(msg));
      } catch {}
    };

    ws.onclose = () => {
      sharedSocket = null;
      setStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch {
    setStatus('disconnected');
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(WS_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempt), WS_MAX_RECONNECT_DELAY);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function subscribe(listener: (msg: WSMessage) => void) {
  sharedListeners.add(listener);
  if (sharedListeners.size === 1) {
    connect();
  }
  return () => {
    sharedListeners.delete(listener);
    if (sharedListeners.size === 0 && statusListeners.size === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }
  };
}

/** Subscribe to raw WS messages in any component without the query-cache side effects. */
export function useWsOn(handler: (msg: WSMessage) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const unsub = subscribe((msg) => handlerRef.current(msg));
    return unsub;
  }, []);
}

export function useWebSocket() {
  const [status, setLocalStatus] = useState<WSStatus>(sharedStatus);
  const queryClient = useQueryClient();

  useEffect(() => {
    setLocalStatus(sharedStatus);
    statusListeners.add(setLocalStatus);
    return () => { statusListeners.delete(setLocalStatus); };
  }, []);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === 'recent-bets' && msg.data) {
        queryClient.setQueryData(['/api/bets/recent-feed'], msg.data);
      }
      if (msg.type === 'live-events' && Array.isArray(msg.data)) {
        // Invalidate the in-memory fetch cache so the next poll fetches fresh data
        invalidateLiveEventsCache();

        // Merge WS snapshot into the existing cache.
        // The WS push comes from ESPN/FreeSports which has live score/minute data
        // but NO homeOdds / awayOdds / markets (those come from the API-Sports poll).
        // Blindly replacing the cache wipes the odds → the home page shows "Live (0)".
        // Fix: overwrite only score/minute/status from the WS push; keep odds & markets
        // from whatever was previously in the cache.
        // Never wipe the cache if the WS push is empty — only the HTTP poll should do that.
        const mergeIntoCache = (old: any[] | undefined): any[] => {
          const oldEvents: any[] = Array.isArray(old) ? old : [];
          const fresh: any[] = msg.data;
          if (!fresh || fresh.length === 0) return oldEvents;

          const oldMap = new Map(oldEvents.map((e: any) => [String(e.id), e]));
          return fresh.map((newEv: any) => {
            const existing = oldMap.get(String(newEv.id));
            if (!existing) return newEv;
            return {
              ...existing,
              // Live fields that the WS snapshot keeps current
              homeScore:    newEv.homeScore    ?? existing.homeScore,
              awayScore:    newEv.awayScore    ?? existing.awayScore,
              score:        newEv.score        ?? existing.score,
              minute:       newEv.minute       ?? existing.minute,
              displayMinute:newEv.displayMinute?? existing.displayMinute,
              status:       newEv.status       ?? existing.status,
              isLive:       newEv.isLive       !== undefined ? newEv.isLive : existing.isLive,
              // Preserve odds & markets from the richer API-Sports poll data
              markets:  (newEv.markets?.length  > 0) ? newEv.markets  : existing.markets,
              homeOdds: newEv.homeOdds != null  ? newEv.homeOdds  : existing.homeOdds,
              drawOdds: newEv.drawOdds != null  ? newEv.drawOdds  : existing.drawOdds,
              awayOdds: newEv.awayOdds != null  ? newEv.awayOdds  : existing.awayOdds,
            };
          });
        };

        // Update every query key that live-event pages subscribe to.
        queryClient.setQueryData(['events', 'live', 'all'], mergeIntoCache);  // useLiveEvents / home
        queryClient.setQueryData(['/api/events/live'],      mergeIntoCache);  // LiveBettingMarkets
        queryClient.setQueryData(['/api/events/live-lite'], mergeIntoCache);  // home-real.tsx
      }
      if (msg.type === 'event-counts' && msg.data) {
        queryClient.setQueryData(['events', 'counts'], msg.data);
      }
      if (msg.type === 'p2p-updates' && msg.data) {
        const { type } = msg.data;
        if (type === 'offer' || !type) {
          queryClient.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
        }
        if (type === 'parlay' || !type) {
          queryClient.invalidateQueries({ queryKey: ['/api/p2p/parlays', 'all'] });
        }
        queryClient.invalidateQueries({ queryKey: ['/api/p2p/my'] });
      }
    });
    return unsub;
  }, [queryClient]);

  return { status, isConnected: status === 'connected' };
}

export function useWebSocketChannel<T = any>(channel: string): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === channel) {
        setData(msg.data);
      }
    });
    return unsub;
  }, [channel]);

  return data;
}
