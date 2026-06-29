/**
 * ESPN-based free sports data service.
 *
 * Replaces paid API-Sports calls with ESPN's public scoreboard JSON
 * (no API key required) plus TheSportsDB as a free fallback for sports
 * ESPN does not cover (handball, volleyball, boxing).
 *
 * Returns SportEvent shapes compatible with the rest of the app.
 */

import axios from 'axios';
import { SportEvent } from '../types/betting';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

const HTTP_TIMEOUT_MS = 8000;

// Map our internal sport name -> list of ESPN {sport,league} pairs to query.
// Order matters: most-popular leagues first so they appear at the top.
const ESPN_LEAGUE_MAP: Record<string, Array<{ sport: string; league: string; humanLeague?: string }>> = {
  football: [
    { sport: 'soccer', league: 'eng.1', humanLeague: 'Premier League' },
    { sport: 'soccer', league: 'esp.1', humanLeague: 'La Liga' },
    { sport: 'soccer', league: 'ita.1', humanLeague: 'Serie A' },
    { sport: 'soccer', league: 'ger.1', humanLeague: 'Bundesliga' },
    { sport: 'soccer', league: 'fra.1', humanLeague: 'Ligue 1' },
    { sport: 'soccer', league: 'por.1', humanLeague: 'Primeira Liga' },
    { sport: 'soccer', league: 'ned.1', humanLeague: 'Eredivisie' },
    { sport: 'soccer', league: 'uefa.champions', humanLeague: 'Champions League' },
    { sport: 'soccer', league: 'uefa.europa', humanLeague: 'Europa League' },
    { sport: 'soccer', league: 'uefa.europa.conf', humanLeague: 'Conference League' },
    { sport: 'soccer', league: 'uefa.nations', humanLeague: 'Nations League' },
    { sport: 'soccer', league: 'fifa.world', humanLeague: 'FIFA World Cup' },
    { sport: 'soccer', league: 'uefa.euro', humanLeague: 'UEFA Euro' },
    { sport: 'soccer', league: 'conmebol.libertadores', humanLeague: 'Copa Libertadores' },
    { sport: 'soccer', league: 'usa.1', humanLeague: 'MLS' },
    { sport: 'soccer', league: 'mex.1', humanLeague: 'Liga MX' },
    { sport: 'soccer', league: 'bra.1', humanLeague: 'Brasileirao' },
    { sport: 'soccer', league: 'arg.1', humanLeague: 'Argentine Primera' },
    { sport: 'soccer', league: 'sco.1', humanLeague: 'Scottish Premiership' },
    { sport: 'soccer', league: 'tur.1', humanLeague: 'Super Lig' },
    { sport: 'soccer', league: 'eng.2', humanLeague: 'EFL Championship' },
    { sport: 'soccer', league: 'esp.2', humanLeague: 'La Liga 2' },
    { sport: 'soccer', league: 'eng.fa', humanLeague: 'FA Cup' },
    { sport: 'soccer', league: 'eng.league_cup', humanLeague: 'EFL Cup' },
    // Additional leagues commonly offered by API-Sports that users can bet on.
    // Without these, bets on these leagues would never find a result and get voided.
    { sport: 'soccer', league: 'bel.1', humanLeague: 'Belgian Pro League' },
    { sport: 'soccer', league: 'gre.1', humanLeague: 'Greek Super League' },
    { sport: 'soccer', league: 'den.1', humanLeague: 'Danish Superliga' },
    { sport: 'soccer', league: 'nor.1', humanLeague: 'Eliteserien' },
    { sport: 'soccer', league: 'swe.1', humanLeague: 'Allsvenskan' },
    { sport: 'soccer', league: 'sui.1', humanLeague: 'Swiss Super League' },
    { sport: 'soccer', league: 'aut.1', humanLeague: 'Austrian Bundesliga' },
    { sport: 'soccer', league: 'ksa.1', humanLeague: 'Saudi Pro League' },
    { sport: 'soccer', league: 'jpn.1', humanLeague: 'J1 League' },
    { sport: 'soccer', league: 'chn.1', humanLeague: 'Chinese Super League' },
    { sport: 'soccer', league: 'afc.champions', humanLeague: 'AFC Champions League' },
    { sport: 'soccer', league: 'eng.3', humanLeague: 'EFL League One' },
    { sport: 'soccer', league: 'ita.2', humanLeague: 'Serie B' },
    { sport: 'soccer', league: 'ger.2', humanLeague: 'Bundesliga 2' },
    { sport: 'soccer', league: 'fra.2', humanLeague: 'Ligue 2' },
  ],
  basketball: [
    { sport: 'basketball', league: 'nba', humanLeague: 'NBA' },
    { sport: 'basketball', league: 'wnba', humanLeague: 'WNBA' },
    { sport: 'basketball', league: 'mens-college-basketball', humanLeague: 'NCAA Mens' },
    { sport: 'basketball', league: 'fiba', humanLeague: 'FIBA' },
  ],
  baseball: [
    { sport: 'baseball', league: 'mlb', humanLeague: 'MLB' },
    { sport: 'baseball', league: 'college-baseball', humanLeague: 'NCAA Baseball' },
  ],
  hockey: [
    { sport: 'hockey', league: 'nhl', humanLeague: 'NHL' },
  ],
  'ice-hockey': [
    { sport: 'hockey', league: 'nhl', humanLeague: 'NHL' },
  ],
  'american-football': [
    { sport: 'football', league: 'nfl', humanLeague: 'NFL' },
    { sport: 'football', league: 'college-football', humanLeague: 'NCAA Football' },
  ],
  nfl: [
    { sport: 'football', league: 'nfl', humanLeague: 'NFL' },
  ],
  mma: [
    { sport: 'mma', league: 'ufc', humanLeague: 'UFC' },
  ],
  'formula-1': [
    { sport: 'racing', league: 'f1', humanLeague: 'Formula 1' },
  ],
  rugby: [
    { sport: 'rugby', league: '180659', humanLeague: 'Six Nations' },
    { sport: 'rugby', league: '270557', humanLeague: 'Rugby Championship' },
    { sport: 'rugby', league: '244293', humanLeague: 'Premiership Rugby' },
    { sport: 'rugby', league: '270559', humanLeague: 'Top 14' },
    { sport: 'rugby', league: '289227', humanLeague: 'United Rugby Championship' },
  ],
  afl: [
    { sport: 'australian-football', league: 'afl', humanLeague: 'AFL' },
  ],
  cricket: [
    // IPL (8048) is active ~Mar–May. Big Bash (bigbash) ~Dec–Feb. PSL (psl) ~Feb–Mar.
    // CPL (cpl) ~Aug–Sep. These 404 when off-season but errors are caught gracefully;
    // TheSportsDB is the real fallback for year-round county/international cricket.
    { sport: 'cricket', league: '8048', humanLeague: 'Indian Premier League' },
    { sport: 'cricket', league: 'icc.cwc', humanLeague: 'ICC Cricket World Cup' },
    { sport: 'cricket', league: 'icc.wt20', humanLeague: 'ICC T20 World Cup' },
  ],
  tennis: [
    { sport: 'tennis', league: 'atp', humanLeague: 'ATP' },
    { sport: 'tennis', league: 'wta', humanLeague: 'WTA' },
  ],
  golf: [
    { sport: 'golf', league: 'pga', humanLeague: 'PGA Tour' },
    { sport: 'golf', league: 'lpga', humanLeague: 'LPGA' },
    { sport: 'golf', league: 'eur', humanLeague: 'DP World Tour' },
  ],
};

