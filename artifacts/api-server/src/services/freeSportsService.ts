import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SportEvent, MarketData, OutcomeData } from '../types/betting';
import { mmaApiService } from './mmaApiService';

function extractNumericScore(raw: any): number {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return parseInt(raw, 10) || 0;
  if (typeof raw === 'object') {
    if (raw.total != null) {
      const t = typeof raw.total === 'number' ? raw.total : parseInt(raw.total, 10);
      if (!isNaN(t)) return t;
    }
    if (raw.score != null) {
      const s = typeof raw.score === 'number' ? raw.score : parseInt(raw.score, 10);
      if (!isNaN(s)) return s;
    }
    if (raw.points != null) {
      const p = typeof raw.points === 'number' ? raw.points : parseInt(raw.points, 10);
      if (!isNaN(p)) return p;
    }
    const periodKeys = Object.keys(raw).filter(k =>
      k !== 'total' && k !== 'score' && k !== 'points' && k !== 'hits' && k !== 'errors' &&
      k !== 'innings' && k !== 'extra'
    );
    let sum = 0; let hasAny = false;
    for (const k of periodKeys) {
      const v = raw[k];
      if (v != null && typeof v === 'number') { sum += v; hasAny = true; }
      else if (v != null && typeof v === 'string') { const n = parseInt(v, 10); if (!isNaN(n)) { sum += n; hasAny = true; } }
    }
    if (hasAny) return sum;
  }
  return 0;
}

/**
 * PAID SPORTS SERVICE (Upgraded from Free)
 * Handles all sports EXCEPT football (which uses paid API via apiSportsService)
 * 
 * Strategy (ULTRA PLAN - all sports paid):
 * - Fetch upcoming matches every 2 hours (was once/day)
 * - Fetch results every 2 hours for fast settlement (was once/day at 11PM)
 * - Fetch REAL odds from API-Sports (was generated/fake odds)
 * - Live events handled separately by apiSportsService.getLiveEvents()
 * - File-based cache persistence to survive restarts
 */

// Type for finished match results (used for settlement)
export interface FreeSportsResult {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: 'home' | 'away' | 'draw';
  status: string;
}

// Cache file paths for persistence across restarts
// Use project directory data/ (survives Railway deploys) with /tmp as fallback
const DATA_DIR = path.join(process.cwd(), 'data');
let CACHE_DIR = '/tmp';
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
  CACHE_DIR = DATA_DIR;
} catch {}
const CACHE_DATE_FILE = path.join(CACHE_DIR, 'free_sports_cache_date.txt');
const CACHE_DATA_FILE = path.join(CACHE_DIR, 'free_sports_cache_data.json');
console.log(`[Sports] Cache directory: ${CACHE_DIR}`);

// Cached data for free sports
let cachedFreeSportsEvents: SportEvent[] = [];
let cachedFinishedResults: FreeSportsResult[] = [];
let lastFetchTime: number = 0;
let lastResultsFetchTime: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours cache

// Per-day locks to prevent duplicate fetches (stores YYYY-MM-DD)
let lastUpcomingFetchDate: string = '';
let lastResultsFetchDate: string = '';

const SEED_DATA_FILE = path.join(process.cwd(), 'server', 'data', 'free_sports_seed.json');

const SAFE_EXTRA_MARKET_IDS: Record<string, Set<number>> = {
  basketball: new Set([4, 7, 12]),
  'ice-hockey': new Set([4, 5, 9]),
  baseball: new Set([9, 14]),
  handball: new Set([7]),
  volleyball: new Set([4, 7]),
  rugby: new Set([4, 5]),
  'american-football': new Set([4]),
  afl: new Set([4]),
};

function sanitizeEventMarkets(events: SportEvent[]): void {
  for (const event of events) {
    if (!event.markets || event.markets.length <= 1) continue;
    const sportSlug = extractSportSlug(event.id);
    if (!sportSlug) continue;
    const allowedIds = SAFE_EXTRA_MARKET_IDS[sportSlug];
    if (!allowedIds) {
      event.markets = event.markets.filter(m => m.id === 'match_winner');
      continue;
    }
    event.markets = event.markets.filter(m => {
      if (m.id === 'match_winner') return true;
      const apiIdMatch = m.id?.match(/^api_(\d+)$/);
      if (!apiIdMatch) return true;
      return allowedIds.has(parseInt(apiIdMatch[1], 10));
    });
  }
}

function extractSportSlug(eventId: string): string | null {
  const match = eventId?.match(/^([a-z-]+)_api_/);
  return match ? match[1] : null;
}

function loadCacheFromFile(): void {
  try {
    if (fs.existsSync(CACHE_DATE_FILE)) {
      lastUpcomingFetchDate = fs.readFileSync(CACHE_DATE_FILE, 'utf8').trim();
    }
    if (fs.existsSync(CACHE_DATA_FILE)) {
      const data = fs.readFileSync(CACHE_DATA_FILE, 'utf8');
      cachedFreeSportsEvents = JSON.parse(data);
      sanitizeEventMarkets(cachedFreeSportsEvents);
      lastFetchTime = Date.now();
      console.log(`[Sports] Loaded ${cachedFreeSportsEvents.length} events from file cache (date: ${lastUpcomingFetchDate})`);
      return;
    }
  } catch (err: any) {
    console.warn(`[Sports] Could not load cache from file: ${err.message}`);
  }

  try {
    if (cachedFreeSportsEvents.length === 0 && fs.existsSync(SEED_DATA_FILE)) {
      const data = fs.readFileSync(SEED_DATA_FILE, 'utf8');
      const seedEvents = JSON.parse(data);
      const now = Date.now();
      const futureEvents = seedEvents.filter((e: any) => {
        if (!e.startTime) return false;
        return new Date(e.startTime).getTime() > now;
      });
      cachedFreeSportsEvents = futureEvents;
      sanitizeEventMarkets(cachedFreeSportsEvents);
      lastFetchTime = Date.now();
      console.log(`[Sports] Loaded ${futureEvents.length} events from seed file (${seedEvents.length} total, filtered to future only)`);
    }
  } catch (err: any) {
    console.warn(`[Sports] Could not load seed file: ${err.message}`);
  }
}

// ULTRA API SAVING: Save cache to file
function saveCacheToFile(): void {
  try {
    fs.writeFileSync(CACHE_DATE_FILE, lastUpcomingFetchDate);
    fs.writeFileSync(CACHE_DATA_FILE, JSON.stringify(cachedFreeSportsEvents));
    try {
      fs.writeFileSync(SEED_DATA_FILE, JSON.stringify(cachedFreeSportsEvents));
      console.log(`[Sports] Updated seed file with ${cachedFreeSportsEvents.length} events`);
    } catch {}
  } catch (err: any) {
    console.warn(`[Sports] Could not save cache to file: ${err.message}`);
  }
}

// Load cache on module init
loadCacheFromFile();

// Helper to get current UTC date string
const getUTCDateString = (): string => new Date().toISOString().split('T')[0];

