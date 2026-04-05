import { storage } from '../storage';
import balanceService from './balanceService';
import { blockchainBetService } from './blockchainBetService';
import { db } from '../db';
import { settledEvents } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface FinishedMatch {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: 'home' | 'away' | 'draw';
  status: string;
}

interface UnsettledBet {
  id: string;
  eventId: string;
  externalEventId: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  odds: number;
  stake: number;
  potentialWin: number;
  userId: string;
  currency: string;
  betObjectId?: string;
  status?: string;
  giftedTo?: string;
}

const REVENUE_WALLET = 'platform_revenue';

function extractNumericScore(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }
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
    if (periodKeys.length > 0) {
      let sum = 0;
      let hasAny = false;
      for (const k of periodKeys) {
        const v = raw[k];
        if (v != null && typeof v === 'number') {
          sum += v;
          hasAny = true;
        } else if (v != null && typeof v === 'string') {
          const n = parseInt(v, 10);
          if (!isNaN(n)) { sum += n; hasAny = true; }
        }
      }
      if (hasAny) return sum;
    }
    return null;
  }
  return null;
}

function extractVolleyballSetsWon(homeRaw: any, awayRaw: any): [number, number] | null {
  if (!homeRaw || !awayRaw || typeof homeRaw !== 'object' || typeof awayRaw !== 'object') return null;
  if (homeRaw.total != null && awayRaw.total != null) {
    const h = typeof homeRaw.total === 'number' ? homeRaw.total : parseInt(homeRaw.total, 10);
    const a = typeof awayRaw.total === 'number' ? awayRaw.total : parseInt(awayRaw.total, 10);
    if (!isNaN(h) && !isNaN(a)) return [h, a];
  }
  let homeSets = 0;
  let awaySets = 0;
  for (let s = 1; s <= 5; s++) {
    const hSet = homeRaw[String(s)] ?? homeRaw[`set_${s}`];
    const aSet = awayRaw[String(s)] ?? awayRaw[`set_${s}`];
    if (hSet != null && aSet != null) {
      const hv = typeof hSet === 'number' ? hSet : parseInt(hSet, 10);
      const av = typeof aSet === 'number' ? aSet : parseInt(aSet, 10);
      if (!isNaN(hv) && !isNaN(av) && (hv > 0 || av > 0)) {
        if (hv > av) homeSets++;
        else if (av > hv) awaySets++;
      }
    }
  }
  if (homeSets > 0 || awaySets > 0) return [homeSets, awaySets];
  return null;
}

const FREE_SPORTS_SETTLEMENT_CONFIG: Record<string, {
  endpoint: string;
  apiHost: string;
  sportId: number;
  name: string;
  hasDraws: boolean;
}> = {
  basketball: {
    endpoint: 'https://v1.basketball.api-sports.io/games',
    apiHost: 'v1.basketball.api-sports.io',
    sportId: 2,
    name: 'Basketball',
    hasDraws: false
  },
  baseball: {
    endpoint: 'https://v1.baseball.api-sports.io/games',
    apiHost: 'v1.baseball.api-sports.io',
    sportId: 5,
    name: 'Baseball',
    hasDraws: false
  },
  'ice-hockey': {
    endpoint: 'https://v1.hockey.api-sports.io/games',
    apiHost: 'v1.hockey.api-sports.io',
    sportId: 6,
    name: 'Ice Hockey',
    hasDraws: false
  },
  mma: {
    endpoint: 'https://v1.mma.api-sports.io/fights',
    apiHost: 'v1.mma.api-sports.io',
    sportId: 7,
    name: 'MMA',
    hasDraws: false
  },
  'american-football': {
    endpoint: 'https://v1.american-football.api-sports.io/games',
    apiHost: 'v1.american-football.api-sports.io',
    sportId: 4,
    name: 'American Football',
    hasDraws: false
  },
  afl: {
    endpoint: 'https://v1.afl.api-sports.io/games',
    apiHost: 'v1.afl.api-sports.io',
    sportId: 10,
    name: 'AFL',
    hasDraws: true
  },
  'formula-1': {
    endpoint: 'https://v1.formula-1.api-sports.io/races',
    apiHost: 'v1.formula-1.api-sports.io',
    sportId: 11,
    name: 'Formula 1',
    hasDraws: false
  },
  handball: {
    endpoint: 'https://v1.handball.api-sports.io/games',
    apiHost: 'v1.handball.api-sports.io',
    sportId: 12,
    name: 'Handball',
    hasDraws: true
  },
  nfl: {
    endpoint: 'https://v1.american-football.api-sports.io/games',
    apiHost: 'v1.american-football.api-sports.io',
    sportId: 14,
    name: 'NFL',
    hasDraws: false
  },
  rugby: {
    endpoint: 'https://v1.rugby.api-sports.io/games',
    apiHost: 'v1.rugby.api-sports.io',
    sportId: 15,
    name: 'Rugby',
    hasDraws: true
  },
  volleyball: {
    endpoint: 'https://v1.volleyball.api-sports.io/games',
    apiHost: 'v1.volleyball.api-sports.io',
    sportId: 16,
    name: 'Volleyball',
    hasDraws: false
  }
};

const FREE_SPORTS_RESULTS_CACHE_FILE = path.join('/tmp', 'free_sports_results_cache.json');

class SettlementWorkerService {
  private _isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private settledEventIdsCache = new Set<string>();
  private checkInterval = 5 * 60 * 1000; // 5 minutes
  private finishedMatchesCache: { data: FinishedMatch[]; timestamp: number } | null = null;
  private finishedMatchesCacheTTL = 10 * 60 * 1000; // Cache finished matches for 10 minutes (survives across 5-min settlement cycles)
  private cachedFreeSportsResults: FinishedMatch[] = [];
  private freeSportsResultsCache: { data: FinishedMatch[]; timestamp: number } | null = null;
  private freeSportsResultsCacheTTL = 4 * 60 * 1000; // Fetch sports results every 4 minutes

  async start() {
    if (this._isRunning) {
      console.log('⚙️ SettlementWorker already running');
      return;
    }

    // Load settled events from database on startup (survives restarts)
    await this.loadSettledEventsFromDB();

    // On-chain bet sync runs automatically every 5 minutes with settlement checks
    // Manual trigger also available via POST /api/admin/sync-onchain-bets
    console.log('🔄 On-chain bet sync enabled - runs every 5 minutes to catch direct contract bets');

    this._isRunning = true;
    console.log('🚀 SettlementWorker started - checking for finished matches every 5 minutes (API SAVING MODE)');

    this.intervalId = setInterval(async () => {
      try {
        await this.checkAndSettleBets();
      } catch (error) {
        console.error('❌ SettlementWorker error:', error);
      }
    }, this.checkInterval);

    this.checkAndSettleBets();
  }

  private async loadSettledEventsFromDB() {
    try {
      const settledFromDB = await db.select().from(settledEvents);
      for (const event of settledFromDB) {
        this.settledEventIdsCache.add(event.externalEventId);
      }
      console.log(`📋 Loaded ${settledFromDB.length} settled events from database`);
    } catch (error) {
      console.error('Failed to load settled events from DB:', error);
    }
  }

  private async markEventAsSettled(match: FinishedMatch, betsSettledCount: number) {
    try {
      // Check if already exists in DB
      const existing = await db.select().from(settledEvents).where(eq(settledEvents.externalEventId, match.eventId));
      if (existing.length === 0) {
        // Insert new settled event
        await db.insert(settledEvents).values({
          externalEventId: match.eventId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          winner: match.winner,
          betsSettled: betsSettledCount
        });
        console.log(`📝 Persisted settled event: ${match.eventId} (${betsSettledCount} bets settled)`);
      } else {
        // Update betsSettled count for existing event (upsert pattern)
        const newTotal = (existing[0].betsSettled || 0) + betsSettledCount;
        await db.update(settledEvents)
          .set({ betsSettled: newTotal })
          .where(eq(settledEvents.externalEventId, match.eventId));
        console.log(`📝 Updated settled event: ${match.eventId} (total ${newTotal} bets settled)`);
      }
      this.settledEventIdsCache.add(match.eventId);
    } catch (error) {
      console.error(`Failed to persist settled event ${match.eventId}:`, error);
    }
  }

  private isEventSettled(eventId: string): boolean {
    return this.settledEventIdsCache.has(eventId);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isRunning = false;
    console.log('⏹️ SettlementWorker stopped');
  }

  /**
   * Process sports results for settlement
   * Called by freeSportsService after nightly results fetch
   */
  public async processFreeSportsResults(results: { eventId: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; winner: 'home' | 'away' | 'draw'; status: string }[]): Promise<void> {
    console.log(`🏀 SettlementWorker: Processing ${results.length} sports results...`);
    
    if (results.length === 0) {
      console.log('🏀 SettlementWorker: No sports results to process');
      return;
    }

    // Store results in cache so the regular settlement cycle can also use them
    this.cachedFreeSportsResults = results.map(r => ({
      eventId: r.eventId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      homeScore: r.homeScore,
      awayScore: r.awayScore,
      winner: r.winner,
      status: r.status
    }));
    console.log(`🏀 SettlementWorker: Cached ${this.cachedFreeSportsResults.length} sports results for settlement cycle`);
    
    try {
      // Get all unsettled bets
      const unsettledBets = await this.getUnsettledBets();
      
      if (unsettledBets.length === 0) {
        console.log('🏀 SettlementWorker: No unsettled bets to settle');
        return;
      }
      
      // Filter to only pending bets (not already won)
      const pendingBets = unsettledBets.filter(bet => bet.status !== 'won');
      
      if (pendingBets.length === 0) {
        console.log('🏀 SettlementWorker: No pending bets for sports');
        return;
      }
      
      console.log(`🏀 SettlementWorker: Checking ${pendingBets.length} pending bets against ${results.length} sports results`);
      
      // Convert sports results to FinishedMatch format
      const finishedMatches: FinishedMatch[] = results.map(result => ({
        eventId: result.eventId,
        homeTeam: result.homeTeam,
        awayTeam: result.awayTeam,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        winner: result.winner,
        status: result.status
      }));
      
      // Process each finished match
      for (const match of finishedMatches) {
        // Skip if already settled
        if (this.isEventSettled(match.eventId)) {
          console.log(`🆓 Skipping already settled event: ${match.eventId}`);
          continue;
        }
        
        // Find bets for this match - use event ID matching
        const betsForMatch = pendingBets.filter(bet => {
          const betExtId = String(bet.externalEventId || '').trim();
          const matchId = String(match.eventId || '').trim();
          
          // Strategy 1: Exact event ID match
          if (betExtId && matchId && betExtId === matchId) {
            console.log(`🆓 Match found: bet ${betExtId} matches finished match ${matchId}`);
            return true;
          }
          
          // Strategy 2: EXACT team name match only (no substring/fuzzy matching)
          // GUARD: If both IDs share the same sport prefix (e.g. both ice-hockey_api_*),
          // skip name matching — they're different games of the same teams.
          const sameIdFormat = (() => {
            if (!betExtId || !matchId) return false;
            const p1 = betExtId.match(/^([a-z-]+_api_)/)?.[1];
            const p2 = matchId.match(/^([a-z-]+_api_)/)?.[1];
            if (p1 && p2 && p1 === p2) return true;
            if (/^\d+$/.test(betExtId) && /^\d+$/.test(matchId)) return true;
            return false;
          })();
          if (!sameIdFormat && bet.homeTeam && bet.awayTeam) {
            const betHome = bet.homeTeam.toLowerCase().trim();
            const betAway = bet.awayTeam.toLowerCase().trim();
            const matchHome = match.homeTeam.toLowerCase().trim();
            const matchAway = match.awayTeam.toLowerCase().trim();
            
            if (betHome === matchHome && betAway === matchAway) {
              console.log(`🆓 Exact team name match: ${bet.homeTeam} vs ${bet.awayTeam} matches ${match.homeTeam} vs ${match.awayTeam}`);
              return true;
            }
          }
          
          return false;
        });
        
        if (betsForMatch.length > 0) {
          console.log(`🆓 Settling ${betsForMatch.length} bets for ${match.homeTeam} vs ${match.awayTeam} (${match.homeScore}-${match.awayScore})`);
          await this.settleBetsForMatch(match, betsForMatch);
        }
      }
      
      // Also process parlay bets that may include sports legs
      const allUnsettled = await this.getUnsettledBets();
      const parlayBets = allUnsettled.filter(bet => this.isParlayBet(bet) && bet.status !== 'won');
      
      if (parlayBets.length > 0) {
        console.log(`🏀 Processing ${parlayBets.length} parlay bets with sports results...`);
        await this.settleParlayBets(parlayBets, finishedMatches);
      }
      
      console.log(`🏀 SettlementWorker: Free sports settlement complete`);
    } catch (error: any) {
      console.error(`🏀 SettlementWorker: Error processing sports results:`, error.message);
    }
  }

  private _settlementInProgress = false;
  
  public async checkAndSettleBets(forceRefresh = false) {
    if (this._settlementInProgress) {
      console.log('⏳ SettlementWorker: Previous cycle still running, skipping this interval');
      return;
    }
    this._settlementInProgress = true;
    
    try {
      await this._doCheckAndSettleBets(forceRefresh);
    } finally {
      this._settlementInProgress = false;
    }
  }
  