// Sport-id mapping MUST match the DB sports table (and freeSportsService
// SLUG_TO_SPORT_ID). Used by /api/events?sportId=N filtering.
const INTERNAL_SPORT_ID: Record<string, number> = {
  football: 1,
  soccer: 1,
  basketball: 2,
  tennis: 3,
  'american-football': 4,
  baseball: 5,
  hockey: 6,
  'ice-hockey': 6,
  mma: 7,
  boxing: 8,
  afl: 10,
  'formula-1': 11,
  f1: 11,
  handball: 12,
  nba: 13,
  nfl: 14,
  rugby: 15,
  volleyball: 16,
  cricket: 18,
  golf: 30, // no DB id, keep unique value
};

interface EspnEvent {
  id: string;
  uid?: string;
  date?: string;
  name?: string;
  shortName?: string;
  competitions?: Array<any>;
  status?: any;
  season?: any;
  links?: Array<any>;
}

interface EspnScoreboard {
  events?: EspnEvent[];
  leagues?: Array<{ id: string; name: string; slug?: string; abbreviation?: string }>;
}

const HTTP = axios.create({ timeout: HTTP_TIMEOUT_MS });

class EspnSportsService {
  private cache = new Map<string, { ts: number; events: SportEvent[] }>();

  /**
   * Returns currently in-progress events for a sport. Pulls every league
   * configured for that sport in parallel.
   */
  async getLiveEvents(sport: string): Promise<SportEvent[]> {
    const all = await this.getAllEvents(sport);
    return all.filter((e) => e.isLive);
  }

