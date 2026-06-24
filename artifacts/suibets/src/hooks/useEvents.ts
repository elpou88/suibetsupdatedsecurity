import { useQuery } from '@tanstack/react-query';
import { useRef, useMemo } from 'react';
import { useWebSocket } from './useWebSocket';

export interface SportEvent {
  id: string | number;
  sportId: number;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueName?: string;
  leagueSlug?: string;
  league?: string;
  startTime: string;
  isLive: boolean;
  score?: string;
  homeScore?: number;
  awayScore?: number;
  minute?: string | number;
  displayMinute?: string;
  clockSeconds?: number;
  status?: string;
  stats?: any;
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  markets?: any[];
}

// Stable merge function - preserves existing event objects when data is the same.
// Only merges when newEvents is non-empty — empty-list clearing is handled
// one level up (in the useLiveEvents useMemo) with a time-based grace window
// so transient API failures don't wipe the visible event list.
function mergeEventsStably(prevEvents: SportEvent[], newEvents: SportEvent[]): SportEvent[] {
  if (!prevEvents || prevEvents.length === 0) return newEvents;
  if (!newEvents || newEvents.length === 0) return newEvents;

  const prevMap = new Map(prevEvents.map(e => [String(e.id), e]));

  return newEvents.map(newEvent => {
    const prevEvent = prevMap.get(String(newEvent.id));
    if (!prevEvent) return newEvent;

    const sameScore = prevEvent.homeScore === newEvent.homeScore &&
                      prevEvent.awayScore === newEvent.awayScore;
    const sameMinute = prevEvent.minute === newEvent.minute;
    const sameStatus = prevEvent.status === newEvent.status;
    const logosAdded = !prevEvent.homeLogo && newEvent.homeLogo;

    if (sameScore && sameMinute && sameStatus && !logosAdded) {
      return prevEvent;
    }

    return newEvent;
  });
}

// Module-level in-memory cache — shared across all hook instances so a WS
// invalidation immediately affects the very next poll regardless of which
// component triggered it.
let allLiveCache: { data: SportEvent[]; time: number; valid: boolean } = {
  data: [],
  time: 0,
  valid: false,
};
const ALL_LIVE_CACHE_TTL = 10_000;

// Called by the WebSocket handler when a fresh server snapshot arrives so the
// next polling call doesn't serve the now-superseded in-memory cache.
export function invalidateLiveEventsCache() {
  allLiveCache.valid = false;
}

async function fetchAllLiveEvents(): Promise<SportEvent[]> {
  if (allLiveCache.valid && Date.now() - allLiveCache.time < ALL_LIVE_CACHE_TTL) {
    return allLiveCache.data;
  }

  // Keep previous data so we can fall back to it if the API returns empty.
  // This prevents a single empty poll from clearing the visible event list.
  const previousData = allLiveCache.data;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const tryFetch = async (): Promise<SportEvent[]> => {
    // --- Primary: live-lite snapshot endpoint (fastest, always fresh) ---
    const liteResponse = await fetch('/api/events/live-lite', {
      signal: controller.signal,
      credentials: 'include',
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (liteResponse?.ok) {
      const data = await liteResponse.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }

    // --- Fallback: generic events endpoint with isLive filter ---
    const response = await fetch('/api/events?isLive=true', {
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Failed to fetch live events');
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  };

  try {
    const result = await tryFetch();

    // If the API returned 0 events but we previously had events, hold the
    // previous data for this cycle.  The next poll (10 s later) will confirm
    // whether events really ended or this was a transient empty response.
    if (result.length === 0 && previousData.length > 0) {
      allLiveCache = { data: previousData, time: Date.now(), valid: true };
      return previousData;
    }

    allLiveCache = { data: result, time: Date.now(), valid: true };
    return result;
  } catch {
    clearTimeout(timeoutId);

    // On network / parse error return whatever we had before rather than [].
    if (previousData.length > 0) {
      allLiveCache = { data: previousData, time: Date.now(), valid: true };
      return previousData;
    }

    // Last-resort retry without abort signal
    try {
      const response = await fetch('/api/events?isLive=true', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch live events');
      const data = await response.json();
      const result = Array.isArray(data) ? data : [];
      allLiveCache = { data: result, time: Date.now(), valid: true };
      return result;
    } catch {
      return previousData;
    }
  }
}

export function useLiveEvents(sportId?: string | number | null) {
  const normalizedSportId = sportId ? String(sportId) : 'all';
  const previousDataRef = useRef<SportEvent[]>([]);
  const prevSportRef = useRef<string>(normalizedSportId);
  const lastGoodDataTime = useRef<number>(0);
  const { isConnected: wsConnected } = useWebSocket();

  if (prevSportRef.current !== normalizedSportId) {
    previousDataRef.current = [];
    prevSportRef.current = normalizedSportId;
    lastGoodDataTime.current = 0;
  }

  const query = useQuery<SportEvent[]>({
    queryKey: ['events', 'live', 'all'],
    queryFn: fetchAllLiveEvents,
    refetchInterval: wsConnected ? 20000 : 15000,
    staleTime: wsConnected ? 15000 : 10000,
    gcTime: 60000,
    refetchOnWindowFocus: true,
    placeholderData: (previousData) => previousData ?? [],
    retry: 2,
    retryDelay: 1000,
  });

  const stableData = useMemo(() => {
    let rawData = query.data ?? [];
    if (normalizedSportId !== 'all') {
      rawData = rawData.filter(e => String(e.sportId) === normalizedSportId);
    }

    const now = Date.now();

    if (rawData.length > 0) {
      // We have fresh events — merge stably and record the timestamp.
      lastGoodDataTime.current = now;
      const merged = mergeEventsStably(previousDataRef.current, rawData);
      previousDataRef.current = merged;
      return merged;
    }

    // rawData is empty (API returned nothing or sport filter produced 0 results).
    // Keep previous data for up to 60 s to ride out transient empty responses
    // or brief gaps between polls.  After 60 s we accept that matches have
    // genuinely ended and clear the list.
    const elapsed = now - lastGoodDataTime.current;
    if (previousDataRef.current.length > 0 && elapsed < 60_000) {
      return previousDataRef.current;
    }

    previousDataRef.current = [];
    return [];
  }, [query.data, normalizedSportId]);

  return {
    ...query,
    data: stableData,
  };
}

export function useUpcomingEvents(sportId?: string | number | null) {
  const normalizedSportId = sportId ? String(sportId) : 'all';

  const url = normalizedSportId === 'all'
    ? '/api/events?isLive=false'
    : `/api/events?isLive=false&sportId=${normalizedSportId}`;

  return useQuery<any[]>({
    queryKey: ['events', 'upcoming', normalizedSportId],
    queryFn: async () => {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch upcoming events');
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 30000,
    staleTime: 25000,
    gcTime: 120000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData ?? [],
  });
}