  private async _doCheckAndSettleBets(forceRefresh = false) {
    console.log('🔍 SettlementWorker: Checking for finished matches...');

    if (forceRefresh) {
      this.finishedMatchesCache = null;
      this.freeSportsResultsCache = null;
      console.log('🔄 Force refresh: cleared all caches');
    }

    try {
      // Sync on-chain bets to database (catch bets placed directly on contract)
      try {
        const syncResult = await blockchainBetService.syncOnChainBetsToDatabase();
        if (syncResult.synced > 0) {
          console.log(`🔄 Synced ${syncResult.synced} on-chain bets to database`);
        }
      } catch (syncErr) {
        console.error('❌ On-chain bet sync failed:', syncErr);
      }

      // Check for unsettled bets FIRST to avoid unnecessary API calls
      const unsettledBets = await this.getUnsettledBets();
      
      if (unsettledBets.length === 0) {
        console.log('📭 SettlementWorker: No unsettled bets - skipping API fetch');
        return;
      }

      const wonBetsNeedingPayout = unsettledBets.filter(bet => bet.status === 'won');
      if (wonBetsNeedingPayout.length > 0) {
        console.log(`💰 PAYOUT RETRY: ${wonBetsNeedingPayout.length} won bets need payout processing`);
        await this.retryPendingPayouts(wonBetsNeedingPayout);
      }

      const pendingBets = unsettledBets.filter(bet => bet.status !== 'won');
      
      if (pendingBets.length === 0) {
        console.log('📭 SettlementWorker: No pending bets need match lookup');
        return;
      }

      const finishedMatches = await this.getFinishedMatches(pendingBets);
      
      if (finishedMatches.length === 0) {
        console.log(`📭 SettlementWorker: No batch finished matches — trying direct lookups for all ${pendingBets.length} pending bets`);
      }

      console.log(`📋 SettlementWorker: Found ${finishedMatches.length} finished matches`);
      console.log(`🎯 SettlementWorker: Processing ${pendingBets.length} pending bets`);
      
      // Debug: Log pending bet details for matching
      for (const bet of pendingBets) {
        console.log(`📊 Unsettled bet: externalEventId=${bet.externalEventId}, eventId=${bet.eventId}, prediction=${bet.prediction}, homeTeam=${bet.homeTeam}, awayTeam=${bet.awayTeam}`);
        
        // Check if this bet's event is in the finished matches
        const betExtId = String(bet.externalEventId || '').trim();
        const matchingFinished = finishedMatches.find(m => String(m.eventId || '').trim() === betExtId);
        if (matchingFinished) {
          console.log(`🎯 Found finished match for bet: ${matchingFinished.homeTeam} vs ${matchingFinished.awayTeam} (${matchingFinished.homeScore}-${matchingFinished.awayScore})`);
        } else {
          console.log(`⏳ Match ${betExtId} not yet finished or not in today's results`);
        }
      }

      // Separate single bets from parlay bets
      const singleBets = pendingBets.filter(bet => !this.isParlayBet(bet));
      const parlayBets = pendingBets.filter(bet => this.isParlayBet(bet));
      
      console.log(`📊 Processing ${singleBets.length} single bets, ${parlayBets.length} parlay bets`);
      
      // Process single bets
      for (const match of finishedMatches) {
        // IMPROVED MATCHING: Use multiple strategies to find bets for this match
        const betsForMatch = singleBets.filter(bet => {
          // Strategy 1: Exact external event ID match (most reliable) - compare as strings
          const betExtId = String(bet.externalEventId || '').trim();
          const matchId = String(match.eventId || '').trim();
          if (betExtId && matchId && betExtId === matchId) {
            console.log(`✅ MATCH FOUND: bet externalEventId=${betExtId} matches finished match ${matchId}`);
            return true;
          }
          
          // Strategy 2: Team/fighter name matching when exact ID doesn't match
          // SAFETY: Only exact normalized name matches allowed — NO substring matching.
          // GUARD: If both IDs share the same sport prefix (e.g. both ice-hockey_api_*),
          // skip name matching — they're different games of the same teams.
          const sameIdFormat2 = (() => {
            if (!betExtId || !matchId) return false;
            const p1 = betExtId.match(/^([a-z-]+_api_)/)?.[1];
            const p2 = matchId.match(/^([a-z-]+_api_)/)?.[1];
            if (p1 && p2 && p1 === p2) return true;
            if (/^\d+$/.test(betExtId) && /^\d+$/.test(matchId)) return true;
            return false;
          })();
          if (!sameIdFormat2 && bet.homeTeam && bet.awayTeam && match.homeTeam && match.awayTeam) {
            const normalize = (name: string) => name.toLowerCase().trim()
              .replace(/\b(fc|sc|cf|afc|united|utd|city|town|athletic|ath|sporting|sp|de)\b/gi, ' ')
              .replace(/\s+/g, ' ').trim();
            const betHome = normalize(bet.homeTeam);
            const betAway = normalize(bet.awayTeam);
            const matchHome = normalize(match.homeTeam);
            const matchAway = normalize(match.awayTeam);
            
            const exactBothMatch = (betHome === matchHome && betAway === matchAway) ||
                                   (betHome === matchAway && betAway === matchHome);
            
            if (exactBothMatch) {
              console.log(`🔗 TEAM MATCH FOUND (exact): bet "${bet.homeTeam} vs ${bet.awayTeam}" (${betExtId}) → finished "${match.homeTeam} vs ${match.awayTeam}" (${matchId})`);
              return true;
            }
          }
          
          // Strategy 4: Legacy eventId match
          if (bet.eventId && bet.eventId === match.eventId) {
            return true;
          }
          
          return false;
        });

        if (betsForMatch.length > 0) {
          console.log(`⚽ Settling ${betsForMatch.length} bets for ${match.homeTeam} vs ${match.awayTeam} (${match.homeScore}-${match.awayScore})`);
          await this.settleBetsForMatch(match, betsForMatch);
        }
      }
      
      // Direct lookup for unmatched single bets (basketball, hockey, baseball)
      const settledSingleIds = new Set(this.settledBetIds);
      const unmatchedSingles = singleBets.filter(b => !settledSingleIds.has(b.id));
      if (unmatchedSingles.length > 0) {
        console.log(`🔍 Direct lookup for ${unmatchedSingles.length} unmatched single bets...`);
        for (const bet of unmatchedSingles) {
          const extId = String(bet.externalEventId || '').trim();
          if (!extId) continue;
          
          let directMatch: FinishedMatch | null = null;
          
          const freeSportsPrefixes = ['basketball', 'ice-hockey', 'baseball', 'handball', 'volleyball', 'rugby', 'american-football', 'afl', 'mma', 'boxing', 'nfl'];
          const isFreeSportApi = freeSportsPrefixes.some(p => extId.startsWith(`${p}_api_`));
          const isHorseRacing = extId.startsWith('horse-racing_') || extId.includes('rac_');
          if (isHorseRacing) {
            directMatch = await this.fetchHorseRacingResultById(extId);
          } else if (isFreeSportApi) {
            directMatch = await this.fetchFreeSportsGameById(extId);
          } else if (/^\d+$/.test(extId)) {
            directMatch = await this.fetchFootballFixtureById(extId);
          }
          
          if (directMatch) {
            console.log(`⚽ Direct settling: ${bet.homeTeam} vs ${bet.awayTeam} → ${directMatch.homeScore}-${directMatch.awayScore}`);
            await this.settleBetsForMatch(directMatch, [bet]);
          }
        }
      }

      // Process parlay bets - need all legs to be finished
      if (parlayBets.length > 0) {
        await this.settleParlayBets(parlayBets, finishedMatches);
      }

      await this.syncOnChainLiability();

    } catch (error) {
      console.error('❌ SettlementWorker checkAndSettleBets error:', error);
    }
  }

  private _lastLiabilitySyncTime = 0;