// Free sports configuration - ALL available API-Sports APIs
const FREE_SPORTS_CONFIG: Record<string, {
  endpoint: string;
  apiHost: string;
  sportId: number;
  name: string;
  hasDraws: boolean;
  daysAhead: number;
}> = {
  basketball: {
    endpoint: 'https://v1.basketball.api-sports.io/games',
    apiHost: 'v1.basketball.api-sports.io',
    sportId: 2,
    name: 'Basketball',
    hasDraws: false,
    daysAhead: 3
  },
  baseball: {
    endpoint: 'https://v1.baseball.api-sports.io/games',
    apiHost: 'v1.baseball.api-sports.io',
    sportId: 5,
    name: 'Baseball',
    hasDraws: false,
    daysAhead: 3
  },
  'ice-hockey': {
    endpoint: 'https://v1.hockey.api-sports.io/games',
    apiHost: 'v1.hockey.api-sports.io',
    sportId: 6,
    name: 'Ice Hockey',
    hasDraws: false,
    daysAhead: 3
  },
  mma: {
    endpoint: 'https://v1.mma.api-sports.io/fights',
    apiHost: 'v1.mma.api-sports.io',
    sportId: 7,
    name: 'MMA',
    hasDraws: false,
    daysAhead: 7
  },
  'american-football': {
    endpoint: 'https://v1.american-football.api-sports.io/games',
    apiHost: 'v1.american-football.api-sports.io',
    sportId: 4,
    name: 'American Football',
    hasDraws: false,
    daysAhead: 14
  },
  afl: {
    endpoint: 'https://v1.afl.api-sports.io/games',
    apiHost: 'v1.afl.api-sports.io',
    sportId: 10,
    name: 'AFL',
    hasDraws: true,
    daysAhead: 3
  },
  handball: {
    endpoint: 'https://v1.handball.api-sports.io/games',
    apiHost: 'v1.handball.api-sports.io',
    sportId: 12,
    name: 'Handball',
    hasDraws: true,
    daysAhead: 3
  },
  rugby: {
    endpoint: 'https://v1.rugby.api-sports.io/games',
    apiHost: 'v1.rugby.api-sports.io',
    sportId: 15,
    name: 'Rugby',
    hasDraws: true,
    daysAhead: 7
  },
  volleyball: {
    endpoint: 'https://v1.volleyball.api-sports.io/games',
    apiHost: 'v1.volleyball.api-sports.io',
    sportId: 16,
    name: 'Volleyball',
    hasDraws: false,
    daysAhead: 3
  },
  'formula-1': {
    endpoint: 'https://v1.formula-1.api-sports.io/races',
    apiHost: 'v1.formula-1.api-sports.io',
    sportId: 11,
    name: 'Formula 1',
    hasDraws: false,
    daysAhead: 14
  },
};


const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const CRICBUZZ_BASE_URL = 'https://free-cricbuzz-cricket-api.p.rapidapi.com';
const CRICKET_SPORT_ID = 18;
const HORSE_RACING_SPORT_ID = 17;
const RACING_API_BASE = 'https://the-racing-api1.p.rapidapi.com';
const RACING_API_HOST = 'the-racing-api1.p.rapidapi.com';

const MMA_ORGANIZATIONS = new Set([
  'ufc', 'bellator', 'one championship', 'one fc', 'pfl', 'cage warriors',
  'ksw', 'rizin', 'invicta', 'lfa', 'bkfc', 'eagle fc', 'ares', 'oktagon'
]);

function isBoxingFight(game: any): boolean {
  const slug = (game.slug || '').toLowerCase();
  const category = (game.category || '').toLowerCase();
  
  if (slug.includes('boxing') || slug.includes('pbc') || slug.includes('showtime') ||
      slug.includes('dazn boxing') || slug.includes('top rank') || slug.includes('golden boy') ||
      slug.includes('matchroom') || slug.includes('wbc') || slug.includes('wba') ||
      slug.includes('ibf') || slug.includes('wbo') || slug.includes('ring magazine')) {
    return true;
  }
  
  for (const org of MMA_ORGANIZATIONS) {
    if (slug.includes(org)) return false;
  }
  
  if (category.includes('boxing') || category.includes('heavyweight') && !slug.includes('ufc') && !slug.includes('mma')) {
    return true;
  }
  
  return false;
}

const F1_2026_DRIVERS = [
  { name: 'Max Verstappen', team: 'Red Bull Racing', number: 1, rating: 98 },
  { name: 'Lando Norris', team: 'McLaren', number: 4, rating: 93 },
  { name: 'Charles Leclerc', team: 'Ferrari', number: 16, rating: 91 },
  { name: 'Oscar Piastri', team: 'McLaren', number: 81, rating: 89 },
  { name: 'Carlos Sainz', team: 'Williams', number: 55, rating: 88 },
  { name: 'Lewis Hamilton', team: 'Ferrari', number: 44, rating: 90 },
  { name: 'George Russell', team: 'Mercedes', number: 63, rating: 87 },
  { name: 'Andrea Kimi Antonelli', team: 'Mercedes', number: 12, rating: 82 },
  { name: 'Fernando Alonso', team: 'Aston Martin', number: 14, rating: 84 },
  { name: 'Lance Stroll', team: 'Aston Martin', number: 18, rating: 72 },
  { name: 'Pierre Gasly', team: 'Alpine', number: 10, rating: 78 },
  { name: 'Jack Doohan', team: 'Alpine', number: 7, rating: 70 },
  { name: 'Yuki Tsunoda', team: 'RB', number: 22, rating: 77 },
  { name: 'Isack Hadjar', team: 'RB', number: 6, rating: 68 },
  { name: 'Alexander Albon', team: 'Williams', number: 23, rating: 80 },
  { name: 'Nico Hulkenberg', team: 'Sauber', number: 27, rating: 75 },
  { name: 'Gabriel Bortoleto', team: 'Sauber', number: 5, rating: 67 },
  { name: 'Esteban Ocon', team: 'Haas', number: 31, rating: 76 },
  { name: 'Oliver Bearman', team: 'Haas', number: 87, rating: 69 },
  { name: 'Liam Lawson', team: 'Red Bull Racing', number: 30, rating: 74 },
];

function generateF1DriverMarkets(raceId: string): { markets: any[], runnersInfo: any[], raceDetails: any } {
  const drivers = [...F1_2026_DRIVERS];
  const raceSeed = raceId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const seededRand = (offset: number) => { const x = Math.sin(Math.abs(raceSeed) + offset) * 10000; return x - Math.floor(x); };

  const rawScores = drivers.map((d, i) => {
    const jitter = (seededRand(i * 7 + 3) - 0.5) * 15;
    return Math.max(10, d.rating + jitter);
  });
  const rawPowers = rawScores.map(s => Math.pow(s, 3.5));
  const totalPower = rawPowers.reduce((s, v) => s + v, 0);
  const OVERROUND = 1.25;

  const winOutcomes: OutcomeData[] = drivers.map((d, i) => {
    const fairProb = rawPowers[i] / totalPower;
    const jitter = (seededRand(i * 13 + 7) - 0.5) * 0.005;
    const adjProb = Math.max(0.008, Math.min(0.45, fairProb + jitter));
    const bookedProb = adjProb * OVERROUND;
    const odds = parseFloat(Math.max(1.50, Math.min(51.00, 1 / bookedProb)).toFixed(2));
    return { id: `driver_${d.number}`, name: d.name, odds, probability: 1 / odds };
  });
  winOutcomes.sort((a, b) => a.odds - b.odds);

  const placeOutcomes: OutcomeData[] = winOutcomes.map(w => {
    const placeOdds = parseFloat(Math.max(1.10, ((w.odds - 1) / 3.0) + 1).toFixed(2));
    return { id: w.id, name: w.name, odds: placeOdds, probability: 1 / placeOdds };
  });

  const podiumOutcomes: OutcomeData[] = winOutcomes.map(w => {
    const showOdds = parseFloat(Math.max(1.05, ((w.odds - 1) / 5.0) + 1).toFixed(2));
    return { id: w.id, name: w.name, odds: showOdds, probability: 1 / showOdds };
  });

  const markets = [
    { id: 'race_winner', name: 'Win', outcomes: winOutcomes },
    { id: 'race_place', name: 'Top 2', outcomes: placeOutcomes },
    { id: 'race_show', name: 'Podium', outcomes: podiumOutcomes },
  ];

  const driverMap = new Map(drivers.map(d => [`driver_${d.number}`, d]));
  const runnersInfo = winOutcomes.map(w => {
    const d = driverMap.get(w.id);
    return {
      name: w.name,
      number: d?.number || 0,
      jockey: d?.team || '',
      trainer: '',
      form: '',
    };
  });

  return {
    markets,
    runnersInfo,
    raceDetails: { fieldSize: drivers.length, surface: 'Circuit', distance: '', going: '', prize: '' },
  };
}