  /**
   * Returns ALL of today's events for a sport regardless of status
   * (scheduled, in-progress, finished). Used as a fallback when no live
   * games exist — lets the Live tab show something useful.
   */
  async getTodayEvents(sport: string): Promise<SportEvent[]> {
    return this.getAllEvents(sport, 0, 0);
  }

  /**
   * Returns upcoming (scheduled) events for a sport, soonest first, limited
   * to `limit`. We pull a slightly wider date range so we catch events for
   * tomorrow too.
   */
  async getUpcomingEvents(sport: string, limit: number = 50): Promise<SportEvent[]> {
    const sportLower = sport.toLowerCase();
    // NHL and NFL publish next-season schedules months in advance. ESPN only
    // returns them when NO date filter is applied (their scoreboard defaults to
    // the "current slate"). Passing a 7-day window in June returns nothing.
    // Use includeNextDays=0 so buildDateParam returns null → no ?dates= param.
    const SEASON_SCHEDULE_SPORTS = new Set(['hockey', 'ice-hockey', 'american-football', 'nfl']);
    const daysAhead = SEASON_SCHEDULE_SPORTS.has(sportLower) ? 0 : 7;
    const all = await this.getAllEvents(sport, daysAhead);
    const now = Date.now();
    return all
      .filter((e) => e.status === 'scheduled' || e.status === 'upcoming')
      .filter((e) => {
        const t = new Date(e.startTime).getTime();
        return Number.isFinite(t) && t >= now - 30 * 60 * 1000; // include things that just kicked off
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, limit);
  }

  /**
   * Returns recently-completed events. Used by the settlement worker to find
   * final scores.
   */
  async getFinishedEvents(sport: string, lookbackHours: number = 36): Promise<SportEvent[]> {
    const all = await this.getAllEvents(sport, /* includeNextDays */ 0, /* includePastDays */ Math.ceil(lookbackHours / 24) + 1);
    const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
    return all.filter((e) => e.status === 'finished' && new Date(e.startTime).getTime() >= cutoff);
  }

  /** Direct lookup: fetch a single event by ESPN id. Useful for settlement. */
  async getEventById(sport: string, eventId: string): Promise<SportEvent | null> {
    const all = await this.getAllEvents(sport, 7, 3);
    return all.find((e) => e.id === eventId) || null;
  }

  /**
   * Internal: fetches all leagues for a sport across the requested date
   * window, with caching.
   */
  private async getAllEvents(
    sport: string,
    includeNextDays: number = 0,
    includePastDays: number = 0,
  ): Promise<SportEvent[]> {
    const sportLower = sport.toLowerCase();
    const cacheKey = `${sportLower}|next${includeNextDays}|past${includePastDays}`;
    const cached = this.cache.get(cacheKey);
    // Live cache: 30s. Upcoming cache: 5min.
    const ttl = includeNextDays > 0 ? 5 * 60 * 1000 : 30 * 1000;
    if (cached && Date.now() - cached.ts < ttl) {
      return cached.events;
    }

    const leagues = ESPN_LEAGUE_MAP[sportLower];
    let events: SportEvent[] = [];

    if (leagues && leagues.length > 0) {
      // Build a list of dates to query. ESPN scoreboard defaults to "today"
      // but we can pass dates=YYYYMMDD or dates=YYYYMMDD-YYYYMMDD to span.
      const dateParam = this.buildDateParam(includePastDays, includeNextDays);
      const requests = leagues.map((lg) =>
        this.fetchEspn(lg.sport, lg.league, dateParam)
          .then((board) => this.normalizeEspn(board, sportLower, lg.humanLeague || lg.league))
          .catch((err) => {
            console.warn(`[espn] ${lg.sport}/${lg.league} failed:`, err?.message || err);
            return [] as SportEvent[];
          }),
      );
      const results = await Promise.all(requests);
      events = results.flat();
    }

    // Fallback to TheSportsDB for sports ESPN doesn't cover.
    if (events.length === 0 && this.tsdbSportName(sportLower)) {
      try {
        events = await this.fetchTheSportsDB(sportLower, includeNextDays, includePastDays);
      } catch (err: any) {
        console.warn(`[tsdb] ${sportLower} failed:`, err?.message || err);
      }
    }

    // De-dupe by id
    const seen = new Set<string>();
    events = events.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    this.cache.set(cacheKey, { ts: Date.now(), events });
    return events;
  }

  private buildDateParam(includePastDays: number, includeNextDays: number): string | null {
    if (includePastDays <= 0 && includeNextDays <= 0) return null;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - includePastDays);
    const end = new Date();
    end.setUTCDate(end.getUTCDate() + includeNextDays);
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return `${fmt(start)}-${fmt(end)}`;
  }