  private async syncOnChainLiability() {
    const now = Date.now();
    if (now - this._lastLiabilitySyncTime < 5 * 60 * 1000) return;
    this._lastLiabilitySyncTime = now;

    try {
      const platformInfo = await blockchainBetService.getPlatformInfo();
      if (!platformInfo) return;

      const allBets = await storage.getAllBets();
      const activeBets = allBets.filter((b: any) => 
        b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_play' || b.status === 'open'
      );
      const realLiabilitySbets = activeBets
        .filter((b: any) => b.currency === 'SBETS')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
      const realLiabilitySui = activeBets
        .filter((b: any) => b.currency === 'SUI')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);

      if (Math.abs(platformInfo.totalLiabilitySbets - realLiabilitySbets) > 1000) {
        console.log(`🔄 Auto-sync SBETS liability: on-chain=${platformInfo.totalLiabilitySbets.toFixed(0)}, DB=${realLiabilitySbets.toFixed(0)}`);
        const result = await blockchainBetService.resetOnChainLiability('SBETS', realLiabilitySbets);
        if (result.success) {
          console.log(`✅ SBETS liability synced to ${realLiabilitySbets.toFixed(0)} | TX: ${result.txHash}`);
        } else {
          console.warn(`⚠️ SBETS liability sync failed: ${result.error}`);
        }
      }

      if (Math.abs(platformInfo.totalLiabilitySui - realLiabilitySui) > 0.1) {
        console.log(`🔄 Auto-sync SUI liability: on-chain=${platformInfo.totalLiabilitySui.toFixed(4)}, DB=${realLiabilitySui.toFixed(4)}`);
        const result = await blockchainBetService.resetOnChainLiability('SUI', realLiabilitySui);
        if (result.success) {
          console.log(`✅ SUI liability synced to ${realLiabilitySui.toFixed(4)} | TX: ${result.txHash}`);
        } else {
          console.warn(`⚠️ SUI liability sync failed: ${result.error}`);
        }
      }
    } catch (error) {
      console.warn('⚠️ Liability auto-sync error:', error);
    }
  }

  private isParlayBet(bet: UnsettledBet): boolean {
    // Parlay bets can be identified by:
    // 1. JSON array format: prediction starts with '[' and contains eventId
    // 2. Pipe-separated format: externalEventId starts with 'parlay_' and prediction contains '|'
    try {
      const pred = bet.prediction || '';
      const extId = bet.externalEventId || '';
      
      // JSON format parlay
      if (pred.startsWith('[') && pred.includes('"eventId"')) {
        return true;
      }
      
      // Pipe-separated format parlay (e.g., "Team A: Over 2.5 | Team B: Under 2.5")
      if (extId.startsWith('parlay_') && pred.includes('|')) {
        return true;
      }
      
      return false;
    } catch {
      return false;
    }
  }
  
  private static readonly KNOWN_SPORT_SLUGS = new Set([
    'basketball', 'baseball', 'ice-hockey', 'mma', 'american-football',
    'afl', 'formula-1', 'handball', 'nfl', 'rugby', 'volleyball',
    'tennis', 'boxing', 'horse-racing'
  ]);

  private extractEventIdsFromParlayExtId(extId: string): string[] {
    const parts = extId.split('_');
    const remaining = parts.slice(2);

    if (remaining.length === 0) return [];

    const joined = remaining.join('_');
    if (joined.includes('~')) {
      return joined.split('~').filter(id => id.length > 0);
    }

    const eventIds: string[] = [];
    let i = 0;

    while (i < remaining.length) {
      const current = remaining[i];

      if (SettlementWorkerService.KNOWN_SPORT_SLUGS.has(current) && i + 1 < remaining.length) {
        eventIds.push(`${current}_${remaining[i + 1]}`);
        i += 2;
      } else if (i + 1 < remaining.length) {
        const hyphenated = `${current}-${remaining[i + 1]}`;
        if (SettlementWorkerService.KNOWN_SPORT_SLUGS.has(hyphenated) && i + 2 < remaining.length) {
          eventIds.push(`${hyphenated}_${remaining[i + 2]}`);
          i += 3;
        } else {
          eventIds.push(current);
          i += 1;
        }
      } else {
        eventIds.push(current);
        i += 1;
      }
    }

    return eventIds;
  }

  private parsePipeSeparatedParlay(bet: UnsettledBet): Array<{ eventId: string; prediction: string; marketId?: string; outcomeId?: string }> {
    const legs: Array<{ eventId: string; prediction: string; marketId?: string; outcomeId?: string }> = [];
    
    try {
      const extId = bet.externalEventId || '';
      const pred = bet.prediction || '';
      
      const eventIds = this.extractEventIdsFromParlayExtId(extId);
      
      const predParts = pred.split('|').map(p => p.trim());
      
      console.log(`🔍 Parlay event IDs extracted: [${eventIds.join(', ')}] (${eventIds.length} legs from ${predParts.length} predictions)`);
      
      if (eventIds.length !== predParts.length) {
        console.warn(`⚠️ Parlay leg/prediction count mismatch: ${eventIds.length} event IDs vs ${predParts.length} predictions for ${extId}`);
      }
      
      for (let i = 0; i < Math.min(eventIds.length, predParts.length); i++) {
        const eventId = eventIds[i];
        const fullPred = predParts[i];
        
        const colonIdx = fullPred.lastIndexOf(':');
        const prediction = colonIdx !== -1 ? fullPred.slice(colonIdx + 1).trim() : fullPred;
        
        let marketId = 'match-winner';
        let outcomeId = '';
        
        if (prediction.includes('Over')) {
          marketId = '5';
          outcomeId = 'ou_over';
        } else if (prediction.includes('Under')) {
          marketId = '5';
          outcomeId = 'ou_under';
        } else if (prediction === 'Draw') {
          outcomeId = 'draw';
        } else if (prediction.includes('or Draw')) {
          marketId = '3';
          outcomeId = 'dc_home_or_draw';
        }
        
        legs.push({ eventId, prediction, marketId, outcomeId });
      }
    } catch (error) {
      console.error(`❌ Error parsing pipe-separated parlay:`, error);
    }
    
    return legs;
  }
  
  private async settleParlayBets(parlayBets: UnsettledBet[], finishedMatches: FinishedMatch[]) {
    console.log(`🎰 Processing ${parlayBets.length} parlay bets...`);
    
    // Create a map of finished matches by eventId for quick lookup
    const finishedMatchMap = new Map<string, FinishedMatch>();
    for (const match of finishedMatches) {
      finishedMatchMap.set(String(match.eventId).trim(), match);
    }
    
    for (const bet of parlayBets) {
      try {
        // Parse parlay legs - support both JSON and pipe-separated formats
        let legs: Array<{
          eventId: string;
          marketId?: string;
          outcomeId?: string;
          odds?: number;
          prediction: string;
          selection?: string;
        }>;
        
        const pred = bet.prediction || '';
        const extId = bet.externalEventId || '';
        
        if (pred.startsWith('[') && pred.includes('"eventId"')) {
          // JSON format parlay
          legs = JSON.parse(pred);
        } else if (extId.startsWith('parlay_') && pred.includes('|')) {
          // Pipe-separated format parlay
          legs = this.parsePipeSeparatedParlay(bet);
          console.log(`🔄 Parsed pipe-separated parlay: ${legs.length} legs from ${extId}`);
        } else {
          console.log(`⚠️ Parlay bet ${bet.id} has unknown format`);
          continue;
        }
        
        if (!Array.isArray(legs) || legs.length === 0) {
          console.log(`⚠️ Parlay bet ${bet.id} has invalid legs structure`);
          continue;
        }
        
        console.log(`🎯 Parlay bet ${bet.id.slice(0, 10)}... has ${legs.length} legs`);
        
        // Check if ALL legs have finished matches
        let allLegsFinished = true;
        let anyLegLost = false;
        let anyLegVoided = false;
        const legResults: { eventId: string; prediction: string; won: boolean; match?: FinishedMatch }[] = [];
        
        for (const leg of legs) {
          const eventId = String(leg.eventId).trim();
          let match = finishedMatchMap.get(eventId);
          
          if (!match) {
            const fetchedResult = await this.fetchFreeSportsLegResult(eventId);
            if (fetchedResult) {
              match = fetchedResult;
              finishedMatchMap.set(eventId, match);
              console.log(`🔍 Fetched result for parlay leg ${eventId}: ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
            }
          }
          
          if (!match) {
            const directResult = await this.fetchFootballFixtureById(eventId);
            if (directResult) {
              match = directResult;
              finishedMatchMap.set(eventId, match);
              console.log(`🔍 Direct fixture lookup for parlay leg ${eventId}: ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
            }
          }
          
          if (!match) {
            console.log(`⏳ Parlay leg ${eventId} not yet finished`);
            allLegsFinished = false;
            continue;
          }

          if (match.status === 'void') {
            anyLegVoided = true;
            console.log(`🚫 Parlay leg VOIDED: ${eventId} (${match.homeTeam} vs ${match.awayTeam}) — match cancelled/abandoned/postponed`);
            legResults.push({ eventId, prediction: leg.prediction || leg.selection || '', won: false, match });
            continue;
          }
          
          const prediction = leg.prediction || leg.selection || '';
          const legWon = this.evaluateLegPrediction(prediction, match, leg.marketId, leg.outcomeId);
          
          legResults.push({ eventId, prediction, won: legWon, match });
          
          if (!legWon) {
            anyLegLost = true;
            console.log(`❌ Parlay leg LOST: ${prediction} for ${match.homeTeam} vs ${match.awayTeam} (${match.homeScore}-${match.awayScore})`);
          } else {
            console.log(`✅ Parlay leg WON: ${prediction} for ${match.homeTeam} vs ${match.awayTeam} (${match.homeScore}-${match.awayScore})`);
          }
        }

        if (anyLegVoided) {
          console.log(`🚫 PARLAY VOIDED: ${bet.id.slice(0, 10)}... — one or more legs had cancelled/abandoned match, refunding stake`);
          await db.execute(sql`UPDATE bets SET status = 'void', settled_at = NOW() WHERE id = ${bet.id}`);
          if (bet.currency === 'SBETS' && bet.stake > 0) {
            try {
              await balanceService.addWinnings(bet.userId || bet.walletAddress, bet.stake, 'SBETS');
              console.log(`💸 PARLAY VOID REFUND: ${bet.stake} SBETS returned to ${(bet.userId || bet.walletAddress).slice(0, 12)}...`);
            } catch (refundErr: any) {
              console.error(`❌ PARLAY VOID REFUND FAILED: bet ${bet.id}`, refundErr.message);
            }
          }
          continue;
        }
        
        if (anyLegLost) {
          console.log(`🎰 EARLY PARLAY LOSS: ${bet.id.slice(0, 10)}... has ${legResults.filter(l => !l.won).length} lost legs — settling as LOST immediately (${legResults.length}/${legs.length} legs resolved)`);
        } else if (!allLegsFinished) {
          console.log(`⏳ Parlay bet ${bet.id.slice(0, 10)}... waiting for ${legs.length - legResults.length} more legs to finish`);
          continue;
        }
        
        // All legs finished - settle the parlay
        const parlayWon = !anyLegLost;
        console.log(`🎰 PARLAY SETTLED: ${bet.id.slice(0, 10)}... ${parlayWon ? 'WON' : 'LOST'} (${legResults.filter(l => l.won).length}/${legs.length} legs won)`);
        
        // Store per-leg results in the bet's result field as JSON
        const legResultsJson = JSON.stringify(legResults.map(lr => ({
          eventId: lr.eventId,
          prediction: lr.prediction,
          won: lr.won,
          score: lr.match ? `${lr.match.homeScore}-${lr.match.awayScore}` : undefined,
          teams: lr.match ? `${lr.match.homeTeam} vs ${lr.match.awayTeam}` : undefined
        })));
        try {
          await storage.updateBetResult(bet.id, legResultsJson);
        } catch (e) {
          console.warn(`[Settlement] Could not store leg results for ${bet.id}:`, e);
        }
        
        const firstMatch = legResults.find(lr => lr.match)?.match;
        if (firstMatch) {
          const modifiedBet: UnsettledBet = {
            ...bet,
            status: parlayWon ? 'won' : 'pending'
          };
          
          if (parlayWon) {
            await this.settleBetsForMatch(firstMatch, [modifiedBet]);
          } else {
            await this.settleParlaySingleBet(bet, firstMatch, false);
          }
        }
        
      } catch (error) {
        console.error(`❌ Error processing parlay bet ${bet.id}:`, error);
      }
    }
  }
  
  /**
   * Look up a sports game result by eventId (e.g., "basketball_489697")
   * CACHE-FIRST: Always checks cachedFreeSportsResults before making any API call.
   * NO direct API calls - results come from the nightly 11 PM UTC fetch only.
   */
  private async fetchFreeSportsLegResult(eventId: string): Promise<FinishedMatch | null> {
    const cached = this.cachedFreeSportsResults.find(r => r.eventId === eventId);
    if (cached) {
      console.log(`✅ Found parlay leg ${eventId} in cached sports results (no API call)`);
      return cached;
    }

    if (eventId.startsWith('horse-racing_') || eventId.includes('rac_')) {
      const horseResult = await this.fetchHorseRacingResultById(eventId);
      if (horseResult) {
        console.log(`✅ Found parlay leg ${eventId} via horse racing result lookup`);
        return horseResult;
      }
    }

    const allApiPrefixes = ['basketball', 'ice-hockey', 'baseball', 'handball', 'volleyball', 'rugby', 'american-football', 'afl', 'mma', 'boxing', 'nfl'];
    if (allApiPrefixes.some(p => eventId.startsWith(`${p}_api_`))) {
      const directResult = await this.fetchFreeSportsGameById(eventId);
      if (directResult) {
        console.log(`✅ Found parlay leg ${eventId} via direct API lookup`);
        return directResult;
      }
    }

    if (/^\d+$/.test(eventId)) {
      const footballResult = await this.fetchFootballFixtureById(eventId);
      if (footballResult) {
        console.log(`✅ Found parlay leg ${eventId} via football fixture lookup`);
        return footballResult;
      }
    }

    console.log(`⏳ Parlay leg ${eventId} not yet resolved - will retry next cycle`);
    return null;
  }

  private async fetchFootballFixtureById(fixtureId: string): Promise<FinishedMatch | null> {
    if (!fixtureId || !/^\d+$/.test(fixtureId)) return null;

    const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
    if (!apiKey) return null;

    try {
      const axios = await import('axios');
      const response = await axios.default.get('https://v3.football.api-sports.io/fixtures', {
        params: { id: fixtureId },
        headers: { 'x-apisports-key': apiKey, 'Accept': 'application/json' },
        timeout: 10000
      });

      const fixtures = response.data?.response;
      if (!Array.isArray(fixtures) || fixtures.length === 0) return null;

      const match = fixtures[0];
      const statusShort = match.fixture?.status?.short || '';
      const finishedStatuses = ['FT', 'AET', 'PEN', 'AWD', 'WO', 'CANC', 'ABD', 'PST'];

      if (!finishedStatuses.includes(statusShort)) {
        console.log(`⏳ Direct lookup: fixture ${fixtureId} status=${statusShort} (not finished)`);
        return null;
      }

      const homeTeam = match.teams?.home?.name || '';
      const awayTeam = match.teams?.away?.name || '';
      const homeScore = match.score?.fulltime?.home ?? match.goals?.home ?? 0;
      const awayScore = match.score?.fulltime?.away ?? match.goals?.away ?? 0;

      if (['CANC', 'ABD', 'PST'].includes(statusShort)) {
        console.log(`⚠️ Direct lookup: fixture ${fixtureId} ${statusShort} (${homeTeam} vs ${awayTeam}) - voiding all bets (match not completed)`);
        return {
          eventId: fixtureId,
          homeTeam,
          awayTeam,
          homeScore: 0,
          awayScore: 0,
          winner: 'draw' as const,
          status: 'void'
        };
      }

      const winner: 'home' | 'away' | 'draw' =
        homeScore > awayScore ? 'home' :
        awayScore > homeScore ? 'away' : 'draw';

      console.log(`✅ Direct lookup: fixture ${fixtureId} FINISHED (${statusShort}): ${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`);

      return {
        eventId: fixtureId,
        homeTeam,
        awayTeam,
        homeScore,
        awayScore,
        winner,
        status: 'finished'
      };
    } catch (error: any) {
      console.error(`❌ Direct fixture lookup failed for ${fixtureId}:`, error.message);
      return null;
    }
  }

  private async fetchFreeSportsGameById(extId: string): Promise<FinishedMatch | null> {
    const sportPrefixes: Record<string, { endpoint: string; apiHost: string; isMma?: boolean }> = {
      'basketball_api_': { endpoint: 'https://v1.basketball.api-sports.io/games', apiHost: 'v1.basketball.api-sports.io' },
      'ice-hockey_api_': { endpoint: 'https://v1.hockey.api-sports.io/games', apiHost: 'v1.hockey.api-sports.io' },
      'baseball_api_': { endpoint: 'https://v1.baseball.api-sports.io/games', apiHost: 'v1.baseball.api-sports.io' },
      'handball_api_': { endpoint: 'https://v1.handball.api-sports.io/games', apiHost: 'v1.handball.api-sports.io' },
      'volleyball_api_': { endpoint: 'https://v1.volleyball.api-sports.io/games', apiHost: 'v1.volleyball.api-sports.io' },
      'rugby_api_': { endpoint: 'https://v1.rugby.api-sports.io/games', apiHost: 'v1.rugby.api-sports.io' },
      'american-football_api_': { endpoint: 'https://v1.american-football.api-sports.io/games', apiHost: 'v1.american-football.api-sports.io' },
      'nfl_api_': { endpoint: 'https://v1.american-football.api-sports.io/games', apiHost: 'v1.american-football.api-sports.io' },
      'afl_api_': { endpoint: 'https://v1.afl.api-sports.io/games', apiHost: 'v1.afl.api-sports.io' },
      'mma_api_': { endpoint: 'https://v1.mma.api-sports.io/fights', apiHost: 'v1.mma.api-sports.io', isMma: true },
      'boxing_api_': { endpoint: 'https://v1.mma.api-sports.io/fights', apiHost: 'v1.mma.api-sports.io', isMma: true },
    };

    let matchedPrefix = '';
    let gameId = '';
    for (const prefix of Object.keys(sportPrefixes)) {
      if (extId.startsWith(prefix)) {
        matchedPrefix = prefix;
        gameId = extId.slice(prefix.length);
        break;
      }
    }
    if (!matchedPrefix || !gameId || !/^\d+$/.test(gameId)) return null;

    const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
    if (!apiKey) return null;

    try {
      const config = sportPrefixes[matchedPrefix];
      const axios = await import('axios');
      const response = await axios.default.get(config.endpoint, {
        params: { id: gameId },
        headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': config.apiHost, 'Accept': 'application/json' },
        timeout: 10000
      });

      const games = response.data?.response;
      if (!Array.isArray(games) || games.length === 0) return null;

      const game = games[0];
      const statusShort = (game.status?.short || '').toUpperCase();
      const statusLong = (game.status?.long || '').toLowerCase();
      const finishedShort = ['FT', 'AOT', 'AP', 'AET', 'PEN'];
      const partialKeywords = ['set 1', 'set 2', 'set 3', 'set 4', 'set 5',
        '1st set', '2nd set', '3rd set', '4th set', '5th set',
        '1st quarter', '2nd quarter', '3rd quarter', '4th quarter',
        '1st half', '2nd half', '1st period', '2nd period', '3rd period',
        'quarter', 'halftime', 'half time', 'break', 'intermission'];
      const isPartialStatus = partialKeywords.some(kw => statusLong.includes(kw));
      const isFinished = !isPartialStatus && (
                         finishedShort.includes(statusShort) ||
                         statusLong === 'finished' ||
                         statusLong === 'ended' ||
                         statusLong === 'game finished' ||
                         statusLong === 'match finished' ||
                         statusLong.includes('after over time') ||
                         statusLong.includes('after overtime') ||
                         statusLong.includes('after penalties') ||
                         statusLong.includes('after extra time') ||
                         statusLong.includes('decided by') ||
                         statusLong === 'final' ||
                         statusLong === 'game over');

      if (!isFinished) {
        console.log(`⏳ Free sport direct lookup: ${extId} status=${statusShort}/${statusLong} (not finished)`);
        return null;
      }

      let homeTeam = '';
      let awayTeam = '';
      let homeScore = 0;
      let awayScore = 0;
      let winner: 'home' | 'away' | 'draw' = 'draw';

      if (config.isMma) {
        homeTeam = game.fighters?.home?.name || game.fighters?.first?.name || game.home?.name || 'Fighter 1';
        awayTeam = game.fighters?.away?.name || game.fighters?.second?.name || game.away?.name || 'Fighter 2';
        const winnerName = game.winner?.name || game.winner || '';
        const winnerStr = typeof winnerName === 'object' ? JSON.stringify(winnerName) : String(winnerName);
        const winnerId = game.winner?.id || game.winnerId || '';
        const homeId = game.fighters?.home?.id || game.fighters?.first?.id || '';
        const awayId = game.fighters?.away?.id || game.fighters?.second?.id || '';
        const isNoContest = statusLong.includes('no contest') || winnerStr.toLowerCase() === 'no contest';
        const isDraw = statusLong.includes('draw') || winnerStr.toLowerCase() === 'draw';
        if (isNoContest || isDraw) {
          winner = 'draw';
        } else if (winnerId && homeId && String(winnerId) === String(homeId)) {
          homeScore = 1; awayScore = 0; winner = 'home';
        } else if (winnerId && awayId && String(winnerId) === String(awayId)) {
          homeScore = 0; awayScore = 1; winner = 'away';
        } else if (winnerStr && winnerStr.length > 1 && homeTeam && winnerStr.toLowerCase().includes(homeTeam.split(' ').pop()!.toLowerCase())) {
          homeScore = 1; awayScore = 0; winner = 'home';
        } else if (winnerStr && winnerStr.length > 1 && awayTeam && winnerStr.toLowerCase().includes(awayTeam.split(' ').pop()!.toLowerCase())) {
          homeScore = 0; awayScore = 1; winner = 'away';
        } else if (winnerStr && winnerStr.length > 1) {
          const normWinner = winnerStr.toLowerCase().trim();
          const normHome = homeTeam.toLowerCase().trim();
          const normAway = awayTeam.toLowerCase().trim();
          if (normWinner === normHome || normHome.includes(normWinner) || normWinner.includes(normHome)) {
            homeScore = 1; awayScore = 0; winner = 'home';
          } else if (normWinner === normAway || normAway.includes(normWinner) || normWinner.includes(normAway)) {
            homeScore = 0; awayScore = 1; winner = 'away';
          } else {
            console.log(`⚠️ MMA/Boxing winner unclear for ${homeTeam} vs ${awayTeam}: winner=${winnerStr}`);
            return null;
          }
        } else {
          console.log(`⏳ MMA/Boxing no winner data yet for ${homeTeam} vs ${awayTeam} — skipping`);
          return null;
        }
      } else {
        homeTeam = game.teams?.home?.name || '';
        awayTeam = game.teams?.away?.name || '';
        if (extId.startsWith('volleyball_')) {
          const vSets = extractVolleyballSetsWon(game.scores?.home, game.scores?.away);
          if (vSets) {
            [homeScore, awayScore] = vSets;
          } else {
            console.log(`⚠️ Free sport direct lookup: ${extId} volleyball scores missing — skipping`);
            return null;
          }
        } else {
          const parsedHome = extractNumericScore(game.scores?.home);
          const parsedAway = extractNumericScore(game.scores?.away);
          if (parsedHome == null && parsedAway == null) {
            console.log(`⚠️ Free sport direct lookup: ${extId} scores are null/missing (${homeTeam} vs ${awayTeam}) — incomplete data, skipping`);
            return null;
          }
          homeScore = parsedHome ?? 0;
          awayScore = parsedAway ?? 0;
        }
        winner = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
      }

      console.log(`✅ Free sport direct lookup: ${extId} FINISHED (${statusShort}): ${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`);

      return { eventId: extId, homeTeam, awayTeam, homeScore, awayScore, winner, status: 'finished' };
    } catch (error: any) {
      console.error(`❌ Free sport direct lookup failed for ${extId}:`, error.message);
      return null;
    }
  }

  private async fetchHorseRacingResultById(extId: string): Promise<FinishedMatch | null> {
    const rapidApiKey = process.env.RAPIDAPI_KEY || '';
    if (!rapidApiKey) {
      console.log(`🏇 Horse racing settlement skipped: no RAPIDAPI_KEY`);
      return null;
    }

    let raceId = '';
    if (extId.startsWith('horse-racing_')) {
      raceId = extId.replace('horse-racing_', '');
    } else {
      const racMatch = extId.match(/rac_(\w+)/);
      if (racMatch) raceId = racMatch[1];
    }
    if (!raceId) return null;

    try {
      const axios = await import('axios');
      const response = await axios.default.get(`https://the-racing-api1.p.rapidapi.com/v1/results/${raceId}`, {
        headers: {
          'x-rapidapi-host': 'the-racing-api1.p.rapidapi.com',
          'x-rapidapi-key': rapidApiKey,
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const result = response.data?.result || response.data?.results?.[0] || response.data;
      if (!result) {
        console.log(`🏇 Horse racing result not available yet for ${extId}`);
        return null;
      }

      const runners = result.runners || [];
      const winnerRunner = runners.find((r: any) => {
        const pos = String(r.position || r.finish_position || '').trim();
        return pos === '1' || pos === '1st';
      });

      if (!winnerRunner) {
        console.log(`🏇 Horse racing result for ${extId}: no winner found yet (race may not be finished)`);
        return null;
      }

      const winnerName = winnerRunner.horse || winnerRunner.name || 'Unknown Winner';
      const raceName = result.race_name || result.race || 'Race';
      const course = result.course || '';

      console.log(`✅ 🏇 Horse racing result: ${extId} — Winner: ${winnerName} at ${course} (${raceName})`);

      return {
        eventId: extId,
        homeTeam: winnerName,
        awayTeam: `${course} - ${raceName}`,
        homeScore: 1,
        awayScore: 0,
        winner: 'home',
        status: 'finished'
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`🏇 Horse racing results not found for ${extId} (race may not have run yet)`);
      } else {
        console.error(`❌ Horse racing result fetch failed for ${extId}:`, error.message);
      }
      return null;
    }
  }

  private async fetchFreeSportsGameByTeams(extId: string, homeTeam: string, awayTeam: string): Promise<FinishedMatch | null> {
    const sportMap: Record<string, { endpoint: string; apiHost: string }> = {
      'basketball': { endpoint: 'https://v1.basketball.api-sports.io/games', apiHost: 'v1.basketball.api-sports.io' },
      'ice-hockey': { endpoint: 'https://v1.hockey.api-sports.io/games', apiHost: 'v1.hockey.api-sports.io' },
      'baseball': { endpoint: 'https://v1.baseball.api-sports.io/games', apiHost: 'v1.baseball.api-sports.io' },
      'handball': { endpoint: 'https://v1.handball.api-sports.io/games', apiHost: 'v1.handball.api-sports.io' },
      'volleyball': { endpoint: 'https://v1.volleyball.api-sports.io/games', apiHost: 'v1.volleyball.api-sports.io' },
      'rugby': { endpoint: 'https://v1.rugby.api-sports.io/games', apiHost: 'v1.rugby.api-sports.io' },
      'american-football': { endpoint: 'https://v1.american-football.api-sports.io/games', apiHost: 'v1.american-football.api-sports.io' },
      'nfl': { endpoint: 'https://v1.american-football.api-sports.io/games', apiHost: 'v1.american-football.api-sports.io' },
      'afl': { endpoint: 'https://v1.afl.api-sports.io/games', apiHost: 'v1.afl.api-sports.io' },
    };

    let sportSlug = extId.split('_api_')[0];
    const config = sportMap[sportSlug];
    if (!config) return null;

    const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
    if (!apiKey) return null;

    try {
      const today = new Date();
      const dates = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
      }

      const normalize = (name: string) => name.toLowerCase().trim()
        .replace(/\b(fc|sc|cf|afc|united|utd|city|town|athletic|ath|sporting|sp|de)\b/gi, ' ')
        .replace(/\s+/g, ' ').trim();

      const betHome = normalize(homeTeam);
      const betAway = normalize(awayTeam);

      for (const dateStr of dates) {
        const axios = await import('axios');
        const response = await axios.default.get(config.endpoint, {
          params: { date: dateStr, timezone: 'UTC' },
          headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': config.apiHost },
          timeout: 10000
        });

        const games = response.data?.response || [];
        for (const game of games) {
          const statusShort = (game.status?.short || '').toUpperCase();
          const statusLong = (game.status?.long || '').toLowerCase();
          const isGameFinished = ['FT', 'AOT', 'AP', 'AET', 'PEN'].includes(statusShort) ||
                                 statusLong.includes('finished') || statusLong.includes('ended') ||
                                 statusLong.includes('final') || statusLong.includes('after over time');
          if (!isGameFinished) continue;

          const gHome = normalize(game.teams?.home?.name || '');
          const gAway = normalize(game.teams?.away?.name || '');

          const match = (gHome === betHome && gAway === betAway) ||
            (gAway === betHome && gHome === betAway);

          if (match) {
            const homeScore = extractNumericScore(game.scores?.home) ?? 0;
            const awayScore = extractNumericScore(game.scores?.away) ?? 0;
            const winner: 'home' | 'away' | 'draw' =
              homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
            console.log(`✅ SF team lookup: ${extId} → ${game.teams?.home?.name} ${homeScore}-${awayScore} ${game.teams?.away?.name}`);
            return { eventId: extId, homeTeam: game.teams?.home?.name || homeTeam, awayTeam: game.teams?.away?.name || awayTeam, homeScore, awayScore, winner, status: 'finished' };
          }
        }
      }
      return null;
    } catch (error: any) {
      console.error(`❌ SF team lookup failed for ${extId}:`, error.message);
      return null;
    }
  }


  private async settleParlaySingleBet(bet: UnsettledBet, match: FinishedMatch, isWinner: boolean) {
    // DUPLICATE SETTLEMENT PREVENTION: Skip if already settled this session
    if (this.settledBetIds.has(bet.id)) {
      console.log(`⚠️ SKIPPING: Parlay bet ${bet.id} already processed this session`);
      return;
    }
    
    const grossPayout = isWinner ? bet.potentialWin : 0;
    const profit = isWinner ? (grossPayout - bet.stake) : 0;
    const platformFee = profit > 0 ? profit * 0.01 : 0;
    
    // DEFENSE-IN-DEPTH: Payout cap at parlay settlement
    const PARLAY_SETTLE_MAX_SBETS = 15_000_000;
    const PARLAY_SETTLE_MAX_SUI = 150;
    const parlaySettleMax = bet.currency === 'SBETS' ? PARLAY_SETTLE_MAX_SBETS : PARLAY_SETTLE_MAX_SUI;
    if (isWinner && grossPayout > parlaySettleMax) {
      console.error(`🚨 PARLAY SETTLEMENT CAP BREACH: Bet ${bet.id} grossPayout=${grossPayout} ${bet.currency} > max ${parlaySettleMax} — AUTO-VOIDING`);
      await storage.updateBetStatus(bet.id, 'void', 0);
      this.settledBetIds.add(bet.id);
      return;
    }
    
    // Check for on-chain bet
    const hasOnChainBet = bet.betObjectId && blockchainBetService.isAdminKeyConfigured();
    const isSbetsOnChainBet = bet.currency === 'SBETS' && hasOnChainBet;
    const isSuiOnChainBet = bet.currency === 'SUI' && hasOnChainBet;
    const isUsdsuiOnChainBet = bet.currency === 'USDSUI' && hasOnChainBet;
    
    const isGiftParlay = !!bet.giftedTo && bet.giftedTo !== bet.userId;
    
    if ((isSuiOnChainBet || isSbetsOnChainBet || isUsdsuiOnChainBet) && !isGiftParlay) {
      console.log(`🔗 ON-CHAIN PARLAY SETTLEMENT: Bet ${bet.id.slice(0, 10)}... via smart contract`);
      
      const onChainInfo = await blockchainBetService.getOnChainBetInfo(bet.betObjectId!);
      if (onChainInfo?.settled) {
        console.log(`⚠️ PARLAY ALREADY SETTLED ON-CHAIN: ${bet.betObjectId} - contract handled payout, updating database`);
        const finalStatus = isWinner ? 'paid_out' : 'lost';
        await storage.updateBetStatus(bet.id, finalStatus, grossPayout, `contract-settled-parlay-${bet.betObjectId?.slice(0,16)}`);
        this.settledBetIds.add(bet.id);
        return;
      }
      
      if (!onChainInfo) {
        console.warn(`⚠️ PARLAY BET OBJECT NOT FOUND ON-CHAIN: ${bet.betObjectId} - will retry next cycle`);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const settlementResult = isSbetsOnChainBet
        ? await blockchainBetService.executeSettleBetSbetsOnChain(bet.betObjectId!, isWinner)
        : isUsdsuiOnChainBet
        ? await blockchainBetService.executeSettleBetUsdsuiOnChain(bet.betObjectId!, isWinner)
        : await blockchainBetService.executeSettleBetOnChain(bet.betObjectId!, isWinner);
      
      if (settlementResult.success) {
        const finalStatus = isWinner ? 'paid_out' : 'lost';
        const statusUpdated = await storage.updateBetStatus(bet.id, finalStatus, grossPayout, settlementResult.txHash);
        if (statusUpdated) {
          console.log(`✅ ON-CHAIN PARLAY SETTLED: ${bet.id.slice(0, 10)}... ${finalStatus} (${bet.currency}) | TX: ${settlementResult.txHash}`);
          this.settledBetIds.add(bet.id);
        }
        return;
      } else {
        console.error(`❌ ON-CHAIN PARLAY SETTLEMENT FAILED (${bet.currency}): ${settlementResult.error}`);
        if (settlementResult.error?.includes('cannot settle owned objects')) {
          console.warn(`🛑 PARLAY PERMANENTLY SKIPPED (owned object): Bet ${bet.id}`);
          this.ownedBetIds.add(bet.id);
          await storage.updateBetStatus(bet.id, isWinner ? 'won' : 'lost', grossPayout);
          this.settledBetIds.add(bet.id);
          return;
        }
        const onChainRecheck = await blockchainBetService.getOnChainBetInfo(bet.betObjectId!);
        if (onChainRecheck?.settled) {
          console.log(`⚠️ PARLAY ACTUALLY SETTLED ON-CHAIN (recheck): ${bet.betObjectId}`);
          const finalStatus = isWinner ? 'paid_out' : 'lost';
          await storage.updateBetStatus(bet.id, finalStatus, grossPayout, `contract-settled-parlay-${bet.betObjectId?.slice(0,16)}`);
          this.settledBetIds.add(bet.id);
          return;
        }
        if (isWinner) {
          console.warn(`⚠️ PARLAY WINNER PAYOUT DEFERRED: Bet ${bet.id} - keeping as 'won' for retry (do NOT mark as lost)`);
          await storage.updateBetStatus(bet.id, 'won', grossPayout);
        } else {
          await storage.updateBetStatus(bet.id, 'lost', 0);
        }
        this.settledBetIds.add(bet.id);
        return;
      }
    }
    
    // Off-chain fallback
    const finalStatus = isWinner ? 'paid_out' : 'lost';
    const statusUpdated = await storage.updateBetStatus(bet.id, finalStatus, grossPayout);
    if (statusUpdated) {
      console.log(`✅ OFF-CHAIN PARLAY SETTLED: ${bet.id.slice(0, 10)}... ${finalStatus}`);
      this.settledBetIds.add(bet.id);
    }
  }
  
  private evaluateLegPrediction(prediction: string, match: FinishedMatch, marketId?: string, outcomeId?: string): boolean {
    const pred = prediction.toLowerCase().trim();
    const homeTeam = match.homeTeam.toLowerCase();
    const awayTeam = match.awayTeam.toLowerCase();

    const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normName = (n: string) => {
      let s = stripDiacritics(n.toLowerCase().trim());
      s = s.replace(/\s+w$/i, '');
      s = s.replace(/\b(fc|sc|cf|afc|ac|as|us|rc|cr|mo|usm|united|utd|city|town|athletic|ath|sporting|sp|de|1860|1899|1903|1904|1907|1908|1911|1912|1919|1920|1921|1923|1925|1930|1936|1938|1940|1945|1947|1948|1950|1954|1956|1958|1960|1963|1964|1965|1966|1967|1968|1970|1971|1972|1973|1974|1976|1978|1980|1989|1994|1996|1998|1999|2000|2002|2005|2006|2007|2008|2009|2010|2011|2012|2013|2014|2015|2016|2017|2018|2019|2020)\b/gi, ' ');
      s = s.replace(/[''`ʼ]/g, '');
      return s.replace(/\s+/g, ' ').trim();
    };

    const normHomeTeam = normName(homeTeam);
    const normAwayTeam = normName(awayTeam);

    const fuzzyTeamMatch = (predText: string, teamNorm: string): boolean => {
      const predNorm = normName(predText);
      if (predNorm === teamNorm) return true;
      if (predNorm.includes(teamNorm) || teamNorm.includes(predNorm)) return true;
      const predWords = predNorm.split(/\s+/).filter(w => w.length > 2);
      const teamWords = teamNorm.split(/\s+/).filter(w => w.length > 2);
      if (predWords.length === 0 || teamWords.length === 0) return false;
      const matchCount = teamWords.filter(tw => predWords.some(pw => pw === tw || pw.includes(tw) || tw.includes(pw))).length;
      return matchCount >= Math.max(1, Math.ceil(teamWords.length * 0.5));
    };

    const teamMatchesHome = (text: string) => {
      const t = text.toLowerCase().trim();
      const nt = normName(t);
      return t.includes(homeTeam) || homeTeam.includes(t) ||
        nt === normHomeTeam || normHomeTeam.includes(nt) || nt.includes(normHomeTeam) ||
        fuzzyTeamMatch(t, normHomeTeam) ||
        t === 'home' || t === '1';
    };
    const teamMatchesAway = (text: string) => {
      const t = text.toLowerCase().trim();
      const nt = normName(t);
      return t.includes(awayTeam) || awayTeam.includes(t) ||
        nt === normAwayTeam || normAwayTeam.includes(nt) || nt.includes(normAwayTeam) ||
        fuzzyTeamMatch(t, normAwayTeam) ||
        t === 'away' || t === '2';
    };

    // Handle Double Chance market (dc_1x, dc_12, dc_x2)
    if (marketId === '3' || outcomeId?.startsWith('dc_')) {
      const outcome = outcomeId || '';
      if (outcome === 'dc_1x' || outcome === 'dc_home_or_draw' || outcome.includes('home or draw')) {
        const teamPart = pred.replace(/\s*or\s*draw\s*/i, '').trim();
        if (teamPart && teamMatchesAway(teamPart) && !teamMatchesHome(teamPart)) {
          console.log(`🔄 DC correction: "${prediction}" actually matches away team "${match.awayTeam}" → treating as away-or-draw`);
          return match.winner === 'draw' || match.winner === 'away';
        }
        return match.winner === 'home' || match.winner === 'draw';
      }
      if (outcome === 'dc_12' || outcome.includes('home or away')) {
        return match.winner === 'home' || match.winner === 'away';
      }
      if (outcome === 'dc_x2' || outcome.includes('draw or away')) {
        return match.winner === 'draw' || match.winner === 'away';
      }
    }

    // Double Chance by prediction text — check BEFORE match winner
    if (pred.includes('or draw')) {
      const teamPart = pred.replace(/\s*or\s*draw\s*/i, '').trim();
      const matchesHome = teamMatchesHome(teamPart);
      const matchesAway = teamMatchesAway(teamPart);
      if (matchesHome && !matchesAway) {
        console.log(`🎯 DC text match: "${prediction}" → home or draw (${match.homeTeam})`);
        return match.winner === 'home' || match.winner === 'draw';
      }
      if (matchesAway && !matchesHome) {
        console.log(`🎯 DC text match: "${prediction}" → draw or away (${match.awayTeam})`);
        return match.winner === 'draw' || match.winner === 'away';
      }
      if (matchesHome && matchesAway) {
        const normTeam = normName(teamPart);
        const homeOverlap = normTeam.split(/\s+/).filter((w: string) => normHomeTeam.split(/\s+/).includes(w)).length;
        const awayOverlap = normTeam.split(/\s+/).filter((w: string) => normAwayTeam.split(/\s+/).includes(w)).length;
        if (homeOverlap >= awayOverlap) {
          console.log(`🎯 DC overlap match: "${prediction}" → home or draw (overlap home=${homeOverlap} away=${awayOverlap})`);
          return match.winner === 'home' || match.winner === 'draw';
        }
        console.log(`🎯 DC overlap match: "${prediction}" → draw or away (overlap home=${homeOverlap} away=${awayOverlap})`);
        return match.winner === 'draw' || match.winner === 'away';
      }
      console.log(`🎯 DC fallback: "${prediction}" → treating as home or draw`);
      return match.winner === 'home' || match.winner === 'draw';
    }

    // Match Winner
    const normPred = normName(pred);
    const strippedPred = stripDiacritics(pred);
    const strippedHome = stripDiacritics(homeTeam);
    const strippedAway = stripDiacritics(awayTeam);
    const matchesHomeLeg = pred.includes(homeTeam) || homeTeam.includes(pred) ||
        strippedPred.includes(strippedHome) || strippedHome.includes(strippedPred) ||
        normPred === normHomeTeam || normHomeTeam.includes(normPred) || normPred.includes(normHomeTeam) ||
        fuzzyTeamMatch(pred, normHomeTeam) ||
        pred === 'home' || pred === '1';
    const matchesAwayLeg = pred.includes(awayTeam) || awayTeam.includes(pred) ||
        strippedPred.includes(strippedAway) || strippedAway.includes(strippedPred) ||
        normPred === normAwayTeam || normAwayTeam.includes(normPred) || normPred.includes(normAwayTeam) ||
        fuzzyTeamMatch(pred, normAwayTeam) ||
        pred === 'away' || pred === '2';

    if (matchesHomeLeg && !matchesAwayLeg) {
      return match.winner === 'home';
    }
    if (matchesAwayLeg && !matchesHomeLeg) {
      return match.winner === 'away';
    }
    if (matchesHomeLeg && matchesAwayLeg) {
      const predWords = pred.split(/\s+/);
      const homeWords = homeTeam.split(/\s+/);
      const awayWords = awayTeam.split(/\s+/);
      const homeOverlap = predWords.filter(w => homeWords.includes(w)).length;
      const awayOverlap = predWords.filter(w => awayWords.includes(w)).length;
      if (homeOverlap > awayOverlap) return match.winner === 'home';
      if (awayOverlap > homeOverlap) return match.winner === 'away';
      console.warn(`⚠️ AMBIGUOUS PARLAY LEG: prediction="${pred}" matches both "${homeTeam}" and "${awayTeam}" equally`);
      return false;
    }
    if (pred === 'draw' || pred === 'x' || pred === 'tie') {
      return match.winner === 'draw';
    }

    // Odd/Even (full game total)
    if (pred === 'odd') {
      return (match.homeScore + match.awayScore) % 2 === 1;
    }
    if (pred === 'even') {
      return (match.homeScore + match.awayScore) % 2 === 0;
    }

    // SAFETY: Reject period/team-specific markets we cannot settle correctly
    const unsettleableKw = [
      '1st half', '2nd half', '1st quarter', '2nd quarter', '3rd quarter', '4th quarter',
      '1st period', '2nd period', '3rd period', '1st set', '2nd set', '3rd set',
      'home total', 'away total', 'home team total', 'away team total',
      'highest scoring', 'handicap result', 'asian handicap',
    ];
    if (unsettleableKw.some(kw => pred.includes(kw))) {
      console.warn(`⚠️ UNSETTLEABLE PARLAY LEG: prediction="${pred}" — defaulting to LOSS`);
      return false;
    }

    const handicapPattern = /^(home|away|draw|1|2|x)\s*[+-]\d+(\.\d+)?$/i;
    if (handicapPattern.test(pred)) {
      console.warn(`⚠️ UNSETTLEABLE PARLAY HANDICAP: prediction="${pred}" — no handicap handler`);
      return false;
    }

    // Over/Under predictions (full game total only — period-specific blocked above)
    const totalGoals = match.homeScore + match.awayScore;
    if (pred.includes('over')) {
      const threshold = parseFloat(pred.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals > threshold;
    }
    if (pred.includes('under')) {
      const threshold = parseFloat(pred.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals < threshold;
    }

    // Both Teams To Score (BTTS)
    if (pred === 'yes' || pred.includes('btts yes') || pred.includes('both teams to score: yes')) {
      return match.homeScore > 0 && match.awayScore > 0;
    }
    if (pred === 'no' || pred.includes('btts no') || pred.includes('both teams to score: no')) {
      return match.homeScore === 0 || match.awayScore === 0;
    }

    // Correct Score predictions (e.g., "1-0", "2-1", "0-0")
    const correctScoreMatch = pred.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (correctScoreMatch) {
      const predictedHome = parseInt(correctScoreMatch[1], 10);
      const predictedAway = parseInt(correctScoreMatch[2], 10);
      return match.homeScore === predictedHome && match.awayScore === predictedAway;
    }

    return false;
  }

  private async getFinishedMatches(pendingBets: UnsettledBet[]): Promise<FinishedMatch[]> {
    if (this.finishedMatchesCache && 
        (Date.now() - this.finishedMatchesCache.timestamp) < this.finishedMatchesCacheTTL) {
      console.log('📦 SettlementWorker: Using cached finished matches');
      return this.finishedMatchesCache.data;
    }
    
    const seenIds = new Set<string>();
    const finishedMatches: FinishedMatch[] = [];

    const addUnique = (matches: FinishedMatch[]) => {
      for (const m of matches) {
        if (!seenIds.has(m.eventId)) {
          seenIds.add(m.eventId);
          finishedMatches.push(m);
        }
      }
    };
    
    try {
      try {
        addUnique(await this.fetchFinishedForSport('football'));
      } catch (error) {}

      let neededSports = this.detectNeededFreeSports(pendingBets);
      if (neededSports.length > 0) {
        try {
          const apiResults = await this.fetchFreeSportsResults(neededSports);
          addUnique(apiResults);
        } catch (error) {
          console.error('⚠️ Free sports API results fetch failed:', error);
        }

      }

      addUnique(this.cachedFreeSportsResults);

      this.finishedMatchesCache = {
        data: finishedMatches,
        timestamp: Date.now()
      };

      return finishedMatches;
    } catch (error) {
      console.error('Error fetching finished matches:', error);
      return [];
    }
  }

  private detectNeededFreeSports(pendingBets: UnsettledBet[]): string[] {
    const sportSlugs = new Set<string>();
    const allSlugs = Object.keys(FREE_SPORTS_SETTLEMENT_CONFIG);

    const NBA_TEAMS = ['hawks','celtics','nets','hornets','bulls','cavaliers','mavericks','nuggets','pistons','warriors','rockets','pacers','clippers','lakers','grizzlies','heat','bucks','timberwolves','pelicans','knicks','thunder','magic','76ers','suns','trail blazers','blazers','kings','spurs','raptors','jazz','wizards'];
    const NHL_TEAMS = ['ducks','coyotes','bruins','sabres','flames','hurricanes','blackhawks','avalanche','blue jackets','stars','red wings','oilers','panthers','kings','wild','canadiens','predators','devils','islanders','rangers','senators','flyers','penguins','sharks','kraken','blues','lightning','maple leafs','canucks','golden knights','capitals','jets','mammoth'];
    const MLB_TEAMS = ['diamondbacks','braves','orioles','red sox','cubs','white sox','reds','guardians','rockies','tigers','astros','royals','angels','dodgers','marlins','brewers','twins','mets','yankees','athletics','phillies','pirates','padres','giants','mariners','cardinals','rays','rangers','blue jays','nationals'];

    let unmatchedCount = 0;

    for (const bet of pendingBets) {
      const extId = bet.externalEventId || '';
      if (!extId || (!bet.homeTeam && !bet.awayTeam)) {
        continue;
      }
      if (extId.startsWith('boxing_')) {
        sportSlugs.add('mma');
        continue;
      }
      if (/^\d+$/.test(extId)) {
        sportSlugs.add('football');
        continue;
      }
      let matched = false;
      for (const prefix of allSlugs) {
        if (extId.startsWith(`${prefix}_`) || extId.startsWith(`${prefix}-`)) {
          sportSlugs.add(prefix);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const teams = `${bet.homeTeam} ${bet.awayTeam}`.toLowerCase();
        if (NBA_TEAMS.some(t => teams.includes(t))) {
          sportSlugs.add('basketball');
        } else if (NHL_TEAMS.some(t => teams.includes(t))) {
          sportSlugs.add('ice-hockey');
        } else if (MLB_TEAMS.some(t => teams.includes(t))) {
          sportSlugs.add('baseball');
        } else {
          unmatchedCount++;
          console.log(`⚠️ SettlementWorker: Could not detect sport for bet: "${bet.homeTeam} vs ${bet.awayTeam}" (extId: ${extId})`);
        }
      }
    }

    if (unmatchedCount > 0) {
      console.log(`🔄 SettlementWorker: ${unmatchedCount} bets with unknown sport — fetching ALL sports to ensure settlement`);
      for (const slug of allSlugs) {
        sportSlugs.add(slug);
      }
    }

    if (sportSlugs.size === 0 && pendingBets.length > 0) {
      console.log(`🔄 SettlementWorker: No sports detected but ${pendingBets.length} pending bets — fetching ALL sports`);
      for (const slug of allSlugs) {
        sportSlugs.add(slug);
      }
    }

    if (sportSlugs.size === 0) {
      return [];
    }

    console.log(`🏀 SettlementWorker: Pending bets need results for: ${[...sportSlugs].join(', ')}`);
    return [...sportSlugs];
  }

  private async fetchFreeSportsResults(neededSports: string[]): Promise<FinishedMatch[]> {
    if (this.freeSportsResultsCache &&
        (Date.now() - this.freeSportsResultsCache.timestamp) < this.freeSportsResultsCacheTTL) {
      return this.freeSportsResultsCache.data;
    }

    try {
      const cached = this.loadFreeSportsResultsFromFile();
      if (cached) {
        this.freeSportsResultsCache = cached;
        return cached.data;
      }
    } catch (e) {}

    const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
    if (!apiKey) return [];

    const results: FinishedMatch[] = [];
    const seenIds = new Set<string>();
    const today = new Date();
    const datesToCheck: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      datesToCheck.push(d.toISOString().split('T')[0]);
    }

    const sportsToFetch = neededSports
      .filter(s => FREE_SPORTS_SETTLEMENT_CONFIG[s])
      .map(s => [s, FREE_SPORTS_SETTLEMENT_CONFIG[s]] as const);

    console.log(`🏀 SettlementWorker: Fetching results for ${sportsToFetch.map(([s]) => s).join(', ')} (${datesToCheck.join(', ')})...`);

    for (const [sportSlug, config] of sportsToFetch) {
      for (const dateStr of datesToCheck) {
        try {
          const response = await axios.get(config.endpoint, {
            params: { date: dateStr, timezone: 'UTC' },
            headers: {
              'x-apisports-key': apiKey,
              'x-rapidapi-key': apiKey,
              'x-rapidapi-host': config.apiHost,
              'Accept': 'application/json'
            },
            timeout: 10000
          });

          if (response.status === 429) {
            console.warn(`⚠️ Rate limited on ${config.name} - skipping remaining dates`);
            break;
          }

          const games = response.data?.response || [];
          if (sportSlug === 'mma' && games.length > 0) {
            const sample = games.find((g: any) => (g.status?.long || '').toLowerCase().includes('finish')) || games[0];
            console.log(`🔍 MMA API debug (${dateStr}): ${games.length} fights, sample keys: ${Object.keys(sample).join(',')}, winner: ${JSON.stringify(sample.winner)}, fighters: ${JSON.stringify(sample.fighters)}, status: ${JSON.stringify(sample.status)}`);
          }

          for (const game of games) {
            const status = game.status?.long || game.status?.short || '';
            const statusLower = status.toLowerCase();
            const statusShort = (game.status?.short || '').toUpperCase();
            const batchPartialKeywords = ['set 1', 'set 2', 'set 3', 'set 4', 'set 5',
              '1st set', '2nd set', '3rd set', '4th set', '5th set',
              '1st quarter', '2nd quarter', '3rd quarter', '4th quarter',
              '1st half', '2nd half', '1st period', '2nd period', '3rd period',
              'quarter', 'halftime', 'half time', 'break', 'intermission'];
            const isBatchPartial = batchPartialKeywords.some(kw => statusLower.includes(kw));
            const isFinished = !isBatchPartial && (
                              statusLower === 'finished' ||
                              statusLower === 'ended' ||
                              statusLower === 'game finished' ||
                              statusLower === 'match finished' ||
                              statusLower === 'final' ||
                              statusLower === 'game over' ||
                              statusLower.includes('retired') ||
                              statusLower.includes('walkover') ||
                              statusLower.includes('no contest') ||
                              statusLower.includes('after over time') ||
                              statusLower.includes('after overtime') ||
                              statusLower.includes('after penalties') ||
                              statusLower.includes('after extra time') ||
                              statusLower.includes('decided by') ||
                              statusShort === 'FT' || statusShort === 'AET' || statusShort === 'PEN' ||
                              statusShort === 'AOT' || statusShort === 'AP');

            if (!isFinished) continue;

            let effectiveSlug = sportSlug;
            if (sportSlug === 'mma') {
              const slug = (game.slug || '').toLowerCase();
              const MMA_ORGS = ['ufc', 'bellator', 'one championship', 'one fc', 'pfl', 'cage warriors', 'ksw', 'rizin', 'invicta', 'lfa', 'bkfc', 'eagle fc', 'ares', 'oktagon'];
              const isMmaOrg = MMA_ORGS.some(org => slug.includes(org));
              const isBoxing = slug.includes('boxing') || slug.includes('pbc') || slug.includes('showtime') || slug.includes('top rank') || slug.includes('golden boy') || slug.includes('matchroom');
              if (isBoxing || (!isMmaOrg && (game.category || '').toLowerCase().includes('boxing'))) {
                effectiveSlug = 'boxing';
              }
            }

            const resolvedGameId = game.id ?? game.game?.id;
            if (!resolvedGameId) continue;
            const eventId = `${effectiveSlug}_api_${resolvedGameId}`;
            const legacyEventId = `${effectiveSlug}_${resolvedGameId}`;
            if (seenIds.has(eventId)) continue;
            seenIds.add(eventId);
            seenIds.add(legacyEventId);

            let homeTeam = '';
            let awayTeam = '';
            let homeScore = 0;
            let awayScore = 0;
            let winner: 'home' | 'away' | 'draw' = 'draw';

            if (effectiveSlug === 'mma' || effectiveSlug === 'boxing') {
              homeTeam = game.fighters?.home?.name || game.fighters?.first?.name || game.home?.name || 'Fighter 1';
              awayTeam = game.fighters?.away?.name || game.fighters?.second?.name || game.away?.name || 'Fighter 2';
              const winnerName = game.winner?.name || game.winner || '';
              const winnerStr = typeof winnerName === 'object' ? JSON.stringify(winnerName) : String(winnerName);
              const winnerId = game.winner?.id || game.winnerId || '';
              const homeId = game.fighters?.home?.id || game.fighters?.first?.id || '';
              const awayId = game.fighters?.away?.id || game.fighters?.second?.id || '';
              const isNoContest = statusLower.includes('no contest') || winnerStr.toLowerCase() === 'no contest';
              const isDraw = statusLower.includes('draw') || winnerStr.toLowerCase() === 'draw';
              if (isNoContest) {
                results.push({
                  eventId, homeTeam, awayTeam, homeScore: 0, awayScore: 0, winner: 'draw', status: 'void'
                });
                continue;
              }
              if (isDraw) {
                homeScore = 0; awayScore = 0; winner = 'draw';
              } else if (winnerId && homeId && String(winnerId) === String(homeId)) {
                homeScore = 1; awayScore = 0; winner = 'home';
              } else if (winnerId && awayId && String(winnerId) === String(awayId)) {
                homeScore = 0; awayScore = 1; winner = 'away';
              } else if (winnerStr && winnerStr.length > 1 && homeTeam && winnerStr.toLowerCase().includes(homeTeam.split(' ').pop()!.toLowerCase())) {
                homeScore = 1; awayScore = 0; winner = 'home';
              } else if (winnerStr && winnerStr.length > 1 && awayTeam && winnerStr.toLowerCase().includes(awayTeam.split(' ').pop()!.toLowerCase())) {
                homeScore = 0; awayScore = 1; winner = 'away';
              } else if (winnerStr && winnerStr.length > 1 && homeTeam) {
                const normWinner = winnerStr.toLowerCase().trim();
                const normHome = homeTeam.toLowerCase().trim();
                const normAway = awayTeam.toLowerCase().trim();
                if (normWinner === normHome || normHome.includes(normWinner) || normWinner.includes(normHome)) {
                  homeScore = 1; awayScore = 0; winner = 'home';
                } else if (normWinner === normAway || normAway.includes(normWinner) || normWinner.includes(normAway)) {
                  homeScore = 0; awayScore = 1; winner = 'away';
                } else {
                  console.log(`⚠️ MMA/Boxing winner unclear for ${homeTeam} vs ${awayTeam}: winner=${winnerStr}, winnerId=${winnerId}, homeId=${homeId}, awayId=${awayId}`);
                  continue;
                }
              } else if (!winnerStr || winnerStr.length <= 1) {
                console.log(`⏳ MMA/Boxing no winner data yet for ${homeTeam} vs ${awayTeam} (winnerId=${winnerId}) — skipping until API populates result`);
                continue;
              } else {
                console.log(`⚠️ MMA/Boxing winner unclear for ${homeTeam} vs ${awayTeam}: winner=${winnerStr}, winnerId=${winnerId}, homeId=${homeId}, awayId=${awayId}`);
                continue;
              }
            } else if (sportSlug === 'tennis') {
              homeTeam = game.players?.home?.name || game.teams?.home?.name || game.home?.name || 'Player 1';
              awayTeam = game.players?.away?.name || game.teams?.away?.name || game.away?.name || 'Player 2';
              if (statusLower.includes('walkover') || statusLower.includes('retired')) {
                const winnerName = game.winner?.name || game.players?.winner?.name || '';
                if (winnerName && homeTeam && winnerName.toLowerCase().includes(homeTeam.toLowerCase())) {
                  homeScore = 1; awayScore = 0; winner = 'home';
                } else if (winnerName && awayTeam && winnerName.toLowerCase().includes(awayTeam.toLowerCase())) {
                  homeScore = 0; awayScore = 1; winner = 'away';
                } else {
                  homeScore = 0; awayScore = 0; winner = 'draw';
                }
              } else {
                const parsedH = extractNumericScore(game.scores?.home) ?? extractNumericScore(game.sets?.home) ?? 0;
                const parsedA = extractNumericScore(game.scores?.away) ?? extractNumericScore(game.sets?.away) ?? 0;
                homeScore = parsedH;
                awayScore = parsedA;
                winner = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
              }
            } else if (sportSlug === 'formula-1') {
              homeTeam = game.driver?.name || game.team?.name || game.winner?.name || 'Winner';
              awayTeam = 'Race';
              homeScore = 1; awayScore = 0; winner = 'home';
            } else {
              homeTeam = game.teams?.home?.name || game.home?.name || 'Home';
              awayTeam = game.teams?.away?.name || game.away?.name || 'Away';
              if (sportSlug === 'volleyball') {
                const vSets = extractVolleyballSetsWon(game.scores?.home, game.scores?.away);
                if (vSets) {
                  [homeScore, awayScore] = vSets;
                } else {
                  console.log(`⚠️ Batch: Skipping volleyball ${homeTeam} vs ${awayTeam} — set scores missing`);
                  continue;
                }
              } else {
                const parsedHome = extractNumericScore(game.scores?.home);
                const parsedAway = extractNumericScore(game.scores?.away);
                if (parsedHome == null && parsedAway == null) {
                  console.log(`⚠️ Batch: Skipping ${homeTeam} vs ${awayTeam} — scores null/missing (incomplete data)`);
                  continue;
                }
                homeScore = parsedHome ?? 0;
                awayScore = parsedAway ?? 0;
              }
              winner = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
            }

            results.push({
              eventId, homeTeam, awayTeam, homeScore, awayScore, winner, status: 'finished'
            });
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error: any) {
          if (error?.response?.status === 429) {
            console.warn(`⚠️ Rate limited on ${config.name} - backing off`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            break;
          }
          console.warn(`⚠️ Error fetching ${config.name} for ${dateStr}: ${error.message}`);
        }
      }
      const sportResults = results.filter(r => r.eventId.startsWith(sportSlug) || r.eventId.startsWith('boxing'));
      if (sportResults.length > 0) {
        console.log(`  📊 ${config.name}: ${sportResults.length} finished matches found`);
      }
    }

    console.log(`🏀 SettlementWorker: Found ${results.length} finished sports matches total`);

    if (results.length > 0) {
      this.freeSportsResultsCache = { data: results, timestamp: Date.now() };
      this.saveFreeSportsResultsToFile(results);
    } else {
      this.freeSportsResultsCache = null;
    }

    return results;
  }

  private loadFreeSportsResultsFromFile(): { data: FinishedMatch[]; timestamp: number } | null {
    try {
      if (fs.existsSync(FREE_SPORTS_RESULTS_CACHE_FILE)) {
        const raw = fs.readFileSync(FREE_SPORTS_RESULTS_CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.timestamp && (Date.now() - parsed.timestamp) < this.freeSportsResultsCacheTTL) {
          console.log(`📦 SettlementWorker: Loaded ${parsed.data.length} sports results from file cache`);
          return parsed;
        }
      }
    } catch (e) {}
    return null;
  }

  private saveFreeSportsResultsToFile(results: FinishedMatch[]): void {
    try {
      fs.writeFileSync(FREE_SPORTS_RESULTS_CACHE_FILE, JSON.stringify({
        data: results,
        timestamp: Date.now()
      }));
    } catch (e) {}
  }

  private async fetchFinishedForSport(sport: string): Promise<FinishedMatch[]> {
    if (sport !== 'football' && sport !== 'soccer') {
      console.log(`⛔ BLOCKED: fetchFinishedForSport('${sport}') - only football uses paid API. Free sports use nightly cache.`);
      return [];
    }

    const finished: FinishedMatch[] = [];

    const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
    if (!apiKey) return [];

    const today = new Date();
    const datesToCheck: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      datesToCheck.push(d.toISOString().split('T')[0]);
    }
    
    const sportEndpoints: Record<string, string> = {
      football: 'https://v3.football.api-sports.io/fixtures',
    };

    const url = sportEndpoints[sport];
    if (!url) return finished;

    for (const dateStr of datesToCheck) {
      try {
        const axios = await import('axios');
        const params = sport === 'football' 
          ? { date: dateStr, status: 'FT-AET-PEN' }
          : { date: dateStr, status: 'FT' };
          
        const response = await axios.default.get(url, {
          params,
          headers: {
            'x-apisports-key': apiKey,
            'Accept': 'application/json'
          },
          timeout: 10000
        });

        if (response.data?.response && Array.isArray(response.data.response)) {
          for (const match of response.data.response) {
            const eventId = match.fixture?.id?.toString() || match.id?.toString();
            
            // Handle different sports' team/fighter naming conventions
            let homeTeam = '';
            let awayTeam = '';
            
            if (sport === 'mma' || sport === 'boxing') {
              // MMA and Boxing use 'fighters' structure
              homeTeam = match.fighters?.first?.name || match.fighters?.home?.name || match.teams?.home?.name || '';
              awayTeam = match.fighters?.second?.name || match.fighters?.away?.name || match.teams?.away?.name || '';
            } else if (sport === 'formula-1') {
              // Formula 1 uses 'driver' or 'team' structure - store race winner
              homeTeam = match.driver?.name || match.team?.name || match.winner?.name || '';
              awayTeam = 'Race'; // F1 is not home vs away
            } else {
              // All other sports use standard teams structure
              homeTeam = match.teams?.home?.name || '';
              awayTeam = match.teams?.away?.name || '';
            }
            
            let homeScore = 0;
            let awayScore = 0;
            
            if (sport === 'football') {
              homeScore = match.score?.fulltime?.home ?? match.goals?.home ?? 0;
              awayScore = match.score?.fulltime?.away ?? match.goals?.away ?? 0;
            } else if (sport === 'basketball') {
              homeScore = extractNumericScore(match.scores?.home) ?? 0;
              awayScore = extractNumericScore(match.scores?.away) ?? 0;
            } else if (sport === 'mma' || sport === 'boxing') {
              // MMA/Boxing: winner is determined by result, not score
              // Check if there's a winner field
              const winnerName = match.winner?.name || match.result?.winner || '';
              if (winnerName && homeTeam && winnerName.toLowerCase().includes(homeTeam.toLowerCase())) {
                homeScore = 1;
                awayScore = 0;
              } else if (winnerName && awayTeam && winnerName.toLowerCase().includes(awayTeam.toLowerCase())) {
                homeScore = 0;
                awayScore = 1;
              }
            } else if (sport === 'formula-1') {
              // F1: Position-based, winner gets score 1
              homeScore = match.position === 1 ? 1 : 0;
              awayScore = 0;
            } else {
              homeScore = extractNumericScore(match.scores?.home) ?? extractNumericScore(match.score?.home) ?? 0;
              awayScore = extractNumericScore(match.scores?.away) ?? extractNumericScore(match.score?.away) ?? 0;
            }

            const winner: 'home' | 'away' | 'draw' = 
              homeScore > awayScore ? 'home' : 
              awayScore > homeScore ? 'away' : 'draw';

            // Only add if we have valid team/fighter names
            if (homeTeam || awayTeam || eventId) {
              finished.push({
                eventId,
                homeTeam,
                awayTeam,
                homeScore,
                awayScore,
                winner,
                status: 'finished'
              });
            }
          }
        }
      } catch (error) {
        // Silently handle API errors for this date
      }
    }

    return finished;
  }

  private settledBetIds = new Set<string>(); // Track settled bet IDs to prevent duplicates

  private async getUnsettledBets(): Promise<UnsettledBet[]> {
    try {
      // Get ALL unsettled bets from all users - include:
      // - 'pending' = waiting for match result
      // - 'confirmed' = on-chain bets that were placed but not yet settled
      // - 'won' = winners that couldn't be paid out (insufficient treasury) - MUST RETRY PAYOUT
      const pendingBets = await storage.getAllBets('pending');
      const confirmedBets = await storage.getAllBets('confirmed');
      const wonBets = await storage.getAllBets('won');
      
      // Filter won bets to only include those without settlement_tx_hash (not yet paid out)
      const unpaidWonBets = wonBets.filter(bet => !bet.settlementTxHash);
      
      console.log(`📊 Unsettled bets: ${pendingBets.length} pending, ${confirmedBets.length} confirmed, ${unpaidWonBets.length} won (unpaid)`);
      
      const allBets = [...pendingBets, ...confirmedBets, ...unpaidWonBets];
      return allBets
        .filter(bet => !this.settledBetIds.has(bet.id))
        .map(bet => ({
          id: bet.id,
          eventId: bet.eventId || '',
          externalEventId: bet.externalEventId || String(bet.eventId || ''),
          homeTeam: bet.homeTeam || '',
          awayTeam: bet.awayTeam || '',
          prediction: bet.selection || bet.prediction || '',
          odds: bet.odds,
          stake: bet.stake || bet.betAmount,
          potentialWin: bet.potentialWin || bet.potentialPayout,
          userId: bet.walletAddress || bet.userId || '',
          currency: bet.currency || 'SUI',
          betObjectId: bet.betObjectId || undefined,
          status: bet.status,
          giftedTo: bet.giftedTo || undefined,
        }));
    } catch (error) {
      console.error('Error getting unsettled bets:', error);
      return [];
    }
  }

  private payoutRetryCount = new Map<string, number>();
  private payoutLastRetryTime = new Map<string, number>();
  private static MAX_PAYOUT_RETRIES = 20;

  private static BLOCKED_WALLETS = new Set<string>([
  ]);

  private ownedBetIds = new Set<string>();

  private async retryPendingPayouts(wonBets: UnsettledBet[]) {
    if (!blockchainBetService.isAdminKeyConfigured()) {
      return;
    }
    const keypair = blockchainBetService.getAdminKeypair();
    if (!keypair) return;

    let adminBalance: { sui: number; sbets: number } | null = null;
    try {
      adminBalance = await blockchainBetService.getWalletBalance(keypair.toSuiAddress());
    } catch (e) {
      console.warn(`⚠️ PAYOUT RETRY: Could not fetch admin balance - skipping cycle`);
      return;
    }
    if (adminBalance.sui < 0.02) {
      console.warn(`🛑 PAYOUT RETRY HALTED: Admin wallet too low (${adminBalance.sui.toFixed(4)} SUI) - all payouts deferred`);
      return;
    }

    for (const bet of wonBets) {
      if (this.settledBetIds.has(bet.id)) continue;

      if (this.ownedBetIds.has(bet.id)) continue;

      if (SettlementWorkerService.BLOCKED_WALLETS.has(bet.userId?.toLowerCase())) {
        console.warn(`🚫 PAYOUT BLOCKED: Bet ${bet.id} belongs to blocked wallet ${bet.userId?.slice(0, 12)}... - skipping`);
        this.settledBetIds.add(bet.id);
        continue;
      }

      const retries = this.payoutRetryCount.get(bet.id) || 0;
      if (retries >= SettlementWorkerService.MAX_PAYOUT_RETRIES) {
        console.warn(`🛑 PAYOUT RETRY LIMIT REACHED: Bet ${bet.id} failed ${retries} times - requires manual admin resolution`);
        this.settledBetIds.add(bet.id);
        continue;
      }
      const lastRetry = this.payoutLastRetryTime.get(bet.id) || 0;
      const backoffMs = Math.min(30000 * Math.pow(2, Math.min(retries, 5)), 600000);
      if (Date.now() - lastRetry < backoffMs) {
        continue;
      }
      this.payoutRetryCount.set(bet.id, retries + 1);
      this.payoutLastRetryTime.set(bet.id, Date.now());

      try {
        const currentBet = await storage.getBet(bet.id);
        if (!currentBet || currentBet.status !== 'won') {
          console.log(`⚠️ PAYOUT SKIP: Bet ${bet.id} no longer in 'won' state (status=${currentBet?.status}) - skipping`);
          this.settledBetIds.add(bet.id);
          continue;
        }
        const txHash = currentBet.settlementTxHash;
        if (txHash) {
          const isContractSettled = txHash.startsWith('contract-settled-') || txHash.startsWith('verified-on-chain-');
          const isRealTxHash = !txHash.startsWith('on-chain-') && !isContractSettled;
          if (isRealTxHash) {
            console.log(`⚠️ PAYOUT SKIP: Bet ${bet.id} already has real TX hash ${txHash.slice(0,16)}... - skipping`);
            this.settledBetIds.add(bet.id);
            continue;
          }
          if (isContractSettled) {
            console.log(`⚠️ PAYOUT SKIP: Bet ${bet.id} already settled by smart contract (${txHash.slice(0,30)}...) - skipping`);
            this.settledBetIds.add(bet.id);
            continue;
          }
        }

        const grossPayout = bet.potentialWin;
        const profit = grossPayout - bet.stake;
        const platformFee = profit > 0 ? profit * 0.01 : 0;
        const netPayout = grossPayout - platformFee;

        // DEFENSE-IN-DEPTH: Payout cap at retry path
        const RETRY_MAX_PAYOUT_SBETS = 15_000_000;
        const RETRY_MAX_PAYOUT_SUI = 150;
        const RETRY_MAX_PAYOUT_USDSUI = 4;
        const retryMaxPay = bet.currency === 'SBETS' ? RETRY_MAX_PAYOUT_SBETS : bet.currency === 'USDSUI' ? RETRY_MAX_PAYOUT_USDSUI : RETRY_MAX_PAYOUT_SUI;
        if (grossPayout > retryMaxPay) {
          console.error(`🚨 RETRY PAYOUT CAP BREACH: Bet ${bet.id} grossPayout=${grossPayout} ${bet.currency} > max ${retryMaxPay} — AUTO-VOIDING`);
          await storage.updateBetStatus(bet.id, 'void', 0);
          this.settledBetIds.add(bet.id);
          continue;
        }

        const isGiftBetRetry = !!bet.giftedTo && bet.giftedTo !== bet.userId;
        const userWallet = isGiftBetRetry ? bet.giftedTo! : bet.userId;

        if (!userWallet || !/^0x[0-9a-fA-F]{64}$/.test(userWallet)) {
          console.log(`ℹ️ PAYOUT SKIP: Bet ${bet.id} has no valid wallet address - internal balance only`);
          this.settledBetIds.add(bet.id);
          continue;
        }

        if (bet.betObjectId && blockchainBetService.isAdminKeyConfigured()) {
          const onChainInfo = await blockchainBetService.getOnChainBetInfo(bet.betObjectId);
          if (onChainInfo && !onChainInfo.settled) {
            if (isGiftBetRetry) {
              console.log(`🎁 PAYOUT RETRY GIFT: Bet ${bet.id} - voiding on-chain, sending to gift recipient ${userWallet.slice(0,10)}...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              const voidResult = bet.currency === 'SBETS'
                ? await blockchainBetService.executeVoidBetSbetsOnChain(bet.betObjectId)
                : bet.currency === 'USDSUI'
                ? await blockchainBetService.executeVoidBetUsdsuiOnChain(bet.betObjectId)
                : await blockchainBetService.executeVoidBetOnChain(bet.betObjectId);
              if (!voidResult.success) {
                console.warn(`⚠️ GIFT PAYOUT RETRY VOID FAILED: ${voidResult.error}`);
              }
            } else {
              console.log(`🔗 PAYOUT RETRY ON-CHAIN: Bet ${bet.id} - attempting smart contract settlement`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              const settlementResult = bet.currency === 'SBETS'
                ? await blockchainBetService.executeSettleBetSbetsOnChain(bet.betObjectId, true)
                : bet.currency === 'USDSUI'
                ? await blockchainBetService.executeSettleBetUsdsuiOnChain(bet.betObjectId, true)
                : await blockchainBetService.executeSettleBetOnChain(bet.betObjectId, true);
              
              if (settlementResult.success) {
                await storage.updateBetStatus(bet.id, 'paid_out', grossPayout, settlementResult.txHash);
                console.log(`✅ PAYOUT RETRY ON-CHAIN SUCCESS: Bet ${bet.id} | TX: ${settlementResult.txHash}`);
                this.settledBetIds.add(bet.id);
                continue;
              }
              if (settlementResult.error?.includes('cannot settle owned objects')) {
                console.warn(`🛑 PAYOUT PERMANENTLY SKIPPED: Bet ${bet.id} - ${settlementResult.error}`);
                this.ownedBetIds.add(bet.id);
                this.settledBetIds.add(bet.id);
                continue;
              }
              console.warn(`⚠️ PAYOUT RETRY ON-CHAIN FAILED: ${settlementResult.error} - falling back to direct transfer`);
            }
          } else if (onChainInfo?.settled) {
            if (isGiftBetRetry) {
              console.log(`🎁 PAYOUT RETRY: Gift bet ${bet.id} settled on-chain to wrong wallet - sending to recipient`);
            } else {
              console.log(`✅ PAYOUT RETRY: Bet ${bet.id} already settled on-chain - marking paid_out`);
              await storage.updateBetStatus(bet.id, 'paid_out', grossPayout, `verified-on-chain-${bet.betObjectId?.slice(0,16)}`);
              this.settledBetIds.add(bet.id);
              continue;
            }
          }
        }

        if (!userWallet || !/^0x[0-9a-fA-F]{64}$/.test(userWallet)) {
          console.error(`🚫 PAYOUT RETRY BLOCKED: Bet ${bet.id} has invalid wallet: ${String(userWallet).slice(0,12)}...`);
          continue;
        }
        if (bet.currency === 'SBETS' && adminBalance && adminBalance.sbets < netPayout) {
          console.warn(`⏸️ PAYOUT DEFERRED: Bet ${bet.id} needs ${netPayout.toFixed(2)} SBETS but admin has ${adminBalance.sbets.toFixed(2)} — waiting for funds`);
          this.payoutRetryCount.set(bet.id, retries);
          continue;
        }
        if (bet.currency === 'SUI' && adminBalance && adminBalance.sui < netPayout + 0.02) {
          console.warn(`⏸️ PAYOUT DEFERRED: Bet ${bet.id} needs ${netPayout.toFixed(4)} SUI but admin has ${adminBalance.sui.toFixed(4)} — waiting for funds`);
          this.payoutRetryCount.set(bet.id, retries);
          continue;
        }

        if (isGiftBetRetry) {
          console.log(`🎁 GIFT PAYOUT RETRY: Bet ${bet.id} - sending ${netPayout} ${bet.currency} to recipient ${userWallet.slice(0,10)}... (attempt ${retries + 1})`);
        } else {
          console.log(`🔄 PAYOUT RETRY DIRECT: Bet ${bet.id} - sending ${netPayout} ${bet.currency} to ${userWallet.slice(0,10)}... (attempt ${retries + 1})`);
        }
        let payoutResult;
        if (bet.currency === 'SUI') {
          payoutResult = await blockchainBetService.sendSuiToUser(userWallet, netPayout);
        } else if (bet.currency === 'SBETS') {
          payoutResult = await blockchainBetService.sendSbetsToUser(userWallet, netPayout);
        }

        if (payoutResult?.success && payoutResult?.txHash) {
          await storage.updateBetStatus(bet.id, 'paid_out', grossPayout, payoutResult.txHash);
          console.log(`✅ PAYOUT RETRY SUCCESS: Bet ${bet.id} paid_out | TX: ${payoutResult.txHash}`);
          this.settledBetIds.add(bet.id);
        } else {
          console.warn(`⚠️ PAYOUT RETRY FAILED: Bet ${bet.id} (attempt ${retries + 1}/${SettlementWorkerService.MAX_PAYOUT_RETRIES}) - ${payoutResult?.error || 'Unknown error'}`);
        }
      } catch (error: any) {
        console.error(`❌ PAYOUT RETRY ERROR: Bet ${bet.id} - ${error.message}`);
      }
    }
  }

  private async settleBetsForMatch(match: FinishedMatch, bets: UnsettledBet[]) {
    for (const bet of bets) {
      // DUPLICATE SETTLEMENT PREVENTION: Skip if already settled this session
      if (this.settledBetIds.has(bet.id)) {
        console.log(`⚠️ SKIPPING: Bet ${bet.id} already processed this session`);
        continue;
      }
      
      const isRecoveredBet = (bet as any).eventName?.includes('Recovered') || (bet as any).betObjectId;
      if (!isRecoveredBet && ((bet as any).eventName === "Unknown Event" || bet.homeTeam === "Unknown" || bet.awayTeam === "Unknown")) {
        console.warn(`🚫 EXPLOIT BLOCKED: Skipping settlement for bet ${bet.id} - Unknown Event/Teams`);
        this.settledBetIds.add(bet.id);
        continue;
      }
      if (isRecoveredBet && (bet.homeTeam === "Unknown" || bet.awayTeam === "Unknown")) {
        bet.homeTeam = match.homeTeam || bet.homeTeam;
        bet.awayTeam = match.awayTeam || bet.awayTeam;
        (bet as any).eventName = `${bet.homeTeam} vs ${bet.awayTeam}`;
        console.log(`🔧 Enriched recovered bet ${bet.id} with match data: ${bet.homeTeam} vs ${bet.awayTeam}`);
        if (bet.betObjectId && bet.prediction === bet.externalEventId) {
          try {
            const onChainData = await blockchainBetService.getOnChainBetInfo(bet.betObjectId);
            if (onChainData?.prediction && onChainData.prediction !== bet.externalEventId) {
              bet.prediction = onChainData.prediction;
              console.log(`🔧 Enriched recovered bet prediction from on-chain: "${bet.prediction}"`);
            }
          } catch (e) { /* best effort */ }
        }
        try {
          await db.execute(sql`UPDATE bets SET home_team = ${bet.homeTeam}, away_team = ${bet.awayTeam}, event_name = ${(bet as any).eventName}, prediction = ${bet.prediction} WHERE id = ${bet.id}`);
        } catch (e) { /* best effort */ }
      }
      
      try {
        // VOID HANDLING: Cancelled/Abandoned/Postponed matches → void all bets (refund stake)
        if (match.status === 'void') {
          console.log(`🚫 MATCH VOIDED: ${match.homeTeam} vs ${match.awayTeam} — voiding bet ${bet.id} (refunding ${bet.stake} ${bet.currency})`);
          await db.execute(sql`UPDATE bets SET status = 'void', settled_at = NOW() WHERE id = ${bet.id}`);
          if (bet.currency === 'SBETS' && bet.stake > 0) {
            try {
              await balanceService.addWinnings(bet.userId || bet.walletAddress, bet.stake, 'SBETS');
              console.log(`💸 VOID REFUND: ${bet.stake} SBETS returned to ${(bet.userId || bet.walletAddress).slice(0, 12)}...`);
            } catch (refundErr: any) {
              console.error(`❌ VOID REFUND FAILED: bet ${bet.id}`, refundErr.message);
            }
          }
          settledCount++;
          continue;
        }

        // SPECIAL HANDLING: Bets already marked as 'won' are confirmed winners needing payout retry
        // Skip match result determination - they've already been confirmed as winners
        const isAlreadyWon = bet.status === 'won';
        const isWinner = isAlreadyWon ? true : this.determineBetOutcome(bet, match);
        
        if (isAlreadyWon) {
          console.log(`💰 PAYOUT RETRY: Bet ${bet.id} already marked as 'won' - attempting payout`);
        }
        
        const status = isWinner ? 'won' : 'lost';
        const grossPayout = isWinner ? bet.potentialWin : 0;
        // FEE CALCULATION: 1% of PROFIT only (matching smart contract logic)
        // Profit = grossPayout - stake = net winnings beyond original bet
        const profit = isWinner ? (grossPayout - bet.stake) : 0;
        const platformFee = profit > 0 ? profit * 0.01 : 0; // 1% of profit, NOT gross
        const netPayout = grossPayout - platformFee;

        // DEFENSE-IN-DEPTH: Payout cap at settlement (blocks any bet that bypassed placement checks)
        const SETTLEMENT_MAX_PAYOUT_SBETS = 15_000_000;
        const SETTLEMENT_MAX_PAYOUT_SUI = 150;
        const SETTLEMENT_MAX_PAYOUT_USDSUI = 4;
        const settlementMaxPayout = bet.currency === 'SBETS' ? SETTLEMENT_MAX_PAYOUT_SBETS : bet.currency === 'USDSUI' ? SETTLEMENT_MAX_PAYOUT_USDSUI : SETTLEMENT_MAX_PAYOUT_SUI;
        if (isWinner && grossPayout > settlementMaxPayout) {
          console.error(`🚨 SETTLEMENT PAYOUT CAP BREACH: Bet ${bet.id} grossPayout=${grossPayout} ${bet.currency} > max ${settlementMaxPayout} — AUTO-VOIDING`);
          await storage.updateBetStatus(bet.id, 'void', 0);
          this.settledBetIds.add(bet.id);
          continue;
        }

        // DUAL SETTLEMENT: On-chain for SUI/SBETS with betObjectId, off-chain fallback
        const hasOnChainBet = bet.betObjectId && blockchainBetService.isAdminKeyConfigured();
        const isSuiOnChainBet = bet.currency === 'SUI' && hasOnChainBet;
        const isSbetsOnChainBet = bet.currency === 'SBETS' && hasOnChainBet;
        const isUsdsuiOnChainBet = bet.currency === 'USDSUI' && hasOnChainBet;
        
        // CRITICAL WARNING: Flag bets without betObjectId that will use off-chain fallback
        if (!bet.betObjectId) {
          console.warn(`⚠️ MISSING betObjectId: Bet ${bet.id} (${bet.currency}) has no on-chain object ID - will use OFF-CHAIN fallback`);
          console.warn(`   This bet was likely placed before the betObjectId extraction fix or transaction failed to capture it`);
        }
        if (!blockchainBetService.isAdminKeyConfigured()) {
          console.warn(`⚠️ ADMIN_PRIVATE_KEY not configured - all settlements will use OFF-CHAIN fallback`);
        }

        // GIFT BET FIX: Smart contract pays bet.bettor (the sender). For gift bets where
        // the payout must go to giftedTo (the recipient), skip on-chain settlement entirely
        // and fall through to the off-chain path which correctly routes to giftedTo.
        const isGiftBet = !!bet.giftedTo && bet.giftedTo !== bet.userId;
        if (isGiftBet && (isSuiOnChainBet || isSbetsOnChainBet || isUsdsuiOnChainBet)) {
          console.log(`🎁 GIFT BET DETECTED: ${bet.id} (${bet.currency}) - skipping on-chain settlement, using off-chain path to route payout to ${bet.giftedTo!.slice(0,10)}...`);
          if (bet.betObjectId) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const onChainInfo = await blockchainBetService.getOnChainBetInfo(bet.betObjectId);
            if (onChainInfo && !onChainInfo.settled) {
              const settleAsLost = bet.currency === 'SBETS'
                ? await blockchainBetService.executeSettleBetSbetsOnChain(bet.betObjectId, false)
                : bet.currency === 'USDSUI'
                ? await blockchainBetService.executeSettleBetUsdsuiOnChain(bet.betObjectId, false)
                : await blockchainBetService.executeSettleBetOnChain(bet.betObjectId, false);
              if (settleAsLost.success) {
                console.log(`✅ GIFT BET ON-CHAIN CLEARED (settled as lost to keep stake in treasury): TX ${settleAsLost.txHash}`);
              } else {
                console.warn(`⚠️ GIFT BET ON-CHAIN CLEAR FAILED: ${settleAsLost.error} - proceeding with off-chain payout anyway`);
              }
            }
          }
        }

        if (isSuiOnChainBet && !isGiftBet) {
          // ============ ON-CHAIN SETTLEMENT (SUI via smart contract) ============
          console.log(`🔗 ON-CHAIN SUI SETTLEMENT: Bet ${bet.id} via smart contract`);
          
          // PRE-CHECK 1: Verify treasury has enough balance for winners
          if (isWinner) {
            const platformInfo = await blockchainBetService.getPlatformInfo();
            if (platformInfo && platformInfo.treasuryBalanceSui < grossPayout) {
              console.warn(`⚠️ INSUFFICIENT TREASURY: Need ${grossPayout} SUI but only ${platformInfo.treasuryBalanceSui} SUI available`);
              console.warn(`   Bet ${bet.id} requires manual admin resolution - marking as won in DB (will retry next cycle)`);
              await storage.updateBetStatus(bet.id, 'won', grossPayout);
              continue;
            }
          }
          
          // PRE-CHECK 2: Verify bet isn't already settled on-chain (prevents error 6)
          const onChainInfo = await blockchainBetService.getOnChainBetInfo(bet.betObjectId!);
          if (onChainInfo?.settled) {
            console.log(`⚠️ BET ALREADY SETTLED ON-CHAIN: ${bet.betObjectId} - contract handled payout, updating database`);
            const finalStatus = isWinner ? 'paid_out' : 'lost';
            await storage.updateBetStatus(bet.id, finalStatus, grossPayout, `contract-settled-sui-${bet.betObjectId?.slice(0,16)}`);
            this.settledBetIds.add(bet.id);
            continue;
          }
          
          if (!onChainInfo) {
            console.warn(`⚠️ BET OBJECT NOT FOUND ON-CHAIN: ${bet.betObjectId} - will retry next cycle`);
            continue;
          } else {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const settlementResult = await blockchainBetService.executeSettleBetOnChain(
              bet.betObjectId!,
              isWinner
            );

            if (settlementResult.success) {
              const finalStatus = isWinner ? 'paid_out' : 'lost';
              const statusUpdated = await storage.updateBetStatus(bet.id, finalStatus, grossPayout, settlementResult.txHash);
              if (statusUpdated) {
                console.log(`✅ ON-CHAIN SUI SETTLED: ${bet.id} ${finalStatus} | TX: ${settlementResult.txHash}`);
                this.settledBetIds.add(bet.id);
              }
              continue;
            } else {
              // Check if error indicates a MoveAbort (error 6 could be insufficient treasury OR already settled)
              if (settlementResult.error?.includes('error 6') || settlementResult.error?.includes('MoveAbort')) {
                // Re-check on-chain bet status to determine root cause
                const reCheckInfo = await blockchainBetService.getOnChainBetInfo(bet.betObjectId!);
                
                if (reCheckInfo?.settled) {
                  // Bet was already settled on-chain - safe to mark in DB
                  console.log(`⚠️ BET CONFIRMED SETTLED ON-CHAIN: ${bet.id} - contract handled payout, updating database`);
                  const finalStatus = isWinner ? 'paid_out' : 'lost';
                  await storage.updateBetStatus(bet.id, finalStatus, grossPayout, `contract-settled-sui-${bet.betObjectId?.slice(0,16)}`);
                  this.settledBetIds.add(bet.id);
                  continue;
                } else if (isWinner) {
                  console.warn(`⚠️ SETTLEMENT FAILED (insufficient treasury): ${bet.id} - marking as 'won' for retry next cycle`);
                  await storage.updateBetStatus(bet.id, 'won', grossPayout);
                  continue;
                } else {
                  // Loser bet with error 6 but not settled on-chain - mark as lost (no payout needed anyway)
                  console.warn(`⚠️ SETTLEMENT ERROR for losing bet: ${bet.id} - marking as lost (no payout needed)`);
                  await storage.updateBetStatus(bet.id, 'lost', 0);
                  this.settledBetIds.add(bet.id);
                  continue;
                }
              }
              console.error(`❌ ON-CHAIN SUI SETTLEMENT FAILED: ${bet.id} - ${settlementResult.error}`);
              
              // FALLBACK: If TypeMismatch or ownership error (legacy contract with owned objects), use DB-only settlement
              const isLegacyBetError = settlementResult.error?.includes('TypeMismatch') || 
                                       settlementResult.error?.includes('type mismatch') ||
                                       settlementResult.error?.includes('owned by account address') ||
                                       settlementResult.error?.includes('not signed by the correct sender');
              if (isLegacyBetError) {
                console.log(`🔄 LEGACY BET DETECTED (owned object): Falling back to DB-only settlement with wallet payout for ${bet.id}`);
                // Fall through to off-chain settlement below
              } else {
                // Don't mark as settled - will retry next cycle
                continue;
              }
            }
          }
        }
        
        // Check for SBETS on-chain bets separately (gift bets already handled above)
        if (isSbetsOnChainBet && !isGiftBet) {
          // ============ ON-CHAIN SETTLEMENT (SBETS via smart contract) ============
          console.log(`🔗 ON-CHAIN SBETS SETTLEMENT: Bet ${bet.id} via smart contract`);
          
          // PRE-CHECK 1: Verify treasury has enough SBETS balance for winners
          if (isWinner) {
            const platformInfo = await blockchainBetService.getPlatformInfo();
            if (platformInfo && platformInfo.treasuryBalanceSbets < grossPayout) {
              console.warn(`⚠️ INSUFFICIENT SBETS TREASURY: Need ${grossPayout} SBETS but only ${platformInfo.treasuryBalanceSbets} SBETS available`);
              console.warn(`   Bet ${bet.id} requires manual admin resolution - marking as won in DB (will retry next cycle)`);
              await storage.updateBetStatus(bet.id, 'won', grossPayout);
              continue;
            }
          }
          
          // PRE-CHECK 2: Verify bet isn't already settled on-chain (prevents error 6)
          const onChainInfo = await blockchainBetService.getOnChainBetInfo(bet.betObjectId!);
          if (onChainInfo?.settled) {
            console.log(`⚠️ SBETS BET ALREADY SETTLED ON-CHAIN: ${bet.betObjectId} - contract handled payout, updating database`);
            const finalStatus = isWinner ? 'paid_out' : 'lost';
            await storage.updateBetStatus(bet.id, finalStatus, grossPayout, `contract-settled-sbets-${bet.betObjectId?.slice(0,16)}`);
            this.settledBetIds.add(bet.id);
            continue;
          }
          
          if (!onChainInfo) {
            console.warn(`⚠️ SBETS BET OBJECT NOT FOUND ON-CHAIN: ${bet.betObjectId} - will retry next cycle`);
            continue;
          } else {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const settlementResult = await blockchainBetService.executeSettleBetSbetsOnChain(
              bet.betObjectId!,
              isWinner
            );

            if (settlementResult.success) {
              const finalStatus = isWinner ? 'paid_out' : 'lost';
              const statusUpdated = await storage.updateBetStatus(bet.id, finalStatus, grossPayout, settlementResult.txHash);
              if (statusUpdated) {
                console.log(`✅ ON-CHAIN SBETS SETTLED: ${bet.id} ${finalStatus} | TX: ${settlementResult.txHash}`);
                this.settledBetIds.add(bet.id);
              }
              continue;
            } else {
              // Check if error indicates a MoveAbort (error 6 could be insufficient treasury OR already settled)
              if (settlementResult.error?.includes('error 6') || settlementResult.error?.includes('MoveAbort')) {
                // Re-check on-chain bet status to determine root cause
                const reCheckInfo = await blockchainBetService.getOnChainBetInfo(bet.betObjectId!);
                
                if (reCheckInfo?.settled) {
                  // Bet was already settled on-chain - safe to mark in DB
                  console.log(`⚠️ SBETS BET CONFIRMED SETTLED ON-CHAIN: ${bet.id} - contract handled payout, updating database`);
                  const finalStatus = isWinner ? 'paid_out' : 'lost';
                  await storage.updateBetStatus(bet.id, finalStatus, grossPayout, `contract-settled-sbets-${bet.betObjectId?.slice(0,16)}`);
                  this.settledBetIds.add(bet.id);
                  continue;
                } else if (isWinner) {
                  console.warn(`⚠️ SBETS SETTLEMENT FAILED (insufficient treasury): ${bet.id} - marking as 'won' for retry next cycle`);
                  await storage.updateBetStatus(bet.id, 'won', grossPayout);
                  continue;
                } else {
                  console.warn(`⚠️ SBETS SETTLEMENT ERROR for losing bet: ${bet.id} - marking as lost (no payout needed)`);
                  await storage.updateBetStatus(bet.id, 'lost', 0);
                  this.settledBetIds.add(bet.id);
                  continue;
                }
              }
              console.error(`❌ ON-CHAIN SBETS SETTLEMENT FAILED: ${bet.id} - ${settlementResult.error}`);
              
              // FALLBACK: If TypeMismatch or ownership error (legacy contract with owned objects), use DB-only settlement
              const isLegacySbetsBetError = settlementResult.error?.includes('TypeMismatch') || 
                                            settlementResult.error?.includes('type mismatch') ||
                                            settlementResult.error?.includes('owned by account address') ||
                                            settlementResult.error?.includes('not signed by the correct sender');
              if (isLegacySbetsBetError) {
                console.log(`🔄 LEGACY SBETS BET DETECTED (owned object): Falling back to DB-only settlement with wallet payout for ${bet.id}`);
                // Fall through to off-chain settlement below
              } else {
                continue;
              }
            }
          }
        }
        
        // Check for USDSUI on-chain bets
        if (isUsdsuiOnChainBet && !isGiftBet) {
          console.log(`🔗 ON-CHAIN USDSUI SETTLEMENT: Bet ${bet.id} via smart contract`);
          const onChainInfoU = await blockchainBetService.getOnChainBetInfo(bet.betObjectId!);
          if (onChainInfoU?.settled) {
            console.log(`⚠️ USDSUI BET ALREADY SETTLED ON-CHAIN: ${bet.betObjectId} - updating database`);
            const finalStatus = isWinner ? 'paid_out' : 'lost';
            await storage.updateBetStatus(bet.id, finalStatus, grossPayout, `contract-settled-usdsui-${bet.betObjectId?.slice(0,16)}`);
            this.settledBetIds.add(bet.id);
            continue;
          }
          if (!onChainInfoU) {
            console.warn(`⚠️ USDSUI BET OBJECT NOT FOUND ON-CHAIN: ${bet.betObjectId} - will retry next cycle`);
            continue;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          const settlementResultU = await blockchainBetService.executeSettleBetUsdsuiOnChain(bet.betObjectId!, isWinner);
          if (settlementResultU.success) {
            const finalStatus = isWinner ? 'paid_out' : 'lost';
            const statusUpdated = await storage.updateBetStatus(bet.id, finalStatus, grossPayout, settlementResultU.txHash);
            if (statusUpdated) {
              console.log(`✅ ON-CHAIN USDSUI SETTLED: ${bet.id} ${finalStatus} | TX: ${settlementResultU.txHash}`);
              this.settledBetIds.add(bet.id);
            }
            continue;
          } else {
            console.error(`❌ ON-CHAIN USDSUI SETTLEMENT FAILED: ${bet.id} - ${settlementResultU.error}`);
            continue;
          }
        }

        // ============ OFF-CHAIN SETTLEMENT FALLBACK ============
        // Fall-through point for: bets without betObjectId, OR legacy bets with TypeMismatch errors
        // This handles both cases: no on-chain bet OR failed on-chain settlement
        {
          // ============ OFF-CHAIN SETTLEMENT (fallback for all failed on-chain attempts) ============
          // Uses internal balance tracking - funds managed via hybrid custodial model
          console.log(`📊 OFF-CHAIN SETTLEMENT: Bet ${bet.id} (${bet.currency}) via database (fallback)`);

          // DOUBLE PAYOUT PREVENTION: Only process winnings if status update succeeded
          // Use 'paid_out' for winners after successful payout, 'lost' for losers
          const initialStatus = isWinner ? 'won' : 'lost'; // Start as 'won', upgrade to 'paid_out' after payout
          const statusUpdated = await storage.updateBetStatus(bet.id, initialStatus, grossPayout);

          if (statusUpdated) {
            if (isWinner && netPayout > 0) {
              if (!bet.userId || !/^0x[0-9a-fA-F]{64}$/.test(bet.userId)) {
                console.error(`❌ SETTLEMENT BLOCKED: Bet ${bet.id} has invalid userId '${bet.userId?.slice(0,20)}' - cannot credit winnings`);
                continue;
              }
              const userWallet = bet.giftedTo || bet.userId;
              if (bet.giftedTo) {
                console.log(`🎁 GIFT PAYOUT: Routing ${netPayout} ${bet.currency} to gift recipient ${bet.giftedTo.slice(0,10)}... (from ${bet.userId?.slice(0,10)}...)`);
              }
              let payoutSuccess = false;
              let payoutTxHash: string | undefined;
              
              if (userWallet && /^0x[0-9a-fA-F]{64}$/.test(userWallet) && blockchainBetService.isAdminKeyConfigured()) {
                try {
                  console.log(`🔄 AUTO-PAYOUT: Sending ${netPayout} ${bet.currency} to ${userWallet.slice(0,10)}...`);
                  const sendDirect = async () => {
                    if (bet.currency === 'SUI') {
                      return blockchainBetService.sendSuiToUser(userWallet, netPayout);
                    } else {
                      return blockchainBetService.sendSbetsToUser(userWallet, netPayout);
                    }
                  };
                  
                  let payoutResult = await sendDirect();
                  if (!payoutResult?.success) {
                    console.warn(`⚠️ AUTO-PAYOUT attempt 1 failed: ${payoutResult?.error} — retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    payoutResult = await sendDirect();
                  }
                  
                  if (payoutResult?.success && payoutResult?.txHash) {
                    console.log(`✅ AUTO-PAYOUT SUCCESS: ${netPayout} ${bet.currency} sent to ${userWallet.slice(0,10)}... | TX: ${payoutResult.txHash}`);
                    payoutSuccess = true;
                    payoutTxHash = payoutResult.txHash;
                  } else {
                    console.warn(`⚠️ AUTO-PAYOUT FAILED after retry: ${payoutResult?.error || 'Unknown error'} - crediting DB balance`);
                  }
                } catch (payoutError: any) {
                  console.warn(`⚠️ AUTO-PAYOUT ERROR: ${payoutError.message} - crediting DB balance`);
                }
              }
              
              if (payoutSuccess && payoutTxHash) {
                await balanceService.addRevenue(platformFee, bet.currency as 'SUI' | 'SBETS', 'won_bet_fee', String(bet.id));
                await storage.updateBetStatus(bet.id, 'paid_out', grossPayout, payoutTxHash);
                console.log(`✅ PAID OUT: Bet ${bet.id} marked as paid_out with TX: ${payoutTxHash}`);
              } else {
                const winningsAdded = await balanceService.addWinnings(bet.userId, netPayout, bet.currency as 'SUI' | 'SBETS');
                if (!winningsAdded) {
                  console.error(`❌ PAYOUT FAILED COMPLETELY: Bet ${bet.id} - keeping as 'won' for retry`);
                  await storage.updateBetStatus(bet.id, 'won', grossPayout);
                } else {
                  await balanceService.addRevenue(platformFee, bet.currency as 'SUI' | 'SBETS', 'won_bet_fee', String(bet.id));
                  await storage.updateBetStatus(bet.id, 'won', grossPayout);
                  console.log(`💰 DB BALANCE CREDITED: ${bet.userId.slice(0,12)}... won ${netPayout} ${bet.currency} (on-chain failed, user can withdraw)`);
                }
              }
            } else {
              // Lost bet - add full stake to platform revenue
              await balanceService.addRevenue(bet.stake, bet.currency as 'SUI' | 'SBETS', 'lost_bet', String(bet.id));
              console.log(`📉 LOST (DB): ${bet.userId} lost ${bet.stake} ${bet.currency} - added to platform revenue`);
            }
            console.log(`✅ Settled bet ${bet.id}: ${isWinner ? 'paid_out' : 'lost'} (${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam})`);
            
            // ONLY mark as settled after successful payout processing
            this.settledBetIds.add(bet.id);
          } else {
            console.log(`⚠️ SETTLEMENT SKIPPED: Bet ${bet.id} already in terminal state - payout retries handled by dedicated retryPendingPayouts`);
            this.settledBetIds.add(bet.id);
          }
        }
      } catch (error) {
        console.error(`❌ Error settling bet ${bet.id}:`, error);
        // Don't mark as settled on error - allow retry next cycle
      }
    }

    // Persist event as settled in database (survives restarts)
    await this.markEventAsSettled(match, bets.length);
  }

  private determineBetOutcome(bet: UnsettledBet, match: FinishedMatch): boolean {
    const prediction = bet.prediction.toLowerCase().trim();
    const homeTeam = match.homeTeam.toLowerCase();
    const awayTeam = match.awayTeam.toLowerCase();

    // Check for Correct Score prediction (e.g., "1-0", "2-1", "0-0")
    const correctScoreMatch = prediction.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (correctScoreMatch) {
      const predictedHome = parseInt(correctScoreMatch[1], 10);
      const predictedAway = parseInt(correctScoreMatch[2], 10);
      return match.homeScore === predictedHome && match.awayScore === predictedAway;
    }

    // Check for "Other" correct score prediction (any score not in standard options)
    if (prediction === 'other') {
      const commonScores = ['0-0', '1-0', '0-1', '1-1', '2-0', '0-2', '2-1', '1-2', '2-2', '3-0', '0-3', '3-1', '1-3', '3-2', '2-3'];
      const actualScore = `${match.homeScore}-${match.awayScore}`;
      return !commonScores.includes(actualScore);
    }

    // Normalize team names for flexible matching (strips FC, United, City, etc.)
    const normalizeName = (name: string) => name.toLowerCase().trim()
      .replace(/\s+w$/i, '')
      .replace(/\b(fc|sc|cf|afc|united|utd|city|town|athletic|ath|sporting|sp|de)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    const normPred = normalizeName(prediction);
    const normHome = normalizeName(homeTeam);
    const normAway = normalizeName(awayTeam);

    // Match Winner predictions
    const extractLastName = (name: string) => {
      const parts = name.trim().split(/\s+/);
      return parts[parts.length - 1].toLowerCase();
    };
    const predLastName = extractLastName(prediction);
    const homeLastName = extractLastName(homeTeam);
    const awayLastName = extractLastName(awayTeam);

    const directMatchesHome = prediction.includes(homeTeam) || homeTeam.includes(prediction) ||
        normPred === normHome || normHome.includes(normPred) || normPred.includes(normHome) ||
        prediction === 'home' || prediction === '1';

    const directMatchesAway = prediction.includes(awayTeam) || awayTeam.includes(prediction) ||
        normPred === normAway || normAway.includes(normPred) || normPred.includes(normAway) ||
        prediction === 'away' || prediction === '2';

    const lastNameMatchesHome = !directMatchesHome && predLastName.length >= 3 && predLastName === homeLastName;
    const lastNameMatchesAway = !directMatchesAway && predLastName.length >= 3 && predLastName === awayLastName;

    const matchesHome = directMatchesHome || (lastNameMatchesHome && !lastNameMatchesAway);
    const matchesAway = directMatchesAway || (lastNameMatchesAway && !lastNameMatchesHome);

    if (matchesHome && !matchesAway) {
      return match.winner === 'home';
    }
    
    if (matchesAway && !matchesHome) {
      return match.winner === 'away';
    }

    if (matchesHome && matchesAway) {
      if (directMatchesHome && !directMatchesAway) return match.winner === 'home';
      if (directMatchesAway && !directMatchesHome) return match.winner === 'away';
      const predWords = prediction.split(/\s+/);
      const homeWords = homeTeam.split(/\s+/);
      const awayWords = awayTeam.split(/\s+/);
      const homeOverlap = predWords.filter(w => homeWords.includes(w)).length;
      const awayOverlap = predWords.filter(w => awayWords.includes(w)).length;
      if (homeOverlap > awayOverlap) return match.winner === 'home';
      if (awayOverlap > homeOverlap) return match.winner === 'away';
      console.warn(`⚠️ AMBIGUOUS MATCH: prediction="${prediction}" matches both "${homeTeam}" and "${awayTeam}" equally — defaulting to false`);
      return false;
    }
    
    if (prediction === 'draw' || prediction === 'x' || prediction === 'tie') {
      return match.winner === 'draw';
    }

    // Double Chance by prediction text
    if (prediction.includes('or draw')) {
      if (prediction.includes(homeTeam) || homeTeam.includes(prediction.replace(/\s*or\s*draw\s*/i, '').trim())) {
        return match.winner === 'home' || match.winner === 'draw';
      }
      if (prediction.includes(awayTeam) || awayTeam.includes(prediction.replace(/\s*or\s*draw\s*/i, '').trim())) {
        return match.winner === 'draw' || match.winner === 'away';
      }
    }

    // Odd/Even (full game total)
    if (prediction === 'odd') {
      return (match.homeScore + match.awayScore) % 2 === 1;
    }
    if (prediction === 'even') {
      return (match.homeScore + match.awayScore) % 2 === 0;
    }

    // SAFETY: Reject period/team-specific markets BEFORE Over/Under handler
    // Prevents "1st quarter over 45.5" from comparing against full game score
    const unsettleableKeywords = [
      '1st half', '2nd half', '1st quarter', '2nd quarter', '3rd quarter', '4th quarter',
      '1st period', '2nd period', '3rd period', '1st set', '2nd set', '3rd set',
      'home total', 'away total', 'home team total', 'away team total',
      'highest scoring', 'handicap result', 'asian handicap',
      'half-time', 'ht:',
    ];
    if (unsettleableKeywords.some(kw => prediction.includes(kw))) {
      console.warn(`⚠️ UNSETTLEABLE MARKET: prediction="${prediction}" for ${match.homeTeam} vs ${match.awayTeam} — defaulting to LOSS (no period data available)`);
      return false;
    }

    const handicapPattern = /^(home|away|draw|1|2|x)\s*[+-]\d+(\.\d+)?$/i;
    if (handicapPattern.test(prediction)) {
      console.warn(`⚠️ UNSETTLEABLE HANDICAP: prediction="${prediction}" for ${match.homeTeam} vs ${match.awayTeam} — no handicap handler`);
      return false;
    }

    // Over/Under predictions (full game total only — period-specific blocked above)
    const totalGoals = match.homeScore + match.awayScore;
    if (prediction.includes('over')) {
      const threshold = parseFloat(prediction.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals > threshold;
    }
    
    if (prediction.includes('under')) {
      const threshold = parseFloat(prediction.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals < threshold;
    }

    // Both Teams To Score (BTTS)
    if (prediction === 'yes' || prediction.includes('btts yes') || prediction.includes('both teams to score: yes')) {
      return match.homeScore > 0 && match.awayScore > 0;
    }
    if (prediction === 'no' || prediction.includes('btts no') || prediction.includes('both teams to score: no')) {
      return match.homeScore === 0 || match.awayScore === 0;
    }

    return false;
  }

  async manualSettle(betId: string, outcome: 'won' | 'lost' | 'void') {
    try {
      const bet = await storage.getBet(betId);
      if (!bet) throw new Error('Bet not found');

      const payout = outcome === 'won' ? bet.potentialPayout : 
                     outcome === 'void' ? bet.betAmount : 0;

      // DOUBLE PAYOUT PREVENTION: Only process winnings if status update succeeded
      const statusUpdated = await storage.updateBetStatus(betId, outcome, payout);

      if (!statusUpdated) {
        console.log(`⚠️ DUPLICATE SETTLEMENT PREVENTED: Bet ${betId} already settled - no payout applied`);
        return { success: false, betId, outcome, payout, message: 'Bet already settled' };
      }

      if (outcome === 'won' && payout > 0) {
        if (!bet.userId || !/^0x[0-9a-fA-F]{64}$/.test(bet.userId)) {
          console.error(`❌ SETTLEMENT FAILED: Bet ${betId} has invalid userId '${bet.userId?.slice(0,20)}' - cannot credit winnings`);
          return { success: false, betId, outcome, payout, message: 'Bet has no valid wallet userId' };
        }
        await balanceService.addWinnings(bet.userId, payout, (bet.feeCurrency || 'SUI') as 'SUI' | 'SBETS');
        console.log(`💰 MANUAL SETTLE (DB): ${bet.userId.slice(0,12)}... won ${payout} ${bet.feeCurrency}`);
      } else if (outcome === 'void') {
        await balanceService.addRevenue(bet.betAmount, (bet.feeCurrency || 'SUI') as 'SUI' | 'SBETS', 'voided_bet', String(bet.id));
        console.log(`🔄 VOIDED -> TREASURY: ${bet.betAmount} ${bet.feeCurrency} kept in treasury from voided bet ${bet.id} (NOT refunded to user)`);
      } else {
        await balanceService.addRevenue(bet.betAmount, (bet.feeCurrency || 'SUI') as 'SUI' | 'SBETS', 'lost_bet', String(bet.id));
        console.log(`📉 MANUAL LOSS (DB): Added ${bet.betAmount} to platform revenue`);
      }

      return { success: true, betId, outcome, payout };
    } catch (error) {
      console.error('Manual settlement error:', error);
      throw error;
    }
  }

  async forceOnChainSettlement(betId: string, outcome: 'won' | 'lost' | 'void'): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const bet = await storage.getBet(betId);
      if (!bet) {
        return { success: false, error: 'Bet not found' };
      }

      const betObjectId = bet.betObjectId;
      if (!betObjectId) {
        return { success: false, error: 'Bet has no on-chain betObjectId - cannot execute on-chain settlement' };
      }

      if (!blockchainBetService.isAdminKeyConfigured()) {
        return { success: false, error: 'Admin private key not configured - cannot execute on-chain settlement' };
      }

      const isWinner = outcome === 'won';
      const isVoid = outcome === 'void';
      const currency = bet.feeCurrency || bet.currency || 'SUI';

      console.log(`🔧 FORCE ON-CHAIN SETTLEMENT: Bet ${betId} (${currency}) -> ${outcome}`);

      if (isVoid) {
        console.log(`🚫 VOID ON-CHAIN BLOCKED: void_bet sends funds to user — settling as LOST on-chain to keep stake in treasury`);
      }

      let result;
      if (isVoid) {
        if (currency === 'SBETS') {
          result = await blockchainBetService.executeSettleBetSbetsOnChain(betObjectId, false);
        } else {
          result = await blockchainBetService.executeSettleBetOnChain(betObjectId, false);
        }
      } else {
        if (currency === 'SBETS') {
          result = await blockchainBetService.executeSettleBetSbetsOnChain(betObjectId, isWinner);
        } else {
          result = await blockchainBetService.executeSettleBetOnChain(betObjectId, isWinner);
        }
      }

      if (result.success) {
        console.log(`✅ FORCE ON-CHAIN SETTLEMENT SUCCESS: Bet ${betId} -> ${outcome} | TX: ${result.txHash}`);
        return { success: true, txHash: result.txHash };
      } else {
        console.error(`❌ FORCE ON-CHAIN SETTLEMENT FAILED: Bet ${betId} - ${result.error}`);
        return { success: false, error: result.error };
      }
    } catch (error: any) {
      console.error('Force on-chain settlement error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  async getBetsNeedingOnChainSettlement(): Promise<any[]> {
    try {
      const allBets = await storage.getAllBets();
      return allBets.filter(bet => 
        bet.betObjectId && 
        (bet.status === 'won' || bet.status === 'lost' || bet.status === 'void') &&
        !bet.winningsWithdrawn
      );
    } catch (error) {
      console.error('Error getting bets needing on-chain settlement:', error);
      return [];
    }
  }

  getStatus() {
    return {
      isRunning: this._isRunning,
      settledEventsInMemory: this.settledEventIdsCache.size,
      settledBetsInMemory: this.settledBetIds.size,
      checkInterval: this.checkInterval / 1000
    };
  }

  // Helper methods for testing
  isRunningNow(): boolean {
    return this._isRunning;
  }

  getSettledEventsCount(): number {
    return this.settledEventIdsCache.size;
  }

  getSettledBetsCount(): number {
    return this.settledBetIds.size;
  }
}

export const settlementWorker = new SettlementWorkerService();