// API key
const API_KEY = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';

export class FreeSportsService {
  private isRunning: boolean = false;
  private morningSchedulerInterval: NodeJS.Timeout | null = null;
  private nightSchedulerInterval: NodeJS.Timeout | null = null;
  private retryInterval: NodeJS.Timeout | null = null;

  /**
   * Start the daily schedulers
   * - Morning (6 AM UTC): Fetch upcoming matches
   * - Night (11 PM UTC): Fetch results for settlement
   */
  startSchedulers(): void {
    if (this.isRunning) {
      console.log('[Sports] Schedulers already running');
      return;
    }

    this.isRunning = true;
    console.log('[Sports] Starting PAID Ultra schedulers for all sports');
    console.log('[Sports] Sports: basketball, baseball, ice-hockey, mma, american-football, afl, formula-1, handball, rugby, volleyball, cricket');
    console.log('[Sports] Schedule: Upcoming every 2h, Results every 2h (Ultra plan)');

    // Initial fetch on startup (always fetch fresh on startup for Ultra plan)
    console.log(`[Sports] Initial fetch of upcoming matches (cache: ${cachedFreeSportsEvents.length} events)...`);
    this.fetchAllUpcomingMatches().then(() => {
      this.startRetryLoop();
    }).catch(err => {
      console.error('[Sports] Initial fetch failed:', err.message);
      this.startRetryLoop();
    });

    // ULTRA PLAN: Fetch upcoming events every 2 hours for fresh data
    this.morningSchedulerInterval = setInterval(() => {
      const cacheAgeMs = Date.now() - lastFetchTime;
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      if (cacheAgeMs >= TWO_HOURS) {
        console.log(`[Sports] Scheduled upcoming refresh (cache age: ${Math.round(cacheAgeMs / 60000)}min)`);
        this.fetchAllUpcomingMatches().catch(err => {
          console.error('[Sports] Scheduled upcoming fetch failed:', err.message);
        });
      }
    }, 30 * 60 * 1000); // Check every 30 minutes

    // ULTRA PLAN: Fetch results every 2 hours for fast settlement
    this.nightSchedulerInterval = setInterval(() => {
      const cacheAgeResults = Date.now() - lastResultsFetchTime;
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      if (cacheAgeResults >= TWO_HOURS) {
        console.log(`[Sports] Scheduled results fetch for settlement (age: ${Math.round(cacheAgeResults / 60000)}min)`);
        this.fetchAllResults().catch(err => {
          console.error('[Sports] Scheduled results fetch failed:', err.message);
        });
      }
    }, 30 * 60 * 1000); // Check every 30 minutes

    // Initial results fetch 2 minutes after startup
    setTimeout(() => {
      console.log('[Sports] Initial results fetch for settlement...');
      this.fetchAllResults().catch(err => {
        console.error('[Sports] Initial results fetch failed:', err.message);
      });
    }, 2 * 60 * 1000);

    console.log('[Sports] ✅ Ultra plan schedulers started');
  }

  private retryCount = 0;
  private static MAX_RETRIES = 10;

  private startRetryLoop(): void {
    if (this.retryInterval) return;
    this.retryCount = 0;
    console.log('[Sports] ⏰ Starting retry loop (every 3 minutes until data loads, max 10 retries)');
    this.retryInterval = setInterval(async () => {
      this.retryCount++;
      if (this.retryCount > FreeSportsService.MAX_RETRIES) {
        console.log(`[Sports] ⚠️ Retry loop: max retries reached (${FreeSportsService.MAX_RETRIES}), stopping`);
        if (this.retryInterval) { clearInterval(this.retryInterval); this.retryInterval = null; }
        return;
      }
      if (cachedFreeSportsEvents.length > 0) {
        const sportCounts = new Map<number, number>();
        for (const e of cachedFreeSportsEvents) {
          sportCounts.set(e.sportId, (sportCounts.get(e.sportId) || 0) + 1);
        }
        const alwaysAvailableSports = [2, 5, 6, 12, 16];
        const missingSports = alwaysAvailableSports.filter(id => !sportCounts.has(id));
        if (missingSports.length === 0) {
          console.log(`[Sports] ✅ Retry loop: core sports loaded (${cachedFreeSportsEvents.length} events, ${sportCounts.size} sports), stopping retries`);
          if (this.retryInterval) { clearInterval(this.retryInterval); this.retryInterval = null; }
          return;
        }
        console.log(`[Sports] 🔄 Retry ${this.retryCount}: ${missingSports.length} core sports still missing (IDs: ${missingSports.join(',')}), refetching...`);
      } else {
        console.log(`[Sports] 🔄 Retry ${this.retryCount}: cache empty, attempting full fetch...`);
      }
      try {
        await this.fetchAllUpcomingMatches();
        if (cachedFreeSportsEvents.length > 0) {
          console.log(`[Sports] ✅ Retry succeeded: ${cachedFreeSportsEvents.length} events loaded`);
        }
      } catch (err: any) {
        console.error('[Sports] Retry failed:', err.message);
      }
    }, 3 * 60 * 1000);
  }

  /**
   * Stop the schedulers
   */
  stopSchedulers(): void {
    if (this.morningSchedulerInterval) {
      clearInterval(this.morningSchedulerInterval);
      this.morningSchedulerInterval = null;
    }
    if (this.nightSchedulerInterval) {
      clearInterval(this.nightSchedulerInterval);
      this.nightSchedulerInterval = null;
    }
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
    this.isRunning = false;
    console.log('[Sports] Schedulers stopped');
  }