  private async fetchEspn(sport: string, league: string, dateParam: string | null): Promise<EspnScoreboard> {
    const url = `${ESPN_BASE}/${sport}/${league}/scoreboard`;
    const params: Record<string, string> = {};
    if (dateParam) params.dates = dateParam;
    const resp = await HTTP.get(url, { params });
    return resp.data || {};
  }

  private normalizeEspn(board: EspnScoreboard, internalSport: string, humanLeague: string): SportEvent[] {
    const events = board.events || [];
    const leagueMeta: { id?: string; name?: string; slug?: string } = (board.leagues && board.leagues[0]) || {};
    const sportId = INTERNAL_SPORT_ID[internalSport] ?? 0;

    return events
      .map((ev) => {
        try {
          const comp = (ev.competitions && ev.competitions[0]) || {};
          const competitors: any[] = comp.competitors || [];
          const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
          const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
          const homeTeamObj = home.team || {};
          const awayTeamObj = away.team || {};

          const status = ev.status || {};
          const stType = status.type || {};
          const stateRaw: string = stType.state || '';
          const completed: boolean = !!stType.completed;
          const desc: string = stType.description || '';

          let normalizedStatus: SportEvent['status'] = 'scheduled';
          let isLive = false;
          if (completed) {
            normalizedStatus = 'finished';
          } else if (stateRaw === 'in') {
            normalizedStatus = 'live';
            isLive = true;
          } else if (stateRaw === 'pre') {
            normalizedStatus = 'scheduled';
          } else if (stateRaw === 'post') {
            normalizedStatus = 'finished';
          }

          // Live minute / period extraction. ESPN gives:
          //  - status.clock (numeric seconds in current period)
          //  - status.displayClock (string e.g. "45+2'", "Q4 8:23", "0:00")
          //  - status.period (1=H1, 2=H2, etc. for soccer; 1-4 for NFL/NBA quarters)
          let minute: number | undefined = undefined;
          let displayMinute: string | undefined = undefined;
          if (isLive) {
            const period: number = Number(status.period) || 0;
            const displayClock: string = String(status.displayClock || '').trim();

            if (internalSport === 'football') {
              // Soccer: convert period+clock to minute (0-90+)
              // displayClock is usually like "45+2'" or "67'" — try parse
              const m = displayClock.match(/(\d+)(?:\+(\d+))?/);
              if (m) {
                const base = Number(m[1]) || 0;
                const extra = Number(m[2]) || 0;
                minute = base + extra;
              } else if (period > 0) {
                minute = period === 1 ? 30 : period === 2 ? 75 : period * 30;
              }
              displayMinute = displayClock || (period === 1 ? '1H' : period === 2 ? '2H' : period >= 3 ? 'ET' : 'LIVE');
            } else if (internalSport === 'basketball' || internalSport === 'american-football' || internalSport === 'nfl' || internalSport === 'afl') {
              const periodLabel = period > 0 ? `Q${period}` : '';
              displayMinute = displayClock ? `${periodLabel} ${displayClock}`.trim() : periodLabel || 'LIVE';
              minute = period;
            } else if (internalSport === 'hockey' || internalSport === 'ice-hockey') {
              const periodLabel = period > 0 ? `P${period}` : '';
              displayMinute = displayClock ? `${periodLabel} ${displayClock}`.trim() : periodLabel || 'LIVE';
              minute = period;
            } else if (internalSport === 'baseball') {
              displayMinute = displayClock || (period > 0 ? `Inn ${period}` : 'LIVE');
              minute = period;
            } else {
              displayMinute = displayClock || desc || 'LIVE';
              minute = period;
            }
          }

          const homeScore = home.score !== undefined ? Number(home.score) : undefined;
          const awayScore = away.score !== undefined ? Number(away.score) : undefined;
          const score =
            homeScore !== undefined && awayScore !== undefined ? `${homeScore}-${awayScore}` : undefined;

          const startTime = ev.date || comp.date || new Date().toISOString();

          // Resolve participant names. For combat sports (MMA/UFC/Boxing) ESPN
          // uses competitor.athlete.displayName instead of competitor.team.displayName.
          // For tournaments (Tennis/Golf) and races (F1) there are no head-to-head
          // competitors at all — fall back to the event name itself.
          const homeAthlete = home.athlete || {};
          const awayAthlete = away.athlete || {};
          let homeName = homeTeamObj.displayName || homeTeamObj.name || homeAthlete.displayName || homeAthlete.shortName || '';
          let awayName = awayTeamObj.displayName || awayTeamObj.name || awayAthlete.displayName || awayAthlete.shortName || '';

          // Individual / tournament sports: no team OR no competitors at all
          const isIndividualEvent = !homeName || !awayName || competitors.length < 2;
          const evNameStr = String(ev.name || '').trim();
          const evShortStr = String(ev.shortName || '').trim();
          if (isIndividualEvent) {
            // Try to parse "X vs Y" / "X vs. Y" out of event.name (e.g. "UFC Fight Night: Della Maddalena vs. Prates")
            const vsMatch = evNameStr.match(/(?::|^)\s*(.+?)\s+vs\.?\s+(.+?)\s*$/i);
            if (vsMatch) {
              homeName = vsMatch[1].trim();
              awayName = vsMatch[2].trim();
            } else {
              // No vs in name → race / tournament. Use the event name as the "home" label
              // and a sensible secondary string as "away" so UI keeps a 2-line layout.
              homeName = evNameStr || evShortStr || humanLeague || internalSport;
              awayName = humanLeague || internalSport;
            }
          }

          // Final guard against literal "Home" / "Away" placeholders.
          if (!homeName || /^home$/i.test(homeName)) homeName = evNameStr || humanLeague || 'Event';
          if (!awayName || /^away$/i.test(awayName)) awayName = humanLeague || internalSport;

          const event: SportEvent = {
            id: String(ev.id),
            sportId,
            leagueName: humanLeague || leagueMeta.name || internalSport,
            leagueId: leagueMeta.id,
            leagueSlug: leagueMeta.slug,
            homeTeam: homeName,
            awayTeam: awayName,
            eventTitle: ev.name || `${homeName} vs ${awayName}`,
            homeLogo: homeTeamObj.logo,
            awayLogo: awayTeamObj.logo,
            startTime,
            status: normalizedStatus,
            isLive,
            markets: [],
            dataSource: 'espn',
            oddsSource: 'live-api',
            ...(score ? { score } : {}),
            ...(minute !== undefined ? { minute } : {}),
            ...(displayMinute ? { displayMinute } : {}),
            ...(status.clock !== undefined && isLive ? { clockSeconds: Number(status.clock) } : {}),
            ...(homeScore !== undefined ? { homeScore } : {}),
            ...(awayScore !== undefined ? { awayScore } : {}),
            _sportId: sportId,
            _sportName: internalSport,
          };
          return event;
        } catch (e) {
          return null;
        }
      })
      .filter((e): e is SportEvent => e !== null);
  }

