import { useQuery } from '@tanstack/react-query';
import { useRef, useMemo } from 'react';

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
  minute?: string;
  status?: string;
  stats?: any;
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  markets?: any[];
}

// Stable merge function - preserves existing event objects when data is the same
function mergeEventsStably(prevEvents: SportEvent[], newEvents: SportEvent[]): SportEvent[] {
  if (!prevEvents || prevEvents.length === 0) return newEvents;
  if (!newEvents || newEvents.length === 0) return prevEvents;
  
  // Create a map of previous events by ID for fast lookup
  const prevMap = new Map(prevEvents.map(e => [String(e.id), e]));
  
  // Merge new events while preserving object identity where data is same
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

let allLiveCache: { data: SportEvent[]; time: number; valid: boolean } = { data: [], time: 0, valid: false };
const ALL_LIVE_CACHE_TTL = 12_000;

async function fetchAllLiveEvents(): Promise<SportEvent[]> {
  if (allLiveCache.valid && Date.now() - allLiveCache.time < ALL_LIVE_CACHE_TTL) {
    return allLiveCache.data;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const liteResponse = await fetch('/api/events/live-lite', {
      signal: controller.signal,
      credentials: 'include',
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (liteResponse?.ok) {
      const data = await liteResponse.json();
      if (Array.isArray(data) && data.length > 0) {
        allLiveCache = { data, time: Date.now(), valid: true };
        return data;
      }
    }

    const response = await fetch('/api/events?isLive=true', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch live events');
    const data = await response.json();
    const result = Array.isArray(data) ? data : [];
    allLiveCache = { data: result, time: Date.now(), valid: true };
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    const response = await fetch('/api/events?isLive=true', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch live events');
    const data = await response.json();
    const result = Array.isArray(data) ? data : [];
    allLiveCache = { data: result, time: Date.now(), valid: true };
    return result;
  }
}

export function useLiveEvents(sportId?: string | number | null) {
  const normalizedSportId = sportId ? String(sportId) : 'all';
  const previousDataRef = useRef<SportEvent[]>([]);
  const prevSportRef = useRef<string>(normalizedSportId);

  if (prevSportRef.current !== normalizedSportId) {
    previousDataRef.current = [];
    prevSportRef.current = normalizedSportId;
  }

  const query = useQuery<SportEvent[]>({
    queryKey: ['events', 'live', 'all'],
    queryFn: fetchAllLiveEvents,
    refetchInterval: 15000,
    staleTime: 10000,
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
    const merged = mergeEventsStably(previousDataRef.current, rawData);
    previousDataRef.current = merged;
    return merged;
  }, [query.data, normalizedSportId]);

  return {
    ...query,
    data: stableData
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
