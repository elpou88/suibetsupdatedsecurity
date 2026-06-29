/**
 * liveOddsService.ts
 *
 * Computes live in-play odds adjustments for P2P offers using free ESPN data.
 * Polls every 15 s while matches are live, broadcasts via WebSocket.
 *
 * Odds shift model (simple Bayesian update):
 *   - Leading team odds compress toward 1.05× (near-certain win)
 *   - Trailing team odds expand toward 8.0× (comeback scenario)
 *   - Time decay: remaining ÷ 90 min weight applied to shift magnitude
 *   - Draw odds widen when scores are level in final 15 min
 */

import { wsService } from './websocketService';

export interface LiveOddsUpdate {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  isLive: boolean;
  // Adjusted multipliers for each outcome (vs pre-match odds)
  odds: {
    home: number;   // adjusted decimal odds for home win
    away: number;   // adjusted decimal odds for away win
    draw: number;   // adjusted decimal odds for draw
  };
  shift: {
    home: number;   // factor to multiply creator's home-odds by
    away: number;
    draw: number;
  };
  lastUpdated: number;
}

// Cache: eventId → latest update
const liveOddsCache = new Map<string, LiveOddsUpdate>();
// Timer handle
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Compute odds shift factors from a live scoreline.
 * Returns multiplier per outcome (apply to creator's original odds).
 */
export function computeOddsShift(
  homeScore: number,
  awayScore: number,
  minute: number,
): { home: number; away: number; draw: number } {
  const remaining = Math.max(0, 90 - minute);
  const timeWeight = remaining / 90; // 1 at kickoff → 0 at 90'

  const diff = homeScore - awayScore;
  const absDiff = Math.abs(diff);

  if (absDiff === 0) {
    // Level — draw becomes more likely in final minutes
    const drawBoost = minute > 75 ? 0.7 : 1.0;
    return { home: 1 + 0.1 * (1 - timeWeight), away: 1 + 0.1 * (1 - timeWeight), draw: drawBoost };
  }

  // Leader / trailer shifts scale with time elapsed
  const leadShift = Math.min(0.85, 0.15 * absDiff * (1 - timeWeight)); // compress winner odds
  const trailShift = Math.min(2.5, 0.4 * absDiff * (1 - timeWeight));  // expand loser odds

  if (diff > 0) {
    // Home leading
    return {
      home: Math.max(0.25, 1 - leadShift),
      away: 1 + trailShift,
      draw: 1 + trailShift * 0.6,
    };
  } else {
    // Away leading
    return {
      home: 1 + trailShift,
      away: Math.max(0.25, 1 - leadShift),
      draw: 1 + trailShift * 0.6,
    };
  }
}

/**
 * Fetch live events from ESPN free API and update the cache.
 */
async function pollLiveScores(): Promise<void> {
  const sports = [
    { key: 'soccer', espnPath: 'soccer/eng.1/scoreboard' },
    { key: 'basketball', espnPath: 'basketball/nba/scoreboard' },
    { key: 'baseball', espnPath: 'baseball/mlb/scoreboard' },
    { key: 'americanfootball', espnPath: 'football/nfl/scoreboard' },
  ];

  const updates: LiveOddsUpdate[] = [];

  await Promise.allSettled(sports.map(async (sport) => {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sport.espnPath}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data: any = await res.json();
      const events: any[] = data.events ?? [];

      for (const ev of events) {
        const competition = ev.competitions?.[0];
        if (!competition) continue;
        const status = competition.status?.type;
        const isLive = status?.state === 'in';
        if (!isLive) continue;

        const home = competition.competitors?.find((c: any) => c.homeAway === 'home');
        const away = competition.competitors?.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        const homeScore = parseInt(home.score ?? '0', 10) || 0;
        const awayScore = parseInt(away.score ?? '0', 10) || 0;
        const minute = parseInt(status?.detail ?? '0', 10) || 0;
        const shift = computeOddsShift(homeScore, awayScore, minute);

        // Default pre-match odds (equal opportunity); offers will apply shift to their own odds
        const baseHome = 2.0;
        const baseAway = 2.0;
        const baseDraw = 3.3;

        const update: LiveOddsUpdate = {
          eventId: String(ev.id),
          homeTeam: home.team?.displayName ?? '',
          awayTeam: away.team?.displayName ?? '',
          homeScore,
          awayScore,
          minute,
          isLive: true,
          odds: {
            home: Math.max(1.01, baseHome * shift.home),
            away: Math.max(1.01, baseAway * shift.away),
            draw: Math.max(1.01, baseDraw * shift.draw),
          },
          shift,
          lastUpdated: Date.now(),
        };

        liveOddsCache.set(update.eventId, update);
        updates.push(update);
      }
    } catch (_) { /* non-fatal */ }
  }));

  if (updates.length > 0) {
    wsService.broadcast('live-odds', { updates, ts: Date.now() });
  }
}

/** Start the polling loop (called once from server startup). */
export function startLiveOddsPoll(intervalMs = 15_000): void {
  if (pollTimer) return;
  // First poll immediately
  pollLiveScores().catch(() => {});
  pollTimer = setInterval(() => { pollLiveScores().catch(() => {}); }, intervalMs);
  console.log('[LiveOdds] Polling live scores every', intervalMs / 1000, 's');
}

export function stopLiveOddsPoll(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** Get current live odds for a specific event (or all live events). */
export function getLiveOdds(eventId?: string): LiveOddsUpdate[] {
  if (eventId) {
    const entry = liveOddsCache.get(eventId);
    return entry ? [entry] : [];
  }
  return [...liveOddsCache.values()];
}