  // ---------- TheSportsDB fallback ----------

  private tsdbSportName(internalSport: string): string | null {
    switch (internalSport) {
      case 'handball':
        return 'Handball';
      case 'volleyball':
        return 'Volleyball';
      case 'boxing':
        return 'Boxing';
      case 'cricket':
        return 'Cricket';
      default:
        return null;
    }
  }

  private async fetchTheSportsDB(
    internalSport: string,
    includeNextDays: number,
    includePastDays: number,
  ): Promise<SportEvent[]> {
    const tsdbName = this.tsdbSportName(internalSport);
    if (!tsdbName) return [];

    const dates: string[] = [];
    for (let d = -includePastDays; d <= Math.max(0, includeNextDays); d++) {
      const dt = new Date();
      dt.setUTCDate(dt.getUTCDate() + d);
      dates.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`);
    }
    if (dates.length === 0) {
      const dt = new Date();
      dates.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`);
    }

    const all: SportEvent[] = [];
    for (const date of dates) {
      try {
        await new Promise((r) => setTimeout(r, 300)); // avoid TSDB 429
        const resp = await HTTP.get(`${TSDB_BASE}/eventsday.php`, { params: { d: date, s: tsdbName } });
        const evs = resp.data?.events || [];
        for (const e of evs) {
          const startTime = e.strTimestamp || `${e.dateEvent}T${e.strTime || '00:00:00'}Z`;
          const statusRaw: string = String(e.strStatus || '').toUpperCase();
          let status: SportEvent['status'] = 'scheduled';
          let isLive = false;
          if (statusRaw === 'FT' || statusRaw === 'AET' || statusRaw === 'AP' || statusRaw === 'FINISHED') status = 'finished';
          else if (statusRaw === 'NS' || statusRaw === '' || statusRaw === 'TBD') status = 'scheduled';
          else {
            status = 'live';
            isLive = true;
          }
          const homeScore = e.intHomeScore != null ? Number(e.intHomeScore) : undefined;
          const awayScore = e.intAwayScore != null ? Number(e.intAwayScore) : undefined;

          all.push({
            id: `tsdb:${e.idEvent}`,
            sportId: INTERNAL_SPORT_ID[internalSport] ?? 0,
            leagueName: e.strLeague || tsdbName,
            leagueId: e.idLeague,
            homeTeam: e.strHomeTeam || 'Home',
            awayTeam: e.strAwayTeam || 'Away',
            eventTitle: e.strEvent || `${e.strHomeTeam} vs ${e.strAwayTeam}`,
            homeLogo: e.strHomeTeamBadge,
            awayLogo: e.strAwayTeamBadge,
            startTime,
            status,
            isLive,
            markets: [],
            dataSource: 'thesportsdb',
            oddsSource: 'live-api',
            ...(homeScore !== undefined && awayScore !== undefined ? { score: `${homeScore}-${awayScore}` } : {}),
            ...(homeScore !== undefined ? { homeScore } : {}),
            ...(awayScore !== undefined ? { awayScore } : {}),
            _sportId: INTERNAL_SPORT_ID[internalSport] ?? 0,
            _sportName: internalSport,
          });
        }
      } catch (err: any) {
        console.warn(`[tsdb] day ${date}/${tsdbName} failed:`, err?.message || err);
      }
    }
    return all;
  }

  /** Lists every internal sport supported by this service. */
  getSupportedSports(): string[] {
    return [
      ...Object.keys(ESPN_LEAGUE_MAP),
      'handball',
      'volleyball',
      'boxing',
    ];
  }

  /** Diagnostic: returns counts per league for a sport, used by the
   *  /api/sports/free/health endpoint. */
  async health(sport: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const leagues = ESPN_LEAGUE_MAP[sport.toLowerCase()] || [];
    for (const lg of leagues) {
      try {
        const board = await this.fetchEspn(lg.sport, lg.league, null);
        out[`${lg.sport}/${lg.league}`] = (board.events || []).length;
      } catch (e: any) {
        out[`${lg.sport}/${lg.league}`] = -1;
      }
    }
    return out;
  }
}

export const espnSportsService = new EspnSportsService();