  /**
   * Fetch upcoming matches for all free sports
   */
  async fetchAllUpcomingMatches(): Promise<SportEvent[]> {
    console.log('[Sports] 📅 Fetching upcoming matches for all sports...');
    
    const allEvents: SportEvent[] = [];

    for (const [sportSlug, config] of Object.entries(FREE_SPORTS_CONFIG)) {
      try {
        let sportEvents: SportEvent[] = [];
        const daysToFetch = config.daysAhead || 2;
        let sportRateLimited = false;
        
        const maxDays = sportSlug === 'formula-1' ? 1 : daysToFetch;
        for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
          if (sportRateLimited) break;
          
          const fetchDate = new Date();
          fetchDate.setUTCDate(fetchDate.getUTCDate() + dayOffset);
          
          try {
            const dayEvents = await this.fetchUpcomingForSingleDate(sportSlug, config, fetchDate);
            sportEvents.push(...dayEvents);
          } catch (dayErr: any) {
            if (dayErr.response?.status === 429) {
              console.warn(`[Sports] Rate limited for ${config.name} day+${dayOffset}, skipping remaining days for this sport`);
              sportRateLimited = true;
              break;
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        const seenIds = new Set<string>();
        sportEvents = sportEvents.filter(e => {
          const id = String(e.id);
          if (seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        });
        
        if (sportEvents.length === 0) {
          console.log(`[Sports] ${config.name}: API returned 0 events (off-season or no scheduled games)`);
        }

        if (sportSlug === 'mma') {
          const mmaCount = sportEvents.filter(e => e.sportId === 7).length;
          const boxingCount = sportEvents.filter(e => e.sportId === 8).length;
          if (boxingCount > 0) {
            console.log(`[Sports] MMA: ${mmaCount} fights, Boxing: ${boxingCount} fights (${daysToFetch} days)`);
          } else {
            console.log(`[Sports] ${config.name}: ${sportEvents.length} upcoming matches (${daysToFetch} days)`);
          }
        } else {
          console.log(`[Sports] ${config.name}: ${sportEvents.length} upcoming matches (${daysToFetch} days)`);
        }
        allEvents.push(...sportEvents);
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[Sports] Error fetching ${config.name}:`, error.message);
      }
    }

    try {
      const cricketEvents = await this.fetchCricketMatches();
      if (cricketEvents.length > 0) {
        allEvents.push(...cricketEvents);
      }
    } catch (error: any) {
      console.error(`[Sports] Cricket fetch error:`, error.message);
    }

    try {
      const horseRacingEvents = await this.fetchHorseRacing();
      if (horseRacingEvents.length > 0) {
        allEvents.push(...horseRacingEvents);
      }
    } catch (error: any) {
      console.error(`[Sports] Horse Racing fetch error:`, error.message);
    }

    // MotoGP, Boxing, Tennis, WWE, F1 fake generators REMOVED — no fabricated matchups allowed
    // These sports will only show data when real APIs provide it

    try {
      await mmaApiService.refreshCache();
      const realMMAEvents = mmaApiService.getUpcomingEvents();
      if (realMMAEvents.length > 0) {
        allEvents.push(...realMMAEvents);
        console.log(`[Sports] 🥋 UFC/MMA Real API: ${realMMAEvents.length} upcoming fights from API`);
      } else {
        console.log(`[Sports] 🥋 UFC/MMA: No real events from API — no fake fallback`);
      }
    } catch (error: any) {
      console.error(`[Sports] UFC/MMA fetch error:`, error.message);
    }

    sanitizeEventMarkets(allEvents);
    cachedFreeSportsEvents = allEvents;
    lastUpcomingFetchDate = getUTCDateString();
    lastFetchTime = Date.now();
    saveCacheToFile();
    console.log(`[Sports] ✅ Cache updated: ${allEvents.length} total events`);

    return allEvents;
  }

  /**
   * Fetch results for settlement - includes team names for matching
   */
  async fetchAllResults(): Promise<FreeSportsResult[]> {
    console.log('[Sports] 🌙 Fetching results for settlement...');
    
    const results: FreeSportsResult[] = [];
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const datesToCheck = [todayStr, yesterdayStr];

    for (const [sportSlug, config] of Object.entries(FREE_SPORTS_CONFIG)) {
      if (sportSlug === 'formula-1') continue;
      try {
        for (const dateStr of datesToCheck) {
          const response = await axios.get(config.endpoint, {
            params: {
              date: dateStr,
              timezone: 'UTC'
            },
            headers: {
              'x-apisports-key': API_KEY,
              'Accept': 'application/json'
            },
            timeout: 10000
          });

          const games = response.data?.response || [];
          
          for (const game of games) {
            const status = game.status?.long || game.status?.short || '';
            const isFinished = status.toLowerCase().includes('finished') || 
                              status.toLowerCase().includes('final') ||
                              status === 'FT' || status === 'AET' || status === 'PEN';
            
            if (isFinished) {
              let homeTeam = '';
              let awayTeam = '';
              
              if (sportSlug === 'mma' || sportSlug === 'boxing') {
                homeTeam = game.fighters?.home?.name || game.fighters?.first?.name || game.home?.name || 'Fighter 1';
                awayTeam = game.fighters?.away?.name || game.fighters?.second?.name || game.away?.name || 'Fighter 2';
              } else if (sportSlug === 'tennis') {
                homeTeam = game.players?.home?.name || game.teams?.home?.name || game.home?.name || 'Player 1';
                awayTeam = game.players?.away?.name || game.teams?.away?.name || game.away?.name || 'Player 2';
              } else {
                homeTeam = game.teams?.home?.name || game.home?.name || 'Home';
                awayTeam = game.teams?.away?.name || game.away?.name || 'Away';
              }
              
              const homeScore = extractNumericScore(game.scores?.home);
              const awayScore = extractNumericScore(game.scores?.away);
              const resolvedGameId = game.id ?? game.game?.id;
              if (!resolvedGameId) continue;
              const eventId = `${sportSlug}_api_${resolvedGameId}`;
              
              const alreadyAdded = results.some(r => r.eventId === eventId);
              if (!alreadyAdded) {
                results.push({
                  eventId,
                  homeTeam,
                  awayTeam,
                  homeScore: typeof homeScore === 'number' ? homeScore : parseInt(homeScore) || 0,
                  awayScore: typeof awayScore === 'number' ? awayScore : parseInt(awayScore) || 0,
                  winner: homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw',
                  status: 'finished'
                });
              }
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        console.log(`[Sports] ${config.name}: ${results.length} finished games (today+yesterday)`);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[Sports] Error fetching results for ${config.name}:`, error.message);
      }
    }

    lastResultsFetchTime = Date.now();
    lastResultsFetchDate = getUTCDateString();
    cachedFinishedResults = results;
    console.log(`[Sports] ✅ Total: ${results.length} finished games for settlement (locked until ${lastResultsFetchDate})`);
    
    if (results.length > 0) {
      this.triggerSettlement(results);
    }
    
    return results;
  }
  
  /**
   * Trigger settlement worker to process free sports results
   */
  private async triggerSettlement(results: FreeSportsResult[]): Promise<void> {
    try {
      // Import settlement worker dynamically to avoid circular dependencies
      const { settlementWorker } = await import('./settlementWorker');
      
      console.log(`[Sports] 🎯 Triggering settlement for ${results.length} finished matches...`);
      await settlementWorker.processFreeSportsResults(results);
      console.log(`[Sports] ✅ Settlement triggered successfully`);
    } catch (error: any) {
      console.error(`[Sports] ❌ Failed to trigger settlement:`, error.message);
    }
  }

  /**
   * Fetch upcoming events for a single sport on a single date from the free API.
   * Called once per sport per day (max 3 days ahead).
   * Falls back to generated events if API returns 0 results.
   */
  private async fetchUpcomingForSingleDate(
    sportSlug: string,
    config: { endpoint: string; apiHost: string; sportId: number; name: string; hasDraws: boolean; daysAhead: number },
    date: Date
  ): Promise<SportEvent[]> {
    const dateStr = date.toISOString().split('T')[0];

    const headers: Record<string, string> = {
      'x-apisports-key': API_KEY,
      'Accept': 'application/json',
    };

    let params: Record<string, string | number> = {
      date: dateStr,
      timezone: 'UTC',
    };

    if (sportSlug === 'formula-1') {
      params = {
        season: date.getFullYear(),
        type: 'Race',
      };
    }

    const response = await axios.get(config.endpoint, {
      params,
      headers,
      timeout: 12000,
    });

    const games: any[] = response.data?.response || [];
    if (!games.length) return [];

    // ULTRA PLAN: Fetch real odds for this sport's games
    await this.enrichGamesWithRealOdds(games, sportSlug, config, headers);

    const events: SportEvent[] = [];

    for (const game of games) {
      try {
        const statusLong = (game.status?.long || '').toLowerCase();
        const statusShort = (game.status?.short || '');
        const partialKeywords = ['set', 'quarter', 'half', 'period', 'inning', 'round'];
        const isPartialStatus = partialKeywords.some(kw => statusLong.includes(kw));
        const isFinished = !isPartialStatus && (
          statusLong === 'finished' || statusLong === 'game finished' || statusLong === 'match finished' ||
          statusLong === 'ended' || statusLong === 'full time' ||
          statusShort === 'FT' || statusShort === 'AET' || statusShort === 'PEN' ||
          statusShort === 'AOT'
        );
        if (isFinished) continue;

        let homeTeam = '';
        let awayTeam = '';
        let startTime = '';
        let leagueName = '';
        let sportId = config.sportId;

        if (sportSlug === 'formula-1') {
          const circuitName = game.circuit?.name || 'Unknown Circuit';
          const raceType = game.type || 'Race';
          if (raceType !== 'Race') continue;
          const raceStatus = (game.status || '').toLowerCase();
          if (raceStatus === 'completed' || raceStatus === 'cancelled') continue;
          const raceDate = game.date ? new Date(game.date) : null;
          if (raceDate && raceDate.getTime() < Date.now()) continue;
          const gpName = game.competition?.name || 'Formula 1';
          homeTeam = circuitName.replace(/Grand Prix Circuit|Circuit|Circuito/gi, '').trim() + ' GP';
          awayTeam = `${F1_2026_DRIVERS.length} Drivers`;
          startTime = game.date || `${dateStr}T14:00:00Z`;
          leagueName = gpName;

          const gameId = game.id ?? game.game?.id;
          if (!gameId) continue;
          const f1Data = generateF1DriverMarkets(`f1_${gameId}_${circuitName}`);
          const f1Event: SportEvent = {
            id: `formula-1_api_${gameId}`,
            sportId: 11,
            leagueName,
            homeTeam,
            awayTeam,
            homeLogo: game.circuit?.image || '',
            awayLogo: '',
            leagueLogo: game.competition?.image || '',
            startTime,
            status: 'scheduled',
            isLive: false,
            markets: f1Data.markets,
            homeOdds: f1Data.markets[0]?.outcomes[0]?.odds || 3.0,
            awayOdds: f1Data.markets[0]?.outcomes[1]?.odds || 5.0,
            oddsSource: 'generated',
            runnersInfo: f1Data.runnersInfo,
            raceDetails: f1Data.raceDetails,
          } as SportEvent;
          events.push(f1Event);
          continue;
        } else if (sportSlug === 'mma') {
          if (isBoxingFight(game)) {
            sportId = 8;
          }
          homeTeam = game.fighters?.home?.name ||
            game.fighters?.first?.name ||
            (Array.isArray(game.fighters) ? game.fighters[0]?.name : '') ||
            'Fighter 1';
          awayTeam = game.fighters?.away?.name ||
            game.fighters?.second?.name ||
            (Array.isArray(game.fighters) ? game.fighters[1]?.name : '') ||
            'Fighter 2';
          startTime = game.date || `${dateStr}T20:00:00Z`;
          leagueName = game.league?.name || game.competition?.name || 'MMA';
        } else {
          homeTeam = game.teams?.home?.name || game.home?.name || 'Home Team';
          awayTeam = game.teams?.away?.name || game.away?.name || 'Away Team';
          startTime = game.date || `${dateStr}T12:00:00Z`;
          leagueName = game.league?.name || game.competition?.name || config.name;
          if (game.league?.country && !leagueName.includes(game.league.country)) {
            leagueName += ` (${game.league.country})`;
          }
        }

        if (!homeTeam || !awayTeam || homeTeam === awayTeam) continue;

        let hOdds: number;
        let aOdds: number;
        let drawOdds: number | undefined;
        let oddsSource = 'generated';

        const apiOdds = game._realOdds;
        if (apiOdds) {
          hOdds = apiOdds.homeOdds;
          aOdds = apiOdds.awayOdds;
          drawOdds = apiOdds.drawOdds ? Math.min(apiOdds.drawOdds, 4.00) : undefined;
          oddsSource = 'api-sports';
        } else {
          [hOdds, aOdds] = this.generateRealisticOdds(
            String(game.id || `${homeTeam}_${awayTeam}`), homeTeam, awayTeam, sportSlug, 0, 0
          );
          if (config.hasDraws) {
            const sportDrawRates: Record<string, [number, number]> = {
              'handball': [0.10, 0.18],
              'rugby': [0.04, 0.10],
              'afl': [0.02, 0.06],
            };
            const [dMin, dMax] = sportDrawRates[sportSlug] || [0.08, 0.15];
            const drawSeed = `${homeTeam}_${awayTeam}_draw`.split('').reduce((h: number, c: string) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
            const drawRand = Math.abs(Math.sin(drawSeed) * 10000) % 1;
            const drawProb = dMin + drawRand * (dMax - dMin);
            const remProb = 1 - drawProb;
            const rawHomeProb = 1 / hOdds;
            const rawAwayProb = 1 / aOdds;
            const rawTotal = rawHomeProb + rawAwayProb;
            const MARGIN = 1.05;
            hOdds = parseFloat(Math.max(1.20, Math.min(4.00, (MARGIN / (rawHomeProb / rawTotal * remProb)))).toFixed(2));
            aOdds = parseFloat(Math.max(1.20, Math.min(4.00, (MARGIN / (rawAwayProb / rawTotal * remProb)))).toFixed(2));
            drawOdds = parseFloat(Math.max(3.20, Math.min(4.00, (MARGIN / drawProb))).toFixed(2));
          }
        }

        const outcomes: OutcomeData[] = [
          { id: 'home', name: homeTeam, odds: hOdds, probability: 1 / hOdds },
          { id: 'away', name: awayTeam, odds: aOdds, probability: 1 / aOdds },
        ];
        if (drawOdds) {
          outcomes.push({ id: 'draw', name: 'Draw', odds: drawOdds, probability: 1 / drawOdds });
        }

        let homeLogo = '';
        let awayLogo = '';
        let leagueLogo = '';
        if (sportSlug === 'formula-1') {
          homeLogo = game.circuit?.image || '';
          awayLogo = '';
          leagueLogo = game.competition?.image || '';
        } else if (sportSlug === 'mma') {
          homeLogo = game.fighters?.home?.logo || game.fighters?.first?.logo || '';
          awayLogo = game.fighters?.away?.logo || game.fighters?.second?.logo || '';
        } else {
          homeLogo = game.teams?.home?.logo || '';
          awayLogo = game.teams?.away?.logo || '';
        }
        if (!leagueLogo) leagueLogo = game.league?.logo || '';

        const gameId = game.id ?? game.game?.id;
        if (!gameId) {
          console.warn(`[Sports] Skipping ${sportSlug} game with no ID: ${homeTeam} vs ${awayTeam}`);
          continue;
        }

        const allMarkets: any[] = [{ id: 'match_winner', name: 'Match Winner', outcomes }];
        if (game._extraMarkets && Array.isArray(game._extraMarkets)) {
          allMarkets.push(...game._extraMarkets);
        }

        const event: SportEvent = {
          id: `${sportSlug}_api_${gameId}`,
          sportId,
          leagueName,
          homeTeam,
          awayTeam,
          homeLogo,
          awayLogo,
          leagueLogo,
          startTime,
          status: 'scheduled',
          isLive: false,
          markets: allMarkets,
          homeOdds: hOdds,
          awayOdds: aOdds,
          ...(drawOdds !== undefined ? { drawOdds } : {}),
          oddsSource,
        } as SportEvent;

        events.push(event);
      } catch (parseErr: any) {
        console.warn(`[Sports] Error parsing ${sportSlug} game ${game?.id}:`, parseErr.message);
      }
    }

    console.log(`[Sports] API: ${config.name} on ${dateStr} → ${events.length} events`);
    return events;
  }

  private async enrichGamesWithRealOdds(
    games: any[],
    sportSlug: string,
    config: { endpoint: string; apiHost: string; sportId: number; name: string; hasDraws: boolean; daysAhead: number },
    headers: Record<string, string>
  ): Promise<void> {
    if (!API_KEY || games.length === 0) return;

    const ODDS_ENDPOINTS: Record<string, string> = {
      basketball: 'https://v1.basketball.api-sports.io/odds',
      baseball: 'https://v1.baseball.api-sports.io/odds',
      'ice-hockey': 'https://v1.hockey.api-sports.io/odds',
      handball: 'https://v1.handball.api-sports.io/odds',
      rugby: 'https://v1.rugby.api-sports.io/odds',
      volleyball: 'https://v1.volleyball.api-sports.io/odds',
      'american-football': 'https://v1.american-football.api-sports.io/odds',
      afl: 'https://v1.afl.api-sports.io/odds',
    };

    const oddsEndpoint = ODDS_ENDPOINTS[sportSlug];
    if (!oddsEndpoint) {
      return;
    }

    try {
      const MAJOR_LEAGUES = ['nba', 'nhl', 'mlb', 'nfl', 'euroleague', 'ncaa', 'premier league', 'la liga', 'bundesliga', 'serie a', 'champions league', 'ehf', 'cev'];
      const sortedGames = [...games].sort((a, b) => {
        const aLeague = (a.league?.name || '').toLowerCase();
        const bLeague = (b.league?.name || '').toLowerCase();
        const aIsMajor = MAJOR_LEAGUES.some(ml => aLeague.includes(ml)) ? 0 : 1;
        const bIsMajor = MAJOR_LEAGUES.some(ml => bLeague.includes(ml)) ? 0 : 1;
        return aIsMajor - bIsMajor;
      });
      const gameIds = sortedGames.slice(0, 20).map(g => g.id ?? g.game?.id).filter(Boolean);
      let enrichedCount = 0;

      const MATCH_WINNER_NAMES = new Set(['Match Winner', 'Home/Away', 'Winner', 'Money Line', 'Moneyline', '3Way Result', '1x2']);
      const USEFUL_BET_IDS: Record<string, number[]> = {
        basketball: [1, 2, 4, 7, 12],
        'ice-hockey': [1, 2, 4, 5, 9],
        baseball: [1, 2, 9, 14],
        handball: [1, 2, 7],
        volleyball: [1, 2, 4, 7],
        rugby: [1, 2, 4, 5],
        'american-football': [1, 2, 4],
        afl: [1, 2, 4],
      };
      const allowedBets = USEFUL_BET_IDS[sportSlug] || [1, 2, 4];

      for (const gameId of gameIds) {
        try {
          const oddsResp = await axios.get(oddsEndpoint, {
            params: { game: gameId },
            headers,
            timeout: 8000,
          });

          const oddsData = oddsResp.data?.response;
          if (!oddsData || !Array.isArray(oddsData) || oddsData.length === 0) continue;

          const bookmakers = oddsData[0]?.bookmakers;
          if (!bookmakers || !Array.isArray(bookmakers) || bookmakers.length === 0) continue;

          const bk = bookmakers[0];
          if (!bk.bets || !Array.isArray(bk.bets)) continue;

          const matchWinnerBet = bk.bets.find((b: any) => {
            const bid = typeof b.id === 'string' ? parseInt(b.id, 10) : b.id;
            return MATCH_WINNER_NAMES.has(b.name) || bid === 1 || bid === 2;
          });

          const game = games.find(g => (g.id ?? g.game?.id) === gameId);
          if (!game) continue;

          if (matchWinnerBet?.values && Array.isArray(matchWinnerBet.values)) {
            const homeVal = matchWinnerBet.values.find((v: any) => v.value === 'Home' || v.value === '1');
            const awayVal = matchWinnerBet.values.find((v: any) => v.value === 'Away' || v.value === '2');
            const drawVal = matchWinnerBet.values.find((v: any) => v.value === 'Draw' || v.value === 'X');

            if (homeVal?.odd && awayVal?.odd) {
              game._realOdds = {
                homeOdds: parseFloat(homeVal.odd),
                awayOdds: parseFloat(awayVal.odd),
                drawOdds: drawVal?.odd ? Math.min(parseFloat(drawVal.odd), 4.00) : undefined,
              };
              enrichedCount++;
            }
          }

          const extraMarkets: any[] = [];
          for (const bet of bk.bets) {
            if (!bet.values || !Array.isArray(bet.values) || bet.values.length === 0) continue;
            const betId = typeof bet.id === 'string' ? parseInt(bet.id, 10) : bet.id;
            if (MATCH_WINNER_NAMES.has(bet.name) || betId === 1 || betId === 2) continue;
            if (!allowedBets.includes(betId)) continue;

            const outcomes = bet.values
              .filter((v: any) => v.odd && parseFloat(v.odd) >= 1.01 && parseFloat(v.odd) <= 7.0)
              .slice(0, 8)
              .map((v: any, idx: number) => ({
                id: `${bet.id}_${idx}`,
                name: String(v.value || ''),
                odds: parseFloat(v.odd),
                probability: 1 / parseFloat(v.odd),
              }));

            if (outcomes.length >= 2) {
              extraMarkets.push({
                id: `api_${bet.id}`,
                name: bet.name,
                outcomes,
              });
            }
          }

          if (extraMarkets.length > 0) {
            game._extraMarkets = extraMarkets;
          }
        } catch (oddsErr: any) {
          if (oddsErr.response?.status === 429) {
            console.warn(`[Sports] Odds rate limited for ${config.name}, stopping odds fetch`);
            break;
          }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (enrichedCount > 0) {
        console.log(`[Sports] ${config.name}: ${enrichedCount}/${gameIds.length} games enriched with REAL odds from API-Sports`);
      }
    } catch (err: any) {
      console.warn(`[Sports] Failed to fetch odds for ${config.name}: ${err.message}`);
    }
  }

  private async fetchCricketMatches(): Promise<SportEvent[]> {
    if (!RAPIDAPI_KEY) {
      console.warn('[Sports] No RAPIDAPI_KEY set, skipping cricket');
      return [];
    }

    try {
      console.log('[Sports] 🏏 Fetching cricket schedule from Cricbuzz API...');
      const response = await axios.get(`${CRICBUZZ_BASE_URL}/cricket-schedule`, {
        headers: {
          'x-rapidapi-host': 'free-cricbuzz-cricket-api.p.rapidapi.com',
          'x-rapidapi-key': RAPIDAPI_KEY,
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const schedules = response.data?.response?.schedules || [];
      const events: SportEvent[] = [];
      const now = Date.now();
      const seenMatchIds = new Set<number>();

      for (const schedule of schedules) {
        const wrapper = schedule.scheduleAdWrapper || schedule;
        const matchList = wrapper.matchScheduleList || [];

        for (const series of matchList) {
          const seriesName = series.seriesName || 'Cricket Match';
          const matches = series.matchInfo || [];

          for (const match of matches) {
            if (!match.matchId || !match.team1 || !match.team2) continue;
            if (seenMatchIds.has(match.matchId)) continue;
            seenMatchIds.add(match.matchId);

            let startMs = parseInt(match.startDate, 10);
            if (isNaN(startMs)) continue;
            if (startMs < 1e12) startMs *= 1000;
            if (startMs < now) continue;

            const homeTeam = match.team1.teamName || match.team1.teamSName || 'Team 1';
            const awayTeam = match.team2.teamName || match.team2.teamSName || 'Team 2';
            const format = match.matchFormat || 'T20';
            const venue = match.venueInfo ? `${match.venueInfo.ground || ''}, ${match.venueInfo.city || ''}` : '';

            const cricketRatings: Record<string, number> = {
              'india': 95, 'australia': 92, 'england': 88, 'south africa': 86,
              'new zealand': 84, 'pakistan': 83, 'sri lanka': 75, 'west indies': 73,
              'bangladesh': 68, 'afghanistan': 66, 'zimbabwe': 58, 'ireland': 55,
              'netherlands': 50, 'scotland': 48, 'nepal': 45, 'oman': 42,
              'usa': 44, 'uae': 43, 'namibia': 46, 'kenya': 40,
              'canada': 41, 'hong kong': 38, 'papua new guinea': 36, 'jersey': 35,
              'bermuda': 33, 'italy': 34, 'germany': 32, 'denmark': 31,
              'singapore': 30, 'malaysia': 29, 'uganda': 37, 'tanzania': 28,
              'mexico': 25, 'argentina': 26, 'brazil': 24, 'chile': 23,
              'peru': 22, 'suriname': 27, 'cayman': 20, 'bahamas': 21,
              'belize': 19, 'costa rica': 18, 'panama': 17, 'samoa': 28,
              'vanuatu': 30, 'fiji': 29, 'japan': 35, 'china': 20,
              'thailand': 32, 'philippines': 22, 'myanmar': 18,
              'central districts': 65, 'northern districts': 63, 'otago': 62,
              'canterbury': 64, 'auckland': 66, 'wellington': 63,
            };
            const rateTeam = (name: string) => {
              const n = name.toLowerCase().trim();
              for (const [key, val] of Object.entries(cricketRatings)) {
                if (n.includes(key)) return val;
              }
              return 40;
            };
            const rH = rateTeam(homeTeam);
            const rA = rateTeam(awayTeam);
            const homeAdv = 1.03;
            const OVERROUND = format === 'TEST' ? 1.08 : 1.06;
            const rawPH = (rH * homeAdv) / (rH * homeAdv + rA);
            const cricketSeed = `${homeTeam}_${awayTeam}`.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
            const cSeededRand = (offset: number) => { const x = Math.sin(Math.abs(cricketSeed) + offset) * 10000; return x - Math.floor(x); };
            const jitterC = (cSeededRand(5) - 0.5) * 0.04;
            const pH = Math.max(0.08, Math.min(0.92, rawPH + jitterC));
            const pA = 1 - pH;

            let homeOdds: number, awayOdds: number, drawOdds: number | undefined;
            if (format === 'TEST') {
              const drawProb = 0.18 + (cSeededRand(6) - 0.5) * 0.06;
              const remProb = 1 - drawProb;
              const testPH = pH * remProb;
              const testPA = pA * remProb;
              homeOdds = parseFloat(Math.max(1.04, 1 / (testPH * OVERROUND)).toFixed(2));
              awayOdds = parseFloat(Math.max(1.04, 1 / (testPA * OVERROUND)).toFixed(2));
              drawOdds = parseFloat(Math.max(2.00, Math.min(4.00, 1 / (drawProb * OVERROUND))).toFixed(2));
            } else {
              homeOdds = parseFloat(Math.max(1.04, 1 / (pH * OVERROUND)).toFixed(2));
              awayOdds = parseFloat(Math.max(1.04, 1 / (pA * OVERROUND)).toFixed(2));
              drawOdds = undefined;
            }

            const outcomes: OutcomeData[] = [
              { id: 'home', name: homeTeam, odds: homeOdds, probability: 1 / homeOdds },
              { id: 'away', name: awayTeam, odds: awayOdds, probability: 1 / awayOdds }
            ];

            if (drawOdds) {
              outcomes.push({ id: 'draw', name: 'Draw', odds: drawOdds, probability: 1 / drawOdds });
            }

            const markets: MarketData[] = [
              { id: 'winner', name: 'Match Winner', outcomes }
            ];

            events.push({
              id: `cricket_${match.matchId}`,
              sportId: CRICKET_SPORT_ID,
              leagueName: `${seriesName} (${format})`,
              homeTeam,
              awayTeam,
              startTime: new Date(startMs).toISOString(),
              status: 'scheduled',
              isLive: false,
              markets,
              homeOdds,
              awayOdds,
              drawOdds,
              venue,
              format,
            } as SportEvent);
          }
        }
      }

      console.log(`[Sports] 🏏 Cricket: ${events.length} upcoming matches fetched`);
      return events;
    } catch (error: any) {
      console.error(`[Sports] 🏏 Cricket fetch error: ${error.message} — no fake fallback`);
      return [];
    }
  }

  private async fetchHorseRacing(): Promise<SportEvent[]> {
    if (!RAPIDAPI_KEY) {
      console.warn('[Sports] No RAPIDAPI_KEY set, skipping horse racing');
      return [];
    }

    try {
      console.log('[Sports] 🏇 Fetching horse racing from The Racing API...');
      const events: SportEvent[] = [];
      const now = Date.now();

      const fetchWithRetry = async (url: string, maxRetries = 3): Promise<any> => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await axios.get(url, {
              headers: {
                'x-rapidapi-host': RACING_API_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY,
                'Accept': 'application/json'
              },
              timeout: 15000
            });
            return response;
          } catch (err: any) {
            if (err.response?.status === 429 && attempt < maxRetries) {
              const wait = Math.min(5000 * Math.pow(2, attempt), 30000);
              console.log(`[Sports] 🏇 Rate limited (429), retrying in ${wait/1000}s (attempt ${attempt + 1}/${maxRetries})...`);
              await new Promise(r => setTimeout(r, wait));
              continue;
            }
            throw err;
          }
        }
      };

      for (const day of ['today', 'tomorrow']) {
        const response = await fetchWithRetry(`${RACING_API_BASE}/v1/racecards/free?day=${day}`);
        const racecards = response.data?.racecards || [];

        for (const race of racecards) {
          if (!race.race_id || !race.runners || race.runners.length < 2) continue;

          const raceStart = new Date(race.off_dt).getTime();
          if (isNaN(raceStart) || raceStart < now) continue;

          const runners = race.runners.filter((r: any) => {
            const num = String(r.number || '').toUpperCase();
            return num !== 'NR' && num !== 'N/R' && num !== 'SCR';
          });

          if (runners.length < 2) continue;

          const fieldSize = runners.length;
          const rawScores = runners.map((runner: any, idx: number) => {
            const formScore = this.calculateFormScore(runner.form || '');
            const drawAdv = (runner.draw && runner.draw <= 4) ? 0.2 : 0;
            const weightPen = runner.lbs ? Math.max(0, (runner.lbs - 140) * 0.005) : 0;
            const positionBias = idx * 0.08;
            return Math.max(0.1, 1.0 + formScore * 1.5 + drawAdv - weightPen - positionBias);
          });

          const rawPowers = rawScores.map(s => Math.pow(s, 3.0));
          const totalPower = rawPowers.reduce((s: number, v: number) => s + v, 0);
          const OVERROUND = 1.15 + (fieldSize > 8 ? 0.05 : 0) + (fieldSize > 14 ? 0.05 : 0);

          const winOutcomes: OutcomeData[] = runners.map((runner: any, idx: number) => {
            const fairProb = rawPowers[idx] / totalPower;
            const jitter = (Math.random() - 0.5) * 0.01;
            const adjProb = Math.max(0.015, Math.min(0.65, fairProb + jitter));
            const bookedProb = adjProb * OVERROUND;
            const odds = parseFloat(Math.max(1.20, 1 / bookedProb).toFixed(2));
            return {
              id: `runner_${runner.number || idx}`,
              name: runner.horse || `Runner ${idx + 1}`,
              odds,
              probability: 1 / odds
            };
          });

          const placeOutcomes: OutcomeData[] = winOutcomes.map(w => {
            const placeFactor = fieldSize >= 8 ? 3.0 : fieldSize >= 5 ? 2.5 : 2.0;
            const placeOdds = parseFloat(Math.max(1.10, ((w.odds - 1) / placeFactor) + 1).toFixed(2));
            return { id: w.id, name: w.name, odds: placeOdds, probability: 1 / placeOdds };
          });

          const showOutcomes: OutcomeData[] = winOutcomes.map(w => {
            const showFactor = fieldSize >= 8 ? 5.0 : fieldSize >= 5 ? 4.0 : 3.0;
            const showOdds = parseFloat(Math.max(1.05, ((w.odds - 1) / showFactor) + 1).toFixed(2));
            return { id: w.id, name: w.name, odds: showOdds, probability: 1 / showOdds };
          });

          const markets: MarketData[] = [
            { id: 'race_winner', name: 'Win', outcomes: winOutcomes },
            { id: 'race_place', name: 'Place', outcomes: placeOutcomes },
            { id: 'race_show', name: 'Show', outcomes: showOutcomes },
          ];

          const courseName = race.course || 'Unknown Course';
          const region = race.region || '';
          const raceType = race.type || 'Flat';
          const distance = race.distance_f ? `${race.distance_f}f` : '';
          const going = race.going || '';
          const raceClass = race.race_class || '';

          const runnersInfo = runners.map((r: any) => ({
            name: r.horse,
            number: r.number,
            jockey: r.jockey,
            trainer: r.trainer,
            form: r.form,
            age: r.age,
            weight: r.lbs,
            draw: r.draw,
            headgear: r.headgear,
            sire: r.sire,
            dam: r.dam,
          }));

          events.push({
            id: `horse-racing_${race.race_id}`,
            sportId: HORSE_RACING_SPORT_ID,
            leagueName: `${courseName} (${region})`,
            homeTeam: race.race_name || 'Race',
            awayTeam: `${raceType} ${distance} - ${going}`.trim(),
            startTime: new Date(raceStart).toISOString(),
            status: 'scheduled',
            isLive: false,
            markets,
            homeOdds: winOutcomes[0]?.odds || 3.0,
            awayOdds: winOutcomes[1]?.odds || 4.0,
            venue: courseName,
            runnersInfo,
            raceDetails: {
              course: courseName,
              region,
              raceType,
              distance,
              going,
              surface: race.surface || 'Turf',
              raceClass,
              prize: race.prize || '',
              fieldSize: parseInt(race.field_size) || runners.length,
              ageBand: race.age_band || '',
              pattern: race.pattern || '',
            },
          } as SportEvent);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`[Sports] 🏇 Horse Racing: ${events.length} races fetched (today + tomorrow)`);
      return events;
    } catch (error: any) {
      console.error(`[Sports] 🏇 Horse Racing fetch error: ${error.message} — no fake fallback`);
      return [];
    }
  }

  private calculateFormScore(form: string): number {
    if (!form || form === '-') return 0;
    const chars = form.replace(/[^0-9]/g, '').slice(-5);
    let score = 0;
    const weights = [1.0, 0.85, 0.7, 0.55, 0.4];
    for (let i = chars.length - 1; i >= 0; i--) {
      const pos = parseInt(chars[i]);
      const w = weights[chars.length - 1 - i] || 0.3;
      if (pos === 1) score += 2.0 * w;
      else if (pos === 2) score += 1.4 * w;
      else if (pos === 3) score += 0.9 * w;
      else if (pos === 4) score += 0.5 * w;
      else if (pos <= 6) score += 0.2 * w;
      else if (pos <= 9) score -= 0.1 * w;
      else score -= 0.3 * w;
    }
    return Math.max(0, score);
  }

  private generateRealisticOdds(
    seed: string, homeTeam: string, awayTeam: string, sport: string,
    homeRank: number, awayRank: number
  ): [number, number] {
    const seedHash = seed.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const rand = (offset: number) => { const x = Math.sin(Math.abs(seedHash) + offset) * 10000; return x - Math.floor(x); };

    const homeNameHash = homeTeam.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const awayNameHash = awayTeam.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);

    const homeStr = (Math.abs(homeNameHash) % 20) + 40;
    const awayStr = (Math.abs(awayNameHash) % 20) + 40;

    let diff = (homeStr - awayStr) * 0.2;
    diff += 1.0;

    if (homeRank > 0 && awayRank > 0) {
      diff += (awayRank - homeRank) * 0.3;
    }

    const noise = (rand(1) - 0.5) * 4.0;
    diff += noise;

    diff = Math.max(-6, Math.min(6, diff));
    const homeProb = 1 / (1 + Math.pow(10, -diff / 10));

    const clampedHome = Math.max(0.22, Math.min(0.78, homeProb));
    const clampedAway = 1 - clampedHome;

    const MARGIN = 1.05;
    let hOdds = parseFloat((MARGIN / clampedHome).toFixed(2));
    let aOdds = parseFloat((MARGIN / clampedAway).toFixed(2));

    hOdds = parseFloat(Math.max(1.20, Math.min(4.00, hOdds)).toFixed(2));
    aOdds = parseFloat(Math.max(1.20, Math.min(4.00, aOdds)).toFixed(2));

    return [hOdds, aOdds];
  }


  /**
   * Get cached upcoming events for a specific sport
   */
  getUpcomingEvents(sportSlug?: string): SportEvent[] {
    if (sportSlug) {
      // Canonical slug-to-sportId map covering all sidebar slugs and aliases
      // IDs match the database sports table exactly
      const SLUG_TO_SPORT_ID: Record<string, number> = {
        // Core sports (DB IDs)
        'soccer': 1,
        'football': 1,
        'basketball': 2,
        'tennis': 3,
        'american-football': 4,
        'nfl': 14,
        'baseball': 5,
        'ice-hockey': 6,
        'hockey': 6,
        'mma': 7,
        'mma-ufc': 7,
        'ufc': 7,
        'boxing': 8,
        'esports': 9,
        'afl': 10,
        'aussie-rules': 10,
        'formula-1': 11,
        'f1': 11,
        'handball': 12,
        'nba': 13,
        'rugby': 15,
        'volleyball': 16,
        'horse-racing': 17,
        'horseracing': 17,
        'cricket': 18,
        'motogp': 19,
        'moto-gp': 19,
        'wwe': 20,
        'entertainment': 20,
        'wwe-entertainment': 20,
      };
      const sportId = SLUG_TO_SPORT_ID[sportSlug];
      if (sportId !== undefined) {
        return cachedFreeSportsEvents.filter(e => e.sportId === sportId);
      }
    }
    return cachedFreeSportsEvents;
  }

  /**
   * Check if a sport is a free sport
   */
  isFreeSport(sportSlug: string): boolean {
    return sportSlug in FREE_SPORTS_CONFIG || 
           sportSlug === 'hockey' || 
           sportSlug === 'nfl' || 
           sportSlug === 'mlb' ||
           sportSlug === 'boxing' ||
           sportSlug === 'tennis' ||
           sportSlug === 'cricket' ||
           sportSlug === 'esports';
  }

  /**
   * Get cache status
   */
  getCacheStatus(): { 
    eventCount: number; 
    lastFetch: Date | null; 
    cacheAgeMinutes: number;
    isStale: boolean;
  } {
    const cacheAgeMs = Date.now() - lastFetchTime;
    return {
      eventCount: cachedFreeSportsEvents.length,
      lastFetch: lastFetchTime > 0 ? new Date(lastFetchTime) : null,
      cacheAgeMinutes: Math.round(cacheAgeMs / (60 * 1000)),
      isStale: cacheAgeMs > CACHE_TTL
    };
  }

  getCachedEvents(): SportEvent[] {
    return cachedFreeSportsEvents;
  }

  lookupEvent(eventId: string): { found: boolean; event?: SportEvent; shouldBeLive: boolean } {
    const event = cachedFreeSportsEvents.find(e => String(e.id) === String(eventId));
    if (!event) {
      return { found: false, shouldBeLive: false };
    }
    
    const PRE_MATCH_CUTOFF_MS = 5 * 60 * 1000;
    const shouldBeLive = event.startTime ? new Date(event.startTime).getTime() <= (Date.now() + PRE_MATCH_CUTOFF_MS) : false;
    return { found: true, event, shouldBeLive };
  }

  /**
   * Get cached finished results (for Results page)
   */
  getCachedResults(): FreeSportsResult[] {
    return cachedFinishedResults;
  }

  /**
   * Get sport config mapping for sport detection
   */
  getSportConfigMap(): Record<string, { sportId: number; name: string }> {
    const map: Record<string, { sportId: number; name: string }> = {};
    for (const [slug, config] of Object.entries(FREE_SPORTS_CONFIG)) {
      map[slug] = { sportId: config.sportId, name: config.name };
    }
    return map;
  }

  /**
   * Force refresh (manual trigger)
   */
  async forceRefresh(): Promise<SportEvent[]> {
    console.log('[Sports] Force refresh requested - resetting date lock');
    lastUpcomingFetchDate = '';
    return this.fetchAllUpcomingMatches();
  }
}

// Singleton instance
export const freeSportsService = new FreeSportsService();
