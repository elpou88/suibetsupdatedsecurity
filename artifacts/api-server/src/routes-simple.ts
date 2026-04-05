import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

function safeErrorMessage(error: any, fallback: string = "Internal server error"): string {
  return fallback;
}

const SUI_WALLET_REGEX = /^0x[0-9a-fA-F]{64}$/;
function isValidSuiWallet(addr: unknown): addr is string {
  return typeof addr === 'string' && SUI_WALLET_REGEX.test(addr);
}
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { ApiSportsService, saveUpcomingSnapshot, getUpcomingSnapshot, saveLiveSnapshot, getLiveSnapshot, withSingleFlight } from "./services/apiSportsService";
const apiSportsService = new ApiSportsService();
import { SettlementService } from "./services/settlementService";
import { AdminService } from "./services/adminService";
import errorHandlingService from "./services/errorHandlingService";
import { EnvValidationService } from "./services/envValidationService";
import monitoringService from "./services/monitoringService";
import notificationService from "./services/notificationService";
import balanceService from "./services/balanceService";
import antiCheatService from "./services/smartContractAntiCheatService";
import { oracleSigningService } from "./services/oracleSigningService";
import zkLoginService from "./services/zkLoginService";
import { getSportsToFetch, getLiveSportsToFetch } from "./sports-config";
import { validateRequest, PlaceBetSchema, ParlaySchema, WithdrawSchema } from "./validation";
import aiRoutes from "./routes-ai";
import { settlementWorker } from "./services/settlementWorker";
import blockchainBetService from "./services/blockchainBetService";
import { getCetusLpPositions, getUserLpShare, startLpBackgroundRefresh } from "./services/cetusLpService";
import { promotionService } from "./services/promotionService";
import { treasuryAutoWithdrawService } from "./services/treasuryAutoWithdrawService";
import { revenueDistributionService } from "./services/revenueDistributionService";
import { freeSportsService } from "./services/freeSportsService";
import { esportsService } from "./services/esportsService";
import { reuploadReceiptJson } from "./services/walrusStorageService";
import { bets as betsGlobal } from "@shared/schema";
import { like as drizzleLike, eq as drizzleEq, and as drizzleAnd, isNotNull as drizzleIsNotNull } from "drizzle-orm";

// SUI BETTING PAUSE - Set to true to pause SUI betting until treasury is funded
// Users can still bet with SBETS
let SUI_BETTING_PAUSED = true;
const SUI_PAUSE_MESSAGE = "SUI betting is temporarily paused while we add funds to the treasury. Please bet with SBETS instead!";

// ANTI-EXPLOIT: Blocked wallet addresses (known exploiters)
const BLOCKED_WALLETS = new Set<string>([
]);

function isWalletBlocked(wallet: string): boolean {
  return BLOCKED_WALLETS.has(wallet.toLowerCase());
}

// ANTI-EXPLOIT: Rate limiting for bet placement
// Database-backed: counts actual bets in DB to survive server restarts
const MAX_BETS_PER_DAY = 7; // Maximum 7 bets per wallet per 24 hours
const MAX_BETS_PER_EVENT = 1;

// ANTI-EXPLOIT: In-memory wallet lock to prevent concurrent bet processing (race condition fix)
const walletBetLocks = new Map<string, Promise<any>>();
function acquireWalletLock(wallet: string): { execute: <T>(fn: () => Promise<T>) => Promise<T> } {
  const key = wallet.toLowerCase();
  return {
    execute: async <T>(fn: () => Promise<T>): Promise<T> => {
      const existingLock = walletBetLocks.get(key) || Promise.resolve();
      let resolve: () => void;
      const newLock = new Promise<void>(r => { resolve = r; });
      walletBetLocks.set(key, newLock);
      try {
        await existingLock;
        return await fn();
      } finally {
        resolve!();
        if (walletBetLocks.get(key) === newLock) {
          walletBetLocks.delete(key);
        }
      }
    }
  };
}

// ANTI-EXPLOIT: Duplicate bet detection — block same event + same prediction (permanent, no time window)
async function checkDuplicateBetDB(walletAddress: string, eventId: string, prediction: string): Promise<{ allowed: boolean; message?: string }> {
  const key = walletAddress.toLowerCase();
  const normalizedPrediction = prediction.toLowerCase().trim().replace(/\s+/g, ' ');
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as dup_count FROM bets 
      WHERE LOWER(wallet_address) = ${key} 
      AND external_event_id = ${eventId}
      AND LOWER(TRIM(prediction)) = ${normalizedPrediction}
      AND status != 'voided'
    `);
    const dupCount = Number(result.rows?.[0]?.dup_count || 0);
    if (dupCount > 0) {
      return { allowed: false, message: "You already have a bet on this outcome. Choose a different match or selection." };
    }
    return { allowed: true };
  } catch (error) {
    console.error('[DuplicateBet] DB check failed - FAIL CLOSED:', error);
    return { allowed: false, message: "Unable to verify duplicate bet. Please try again." };
  }
}

// ── Configurable stake limits (admin-adjustable at runtime) ────────────────
// These can be updated via POST /api/admin/update-stake-limits without a restart
let RUNTIME_MAX_STAKE_SBETS = 1_000_000; // 1,000,000 SBETS max per bet
const RUNTIME_MAX_STAKE_SUI = 100;    // 100 SUI max (fixed)
const RUNTIME_MAX_STAKE_USDSUI = 1;   // 1.00 USDsui max per bet (fixed)

// ── Futures-specific liability protection ────────────────────────────────────
// World Cup futures: 10K SBETS max stake — users can bet any odds freely
// Worst case: 10,000 × 251 = 2.51M SBETS payout — manageable for treasury
const FUTURES_MAX_STAKE_SBETS = 10_000;   // 10K SBETS max per futures bet
const FUTURES_MAX_STAKE_SUI = 1;          // 1 SUI max per futures bet
const FUTURES_MAX_STAKE_USDSUI = 0.5;     // 0.50 USDsui max per futures bet
const FUTURES_MAX_PAYOUT_SBETS = 7_000_000;  // 7M SBETS max payout per futures bet (safety net)
const FUTURES_MAX_PAYOUT_SUI = 150;       // 150 SUI max payout per futures bet (safety net)
const FUTURES_MAX_PAYOUT_USDSUI = 20;     // 20 USDsui max payout per futures bet

async function checkBetRateLimitDB(walletAddress: string): Promise<{ allowed: boolean; remaining?: number; message?: string }> {
  const key = walletAddress.toLowerCase();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as bet_count FROM bets 
      WHERE LOWER(wallet_address) = ${key} 
      AND created_at >= ${twentyFourHoursAgo}
      AND status != 'voided'
    `);
    const betCount = Number(result.rows?.[0]?.bet_count || 0);
    
    if (betCount >= MAX_BETS_PER_DAY) {
      return { 
        allowed: false,
        remaining: 0,
        message: `Daily bet limit reached. Maximum ${MAX_BETS_PER_DAY} bets per 24 hours. Try again later.`
      };
    }
    
    return { allowed: true, remaining: MAX_BETS_PER_DAY - betCount };
  } catch (error) {
    console.error('[RateLimit] DB check failed - FAIL CLOSED:', error);
    return { allowed: false, remaining: 0, message: "Unable to verify rate limit. Please try again." };
  }
}

// ANTI-EXPLOIT: Bet cooldown - minimum 60 seconds between bets per wallet (DB-backed)
const BET_COOLDOWN_MS = 60 * 1000; // 60 seconds between bets

async function checkBetCooldownDB(walletAddress: string): Promise<{ allowed: boolean; secondsLeft?: number }> {
  const key = walletAddress.toLowerCase();
  
  try {
    const result = await db.execute(sql`
      SELECT created_at FROM bets 
      WHERE LOWER(wallet_address) = ${key}
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (result.rows?.length > 0 && result.rows[0].created_at) {
      const lastBetTime = new Date(result.rows[0].created_at as string).getTime();
      const elapsed = Date.now() - lastBetTime;
      if (elapsed < BET_COOLDOWN_MS) {
        const secondsLeft = Math.ceil((BET_COOLDOWN_MS - elapsed) / 1000);
        return { allowed: false, secondsLeft };
      }
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('[Cooldown] DB check failed - FAIL CLOSED:', error);
    return { allowed: false, secondsLeft: Math.ceil(BET_COOLDOWN_MS / 1000) };
  }
}

// ANTI-EXPLOIT: Max 1 bet per event per wallet (DB-backed)
async function checkEventBetLimitDB(walletAddress: string, eventId: string): Promise<{ allowed: boolean; message?: string }> {
  const key = walletAddress.toLowerCase();
  
  try {
    const numericEventId = Number(eventId);
    const result = isNaN(numericEventId)
      ? await db.execute(sql`
          SELECT COUNT(*) as bet_count FROM bets 
          WHERE LOWER(wallet_address) = ${key} 
          AND external_event_id = ${eventId}
          AND status != 'voided'
        `)
      : await db.execute(sql`
          SELECT COUNT(*) as bet_count FROM bets 
          WHERE LOWER(wallet_address) = ${key} 
          AND (event_id = ${numericEventId} OR external_event_id = ${eventId})
          AND status != 'voided'
        `);
    const eventBetCount = Number(result.rows?.[0]?.bet_count || 0);
    
    if (eventBetCount >= MAX_BETS_PER_EVENT) {
      return { 
        allowed: false, 
        message: `Only 1 bet allowed per match. Choose a different match.` 
      };
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('[EventLimit] DB check failed - FAIL CLOSED:', error);
    return { allowed: false, message: "Unable to verify event bet limit. Please try again." };
  }
}

const MAX_PAYOUT_SUI = 150;
const MAX_PAYOUT_SBETS = 7_000_000;
const MAX_PAYOUT_USDSUI = 4;             // 4.00 USDsui max payout
const MAX_WALLET_EXPOSURE_SBETS = 100_000_000;
const MAX_WALLET_EXPOSURE_SUI = 2000;
const MAX_WALLET_EXPOSURE_USDSUI = 50;   // 50 USDsui max wallet exposure
const MAX_ODDS_CAP = 51.00;
const MAX_ODDS_CAP_FUTURES = 50.0;
const ODDS_TOLERANCE = 0.05; // 5% tolerance for odds deviation

function getMaxPayoutForCurrency(currency: string): number {
  if (currency === 'SBETS') return MAX_PAYOUT_SBETS;
  if (currency === 'USDSUI') return MAX_PAYOUT_USDSUI;
  return MAX_PAYOUT_SUI;
}
function getMaxStakeForCurrency(currency: string): number {
  if (currency === 'SBETS') return RUNTIME_MAX_STAKE_SBETS;
  if (currency === 'USDSUI') return RUNTIME_MAX_STAKE_USDSUI;
  return RUNTIME_MAX_STAKE_SUI;
}
function getMaxExposureForCurrency(currency: string): number {
  if (currency === 'SBETS') return MAX_WALLET_EXPOSURE_SBETS;
  if (currency === 'USDSUI') return MAX_WALLET_EXPOSURE_USDSUI;
  return MAX_WALLET_EXPOSURE_SUI;
}
function getCoinTypeFromCode(code: number): string {
  if (code === 0) return 'SUI';
  if (code === 2) return 'USDSUI';
  return 'SBETS';
}
function getDecimalsForCurrency(currency: string): number {
  return currency === 'USDSUI' ? 1e6 : 1e9;
}

function scaleToRange(val: number, outMin: number, outMax: number, inMin: number, inMax: number): number {
  if (val >= outMin && val <= outMax) return Math.round(val * 100) / 100;
  const clamped = Math.max(inMin, Math.min(val, inMax));
  const t = (clamped - inMin) / (inMax - inMin || 1);
  return Math.round((outMin + t * (outMax - outMin)) * 100) / 100;
}

function capAndRound(v: number): number {
  return Math.round(Math.min(Math.max(v, 1.01), 51.00) * 100) / 100;
}

function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const SPORT_ID_TO_NAME: Record<number, string> = {
  1: 'football', 2: 'basketball', 4: 'american-football', 5: 'baseball',
  6: 'hockey', 12: 'handball', 15: 'rugby', 16: 'volleyball',
};

async function applyRealFavourites(events: any[], svc: any): Promise<void> {
  const bySportLeague = new Map<string, any[]>();
  let skipped = 0;
  for (const ev of events) {
    const sport = SPORT_ID_TO_NAME[ev.sportId];
    if (!sport || !ev.leagueId) { skipped++; continue; }
    const key = `${sport}_${ev.leagueId}`;
    if (!bySportLeague.has(key)) bySportLeague.set(key, []);
    bySportLeague.get(key)!.push(ev);
  }

  if (svc.isRateLimited?.()) {
    return;
  }

  const allEntries = [...bySportLeague.entries()];
  const entries = allEntries.slice(0, 15);

  let applied = 0;
  let errors = 0;
  for (const [key, groupEvents] of entries) {
    if (svc.isRateLimited?.()) break;
    const [sport, leagueId] = key.split('_');
    for (const ev of groupEvents) {
      try {
        const r = await svc.determineTeamStrength(
          ev.homeTeam, ev.awayTeam, sport, leagueId, String(ev.id)
        );
        ev._homeIsFav = r.homeIsFav;
        ev._strengthDiff = r.strengthDiff;
        applied++;
      } catch (e: any) {
        errors++;
      }
    }
  }
}

function compressMatchOdds(
  rawHome: number, rawDraw: number | null | undefined, rawAway: number,
  isLive: boolean, minute?: number | null, homeScore?: number, awayScore?: number,
  eventId?: string, homeTeam?: string, awayTeam?: string,
  homeIsFavOverride?: boolean
): { home: number; draw: number | null; away: number } {
  const FAV_MIN = 1.04, FAV_MAX = 1.24;
  const DRAW_MIN = 1.30, DRAW_MAX = 2.10;
  const UND_MIN = 1.70, UND_MAX = 2.80;

  const h = rawHome || 1.50;
  const a = rawAway || 1.50;
  const hasDraw = rawDraw !== null && rawDraw !== undefined;

  const homeIsFav = homeIsFavOverride !== undefined ? homeIsFavOverride : h <= a;

  const seed = stableHash((homeTeam || '') + '|' + (awayTeam || '') + '|' + (eventId || ''));
  const h1 = (seed % 10000) / 9999;
  const h2 = ((seed >> 7) % 10000) / 9999;
  const h3 = ((seed >> 14) % 10000) / 9999;

  let favOdds = FAV_MIN + h1 * (FAV_MAX - FAV_MIN);
  let undOdds = UND_MIN + h2 * (UND_MAX - UND_MIN);
  let drawVal: number | null = hasDraw ? DRAW_MIN + h3 * (DRAW_MAX - DRAW_MIN) : null;

  if (isLive && minute && minute > 0) {
    const hs = homeScore ?? 0;
    const as2 = awayScore ?? 0;
    const diff = hs - as2;
    const timeNorm = Math.min(minute / 90, 1);
    const compression = Math.pow(timeNorm, 1.5);

    if (diff !== 0) {
      const absDiff = Math.abs(diff);
      const goalPenalty = Math.min(absDiff, 4);
      const winnerOdds = Math.max(1.04, 1.15 - compression * 0.08 - goalPenalty * 0.02);
      const loserOdds = Math.min(15.00, UND_MAX + compression * 0.15 + goalPenalty * 0.05);
      const drawLive = hasDraw ? Math.min(10.00, DRAW_MAX + compression * 0.3 + goalPenalty * 0.15) : null;

      const homeIsWinning = diff > 0;
      return {
        home: capAndRound(homeIsWinning ? winnerOdds : loserOdds),
        draw: drawLive !== null ? capAndRound(drawLive) : null,
        away: capAndRound(homeIsWinning ? loserOdds : winnerOdds),
      };
    } else {
      favOdds = FAV_MIN + (1 - compression) * h1 * (FAV_MAX - FAV_MIN) + 0.04;
      undOdds = UND_MIN + (1 - compression) * h2 * (UND_MAX - UND_MIN);
      drawVal = hasDraw ? DRAW_MIN + h3 * (DRAW_MAX - DRAW_MIN) * 0.5 + compression * 0.15 : null;
      if (drawVal !== null) drawVal = Math.max(DRAW_MIN, Math.min(DRAW_MAX, drawVal));
    }
  }

  return {
    home: capAndRound(homeIsFav ? favOdds : undOdds),
    draw: drawVal !== null ? capAndRound(drawVal) : null,
    away: capAndRound(homeIsFav ? undOdds : favOdds),
  };
}

function compressTwoWayOdds(rawA: number, rawB: number, seedStr?: string): { a: number; b: number } {
  const FAV_MIN = 1.04, FAV_MAX = 1.24;
  const UND_MIN = 1.70, UND_MAX = 2.80;
  const aIsFav = rawA <= rawB;
  const seed = stableHash(seedStr || String(rawA) + '|' + String(rawB));
  const h1 = (seed % 10000) / 9999;
  const h2 = ((seed >> 7) % 10000) / 9999;
  const fav = capAndRound(FAV_MIN + h1 * (FAV_MAX - FAV_MIN));
  const und = capAndRound(UND_MIN + h2 * (UND_MAX - UND_MIN));
  return { a: aIsFav ? fav : und, b: aIsFav ? und : fav };
}

async function sanitizeWithFavourites(events: any[]): Promise<any[]> {
  if (events.length > 0) {
    try {
      await applyRealFavourites(events, apiSportsService);
    } catch (e) {}
  }
  return sanitizeEventsForServing(events);
}

function sanitizeEventsForServing(events: any[]): any[] {
  for (const ev of events) {
    const rawH = ev.homeOdds || 1.50;
    const rawD = ev.drawOdds ?? null;
    const rawA = ev.awayOdds || 1.50;
    const isLive = ev.isLive === true;

    const compressed = compressMatchOdds(rawH, rawD, rawA, isLive, ev.minute, ev.homeScore, ev.awayScore, String(ev.id || ''), ev.homeTeam, ev.awayTeam, ev._homeIsFav);
    delete ev._homeIsFav;
    delete ev._strengthDiff;
    ev.homeOdds = compressed.home;
    ev.awayOdds = compressed.away;
    ev.drawOdds = compressed.draw;
    if (ev.odds) {
      ev.odds.home = compressed.home;
      ev.odds.away = compressed.away;
      if (compressed.draw !== null) ev.odds.draw = compressed.draw;
    }

    if (!ev.markets || !Array.isArray(ev.markets)) continue;
    for (const market of ev.markets) {
      if (!market.outcomes || !Array.isArray(market.outcomes)) continue;

      if (market.name === 'Match Result' || market.name === 'Match Winner') {
        const drawOutcome = market.outcomes.find((o: any) => {
          const n = (o.name || '').toLowerCase();
          return n === 'draw' || n === 'x' || n === 'tie';
        });
        const homeOutcome = market.outcomes.find((o: any) =>
          o.name === ev.homeTeam || o.id?.includes('home')
        );
        const awayOutcome = market.outcomes.find((o: any) =>
          o.name === ev.awayTeam || o.id?.includes('away')
        );
        if (homeOutcome) {
          homeOutcome.odds = compressed.home;
          homeOutcome.probability = Math.round((1 / compressed.home) * 100) / 100;
        }
        if (awayOutcome) {
          awayOutcome.odds = compressed.away;
          awayOutcome.probability = Math.round((1 / compressed.away) * 100) / 100;
        }
        if (drawOutcome && compressed.draw !== null) {
          drawOutcome.odds = compressed.draw;
          drawOutcome.probability = Math.round((1 / compressed.draw) * 100) / 100;
        }
      } else {
        const mName = (market.name || '').toLowerCase();
        const isCorrectScore = mName.includes('correct score') || mName.includes('exact score');

        if (isCorrectScore) {
          const seed = stableHash((ev.homeTeam || '') + '|' + (ev.awayTeam || '') + '|cs');
          const favIsHome = compressed.home < compressed.away;
          for (const o of market.outcomes) {
            const scoreName = (o.name || '').trim();
            const parts = scoreName.match(/^(\d+)\s*[-:]\s*(\d+)$/);
            if (!parts) continue;
            const g1 = parseInt(parts[1]);
            const g2 = parseInt(parts[2]);
            const totalGoals = g1 + g2;
            const diff = Math.abs(g1 - g2);
            const favWins = favIsHome ? g1 > g2 : g2 > g1;
            const isDraw = g1 === g2;

            let baseOdds: number;
            if (totalGoals === 0) {
              baseOdds = 8.5;
            } else if (totalGoals === 1 && favWins) {
              baseOdds = 5.5;
            } else if (totalGoals === 1 && !favWins && !isDraw) {
              baseOdds = 9.0;
            } else if (isDraw && totalGoals === 2) {
              baseOdds = 7.0;
            } else if (totalGoals === 2 && favWins) {
              baseOdds = 7.5;
            } else if (totalGoals === 2 && !favWins) {
              baseOdds = 12.0;
            } else if (totalGoals === 3 && favWins && diff >= 2) {
              baseOdds = 9.5;
            } else if (totalGoals === 3 && favWins) {
              baseOdds = 8.5;
            } else if (totalGoals === 3 && !favWins) {
              baseOdds = 15.0;
            } else {
              baseOdds = 12.0 + totalGoals * 3.0;
            }

            const jitter = ((stableHash(scoreName + String(seed)) % 100) - 50) / 100;
            o.odds = Math.round(Math.max(3.5, baseOdds + jitter * 2) * 100) / 100;
            o.probability = Math.round((1 / o.odds) * 100) / 100;
          }
        } else {
          const nonDrawOutcomes = market.outcomes.filter((o: any) => {
            const n = (o.name || '').toLowerCase();
            return n !== 'draw' && n !== 'x' && n !== 'tie' && n !== 'other';
          });
          if (nonDrawOutcomes.length === 2) {
            const c = compressTwoWayOdds(nonDrawOutcomes[0].odds || 1.5, nonDrawOutcomes[1].odds || 1.5, (ev.homeTeam || '') + '|' + (ev.awayTeam || '') + '|' + market.name);
            nonDrawOutcomes[0].odds = c.a;
            nonDrawOutcomes[0].probability = Math.round((1 / c.a) * 100) / 100;
            nonDrawOutcomes[1].odds = c.b;
            nonDrawOutcomes[1].probability = Math.round((1 / c.b) * 100) / 100;
          } else {
            for (const o of market.outcomes) {
              if (o.odds && o.odds > 0) {
                o.odds = Math.round(Math.min(Math.max(o.odds, 1.01), 50.00) * 100) / 100;
              }
            }
          }
        }
      }

      for (const o of market.outcomes) {
        const name = (o.name || '').toLowerCase();
        if (name === 'other') { o.odds = 0; }
      }
      market.outcomes = market.outcomes.filter((o: any) => {
        const name = (o.name || '').toLowerCase();
        return name !== 'other' && o.odds > 0;
      });
    }
    ev.markets = ev.markets.filter((m: any) => m.outcomes && m.outcomes.length >= 2);
  }
  return events;
}

const WORLD_CUP_2026_FUTURES = {
  id: 'wc2026_winner',
  name: 'FIFA World Cup 2026',
  type: 'outright_winner',
  description: 'Who will win the 2026 FIFA World Cup?',
  closingDate: '2026-06-11T00:00:00Z',
  settlementDate: '2026-07-19T23:59:59Z',
  status: 'open' as const,
  markets: [
    {
      id: 'wc2026_outright',
      name: 'Outright Winner',
      selections: [
        { id: 'wc2026_spain', name: 'Spain', odds: 5.50, flag: 'ES' },
        { id: 'wc2026_england', name: 'England', odds: 6.50, flag: 'GB-ENG' },
        { id: 'wc2026_france', name: 'France', odds: 9.00, flag: 'FR' },
        { id: 'wc2026_brazil', name: 'Brazil', odds: 9.00, flag: 'BR' },
        { id: 'wc2026_argentina', name: 'Argentina', odds: 9.00, flag: 'AR' },
        { id: 'wc2026_portugal', name: 'Portugal', odds: 12.00, flag: 'PT' },
        { id: 'wc2026_germany', name: 'Germany', odds: 13.00, flag: 'DE' },
        { id: 'wc2026_netherlands', name: 'Netherlands', odds: 21.00, flag: 'NL' },
        { id: 'wc2026_norway', name: 'Norway', odds: 26.00, flag: 'NO' },
        { id: 'wc2026_italy', name: 'Italy', odds: 34.00, flag: 'IT' },
        { id: 'wc2026_belgium', name: 'Belgium', odds: 34.00, flag: 'BE' },
        { id: 'wc2026_colombia', name: 'Colombia', odds: 51.00, flag: 'CO' },
        { id: 'wc2026_morocco', name: 'Morocco', odds: 51.00, flag: 'MA' },
        { id: 'wc2026_usa', name: 'United States', odds: 67.00, flag: 'US' },
        { id: 'wc2026_mexico', name: 'Mexico', odds: 81.00, flag: 'MX' },
        { id: 'wc2026_uruguay', name: 'Uruguay', odds: 81.00, flag: 'UY' },
        { id: 'wc2026_ecuador', name: 'Ecuador', odds: 101.00, flag: 'EC' },
        { id: 'wc2026_croatia', name: 'Croatia', odds: 101.00, flag: 'HR' },
        { id: 'wc2026_cameroon', name: 'Cameroon', odds: 101.00, flag: 'CM' },
        { id: 'wc2026_senegal', name: 'Senegal', odds: 101.00, flag: 'SN' },
        { id: 'wc2026_switzerland', name: 'Switzerland', odds: 101.00, flag: 'CH' },
        { id: 'wc2026_denmark', name: 'Denmark', odds: 101.00, flag: 'DK' },
        { id: 'wc2026_austria', name: 'Austria', odds: 151.00, flag: 'AT' },
        { id: 'wc2026_paraguay', name: 'Paraguay', odds: 151.00, flag: 'PY' },
        { id: 'wc2026_japan', name: 'Japan', odds: 151.00, flag: 'JP' },
        { id: 'wc2026_south_korea', name: 'South Korea', odds: 151.00, flag: 'KR' },
        { id: 'wc2026_australia', name: 'Australia', odds: 201.00, flag: 'AU' },
        { id: 'wc2026_nigeria', name: 'Nigeria', odds: 201.00, flag: 'NG' },
        { id: 'wc2026_serbia', name: 'Serbia', odds: 201.00, flag: 'RS' },
        { id: 'wc2026_turkey', name: 'Turkey', odds: 201.00, flag: 'TR' },
        { id: 'wc2026_canada', name: 'Canada', odds: 251.00, flag: 'CA' },
        { id: 'wc2026_poland', name: 'Poland', odds: 251.00, flag: 'PL' },
      ]
    },
    {
      id: 'wc2026_reach_final',
      name: 'To Reach The Final',
      selections: [
        { id: 'wc2026_final_spain', name: 'Spain', odds: 3.00, flag: 'ES' },
        { id: 'wc2026_final_england', name: 'England', odds: 3.50, flag: 'GB-ENG' },
        { id: 'wc2026_final_france', name: 'France', odds: 4.50, flag: 'FR' },
        { id: 'wc2026_final_brazil', name: 'Brazil', odds: 4.50, flag: 'BR' },
        { id: 'wc2026_final_argentina', name: 'Argentina', odds: 4.50, flag: 'AR' },
        { id: 'wc2026_final_portugal', name: 'Portugal', odds: 6.00, flag: 'PT' },
        { id: 'wc2026_final_germany', name: 'Germany', odds: 6.50, flag: 'DE' },
        { id: 'wc2026_final_netherlands', name: 'Netherlands', odds: 10.00, flag: 'NL' },
        { id: 'wc2026_final_italy', name: 'Italy', odds: 15.00, flag: 'IT' },
        { id: 'wc2026_final_belgium', name: 'Belgium', odds: 15.00, flag: 'BE' },
        { id: 'wc2026_final_usa', name: 'United States', odds: 26.00, flag: 'US' },
        { id: 'wc2026_final_colombia', name: 'Colombia', odds: 21.00, flag: 'CO' },
        { id: 'wc2026_final_croatia', name: 'Croatia', odds: 34.00, flag: 'HR' },
        { id: 'wc2026_final_uruguay', name: 'Uruguay', odds: 34.00, flag: 'UY' },
        { id: 'wc2026_final_mexico', name: 'Mexico', odds: 34.00, flag: 'MX' },
      ]
    },
    {
      id: 'wc2026_top_scorer_team',
      name: 'Top Scoring Team',
      selections: [
        { id: 'wc2026_scorer_spain', name: 'Spain', odds: 6.00, flag: 'ES' },
        { id: 'wc2026_scorer_france', name: 'France', odds: 7.00, flag: 'FR' },
        { id: 'wc2026_scorer_england', name: 'England', odds: 7.00, flag: 'GB-ENG' },
        { id: 'wc2026_scorer_brazil', name: 'Brazil', odds: 8.00, flag: 'BR' },
        { id: 'wc2026_scorer_germany', name: 'Germany', odds: 8.00, flag: 'DE' },
        { id: 'wc2026_scorer_argentina', name: 'Argentina', odds: 9.00, flag: 'AR' },
        { id: 'wc2026_scorer_portugal', name: 'Portugal', odds: 11.00, flag: 'PT' },
        { id: 'wc2026_scorer_netherlands', name: 'Netherlands', odds: 17.00, flag: 'NL' },
      ]
    },
    {
      id: 'wc2026_continent',
      name: 'Winning Continent',
      selections: [
        { id: 'wc2026_cont_europe', name: 'Europe', odds: 1.40, flag: 'EU' },
        { id: 'wc2026_cont_south_america', name: 'South America', odds: 3.50, flag: 'SA' },
        { id: 'wc2026_cont_africa', name: 'Africa', odds: 21.00, flag: 'AF' },
        { id: 'wc2026_cont_asia', name: 'Asia', odds: 51.00, flag: 'AS' },
        { id: 'wc2026_cont_north_america', name: 'North/Central America', odds: 67.00, flag: 'NA' },
      ]
    },
    {
      id: 'wc2026_total_goals',
      name: 'Tournament Total Goals',
      selections: [
        { id: 'wc2026_goals_under_120', name: 'Under 120.5 Goals', odds: 3.50, flag: 'EU' },
        { id: 'wc2026_goals_120_140', name: '120.5 - 140.5 Goals', odds: 2.75, flag: 'EU' },
        { id: 'wc2026_goals_140_160', name: '140.5 - 160.5 Goals', odds: 2.50, flag: 'EU' },
        { id: 'wc2026_goals_160_180', name: '160.5 - 180.5 Goals', odds: 3.00, flag: 'EU' },
        { id: 'wc2026_goals_180_200', name: '180.5 - 200.5 Goals', odds: 4.00, flag: 'EU' },
        { id: 'wc2026_goals_over_200', name: 'Over 200.5 Goals', odds: 5.00, flag: 'EU' },
      ]
    },
    {
      id: 'wc2026_golden_boot',
      name: 'Golden Boot Winner',
      selections: [
        { id: 'wc2026_boot_mbappe', name: 'Kylian Mbappé', odds: 7.00, flag: 'FR' },
        { id: 'wc2026_boot_haaland', name: 'Erling Haaland', odds: 8.00, flag: 'NO' },
        { id: 'wc2026_boot_vinicius', name: 'Vinícius Jr', odds: 11.00, flag: 'BR' },
        { id: 'wc2026_boot_kane', name: 'Harry Kane', odds: 12.00, flag: 'GB-ENG' },
        { id: 'wc2026_boot_bellingham', name: 'Jude Bellingham', odds: 15.00, flag: 'GB-ENG' },
        { id: 'wc2026_boot_lamine', name: 'Lamine Yamal', odds: 17.00, flag: 'ES' },
        { id: 'wc2026_boot_messi', name: 'Lionel Messi', odds: 21.00, flag: 'AR' },
        { id: 'wc2026_boot_lewandowski', name: 'Robert Lewandowski', odds: 26.00, flag: 'PL' },
        { id: 'wc2026_boot_ronaldo', name: 'Cristiano Ronaldo', odds: 26.00, flag: 'PT' },
        { id: 'wc2026_boot_salah', name: 'Mohamed Salah', odds: 34.00, flag: 'EU' },
        { id: 'wc2026_boot_osimhen', name: 'Victor Osimhen', odds: 34.00, flag: 'NG' },
        { id: 'wc2026_boot_saka', name: 'Bukayo Saka', odds: 34.00, flag: 'GB-ENG' },
        { id: 'wc2026_boot_alvarez', name: 'Julián Álvarez', odds: 41.00, flag: 'AR' },
        { id: 'wc2026_boot_isak', name: 'Alexander Isak', odds: 41.00, flag: 'NO' },
        { id: 'wc2026_boot_pulisic', name: 'Christian Pulisic', odds: 51.00, flag: 'US' },
        { id: 'wc2026_boot_davies', name: 'Alphonso Davies', odds: 67.00, flag: 'CA' },
      ]
    },
    {
      id: 'wc2026_group_stage_exit',
      name: 'Group Stage Exit',
      selections: [
        { id: 'wc2026_exit_spain', name: 'Spain to exit in groups', odds: 13.00, flag: 'ES' },
        { id: 'wc2026_exit_england', name: 'England to exit in groups', odds: 11.00, flag: 'GB-ENG' },
        { id: 'wc2026_exit_france', name: 'France to exit in groups', odds: 9.00, flag: 'FR' },
        { id: 'wc2026_exit_brazil', name: 'Brazil to exit in groups', odds: 9.00, flag: 'BR' },
        { id: 'wc2026_exit_argentina', name: 'Argentina to exit in groups', odds: 11.00, flag: 'AR' },
        { id: 'wc2026_exit_germany', name: 'Germany to exit in groups', odds: 7.00, flag: 'DE' },
        { id: 'wc2026_exit_portugal', name: 'Portugal to exit in groups', odds: 8.00, flag: 'PT' },
        { id: 'wc2026_exit_netherlands', name: 'Netherlands to exit in groups', odds: 6.00, flag: 'NL' },
        { id: 'wc2026_exit_usa', name: 'USA to exit in groups', odds: 3.00, flag: 'US' },
        { id: 'wc2026_exit_mexico', name: 'Mexico to exit in groups', odds: 2.75, flag: 'MX' },
        { id: 'wc2026_exit_canada', name: 'Canada to exit in groups', odds: 2.00, flag: 'CA' },
        { id: 'wc2026_exit_japan', name: 'Japan to exit in groups', odds: 3.25, flag: 'JP' },
        { id: 'wc2026_exit_south_korea', name: 'South Korea to exit in groups', odds: 2.75, flag: 'KR' },
        { id: 'wc2026_exit_australia', name: 'Australia to exit in groups', odds: 2.00, flag: 'AU' },
      ]
    }
  ]
};

function isFuturesEvent(eventId: string): boolean {
  return eventId.startsWith('wc2026_');
}

function lookupFuturesOdds(eventId: string, selectionId: string): number | null {
  for (const market of WORLD_CUP_2026_FUTURES.markets) {
    for (const sel of market.selections) {
      if (sel.id === selectionId || sel.id === eventId) {
        return sel.odds;
      }
    }
  }
  return null;
}

// Re-export shared parlay parser
import { extractParlayLegIds } from "./utils/parlayParser";

function lookupServerOdds(
  eventId: string,
  prediction: string,
  outcomeId: string
): { found: boolean; serverOdds?: number; maxAllowedOdds?: number; source?: string } {
  const predLower = (prediction || '').toLowerCase().trim();
  const outcomeIdLower = (outcomeId || '').toLowerCase().trim();
  
  const footballLookup = apiSportsService.lookupEventSync(eventId);
  if (footballLookup.found) {
    const cachedOdds = apiSportsService.getOddsFromCache(eventId);
    if (cachedOdds) {
      const homeTeamLower = (footballLookup.homeTeam || '').toLowerCase().trim();
      const awayTeamLower = (footballLookup.awayTeam || '').toLowerCase().trim();
      
      const homePatterns = ['home', 'h', '1', 'home_team', 'hometeam', 'home-win', 'homewin'];
      const awayPatterns = ['away', 'a', '2', 'away_team', 'awayteam', 'away-win', 'awaywin'];
      const drawPatterns = ['draw', 'x', 'd', 'tie'];
      
      const isHome = homePatterns.some(p => outcomeIdLower === p || outcomeIdLower.startsWith(p + '_')) ||
                      (homeTeamLower.length > 2 && predLower.includes(homeTeamLower));
      const isAway = awayPatterns.some(p => outcomeIdLower === p || outcomeIdLower.startsWith(p + '_')) ||
                      (awayTeamLower.length > 2 && predLower.includes(awayTeamLower));
      const isDraw = drawPatterns.some(p => outcomeIdLower === p || outcomeIdLower.startsWith(p + '_')) ||
                      predLower === 'draw' || predLower === 'tie';
      
      const isBttsYes = predLower === 'yes' || predLower === 'btts yes' || outcomeIdLower.includes('btts-yes');
      const isBttsNo = predLower === 'no' || predLower === 'btts no' || outcomeIdLower.includes('btts-no');
      const isOver = predLower === 'over 2.5' || predLower.startsWith('over') || outcomeIdLower.includes('over');
      const isUnder = predLower === 'under 2.5' || predLower.startsWith('under') || outcomeIdLower.includes('under');
      const isDcHomeOrDraw = predLower === 'home or draw' || outcomeIdLower.includes('dc-1x') || predLower === '1x';
      const isDcHomeOrAway = predLower === 'home or away' || outcomeIdLower.includes('dc-12') || predLower === '12';
      const isDcDrawOrAway = predLower === 'draw or away' || outcomeIdLower.includes('dc-x2') || predLower === 'x2';

      let serverOdds: number | undefined;
      if (isHome && cachedOdds.homeOdds) serverOdds = cachedOdds.homeOdds;
      else if (isAway && cachedOdds.awayOdds) serverOdds = cachedOdds.awayOdds;
      else if (isDraw && cachedOdds.drawOdds) serverOdds = cachedOdds.drawOdds;
      else if (isBttsYes && cachedOdds.bttsYes) serverOdds = cachedOdds.bttsYes;
      else if (isBttsNo && cachedOdds.bttsNo) serverOdds = cachedOdds.bttsNo;
      else if (isOver && cachedOdds.overOdds) serverOdds = cachedOdds.overOdds;
      else if (isUnder && cachedOdds.underOdds) serverOdds = cachedOdds.underOdds;
      else if (isDcHomeOrDraw && cachedOdds.dcHomeOrDraw) serverOdds = cachedOdds.dcHomeOrDraw;
      else if (isDcHomeOrAway && cachedOdds.dcHomeOrAway) serverOdds = cachedOdds.dcHomeOrAway;
      else if (isDcDrawOrAway && cachedOdds.dcDrawOrAway) serverOdds = cachedOdds.dcDrawOrAway;
      
      if (serverOdds) {
        return {
          found: true,
          serverOdds,
          maxAllowedOdds: parseFloat((serverOdds * (1 + ODDS_TOLERANCE)).toFixed(2)),
          source: 'api-sports-cache'
        };
      }
    }
    
    return { found: false, source: 'api-sports-no-odds' };
  }
  
  const freeLookup = freeSportsService.lookupEvent(eventId);
  if (freeLookup.found && freeLookup.event) {
    const ev = freeLookup.event;
    const homeTeamLower = (ev.homeTeam || '').toLowerCase().trim();
    const awayTeamLower = (ev.awayTeam || '').toLowerCase().trim();
    
    let serverOdds: number | undefined;
    
    if (ev.markets && ev.markets.length > 0) {
      for (const market of ev.markets) {
        for (const outcome of market.outcomes) {
          const oNameLower = outcome.name.toLowerCase().trim();
          const oIdLower = outcome.id.toLowerCase().trim();
          if (
            oNameLower === predLower ||
            oIdLower === outcomeIdLower ||
            (oIdLower === 'home' && (predLower.includes(homeTeamLower) || outcomeIdLower === 'home')) ||
            (oIdLower === 'away' && (predLower.includes(awayTeamLower) || outcomeIdLower === 'away')) ||
            (oIdLower === 'draw' && (predLower === 'draw' || outcomeIdLower === 'draw'))
          ) {
            serverOdds = outcome.odds;
            break;
          }
        }
        if (serverOdds) break;
      }
    }
    
    if (!serverOdds) {
      if (predLower.includes(homeTeamLower) || outcomeIdLower === 'home') serverOdds = ev.homeOdds;
      else if (predLower.includes(awayTeamLower) || outcomeIdLower === 'away') serverOdds = ev.awayOdds;
      else if (predLower === 'draw' || outcomeIdLower === 'draw') serverOdds = ev.drawOdds ?? undefined;
    }
    
    if (serverOdds) {
      return {
        found: true,
        serverOdds,
        maxAllowedOdds: parseFloat((serverOdds * (1 + ODDS_TOLERANCE)).toFixed(2)),
        source: 'free-sports'
      };
    }
    return { found: false, source: 'free-sports-no-match' };
  }
  
  const esportsLookup = esportsService.lookupEvent(eventId);
  if (esportsLookup.found && esportsLookup.event) {
    const ev = esportsLookup.event;
    const homeTeamLower = (ev.homeTeam || '').toLowerCase().trim();
    const awayTeamLower = (ev.awayTeam || '').toLowerCase().trim();
    
    let serverOdds: number | undefined;
    if (ev.markets && ev.markets.length > 0) {
      for (const market of ev.markets) {
        for (const outcome of market.outcomes) {
          const oNameLower = outcome.name.toLowerCase().trim();
          const oIdLower = outcome.id.toLowerCase().trim();
          if (oNameLower === predLower || oIdLower === outcomeIdLower ||
              (oIdLower === 'home' && (predLower.includes(homeTeamLower) || outcomeIdLower === 'home')) ||
              (oIdLower === 'away' && (predLower.includes(awayTeamLower) || outcomeIdLower === 'away'))) {
            serverOdds = outcome.odds;
            break;
          }
        }
        if (serverOdds) break;
      }
    }
    if (!serverOdds) {
      if (predLower.includes(homeTeamLower) || outcomeIdLower === 'home') serverOdds = ev.homeOdds;
      else if (predLower.includes(awayTeamLower) || outcomeIdLower === 'away') serverOdds = ev.awayOdds;
    }
    
    if (serverOdds) {
      return {
        found: true,
        serverOdds,
        maxAllowedOdds: parseFloat((serverOdds * (1 + ODDS_TOLERANCE)).toFixed(2)),
        source: 'esports'
      };
    }
    return { found: false, source: 'esports-no-match' };
  }
  
  return { found: false };
}

export async function registerRoutes(app: express.Express): Promise<Server> {
  // Initialize services
  const adminService = new AdminService();

  // Validate environment on startup
  const envValidation = EnvValidationService.validateEnvironment();
  EnvValidationService.printValidationResults(envValidation);

  // Start the settlement worker for automatic bet settlement
  settlementWorker.start();
  console.log('🔄 Settlement worker started - will automatically settle bets when matches finish');
  
  console.log('💰 Treasury auto-withdraw DISABLED - users claim manually via /api/revenue/claim and /api/revenue/lp-claim');
  console.log('📊 Revenue distribution DISABLED - claim-only model active');

  import('./services/treasuryGuardService').then(({ treasuryGuard }) => {
    treasuryGuard.init().then(() => console.log('🛡️ Treasury guard initialized (outflow limits + audit log)'));
  });

  import('./services/buybackService').then(({ buybackService }) => {
    buybackService.start().then(() => {
      console.log('🔄 SBETS auto-buyback service started (3% of SUI revenue → Cetus swap)');
    });
  });

  
  // Start background odds prefetcher for 100% real odds coverage
  apiSportsService.startOddsPrefetcher();
  console.log('🎰 Odds prefetcher started - continuously warming odds cache for instant responses');
  
  // Start FREE sports scheduler (basketball, baseball, hockey, MMA, american-football)
  // These use free API tier: fetch once/day morning + results once/day night
  freeSportsService.startSchedulers();
  console.log('🏀 API-Sports scheduler started - updates for basketball, baseball, hockey, MMA, american-football, AFL, F1, handball, rugby, volleyball');

  esportsService.start();
  console.log('🎮 Esports service started - LoL Esports + Dota 2 pro matches (free APIs)');

  startLpBackgroundRefresh();

  // WALRUS RETRY WORKER: Continuously upgrade local_ blob IDs to real Walrus blobs
  async function walrusRetryWorker() {
    try {
      const localBets = await db.select({
        id: betsGlobal.id,
        walrusBlobId: betsGlobal.walrusBlobId,
        walrusReceiptData: betsGlobal.walrusReceiptData,
      }).from(betsGlobal)
        .where(drizzleAnd(
          drizzleLike(betsGlobal.walrusBlobId, 'local_%'),
          drizzleIsNotNull(betsGlobal.walrusReceiptData),
        ))
        .limit(15);

      if (localBets.length === 0) return;

      console.log(`[Walrus Retry] 🔄 ${localBets.length} bets with local IDs — re-uploading to get real blob IDs...`);
      let upgraded = 0;

      for (const bet of localBets) {
        if (!bet.walrusReceiptData) continue;
        try {
          const result = await reuploadReceiptJson(bet.walrusReceiptData);
          if (result?.blobId) {
            await db.update(betsGlobal)
              .set({ walrusBlobId: result.blobId })
              .where(drizzleEq(betsGlobal.id, bet.id));
            console.log(`[Walrus Retry] ✅ Bet #${bet.id}: ${String(bet.walrusBlobId).slice(0, 14)} → ${result.blobId} (via ${result.publisherUsed.split('/').slice(2, 3).join('')})`);
            upgraded++;
          }
        } catch (err: any) {
          console.warn(`[Walrus Retry] Bet #${bet.id} failed: ${err.message}`);
        }
      }

      if (upgraded > 0) {
        console.log(`[Walrus Retry] ✅ Upgraded ${upgraded}/${localBets.length} bets to real Walrus blob IDs`);
      } else {
        console.log(`[Walrus Retry] No upgrades this cycle — publishers temporarily unavailable`);
      }
    } catch (err: any) {
      console.warn('[Walrus Retry] Worker error:', err.message);
    }
  }
  // Run immediately on startup, then every 3 minutes
  walrusRetryWorker();
  setInterval(walrusRetryWorker, 3 * 60 * 1000);
  console.log('🐋 Walrus retry worker started — upgrades local blob IDs to real Walrus blobs every 3 minutes');

  // AUTO-VOID completed: 69 phantom bets voided, 30M+ SBETS liability freed (2026-03-07)
  // Can still be triggered manually via POST /api/admin/void-phantom-sbets if needed

  // ── AUTO-VOID STUCK PARLAY BETS (Unknown teams) ──────────────────────────
  // Runs every 5 minutes — voids pending parlays where homeTeam=Unknown that are older than 48 hours
  async function autoVoidStuckParlays() {
    try {
      const cutoffStr = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
      console.log(`🗑️ [AutoVoid] Checking for stuck parlays older than: ${cutoffStr}`);
      const stuckParlays = await db.execute(sql`
        SELECT id, external_event_id, bet_amount, currency, potential_payout, wallet_address
        FROM bets
        WHERE status = 'pending'
          AND home_team = 'Unknown'
          AND external_event_id LIKE ${'parlay_%'}
          AND created_at < ${cutoffStr}
      `);

      const rows = Array.isArray(stuckParlays) ? stuckParlays : ((stuckParlays as any).rows || []);
      if (rows.length === 0) {
        console.log(`🗑️ [AutoVoid] No stuck parlays older than 48h found`);
        return;
      }

      console.log(`🗑️ [AutoVoid] Found ${rows.length} stuck parlay bets older than 48h with Unknown teams`);

      let voided = 0;
      let liabilityFreed = 0;

      for (const bet of rows) {
        try {
          await db.execute(sql`
            UPDATE bets SET status = 'void', settled_at = NOW()
            WHERE id = ${bet.id} AND status = 'pending'
          `);
          voided++;
          liabilityFreed += Number(bet.potential_payout || 0);
          console.log(`🗑️ [AutoVoid] Voided bet #${bet.id}: ${bet.external_event_id} (${bet.bet_amount} ${bet.currency}, payout: ${bet.potential_payout})`);
        } catch (err: any) {
          console.warn(`[AutoVoid] Failed to void bet #${bet.id}: ${err.message}`);
        }
      }

      if (voided > 0) {
        console.log(`✅ [AutoVoid] Voided ${voided} stuck parlays, freed ${liabilityFreed.toFixed(0)} liability`);
        try {
          const platformInfo = await blockchainBetService.getPlatformInfo();
          if (platformInfo) {
            const allBets = await db.execute(sql`
              SELECT currency, potential_payout FROM bets
              WHERE status IN ('pending', 'confirmed', 'in_play', 'open')
            `);
            const activeBets = allBets.rows || [];
            const realLiabilitySbets = activeBets
              .filter((b: any) => b.currency === 'SBETS')
              .reduce((sum: number, b: any) => sum + Number(b.potential_payout || 0), 0);
            const realLiabilitySui = activeBets
              .filter((b: any) => b.currency === 'SUI')
              .reduce((sum: number, b: any) => sum + Number(b.potential_payout || 0), 0);

            if (Math.abs(platformInfo.totalLiabilitySbets - realLiabilitySbets) > 1000) {
              await blockchainBetService.resetOnChainLiability('SBETS', realLiabilitySbets);
              console.log(`✅ [AutoVoid] Synced SBETS liability to ${realLiabilitySbets.toFixed(0)}`);
            }
            if (Math.abs(platformInfo.totalLiabilitySui - realLiabilitySui) > 0.1) {
              await blockchainBetService.resetOnChainLiability('SUI', realLiabilitySui);
              console.log(`✅ [AutoVoid] Synced SUI liability to ${realLiabilitySui.toFixed(4)}`);
            }
          }
        } catch (syncErr: any) {
          console.warn(`[AutoVoid] Liability sync failed: ${syncErr.message}`);
        }
      }
    } catch (err: any) {
      console.warn('[AutoVoid] Worker error:', err.message);
    }
  }
  autoVoidStuckParlays();
  setInterval(autoVoidStuckParlays, 5 * 60 * 1000);
  console.log('🗑️ Auto-void worker started — clears stuck Unknown parlays every 5 minutes');

  let isVoidingStaleBets = false;
  async function autoVoidStaleBets(hoursOldOverride?: number) {
    if (isVoidingStaleBets) {
      console.log('🧹 [StaleBetVoid] Already running — skipping');
      return;
    }
    isVoidingStaleBets = true;
    try {
      const hoursOld = hoursOldOverride || 48;
      const cutoffStr = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');

      const staleBetsResult = await db.execute(sql`
        SELECT id, external_event_id, bet_amount, currency, potential_payout, wallet_address, bet_object_id, created_at, home_team, away_team
        FROM bets
        WHERE status IN ('pending', 'confirmed', 'in_play', 'open')
          AND created_at < ${cutoffStr}
      `);

      const rows = Array.isArray(staleBetsResult) ? staleBetsResult : ((staleBetsResult as any).rows || []);
      if (rows.length === 0) {
        return;
      }

      console.log(`🧹 [StaleBetVoid] Found ${rows.length} unsettled bets older than ${hoursOld}h`);

      let voidedDb = 0;
      let settledOnChain = 0;
      let skippedChainFail = 0;
      let liabilityFreed = 0;

      for (const bet of rows) {
        try {
          const betObjId = bet.bet_object_id;
          let onChainHandled = true;

          if (betObjId && blockchainBetService.isAdminKeyConfigured()) {
            try {
              const onChainInfo = await blockchainBetService.getOnChainBetInfo(betObjId);
              if (onChainInfo && !onChainInfo.settled) {
                const currency = bet.currency || 'SUI';
                const settleResult = currency === 'SBETS'
                  ? await blockchainBetService.executeSettleBetSbetsOnChain(betObjId, false)
                  : await blockchainBetService.executeSettleBetOnChain(betObjId, false);
                if (settleResult.success) {
                  settledOnChain++;
                  console.log(`🧹 [StaleBetVoid] Settled on-chain as lost: ${betObjId.slice(0, 16)}... TX: ${settleResult.txHash}`);
                } else {
                  onChainHandled = false;
                  skippedChainFail++;
                  console.warn(`🧹 [StaleBetVoid] On-chain settle FAILED for ${bet.id}: ${settleResult.error} — skipping DB void to avoid liability mismatch`);
                }
                await new Promise(resolve => setTimeout(resolve, 1500));
              } else if (onChainInfo?.settled) {
                console.log(`🧹 [StaleBetVoid] Already settled on-chain: ${betObjId.slice(0, 16)}...`);
              } else if (!onChainInfo) {
                console.log(`🧹 [StaleBetVoid] Bet object not found on-chain: ${betObjId.slice(0, 16)}... — proceeding with DB void`);
              }
            } catch (chainErr: any) {
              onChainHandled = false;
              skippedChainFail++;
              console.warn(`🧹 [StaleBetVoid] On-chain settle error for ${bet.id}: ${chainErr.message} — skipping DB void`);
            }
          }

          if (!onChainHandled) {
            continue;
          }

          const updateResult = await db.execute(sql`
            UPDATE bets SET status = 'void', settled_at = NOW()
            WHERE id = ${bet.id} AND status IN ('pending', 'confirmed', 'in_play', 'open')
          `);
          const affected = (updateResult as any).rowCount || (updateResult as any).count || 0;
          if (affected > 0) {
            voidedDb++;
            liabilityFreed += Number(bet.potential_payout || 0);
            const eventDesc = bet.external_event_id || `${bet.home_team} vs ${bet.away_team}`;
            console.log(`🧹 [StaleBetVoid] Voided #${bet.id}: ${eventDesc} (${bet.bet_amount} ${bet.currency}, payout: ${bet.potential_payout})`);
          }
        } catch (err: any) {
          console.warn(`🧹 [StaleBetVoid] Failed to void bet #${bet.id}: ${err.message}`);
        }
      }

      if (voidedDb > 0 && skippedChainFail === 0) {
        console.log(`✅ [StaleBetVoid] Voided ${voidedDb} stale bets (${settledOnChain} settled on-chain), freed ${liabilityFreed.toFixed(0)} liability`);
        try {
          const platformInfo = await blockchainBetService.getPlatformInfo();
          if (platformInfo) {
            const activeBetsResult = await db.execute(sql`
              SELECT currency, potential_payout FROM bets
              WHERE status IN ('pending', 'confirmed', 'in_play', 'open')
            `);
            const activeBets = activeBetsResult.rows || [];
            const realLiabilitySbets = activeBets
              .filter((b: any) => b.currency === 'SBETS')
              .reduce((sum: number, b: any) => sum + Number(b.potential_payout || 0), 0);
            const realLiabilitySui = activeBets
              .filter((b: any) => b.currency === 'SUI')
              .reduce((sum: number, b: any) => sum + Number(b.potential_payout || 0), 0);

            if (platformInfo.totalLiabilitySbets > realLiabilitySbets && (platformInfo.totalLiabilitySbets - realLiabilitySbets) > 1000) {
              await blockchainBetService.resetOnChainLiability('SBETS', realLiabilitySbets);
              console.log(`✅ [StaleBetVoid] Synced SBETS on-chain liability: ${platformInfo.totalLiabilitySbets.toFixed(0)} → ${realLiabilitySbets.toFixed(0)}`);
            }
            if (platformInfo.totalLiabilitySui > realLiabilitySui && (platformInfo.totalLiabilitySui - realLiabilitySui) > 0.1) {
              await blockchainBetService.resetOnChainLiability('SUI', realLiabilitySui);
              console.log(`✅ [StaleBetVoid] Synced SUI on-chain liability: ${platformInfo.totalLiabilitySui.toFixed(4)} → ${realLiabilitySui.toFixed(4)}`);
            }
          }
        } catch (syncErr: any) {
          console.warn(`🧹 [StaleBetVoid] Liability sync failed: ${syncErr.message}`);
        }
      } else if (voidedDb > 0) {
        console.log(`⚠️ [StaleBetVoid] Voided ${voidedDb} bets but ${skippedChainFail} had on-chain failures — skipping liability sync to avoid under-collateralization`);
      }
    } catch (err: any) {
      console.warn('[StaleBetVoid] Worker error:', err.message);
    } finally {
      isVoidingStaleBets = false;
    }
  }
  setTimeout(() => autoVoidStaleBets(), 60000);
  setInterval(() => autoVoidStaleBets(), 30 * 60 * 1000);
  console.log('🧹 Stale bet auto-void started — voids ALL unsettled bets older than 48h every 30 minutes');

  // Shared guard: prevents both auto-resolve worker and manual endpoint from resolving the same prediction simultaneously
  const resolvingPredictions = new Set<number>();
  // Shared guard: prevents both auto-settle worker and manual endpoint from settling the same challenge simultaneously
  const settlingChallenges = new Set<number>();

  // Auto-resolve expired prediction markets every 2 minutes
  // Majority side (more SBETS wagered) wins and splits the pool
  setInterval(async () => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq, and, lt } = await import('drizzle-orm');
      const now = new Date();
      const expiredPredictions = await db.select().from(socialPredictions)
        .where(and(eq(socialPredictions.status, 'active'), lt(socialPredictions.endDate, now)));
      
      for (const prediction of expiredPredictions) {
        if (resolvingPredictions.has(prediction.id)) {
          console.log(`[AutoResolve] Prediction #${prediction.id} already being resolved, skipping`);
          continue;
        }
        resolvingPredictions.add(prediction.id);
        try {
          const [fresh] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, prediction.id));
          if (!fresh || fresh.status !== 'active') {
            console.log(`[AutoResolve] Prediction #${prediction.id} already resolved, skipping`);
            continue;
          }
          
          const allBets = await db.select().from(socialPredictionBets)
            .where(eq(socialPredictionBets.predictionId, prediction.id));
          
          const yesTotal = allBets.filter(b => b.side === 'yes').reduce((sum, b) => sum + (b.amount || 0), 0);
          const noTotal = allBets.filter(b => b.side === 'no').reduce((sum, b) => sum + (b.amount || 0), 0);
          const totalPool = yesTotal + noTotal;
          
          if (totalPool === 0 || allBets.length === 0) {
            await db.update(socialPredictions)
              .set({ status: 'expired', resolvedAt: now })
              .where(eq(socialPredictions.id, prediction.id));
            console.log(`[AutoResolve] Prediction #${prediction.id} expired with no bets`);
            continue;
          }
          
          const resolution = yesTotal >= noTotal ? 'yes' : 'no';
          const winners = allBets.filter(b => b.side === resolution);
          const winnersTotal = winners.reduce((sum, b) => sum + (b.amount || 0), 0);
          const newStatus = resolution === 'yes' ? 'resolved_yes' : 'resolved_no';
          
          if (winners.length === 0 || winnersTotal === 0) {
            await db.update(socialPredictions)
              .set({ status: newStatus, resolvedOutcome: resolution, resolvedAt: now })
              .where(eq(socialPredictions.id, prediction.id));
            console.log(`[AutoResolve] Prediction #${prediction.id} resolved ${resolution.toUpperCase()} - no winners`);
            continue;
          }
          
          console.log(`[AutoResolve] Prediction #${prediction.id} auto-resolving: YES=${yesTotal} vs NO=${noTotal} → ${resolution.toUpperCase()} wins | Pool: ${totalPool} SBETS`);
          
          let successCount = 0;
          let failCount = 0;
          for (let i = 0; i < winners.length; i++) {
            const winner = winners[i];
            const payout = ((winner.amount || 0) / winnersTotal) * totalPool;
            if (payout <= 0) continue;
            if (!isValidSuiWallet(winner.wallet)) {
              failCount++;
              console.error(`[AutoResolve] Skipped invalid wallet: ${String(winner.wallet).slice(0,12)}...`);
              continue;
            }
            if (i > 0) await new Promise(r => setTimeout(r, 3000));
            try {
              const result = await blockchainBetService.sendSbetsToUser(winner.wallet, payout);
              if (result.success) {
                successCount++;
                console.log(`[AutoResolve] Payout: ${payout.toFixed(0)} SBETS → ${winner.wallet.slice(0,10)}...`);
              } else {
                failCount++;
                console.error(`[AutoResolve] Payout failed: ${winner.wallet.slice(0,10)}... | ${result.error}`);
              }
            } catch (err: any) {
              failCount++;
              console.error(`[AutoResolve] Payout error: ${winner.wallet.slice(0,10)}... | ${err.message}`);
            }
          }
          
          const finalStatus = failCount === 0 ? newStatus : (successCount > 0 ? `${newStatus}_partial` : `${newStatus}_failed`);
          await db.update(socialPredictions)
            .set({ status: finalStatus, resolvedOutcome: resolution, resolvedAt: now })
            .where(eq(socialPredictions.id, prediction.id));
          console.log(`[AutoResolve] Prediction #${prediction.id} settled: ${successCount}/${winners.length} payouts OK`);
        } catch (err: any) {
          console.error(`[AutoResolve] Error resolving prediction #${prediction.id}:`, err.message);
        } finally {
          resolvingPredictions.delete(prediction.id);
        }
      }
    } catch (err: any) {
      console.error('[AutoResolve] Worker error:', err.message);
    }
  }, 2 * 60 * 1000);
  console.log('🎯 Prediction auto-resolve worker started - checks every 2 minutes for expired markets');

  // Auto-settle expired challenges every 2 minutes
  // Refunds all participants their stake when a challenge expires without manual settlement
  setInterval(async () => {
    try {
      const { socialChallenges, socialChallengeParticipants } = await import('@shared/schema');
      const { eq, and, lt } = await import('drizzle-orm');
      const now = new Date();
      const expiredChallenges = await db.select().from(socialChallenges)
        .where(and(eq(socialChallenges.status, 'open'), lt(socialChallenges.expiresAt, now)));

      for (const challenge of expiredChallenges) {
        if (settlingChallenges.has(challenge.id)) {
          console.log(`[AutoSettle] Challenge #${challenge.id} already being settled, skipping`);
          continue;
        }
        settlingChallenges.add(challenge.id);
        try {
          const [fresh] = await db.select().from(socialChallenges).where(eq(socialChallenges.id, challenge.id));
          if (!fresh || fresh.status !== 'open') {
            console.log(`[AutoSettle] Challenge #${challenge.id} already settled, skipping`);
            continue;
          }

          const participants = await db.select().from(socialChallengeParticipants)
            .where(eq(socialChallengeParticipants.challengeId, challenge.id));

          const stakeAmount = challenge.stakeAmount || 0;
          const allWallets = [challenge.creatorWallet!, ...participants.map(p => p.wallet)].filter(Boolean);

          if (allWallets.length === 0 || stakeAmount === 0) {
            await db.update(socialChallenges)
              .set({ status: 'expired' })
              .where(eq(socialChallenges.id, challenge.id));
            console.log(`[AutoSettle] Challenge #${challenge.id} expired with no participants`);
            continue;
          }

          console.log(`[AutoSettle] Challenge #${challenge.id} expired - refunding ${stakeAmount} SBETS to ${allWallets.length} participant(s)`);

          let successCount = 0;
          let failCount = 0;
          for (let i = 0; i < allWallets.length; i++) {
            const w = allWallets[i];
            if (!isValidSuiWallet(w)) {
              failCount++;
              console.error(`[AutoSettle] Skipped invalid wallet: ${String(w).slice(0,12)}...`);
              continue;
            }
            if (i > 0) await new Promise(r => setTimeout(r, 3000));
            try {
              const result = await blockchainBetService.sendSbetsToUser(w, stakeAmount);
              if (result.success) {
                successCount++;
                console.log(`[AutoSettle] Refund: ${stakeAmount} SBETS -> ${w.slice(0,10)}...`);
              } else {
                failCount++;
                console.error(`[AutoSettle] Refund failed: ${w.slice(0,10)}... | ${result.error}`);
              }
            } catch (err: any) {
              failCount++;
              console.error(`[AutoSettle] Refund error: ${w.slice(0,10)}... | ${err.message}`);
            }
          }

          const finalStatus = failCount === 0 ? 'expired_refunded' : (successCount > 0 ? 'expired_partial_refund' : 'expired_refund_failed');
          await db.update(socialChallenges)
            .set({ status: finalStatus })
            .where(eq(socialChallenges.id, challenge.id));
          console.log(`[AutoSettle] Challenge #${challenge.id} settled: ${successCount}/${allWallets.length} refunds OK | Status: ${finalStatus}`);
        } catch (err: any) {
          console.error(`[AutoSettle] Error settling challenge #${challenge.id}:`, err.message);
        } finally {
          settlingChallenges.delete(challenge.id);
        }
      }
    } catch (err: any) {
      console.error('[AutoSettle] Challenge worker error:', err.message);
    }
  }, 2 * 60 * 1000);
  console.log('🏆 Challenge auto-settle worker started - checks every 2 minutes for expired challenges');

  // Create HTTP server
  const httpServer = createServer(app);

  // ── Admin password — MUST be set as environment variable, no fallback ──────
  const getAdminPassword = (): string => {
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) throw new Error('ADMIN_PASSWORD environment variable is not configured');
    return pw;
  };

  // ── Admin session tokens — DB-backed, cryptographically secure, 1-hour expiry ─
  const SESSION_DURATION = 60 * 60 * 1000; // 1 hour
  const sessionCache = new Map<string, { expiresAt: number }>();

  const generateSecureToken = (): string =>
    crypto.randomBytes(32).toString('hex');

  const createAdminSession = async (ip: string): Promise<string> => {
    const token = generateSecureToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION);
    try {
      const { adminSessions } = await import('@shared/schema');
      await db.insert(adminSessions).values({ token, expiresAt, ipAddress: ip });
    } catch (e) {
      console.warn('[Admin] DB session insert failed, using memory fallback');
    }
    sessionCache.set(token, { expiresAt: expiresAt.getTime() });
    return token;
  };

  const isValidAdminSession = async (token: string): Promise<boolean> => {
    const cached = sessionCache.get(token);
    if (cached) {
      if (Date.now() > cached.expiresAt) {
        sessionCache.delete(token);
        return false;
      }
      return true;
    }
    try {
      const { adminSessions } = await import('@shared/schema');
      const { eq, and, gt } = await import('drizzle-orm');
      const rows = await db.select().from(adminSessions)
        .where(and(
          eq(adminSessions.token, token),
          eq(adminSessions.revoked, false),
          gt(adminSessions.expiresAt, new Date())
        )).limit(1);
      if (rows.length > 0) {
        sessionCache.set(token, { expiresAt: new Date(rows[0].expiresAt).getTime() });
        return true;
      }
    } catch (e) {
      // DB unavailable — deny
    }
    return false;
  };

  const validateAdminAuth = async (req: Request): Promise<boolean> => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    return !!token && await isValidAdminSession(token);
  };

  const revokeAdminSession = async (token: string): Promise<void> => {
    sessionCache.delete(token);
    try {
      const { adminSessions } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.update(adminSessions).set({ revoked: true }).where(eq(adminSessions.token, token));
    } catch (e) {}
  };

  // ── Brute-force lockout — 5 failed attempts → 15 min block per IP ──────────
  const loginFailures = new Map<string, { count: number; blockedUntil: number }>();
  const MAX_LOGIN_ATTEMPTS = 5;
  const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

  const checkLoginAllowed = (ip: string): { allowed: boolean; retryAfterMs: number } => {
    const entry = loginFailures.get(ip);
    if (!entry) return { allowed: true, retryAfterMs: 0 };
    if (Date.now() < entry.blockedUntil)
      return { allowed: false, retryAfterMs: entry.blockedUntil - Date.now() };
    if (entry.count >= MAX_LOGIN_ATTEMPTS && Date.now() >= entry.blockedUntil) {
      loginFailures.delete(ip);
    }
    return { allowed: true, retryAfterMs: 0 };
  };

  const recordLoginFailure = (ip: string): void => {
    const entry = loginFailures.get(ip) || { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_LOGIN_ATTEMPTS) {
      entry.blockedUntil = Date.now() + LOCKOUT_DURATION;
      console.warn(`🔒 ADMIN: IP ${ip} locked out for 15 minutes after ${entry.count} failed attempts`);
    }
    loginFailures.set(ip, entry);
  };

  const recordLoginSuccess = (ip: string): void => {
    loginFailures.delete(ip);
  };

  // Clean up expired sessions and lockouts periodically
  setInterval(async () => {
    const now = Date.now();
    sessionCache.forEach((session, token) => {
      if (now > session.expiresAt) sessionCache.delete(token);
    });
    loginFailures.forEach((entry, ip) => {
      if (now > entry.blockedUntil + LOCKOUT_DURATION) loginFailures.delete(ip);
    });
    try {
      const { adminSessions } = await import('@shared/schema');
      const { lt } = await import('drizzle-orm');
      await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
    } catch (e) {}
  }, 5 * 60 * 1000);

  // SAFETY NET: Background worker to auto-recover on-chain bets missing from DB
  // Scans recent on-chain bet events for the platform and inserts any missing DB records
  // This guarantees no bet is ever lost even if the frontend→backend POST fails
  const CONTRACT_PKG_ID = '0x4d83eab83defa9e2488b3c525f54fc588185cfc1a906e5dada1954bf52296e76';
  const PLATFORM_ID = '0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9';

  async function autoRecoverMissingBets() {
    try {
      const { bets: betsTable } = await import('@shared/schema');
      const { suiJsonRpc } = await import('./lib/suiRpcConfig');

      async function suiRpc(method: string, params: any[]) {
        return suiJsonRpc(method, params);
      }

      let cursor2: string | null = null;
      let events: any[] = [];
      for (let pg = 0; pg < 4; pg++) {
        const eventsResult = await suiRpc('suix_queryEvents', [
          { MoveEventType: `${CONTRACT_PKG_ID}::betting::BetPlaced` },
          cursor2, 50, true
        ]);
        const batch = eventsResult?.data || [];
        if (!batch.length) break;
        events = events.concat(batch);
        if (!eventsResult.hasNextPage) break;
        cursor2 = eventsResult.nextCursor;
      }
      if (!events.length) return;

      let recoveredCount = 0;
      for (const ev of events) {
        const parsed = ev.parsedJson || {};
        const txDigest = ev.id?.txDigest;
        if (!txDigest) continue;

        const existing = await db.execute(sql`SELECT id FROM bets WHERE tx_hash = ${txDigest} LIMIT 1`);
        if ((existing.rows?.length || 0) > 0) continue;

        const betObjectId = parsed.bet_id || null;
        if (betObjectId) {
          const existObj = await db.execute(sql`SELECT id FROM bets WHERE bet_object_id = ${betObjectId} LIMIT 1`);
          if ((existObj.rows?.length || 0) > 0) continue;
        }

        const bettor = parsed.bettor || '';
        const eventIdBytes = parsed.event_id;
        const eventIdStr = Array.isArray(eventIdBytes) ? String.fromCharCode(...eventIdBytes) : 'unknown';
        const oddsBps = parsed.odds_bps ? Number(parsed.odds_bps) : 200;
        const odds = oddsBps / 100;
        const rawAmount = parsed.amount ? Number(parsed.amount) : 0;
        const coinType = getCoinTypeFromCode(parseInt(parsed.coin_type || '0'));
        const decimals = getDecimalsForCurrency(coinType);
        const amount = rawAmount / decimals;
        const ts = ev.timestampMs ? new Date(parseInt(ev.timestampMs)) : new Date();
        const isParlay = eventIdStr.includes('parlay');
        const betId = betObjectId || `auto-${txDigest.slice(0, 16)}`;

        try {
          await db.insert(betsTable).values({
            userId: null,
            walletAddress: bettor.toLowerCase(),
            betAmount: amount,
            currency: coinType,
            odds,
            prediction: eventIdStr,
            potentialPayout: Math.round(amount * odds * 100) / 100,
            status: (() => {
              const payout = Math.round(amount * odds * 100) / 100;
              const mPay = getMaxPayoutForCurrency(coinType);
              const mStk = getMaxStakeForCurrency(coinType);
              if (payout > mPay || amount > mStk || odds > MAX_ODDS_CAP) {
                console.log(`🚫 AUTO-RECOVERY VOID: ${betId} payout=${payout} stake=${amount} odds=${odds} ${coinType}`);
                return 'void';
              }
              return 'pending';
            })(),
            betType: isParlay ? 'parlay' : 'single',
            cashOutAvailable: (() => {
              const payout = Math.round(amount * odds * 100) / 100;
              const mPay = getMaxPayoutForCurrency(coinType);
              const mStk = getMaxStakeForCurrency(coinType);
              return !(payout > mPay || amount > mStk || odds > MAX_ODDS_CAP);
            })(),
            wurlusBetId: betId,
            txHash: txDigest,
            platformFee: 0,
            networkFee: 0,
            feeCurrency: coinType,
            eventName: isParlay ? 'Parlay Bet (Auto-Recovered)' : 'Bet (Auto-Recovered)',
            externalEventId: eventIdStr,
            betObjectId: betObjectId,
            createdAt: ts,
          }).returning();
          recoveredCount++;
          console.log(`🔧 AUTO-RECOVERED: ${betId} for ${bettor.slice(0,12)}... (${amount} ${coinType})`);
        } catch (insertErr: any) {
          if (insertErr.code !== '23505') {
            console.error(`Auto-recovery insert failed:`, insertErr.message);
          }
        }
      }

      if (recoveredCount > 0) {
        console.log(`🔧 Auto-recovery: ${recoveredCount} missing bets recovered from on-chain events`);
      }
    } catch (err: any) {
      console.error('Auto-recovery worker error:', err.message);
    }
  }

  setTimeout(autoRecoverMissingBets, 30 * 1000);
  setInterval(autoRecoverMissingBets, 5 * 60 * 1000);
  console.log('🔧 Auto-recovery worker started - checks every 5 minutes for missing on-chain bets');

  async function recoverBetsForWallet(walletAddress: string): Promise<{ recovered: number; alreadyExist: number; errors: number }> {
    const results = { recovered: 0, alreadyExist: 0, errors: 0 };
    try {
      const normalizedWallet = walletAddress.toLowerCase();
      const { bets: betsTable } = await import('@shared/schema');
      const { suiJsonRpc: suiJsonRpcHelper } = await import('./lib/suiRpcConfig');

      async function suiRpcCall(method: string, params: any[]) {
        return suiJsonRpcHelper(method, params);
      }

      let digests: string[] = [];
      let txCursor: string | null = null;
      for (let page = 0; page < 5; page++) {
        const txList = await suiRpcCall('suix_queryTransactionBlocks', [
          { filter: { FromAddress: walletAddress } }, txCursor, 50, true
        ]);
        const batch = (txList?.data || []).map((t: any) => t.digest);
        digests = digests.concat(batch);
        if (!txList?.hasNextPage || !batch.length) break;
        txCursor = txList.nextCursor;
      }

      console.log(`🔍 Wallet sync (tx-scan): Found ${digests.length} transactions for ${walletAddress.slice(0, 12)}...`);

      const BATCH_SIZE = 50;
      const allTxDetails: any[] = [];
      for (let i = 0; i < digests.length; i += BATCH_SIZE) {
        const chunk = digests.slice(i, i + BATCH_SIZE);
        try {
          const batchResult = await suiRpcCall('sui_multiGetTransactionBlocks', [
            chunk, { showInput: true, showEffects: true, showEvents: true, showObjectChanges: true }
          ]);
          if (Array.isArray(batchResult)) {
            allTxDetails.push(...batchResult.filter((t: any) => t && t.digest));
          }
        } catch (batchErr: any) {
          console.warn(`[Sync] Batch fetch failed for ${chunk.length} txs, falling back to individual: ${batchErr.message}`);
          for (const d of chunk) {
            try {
              const tx = await suiRpcCall('sui_getTransactionBlock', [
                d, { showInput: true, showEffects: true, showEvents: true, showObjectChanges: true }
              ]);
              if (tx) allTxDetails.push(tx);
            } catch {}
          }
        }
      }

      console.log(`🔍 Wallet sync: Fetched ${allTxDetails.length} tx details for ${walletAddress.slice(0, 12)}...`);

      let betTxCount = 0;
      for (const tx of allTxDetails) {
        try {
          if (!tx) continue;

          const isBetTxByEvent = (tx.events || []).some((e: any) => 
            e.type?.includes('::betting::BetPlaced') || e.type?.includes('::betting::bet_placed')
          );

          const txData = tx.transaction?.data?.transaction;
          const calls = (txData?.transactions || []).filter((c: any) => c.MoveCall);
          const isBetTxByCall = calls.some((c: any) => {
            const pkg = c.MoveCall?.package || '';
            const fn = c.MoveCall?.function || '';
            const mod = c.MoveCall?.module || '';
            return fn.includes('place_bet') && mod === 'betting' && (
              pkg === CONTRACT_PKG_ID || 
              pkg.startsWith('0x4d83eab')
            );
          });

          const isBetTx = isBetTxByEvent || isBetTxByCall;
          if (!isBetTx) continue;

          if (tx.effects?.status?.status !== 'success') continue;
          betTxCount++;

          const digest = tx.digest;
          const existing = await db.execute(sql`SELECT id, wallet_address FROM bets WHERE tx_hash = ${digest} LIMIT 1`);
          if ((existing.rows?.length || 0) > 0) {
            const row = existing.rows[0] as any;
            if (!row.wallet_address || row.wallet_address.toLowerCase() !== normalizedWallet) {
              await db.execute(sql`UPDATE bets SET wallet_address = ${normalizedWallet} WHERE id = ${row.id} AND (wallet_address IS NULL OR wallet_address = '')`);
            }
            results.alreadyExist++;
            continue;
          }

          const betObjChange = (tx.objectChanges || []).find((c: any) =>
            c.type === 'created' && c.objectType?.includes('::betting::Bet')
          );
          const betObjectId = betObjChange?.objectId || null;

          if (betObjectId) {
            const existObj = await db.execute(sql`SELECT id FROM bets WHERE bet_object_id = ${betObjectId} LIMIT 1`);
            if ((existObj.rows?.length || 0) > 0) {
              const objRow = existObj.rows[0] as any;
              await db.execute(sql`UPDATE bets SET wallet_address = ${normalizedWallet}, tx_hash = ${digest} WHERE id = ${objRow.id}`);
              results.alreadyExist++;
              continue;
            }
          }

          const event = tx.events?.find((e: any) => e.type?.includes('BetPlaced'))?.parsedJson || tx.events?.[0]?.parsedJson || {};
          const eventIdBytes = (event as any).event_id;
          const eventIdStr = Array.isArray(eventIdBytes) ? String.fromCharCode(...eventIdBytes) : 'unknown';
          const oddsBps = (event as any).odds_bps ? Number((event as any).odds_bps) : ((event as any).odds ? Number((event as any).odds) : 200);
          const odds = oddsBps > 10 ? oddsBps / 100 : oddsBps;
          const rawCoinTypeVal = parseInt((event as any).coin_type || '0');
          const coinType = rawCoinTypeVal === 0 ? 'SUI' : rawCoinTypeVal === 2 ? 'USDSUI' : 'SBETS';
          const coinDecimals = coinType === 'USDSUI' ? 1e6 : 1e9;
          const rawAmount = (event as any).amount || (event as any).stake || 0;
          const amount = Number(rawAmount) / coinDecimals;
          const ts = tx.timestampMs ? new Date(parseInt(tx.timestampMs)) : new Date();
          const isParlay = eventIdStr.includes('parlay');
          const betId = betObjectId || `auto-${digest.slice(0, 16)}`;

          let eventName = isParlay ? 'Parlay Bet (Recovered)' : 'Bet (Recovered)';
          let homeTeam = 'Unknown';
          let awayTeam = 'Unknown';

          const refBet = await db.execute(sql`
            SELECT event_name, home_team, away_team FROM bets 
            WHERE external_event_id = ${eventIdStr} AND home_team != 'Unknown' AND away_team != 'Unknown'
            LIMIT 1
          `);
          if (refBet.rows?.length) {
            const ref = refBet.rows[0] as any;
            eventName = ref.event_name || eventName;
            homeTeam = ref.home_team || homeTeam;
            awayTeam = ref.away_team || awayTeam;
          } else {
            try {
              const eventLookup = apiSportsService.lookupEventSync(eventIdStr);
              if (eventLookup.found) {
                homeTeam = eventLookup.homeTeam || homeTeam;
                awayTeam = eventLookup.awayTeam || awayTeam;
                eventName = `${homeTeam} vs ${awayTeam}`;
              }
            } catch {}
          }

          let resolvedStatus: string = 'pending';
          let resolvedPayout: number = Math.round(amount * odds * 100) / 100;
          let onChainPrediction: string | undefined;
          if (betObjectId) {
            try {
              const onChainInfo = await blockchainBetService.getOnChainBetInfo(betObjectId);
              if (onChainInfo) {
                if (onChainInfo.prediction && onChainInfo.prediction !== eventIdStr) {
                  onChainPrediction = onChainInfo.prediction;
                  console.log(`📡 On-chain prediction for ${betObjectId.slice(0, 12)}...: "${onChainPrediction}"`);
                }
                if (onChainInfo.settled) {
                  resolvedStatus = onChainInfo.status;
                  if (onChainInfo.status === 'lost' || onChainInfo.status === 'void') {
                    resolvedPayout = 0;
                  }
                  console.log(`📡 On-chain status for ${betObjectId.slice(0, 12)}...: ${onChainInfo.status} (already settled)`);
                }
              }
            } catch (onChainErr: any) {
              console.warn(`[Recovery] Could not check on-chain status for ${betObjectId.slice(0, 12)}...: ${onChainErr.message}`);
            }
          }

          try {
            const recoveredMaxPayout = getMaxPayoutForCurrency(coinType);
            const recoveredMaxStake = getMaxStakeForCurrency(coinType);
            let recoveryStatus = resolvedStatus;
            if (resolvedStatus === 'pending') {
              if (resolvedPayout > recoveredMaxPayout) {
                recoveryStatus = 'void';
                console.log(`🚫 RECOVERY AUTO-VOID (payout cap): ${betId} payout ${resolvedPayout} ${coinType} > max ${recoveredMaxPayout}`);
              } else if (amount > recoveredMaxStake) {
                recoveryStatus = 'void';
                console.log(`🚫 RECOVERY AUTO-VOID (stake cap): ${betId} stake ${amount} ${coinType} > max ${recoveredMaxStake}`);
              } else if (odds > MAX_ODDS_CAP) {
                recoveryStatus = 'void';
                console.log(`🚫 RECOVERY AUTO-VOID (odds cap): ${betId} odds ${odds} > max ${MAX_ODDS_CAP}`);
              }
            }
            await db.insert(betsTable).values({
              userId: null,
              walletAddress: normalizedWallet,
              betAmount: amount,
              currency: coinType,
              odds,
              prediction: onChainPrediction || eventIdStr,
              potentialPayout: resolvedStatus === 'pending' ? resolvedPayout : resolvedPayout,
              status: recoveryStatus,
              betType: isParlay ? 'parlay' : 'single',
              cashOutAvailable: recoveryStatus === 'pending',
              wurlusBetId: betId,
              txHash: digest,
              platformFee: 0,
              networkFee: 0,
              feeCurrency: coinType,
              eventName,
              homeTeam,
              awayTeam,
              externalEventId: eventIdStr,
              betObjectId,
              createdAt: ts,
            }).returning();
            results.recovered++;
            console.log(`🔧 WALLET-RECOVERED: ${betId} for ${walletAddress.slice(0,12)}... (${amount} ${coinType}) - ${eventName} [status=${recoveryStatus}]`);
          } catch (insertErr: any) {
            if (insertErr.code !== '23505') {
              console.error(`Wallet recovery insert failed:`, insertErr.message);
              results.errors++;
            } else {
              results.alreadyExist++;
            }
          }
        } catch (txErr: any) {
          const txDigest = tx?.digest || 'unknown';
          console.warn(`Wallet sync tx error for ${txDigest.slice(0, 12)}: ${txErr.message}`);
          results.errors++;
        }
      }

      console.log(`🔍 Wallet sync complete: ${betTxCount} bet txs found, ${results.recovered} recovered, ${results.alreadyExist} already existed`);
    } catch (err: any) {
      console.error('Wallet recovery error:', err.message);
      results.errors++;
    }
    return results;
  }

  async function fixRecoveredBetStatuses() {
    try {
      const { bets: betsTable } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq, and, like, isNotNull, sql } = await import('drizzle-orm');

      const recoveredPending = await db.execute(sql`
        SELECT id, bet_object_id, event_name, bet_amount, currency 
        FROM bets 
        WHERE status = 'pending' 
          AND bet_object_id IS NOT NULL 
          AND bet_object_id != ''
          AND bet_object_id NOT LIKE 'auto-%'
        LIMIT 100
      `);

      if (!recoveredPending.rows?.length) {
        console.log('[FixRecovered] No recovered pending bets with betObjectId to check');
        return { fixed: 0, checked: 0 };
      }

      console.log(`[FixRecovered] Checking ${recoveredPending.rows.length} recovered pending bets against on-chain status...`);
      let fixed = 0;

      for (const row of recoveredPending.rows as any[]) {
        try {
          const onChainInfo = await blockchainBetService.getOnChainBetInfo(row.bet_object_id);
          if (onChainInfo && onChainInfo.settled) {
            await db.execute(sql`
              UPDATE bets 
              SET status = ${onChainInfo.status}, 
                  cash_out_available = false
              WHERE id = ${row.id} AND status = 'pending'
            `);
            fixed++;
            console.log(`[FixRecovered] ✅ Bet #${row.id} (${row.bet_object_id.slice(0, 12)}...): pending → ${onChainInfo.status}`);
          }
        } catch (err: any) {
          console.warn(`[FixRecovered] Error checking bet #${row.id}: ${err.message}`);
        }
      }

      console.log(`[FixRecovered] Fixed ${fixed}/${recoveredPending.rows.length} recovered bets`);
      return { fixed, checked: recoveredPending.rows.length };
    } catch (err: any) {
      console.error('[FixRecovered] Error:', err.message);
      return { fixed: 0, checked: 0 };
    }
  }

  setTimeout(() => fixRecoveredBetStatuses(), 30000);

  app.post("/api/bets/sync-wallet", async (req: Request, res: Response) => {
    try {
      const { wallet } = req.body;
      if (!wallet || !isValidSuiWallet(wallet)) {
        return res.status(400).json({ message: "Valid wallet address required" });
      }

      console.log(`🔄 User-triggered bet sync for ${wallet.slice(0, 12)}...`);
      const syncTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SYNC_TIMEOUT')), 25000)
      );
      const result = await Promise.race([recoverBetsForWallet(wallet), syncTimeout]).catch(err => {
        if (err.message === 'SYNC_TIMEOUT') {
          console.warn(`⏱️ Wallet sync timed out for ${wallet.slice(0, 12)}... returning partial results`);
          return { recovered: 0, alreadyExist: 0, errors: 0, timedOut: true };
        }
        throw err;
      });

      const userBets = await storage.getUserBets(wallet);

      const timedOut = (result as any).timedOut;
      res.json({
        success: true,
        recovered: result.recovered,
        alreadyExist: result.alreadyExist,
        errors: result.errors,
        totalBets: userBets.length,
        message: timedOut
          ? `Sync is still processing in the background. Found ${userBets.length} bet(s) so far.`
          : result.recovered > 0
            ? `Recovered ${result.recovered} missing bet(s) from the blockchain!`
            : `All ${userBets.length} on-chain bets are already synced.`,
        bets: userBets,
      });
    } catch (error: any) {
      console.error('Wallet bet sync error:', error);
      res.status(500).json({ message: "Failed to sync bets" });
    }
  });

  // Betting status endpoint - check if SUI betting is paused
  app.get("/api/betting-status", (req: Request, res: Response) => {
    res.json({
      suiBettingPaused: SUI_BETTING_PAUSED,
      sbetsBettingEnabled: true,
      pauseMessage: SUI_BETTING_PAUSED ? SUI_PAUSE_MESSAGE : null
    });
  });

  app.get("/api/config/public", (req: Request, res: Response) => {
    res.json({
      googleClientId: process.env.VITE_GOOGLE_CLIENT_ID || '',
    });
  });

  // Health check endpoint
  app.get("/api/health", async (req: Request, res: Response) => {
    const report = monitoringService.getHealthReport();
    const statusCode = report.status === 'HEALTHY' ? 200 : 503;
    res.status(statusCode).json(report);
  });

  app.get("/api/sports-status", async (req: Request, res: Response) => {
    const rateLimited = apiSportsService.isRateLimited();
    const minutesRemaining = apiSportsService.getRateLimitMinutesRemaining();
    const freeSportsCount = freeSportsService.getUpcomingEvents().length;
    res.json({
      rateLimited,
      minutesRemaining,
      freeSportsEventsCount: freeSportsCount,
      message: rateLimited
        ? `Sports data temporarily unavailable - API quota reached. Will auto-recover in ~${minutesRemaining} minutes.`
        : 'Sports data available'
    });
  });

  // System stats endpoint
  app.get("/api/admin/stats", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const stats = monitoringService.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.post("/api/admin/settle-bet", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { betId, outcome, reason } = req.body;
      
      if (!betId || !outcome) {
        return res.status(400).json({ message: "Missing required fields: betId, outcome" });
      }

      if (!['won', 'lost', 'void'].includes(outcome)) {
        return res.status(400).json({ message: "Invalid outcome - must be 'won', 'lost', or 'void'" });
      }

      // Update bet status directly and handle payouts - ONLY if status update succeeds (prevents double payout)
      const bet = await storage.getBetByStringId(betId);
      
      if (!bet) {
        console.log(`❌ Bet ${betId} not found`);
        return res.status(404).json({ message: "Bet not found" });
      }
      
      const statusUpdated = await storage.updateBetStatus(betId, outcome);
      
      if (statusUpdated) {
        // Map storage field names correctly: stake, potentialWin, currency
        const currency = (bet.currency === 'SBETS' || bet.feeCurrency === 'SBETS') ? 'SBETS' : 'SUI';
        const walletId = bet.walletAddress && isValidSuiWallet(bet.walletAddress) ? bet.walletAddress : null;
        const stake = bet.stake || bet.betAmount || 0;
        const potentialPayout = bet.potentialWin || bet.potentialPayout || 0;
        
        console.log(`🔧 ADMIN SETTLE: Processing bet ${betId} - stake: ${stake}, payout: ${potentialPayout}, currency: ${currency}`);
        
        // DEFENSE-IN-DEPTH: Payout cap at admin settlement
        const adminSettleMaxPayout = getMaxPayoutForCurrency(currency);
        if (outcome === 'won' && potentialPayout > adminSettleMaxPayout) {
          console.error(`🚨 ADMIN SETTLE PAYOUT CAP BREACH: Bet ${betId} payout=${potentialPayout} ${currency} > max ${adminSettleMaxPayout} — BLOCKING`);
          return res.status(400).json({ message: `Payout ${potentialPayout} ${currency} exceeds max payout cap of ${adminSettleMaxPayout}. Void this bet instead.` });
        }
        
        if (outcome === 'won') {
          // Calculate and record 1% platform fee on winnings (profit only)
          const profit = potentialPayout - stake;
          const platformFee = profit > 0 ? profit * 0.01 : 0;
          const netPayout = potentialPayout - platformFee;
          
          if (!walletId) {
            await storage.updateBetStatus(betId, 'pending');
            console.error(`❌ SETTLEMENT REVERTED: Bet ${betId} has no valid wallet - cannot credit winnings`);
            return res.status(400).json({ message: "Bet has no valid wallet address - cannot credit winnings" });
          }
          const winningsAdded = await balanceService.addWinnings(walletId, netPayout, currency);
          if (!winningsAdded) {
            await storage.updateBetStatus(betId, 'pending');
            console.error(`❌ SETTLEMENT REVERTED: Failed to credit winnings for bet ${betId}`);
            return res.status(500).json({ message: "Failed to credit winnings - settlement reverted" });
          }
          if (platformFee > 0) {
            await balanceService.addRevenue(platformFee, currency);
          }
          console.log(`💰 ADMIN SETTLE: ${walletId.slice(0,12)}... won ${netPayout} ${currency} (fee: ${platformFee} ${currency})`);
        } else if (outcome === 'lost') {
          // Add full stake to platform revenue
          await balanceService.addRevenue(stake, currency);
          console.log(`📊 ADMIN SETTLE: ${stake} ${currency} added to revenue from lost bet`);
        } else if (outcome === 'void') {
          // VOID: Return stake to treasury (SBETS already in treasury from on-chain transfer)
          // Do NOT refund to user - voided bets release funds back to treasury
          await balanceService.addRevenue(stake, currency);
          console.log(`🔄 ADMIN SETTLE (VOID): ${stake} ${currency} returned to treasury from voided bet ${betId} (wallet: ${walletId})`);
        }
      } else {
        console.log(`⚠️ Bet ${betId} already settled - no payout applied`);
        return res.status(400).json({ message: "Bet already settled" });
      }
      
      const action = {
        id: `admin-settle-${betId}-${Date.now()}`,
        betId,
        outcome,
        reason: reason || 'Admin force settle',
        timestamp: Date.now()
      };
      
      monitoringService.logSettlement({
        settlementId: action.id,
        betId,
        outcome,
        payout: bet?.potentialWin || bet?.potentialPayout || 0,
        timestamp: Date.now(),
        fees: 0
      });
      
      console.log(`✅ ADMIN: Settled bet ${betId} as ${outcome}`);
      res.json({ success: true, action });
    } catch (error: any) {
      console.error("Admin settle error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  const validateRecoveryOrAdmin = async (req: Request): Promise<boolean> => {
    return await validateAdminAuth(req);
  };

  app.post("/api/admin/find-bet", async (req: Request, res: Response) => {
    try {
      if (!(await validateRecoveryOrAdmin(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { txHashPrefix, walletAddress, limit: reqLimit } = req.body;
      const allBets = await storage.getAllBets();
      let filtered = allBets;
      if (txHashPrefix) {
        filtered = filtered.filter((b: any) => (b.txHash || '').startsWith(txHashPrefix));
      }
      if (walletAddress) {
        const w = walletAddress.toLowerCase();
        filtered = filtered.filter((b: any) => (b.walletAddress || '').toLowerCase() === w);
      }
      const results = filtered.slice(0, reqLimit || 10).map((b: any) => ({
        id: b.id, status: b.status, betType: b.betType, stake: b.stake || b.betAmount,
        currency: b.currency, potentialPayout: b.potentialWin || b.potentialPayout,
        txHash: b.txHash, prediction: (b.prediction || '').slice(0, 500),
        eventName: b.eventName, walletAddress: b.walletAddress,
        externalEventId: b.externalEventId, settledAt: b.settledAt, createdAt: b.createdAt
      }));
      res.json({ success: true, count: results.length, bets: results });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/admin/revert-bet", async (req: Request, res: Response) => {
    try {
      if (!(await validateRecoveryOrAdmin(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { betId, reason } = req.body;
      if (!betId) {
        return res.status(400).json({ message: "Missing required field: betId" });
      }

      const bet = await storage.getBetByStringId(betId);
      if (!bet) {
        return res.status(404).json({ message: "Bet not found" });
      }

      const currentStatus = bet.status;
      if (currentStatus !== 'lost' && currentStatus !== 'won') {
        return res.status(400).json({ message: `Bet status is '${currentStatus}' — can only revert 'lost' or 'won' bets` });
      }

      const currency = (bet.currency === 'SBETS' || bet.feeCurrency === 'SBETS') ? 'SBETS' : 'SUI';
      const stake = bet.stake || bet.betAmount || 0;
      const walletId = bet.walletAddress && isValidSuiWallet(bet.walletAddress) ? bet.walletAddress : null;

      await storage.updateBetStatus(betId, 'pending');

      if (currentStatus === 'lost' && walletId && stake > 0) {
        try {
          if (currency === 'SBETS') {
            const result = await blockchainBetService.sendSbetsFromRevenueWallet(walletId, stake);
            console.log(`💸 REVERT REFUND: ${stake} SBETS → ${walletId.slice(0,12)}... | TX: ${result.txHash || 'N/A'}`);
          } else {
            const result = await blockchainBetService.sendSuiFromRevenueWallet(walletId, stake);
            console.log(`💸 REVERT REFUND: ${stake} SUI → ${walletId.slice(0,12)}... | TX: ${result.txHash || 'N/A'}`);
          }
        } catch (refundErr: any) {
          console.error(`⚠️ REVERT: Status reverted to pending but refund failed: ${refundErr.message}`);
          return res.json({
            success: true,
            warning: 'Bet reverted to pending but on-chain refund failed — manual refund needed',
            betId,
            previousStatus: currentStatus,
            newStatus: 'pending',
            refundError: refundErr.message
          });
        }
      }

      console.log(`🔄 ADMIN REVERT: Bet ${betId} reverted from '${currentStatus}' to 'pending' | Reason: ${reason || 'Settlement bug'}`);
      
      res.json({
        success: true,
        betId,
        previousStatus: currentStatus,
        newStatus: 'pending',
        refunded: currentStatus === 'lost' ? `${stake} ${currency}` : 'N/A (was won)',
        reason: reason || 'Settlement bug'
      });
    } catch (error: any) {
      console.error("Admin revert error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/admin/force-onchain-settlement", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { betId, outcome } = req.body;
      
      if (!betId || !outcome) {
        return res.status(400).json({ message: "Missing required fields: betId, outcome" });
      }

      if (!['won', 'lost', 'void'].includes(outcome)) {
        return res.status(400).json({ message: "Invalid outcome - must be 'won', 'lost', or 'void'" });
      }

      console.log(`🔧 ADMIN: Force on-chain settlement for bet ${betId} as ${outcome}`);
      
      const result = await settlementWorker.forceOnChainSettlement(betId, outcome);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `On-chain settlement executed successfully`,
          txHash: result.txHash,
          betId,
          outcome
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: result.error || 'On-chain settlement failed',
          betId,
          outcome
        });
      }
    } catch (error: any) {
      console.error("Admin force on-chain settlement error:", error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Admin get bets needing on-chain settlement
  app.get("/api/admin/bets-needing-settlement", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const bets = await settlementWorker.getBetsNeedingOnChainSettlement();
      res.json({ 
        success: true, 
        count: bets.length,
        bets: bets.map(b => ({
          id: b.id,
          betObjectId: b.betObjectId,
          status: b.status,
          walletAddress: b.walletAddress,
          betAmount: b.betAmount,
          potentialPayout: b.potentialPayout,
          currency: b.feeCurrency || 'SUI'
        }))
      });
    } catch (error: any) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get("/api/admin/bet-diagnostics", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const allBets = await storage.getAllBets();
      const statusCounts: Record<string, number> = {};
      const pendingBets: any[] = [];
      const ghostBets: any[] = [];
      for (const bet of allBets) {
        const s = bet.status || 'unknown';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
        if (s === 'pending') {
          const isGhost = !bet.externalEventId && (!bet.homeTeam || bet.homeTeam.trim() === '');
          const entry = {
            id: bet.id,
            extId: bet.externalEventId,
            event: `${bet.homeTeam || ''} vs ${bet.awayTeam || ''}`,
            placed: bet.placedAt,
            currency: bet.currency,
            betObjectId: bet.betObjectId || null,
            prediction: bet.prediction || bet.selection,
          };
          if (isGhost) ghostBets.push(entry);
          else pendingBets.push(entry);
        }
      }
      res.json({
        totalBets: allBets.length,
        statusCounts,
        realPending: { count: pendingBets.length, bets: pendingBets },
        ghostPending: { count: ghostBets.length, bets: ghostBets.slice(0, 10) },
        settledEventsCount: settlementWorker.getSettledEventsCount(),
        settledBetsCount: settlementWorker.getSettledBetsCount(),
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/recover-ghost-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const allBets = await storage.getAllBets('pending');
      const ghostBets = allBets.filter(b => !b.externalEventId && (!b.homeTeam || b.homeTeam.trim() === '' || b.homeTeam === 'Unknown'));

      if (ghostBets.length === 0) {
        return res.json({ success: true, message: 'No ghost bets found', recovered: 0 });
      }

      let recovered = 0;
      let failed = 0;
      const results: any[] = [];

      for (const bet of ghostBets) {
        const betObjId = bet.betObjectId;
        if (!betObjId) {
          results.push({ id: bet.id, status: 'skipped', reason: 'no betObjectId' });
          failed++;
          continue;
        }

        try {
          const onChainInfo = await blockchainBetService.getOnChainBetInfo(betObjId);
          if (!onChainInfo || !onChainInfo.eventId) {
            results.push({ id: bet.id, betObjId: betObjId.slice(0, 12), status: 'skipped', reason: 'no event_id on chain' });
            failed++;
            continue;
          }

          const eventId = onChainInfo.eventId;
          let homeTeam = '';
          let awayTeam = '';
          let eventName = '';

          const isNumericId = /^\d+$/.test(eventId);
          if (isNumericId) {
            try {
              const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
              if (apiKey) {
                const axios = (await import('axios')).default;
                const resp = await axios.get('https://v3.football.api-sports.io/fixtures', {
                  params: { id: eventId },
                  headers: { 'x-apisports-key': apiKey },
                  timeout: 10000
                });
                const fixture = resp.data?.response?.[0];
                if (fixture) {
                  homeTeam = fixture.teams?.home?.name || '';
                  awayTeam = fixture.teams?.away?.name || '';
                  eventName = `${homeTeam} vs ${awayTeam}`;
                }
              }
            } catch (apiErr) {}
          }

          if (!homeTeam) {
            try {
              const apiSvc = (await import('./services/apiSportsService')).default;
              const lookup = apiSvc.lookupEventSync(eventId);
              if (lookup.found && lookup.homeTeam) {
                homeTeam = lookup.homeTeam;
                awayTeam = lookup.awayTeam || '';
                eventName = `${homeTeam} vs ${awayTeam}`;
              }
            } catch (e) {}
          }

          if (!homeTeam) {
            try {
              const { freeSportsService } = await import('./services/freeSportsService');
              const fsLookup = freeSportsService.lookupEvent(eventId);
              if (fsLookup.found && fsLookup.event?.homeTeam) {
                homeTeam = fsLookup.event.homeTeam;
                awayTeam = fsLookup.event.awayTeam || '';
                eventName = `${homeTeam} vs ${awayTeam}`;
              }
            } catch (e) {}
          }

          const prediction = onChainInfo.prediction || bet.prediction || '';

          const updateData: any = {
            externalEventId: eventId,
            prediction: prediction,
          };
          if (homeTeam) {
            updateData.homeTeam = homeTeam;
            updateData.awayTeam = awayTeam;
            updateData.eventName = eventName;
          }

          await db.update(betsGlobal)
            .set(updateData)
            .where(drizzleEq(betsGlobal.betObjectId, betObjId));

          recovered++;
          results.push({ 
            id: bet.id, betObjId: betObjId.slice(0, 12), 
            status: 'recovered', eventId, eventName: eventName || 'lookup pending',
            prediction, onChainStatus: onChainInfo.status
          });
        } catch (err: any) {
          failed++;
          results.push({ id: bet.id, status: 'error', error: err.message });
        }
      }

      res.json({ 
        success: true, 
        totalGhosts: ghostBets.length, 
        recovered, failed,
        results 
      });
    } catch (error: any) {
      console.error('Ghost bet recovery error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/force-settle-now", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      console.log('🔄 Force settlement triggered via API...');
      await settlementWorker.checkAndSettleBets(true);
      
      const allBets = await storage.getAllBets();
      const counts: Record<string, number> = {};
      for (const b of allBets) {
        counts[b.status] = (counts[b.status] || 0) + 1;
      }
      
      res.json({ 
        success: true, 
        message: 'Settlement cycle completed',
        statusCounts: counts,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Force settlement error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/check-fixture/:id", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const fixtureId = req.params.id;
      const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
      
      if (!apiKey) {
        return res.json({ error: 'No API key configured', keys: { API_SPORTS_KEY: !!process.env.API_SPORTS_KEY, SPORTSDATA_API_KEY: !!process.env.SPORTSDATA_API_KEY, APISPORTS_KEY: !!process.env.APISPORTS_KEY } });
      }
      
      const axios = await import('axios');
      const response = await axios.default.get('https://v3.football.api-sports.io/fixtures', {
        params: { id: fixtureId },
        headers: { 'x-apisports-key': apiKey, 'Accept': 'application/json' },
        timeout: 10000
      });
      
      const fixtures = response.data?.response;
      if (!Array.isArray(fixtures) || fixtures.length === 0) {
        return res.json({ fixtureId, found: false, rawResponse: response.data });
      }
      
      const match = fixtures[0];
      res.json({
        fixtureId,
        found: true,
        status: match.fixture?.status,
        teams: { home: match.teams?.home?.name, away: match.teams?.away?.name },
        goals: match.goals,
        date: match.fixture?.date,
        league: match.league?.name,
        remaining: response.headers?.['x-ratelimit-remaining']
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/cancel-bet", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { betId, reason } = req.body;
      
      if (!betId) {
        return res.status(400).json({ message: "Missing required field: betId" });
      }

      const action = await adminService.cancelBet(betId, reason || 'Admin cancelled');
      monitoringService.logCancelledBet(betId, reason || 'Admin cancelled');
      res.json({ success: true, action });
    } catch (error: any) {
      console.error("Admin cancel error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/admin/refund-bet", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { betId, amount, reason } = req.body;
      
      if (!betId || amount === undefined) {
        return res.status(400).json({ message: "Missing required fields: betId, amount" });
      }

      const action = await adminService.refundBet(betId, amount, reason || 'Admin refund');
      res.json({ success: true, action });
    } catch (error: any) {
      console.error("Admin refund error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Admin logs endpoint
  app.get("/api/admin/logs", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const logs = monitoringService.getRecentLogs(50);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  // Admin login endpoint — with brute-force lockout
  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const { allowed, retryAfterMs } = checkLoginAllowed(ip);
      if (!allowed) {
        const seconds = Math.ceil(retryAfterMs / 1000);
        console.warn(`🔒 ADMIN: Blocked login attempt from ${ip} — still locked out (${seconds}s remaining)`);
        return res.status(429).json({ success: false, message: `Too many failed attempts. Try again in ${seconds} seconds.` });
      }

      const { password } = req.body;
      const adminPassword = getAdminPassword();

      if (password === adminPassword) {
        recordLoginSuccess(ip);
        const sessionToken = await createAdminSession(ip);
        console.log('✅ ADMIN: Login successful');
        res.json({ success: true, token: sessionToken });
      } else {
        recordLoginFailure(ip);
        const remaining = MAX_LOGIN_ATTEMPTS - (loginFailures.get(ip)?.count || 0);
        console.warn(`❌ ADMIN: Login failed from ${ip}`);
        res.status(401).json({ success: false, message: remaining > 0 ? `Invalid password. ${remaining} attempt(s) remaining.` : 'Account locked. Try again later.' });
      }
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Admin: update backend stake limits at runtime (no restart required)
  app.post("/api/admin/update-stake-limits", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { maxStakeSbets } = req.body;
      if (!maxStakeSbets || isNaN(Number(maxStakeSbets)) || Number(maxStakeSbets) <= 0) {
        return res.status(400).json({ message: "Invalid maxStakeSbets value" });
      }
      RUNTIME_MAX_STAKE_SBETS = Number(maxStakeSbets);
      console.log(`[Admin] SBETS max stake updated to ${RUNTIME_MAX_STAKE_SBETS}`);
      return res.json({ success: true, maxStakeSbets: RUNTIME_MAX_STAKE_SBETS });
    } catch (err: any) {
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Admin: get current stake limits
  app.get("/api/admin/stake-limits", async (req: Request, res: Response) => {
    if (!(await validateAdminAuth(req))) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    return res.json({ 
      maxStakeSbets: RUNTIME_MAX_STAKE_SBETS, 
      maxStakeSui: RUNTIME_MAX_STAKE_SUI,
      futures: {
        maxStakeSbets: FUTURES_MAX_STAKE_SBETS,
        maxStakeSui: FUTURES_MAX_STAKE_SUI,
        maxPayoutSbets: FUTURES_MAX_PAYOUT_SBETS,
        maxPayoutSui: FUTURES_MAX_PAYOUT_SUI,
      }
    });
  });

  app.get("/api/futures/stake-limits", async (_req: Request, res: Response) => {
    return res.json({
      maxStakeSbets: FUTURES_MAX_STAKE_SBETS,
      maxStakeSui: FUTURES_MAX_STAKE_SUI,
      maxPayoutSbets: FUTURES_MAX_PAYOUT_SBETS,
      maxPayoutSui: FUTURES_MAX_PAYOUT_SUI,
    });
  });

  // Admin get all bets endpoint
  app.get("/api/admin/all-bets", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { status } = req.query;
      const allBets = await storage.getAllBets(status as string);
      const stats = {
        total: allBets.length,
        pending: allBets.filter(b => b.status === 'pending').length,
        won: allBets.filter(b => b.status === 'won').length,
        lost: allBets.filter(b => b.status === 'lost').length,
        void: allBets.filter(b => b.status === 'void' || b.status === 'cancelled').length,
        totalStake: allBets.reduce((sum, b) => sum + (b.stake || 0), 0),
        totalPotentialWin: allBets.reduce((sum, b) => sum + (b.potentialWin || 0), 0)
      };
      
      res.json({ bets: allBets, stats });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bets" });
    }
  });

  // Admin get legacy bets (without betObjectId - stuck liability)
  app.get("/api/admin/legacy-bets", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Get all bets and filter for those without betObjectId (legacy bets causing stuck liability)
      const allBets = await storage.getAllBets();
      const legacyBets = allBets.filter(b => !b.betObjectId && b.status !== 'pending');
      
      // Calculate stuck liability based on potential payouts
      const stuckLiabilitySui = legacyBets
        .filter(b => b.currency === 'SUI')
        .reduce((sum, b) => sum + (b.potentialWin || 0), 0);
      const stuckLiabilitySbets = legacyBets
        .filter(b => b.currency === 'SBETS')
        .reduce((sum, b) => sum + (b.potentialWin || 0), 0);
      
      res.json({ 
        legacyBets,
        stuckLiabilitySui,
        stuckLiabilitySbets,
        count: legacyBets.length
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch legacy bets" });
    }
  });

  // Admin settle all pending bets endpoint
  app.post("/api/admin/settle-all", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { outcome } = req.body;
      
      if (!['won', 'lost', 'void'].includes(outcome)) {
        return res.status(400).json({ message: "Invalid outcome - must be 'won', 'lost', or 'void'" });
      }
      
      const pendingBets = await storage.getAllBets('pending');
      const results = [];
      
      for (const bet of pendingBets) {
        try {
          const statusUpdated = await storage.updateBetStatus(bet.id, outcome);
          if (statusUpdated) {
            if (outcome === 'won') {
              const bWallet = bet.walletAddress && isValidSuiWallet(bet.walletAddress) ? bet.walletAddress : null;
              if (!bWallet) {
                results.push({ betId: bet.id, status: 'error', outcome, reason: 'No valid wallet address' });
                continue;
              }
              await balanceService.addWinnings(bWallet, bet.potentialWin || 0, bet.currency || 'SUI');
            } else if (outcome === 'lost' || outcome === 'void') {
              await balanceService.addRevenue(bet.stake || 0, bet.currency || 'SUI');
            }
            results.push({ betId: bet.id, status: 'settled', outcome });
          } else {
            results.push({ betId: bet.id, status: 'skipped', outcome, reason: 'Already settled' });
          }
        } catch (err) {
          results.push({ betId: bet.id, status: 'error', error: String(err) });
        }
      }
      
      console.log(`✅ ADMIN: Settled ${results.filter(r => r.status === 'settled').length} bets as ${outcome}`);
      res.json({ success: true, settled: results.length, results });
    } catch (error: any) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/settle-event", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { eventId, winnerId, winnerName } = req.body;
      
      if (!eventId) {
        return res.status(400).json({ message: "Missing required field: eventId" });
      }
      if (!winnerId && !winnerName) {
        return res.status(400).json({ message: "Must provide winnerId or winnerName" });
      }
      
      const allBets = await storage.getAllBets('pending');
      const eventBets = allBets.filter(b => 
        b.eventId === eventId || 
        b.externalEventId === eventId ||
        String(b.eventId) === String(eventId)
      );
      
      if (eventBets.length === 0) {
        return res.json({ success: true, message: "No pending bets found for this event", settled: 0 });
      }
      
      const results = [];
      for (const bet of eventBets) {
        try {
          const selectedOutcome = (bet.prediction || bet.selectedOutcome || bet.selection || '').trim().toLowerCase();
          const winnerNorm = (winnerName || '').trim().toLowerCase();
          const homeNorm = (bet.homeTeam || '').trim().toLowerCase();
          const awayNorm = (bet.awayTeam || '').trim().toLowerCase();
          
          if (!selectedOutcome) {
            results.push({ betId: bet.id, status: 'skipped', reason: 'empty selection' });
            continue;
          }
          
          const isWinner = winnerId 
            ? (selectedOutcome === winnerId || bet.selectedOutcomeId === winnerId || selectedOutcome === winnerId.toLowerCase())
            : (selectedOutcome === winnerNorm ||
               (homeNorm && homeNorm === winnerNorm && (selectedOutcome.includes('home') || selectedOutcome === homeNorm)) ||
               (awayNorm && awayNorm === winnerNorm && (selectedOutcome.includes('away') || selectedOutcome === awayNorm)) ||
               (homeNorm && selectedOutcome === homeNorm && homeNorm === winnerNorm) ||
               (awayNorm && selectedOutcome === awayNorm && awayNorm === winnerNorm));
          
          const outcome = isWinner ? 'won' : 'lost';
          const statusUpdated = await storage.updateBetStatus(bet.id, outcome);
          
          if (statusUpdated) {
            const currency = (bet.currency === 'SBETS' || bet.feeCurrency === 'SBETS') ? 'SBETS' : 'SUI';
            const walletId = bet.walletAddress && isValidSuiWallet(bet.walletAddress) ? bet.walletAddress : null;
            const stake = bet.stake || bet.betAmount || 0;
            const potentialPayout = bet.potentialWin || bet.potentialPayout || 0;
            
            try {
              // DEFENSE-IN-DEPTH: Payout cap at batch settlement
              const batchSettleMaxPayout = getMaxPayoutForCurrency(currency);
              if (outcome === 'won' && potentialPayout > batchSettleMaxPayout) {
                console.error(`🚨 BATCH SETTLE CAP BREACH: Bet ${bet.id} payout=${potentialPayout} ${currency} > max ${batchSettleMaxPayout} — skipping`);
                await storage.updateBetStatus(bet.id, 'void', 0);
                results.push({ betId: bet.id, status: 'voided', reason: 'Payout exceeds cap' });
                continue;
              }
              if (outcome === 'won') {
                if (!walletId) {
                  settleResults.push({ betId: bet.id, status: 'error', reason: 'No valid wallet address' });
                  continue;
                }
                const profit = potentialPayout - stake;
                const platformFee = profit > 0 ? profit * 0.01 : 0;
                const netPayout = potentialPayout - platformFee;
                await balanceService.addWinnings(walletId, netPayout, currency);
                if (platformFee > 0) await balanceService.addRevenue(platformFee, currency);
              } else {
                await balanceService.addRevenue(stake, currency);
              }
            } catch (balanceErr) {
              await storage.updateBetStatus(bet.id, 'pending');
              results.push({ betId: bet.id, status: 'error', error: `Balance update failed, reverted to pending: ${balanceErr}` });
              continue;
            }
            results.push({ betId: bet.id, outcome, selection: selectedOutcome });
          }
        } catch (err) {
          results.push({ betId: bet.id, status: 'error', error: String(err) });
        }
      }
      
      const won = results.filter(r => r.outcome === 'won').length;
      const lost = results.filter(r => r.outcome === 'lost').length;
      console.log(`✅ ADMIN EVENT SETTLE: ${eventId} - ${won} won, ${lost} lost (winner: ${winnerName || winnerId})`);
      res.json({ success: true, eventId, winner: winnerName || winnerId, settled: results.length, won, lost, results });
    } catch (error: any) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // API error statistics
  app.get("/api/admin/error-stats", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const stats = errorHandlingService.getErrorStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch error stats" });
    }
  });

  // Platform revenue endpoint - shows split breakdown
  app.get("/api/admin/revenue", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const totalRevenue = await balanceService.getPlatformRevenue();
      const holdersRevenue = await storage.getRevenueForHolders();
      const treasuryBuffer = await storage.getTreasuryBuffer();
      const platformProfit = await storage.getPlatformProfit();
      const contractInfo = await blockchainBetService.getPlatformInfo();
      
      res.json({
        // Total accumulated revenue (legacy tracking)
        totalRevenue: {
          sui: totalRevenue.suiBalance,
          sbets: totalRevenue.sbetsBalance
        },
        // Revenue split breakdown (30/40/30)
        revenueSplit: {
          holders: {
            sui: holdersRevenue.suiRevenue,
            sbets: holdersRevenue.sbetsRevenue,
            percentage: 30
          },
          treasuryBuffer: {
            sui: treasuryBuffer.suiBalance,
            sbets: treasuryBuffer.sbetsBalance,
            percentage: 40
          },
          platformProfit: {
            sui: platformProfit.suiBalance,
            sbets: platformProfit.sbetsBalance,
            percentage: 30
          }
        },
        onChainContract: contractInfo || {
          treasuryBalance: 0,
          totalBets: 0,
          totalVolume: 0,
          accruedFees: 0
        },
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error fetching revenue:', error);
      res.status(500).json({ message: "Failed to fetch revenue" });
    }
  });
  
  app.get("/api/admin/revenue-controller", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { revenueTrackerService } = await import('./services/revenueTrackerService');
      const view = await revenueTrackerService.getControllerView();
      res.json({ success: true, ...view });
    } catch (error: any) {
      console.error('Error fetching revenue controller:', error);
      res.status(500).json({ message: "Failed to fetch revenue controller" });
    }
  });

  app.get("/api/admin/buyback-stats", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { buybackService } = await import('./services/buybackService');
      res.json(buybackService.getStats());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch buyback stats" });
    }
  });

  app.post("/api/admin/buyback-trigger", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { buybackService } = await import('./services/buybackService');
      const result = await buybackService.triggerManualBuyback();
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to trigger buyback" });
    }
  });

  app.post("/api/admin/buyback-test", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const amount = Number(req.body?.amount) || 0.05;
      const { buybackService } = await import('./services/buybackService');
      const result = await buybackService.testSwap(amount);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to test buyback", error: error.message });
    }
  });

  app.post("/api/admin/buyback-seed-from-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const count = Math.min(Number(req.body?.count) || 5, 50);
      const { db } = await import('./db');
      const { bets } = await import('@shared/schema');
      const { desc, inArray } = await import('drizzle-orm');

      const recentBets = await db.select().from(bets)
        .where(inArray(bets.status, ['lost', 'paid_out', 'won']))
        .orderBy(desc(bets.id))
        .limit(count);

      if (!recentBets.length) {
        return res.json({ success: false, message: 'No settled bets found' });
      }

      const { buybackService } = await import('./services/buybackService');
      let totalSeeded = { sui: 0, sbets: 0 };
      const details: any[] = [];

      for (const bet of recentBets) {
        const currency = (bet.currency || 'SUI').toUpperCase() as 'SUI' | 'SBETS';
        const stakeAmount = Number(bet.betAmount) || 0;
        let revenueAmount = 0;

        if (bet.status === 'lost') {
          revenueAmount = stakeAmount;
        } else if (bet.status === 'paid_out' || bet.status === 'won') {
          const platformFee = stakeAmount * 0.05;
          revenueAmount = platformFee;
        }

        if (revenueAmount > 0) {
          const buybackAmount = buybackService.addRevenueToBuyback(revenueAmount, currency);
          if (currency === 'SUI') totalSeeded.sui += buybackAmount;
          else totalSeeded.sbets += buybackAmount;
          details.push({
            betId: bet.id,
            status: bet.status,
            stake: stakeAmount,
            currency,
            revenueAmount: revenueAmount.toFixed(4),
            buybackSeeded: buybackAmount.toFixed(4),
          });
        }
      }

      console.log(`[Admin] Buyback seeded from ${details.length} bets: ${totalSeeded.sui.toFixed(4)} SUI + ${totalSeeded.sbets.toFixed(2)} SBETS`);
      res.json({
        success: true,
        betsProcessed: details.length,
        totalSeeded,
        pool: buybackService.getStats(),
        details,
      });
    } catch (error: any) {
      console.error('[Admin] Buyback seed error:', error);
      res.status(500).json({ message: 'Failed to seed buyback', error: error.message });
    }
  });

  app.get("/api/buyback/stats", async (_req: Request, res: Response) => {
    try {
      const { buybackService } = await import('./services/buybackService');
      const stats = buybackService.getStats();
      res.json({
        totalSbetsBurned: stats.totalSbetsBurned,
        totalBuybackSui: stats.totalBuybackSui,
        totalSwaps: stats.totalSwaps,
        totalBurns: stats.totalBurns,
        lastSwapTime: stats.lastSwapTime,
        config: {
          percentage: stats.config.percentage,
          intervalMinutes: stats.config.intervalMinutes,
        },
        recentHistory: stats.history.slice(-10).map(h => ({
          timestamp: h.timestamp,
          suiSpent: h.suiSpent,
          sbetsBurned: h.sbetsBurned,
          type: h.type,
          txHash: h.burnTxHash,
        })),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch buyback stats" });
    }
  });

  app.post("/api/admin/withdraw-profit", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { amount, currency } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount required" });
      }
      
      const tokenCurrency = currency === 'SBETS' ? 'SBETS' : 'SUI';
      const profit = await storage.getPlatformProfit();
      const available = tokenCurrency === 'SBETS' ? profit.sbetsBalance : profit.suiBalance;
      
      if (amount > available) {
        return res.status(400).json({ 
          message: `Insufficient ${tokenCurrency} profit. Available: ${available.toFixed(4)} ${tokenCurrency}` 
        });
      }
      
      // Deduct from profit account
      const profitWallet = 'platform_profit';
      const suiDelta = tokenCurrency === 'SUI' ? -amount : 0;
      const sbetsDelta = tokenCurrency === 'SBETS' ? -amount : 0;
      await storage.updateUserBalance(profitWallet, suiDelta, sbetsDelta);
      
      // Execute on-chain transfer to admin wallet if configured
      const adminWallet = process.env.ADMIN_WALLET_ADDRESS || '';
      let txHash = `profit-withdraw-${Date.now()}`;
      
      if (blockchainBetService.isAdminKeyConfigured()) {
        try {
          const payoutResult = tokenCurrency === 'SBETS' 
            ? await blockchainBetService.executePayoutSbetsOnChain(adminWallet, amount)
            : await blockchainBetService.executePayoutOnChain(adminWallet, amount);
          if (payoutResult.success && payoutResult.txHash) {
            txHash = payoutResult.txHash;
          }
        } catch (payoutError) {
          console.warn('On-chain payout failed, profit deducted from DB only:', payoutError);
        }
      }
      
      console.log(`[Admin] Platform profit withdrawn: ${amount} ${tokenCurrency} | TX: ${txHash}`);
      res.json({ success: true, amount, currency: tokenCurrency, txHash });
    } catch (error) {
      console.error('Error withdrawing profit:', error);
      res.status(500).json({ message: "Failed to withdraw profit" });
    }
  });

  // Withdraw fees from contract (admin only)
  app.post("/api/admin/withdraw-fees", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { amount } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount required" });
      }
      
      if (!blockchainBetService.isAdminKeyConfigured()) {
        return res.status(400).json({ success: false, error: "ADMIN_PRIVATE_KEY not configured on server" });
      }

      if (process.env.MULTISIG_GUARD_ID) {
        return res.status(403).json({ success: false, error: "Direct withdrawals locked. Use multisig propose → approve → execute flow via /api/admin/multisig/* endpoints." });
      }
      
      console.log(`[Admin] Executing SUI withdrawal: ${amount} SUI`);
      const result = await blockchainBetService.withdrawFeesOnChain(amount);
      if (result.success) {
        res.json({ success: true, txHash: result.txHash, amount });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error(`[Admin] SUI withdrawal error:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/withdraw-fees-sbets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { amount } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount required" });
      }
      
      if (!blockchainBetService.isAdminKeyConfigured()) {
        return res.status(400).json({ success: false, error: "ADMIN_PRIVATE_KEY not configured on server" });
      }

      if (process.env.MULTISIG_GUARD_ID) {
        return res.status(403).json({ success: false, error: "Direct withdrawals locked. Use multisig propose → approve → execute flow via /api/admin/multisig/* endpoints." });
      }
      
      console.log(`[Admin] Executing SBETS withdrawal: ${amount} SBETS`);
      const result = await blockchainBetService.withdrawFeesSbetsOnChain(amount);
      if (result.success) {
          res.json({ success: true, txHash: result.txHash, amount });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error(`[Admin] SBETS withdrawal error:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get("/api/admin/treasury-status", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const stats = await treasuryAutoWithdrawService.getTreasuryStats();
      
      res.json({
        success: true,
        autoWithdrawService: { enabled: false, status: 'disabled — claim-only model active' },
        treasury: stats,
        health: { overall: 'ok', alerts: ['Auto-withdraw disabled. Users claim manually.'], timestamp: Date.now() },
      });
    } catch (error: any) {
      console.error(`[Admin] Treasury status error:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/sync-onchain-liability", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const allBets = await storage.getAllBets();
      const activeBets = allBets.filter((b: any) => 
        b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_play' || b.status === 'open'
      );
      const realLiabilitySui = activeBets
        .filter((b: any) => b.currency === 'SUI')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
      const realLiabilitySbets = activeBets
        .filter((b: any) => b.currency === 'SBETS')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);

      const platformInfo = await blockchainBetService.getPlatformInfo();
      const onChainLiabilitySbets = platformInfo?.totalLiabilitySbets || 0;
      const onChainLiabilitySui = platformInfo?.totalLiabilitySui || 0;

      console.log(`[Admin] Liability sync: On-chain SBETS=${onChainLiabilitySbets}, DB SBETS=${realLiabilitySbets}`);
      console.log(`[Admin] Liability sync: On-chain SUI=${onChainLiabilitySui}, DB SUI=${realLiabilitySui}`);

      const results: any = { sbets: null, sui: null };

      if (Math.abs(onChainLiabilitySbets - realLiabilitySbets) > 100) {
        console.log(`[Admin] Resetting SBETS liability from ${onChainLiabilitySbets} to ${realLiabilitySbets}`);
        results.sbets = await blockchainBetService.resetOnChainLiability('SBETS', realLiabilitySbets);
      } else {
        results.sbets = { success: true, message: 'Already in sync' };
      }

      if (Math.abs(onChainLiabilitySui - realLiabilitySui) > 0.01) {
        console.log(`[Admin] Resetting SUI liability from ${onChainLiabilitySui} to ${realLiabilitySui}`);
        results.sui = await blockchainBetService.resetOnChainLiability('SUI', realLiabilitySui);
      } else {
        results.sui = { success: true, message: 'Already in sync' };
      }

      res.json({
        success: true,
        before: { onChainSbets: onChainLiabilitySbets, onChainSui: onChainLiabilitySui },
        after: { dbSbets: realLiabilitySbets, dbSui: realLiabilitySui },
        results
      });
    } catch (error: any) {
      console.error(`[Admin] Liability sync error:`, error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/treasury-withdraw-now", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      console.log('[Admin] Manual treasury withdraw triggered');
      const result = await treasuryAutoWithdrawService.triggerManual();
      
      res.json({
        success: true,
        suiWithdrawn: result.suiWithdrawn,
        sbetsWithdrawn: result.sbetsWithdrawn,
        suiTxHash: result.suiTxHash,
        sbetsTxHash: result.sbetsTxHash,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error(`[Admin] Manual treasury withdraw error:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get("/api/admin/revenue-distribution", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const holders = await storage.getRevenueForHolders();
      const treasury = await storage.getTreasuryBuffer();
      const profit = await storage.getPlatformProfit();
      const distributed = await storage.getDistributedRevenue();

      res.json({
        success: true,
        split: {
          holdersPool: { sui: holders.suiRevenue, sbets: holders.sbetsRevenue, label: '30% for SBETS holder claims' },
          treasuryBuffer: { sui: treasury.suiBalance, sbets: treasury.sbetsBalance, label: '40% stays on-chain in treasury' },
          platformProfit: { sui: profit.suiBalance, sbets: profit.sbetsBalance, label: '30% admin profit' },
        },
        distributed: { sui: distributed.suiDistributed, sbets: distributed.sbetsDistributed, label: 'Already withdrawn from treasury to admin' },
        pending: {
          sui: (holders.suiRevenue + profit.suiBalance) - distributed.suiDistributed,
          sbets: (holders.sbetsRevenue + profit.sbetsBalance) - distributed.sbetsDistributed,
          label: 'Awaiting withdrawal from treasury',
        },
        serviceStatus: revenueDistributionService.getStatus(),
      });
    } catch (error: any) {
      console.error('[Admin] Revenue distribution status error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/revenue-distribute-now", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      console.log('[Admin] Manual revenue distribution triggered');
      const result = await revenueDistributionService.triggerManual();

      res.json({
        success: true,
        suiWithdrawn: result.suiWithdrawn,
        sbetsWithdrawn: result.sbetsWithdrawn,
        suiTxHash: result.suiTxHash,
        sbetsTxHash: result.sbetsTxHash,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error('[Admin] Manual revenue distribution error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/withdraw-treasury-sbets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const { amount, recipientAddress } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "Amount required" });
      }

      if (process.env.MULTISIG_GUARD_ID) {
        return res.status(403).json({ success: false, error: "Direct withdrawals locked. Use multisig propose → approve → execute flow via /api/admin/multisig/* endpoints." });
      }

      console.log(`[Admin] Treasury SBETS withdrawal: ${amount} SBETS`);
      
      const withdrawResult = await blockchainBetService.withdrawTreasurySbetsOnChain(amount);
      if (!withdrawResult.success) {
        return res.status(500).json({ success: false, message: `Treasury withdraw failed: ${withdrawResult.error}` });
      }

      let sendResult = null;
      if (recipientAddress) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        sendResult = await blockchainBetService.sendSbetsToUser(recipientAddress, amount);
        console.log(`[Admin] Send ${amount} SBETS to ${recipientAddress}: ${sendResult.success ? sendResult.txHash : sendResult.error}`);
      }

      res.json({
        success: true,
        withdrawTxHash: withdrawResult.txHash,
        sendTxHash: sendResult?.txHash,
        sendSuccess: sendResult?.success,
        sendError: sendResult?.error,
        amount,
        recipientAddress,
      });
    } catch (error: any) {
      console.error(`[Admin] Treasury SBETS withdraw error:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get("/api/admin/treasury-guard", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { treasuryGuard } = await import('./services/treasuryGuardService');
      res.json({ success: true, ...treasuryGuard.getStatus() });
    } catch (error: any) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/treasury-guard/freeze", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { reason } = req.body;
      const { treasuryGuard } = await import('./services/treasuryGuardService');
      treasuryGuard.freeze(reason || 'Manual admin freeze');
      res.json({ success: true, frozen: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/treasury-guard/unfreeze", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { treasuryGuard } = await import('./services/treasuryGuardService');
      const result = treasuryGuard.unfreeze();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post("/api/admin/multisig/create-guard", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { signers, threshold } = req.body;
      if (!signers || !Array.isArray(signers) || signers.length < 2) {
        return res.status(400).json({ success: false, message: "Need at least 2 signer addresses" });
      }
      if (!threshold || threshold < 1 || threshold > signers.length) {
        return res.status(400).json({ success: false, message: "Invalid threshold" });
      }
      const result = await blockchainBetService.createMultisigGuard(signers, threshold);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/multisig/lock-withdrawals", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const result = await blockchainBetService.lockDirectWithdrawals();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/multisig/unlock-withdrawals", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const result = await blockchainBetService.unlockDirectWithdrawals();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/multisig/propose", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { amount, coinType, withdrawalType, recipient } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "Valid amount required" });
      }
      if (!coinType || !['SUI', 'SBETS', 'USDSUI'].includes(coinType)) {
        return res.status(400).json({ success: false, message: "coinType must be SUI, SBETS, or USDSUI" });
      }
      if (!withdrawalType || !['fees', 'treasury'].includes(withdrawalType)) {
        return res.status(400).json({ success: false, message: "withdrawalType must be fees or treasury" });
      }
      if (!recipient) {
        return res.status(400).json({ success: false, message: "recipient address required" });
      }
      const result = await blockchainBetService.proposeWithdrawal(amount, coinType, withdrawalType, recipient);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/multisig/approve", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { proposalId } = req.body;
      if (!proposalId) {
        return res.status(400).json({ success: false, message: "proposalId required" });
      }
      const result = await blockchainBetService.approveWithdrawal(proposalId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/multisig/execute", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { proposalId, coinType, withdrawalType } = req.body;
      if (!proposalId) {
        return res.status(400).json({ success: false, message: "proposalId required" });
      }
      if (!coinType || !['SUI', 'SBETS', 'USDSUI'].includes(coinType)) {
        return res.status(400).json({ success: false, message: "coinType must be SUI, SBETS, or USDSUI" });
      }
      if (!withdrawalType || !['fees', 'treasury'].includes(withdrawalType)) {
        return res.status(400).json({ success: false, message: "withdrawalType must be fees or treasury" });
      }
      const result = await blockchainBetService.executeMultisigWithdrawal(proposalId, coinType, withdrawalType);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/multisig/update-signers", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const { signers, threshold } = req.body;
      if (!signers || !Array.isArray(signers) || signers.length < 2) {
        return res.status(400).json({ success: false, message: "Need at least 2 signer addresses" });
      }
      if (!threshold || threshold < 1 || threshold > signers.length) {
        return res.status(400).json({ success: false, message: "Invalid threshold" });
      }
      const result = await blockchainBetService.updateMultisigSigners(signers, threshold);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get("/api/admin/multisig/status", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      res.json({
        success: true,
        multisigConfigured: blockchainBetService.isMultisigConfigured(),
        guardId: process.env.MULTISIG_GUARD_ID || null,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/pay-unpaid-winners", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      console.log('[Admin] Pay unpaid winners triggered');
      
      // Find all bets in 'won' status that haven't been paid on-chain
      const unpaidBets = await db.execute(sql`
        SELECT id, wallet_address, bet_amount, potential_payout, currency, status
        FROM bets 
        WHERE status = 'won'
        AND wallet_address != ${process.env.ADMIN_WALLET_ADDRESS || ''}
        ORDER BY created_at ASC
      `);
      
      const betsArray = Array.isArray(unpaidBets) ? unpaidBets : (unpaidBets.rows || []);
      
      if (betsArray.length === 0) {
        return res.json({ success: true, message: "No unpaid winners found", paid: 0 });
      }
      
      const results: any[] = [];
      let paidCount = 0;
      let failedCount = 0;
      
      for (const bet of betsArray) {
        const betId = bet.id;
        const wallet = bet.wallet_address;
        const payout = parseFloat(bet.potential_payout);
        const currency = bet.currency || 'SUI';
        
        console.log(`[Admin] Paying bet ${betId}: ${payout} ${currency} to ${wallet.slice(0,10)}...`);
        
        try {
          let payoutResult;
          if (currency === 'SUI') {
            payoutResult = await blockchainBetService.sendSuiToUser(wallet, payout);
          } else if (currency === 'SBETS') {
            payoutResult = await blockchainBetService.sendSbetsToUser(wallet, payout);
          }
          
          if (payoutResult?.success && payoutResult?.txHash) {
            // Update bet status to paid_out with TX hash
            await db.execute(sql`
              UPDATE bets SET status = 'paid_out', settlement_tx_hash = ${payoutResult.txHash}
              WHERE id = ${betId}
            `);
            console.log(`✅ Paid bet ${betId}: ${payout} ${currency} | TX: ${payoutResult.txHash}`);
            results.push({ betId, wallet, payout, currency, success: true, txHash: payoutResult.txHash });
            paidCount++;
          } else {
            console.warn(`⚠️ Failed to pay bet ${betId}: ${payoutResult?.error || 'Unknown error'}`);
            results.push({ betId, wallet, payout, currency, success: false, error: payoutResult?.error });
            failedCount++;
          }
        } catch (error: any) {
          console.error(`❌ Error paying bet ${betId}:`, error.message);
          results.push({ betId, wallet, payout, currency, success: false, error: error.message });
          failedCount++;
        }
      }
      
      res.json({
        success: true,
        message: `Paid ${paidCount}/${betsArray.length} winners, ${failedCount} failed`,
        paid: paidCount,
        failed: failedCount,
        results
      });
    } catch (error: any) {
      console.error(`[Admin] Pay unpaid winners error:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Liability reconciliation - compare on-chain vs database liability (admin only)
  app.get("/api/admin/liability-reconciliation", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      // Get on-chain platform info
      const platformInfo = await blockchainBetService.getPlatformInfo();
      if (!platformInfo) {
        return res.status(503).json({ success: false, message: "Unable to fetch on-chain platform info" });
      }

      // Get all pending bets from database
      const pendingBets = await storage.getAllBets('pending');
      const confirmedBets = await storage.getAllBets('confirmed');
      const allUnsettledBets = [...pendingBets, ...confirmedBets];

      // Calculate expected liability from database (by currency)
      // IMPORTANT: Only use currency/feeCurrency fields, NOT bet amount heuristics
      let dbSuiLiability = 0;
      let dbSbetsLiability = 0;
      const suiBetsDetails: any[] = [];
      const sbetsBetsDetails: any[] = [];

      for (const bet of allUnsettledBets) {
        // Determine currency: feeCurrency is the accurate field indicating payment token
        // (currency column may have been set incorrectly for old bets)
        const paymentCurrency = bet.feeCurrency || bet.currency || 'SUI';
        const potentialPayout = bet.potentialPayout || (bet.betAmount * bet.odds);
        
        if (paymentCurrency === 'SBETS') {
          dbSbetsLiability += potentialPayout;
          sbetsBetsDetails.push({
            id: bet.id,
            amount: bet.betAmount,
            potentialPayout,
            currency: 'SBETS',
            feeCurrency: bet.feeCurrency,
            hasBetObjectId: !!bet.betObjectId,
            status: bet.status
          });
        } else {
          // Default to SUI for any non-SBETS currency
          dbSuiLiability += potentialPayout;
          suiBetsDetails.push({
            id: bet.id,
            amount: bet.betAmount,
            potentialPayout,
            currency: 'SUI',
            feeCurrency: bet.feeCurrency,
            hasBetObjectId: !!bet.betObjectId,
            status: bet.status
          });
        }
      }

      // Calculate mismatch
      const suiMismatch = platformInfo.totalLiabilitySui - dbSuiLiability;
      const sbetsMismatch = platformInfo.totalLiabilitySbets - dbSbetsLiability;

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        onChain: {
          suiLiability: platformInfo.totalLiabilitySui,
          sbetsLiability: platformInfo.totalLiabilitySbets,
          suiTreasury: platformInfo.treasuryBalanceSui,
          sbetsTreasury: platformInfo.treasuryBalanceSbets,
          totalBets: platformInfo.totalBets
        },
        database: {
          suiLiability: dbSuiLiability,
          sbetsLiability: dbSbetsLiability,
          suiBetsCount: suiBetsDetails.length,
          sbetsBetsCount: sbetsBetsDetails.length,
          suiBetsWithObjectId: suiBetsDetails.filter(b => b.hasBetObjectId).length,
          sbetsBetsWithObjectId: sbetsBetsDetails.filter(b => b.hasBetObjectId).length
        },
        mismatch: {
          sui: suiMismatch,
          sbets: sbetsMismatch,
          suiOrphaned: suiMismatch > 0.001, // More than 0.001 SUI orphaned
          sbetsOrphaned: sbetsMismatch > 1 // More than 1 SBETS orphaned
        },
        details: {
          suiBets: suiBetsDetails,
          sbetsBets: sbetsBetsDetails
        },
        recommendation: suiMismatch > 0.001 || sbetsMismatch > 1 
          ? "On-chain liability is higher than database expects. This may be from old bets without betObjectId that were settled in DB but not on-chain. Contact support to reconcile."
          : "Liability is in sync. No action needed."
      });
    } catch (error: any) {
      console.error('[Admin] Liability reconciliation error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Test all blockchain settlement functions
  app.get("/api/admin/test-settlement-functions", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const tests: any = {
        timestamp: new Date().toISOString(),
        adminKeyConfigured: false,
        platformInfo: null,
        settlementWorkerStatus: null,
        pendingBets: 0,
        errors: []
      };
      
      // Test 1: Check admin key configuration
      tests.adminKeyConfigured = blockchainBetService.isAdminKeyConfigured();
      
      // Test 2: Get platform info (treasury balances)
      try {
        const platformInfo = await blockchainBetService.getPlatformInfo();
        tests.platformInfo = platformInfo;
      } catch (e: any) {
        tests.errors.push(`Platform info error: ${e.message}`);
      }
      
      // Test 3: Settlement worker status
      tests.settlementWorkerStatus = {
        isRunning: settlementWorker.isRunningNow(),
        settledEventsCount: settlementWorker.getSettledEventsCount(),
        settledBetsCount: settlementWorker.getSettledBetsCount()
      };
      
      // Test 4: Get pending bets count
      try {
        const pendingBets = await storage.getAllBets('pending');
        tests.pendingBets = pendingBets.length;
        tests.pendingBetDetails = pendingBets.map(b => ({
          id: b.id,
          eventId: b.eventId,
          externalEventId: b.externalEventId,
          currency: b.currency,
          stake: b.stake,
          hasBetObjectId: !!b.betObjectId
        }));
      } catch (e: any) {
        tests.errors.push(`Pending bets error: ${e.message}`);
      }
      
      // Overall status
      tests.allSystemsOperational = 
        tests.adminKeyConfigured && 
        tests.platformInfo !== null && 
        tests.settlementWorkerStatus?.isRunning === true &&
        tests.errors.length === 0;
      
      res.json(tests);
    } catch (error: any) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post("/api/admin/trigger-settlement", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Trigger the settlement worker to check for finished matches now (force fresh API calls)
      console.log('🔄 Admin triggered manual settlement check (force refresh)...');
      await settlementWorker.checkAndSettleBets(true);
      
      res.json({ 
        success: true, 
        message: 'Settlement check triggered. Check server logs for results.',
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Manual settlement trigger failed:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get("/api/admin/find-lost-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const searchTerm = req.query.search as string;
      if (!searchTerm) {
        return res.status(400).json({ message: "Provide ?search=teamname" });
      }
      const result = await db.execute(sql`
        SELECT id, wurlus_bet_id, bet_object_id, status, home_team, away_team, prediction,
               stake, potential_win, potential_payout, currency, fee_currency,
               wallet_address, bet_amount, odds, settled_at, created_at
        FROM bets 
        WHERE (LOWER(home_team) LIKE LOWER(${'%' + searchTerm + '%'})
               OR LOWER(away_team) LIKE LOWER(${'%' + searchTerm + '%'})
               OR LOWER(prediction) LIKE LOWER(${'%' + searchTerm + '%'}))
          AND status = 'lost'
        ORDER BY created_at DESC
        LIMIT 20
      `);
      const rows = Array.isArray(result) ? result : (result.rows || []);
      res.json({ count: rows.length, bets: rows });
    } catch (error: any) {
      console.error("Find lost bets error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/correct-u21-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const results: any[] = [];
      const { betIds } = req.body;

      if (!betIds || !Array.isArray(betIds) || betIds.length === 0) {
        return res.status(400).json({ message: "Provide betIds array (database IDs or betObjectIds)" });
      }

      for (const betId of betIds) {
        try {
          const bet = await storage.getBetByStringId(String(betId));
          if (!bet) {
            results.push({ betId, error: "Bet not found" });
            continue;
          }

          if (bet.status !== 'lost') {
            results.push({ betId, error: `Bet status is '${bet.status}', not 'lost' - skipping` });
            continue;
          }

          const dbId = String(bet.wurlusBetId || bet.id || bet.betObjectId);

          const rolledBack = await storage.updateBetStatus(dbId, 'pending');
          if (!rolledBack) {
            results.push({ betId, error: "Failed to rollback to pending" });
            continue;
          }

          const settled = await storage.updateBetStatus(dbId, 'won');
          if (!settled) {
            results.push({ betId, error: "Failed to settle as won after rollback" });
            continue;
          }

          const currency = (bet.currency === 'SBETS' || bet.feeCurrency === 'SBETS') ? 'SBETS' : 'SUI';
          const walletId = bet.walletAddress && isValidSuiWallet(bet.walletAddress) ? bet.walletAddress : null;
          const stake = bet.stake || bet.betAmount || 0;
          const potentialPayout = bet.potentialWin || bet.potentialPayout || 0;

          if (!walletId) {
            results.push({ betId, error: "No valid wallet address - cannot credit winnings", dbId });
            continue;
          }

          // DEFENSE-IN-DEPTH: Payout cap at correction settlement
          const correctionMaxPayout = getMaxPayoutForCurrency(currency);
          if (potentialPayout > correctionMaxPayout) {
            console.error(`🚨 CORRECTION SETTLE CAP BREACH: Bet ${betId} payout=${potentialPayout} ${currency} > max ${correctionMaxPayout} — blocking`);
            results.push({ betId, error: `Payout ${potentialPayout} exceeds cap ${correctionMaxPayout} ${currency}`, dbId });
            continue;
          }

          const profit = potentialPayout - stake;
          const platformFee = profit > 0 ? profit * 0.01 : 0;
          const netPayout = potentialPayout - platformFee;

          const winningsAdded = await balanceService.addWinnings(walletId, netPayout, currency);
          if (!winningsAdded) {
            await storage.updateBetStatus(dbId, 'pending');
            results.push({ betId, error: "Failed to credit winnings - reverted to pending", dbId });
            continue;
          }

          if (platformFee > 0) {
            await balanceService.addRevenue(platformFee, currency);
          }

          const refundedStake = await balanceService.addWinnings(walletId, 0, currency);

          console.log(`✅ U21 CORRECTION: Bet ${betId} resettled as WON - paid ${netPayout} ${currency} to ${walletId.slice(0,12)}...`);
          results.push({
            betId,
            dbId,
            success: true,
            wallet: walletId,
            stake,
            potentialPayout,
            netPayout,
            platformFee,
            currency,
            homeTeam: bet.homeTeam,
            awayTeam: bet.awayTeam,
            prediction: bet.prediction
          });
        } catch (err: any) {
          results.push({ betId, error: err.message });
        }
      }

      console.log(`🔧 U21 BET CORRECTION COMPLETE:`, JSON.stringify(results, null, 2));
      res.json({ success: true, results });
    } catch (error: any) {
      console.error("U21 correction error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/sync-onchain-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      console.log('🔄 Admin triggered on-chain bet sync...');
      const syncResult = await blockchainBetService.syncOnChainBetsToDatabase();
      
      res.json({ 
        success: true, 
        message: `Synced ${syncResult.synced} on-chain bets to database`,
        synced: syncResult.synced,
        errors: syncResult.errors,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('On-chain bet sync failed:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/void-stale-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const hoursOld = req.body?.hoursOld || 48;
      const cutoffStr = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');

      const staleBetsResult = await db.execute(sql`
        SELECT id, external_event_id, bet_amount, currency, potential_payout, wallet_address, bet_object_id, home_team, away_team, created_at
        FROM bets
        WHERE status IN ('pending', 'confirmed', 'in_play', 'open')
          AND created_at < ${cutoffStr}
        ORDER BY created_at ASC
      `);

      const rows = Array.isArray(staleBetsResult) ? staleBetsResult : ((staleBetsResult as any).rows || []);

      const summary = {
        totalStale: rows.length,
        totalLiability: rows.reduce((sum: number, b: any) => sum + Number(b.potential_payout || 0), 0),
        byCurrency: {} as Record<string, { count: number; liability: number }>,
        byType: { horseRacing: 0, parlay: 0, football: 0, freeSports: 0, other: 0 } as Record<string, number>,
        oldestBet: rows.length > 0 ? rows[0].created_at : null,
        cutoff: cutoffStr,
        hoursOld,
      };

      for (const bet of rows) {
        const cur = bet.currency || 'SUI';
        if (!summary.byCurrency[cur]) summary.byCurrency[cur] = { count: 0, liability: 0 };
        summary.byCurrency[cur].count++;
        summary.byCurrency[cur].liability += Number(bet.potential_payout || 0);

        const eid = bet.external_event_id || '';
        if (eid.includes('horse-racing') || eid.includes('rac_')) summary.byType.horseRacing++;
        else if (eid.startsWith('parlay_')) summary.byType.parlay++;
        else if (/^\d+$/.test(eid)) summary.byType.football++;
        else if (eid.includes('_api_')) summary.byType.freeSports++;
        else summary.byType.other++;
      }

      if (req.body?.execute) {
        console.log(`🧹 [ManualStaleBetVoid] Admin triggered void for ${rows.length} stale bets (>${hoursOld}h old)`);
        await autoVoidStaleBets(hoursOld);
        return res.json({ success: true, message: `Void triggered for ${rows.length} stale bets`, summary });
      }

      return res.json({ success: true, dryRun: true, message: `Found ${rows.length} stale bets — pass { execute: true } to void them`, summary });
    } catch (error: any) {
      console.error('[ManualStaleBetVoid] Error:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/admin/unsettled-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const unsettledResult = await db.execute(sql`
        SELECT id, external_event_id, home_team, away_team, prediction, bet_amount, currency, 
               potential_payout, status, wallet_address, bet_object_id, created_at, event_name,
               odds, selection
        FROM bets
        WHERE status IN ('pending', 'confirmed', 'in_play', 'open', 'won')
        ORDER BY created_at ASC
      `);

      const rows = unsettledResult.rows || [];
      const bets = rows.map((r: any) => {
        const eid = r.external_event_id || '';
        let betType = 'unknown';
        if (eid.includes('horse-racing') || eid.includes('rac_')) betType = 'horse-racing';
        else if (eid.startsWith('parlay_')) betType = 'parlay';
        else if (/^\d+$/.test(eid)) betType = 'football';
        else if (eid.includes('_api_')) betType = 'free-sport-api';
        else if (eid.includes('_sf_')) betType = 'free-sport-legacy';
        else if (!eid || eid === 'Unknown') betType = 'recovered-unknown';

        return {
          id: r.id,
          eventId: eid,
          betType,
          homeTeam: r.home_team,
          awayTeam: r.away_team,
          prediction: r.prediction || r.selection,
          eventName: r.event_name,
          betAmount: r.bet_amount,
          currency: r.currency,
          potentialPayout: r.potential_payout,
          odds: r.odds,
          status: r.status,
          wallet: r.wallet_address ? `${String(r.wallet_address).slice(0, 10)}...${String(r.wallet_address).slice(-6)}` : 'none',
          betObjectId: r.bet_object_id ? String(r.bet_object_id).slice(0, 20) + '...' : null,
          createdAt: r.created_at,
          ageHours: Math.round((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60)),
        };
      });

      const summary = {
        total: bets.length,
        byType: {} as Record<string, number>,
        byCurrency: {} as Record<string, { count: number; liability: number }>,
        byStatus: {} as Record<string, number>,
      };
      for (const b of bets) {
        summary.byType[b.betType] = (summary.byType[b.betType] || 0) + 1;
        if (!summary.byCurrency[b.currency]) summary.byCurrency[b.currency] = { count: 0, liability: 0 };
        summary.byCurrency[b.currency].count++;
        summary.byCurrency[b.currency].liability += Number(b.potentialPayout || 0);
        summary.byStatus[b.status] = (summary.byStatus[b.status] || 0) + 1;
      }

      return res.json({ success: true, summary, bets });
    } catch (error: any) {
      console.error('[UnsettledBets] Error:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/admin/liability-check", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const platformInfo = await blockchainBetService.getPlatformInfo();
      const activeBetsResult = await db.execute(sql`
        SELECT currency, COUNT(*) as count, SUM(potential_payout) as total_liability, SUM(bet_amount) as total_staked
        FROM bets
        WHERE status IN ('pending', 'confirmed', 'in_play', 'open')
        GROUP BY currency
      `);
      const activeBets = activeBetsResult.rows || [];

      const wonUnpaidResult = await db.execute(sql`
        SELECT currency, COUNT(*) as count, SUM(potential_payout) as total_liability
        FROM bets
        WHERE status = 'won' AND settlement_tx_hash IS NULL
        GROUP BY currency
      `);
      const wonUnpaid = wonUnpaidResult.rows || [];

      const ageBucketsResult = await db.execute(sql`
        SELECT 
          CASE 
            WHEN created_at > NOW() - INTERVAL '6 hours' THEN '0-6h'
            WHEN created_at > NOW() - INTERVAL '24 hours' THEN '6-24h'
            WHEN created_at > NOW() - INTERVAL '48 hours' THEN '24-48h'
            ELSE '48h+'
          END as age_bucket,
          currency,
          COUNT(*) as count,
          SUM(potential_payout) as liability
        FROM bets
        WHERE status IN ('pending', 'confirmed', 'in_play', 'open')
        GROUP BY age_bucket, currency
        ORDER BY age_bucket
      `);
      const ageBuckets = ageBucketsResult.rows || [];

      const dbLiabilitySbets = activeBets.filter((b: any) => b.currency === 'SBETS').reduce((s: number, b: any) => s + Number(b.total_liability || 0), 0);
      const dbLiabilitySui = activeBets.filter((b: any) => b.currency === 'SUI').reduce((s: number, b: any) => s + Number(b.total_liability || 0), 0);

      return res.json({
        success: true,
        onChain: platformInfo ? {
          treasurySbets: platformInfo.treasuryBalanceSbets,
          treasurySui: platformInfo.treasuryBalanceSui,
          treasuryUsdsui: platformInfo.treasuryBalanceUsdsui,
          liabilitySbets: platformInfo.totalLiabilitySbets,
          liabilitySui: platformInfo.totalLiabilitySui,
          availableSbets: (platformInfo.treasuryBalanceSbets || 0) - (platformInfo.totalLiabilitySbets || 0),
          availableSui: (platformInfo.treasuryBalanceSui || 0) - (platformInfo.totalLiabilitySui || 0),
        } : null,
        database: {
          activeBets,
          wonUnpaid,
          ageBuckets,
          dbLiabilitySbets,
          dbLiabilitySui,
        },
        mismatch: platformInfo ? {
          sbetsDiff: (platformInfo.totalLiabilitySbets || 0) - dbLiabilitySbets,
          suiDiff: (platformInfo.totalLiabilitySui || 0) - dbLiabilitySui,
          note: 'Positive diff = on-chain liability is HIGHER than DB (phantom bets or unsettled on-chain objects)',
        } : null,
      });
    } catch (error: any) {
      console.error('[LiabilityCheck] Error:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/void-stuck-parlays", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const hoursOld = req.body?.hoursOld || 24;
      const cutoffStr = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
      
      const stuckParlays = await db.execute(sql`
        SELECT id, external_event_id, bet_amount, currency, potential_payout, wallet_address
        FROM bets
        WHERE status = 'pending'
          AND home_team = 'Unknown'
          AND external_event_id LIKE ${'parlay_%'}
          AND created_at < ${cutoffStr}
      `);

      const rows = stuckParlays.rows || [];
      if (rows.length === 0) {
        return res.json({ success: true, message: 'No stuck parlays found', voided: 0 });
      }

      let voided = 0;
      let liabilityFreed = 0;
      for (const bet of rows) {
        await db.execute(sql`
          UPDATE bets SET status = 'void', settled_at = NOW()
          WHERE id = ${bet.id} AND status = 'pending'
        `);
        voided++;
        liabilityFreed += Number(bet.potential_payout || 0);
        console.log(`🗑️ [AdminVoid] Voided parlay #${bet.id}: ${bet.bet_amount} ${bet.currency}`);
      }

      console.log(`✅ [AdminVoid] Voided ${voided} stuck parlays, freed ${liabilityFreed.toFixed(0)} liability`);
      return res.json({ 
        success: true, 
        voided, 
        liabilityFreed,
        message: `Voided ${voided} stuck parlay bets, freed ${liabilityFreed.toFixed(0)} liability`
      });
    } catch (error: any) {
      console.error('Admin void stuck parlays failed:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/fix-synced-bets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db: fixDb } = await import('./db');
      const { sql: fixSql, eq: fixEq } = await import('drizzle-orm');
      const { bets: fixBets } = await import('@shared/schema');

      const unknownBets = await fixDb.select().from(fixBets)
        .where(fixSql`(${fixBets.homeTeam} = 'Unknown' OR ${fixBets.awayTeam} = 'Unknown' OR ${fixBets.eventName} = 'Unknown Event') AND ${fixBets.externalEventId} IS NOT NULL`);

      let fixed = 0;
      for (const bet of unknownBets) {
        const refBet = await fixDb.select({
          eventName: fixBets.eventName,
          homeTeam: fixBets.homeTeam,
          awayTeam: fixBets.awayTeam
        }).from(fixBets)
          .where(fixSql`${fixBets.externalEventId} = ${bet.externalEventId} AND ${fixBets.homeTeam} != 'Unknown' AND ${fixBets.awayTeam} != 'Unknown'`)
          .limit(1);

        if (refBet.length > 0) {
          await fixDb.update(fixBets)
            .set({
              eventName: refBet[0].eventName,
              homeTeam: refBet[0].homeTeam,
              awayTeam: refBet[0].awayTeam
            })
            .where(fixEq(fixBets.id, bet.id));
          fixed++;
          console.log(`🔧 Fixed bet ${bet.wurlusBetId || bet.id}: ${refBet[0].eventName}`);
        }
      }

      if (req.body?.betId && req.body?.giftedTo) {
        await fixDb.update(fixBets)
          .set({
            giftedTo: req.body.giftedTo,
            giftedFrom: req.body.giftedFrom || null
          })
          .where(fixEq(fixBets.id, parseInt(req.body.betId)));
        console.log(`🎁 Set gift recipient for bet ${req.body.betId}: ${req.body.giftedTo}`);
      }

      res.json({ success: true, fixed, total: unknownBets.length });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/void-phantom-sbets", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const forceReset = req.body?.forceReset === true;
      
      if (forceReset) {
        blockchainBetService.resetPhantomVoidStatus();
        console.log('🔄 Admin force-reset phantom void status');
      }
      
      const preCheck = blockchainBetService.canStartPhantomVoid();
      if (!preCheck.canStart) {
        const currentStatus = blockchainBetService.getPhantomVoidStatus();
        if (currentStatus?.running) {
          return res.json({ success: true, message: 'Void scan already in progress', status: currentStatus });
        }
        return res.status(400).json({ success: false, message: preCheck.error });
      }

      console.log('🗑️ Admin triggered ALL phantom bet void (SUI + SBETS, background)...');
      blockchainBetService.voidAllPhantomBets().then(result => {
        console.log(`🏁 Background void finished: ${result.voided} voided, ${result.liabilityFreed.toFixed(2)} total freed`);
      }).catch(err => {
        console.error('Background void error:', err);
      });
      
      res.json({ 
        success: true, 
        message: 'Phantom void scan started in background. Poll /api/admin/void-phantom-status for progress.',
        status: blockchainBetService.getPhantomVoidStatus(),
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Phantom SBETS void failed:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get("/api/admin/void-phantom-status", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const hasValidToken = token && (await isValidAdminSession(token));
      if (!hasValidToken) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const status = blockchainBetService.getPhantomVoidStatus();
      if (!status) {
        return res.json({ success: true, status: null, message: 'No void scan has been run yet' });
      }
      res.json({ success: true, status });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/reset-onchain-liability", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const allBets = await storage.getAllBets();
      const activeBets = allBets.filter((b: any) => 
        b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_play' || b.status === 'open'
      );
      const realLiabilitySui = activeBets
        .filter((b: any) => b.currency === 'SUI')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
      const realLiabilitySbets = activeBets
        .filter((b: any) => b.currency === 'SBETS')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);

      const currency = req.body?.currency || 'SBETS';
      const newLiability = currency === 'SBETS' ? realLiabilitySbets : realLiabilitySui;

      console.log(`🔧 Admin resetting on-chain ${currency} liability to ${newLiability.toFixed(4)} (from DB active bets)`);

      const result = await blockchainBetService.resetOnChainLiability(currency as 'SUI' | 'SBETS', newLiability);

      res.json({
        success: result.success,
        message: result.success 
          ? `Reset ${currency} liability to ${newLiability.toFixed(4)} (matching ${activeBets.filter((b: any) => b.currency === currency).length} active bets)`
          : result.error,
        txHash: result.txHash,
        newLiability,
        activeBetCount: activeBets.filter((b: any) => b.currency === currency).length,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Liability reset failed:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get("/api/admin/onchain-bet/:betObjectId", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const { betObjectId } = req.params;
      
      if (!betObjectId || !betObjectId.startsWith('0x')) {
        return res.status(400).json({ success: false, message: "Invalid bet object ID" });
      }
      
      const betInfo = await blockchainBetService.getOnChainBetInfo(betObjectId);
      
      if (!betInfo) {
        return res.status(404).json({ success: false, message: "Bet not found on-chain" });
      }
      
      res.json({ 
        success: true, 
        bet: betInfo
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/toggle-sui-pause", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const { paused } = req.body;

      const newState = typeof paused === 'boolean' ? paused : !SUI_BETTING_PAUSED;
      SUI_BETTING_PAUSED = newState;
      console.log(`[Admin] SUI betting ${newState ? 'PAUSED' : 'UNPAUSED'} by admin`);
      
      res.json({ 
        success: true, 
        suiBettingPaused: SUI_BETTING_PAUSED,
        message: `SUI betting ${SUI_BETTING_PAUSED ? 'paused' : 'unpaused'} successfully`
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ==================== ADMIN: PREDICTIONS MANAGEMENT ====================
  app.get("/api/admin/predictions/all", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db } = await import('./db');
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { desc, sql } = await import('drizzle-orm');
      
      const predictions = await db.select().from(socialPredictions).orderBy(desc(socialPredictions.createdAt));
      
      res.json({ success: true, predictions });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get("/api/admin/challenges/all", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || !(await isValidAdminSession(token))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db } = await import('./db');
      const { socialChallenges } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      
      const challenges = await db.select().from(socialChallenges).orderBy(desc(socialChallenges.createdAt));
      
      res.json({ success: true, challenges });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/predictions/resolve", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const { predictionId, winner } = req.body;

      if (!predictionId || !winner || !['YES', 'NO'].includes(winner)) {
        return res.status(400).json({ success: false, message: "predictionId and winner (YES/NO) required" });
      }

      const { db } = await import('./db');
      const { socialPredictions } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const [prediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, predictionId));
      if (!prediction) {
        return res.status(404).json({ success: false, message: "Prediction not found" });
      }
      if (prediction.status === 'resolved') {
        return res.status(400).json({ success: false, message: "Already resolved" });
      }

      await db.update(socialPredictions)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(socialPredictions.id, predictionId));
      
      console.log(`[Admin] Force resolved prediction ${predictionId} as ${winner}`);
      res.json({ success: true, message: `Prediction ${predictionId} resolved as ${winner}` });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post("/api/admin/predictions/cancel", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      
      const { predictionId } = req.body;

      if (!predictionId) {
        return res.status(400).json({ success: false, message: "predictionId required" });
      }

      const { db } = await import('./db');
      const { socialPredictions } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      await db.update(socialPredictions)
        .set({ status: 'cancelled' })
        .where(eq(socialPredictions.id, predictionId));
      
      console.log(`[Admin] Cancelled prediction ${predictionId}`);
      res.json({ success: true, message: `Prediction ${predictionId} cancelled` });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Notifications endpoints
  app.get("/api/notifications", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }
      const limit = parseInt(req.query.limit as string) || 20;
      const unreadOnly = req.query.unreadOnly === 'true';
      
      const notifications = notificationService.getUserNotifications(userId, limit, unreadOnly);
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }
      const count = notificationService.getUnreadCount(userId);
      res.json({ unreadCount: count });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.post("/api/notifications/mark-as-read", async (req: Request, res: Response) => {
    try {
      const { userId, notificationId, wallet } = req.body;
      if (!userId || !notificationId) {
        return res.status(400).json({ message: "Missing userId or notificationId" });
      }
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ message: "Valid wallet address required" });
      }
      if (userId !== wallet.toLowerCase() && userId !== wallet) {
        return res.status(403).json({ message: "Wallet does not match userId" });
      }
      const notif = notificationService.markAsRead(userId, notificationId);
      res.json({ success: !!notif });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });

  app.post("/api/notifications/mark-all-as-read", async (req: Request, res: Response) => {
    try {
      const { userId, wallet } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ message: "Valid wallet address required" });
      }
      if (userId !== wallet.toLowerCase() && userId !== wallet) {
        return res.status(403).json({ message: "Wallet does not match userId" });
      }
      const count = notificationService.markAllAsRead(userId);
      res.json({ success: true, markedCount: count });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark all as read" });
    }
  });

  const oracleSignRateLimits = new Map<string, { count: number; timestamps: number[] }>();
  const ORACLE_MAX_SIGNS_PER_DAY = 7;
  const ORACLE_SIGN_COOLDOWN_MS = 60_000;
  const ORACLE_MAX_PER_EVENT = 1;

  setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, data] of oracleSignRateLimits.entries()) {
      data.timestamps = data.timestamps.filter(t => t > cutoff);
      data.count = data.timestamps.length;
      if (data.count === 0) oracleSignRateLimits.delete(key);
    }
  }, 10 * 60 * 1000);

  async function getWalletPendingExposure(walletAddress: string): Promise<{ sbets: number; sui: number; usdsui: number; activeBetCount: number }> {
    try {
      const result = await db.execute(sql`
        SELECT currency, potential_payout FROM bets
        WHERE LOWER(wallet_address) = ${walletAddress.toLowerCase()}
        AND status IN ('pending', 'confirmed', 'in_play', 'open')
      `);
      const rows = result.rows || [];
      let sbets = 0, sui = 0, usdsui = 0;
      for (const r of rows as any[]) {
        if (r.currency === 'SBETS') sbets += Number(r.potential_payout || 0);
        else if (r.currency === 'USDSUI') usdsui += Number(r.potential_payout || 0);
        else sui += Number(r.potential_payout || 0);
      }
      return { sbets, sui, usdsui, activeBetCount: rows.length };
    } catch (e) {
      console.error('[ExposureCheck] DB error - FAIL CLOSED:', e);
      return { sbets: Infinity, sui: Infinity, usdsui: Infinity, activeBetCount: 999 };
    }
  }

  async function getWalletBetCountDB(walletAddress: string): Promise<number> {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = await db.execute(sql`
        SELECT COUNT(*) as bet_count FROM bets
        WHERE LOWER(wallet_address) = ${walletAddress.toLowerCase()}
        AND created_at >= ${twentyFourHoursAgo}
        AND status NOT IN ('void', 'voided')
      `);
      return Number(result.rows?.[0]?.bet_count || 0);
    } catch (e) {
      console.error('[OracleRateDB] DB error - FAIL CLOSED:', e);
      return 999;
    }
  }

  app.post("/api/oracle/sign-bet", async (req: Request, res: Response) => {
    try {
      if (!oracleSigningService.isReady()) {
        return res.status(503).json({ success: false, message: "Oracle signing not available" });
      }

      const { eventId, oddsBps, walletAddress, prediction, betAmountMist } = req.body;
      if (!eventId || !oddsBps || typeof oddsBps !== 'number' || oddsBps < 100) {
        return res.status(400).json({ success: false, message: "Invalid eventId or oddsBps" });
      }

      if (!walletAddress || typeof walletAddress !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(walletAddress)) {
        return res.status(400).json({ success: false, message: "Valid 32-byte Sui address required" });
      }

      const walletKey = walletAddress.toLowerCase();
      const now = Date.now();
      const cutoff24h = now - 24 * 60 * 60 * 1000;

      if (!oracleSignRateLimits.has(walletKey)) {
        oracleSignRateLimits.set(walletKey, { count: 0, timestamps: [] });
      }
      const walletData = oracleSignRateLimits.get(walletKey)!;
      walletData.timestamps = walletData.timestamps.filter(t => t > cutoff24h);
      walletData.count = walletData.timestamps.length;

      if (walletData.count >= ORACLE_MAX_SIGNS_PER_DAY) {
        console.log(`❌ ORACLE RATE LIMIT: ${walletKey.slice(0, 12)}... hit daily limit (${walletData.count}/${ORACLE_MAX_SIGNS_PER_DAY})`);
        return res.status(429).json({ success: false, message: `Daily bet limit reached (${ORACLE_MAX_SIGNS_PER_DAY} per 24h). Try again later.` });
      }

      const dbBetCount = await getWalletBetCountDB(walletKey);
      if (dbBetCount >= ORACLE_MAX_SIGNS_PER_DAY) {
        console.log(`❌ ORACLE RATE LIMIT (DB): ${walletKey.slice(0, 12)}... has ${dbBetCount} bets in 24h (max ${ORACLE_MAX_SIGNS_PER_DAY})`);
        return res.status(429).json({ success: false, message: `Daily bet limit reached (${ORACLE_MAX_SIGNS_PER_DAY} per 24h). Try again later.` });
      }

      const lastSign = walletData.timestamps.length > 0 ? walletData.timestamps[walletData.timestamps.length - 1] : 0;
      if (now - lastSign < ORACLE_SIGN_COOLDOWN_MS) {
        const secsLeft = Math.ceil((ORACLE_SIGN_COOLDOWN_MS - (now - lastSign)) / 1000);
        console.log(`❌ ORACLE COOLDOWN: ${walletKey.slice(0, 12)}... must wait ${secsLeft}s`);
        return res.status(429).json({ success: false, message: `Please wait ${secsLeft}s between bets.` });
      }

      const eventKey = `${walletKey}:${String(eventId)}`;
      if (!oracleSignRateLimits.has(eventKey)) {
        oracleSignRateLimits.set(eventKey, { count: 0, timestamps: [] });
      }
      const eventData = oracleSignRateLimits.get(eventKey)!;
      eventData.timestamps = eventData.timestamps.filter(t => t > cutoff24h);
      eventData.count = eventData.timestamps.length;
      if (eventData.count >= ORACLE_MAX_PER_EVENT) {
        console.log(`❌ ORACLE EVENT LIMIT: ${walletKey.slice(0, 12)}... already signed ${eventData.count}x for event ${String(eventId).slice(0, 20)}`);
        return res.status(429).json({ success: false, message: "Maximum bets per event reached." });
      }

      const walletExposure = await getWalletPendingExposure(walletKey);
      const submittedOddsDecimal = oddsBps / 100;
      const actualBetAmount = betAmountMist && typeof betAmountMist === 'number' && betAmountMist > 0
        ? betAmountMist / 1_000_000_000
        : null;
      const projectedStakeSbets = actualBetAmount !== null ? Math.min(actualBetAmount, RUNTIME_MAX_STAKE_SBETS) : RUNTIME_MAX_STAKE_SBETS;
      const oracleProjectedPayout = submittedOddsDecimal * projectedStakeSbets;
      if (walletExposure.sbets + oracleProjectedPayout > MAX_WALLET_EXPOSURE_SBETS) {
        console.log(`❌ ORACLE EXPOSURE LIMIT (SBETS): ${walletKey.slice(0, 12)}... current=${walletExposure.sbets.toLocaleString()} + projected=${oracleProjectedPayout.toLocaleString()} (stake=${projectedStakeSbets.toLocaleString()}) > max ${MAX_WALLET_EXPOSURE_SBETS.toLocaleString()}`);
        return res.status(400).json({ success: false, message: `Maximum pending exposure would be exceeded. Wait for active bets to settle.` });
      }
      const projectedStakeSui = actualBetAmount !== null ? Math.min(actualBetAmount, RUNTIME_MAX_STAKE_SUI) : RUNTIME_MAX_STAKE_SUI;
      const oracleProjectedPayoutSui = submittedOddsDecimal * projectedStakeSui;
      if (walletExposure.sui + oracleProjectedPayoutSui > MAX_WALLET_EXPOSURE_SUI) {
        console.log(`❌ ORACLE EXPOSURE LIMIT (SUI): ${walletKey.slice(0, 12)}... current=${walletExposure.sui.toFixed(2)} + projected=${oracleProjectedPayoutSui.toFixed(2)} (stake=${projectedStakeSui.toFixed(2)}) > max ${MAX_WALLET_EXPOSURE_SUI}`);
        return res.status(400).json({ success: false, message: `Maximum pending exposure would be exceeded. Wait for active bets to settle.` });
      }
      const projectedStakeUsdsui = actualBetAmount !== null ? Math.min(actualBetAmount, RUNTIME_MAX_STAKE_USDSUI) : RUNTIME_MAX_STAKE_USDSUI;
      const oracleProjectedPayoutUsdsui = submittedOddsDecimal * projectedStakeUsdsui;
      if (walletExposure.usdsui + oracleProjectedPayoutUsdsui > MAX_WALLET_EXPOSURE_USDSUI) {
        console.log(`❌ ORACLE EXPOSURE LIMIT (USDSUI): ${walletKey.slice(0, 12)}... current=${walletExposure.usdsui.toFixed(2)} + projected=${oracleProjectedPayoutUsdsui.toFixed(2)} > max ${MAX_WALLET_EXPOSURE_USDSUI}`);
        return res.status(400).json({ success: false, message: `Maximum pending exposure would be exceeded. Wait for active bets to settle.` });
      }

      if (!prediction || typeof prediction !== 'string') {
        return res.status(400).json({ success: false, message: "Prediction required" });
      }

      const eventIdStrEarly = String(eventId);
      const isFuturesEarly = isFuturesEvent(eventIdStrEarly);
      const actualStakeForCheck = actualBetAmount !== null ? actualBetAmount : (isFuturesEarly ? FUTURES_MAX_STAKE_SBETS : RUNTIME_MAX_STAKE_SBETS);
      const maxPayoutProjected = submittedOddsDecimal * actualStakeForCheck;
      if (maxPayoutProjected > MAX_PAYOUT_SBETS) {
        const safeStake = Math.floor(MAX_PAYOUT_SBETS / submittedOddsDecimal);
        console.log(`❌ ORACLE PAYOUT CAP: projected payout ${maxPayoutProjected.toLocaleString()} SBETS > ${MAX_PAYOUT_SBETS.toLocaleString()}, odds=${submittedOddsDecimal}x, stake=${actualStakeForCheck}, event=${eventIdStrEarly}`);
        return res.status(400).json({ success: false, message: `Maximum potential payout is ${MAX_PAYOUT_SBETS.toLocaleString()} SBETS. Try a stake of ${safeStake.toLocaleString()} or less.`, suggestedStake: safeStake });
      }

      const maxOddsBps = isFuturesEarly ? 5000 : Math.round(MAX_ODDS_CAP * 100);
      if (oddsBps > maxOddsBps) {
        return res.status(400).json({ success: false, message: `Odds exceed maximum allowed (${(maxOddsBps / 100).toFixed(2)}x)` });
      }

      const predLowerOracle = (prediction || '').toLowerCase().trim();
      const isDrawBet = predLowerOracle === 'draw' || predLowerOracle === 'x' || predLowerOracle === 'tie';
      if (isDrawBet && oddsBps > 500) {
        console.log(`❌ ORACLE DRAW ODDS CAP: draw bet with oddsBps=${oddsBps} (${submittedOddsDecimal}x) > 5.00x, wallet=${walletKey.slice(0,12)}...`);
        return res.status(400).json({ success: false, message: "Maximum draw odds is 5.00x. Please refresh and try again." });
      }

      const eventIdStr = String(eventId);
      let eventFound = false;

      // Parlay bets use composite event IDs like "parlay_<timestamp>_<eventId1>_<eventId2>_..."
      // Event IDs may contain underscores (e.g., "basketball_123"), so we reconstruct them
      if (eventIdStr.startsWith('parlay_')) {
        const legEventIds = extractParlayLegIds(eventIdStr);
        if (legEventIds.length >= 2) {
          let allLegsValid = true;
          for (const legId of legEventIds) {
            let legFound = false;
            const legLookup = apiSportsService.lookupEventSync(legId);
            if (legLookup.found) {
              legFound = true;
              if (legLookup.source === 'live') {
                if (legLookup.minute === undefined || legLookup.minute === null) {
                  console.log(`[Oracle] ❌ Parlay leg ${legId} live with no minute data — fail-closed`);
                  return res.status(400).json({ success: false, message: "Cannot verify match time for a parlay leg" });
                }
                if (legLookup.minute >= 85) {
                  console.log(`[Oracle] ❌ Parlay leg past 85-minute cutoff: ${legId}`);
                  return res.status(400).json({ success: false, message: "A parlay leg match is in the final minutes" });
                }
              }
              if (legLookup.shouldBeLive && legLookup.source !== 'live') {
                console.log(`[Oracle] ❌ Parlay leg already started: ${legId}`);
                return res.status(400).json({ success: false, message: "A parlay leg match has already started" });
              }
            }
            if (!legFound) {
              const legFree = freeSportsService.lookupEvent(legId);
              if (legFree.found) {
                legFound = true;
                if (legFree.shouldBeLive) {
                  console.log(`[Oracle] ❌ Parlay leg already started: ${legId}`);
                  return res.status(400).json({ success: false, message: "A parlay leg match has already started" });
                }
              }
            }
            if (!legFound) {
              const legEsports = esportsService.lookupEvent(legId);
              if (legEsports.found) {
                legFound = true;
                const evtStart = legEsports.event?.startTime ? new Date(legEsports.event.startTime) : null;
                if (evtStart && evtStart <= new Date()) {
                  console.log(`[Oracle] ❌ Parlay leg already started: ${legId}`);
                  return res.status(400).json({ success: false, message: "A parlay leg match has already started" });
                }
              }
            }
            if (!legFound) {
              console.log(`[Oracle] ❌ Parlay leg event not found: ${legId}`);
              allLegsValid = false;
              break;
            }
          }
          if (allLegsValid) {
            eventFound = true;
          }
        } else {
          console.log(`[Oracle] ❌ Parlay has fewer than 2 legs: ${eventIdStr}`);
          return res.status(400).json({ success: false, message: "Parlay must have at least 2 legs" });
        }
      }

      let isLiveEvent = false;
      let liveScore: string | undefined;

      if (!eventFound) {
        const footballLookup = apiSportsService.lookupEventSync(eventIdStr);
        if (footballLookup.found) {
          eventFound = true;
          isLiveEvent = footballLookup.source === 'live';
          if (isLiveEvent) {
            liveScore = `${footballLookup.homeScore ?? 0}-${footballLookup.awayScore ?? 0}`;
          }
          if (footballLookup.source === 'live') {
            if (footballLookup.minute === undefined || footballLookup.minute === null) {
              console.log(`[Oracle] ❌ Live match ${eventIdStr} has no minute data — fail-closed`);
              return res.status(400).json({ success: false, message: "Cannot verify match time - please try again" });
            }
            if (footballLookup.minute >= 85) {
              console.log(`[Oracle] ❌ Match ${eventIdStr} past 85-minute cutoff (minute: ${footballLookup.minute})`);
              return res.status(400).json({ success: false, message: "Betting closed — final minutes" });
            }
          }
          if (footballLookup.shouldBeLive && footballLookup.source !== 'live') {
            console.log(`[Oracle] ❌ Match ${eventIdStr} start time has passed but not in live API — rejecting`);
            return res.status(400).json({ success: false, message: "Match has already started" });
          }
        }
      }

      if (!eventFound) {
        const freeLookup = freeSportsService.lookupEvent(eventIdStr);
        if (freeLookup.found) {
          eventFound = true;
          if (freeLookup.shouldBeLive) {
            return res.status(400).json({ success: false, message: "Betting closes 5 minutes before match start" });
          }
        }
      }

      if (!eventFound) {
        const esportsLookup = esportsService.lookupEvent(eventIdStr);
        if (esportsLookup.found) {
          eventFound = true;
          const evtStart = esportsLookup.event?.startTime ? new Date(esportsLookup.event.startTime) : null;
          if (evtStart && evtStart.getTime() <= Date.now() + 5 * 60 * 1000) {
            return res.status(400).json({ success: false, message: "Betting closes 5 minutes before match start" });
          }
        }
      }

      if (!eventFound && isFuturesEvent(eventIdStr)) {
        const futuresOdds = lookupFuturesOdds(eventIdStr, prediction);
        if (futuresOdds !== null) {
          eventFound = true;
          const closing = new Date(WORLD_CUP_2026_FUTURES.closingDate);
          if (new Date() >= closing) {
            return res.status(400).json({ success: false, message: "Futures market is closed" });
          }
          console.log(`[Oracle] ✅ Futures event validated: ${eventIdStr}, prediction: ${prediction}, odds: ${futuresOdds}`);
        }
      }

      if (!eventFound) {
        console.log(`[Oracle] ❌ Refused to sign unknown event: ${eventIdStr}`);
        return res.status(400).json({ success: false, message: "Event not found in system" });
      }

      const isParlay = eventIdStr.startsWith('parlay_');
      const isFutures = isFuturesEvent(eventIdStr);
      const effectiveOddsCap = isFutures ? MAX_ODDS_CAP_FUTURES : MAX_ODDS_CAP;
      if (!isParlay && submittedOddsDecimal > effectiveOddsCap) {
        console.log(`❌ ORACLE SIGN BLOCKED (max odds cap): oddsBps=${oddsBps} (${submittedOddsDecimal}x) > ${effectiveOddsCap}x, event=${eventIdStr}`);
        return res.status(400).json({ success: false, message: `Maximum odds allowed is ${effectiveOddsCap}x. Please choose a different selection.` });
      }
      if (!isParlay && !isFutures) {
        if (isLiveEvent && liveScore) {
          const liveOddsCheck = apiSportsService.getOddsFromCacheLive(eventIdStr, liveScore);
          if (liveOddsCheck && liveOddsCheck.stale) {
            console.log(`❌ ORACLE SIGN BLOCKED (live odds stale): ${liveOddsCheck.reason}, event=${eventIdStr}, wallet=${walletAddress.slice(0,12)}...`);
            apiSportsService.invalidateOddsForEvent(eventIdStr);
            return res.status(400).json({ success: false, message: "Odds have changed due to in-game action. Please refresh and try again." });
          }
        }

        const oddsCheck = lookupServerOdds(eventIdStr, prediction, '');
        if (oddsCheck.found && oddsCheck.serverOdds && oddsCheck.maxAllowedOdds) {
          if (submittedOddsDecimal > oddsCheck.maxAllowedOdds) {
            console.log(`❌ ORACLE SIGN BLOCKED (odds inflation): submitted=${submittedOddsDecimal}, server=${oddsCheck.serverOdds}, max=${oddsCheck.maxAllowedOdds}, event=${eventIdStr}, wallet=${walletAddress.slice(0,12)}...`);
            return res.status(400).json({ success: false, message: "Odds have changed. Please refresh and try again." });
          }
        } else if (oddsCheck.source && oddsCheck.source !== 'api-sports-no-odds') {
          console.log(`❌ ORACLE SIGN BLOCKED (unverifiable): event ${eventIdStr} found (${oddsCheck.source}) but selection unmappable, oddsBps=${oddsBps}`);
          return res.status(400).json({ success: false, message: "Unable to verify odds. Please refresh and try again." });
        } else {
          const conservativeMaxBps = 300; // 3.0x max when no reference odds
          if (oddsBps > conservativeMaxBps) {
            console.log(`❌ ORACLE SIGN BLOCKED (conservative cap): oddsBps=${oddsBps} > ${conservativeMaxBps}, event=${eventIdStr}`);
            return res.status(400).json({ success: false, message: "Odds appear unusually high. Please refresh and try again." });
          }
        }
      } else if (isFutures) {
        const futuresOddsVerify = lookupFuturesOdds(eventIdStr, prediction);
        if (futuresOddsVerify !== null) {
          const expectedBps = Math.floor(futuresOddsVerify * 100);
          const toleranceBps = Math.floor(expectedBps * ODDS_TOLERANCE);
          if (oddsBps > expectedBps + toleranceBps) {
            console.log(`❌ ORACLE SIGN BLOCKED (futures odds inflation): submitted=${oddsBps}, expected=${expectedBps}, max=${expectedBps + toleranceBps}, event=${eventIdStr}`);
            return res.status(400).json({ success: false, message: "Futures odds have changed. Please refresh and try again." });
          }
        }
      } else {
        const parlayMaxCombined = 15;
        if (submittedOddsDecimal > parlayMaxCombined) {
          console.log(`❌ ORACLE SIGN BLOCKED (parlay cap): oddsBps=${oddsBps} (${submittedOddsDecimal}x) > ${parlayMaxCombined}x, event=${eventIdStr}`);
          return res.status(400).json({ success: false, message: "Parlay odds exceed maximum allowed (15x). Please reduce your selections." });
        }
      }

      const result = await oracleSigningService.signBetQuote(eventId, oddsBps, walletAddress, prediction);
      if (!result) {
        return res.status(500).json({ success: false, message: "Failed to sign quote" });
      }

      walletData.timestamps.push(now);
      walletData.count = walletData.timestamps.length;
      eventData.timestamps.push(now);
      eventData.count = eventData.timestamps.length;
      console.log(`✅ ORACLE SIGNED: wallet=${walletKey.slice(0, 12)}... event=${String(eventId).slice(0, 20)} (${walletData.count}/${ORACLE_MAX_SIGNS_PER_DAY} daily)`);

      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("Oracle sign error:", err.message, err.stack);
      res.status(500).json({ success: false, message: `Oracle signing failed: ${err.message || 'unknown error'}` });
    }
  });

  app.get("/api/treasury/status", async (req: Request, res: Response) => {
    try {
      const platformInfo = await blockchainBetService.getPlatformInfo();
      if (!platformInfo) {
        return res.status(503).json({ 
          success: false, 
          message: "Unable to fetch treasury status" 
        });
      }

      const isAdmin = await validateAdminAuth(req);

      if (isAdmin) {
        const allBets = await storage.getAllBets();
        const activeBets = allBets.filter((b: any) => 
          b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_play' || b.status === 'open'
        );
        const realLiabilitySui = activeBets
          .filter((b: any) => b.currency === 'SUI')
          .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
        const realLiabilitySbets = activeBets
          .filter((b: any) => b.currency === 'SBETS')
          .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
        
        const suiAvailable = platformInfo.treasuryBalanceSui - realLiabilitySui;
        const sbetsAvailable = platformInfo.treasuryBalanceSbets - realLiabilitySbets;
        
        return res.json({
          success: true,
          sui: {
            treasury: platformInfo.treasuryBalanceSui,
            liability: realLiabilitySui,
            available: suiAvailable,
            acceptingBets: true
          },
          sbets: {
            treasury: platformInfo.treasuryBalanceSbets,
            liability: realLiabilitySbets,
            available: sbetsAvailable,
            acceptingBets: true
          },
          paused: platformInfo.paused,
          onChainLiability: {
            sui: platformInfo.totalLiabilitySui,
            sbets: platformInfo.totalLiabilitySbets,
          },
          fullPlatformInfo: {
            treasurySui: platformInfo.treasuryBalanceSui,
            treasurySbets: platformInfo.treasuryBalanceSbets,
            treasuryUsdsui: platformInfo.treasuryBalanceUsdsui || 0,
            totalVolumeSui: platformInfo.totalVolumeSui,
            totalVolumeSbets: platformInfo.totalVolumeSbets,
            totalVolumeUsdsui: platformInfo.totalVolumeUsdsui || 0,
            totalPotentialLiabilitySui: platformInfo.totalLiabilitySui,
            totalPotentialLiabilitySbets: platformInfo.totalLiabilitySbets,
            realLiabilitySui,
            realLiabilitySbets,
            realLiabilityUsdsui: activeBets
              .filter((b: any) => b.currency === 'USDSUI')
              .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0),
            accruedFeesSui: platformInfo.accruedFeesSui,
            accruedFeesSbets: platformInfo.accruedFeesSbets,
            accruedFeesUsdsui: platformInfo.accruedFeesUsdsui || 0,
            platformFeeBps: platformInfo.platformFeeBps,
            totalBets: platformInfo.totalBets,
            paused: platformInfo.paused,
            minBetSui: platformInfo.minBetSui,
            maxBetSui: platformInfo.maxBetSui,
            minBetSbets: platformInfo.minBetSbets,
            maxBetSbets: platformInfo.maxBetSbets,
          }
        });
      }

      const onChainAvailableSui = Math.max(0, platformInfo.treasuryBalanceSui - platformInfo.totalLiabilitySui);
      const onChainAvailableSbets = Math.max(0, platformInfo.treasuryBalanceSbets - platformInfo.totalLiabilitySbets);

      res.json({
        success: true,
        sui: { 
          acceptingBets: onChainAvailableSui > 0,
          available: onChainAvailableSui
        },
        sbets: { 
          acceptingBets: onChainAvailableSbets > 0,
          available: onChainAvailableSbets
        },
        paused: platformInfo.paused
      });
    } catch (error) {
      console.error('Treasury status error:', error);
      res.status(500).json({ success: false, message: "Failed to fetch treasury status" });
    }
  });

  // Sports routes
  app.get("/api/sports", async (req: Request, res: Response) => {
    try {
      const sports = await storage.getSports();
      res.json(sports);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sports" });
    }
  });

  app.get("/api/futures", async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const closing = new Date(WORLD_CUP_2026_FUTURES.closingDate);
      const isOpen = now < closing;
      res.json({
        ...WORLD_CUP_2026_FUTURES,
        status: isOpen ? 'open' : 'closed',
        timeUntilClose: isOpen ? closing.getTime() - now.getTime() : 0
      });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch futures' });
    }
  });

  app.get("/api/futures/world-cup-2026", async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const closing = new Date(WORLD_CUP_2026_FUTURES.closingDate);
      const isOpen = now < closing;
      res.json({
        ...WORLD_CUP_2026_FUTURES,
        status: isOpen ? 'open' : 'closed',
        timeUntilClose: isOpen ? closing.getTime() - now.getTime() : 0
      });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch World Cup futures' });
    }
  });

  app.get("/api/events/check/:eventId", async (req: Request, res: Response) => {
    try {
      const rawEventId = req.params.eventId;
      const idsToTry: string[] = [rawEventId];
      if (rawEventId.startsWith('sync_')) {
        const cleaned = rawEventId.replace(/^sync_0x[a-fA-F0-9]+_/, '');
        if (cleaned && cleaned !== rawEventId) idsToTry.push(cleaned);
      }
      if (/^\d+$/.test(rawEventId)) {
        const sportPrefixes = ['basketball', 'ice-hockey', 'baseball', 'handball', 'rugby', 'volleyball', 'mma', 'american-football', 'afl', 'formula-1', 'boxing', 'esports', 'cricket', 'wwe'];
        for (const prefix of sportPrefixes) {
          idsToTry.push(`${prefix}_${rawEventId}`);
        }
      }

      for (const eventId of idsToTry) {
        const lookup = apiSportsService.lookupEventSync(eventId);
        if (lookup.found) {
          const isAvailable = lookup.source === 'upcoming' || (lookup.isLive && lookup.minute !== undefined && lookup.minute < 85);
          return res.json({
            available: isAvailable,
            isLive: lookup.isLive,
            source: lookup.source,
            homeTeam: lookup.homeTeam,
            awayTeam: lookup.awayTeam,
            startTime: lookup.startTime,
            shouldBeLive: lookup.shouldBeLive,
          });
        }
        const freeLookup = freeSportsService.lookupEvent(eventId);
        if (freeLookup.found && freeLookup.event) {
          const now = new Date();
          const eventStart = freeLookup.event.startTime ? new Date(freeLookup.event.startTime) : null;
          const hasStarted = eventStart ? eventStart <= now : false;
          return res.json({
            available: !hasStarted,
            isLive: false,
            source: 'free',
            homeTeam: freeLookup.event.homeTeam,
            awayTeam: freeLookup.event.awayTeam,
            startTime: freeLookup.event.startTime,
            shouldBeLive: hasStarted,
          });
        }
        const esportsLookup = esportsService.lookupEvent(eventId);
        if (esportsLookup.found && esportsLookup.event) {
          const now = new Date();
          const eventStart = esportsLookup.event.startTime ? new Date(esportsLookup.event.startTime) : null;
          const hasStarted = eventStart ? eventStart <= now : false;
          return res.json({
            available: !hasStarted,
            isLive: false,
            source: 'esports',
            homeTeam: esportsLookup.event.homeTeam,
            awayTeam: esportsLookup.event.awayTeam,
            startTime: esportsLookup.event.startTime,
            shouldBeLive: hasStarted,
          });
        }
      }
      return res.json({ available: false });
    } catch (error) {
      return res.json({ available: false });
    }
  });

  // Events route with multi-source fallback logic
  app.get("/api/events", async (req: Request, res: Response) => {
    try {
      let reqSportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      const isLive = req.query.isLive ? req.query.isLive === 'true' : undefined;
      
      console.log(`Fetching events for sportId: ${reqSportId}, isLive: ${isLive}`);
      
      // FAST PATH: Esports events (sportId=9) - return directly from cache, no football enrichment needed
      if (reqSportId === 9) {
        const esportsEvents = esportsService.getUpcomingEvents();
        const now = Date.now();
        const filtered = esportsEvents.filter(e => {
          if (!e.startTime) return false;
          return new Date(e.startTime).getTime() > now;
        });
        console.log(`⚡ FAST PATH: Returning ${filtered.length} esports events directly from cache (filtered from ${esportsEvents.length})`);
        return res.json(await sanitizeWithFavourites(filtered));
      }
      
      // FAST PATH: Free sports (non-football, non-esports) - return from daily cache
      // IDs match DB sport table: 2=Basketball,3=Tennis,4=Baseball,5=Baseball,6=Ice Hockey,
      // 7=MMA,8=Boxing,9=Esports,10=AFL,11=Formula 1,12=Handball,13=NBA,14=NFL,15=Rugby,16=Volleyball,17=Horse Racing
      // 18=Cricket,19=MotoGP,20=WWE,21=Darts,22=Snooker,23=Table Tennis,24=Water Polo,25=Badminton,26=Chess,27=Armwrestling
      const FREE_SPORT_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
      if (reqSportId && FREE_SPORT_IDS.includes(reqSportId) && isLive !== true) {
        const freeSportsEvents = freeSportsService.getUpcomingEvents();
        const now = Date.now();
        const filtered = freeSportsEvents
          .filter(e => Number(e.sportId) === reqSportId)
          .filter(e => {
            if (!e.startTime) return false;
            const startMs = new Date(e.startTime).getTime();
            if (isNaN(startMs)) return false;
            return startMs > now;
          });
        console.log(`⚡ FAST PATH: Returning ${filtered.length} free sport events (sportId=${reqSportId}) from daily cache`);
        return res.json(await sanitizeWithFavourites(filtered));
      }
      
      // Get data from API for any sport if it's live - PAID API ONLY, NO FALLBACKS
      if (isLive === true) {
        
        try {
          const sportsToFetch = getLiveSportsToFetch();
          
          const sportPromises = sportsToFetch.map(sport =>
            apiSportsService.getLiveEvents(sport).catch(e => {
              return [];
            })
          );
          
          const sportResults = await Promise.all(sportPromises);
          const allLiveEventsRaw = sportResults.flat();
          
          // Deduplicate events by ID to prevent repeated matches
          const seenLiveIds = new Set<string>();
          let allLiveEvents = allLiveEventsRaw.filter(event => {
            const eventId = String(event.id);
            if (seenLiveIds.has(eventId)) return false;
            seenLiveIds.add(eventId);
            return true;
          });
          
          console.log(`✅ LIVE: Fetched ${allLiveEvents.length} unique events (${allLiveEventsRaw.length} before dedup, ${sportsToFetch.length} sports)`);
          
          // Enrich events with real odds from API-Sports (football only for now)
          // Pass isLive=true to always fetch fresh odds for live events
          try {
            allLiveEvents = await apiSportsService.enrichEventsWithOdds(allLiveEvents, 'football', true);
            console.log(`✅ LIVE: Enriched events with real odds`);
          } catch (oddsError: any) {
            console.warn(`⚠️ LIVE: Failed to enrich with odds: ${oddsError.message}`);
          }
          
          // Log odds coverage stats but DON'T filter - show all events
          const eventsWithOdds = allLiveEvents.filter(e => (e as any).oddsSource === 'api-sports').length;
          console.log(`✅ LIVE: ${eventsWithOdds}/${allLiveEvents.length} events have real bookmaker odds`);
          
          // CRITICAL: Save successful results to snapshot (before any filtering)
          if (allLiveEvents.length > 0) {
            saveLiveSnapshot(allLiveEvents);
          }
          
          // Sort by startTime (earliest first, events without startTime go to end)
          allLiveEvents.sort((a, b) => {
            const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
            const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
            return timeA - timeB;
          });
          
          // Filter by sport if requested
          if (reqSportId && allLiveEvents.length > 0) {
            const filtered = allLiveEvents.filter(e => Number(e.sportId) === reqSportId);
            console.log(`Filtered to ${filtered.length} events for sport ID ${reqSportId}`);
            return res.json(await sanitizeWithFavourites(filtered.length > 0 ? filtered : []));
          }
          
          // Return all live events (may be empty if API-Sports fails)
          return res.json(await sanitizeWithFavourites(allLiveEvents));
        } catch (error) {
          console.error(`❌ LIVE API fetch failed:`, error);
          // CRITICAL: On error, try to return snapshot instead of empty
          const snapshot = getLiveSnapshot();
          if (snapshot.events.length > 0) {
            const ageSeconds = Math.round((Date.now() - snapshot.timestamp) / 1000);
            console.log(`⚠️ LIVE: Error occurred, using snapshot of ${snapshot.events.length} events (${ageSeconds}s old)`);
            return res.json(await sanitizeWithFavourites(snapshot.events));
          }
          return res.json([]);
        }
      }
      
      // UPCOMING EVENTS MODE - PAID API ONLY, NO FALLBACKS
      console.log(`📅 UPCOMING EVENTS MODE - Paid API-Sports ONLY (NO fallbacks, NO free alternatives)`);
      try {
        // CRITICAL: Check for existing snapshot first - if we have data, return it immediately
        // This prevents rate limiting and ensures users always see events
        const existingSnapshot = getUpcomingSnapshot();
        const snapshotAgeMs = Date.now() - existingSnapshot.timestamp;
        const SNAPSHOT_FRESH_DURATION = 10 * 60 * 1000; // 10 minutes (AGGRESSIVE API SAVING)
        
        if (existingSnapshot.events.length > 0 && snapshotAgeMs < SNAPSHOT_FRESH_DURATION) {
          console.log(`📦 Using fresh snapshot (${existingSnapshot.events.length} events, ${Math.round(snapshotAgeMs/1000)}s old)`);
          let allUpcomingEvents = [...existingSnapshot.events];
          
          // CRITICAL: ALWAYS add free sports events from daily cache
          // These are Basketball, Baseball, Hockey, MMA, AFL, Formula 1, Handball, NBA, NFL, Rugby, Volleyball
          try {
            const freeSportsEvents = freeSportsService.getUpcomingEvents();
            if (freeSportsEvents.length > 0) {
              const existingIds = new Set(allUpcomingEvents.map(e => String(e.id)));
              const newFreeSportsEvents = freeSportsEvents.filter(e => !existingIds.has(String(e.id)));
              allUpcomingEvents.push(...newFreeSportsEvents);
              console.log(`📦 Added ${newFreeSportsEvents.length} sports events (${freeSportsEvents.length} total in cache)`);
            }
          } catch (e) {
            console.log(`📦 Sports cache empty`);
          }
          
          try {
            const esportsEvents = esportsService.getUpcomingEvents();
            if (esportsEvents.length > 0) {
              const existingIds = new Set(allUpcomingEvents.map(e => String(e.id)));
              const newEsportsEvents = esportsEvents.filter(e => !existingIds.has(String(e.id)));
              allUpcomingEvents.push(...newEsportsEvents);
              console.log(`📦 Added ${newEsportsEvents.length} esports events (LoL + Dota 2)`);
            }
          } catch (e) {
            console.log(`📦 Esports cache empty`);
          }
          
          // CRITICAL: Apply cached odds from prefetcher to snapshot events
          // This ensures odds are updated as the prefetcher warms the cache
          try {
            allUpcomingEvents = await apiSportsService.enrichEventsWithCachedOddsOnly(allUpcomingEvents, 'football');
            const oddsCount = allUpcomingEvents.filter(e => (e as any).oddsSource === 'api-sports').length;
            console.log(`📦 Applied cached odds: ${oddsCount}/${allUpcomingEvents.length} events have odds`);
          } catch (e) {
            console.log(`📦 Could not apply cached odds`);
          }
          
          // Sort by startTime
          allUpcomingEvents.sort((a, b) => {
            const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
            const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
            return timeA - timeB;
          });
          
          // Filter out started events - football moves to live tab, free sports have no live mode so remove them
          const now = Date.now();
          allUpcomingEvents = allUpcomingEvents.filter(e => {
            if (!e.startTime) return false;
            const startMs = new Date(e.startTime).getTime();
            if (isNaN(startMs)) return false;
            return startMs > now;
          });
          
          // Filter by sport if requested
          if (reqSportId && allUpcomingEvents.length > 0) {
            const filtered = allUpcomingEvents.filter(e => Number(e.sportId) === reqSportId);
            console.log(`Filtered to ${filtered.length} events for sport ID ${reqSportId}`);
            return res.json(await sanitizeWithFavourites(filtered));
          }
          
          return res.json(await sanitizeWithFavourites(allUpcomingEvents));
        }
        
        // Fetch football FIRST (main source of events) then others sequentially with delays
        console.log(`📍 Fetching events (football priority, sequential for rate limit protection)`);
        const allUpcomingEventsRaw: any[] = [];
        
        // Football first - this is where 99% of events come from
        try {
          const footballEvents = await apiSportsService.getUpcomingEvents('football');
          allUpcomingEventsRaw.push(...footballEvents);
          console.log(`✅ Football: ${footballEvents.length} events`);
        } catch (e: any) {
          console.log(`❌ Football failed: ${e.message}`);
        }
        
        try {
          const freeSportsEvents = freeSportsService.getUpcomingEvents();
          if (freeSportsEvents.length > 0) {
            allUpcomingEventsRaw.push(...freeSportsEvents);
            console.log(`✅ Free Sports: ${freeSportsEvents.length} events (from daily cache)`);
          }
        } catch (e: any) {
          console.log(`⚠️ Free Sports cache empty or error: ${e.message}`);
        }
        
        try {
          const esportsEvents = esportsService.getUpcomingEvents();
          if (esportsEvents.length > 0) {
            allUpcomingEventsRaw.push(...esportsEvents);
            console.log(`✅ Esports: ${esportsEvents.length} events (LoL + Dota 2)`);
          }
        } catch (e: any) {
          console.log(`⚠️ Esports cache empty or error: ${e.message}`);
        }
        
        // Deduplicate events by ID to prevent repeated matches
        const seenUpcomingIds = new Set<string>();
        let allUpcomingEvents = allUpcomingEventsRaw.filter(event => {
          const eventId = String(event.id);
          if (seenUpcomingIds.has(eventId)) return false;
          seenUpcomingIds.add(eventId);
          return true;
        });
        
        console.log(`✅ UPCOMING: Fetched ${allUpcomingEvents.length} unique events (${allUpcomingEventsRaw.length} before dedup, football only)`);
        
        // FAST PATH: Only apply pre-warmed odds from cache (no blocking API calls)
        // The background prefetcher handles warming the odds cache asynchronously
        try {
          // Use fast mode: only apply odds from cache, don't make new API calls
          allUpcomingEvents = await apiSportsService.enrichEventsWithCachedOddsOnly(allUpcomingEvents, 'football');
          console.log(`✅ UPCOMING: Applied cached odds (fast path)`);
        } catch (oddsError: any) {
          console.warn(`⚠️ UPCOMING: Failed to apply cached odds: ${oddsError.message}`);
        }
        
        // Log odds coverage stats but DON'T filter - show all events
        const eventsWithOdds = allUpcomingEvents.filter(e => (e as any).oddsSource === 'api-sports').length;
        console.log(`✅ UPCOMING: ${eventsWithOdds}/${allUpcomingEvents.length} events have real bookmaker odds`);
        
        // CRITICAL: Save successful results to snapshot (before any filtering)
        if (allUpcomingEvents.length > 0) {
          saveUpcomingSnapshot(allUpcomingEvents);
        } else {
          // If we got 0 events but have a snapshot, use it instead (NEVER return empty)
          const snapshot = getUpcomingSnapshot();
          if (snapshot.events.length > 0) {
            const ageSeconds = Math.round((Date.now() - snapshot.timestamp) / 1000);
            console.log(`⚠️ UPCOMING: Got 0 events, using snapshot of ${snapshot.events.length} events (${ageSeconds}s old)`);
            allUpcomingEvents = snapshot.events;
          }
        }
        
        // Sort by startTime (earliest first, events without startTime go to end)
        allUpcomingEvents.sort((a, b) => {
          const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
          const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
          return timeA - timeB;
        });
        
        // Filter out events that have already started - all sports
        // Football moves to live tab, free sports have no live mode so they disappear
        const now = Date.now();
        const beforeFilter = allUpcomingEvents.length;
        allUpcomingEvents = allUpcomingEvents.filter(e => {
          if (!e.startTime) return false;
          const startMs = new Date(e.startTime).getTime();
          if (isNaN(startMs)) return false;
          return startMs > now;
        });
        if (beforeFilter !== allUpcomingEvents.length) {
          console.log(`📦 Filtered out ${beforeFilter - allUpcomingEvents.length} already-started events from upcoming`);
        }
        
        // Filter by sport if requested
        if (reqSportId && allUpcomingEvents.length > 0) {
          const filtered = allUpcomingEvents.filter(e => Number(e.sportId) === reqSportId);
          console.log(`Filtered to ${filtered.length} events for sport ID ${reqSportId}`);
          return res.json(await sanitizeWithFavourites(filtered.length > 0 ? filtered : []));
        }
        
        // Return all upcoming events (guaranteed non-empty if we ever had data)
        return res.json(await sanitizeWithFavourites(allUpcomingEvents));
      } catch (error) {
        console.error(`❌ UPCOMING API fetch failed:`, error);
        // CRITICAL: On error, try to return snapshot instead of empty
        const snapshot = getUpcomingSnapshot();
        if (snapshot.events.length > 0) {
          const ageSeconds = Math.round((Date.now() - snapshot.timestamp) / 1000);
          console.log(`⚠️ UPCOMING: Error occurred, using snapshot of ${snapshot.events.length} events (${ageSeconds}s old)`);
          return res.json(await sanitizeWithFavourites(snapshot.events));
        }
        return res.json([]);
      }
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  
  // Get settled/completed match results with scores
  app.get("/api/events/results", async (req: Request, res: Response) => {
    try {
      const period = req.query.period as string || 'week';
      const sportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      
      // Calculate date range
      let startDate = new Date();
      if (period === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (period === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else if (period === 'month') {
        startDate.setDate(startDate.getDate() - 30);
      }
      
      // Query settled_events joined with events table for sport/league info
      const queryResult = await db.execute(sql`
        SELECT 
          se.id,
          se.external_event_id,
          se.home_team,
          se.away_team,
          se.home_score,
          se.away_score,
          se.winner,
          se.settled_at,
          se.bets_settled,
          e.sport_id,
          e.league_name
        FROM settled_events se
        LEFT JOIN events e ON (
          se.external_event_id = CAST(e.id AS TEXT)
          OR se.external_event_id = e.provider_id
        )
        WHERE se.settled_at >= ${startDate.toISOString()}
        ORDER BY se.settled_at DESC
        LIMIT 200
      `);
      
      // Handle different result formats from db.execute
      const rows = Array.isArray(queryResult) ? queryResult : (queryResult.rows || []);
      
      // Detect sport from external_event_id prefix or events table
      function detectSport(extId: string, dbSportId: number | null): { sportId: number; sport: string } {
        if (dbSportId) {
          const sportNames: Record<number, string> = {
            1: 'Football', 2: 'Basketball', 3: 'Tennis', 4: 'American Football',
            5: 'Baseball', 6: 'Ice Hockey', 7: 'MMA', 8: 'Boxing',
            9: 'Cricket', 10: 'AFL', 11: 'Esports', 12: 'Handball',
            13: 'Formula 1', 14: 'Cycling', 15: 'Rugby', 16: 'Volleyball',
            17: 'Horse Racing', 18: 'Cricket', 26: 'Soccer'
          };
          return { sportId: dbSportId, sport: sportNames[dbSportId] || `Sport ${dbSportId}` };
        }
        const eid = (extId || '').toLowerCase();
        if (eid.startsWith('basketball_api_') || eid.startsWith('basketball_')) return { sportId: 2, sport: 'Basketball' };
        if (eid.startsWith('tennis_api_') || eid.startsWith('tennis_')) return { sportId: 3, sport: 'Tennis' };
        if (eid.startsWith('american-football_api_') || eid.startsWith('nfl_api_')) return { sportId: 4, sport: 'American Football' };
        if (eid.startsWith('baseball_api_') || eid.startsWith('baseball_')) return { sportId: 5, sport: 'Baseball' };
        if (eid.startsWith('hockey_api_') || eid.startsWith('ice-hockey_api_') || eid.startsWith('ice-hockey_')) return { sportId: 6, sport: 'Ice Hockey' };
        if (eid.startsWith('mma_api_') || eid.startsWith('ufc_api_') || eid.startsWith('mma_')) return { sportId: 7, sport: 'MMA' };
        if (eid.startsWith('boxing_api_') || eid.startsWith('boxing_')) return { sportId: 8, sport: 'Boxing' };
        if (eid.startsWith('cricket_api_') || eid.startsWith('cricket_')) return { sportId: 9, sport: 'Cricket' };
        if (eid.startsWith('afl_api_') || eid.startsWith('afl_')) return { sportId: 10, sport: 'AFL' };
        if (eid.startsWith('esports_api_') || eid.startsWith('esports_')) return { sportId: 11, sport: 'Esports' };
        if (eid.startsWith('handball_api_') || eid.startsWith('handball_')) return { sportId: 12, sport: 'Handball' };
        if (eid.startsWith('formula1_api_') || eid.startsWith('f1_api_')) return { sportId: 13, sport: 'Formula 1' };
        if (eid.startsWith('cycling_api_') || eid.startsWith('cycling_')) return { sportId: 14, sport: 'Cycling' };
        if (eid.startsWith('rugby_api_') || eid.startsWith('rugby_')) return { sportId: 15, sport: 'Rugby' };
        if (eid.startsWith('volleyball_api_') || eid.startsWith('volleyball_')) return { sportId: 16, sport: 'Volleyball' };
        if (eid.startsWith('horse-racing_api_') || eid.startsWith('horseracing_')) return { sportId: 17, sport: 'Horse Racing' };
        return { sportId: 1, sport: 'Football' };
      }
      
      const formattedResults = (rows as any[]).map(row => {
        const { sportId: detectedSportId, sport } = detectSport(row.external_event_id, row.sport_id);
        return {
          id: row.id,
          externalEventId: row.external_event_id,
          homeTeam: row.home_team,
          awayTeam: row.away_team,
          homeScore: row.home_score,
          awayScore: row.away_score,
          winner: row.winner,
          settledAt: row.settled_at,
          betsSettled: row.bets_settled,
          sportId: detectedSportId,
          sport,
          status: 'FINAL',
          startTime: row.settled_at,
          league: row.league_name || sport
        };
      });
      
      const sportConfigMap = freeSportsService.getSportConfigMap();
      let cachedApiResults = freeSportsService.getCachedResults();
      if (cachedApiResults.length === 0) {
        try {
          cachedApiResults = await freeSportsService.fetchAllResults();
        } catch (e) {
          console.error('[results] Failed to fetch fresh API results:', e);
        }
      }
      const settledIds = new Set(formattedResults.map((r: any) => r.externalEventId));
      
      const apiResults = cachedApiResults
        .filter(r => !settledIds.has(r.eventId))
        .map((r, idx) => {
          const prefix = r.eventId.split('_api_')[0] || '';
          const config = sportConfigMap[prefix] || sportConfigMap[prefix.replace('-', '')] || null;
          const sportId = config?.sportId || 1;
          const sport = config?.name || 'Football';
          return {
            id: 10000 + idx,
            externalEventId: r.eventId,
            homeTeam: r.homeTeam,
            awayTeam: r.awayTeam,
            homeScore: r.homeScore,
            awayScore: r.awayScore,
            winner: r.winner,
            settledAt: new Date().toISOString(),
            betsSettled: 0,
            sportId,
            sport,
            status: 'FINAL',
            startTime: new Date().toISOString(),
            league: sport
          };
        });
      
      const allResults = [...formattedResults, ...apiResults];
      console.log(`[results] Returning ${allResults.length} total (${formattedResults.length} settled + ${apiResults.length} from API cache)`);
      res.json(allResults);
    } catch (error) {
      console.error("Error fetching results:", error);
      res.status(500).json({ message: "Failed to fetch results" });
    }
  });

  app.get("/api/free-sports/results", async (req: Request, res: Response) => {
    try {
      let cached = freeSportsService.getCachedResults();
      if (cached.length === 0) {
        console.log('[results] No cached results, triggering fresh fetch...');
        cached = await freeSportsService.fetchAllResults();
      }
      const sportConfigMap = freeSportsService.getSportConfigMap();
      const formatted = cached.map((r, idx) => {
        const prefix = r.eventId.split('_api_')[0] || '';
        const config = sportConfigMap[prefix] || null;
        return {
          id: 20000 + idx,
          externalEventId: r.eventId,
          homeTeam: r.homeTeam,
          awayTeam: r.awayTeam,
          homeScore: r.homeScore,
          awayScore: r.awayScore,
          winner: r.winner,
          settledAt: new Date().toISOString(),
          betsSettled: 0,
          sportId: config?.sportId || 1,
          sport: config?.name || 'Football',
          status: 'FINAL',
          startTime: new Date().toISOString(),
          league: config?.name || 'Football'
        };
      });
      res.json(formatted);
    } catch (error) {
      console.error("Error fetching free sports results:", error);
      res.status(500).json({ message: "Failed to fetch free sports results" });
    }
  });

  // FREE SPORTS endpoints (basketball, baseball, hockey, MMA, NFL)
  // These use free API tier - fetched once/day, no live betting
  app.get("/api/free-sports/status", async (req: Request, res: Response) => {
    try {
      const status = freeSportsService.getCacheStatus();
      res.json({
        success: true,
        ...status,
        supportedSports: freeSportsService.getSupportedSports(),
        note: "Sports update every 2h (Ultra plan). Live betting available."
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to get free sports status" });
    }
  });

  app.post("/api/admin/free-sports/refresh", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      console.log('[Admin] Force refreshing sports data...');
      const events = await freeSportsService.forceRefresh();
      const sportBreakdown: Record<string, number> = {};
      for (const e of events) {
        const prefix = String(e.id).split('_')[0] || 'unknown';
        sportBreakdown[prefix] = (sportBreakdown[prefix] || 0) + 1;
      }
      res.json({ success: true, totalEvents: events.length, sportBreakdown });
    } catch (error: any) {
      console.error('[Admin] Free sports refresh error:', error.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get("/api/events/counts", async (req: Request, res: Response) => {
    try {
      const counts: Record<number, number> = {};
      const seen = new Set<string>();
      const now = Date.now();

      const addEvent = (e: any) => {
        if (e.startTime && new Date(e.startTime).getTime() <= now) return;
        const key = String(e.id);
        if (seen.has(key)) return;
        seen.add(key);
        counts[e.sportId] = (counts[e.sportId] || 0) + 1;
      };

      const freeSportsEvents = freeSportsService.getUpcomingEvents();
      freeSportsEvents.forEach(addEvent);

      const esportsEvents = esportsService.getUpcomingEvents();
      esportsEvents.forEach(addEvent);

      const snapshot = getUpcomingSnapshot();
      if (snapshot.events.length > 0) {
        snapshot.events.forEach(addEvent);
      }

      res.json(counts);
    } catch (error) {
      res.json({});
    }
  });

  app.get("/api/free-sports/events", async (req: Request, res: Response) => {
    try {
      const sportSlug = req.query.sport as string | undefined;
      const events = await sanitizeWithFavourites(freeSportsService.getUpcomingEvents(sportSlug));
      res.json({
        success: true,
        count: events.length,
        events,
        note: "Upcoming matches from API-Sports Ultra plan"
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to get free sports events" });
    }
  });

  app.get("/api/events/cricket", async (req: Request, res: Response) => {
    try {
      const events = freeSportsService.getUpcomingEvents('cricket');
      res.json(await sanitizeWithFavourites(events));
    } catch (error) {
      res.status(500).json([]);
    }
  });

  // Redirect /api/events/live to /api/events?isLive=true
  app.get("/api/events/live", async (req: Request, res: Response) => {
    try {
      const sportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      const redirectUrl = `/api/events?isLive=true${sportId ? `&sportId=${sportId}` : ''}`;
      console.log(`Redirecting /api/events/live to ${redirectUrl}`);
      return res.redirect(302, redirectUrl);
    } catch (error) {
      console.error('Error in live events redirect:', error);
      res.status(500).json({ error: 'Failed to fetch live events' });
    }
  });

  // Live events lite endpoint - returns minimal event data for sidebars
  app.get("/api/events/live-lite", async (req: Request, res: Response) => {
    try {
      const sportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      console.log(`[live-lite] Fetching live events (sportId: ${sportId || 'all'})`);
      
      // Use the same logic as the main events endpoint but return lighter data
      const sportsToFetch = getLiveSportsToFetch();
      const allLiveEvents: any[] = [];
      
      await Promise.all(sportsToFetch.map(async (sport) => {
        try {
          const events = await apiSportsService.getLiveEvents(sport);
          if (events && events.length > 0) {
            allLiveEvents.push(...events);
          }
        } catch (err) {
          // Silently skip failed sport fetches
        }
      }));
      
      // Filter by sport if specified
      let filteredEvents = allLiveEvents;
      if (sportId) {
        filteredEvents = allLiveEvents.filter(e => Number(e.sportId) === Number(sportId));
      }
      
      // Sort by startTime (earliest first, events without startTime go to end)
      filteredEvents.sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        return timeA - timeB;
      });
      
      const liteEvents = filteredEvents.map(e => ({
        id: e.id,
        sportId: e.sportId,
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
        homeLogo: (e as any).homeLogo || '',
        awayLogo: (e as any).awayLogo || '',
        leagueLogo: (e as any).leagueLogo || '',
        homeScore: e.homeScore,
        awayScore: e.awayScore,
        score: (e as any).score,
        minute: (e as any).minute,
        displayMinute: (e as any).displayMinute,
        status: e.status,
        isLive: e.isLive,
        leagueName: e.leagueName,
        startTime: e.startTime,
        homeOdds: (e as any).homeOdds,
        awayOdds: (e as any).awayOdds,
        drawOdds: (e as any).drawOdds,
        oddsSource: (e as any).oddsSource,
        markets: (e as any).markets,
      }));
      
      res.json(await sanitizeWithFavourites(liteEvents));
    } catch (error) {
      console.error('Error in live-lite events:', error);
      res.json([]);
    }
  });
  
  // Get individual event by ID
  app.get("/api/events/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid event ID format" });
      }
      
      const event = await storage.getEvent(id);
      
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Create a copy with markets if needed
      const eventWithMarkets: any = {
        ...event,
        isLive: event.isLive || false,
        status: event.status || 'scheduled',
        name: `${event.homeTeam} vs ${event.awayTeam}`
      };
      
      // Check if event already has markets
      const hasMarkets = typeof eventWithMarkets.markets !== 'undefined' && 
                         Array.isArray(eventWithMarkets.markets) && 
                         eventWithMarkets.markets.length > 0;
      
      if (!hasMarkets) {
        const eHashStr = (event.homeTeam || '') + '|' + (event.awayTeam || '') + '|' + String(event.id || '');
        let ehash = 5381;
        for (let i = 0; i < eHashStr.length; i++) { ehash = ((ehash << 5) + ehash + eHashStr.charCodeAt(i)) | 0; }
        const eh1 = (Math.abs(ehash) % 1000) / 999;
        const eh2 = (Math.abs((ehash >> 4) ^ (ehash * 2654435761)) % 1000) / 999;
        const eh3 = (Math.abs((ehash >> 8) ^ (ehash * 2246822519)) % 1000) / 999;
        const defFav = Math.round((1.06 + eh2 * 0.12) * 100) / 100;
        const defUnd = Math.round((1.85 + eh3 * 0.25) * 100) / 100;
        const defDraw = Math.round((1.48 + ((eh2 + eh3) / 2) * 0.22) * 100) / 100;
        const homeIsFav = eh1 > 0.45;
        const defHome = homeIsFav ? defFav : defUnd;
        const defAway = homeIsFav ? defUnd : defFav;
        eventWithMarkets.markets = [
          {
            id: `market-${event.id}-1`,
            name: 'Match Result',
            status: 'open',
            marketType: '1X2',
            outcomes: [
              { id: `outcome-${event.id}-1-1`, name: event.homeTeam, odds: defHome, status: 'active' },
              { id: `outcome-${event.id}-1-2`, name: 'Draw', odds: defDraw, status: 'active' },
              { id: `outcome-${event.id}-1-3`, name: event.awayTeam, odds: defAway, status: 'active' }
            ]
          },
          {
            id: `market-${event.id}-2`,
            name: 'Over/Under 2.5 Goals',
            status: 'open',
            marketType: 'OVER_UNDER',
            outcomes: [
              { id: `outcome-${event.id}-2-1`, name: 'Over 2.5', odds: 1.95, status: 'active' },
              { id: `outcome-${event.id}-2-2`, name: 'Under 2.5', odds: 1.85, status: 'active' }
            ]
          }
        ];
      }
      
      res.json(eventWithMarkets);
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ message: "Failed to fetch event" });
    }
  });
  
  // Return the promotions from storage
  app.get("/api/promotions", async (req: Request, res: Response) => {
    try {
      const promotions = await storage.getPromotions();
      res.json(promotions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch promotions" });
    }
  });

  // Pre-flight validation for bet placement (checks 45-minute cutoff BEFORE on-chain tx)
  app.post("/api/bets/validate", async (req: Request, res: Response) => {
    try {
      const { eventId, isLive } = req.body;
      
      if (!eventId) {
        return res.status(400).json({ message: "Event ID required", code: "MISSING_EVENT_ID" });
      }
      
      const eventIdStr = String(eventId);
      
      // Check free sports events first (basketball_, mma_, baseball_, etc.)
      const freeSportsLookup = freeSportsService.lookupEvent(eventIdStr);
      if (freeSportsLookup.found) {
        if (freeSportsLookup.shouldBeLive) {
          console.log(`[validate] Free sport event ${eventIdStr} rejected: within 5-min pre-match cutoff (startTime: ${freeSportsLookup.event?.startTime})`);
          return res.status(400).json({
            message: "Betting closes 5 minutes before match start.",
            code: "MATCH_STARTED"
          });
        }
        return res.json({
          valid: true,
          eventId: eventIdStr,
          source: 'free_sports'
        });
      }
      
      const esportsValidation = esportsService.lookupEvent(eventIdStr);
      if (esportsValidation.found) {
        const evtStart = esportsValidation.event?.startTime ? new Date(esportsValidation.event.startTime) : null;
        if (evtStart && evtStart.getTime() <= Date.now() + 5 * 60 * 1000) {
          return res.status(400).json({
            message: "Betting closes 5 minutes before match start.",
            code: "MATCH_STARTED"
          });
        }
        return res.json({
          valid: true,
          eventId: eventIdStr,
          source: 'esports'
        });
      }
      
      // SERVER-SIDE VALIDATION: Check event status in paid API cache
      const eventLookup = apiSportsService.lookupEventSync(eventIdStr);
      
      if (!eventLookup.found) {
        return res.status(400).json({ 
          message: "Event not found - please refresh and try again",
          code: "EVENT_NOT_FOUND"
        });
      }
      
      // DYNAMIC CACHE AGE: Strict for live (60s), relaxed for upcoming (15min)
      const MAX_LIVE_CACHE_AGE_MS = 60 * 1000;
      const MAX_UPCOMING_CACHE_AGE_MS = 15 * 60 * 1000;
      const isEventLive = eventLookup.source === 'live';
      const maxCacheAge = isEventLive ? MAX_LIVE_CACHE_AGE_MS : MAX_UPCOMING_CACHE_AGE_MS;
      
      if (eventLookup.cacheAgeMs > maxCacheAge) {
        return res.status(400).json({ 
          message: isEventLive ? "Match data is stale - please refresh" : "Event data is stale - please refresh and try again",
          code: "STALE_EVENT_DATA"
        });
      }
      
      if (eventLookup.source === 'live') {
        if (eventLookup.minute === undefined || eventLookup.minute === null) {
          console.log(`[validate] Event ${eventId} rejected: live match with no minute data — fail-closed`);
          return res.status(400).json({ 
            message: "Cannot verify match time - please try again shortly.",
            code: "UNVERIFIABLE_MATCH_TIME"
          });
        }
        if (eventLookup.minute >= 85) {
          console.log(`[validate] Event ${eventId} rejected: ${eventLookup.minute} min >= 85 cutoff`);
          return res.status(400).json({ 
            message: `Betting closed — final minutes (${eventLookup.minute}').`,
            code: "MATCH_CUTOFF"
          });
        }
      }
      
      if (eventLookup.shouldBeLive && eventLookup.source !== 'live') {
        console.log(`[validate] Event ${eventId} rejected: startTime passed (${eventLookup.startTime}) but not in live cache`);
        return res.status(400).json({ 
          message: "This match has started - please check live matches instead",
          code: "MATCH_STARTED"
        });
      }
      
      // Event is valid for betting
      res.json({ 
        valid: true, 
        eventId,
        matchMinute: eventLookup.minute,
        source: eventLookup.source
      });
    } catch (error: any) {
      console.error("Error validating bet:", error);
      res.status(500).json({ message: "Validation failed", code: "SERVER_ERROR" });
    }
  });

  // Place a single bet
  app.post("/api/bets", async (req: Request, res: Response) => {
    try {
      console.log(`📥 Bet request: event=${req.body.eventId} wallet=${(req.body.walletAddress || '').slice(0,12)}... amount=${req.body.betAmount} currency=${req.body.currency}`);
      
      // Validate request
      const validation = validateRequest(PlaceBetSchema, req.body);
      if (!validation.valid) {
        console.log('❌ Validation failed:', validation.errors);
        return res.status(400).json({ 
          message: "Validation failed",
          errors: validation.errors 
        });
      }

      const data = validation.data!;
      const { eventName, homeTeam, awayTeam, marketId, outcomeId, odds, betAmount, currency, prediction, feeCurrency, paymentMethod, txHash, onChainBetId, status, isLive, matchMinute, walletAddress, useBonus, useFreeBet } = data;
      
      const resolvedWallet = walletAddress || (data.userId ? String(data.userId) : undefined);
      if (!isValidSuiWallet(resolvedWallet)) {
        return res.status(400).json({ message: "Valid Sui wallet address required to place a bet", code: "MISSING_WALLET" });
      }
      
      // ANTI-EXPLOIT: Wallet blocklist check (before lock to save resources)
      if (isWalletBlocked(resolvedWallet)) {
        console.log(`🚫 BLOCKED WALLET: Bet rejected from ${resolvedWallet.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }

      const eventOddsCap = isFuturesEvent(String(data.eventId)) ? MAX_ODDS_CAP_FUTURES : MAX_ODDS_CAP;
      if (odds > eventOddsCap) {
        console.log(`❌ ODDS CAP: submitted=${odds} > max ${eventOddsCap}, event=${data.eventId}, wallet=${resolvedWallet.slice(0,12)}...`);
        return res.status(400).json({
          message: `Maximum odds allowed is ${eventOddsCap}x. Please choose a different selection.`,
          code: "MAX_ODDS_EXCEEDED"
        });
      }
      const predLowerBet = String(prediction || '').toLowerCase().trim();
      const isDrawBetPlacement = predLowerBet === 'draw' || predLowerBet === 'x' || predLowerBet === 'tie';
      if (isDrawBetPlacement && odds > 5.00) {
        console.log(`❌ DRAW ODDS CAP: draw bet odds=${odds} > 5.00x, event=${data.eventId}, wallet=${resolvedWallet.slice(0,12)}...`);
        return res.status(400).json({
          message: `Maximum draw odds is 5.00x. Please refresh and try again.`,
          code: "DRAW_ODDS_EXCEEDED"
        });
      }

      // USDSUI: hard cap at $1 maximum bet (6-decimal stablecoin, low liquidity)
      if (currency === 'USDSUI' && betAmount > 1.0) {
        console.log(`❌ USDSUI BET CAP: ${betAmount} USDsui > $1.00 max, wallet=${resolvedWallet.slice(0,12)}...`);
        return res.status(400).json({
          message: 'Maximum USDsui bet is $1.00. USDsui bets are capped for platform safety.',
          code: 'USDSUI_MAX_BET_EXCEEDED'
        });
      }

      // USDSUI: hard cap on max payout of 4 USDsui per bet
      if (currency === 'USDSUI') {
        const usdsuiPotentialPayout = betAmount * (odds || 1);
        if (usdsuiPotentialPayout > 4.0) {
          console.log(`❌ USDSUI PAYOUT CAP: potential payout ${usdsuiPotentialPayout.toFixed(4)} USDsui > 4.00 max, odds=${odds}, wallet=${resolvedWallet.slice(0,12)}...`);
          return res.status(400).json({
            message: `Maximum payout for USDsui is 4.00 USDsui. Your bet of ${betAmount} USDsui at ${odds}x odds would pay ${usdsuiPotentialPayout.toFixed(2)} USDsui. Please choose lower odds or reduce your stake.`,
            code: 'USDSUI_MAX_PAYOUT_EXCEEDED'
          });
        }
      }

      if (txHash && typeof txHash === 'string' && txHash.length > 10) {
        const existingBet = await storage.getBetByTxHash(txHash);
        if (existingBet) {
          console.log(`⚡ Duplicate txHash detected (retry-safe): ${txHash.slice(0, 12)}... → returning existing bet ID ${existingBet.id}`);
          return res.status(200).json({ ...existingBet, duplicate: true });
        }
      }

      // ANTI-EXPLOIT: Acquire wallet lock to prevent race conditions
      // All DB checks + insert happen serially per wallet, preventing duplicate bets
      const lock = acquireWalletLock(resolvedWallet);
      return await lock.execute(async () => {

      const userId = resolvedWallet;
      const eventId = String(data.eventId);
      const sportName = typeof req.body.sportName === 'string' ? req.body.sportName : undefined;
      const marketTypeName = typeof req.body.marketType === 'string' ? req.body.marketType : undefined;
      
      const rawGiftWallet = typeof req.body.giftRecipientWallet === 'string' ? req.body.giftRecipientWallet.trim() : null;
      const giftRecipientWallet = rawGiftWallet && isValidSuiWallet(rawGiftWallet) ? rawGiftWallet : null;
      if (giftRecipientWallet) {
        if (giftRecipientWallet.toLowerCase() === resolvedWallet.toLowerCase()) {
          return res.status(400).json({ message: "Cannot gift a bet to yourself", code: "GIFT_SELF" });
        }
        console.log(`🎁 GIFT BET: ${resolvedWallet.slice(0,10)}... → ${giftRecipientWallet.slice(0,10)}...`);
      }

      // ANTI-EXPLOIT: Rate limiting - max 7 bets per 24 hours (DB-backed, survives restarts)
      // Skip rate limit & cooldown when txHash proves funds already moved on-chain
      // Blocking DB record after on-chain tx = lost bets (user pays but bet never recorded)
      const hasOnChainProof = !!(txHash && paymentMethod === 'wallet');
      const rateLimitKey = resolvedWallet;
      if (!hasOnChainProof && rateLimitKey && rateLimitKey.startsWith('0x')) {
        const rateLimitResult = await checkBetRateLimitDB(rateLimitKey);
        if (!rateLimitResult.allowed) {
          console.log(`❌ Daily bet limit hit for ${rateLimitKey.slice(0, 12)}... (7/7 used) [DB-enforced]`);
          return res.status(429).json({
            message: rateLimitResult.message,
            code: "RATE_LIMIT_EXCEEDED",
            dailyLimit: MAX_BETS_PER_DAY,
            remaining: 0
          });
        }
        console.log(`📊 Bet ${MAX_BETS_PER_DAY - (rateLimitResult.remaining || 0)}/${MAX_BETS_PER_DAY} for ${rateLimitKey.slice(0, 12)}... [DB-enforced]`);
      }

      // ANTI-EXPLOIT: Bet cooldown - 60 seconds between bets (DB-backed)
      if (!hasOnChainProof && rateLimitKey && rateLimitKey.startsWith('0x')) {
        const cooldownResult = await checkBetCooldownDB(rateLimitKey);
        if (!cooldownResult.allowed) {
          console.log(`❌ Cooldown active for ${rateLimitKey.slice(0, 12)}... (${cooldownResult.secondsLeft}s left)`);
          return res.status(429).json({
            message: `Please wait ${cooldownResult.secondsLeft} seconds before placing another bet.`,
            code: "BET_COOLDOWN"
          });
        }
      }

      // ANTI-EXPLOIT: Max 1 bet per event per wallet (DB-backed)
      if (rateLimitKey && rateLimitKey.startsWith('0x') && eventId) {
        const eventLimitResult = await checkEventBetLimitDB(rateLimitKey, String(eventId));
        if (!eventLimitResult.allowed) {
          console.log(`❌ Event bet limit hit for ${rateLimitKey.slice(0, 12)}... on event ${eventId} [DB-enforced]`);
          return res.status(400).json({
            message: eventLimitResult.message,
            code: "EVENT_BET_LIMIT"
          });
        }
      }

      // ANTI-EXPLOIT: Duplicate bet detection — same event + same prediction (permanent block)
      if (rateLimitKey && rateLimitKey.startsWith('0x') && eventId && prediction) {
        const dupResult = await checkDuplicateBetDB(rateLimitKey, String(eventId), String(prediction));
        if (!dupResult.allowed) {
          console.log(`❌ Duplicate bet blocked for ${rateLimitKey.slice(0, 12)}... on event ${eventId} prediction="${prediction}"`);
          return res.status(400).json({
            message: dupResult.message,
            code: "DUPLICATE_BET"
          });
        }
      }
      
      // ANTI-EXPLOIT: Block bets on "Unknown Event" or invalid events
      if (!eventName || eventName === "Unknown Event" || eventName.trim() === "") {
        console.log(`❌ Blocked bet on Unknown Event from ${(walletAddress || userId).slice(0, 12)}...`);
        return res.status(400).json({
          message: "Invalid event. Please select a valid match to bet on.",
          code: "INVALID_EVENT"
        });
      }
      
      // TEAM DATA ENRICHMENT: If homeTeam/awayTeam missing, try to look them up from event cache
      let resolvedHomeTeam = homeTeam;
      let resolvedAwayTeam = awayTeam;
      if (!resolvedHomeTeam || !resolvedAwayTeam || resolvedHomeTeam === "Unknown" || resolvedAwayTeam === "Unknown") {
        try {
          const eventLookup = apiSportsService.lookupEventSync(eventId);
          if (eventLookup.found && eventLookup.homeTeam && eventLookup.awayTeam) {
            resolvedHomeTeam = eventLookup.homeTeam;
            resolvedAwayTeam = eventLookup.awayTeam;
            console.log(`✅ Enriched missing team data from cache: ${resolvedHomeTeam} vs ${resolvedAwayTeam}`);
          } else {
            const freeLookup2 = freeSportsService.lookupEvent(eventId);
            if (freeLookup2.found && freeLookup2.event) {
              resolvedHomeTeam = freeLookup2.event.homeTeam || resolvedHomeTeam;
              resolvedAwayTeam = freeLookup2.event.awayTeam || resolvedAwayTeam;
              console.log(`✅ Enriched missing team data from free sports: ${resolvedHomeTeam} vs ${resolvedAwayTeam}`);
            } else {
              const esportsLookup2 = esportsService.lookupEvent(eventId);
              if (esportsLookup2.found && esportsLookup2.event) {
                resolvedHomeTeam = esportsLookup2.event.homeTeam || resolvedHomeTeam;
                resolvedAwayTeam = esportsLookup2.event.awayTeam || resolvedAwayTeam;
                console.log(`✅ Enriched missing team data from esports: ${resolvedHomeTeam} vs ${resolvedAwayTeam}`);
              }
            }
          }
        } catch (enrichError) {
          console.warn('[Team Enrichment] Failed to lookup teams, continuing with provided data:', enrichError);
        }
      }
      
      // ANTI-EXPLOIT: Validate teams are provided (after enrichment attempt)
      if (!resolvedHomeTeam || !resolvedAwayTeam || resolvedHomeTeam === "Unknown" || resolvedAwayTeam === "Unknown") {
        // For on-chain bets with valid txHash, allow through even without team data
        // The on-chain transaction already happened, blocking here would lose user money
        if (txHash && txHash.startsWith('0x')) {
          console.warn(`⚠️ On-chain bet ${txHash.slice(0, 12)}... missing team data, allowing through to prevent fund loss`);
          resolvedHomeTeam = resolvedHomeTeam || eventName?.split(' vs ')?.[0]?.trim() || 'Team A';
          resolvedAwayTeam = resolvedAwayTeam || eventName?.split(' vs ')?.[1]?.trim() || 'Team B';
        } else {
          console.log(`❌ Blocked bet with unknown teams from ${(walletAddress || userId).slice(0, 12)}...`);
          return res.status(400).json({
            message: "Invalid match data. Please select a valid match to bet on.",
            code: "INVALID_TEAMS"
          });
        }
      }
      
      const freeLookup = freeSportsService.lookupEvent(eventId);
      if (freeLookup.found && freeLookup.shouldBeLive) {
        console.log(`❌ Blocked bet on free sport event ${eventId} — within 5min cutoff, from ${(walletAddress || userId).slice(0, 12)}...`);
        return res.status(400).json({
          message: "Betting closes 5 minutes before match start.",
          code: "MATCH_STARTED"
        });
      }
      const esportsLookupBet = esportsService.lookupEvent(eventId);
      if (esportsLookupBet.found && esportsLookupBet.event?.startTime) {
        if (new Date(esportsLookupBet.event.startTime).getTime() <= Date.now() + 5 * 60 * 1000) {
          console.log(`❌ Blocked bet on esports event ${eventId} — within 5min cutoff`);
          return res.status(400).json({
            message: "Betting closes 5 minutes before match start.",
            code: "MATCH_STARTED"
          });
        }
      }
      
      // ANTI-EXPLOIT: Validate event exists in our system (for non-live bets)
      if (!isLive && !freeLookup.found) {
        try {
          const eventCheck = apiSportsService.lookupEventSync(eventId);
          if (!eventCheck.found) {
            console.log(`❌ Blocked bet on unknown event ${eventId} from ${(walletAddress || userId).slice(0, 12)}...`);
            return res.status(400).json({
              message: "Event not found. Please select a valid match from our system.",
              code: "EVENT_NOT_FOUND"
            });
          }
        } catch (eventCheckError) {
          console.log(`❌ Blocked bet (event check error) on ${eventId} from ${(walletAddress || userId).slice(0, 12)}...`);
          return res.status(400).json({
            message: "Could not verify event. Please try again.",
            code: "EVENT_VERIFICATION_FAILED"
          });
        }
      }
      
      // DUPLICATE BET PREVENTION: Check if user already has a pending/confirmed bet on this exact selection
      try {
        const existingBets = await storage.getUserBets(userId);
        const duplicateBet = existingBets.find((bet: any) => 
          bet.eventId === eventId &&
          bet.marketId === marketId &&
          bet.outcomeId === outcomeId &&
          (bet.status === 'pending' || bet.status === 'confirmed')
        );
        
        if (duplicateBet) {
          console.log(`❌ Duplicate bet blocked: User ${userId.slice(0, 10)}... already has bet on ${eventId}/${marketId}/${outcomeId}`);
          return res.status(400).json({
            message: "You already have an active bet on this selection. Wait for it to settle or choose a different outcome.",
            code: "DUPLICATE_BET"
          });
        }
      } catch (dupCheckError) {
        console.warn('[Duplicate Check] Failed to check for duplicates, allowing bet:', dupCheckError);
        // Continue with bet - don't block if check fails
      }
      
      // ANTI-EXPLOIT: Server-side odds verification — reject inflated odds (FAIL-CLOSED)
      // LIVE MATCH SCORE-CHANGE DETECTION: Reject bets with stale odds after goals
      const footballCheck = apiSportsService.lookupEventSync(eventId);
      if (footballCheck.found && footballCheck.source === 'live') {
        const currentScore = `${footballCheck.homeScore ?? 0}-${footballCheck.awayScore ?? 0}`;
        const liveOddsCheck = apiSportsService.getOddsFromCacheLive(eventId, currentScore);
        if (liveOddsCheck && liveOddsCheck.stale) {
          console.log(`❌ BET BLOCKED (live odds stale): ${liveOddsCheck.reason}, event=${eventId}, wallet=${resolvedWallet.slice(0,12)}...`);
          apiSportsService.invalidateOddsForEvent(eventId);
          return res.status(400).json({
            message: "Odds have changed due to in-game action. Please refresh and try again.",
            code: "ODDS_STALE_LIVE"
          });
        }
      }

      // The client submits odds; we verify against server's cached real odds
      // SECURITY: Always verify odds regardless of txHash/onChainBetId presence
      // On-chain bets are STILL validated — the oracle already signed verified odds,
      // and this is defense-in-depth to catch any manipulation
      {
        const oddsCheck = lookupServerOdds(eventId, prediction, outcomeId);
        if (oddsCheck.found && oddsCheck.serverOdds && oddsCheck.maxAllowedOdds) {
          if (odds > oddsCheck.maxAllowedOdds) {
            console.log(`❌ ODDS MANIPULATION BLOCKED: submitted=${odds}, server=${oddsCheck.serverOdds}, max=${oddsCheck.maxAllowedOdds}, source=${oddsCheck.source}, event=${eventId}, wallet=${resolvedWallet.slice(0,12)}...`);
            return res.status(400).json({
              message: "Odds have changed. Please refresh and try again.",
              code: "ODDS_MISMATCH"
            });
          }
          console.log(`✅ Odds verified: submitted=${odds}, server=${oddsCheck.serverOdds}, source=${oddsCheck.source}`);
        } else if (oddsCheck.source && oddsCheck.source !== 'api-sports-no-odds') {
          // FAIL-CLOSED: Event found but odds couldn't be matched to a selection — block
          console.log(`❌ ODDS UNVERIFIABLE: event ${eventId} found (${oddsCheck.source}) but selection unmappable, odds=${odds}, wallet=${resolvedWallet.slice(0,12)}...`);
          return res.status(400).json({
            message: "Unable to verify odds for this selection. Please refresh and try again.",
            code: "ODDS_UNVERIFIABLE"
          });
        } else {
          // For events without cached odds data (api-sports-no-odds or truly unknown):
          // Cap at conservative max to prevent abuse
          const conservativeMaxOdds = MAX_ODDS_CAP;
          if (odds > conservativeMaxOdds) {
            console.log(`❌ ODDS CAP (no reference): submitted=${odds} > conservative max ${conservativeMaxOdds}, event=${eventId}, wallet=${resolvedWallet.slice(0,12)}...`);
            return res.status(400).json({
              message: "Odds appear unusually high. Please refresh and try again.",
              code: "ODDS_TOO_HIGH"
            });
          }
          console.log(`[OddsCheck] No reference odds for event ${eventId} — conservative cap applied (max ${conservativeMaxOdds}), submitted=${odds}`);
        }
      }
      
      // ANTI-EXPLOIT: Max payout cap at bet placement — defense-in-depth
      const earlyBetCurrency = currency || feeCurrency || 'SBETS';
      const maxPayout = getMaxPayoutForCurrency(earlyBetCurrency);
      const projectedPayout = betAmount * odds;
      if (projectedPayout > maxPayout) {
        const safeStake = Math.floor(maxPayout / odds);
        console.log(`❌ PAYOUT CAP: projected ${projectedPayout} ${earlyBetCurrency} > max ${maxPayout} ${earlyBetCurrency}, event=${eventId}, wallet=${resolvedWallet.slice(0,12)}...`);
        return res.status(400).json({
          message: `Maximum potential payout is ${maxPayout.toLocaleString()} ${earlyBetCurrency}. Try a stake of ${safeStake.toLocaleString()} ${earlyBetCurrency} or less.`,
          code: "MAX_PAYOUT_EXCEEDED",
          suggestedStake: safeStake
        });
      }
      
      // ANTI-CHEAT: In live matches, ONLY Match Winner (win/draw/lose) is allowed
      // All other markets (Over/Under, BTTS, Double Chance, etc.) are blocked to prevent exploitation
      if (data.isLive && data.marketId) {
        const marketIdStr = String(data.marketId).toLowerCase();
        const isMatchWinner = marketIdStr.includes('match_winner') || marketIdStr.includes('match-winner') ||
                               marketIdStr.includes('match_result') || marketIdStr.includes('match-result') ||
                               marketIdStr === 'match winner' || marketIdStr === 'match result';
        
        if (!isMatchWinner) {
          console.warn(`[Anti-Cheat] Blocking non-Match-Winner market in live: event ${data.eventId}, market ${data.marketId}`);
          return res.status(400).json({
            success: false,
            message: "MARKET_CLOSED_LIVE",
            details: "Only Match Winner (win/draw/lose) is available for live betting. Other markets are available for upcoming matches."
          });
        }
      }
      
      // Anti-cheat: Block ALL live bets after minute 45 (first half only betting)
      const isFirstHalfMarket = !!data.marketId && (
        String(data.marketId).includes('1st_half') || 
        String(data.marketId).includes('1st-half') ||
        String(data.marketId).includes('first_half') ||
        String(data.marketId).includes('first-half') ||
        String(data.marketId).includes('half_time_result') ||
        String(data.marketId).includes('half-time-result') ||
        String(data.marketId) === "4" // First Half Result market ID
      );

      const currentMinute = data.matchMinute || (data.isLive ? parseInt(String(apiSportsService.lookupEventSync(data.eventId).minute || 0)) : 0);

      if (data.isLive) {
        if (currentMinute >= 85) {
          console.warn(`[Anti-Cheat] Blocking live bet in final minutes: event ${data.eventId}, minute ${currentMinute}`);
          return res.status(400).json({ 
            success: false, 
            message: "MATCH_CUTOFF",
            details: "Betting closed — final minutes of the match."
          });
        }
      }

      const betCurrency = currency || feeCurrency || 'SBETS';
      
      // SUI BETTING PAUSE - Block SUI bets until treasury is funded
      if (SUI_BETTING_PAUSED && betCurrency !== 'SBETS') {
        console.log(`❌ SUI bet blocked - betting paused until treasury funded`);
        return res.status(400).json({
          message: SUI_PAUSE_MESSAGE,
          code: "SUI_BETTING_PAUSED"
        });
      }
      
      const isFuturesBet = isFuturesEvent(String(data.eventId));
      const MAX_STAKE_SUI = isFuturesBet ? FUTURES_MAX_STAKE_SUI : RUNTIME_MAX_STAKE_SUI;
      const MAX_STAKE_SBETS = isFuturesBet ? FUTURES_MAX_STAKE_SBETS : RUNTIME_MAX_STAKE_SBETS;
      const MAX_STAKE_USDSUI = isFuturesBet ? FUTURES_MAX_STAKE_USDSUI : RUNTIME_MAX_STAKE_USDSUI;
      const maxStake = betCurrency === 'SBETS' ? MAX_STAKE_SBETS : betCurrency === 'USDSUI' ? MAX_STAKE_USDSUI : MAX_STAKE_SUI;
      
      if (betAmount > maxStake) {
        console.log(`❌ Bet rejected (max stake exceeded${isFuturesBet ? ' FUTURES' : ''}): ${betAmount} ${betCurrency} > ${maxStake} ${betCurrency}`);
        return res.status(400).json({
          message: isFuturesBet 
            ? `Futures bets are limited to ${maxStake.toLocaleString()} ${betCurrency} to manage liability. High odds = lower max stake.`
            : `Maximum stake is ${maxStake.toLocaleString()} ${betCurrency}`,
          code: "MAX_STAKE_EXCEEDED"
        });
      }

      const singleBetExposure = await getWalletPendingExposure(resolvedWallet);
      const singleExposureLimit = getMaxExposureForCurrency(betCurrency);
      const singleCurrentExposure = betCurrency === 'SBETS' ? singleBetExposure.sbets : betCurrency === 'USDSUI' ? (singleBetExposure.usdsui || 0) : singleBetExposure.sui;
      const singleNewPayout = betAmount * odds;
      if (singleCurrentExposure + singleNewPayout > singleExposureLimit) {
        console.log(`❌ EXPOSURE LIMIT: ${resolvedWallet.slice(0,12)}... current=${singleCurrentExposure.toLocaleString()} + new=${singleNewPayout.toLocaleString()} > max ${singleExposureLimit.toLocaleString()} ${betCurrency}`);
        return res.status(400).json({
          message: `Maximum pending exposure would be exceeded. Wait for active bets to settle.`,
          code: "MAX_EXPOSURE_EXCEEDED"
        });
      }

      if (isFuturesBet) {
        const potentialPayout = betAmount * odds;
        const maxPayout = betCurrency === 'SBETS' ? FUTURES_MAX_PAYOUT_SBETS : betCurrency === 'USDSUI' ? FUTURES_MAX_PAYOUT_USDSUI : FUTURES_MAX_PAYOUT_SUI;
        if (potentialPayout > maxPayout) {
          const safeStake = Math.floor(maxPayout / odds);
          console.log(`❌ Futures payout cap: ${potentialPayout.toFixed(0)} ${betCurrency} > max ${maxPayout}, suggesting stake ${safeStake}`);
          return res.status(400).json({
            message: `Maximum potential payout for futures is ${maxPayout.toLocaleString()} ${betCurrency}. Try a stake of ${safeStake.toLocaleString()} ${betCurrency} or less.`,
            code: "FUTURES_PAYOUT_CAP",
            maxStake: safeStake,
          });
        }
      }
      
      // USER BETTING LIMITS CHECK (validate only, update after bet success)
      const SUI_PRICE_USD = 1.50;
      const SBETS_PRICE_USD = 0.000001;
      const betUsdValue = betCurrency === 'SBETS' ? betAmount * SBETS_PRICE_USD : betCurrency === 'USDSUI' ? betAmount : betAmount * SUI_PRICE_USD;
      
      // Handle FREE BET bonus usage (promotion bonus)
      let bonusUsedAmount = 0;
      if (useBonus) {
        try {
          const promoStatus = await promotionService.getPromotionStatus(walletAddress || userId);
          if (promoStatus.bonusBalance > 0) {
            // Use bonus up to the bet amount (converted to USD)
            const maxBonusToUse = Math.min(promoStatus.bonusBalance, betUsdValue);
            const usedSuccess = await promotionService.useBonusBalance(walletAddress || userId, maxBonusToUse);
            if (usedSuccess) {
              bonusUsedAmount = maxBonusToUse;
              console.log(`🎁 FREE BET: Used $${bonusUsedAmount.toFixed(2)} bonus for ${walletAddress || userId}`);
            }
          }
        } catch (bonusError) {
          console.warn('[BONUS] Failed to use bonus balance:', bonusError);
        }
      }
      
      // Handle FREE SBETS usage (welcome bonus / referral rewards) - ONE TIME ONLY per user lifetime
      let freeSbetsUsed = 0;
      if (useFreeBet && betCurrency === 'SBETS') {
        try {
          const { users, bets } = await import('@shared/schema');
          const { db } = await import('./db');
          const { eq, and, sql: sqlDrizzle } = await import('drizzle-orm');
          
          const userWallet = walletAddress || userId;
          const [user] = await db.select().from(users).where(eq(users.walletAddress, userWallet));
          
          // Check if user has EVER used a free bet before (lifetime one-time only)
          let hasUsedFreeBet = false;
          try {
            const previousFreeBets = await db.select({ count: sqlDrizzle<number>`count(*)` })
              .from(bets)
              .where(and(
                eq(bets.walletAddress, userWallet),
                eq(bets.paymentMethod, 'free_bet')
              ));
            hasUsedFreeBet = (previousFreeBets[0]?.count || 0) > 0;
          } catch (checkErr) {
            console.error('[FREE BET] FAIL-CLOSED: Could not check previous free bets:', checkErr);
            return res.status(503).json({ message: "Unable to verify free bet eligibility. Try again.", code: "FREE_BET_CHECK_FAILED" });
          }

          if (hasUsedFreeBet) {
            console.log(`❌ FREE BET BLOCKED: ${userWallet.slice(0, 10)}... already used their one-time free bet`);
            return res.status(400).json({
              message: "You have already used your free bet. Each user gets one free bet for life.",
              code: "FREE_BET_ALREADY_USED"
            });
          }

          // Atomic: only deduct if balance is sufficient — prevents race condition
          const deductResult = await db.update(users)
            .set({ freeBetBalance: sqlDrizzle`COALESCE(free_bet_balance, 0) - ${betAmount}` })
            .where(and(
              eq(users.walletAddress, userWallet),
              sqlDrizzle`COALESCE(free_bet_balance, 0) >= ${betAmount}`
            ))
            .returning({ freeBetBalance: users.freeBetBalance });
          
          if (deductResult.length > 0) {
            freeSbetsUsed = betAmount;
            console.log(`🎁 FREE SBETS: Used ${betAmount.toLocaleString()} SBETS (ONE-TIME free bet) for ${userWallet.slice(0, 10)}...`);
          } else {
            console.warn(`[FREE SBETS] Insufficient free balance for ${userWallet.slice(0, 10)}...`);
          }
        } catch (freeBetError) {
          console.warn('[FREE SBETS] Failed to use free bet balance:', freeBetError);
        }
      }
      
      let limitsCheckPassed = false;
      let userWalletForLimits: string | null = null;
      
      try {
        const { userLimits } = await import('@shared/schema');
        const { db } = await import('./db');
        const { eq } = await import('drizzle-orm');
        userWalletForLimits = walletAddress || userId;
        
        if (userWalletForLimits && userWalletForLimits.startsWith('0x')) {
          const [limits] = await db.select().from(userLimits).where(eq(userLimits.walletAddress, userWalletForLimits));
          
          if (limits) {
            const now = new Date();
            
            // Reset spent amounts based on time windows
            let dailySpent = limits.dailySpent || 0;
            let weeklySpent = limits.weeklySpent || 0;
            let monthlySpent = limits.monthlySpent || 0;
            
            // Reset daily if last reset was before today
            if (limits.lastResetDaily) {
              const lastDaily = new Date(limits.lastResetDaily);
              if (lastDaily.toDateString() !== now.toDateString()) {
                dailySpent = 0;
              }
            }
            
            // Reset weekly if last reset was more than 7 days ago
            if (limits.lastResetWeekly) {
              const lastWeekly = new Date(limits.lastResetWeekly);
              if (now.getTime() - lastWeekly.getTime() > 7 * 24 * 60 * 60 * 1000) {
                weeklySpent = 0;
              }
            }
            
            // Reset monthly if last reset was in a different month
            if (limits.lastResetMonthly) {
              const lastMonthly = new Date(limits.lastResetMonthly);
              if (lastMonthly.getMonth() !== now.getMonth() || lastMonthly.getFullYear() !== now.getFullYear()) {
                monthlySpent = 0;
              }
            }
            
            // Check self-exclusion
            if (limits.selfExclusionUntil && new Date(limits.selfExclusionUntil) > now) {
              return res.status(403).json({ message: 'Self-exclusion active', code: 'SELF_EXCLUDED' });
            }
            
            // Check limits (validation only, no update yet)
            if (limits.dailyLimit && dailySpent + betUsdValue > limits.dailyLimit) {
              return res.status(403).json({ message: `Daily limit of $${limits.dailyLimit} reached`, code: 'DAILY_LIMIT_EXCEEDED' });
            }
            if (limits.weeklyLimit && weeklySpent + betUsdValue > limits.weeklyLimit) {
              return res.status(403).json({ message: `Weekly limit of $${limits.weeklyLimit} reached`, code: 'WEEKLY_LIMIT_EXCEEDED' });
            }
            if (limits.monthlyLimit && monthlySpent + betUsdValue > limits.monthlyLimit) {
              return res.status(403).json({ message: `Monthly limit of $${limits.monthlyLimit} reached`, code: 'MONTHLY_LIMIT_EXCEEDED' });
            }
            
            limitsCheckPassed = true;
          }
        }
      } catch (limitsError) {
        console.log('Limits check skipped:', limitsError);
      }
      
      // SERVER-SIDE VALIDATION: Unified event registry lookup
      // CRITICAL: Server is authoritative about event status - never trust client isLive/matchMinute
      // Security: FAIL-CLOSED - Event must exist in server cache (live or upcoming) to accept bet
      // SECURITY: ALL bets go through validation — txHash/onChainBetId presence does NOT bypass checks
      const isOnChainConfirmed = !!(txHash && onChainBetId);
      const MAX_LIVE_CACHE_AGE_MS = 90 * 1000;
      const MAX_UPCOMING_CACHE_AGE_MS = 15 * 60 * 1000;
      
      try {
        const eventLookup = apiSportsService.lookupEventSync(eventId);
        
        if (!eventLookup.found) {
          const isFreeOrEsports = freeSportsService.lookupEvent(eventId).found || esportsService.lookupEvent(eventId).found;
          const isFuturesValid = isFuturesEvent(String(eventId)) && lookupFuturesOdds(String(eventId), prediction) !== null && new Date() < new Date(WORLD_CUP_2026_FUTURES.closingDate);
          if (!isFreeOrEsports && !isFuturesValid) {
            console.log(`❌ Bet rejected (unknown event): Event ${eventId} not in live or upcoming cache, client isLive: ${isLive}, onChain: ${isOnChainConfirmed}`);
            return res.status(400).json({ 
              message: "Event not found - please refresh and try again",
              code: "EVENT_NOT_FOUND"
            });
          }
        }
        
        if (eventLookup.found) {
        // DYNAMIC CACHE AGE CHECK: Different thresholds for live vs upcoming events
        // Live events need strict freshness (60s) because match state changes rapidly
        // Upcoming events can have relaxed threshold (15min) because match hasn't started
        const isEventLive = eventLookup.source === 'live';
        const maxCacheAge = isEventLive ? MAX_LIVE_CACHE_AGE_MS : MAX_UPCOMING_CACHE_AGE_MS;
        
        if (eventLookup.cacheAgeMs > maxCacheAge) {
          console.log(`❌ Bet rejected (stale cache): Cache is ${Math.round(eventLookup.cacheAgeMs/1000)}s old (max ${maxCacheAge/1000}s), eventId: ${eventId}, source: ${eventLookup.source}`);
          return res.status(400).json({ 
            message: isEventLive ? "Match data is stale - please refresh" : "Event data is stale - please refresh and try again",
            code: "STALE_EVENT_DATA"
          });
        }
        
        // Event found with fresh cache - check if it's live (server determines this, not client)
        if (eventLookup.source === 'live') {
          if (eventLookup.minute === undefined || eventLookup.minute === null) {
            console.log(`❌ Bet rejected (unverifiable minute): Live match has no minute data, eventId: ${eventId}`);
            return res.status(400).json({ 
              message: "Cannot verify match time - please try again shortly",
              code: "UNVERIFIABLE_MATCH_TIME"
            });
          }
          
        if (eventLookup.minute >= 85) {
          console.log(`❌ Bet rejected (server-verified): Live match at ${eventLookup.minute} minutes (>= 85 min cutoff), eventId: ${eventId}`);
          return res.status(400).json({ 
            message: "Betting closed — final minutes",
            code: "MATCH_TIME_EXCEEDED",
            serverVerified: true
          });
        }

        // ANTI-CHEAT: Market-specific time validation
        const marketLower = marketId.toLowerCase();
        const firstHalfMarkets = ['half_time_result', 'ht_ft', '1st_half_goals', 'first_half_winner', 'half-time-result', '1st-half-goals'];
        const isFirstHalfMarket = firstHalfMarkets.includes(marketLower) || 
                                marketLower.includes('1st_half') || 
                                marketLower.includes('1st-half') ||
                                marketLower.includes('first_half') ||
                                marketLower.includes('first-half');
        
        if (isFirstHalfMarket && eventLookup.minute > 45) {
          console.log(`❌ Bet rejected (anti-cheat): First half market ${marketId} selected at minute ${eventLookup.minute}`);
          return res.status(400).json({
            message: "This market is closed (First half has ended)",
            code: "MARKET_CLOSED_HALF_TIME"
          });
        }
        
        // ANTI-CHEAT: Score-based odds validation for MATCH WINNER markets only
        // IMPORTANT: Only applies to match_winner/moneyline markets - NOT totals, handicaps, or props
        const homeScore = eventLookup.homeScore;
        const awayScore = eventLookup.awayScore;
        const minute = eventLookup.minute ?? 0;
        
        // Check if this is a match winner market (only apply anti-cheat to these)
        const marketIdLower = (marketId || '').toLowerCase();
        const isMatchWinnerMarket = marketIdLower.includes('winner') || 
                                     marketIdLower.includes('match_result') ||
                                     marketIdLower.includes('match-result') ||
                                     marketIdLower.includes('1x2') ||
                                     marketIdLower === 'match_winner' ||
                                     marketIdLower === 'full_time_result' ||
                                     marketIdLower === 'moneyline';
        
        // Only run anti-cheat on match winner markets with verified score data
        const hasScoreData = homeScore !== undefined && homeScore !== null && 
                             awayScore !== undefined && awayScore !== null;
        
        if (isMatchWinnerMarket && hasScoreData) {
          const scoreDiff = Math.abs(homeScore - awayScore);
          const homeWinning = homeScore > awayScore;
          const awayWinning = awayScore > homeScore;
          
          // Robust outcome detection
          const outcomeIdLower = (outcomeId || '').toLowerCase();
          const predLower = (prediction || '').toLowerCase();
          const homeTeamLower = (eventLookup.homeTeam || '').toLowerCase().trim();
          const awayTeamLower = (eventLookup.awayTeam || '').toLowerCase().trim();
          
          // Comprehensive patterns for outcome detection
          const homePatterns = ['home', 'h', '1', 'home_team', 'hometeam', 'home-win', 'homewin'];
          const awayPatterns = ['away', 'a', '2', 'away_team', 'awayteam', 'away-win', 'awaywin'];
          
          const bettingOnHome = homePatterns.some(p => outcomeIdLower === p || outcomeIdLower.startsWith(p + '_')) ||
                                (homeTeamLower.length > 2 && predLower.includes(homeTeamLower));
          const bettingOnAway = awayPatterns.some(p => outcomeIdLower === p || outcomeIdLower.startsWith(p + '_')) ||
                                (awayTeamLower.length > 2 && predLower.includes(awayTeamLower));
          
          // Determine if betting on winning team or losing team
          const bettingOnWinningTeam = (homeWinning && bettingOnHome) || (awayWinning && bettingOnAway);
          const bettingOnLosingTeam = (homeWinning && bettingOnAway) || (awayWinning && bettingOnHome);
          
          if (scoreDiff >= 2 && minute >= 30 && bettingOnWinningTeam) {
            const suspiciousThreshold = minute >= 75 ? 1.3 : minute >= 60 ? 1.5 : 1.8;
            
            if (odds > suspiciousThreshold) {
              console.log(`❌ Bet rejected (anti-cheat): Winning team ${outcomeId} with odds ${odds} at ${minute}min, score ${homeScore}-${awayScore}`);
              return res.status(400).json({
                message: "Betting suspended - odds may not reflect current score",
                code: "SUSPICIOUS_ODDS_DETECTED"
              });
            }
          }
          
          // Log for monitoring but allow all other bets
          if (scoreDiff >= 2 && minute >= 60) {
            console.log(`[anti-cheat] Allowing bet: market=${marketId}, outcome=${outcomeId}, odds=${odds}, score=${homeScore}-${awayScore}, min=${minute}, losingTeam=${bettingOnLosingTeam}`);
          }
        }
        
        // Live match under 45 minutes with fresh cache and verified minute - allow bet to proceed
        console.log(`✅ Live bet allowed: eventId ${eventId}, minute: ${eventLookup.minute}, cache age: ${Math.round(eventLookup.cacheAgeMs/1000)}s`);
        } else if (eventLookup.source === 'upcoming') {
          // Event found in upcoming cache - but check if it SHOULD be live based on start time
          if (eventLookup.shouldBeLive) {
            // START TIME HAS PASSED - match should be live but isn't in live cache
            // This is the critical bypass scenario: match could be at 45+ minutes
            // FAIL-CLOSED: Reject - we can't verify the match state
            console.log(`❌ Bet rejected (should be live): Event ${eventId} startTime has passed (${eventLookup.startTime}) but not in live cache, client isLive: ${isLive}`);
            return res.status(400).json({ 
              message: "Match may have started - cannot verify status, please refresh",
              code: "EVENT_STATUS_UNCERTAIN"
            });
          }
          // Event truly upcoming (start time in future) - allow bet
          console.log(`✅ Upcoming bet allowed: eventId ${eventId}, startTime: ${eventLookup.startTime}, cache age: ${Math.round(eventLookup.cacheAgeMs/1000)}s`);
        }
        }
      } catch (lookupError) {
        console.log(`❌ Bet rejected (cache error): Cannot verify event, eventId: ${eventId}, onChain: ${isOnChainConfirmed}, error: ${lookupError}`);
        return res.status(400).json({ 
          message: "Cannot verify event status - please try again",
          code: "EVENT_VERIFICATION_ERROR"
        });
      }
      
      // Currency already extracted from validation (defaults to SUI)
      const platformFee = betAmount * 0.01; // 1% platform fee
      const totalDebit = betAmount + platformFee;

      if (txHash) {
        try {
          const existingBetInLock = await storage.getBetByTxHash(txHash);
          if (existingBetInLock) {
            console.log(`⚡ Duplicate txHash (inside lock, retry-safe): ${txHash.slice(0, 12)}... → returning existing bet`);
            return res.status(200).json({ ...existingBetInLock, duplicate: true });
          }
        } catch (dupErr) {
          console.error('[TxDedup] Check failed - FAIL CLOSED:', dupErr);
          return res.status(503).json({
            message: "Unable to verify transaction uniqueness. Please try again.",
            code: "DEDUP_CHECK_FAILED"
          });
        }
      }

      // SBETS BALANCE VERIFICATION - Verify user actually holds enough SBETS to bet
      // Only skip when BOTH txHash AND onChainBetId confirm a real on-chain transaction
      // Free bet path handles its own deduction with fail-closed below
      if (betCurrency === 'SBETS' && !isOnChainConfirmed && !freeSbetsUsed) {
        try {
          const userBal = await blockchainBetService.getWalletBalance(resolvedWallet);
          if (userBal.sbets < betAmount) {
            console.log(`❌ SBETS bet rejected: wallet ${resolvedWallet.slice(0,10)}... has ${userBal.sbets} SBETS but tried to bet ${betAmount}`);
            return res.status(400).json({
              message: `Insufficient SBETS balance. You have ${userBal.sbets.toLocaleString()} SBETS but tried to bet ${betAmount.toLocaleString()} SBETS.`,
              code: "INSUFFICIENT_SBETS_BALANCE"
            });
          }
        } catch (balCheckErr) {
          console.error('[BET] FAIL-CLOSED: Cannot verify SBETS balance:', balCheckErr);
          return res.status(503).json({
            message: "Unable to verify your SBETS balance. Please try again.",
            code: "BALANCE_CHECK_FAILED"
          });
        }
      }
      
      // OFF-CHAIN BETTING - Bets are recorded directly and settled when events complete
      console.log(`🎲 OFF-CHAIN BET: Recording bet for ${userId} - ${betAmount} ${betCurrency}`);
      
      if (txHash) {
        console.log(`📦 With txHash: ${txHash}, betObjectId: ${onChainBetId}`);
        if (!onChainBetId) {
          console.warn(`⚠️ MISSING betObjectId: On-chain bet (tx: ${txHash}) has no betObjectId - settlement will use OFF-CHAIN fallback!`);
          console.warn(`   This indicates frontend extraction failed or wallet didn't return objectChanges`);
        }
      }

      const betId = onChainBetId || `bet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const potentialPayout = Math.round(betAmount * odds * 100) / 100;

      // WALRUS: Store bet receipt BEFORE inserting the bet so blob ID is always guaranteed in the DB row
      let walrusBlobId: string | null = null;
      let walrusReceiptJson: string | null = null;
      let walrusStorageEpoch: number | null = null;
      let walrusEndEpoch: number | null = null;
      let walrusCost: number | null = null;
      try {
        const { storeBetReceipt } = await import('./services/walrusStorageService');
        const walrusResult = await storeBetReceipt({
          betId,
          walletAddress: walletAddress || userId,
          eventId: String(eventId),
          eventName: eventName || 'Sports Event',
          homeTeam: resolvedHomeTeam || '',
          awayTeam: resolvedAwayTeam || '',
          prediction,
          odds,
          stake: betAmount,
          currency: betCurrency,
          potentialPayout,
          txHash: txHash || undefined,
          betObjectId: onChainBetId || undefined,
          placedAt: Date.now(),
          sportName: sportName || undefined,
          marketType: marketTypeName || marketId || undefined,
        });
        // Enrich receipt JSON with post-storage metadata
        let enrichedReceiptJson = walrusResult.receiptJson;
        try {
          const receiptObj = JSON.parse(walrusResult.receiptJson);
          receiptObj.storage = {
            ...(receiptObj.storage || {}),
            storageEpoch: walrusResult.storageEpoch ?? null,
            endEpoch: walrusResult.endEpoch ?? null,
            walCost: walrusResult.walCost ?? null,
            publisherUsed: walrusResult.publisherUsed ?? null,
            storeEpochs: 10,
          };
          enrichedReceiptJson = JSON.stringify(receiptObj, null, 2);
        } catch {}
        walrusReceiptJson = enrichedReceiptJson;
        walrusStorageEpoch = walrusResult.storageEpoch ?? null;
        walrusEndEpoch = walrusResult.endEpoch ?? null;
        walrusCost = walrusResult.walCost ?? null;
        walrusBlobId = walrusResult.blobId || `local_${walrusResult.receiptHash}`;
        console.log(`🐋 Walrus receipt ready for bet ${betId}: ${walrusBlobId} (publisher: ${walrusResult.publisherUsed || 'local'}) epoch: ${walrusResult.storageEpoch}→${walrusResult.endEpoch}`);
      } catch (walrusErr: any) {
        console.warn(`[Walrus] Pre-bet store error: ${walrusErr.message} — using local fallback`);
        const { createHash } = await import('crypto');
        walrusBlobId = `local_${createHash('sha256').update(betId + Date.now()).digest('hex').slice(0, 16)}`;
      }

      const bet = {
        id: betId,
        userId,
        walletAddress: resolvedWallet,
        eventId,
        eventName: eventName || 'Sports Event',
        homeTeam: resolvedHomeTeam || '',
        awayTeam: resolvedAwayTeam || '',
        marketId,
        outcomeId,
        odds,
        betAmount,
        currency: betCurrency,
        status: (paymentMethod === 'wallet' ? 'confirmed' : 'pending') as 'pending' | 'confirmed',
        prediction,
        placedAt: Date.now(),
        potentialPayout,
        platformFee: paymentMethod === 'wallet' ? 0 : platformFee,
        totalDebit: paymentMethod === 'wallet' ? betAmount : totalDebit,
        txHash: txHash || undefined,
        onChainBetId: onChainBetId || undefined,
        paymentMethod,
        giftedTo: giftRecipientWallet || undefined,
        giftedFrom: giftRecipientWallet ? (walletAddress || userId) : undefined,
        walrusBlobId,
        walrusReceiptData: walrusReceiptJson,
      };

      // Store bet in storage (walrusBlobId already included — guaranteed to be non-null)
      const storedBet = await storage.createBet(bet);
      
      // UPDATE LIMITS AFTER SUCCESSFUL BET PLACEMENT
      if (limitsCheckPassed && userWalletForLimits) {
        try {
          const { userLimits: userLimitsTable } = await import('@shared/schema');
          const { db: dbInstance } = await import('./db');
          const { eq: eqOp } = await import('drizzle-orm');
          const now = new Date();
          
          const [currentLimits] = await dbInstance.select().from(userLimitsTable).where(eqOp(userLimitsTable.walletAddress, userWalletForLimits));
          if (currentLimits) {
            // Calculate spent with time-window resets
            let dailySpent = currentLimits.dailySpent || 0;
            let weeklySpent = currentLimits.weeklySpent || 0;
            let monthlySpent = currentLimits.monthlySpent || 0;
            let lastResetDaily = currentLimits.lastResetDaily;
            let lastResetWeekly = currentLimits.lastResetWeekly;
            let lastResetMonthly = currentLimits.lastResetMonthly;
            
            if (lastResetDaily && new Date(lastResetDaily).toDateString() !== now.toDateString()) {
              dailySpent = 0;
              lastResetDaily = now;
            }
            if (lastResetWeekly && now.getTime() - new Date(lastResetWeekly).getTime() > 7 * 24 * 60 * 60 * 1000) {
              weeklySpent = 0;
              lastResetWeekly = now;
            }
            if (lastResetMonthly) {
              const lm = new Date(lastResetMonthly);
              if (lm.getMonth() !== now.getMonth() || lm.getFullYear() !== now.getFullYear()) {
                monthlySpent = 0;
                lastResetMonthly = now;
              }
            }
            
            await dbInstance.update(userLimitsTable).set({
              dailySpent: dailySpent + betUsdValue,
              weeklySpent: weeklySpent + betUsdValue,
              monthlySpent: monthlySpent + betUsdValue,
              lastResetDaily,
              lastResetWeekly,
              lastResetMonthly,
              updatedAt: now
            }).where(eqOp(userLimitsTable.walletAddress, userWalletForLimits));
          }
        } catch (updateError) {
          console.log('Limits update after bet failed:', updateError);
        }
      }

      // Record bet on blockchain for verification (platform bets only)
      let onChainBet = null;
      if (paymentMethod === 'platform') {
        onChainBet = await blockchainBetService.recordBetOnChain({
          betId,
          walletAddress: userId,
          eventId: String(eventId),
          prediction,
          betAmount,
          odds,
          txHash: storedBet?.txHash || ''
        });
      }

      // Notify user of bet placement
      notificationService.notifyBetPlaced(userId, {
        ...bet,
        homeTeam: resolvedHomeTeam || 'Home Team',
        awayTeam: resolvedAwayTeam || 'Away Team'
      });


      // Log to monitoring
      monitoringService.logBet({
        betId,
        userId,
        eventId,
        odds,
        amount: betAmount,
        timestamp: Date.now(),
        status: 'pending'
      });

      console.log(`✅ BET PLACED (${paymentMethod}): ${betId} - ${prediction} @ ${odds} odds, Stake: ${betAmount} ${betCurrency}, Potential: ${potentialPayout} ${betCurrency}`);

      try {
        const { sql: roomSql } = await import('drizzle-orm');
        const numericEventId = parseInt(eventId);
        if (!isNaN(numericEventId)) {
          const roomName = (resolvedHomeTeam && resolvedAwayTeam) ? `${resolvedHomeTeam} vs ${resolvedAwayTeam}` : (eventName || `Match #${eventId}`);
          await db.execute(roomSql`
            INSERT INTO chat_rooms (name, event_id, room_type, member_count)
            VALUES (${roomName}, ${numericEventId}, 'match', 0)
            ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
          `);
          console.log(`💬 Chat room ensured for match: ${roomName} (event ${eventId})`);
        }
      } catch (roomErr: any) {
        console.warn('[Chat] Failed to auto-create match room:', roomErr.message);
      }

      // LOYALTY PROGRAM: Award points based on USD value wagered (1 point per $1)
      try {
        const loyaltyWallet = walletAddress || userId;
        if (loyaltyWallet && loyaltyWallet.startsWith('0x')) {
          const pointsEarned = Math.floor(betUsdValue); // 1 point per $1 wagered
          if (pointsEarned > 0) {
            const { users: usersTable } = await import('@shared/schema');
            const { db: loyaltyDb } = await import('./db');
            const { eq: loyaltyEq, sql: loyaltySql } = await import('drizzle-orm');
            
            await loyaltyDb.update(usersTable)
              .set({
                loyaltyPoints: loyaltySql`COALESCE(${usersTable.loyaltyPoints}, 0) + ${pointsEarned}`,
                totalBetVolume: loyaltySql`COALESCE(${usersTable.totalBetVolume}, 0) + ${betUsdValue}`
              })
              .where(loyaltyEq(usersTable.walletAddress, loyaltyWallet));
            
            console.log(`⭐ LOYALTY: +${pointsEarned} points for ${loyaltyWallet.slice(0, 10)}... ($${betUsdValue.toFixed(2)} wagered)`);
          }
        }
      } catch (loyaltyError) {
        console.warn('[LOYALTY] Failed to award points:', loyaltyError);
      }

      // Track bet for promotion (only for on-chain bets with txHash)
      let promotionBonus = { bonusAwarded: false, bonusAmount: 0, newBonusBalance: 0 };
      if (txHash && walletAddress) {
        try {
          promotionBonus = await promotionService.trackBetAndAwardBonus(
            walletAddress,
            betAmount,
            currency as 'SUI' | 'SBETS'
          );
          if (promotionBonus.bonusAwarded) {
            console.log(`🎁 BONUS AWARDED: ${walletAddress.slice(0, 10)}... got $${promotionBonus.bonusAmount} bonus!`);
          }
        } catch (promoError) {
          console.error('Promotion tracking error:', promoError);
        }
      }

      // REFERRAL REWARD: Check if this is user's first bet and they were referred
      const betWallet = walletAddress || userId;
      if (betWallet && betWallet.startsWith('0x')) {
        try {
          const { referrals, bets: betsTable } = await import('@shared/schema');
          const { db: refDb } = await import('./db');
          const { eq: refEq, and: refAnd } = await import('drizzle-orm');
          
          // Check if user was referred and referral is still pending
          const [referral] = await refDb.select().from(referrals)
            .where(refAnd(
              refEq(referrals.referredWallet, betWallet),
              refEq(referrals.status, 'pending')
            ));
          
          if (referral) {
            const REFERRAL_REWARD_SBETS = 1000;
            
            // Eligibility checks BEFORE any state mutation
            if (isWalletBlocked(referral.referrerWallet)) {
              console.log(`🚫 REFERRAL BLOCKED: referrer ${referral.referrerWallet.slice(0, 10)}... is on blocklist`);
            } else {
              let referrerEligible = false;
              try {
                const refBal = await blockchainBetService.getWalletBalance(referral.referrerWallet);
                referrerEligible = refBal.sui >= 0.01;
                if (!referrerEligible) {
                  console.log(`❌ REFERRAL REJECTED: referrer ${referral.referrerWallet.slice(0, 10)}... has ${refBal.sui} SUI (below 0.01)`);
                }
              } catch (balErr) {
                console.error('[REFERRAL] FAIL-CLOSED: Cannot verify referrer balance:', balErr);
              }
              
              if (referrerEligible) {
                // Atomically update status then credit
                const refUpdated = await refDb.update(referrals)
                  .set({ 
                    status: 'rewarded',
                    rewardAmount: REFERRAL_REWARD_SBETS,
                    rewardCurrency: 'SBETS',
                    rewardedAt: new Date()
                  })
                  .where(refAnd(
                    refEq(referrals.id, referral.id),
                    refEq(referrals.status, 'pending')
                  ))
                  .returning({ id: referrals.id });
                
                if (refUpdated.length > 0) {
                  await storage.updateUserBalance(referral.referrerWallet, 0, REFERRAL_REWARD_SBETS);
                  console.log(`🎁 REFERRAL REWARD: ${REFERRAL_REWARD_SBETS} SBETS awarded to referrer ${referral.referrerWallet.slice(0, 10)}... (user ${betWallet.slice(0, 10)}... placed first bet)`);
                }
              }
            }
          }
        } catch (referralError) {
          console.warn('[REFERRAL] Award error (non-critical):', referralError);
        }
      }

      res.json({
        success: true,
        bet: storedBet || bet,
        paymentMethod,
        walrusBlobId,
        walrusUrl: walrusBlobId && !walrusBlobId.startsWith('local_')
          ? `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${walrusBlobId}`
          : null,
        walrusStorageEpoch,
        walrusEndEpoch,
        walrusCost,
        calculations: {
          betAmount,
          platformFee: paymentMethod === 'wallet' ? 0 : platformFee,
          totalDebit: paymentMethod === 'wallet' ? betAmount : totalDebit,
          potentialPayout,
          odds
        },
        onChain: {
          status: paymentMethod === 'wallet' ? 'confirmed' : (onChainBet?.status || 'pending'),
          txHash: txHash || storedBet?.txHash,
          betObjectId: onChainBetId,
          packageId: blockchainBetService.getPackageId()
        },
        promotion: promotionBonus.bonusAwarded ? {
          bonusAwarded: true,
          bonusAmount: promotionBonus.bonusAmount,
          newBonusBalance: promotionBonus.newBonusBalance,
          message: `You earned $${promotionBonus.bonusAmount} bonus! Total bonus: $${promotionBonus.newBonusBalance}`
        } : undefined
      });
      }); // end wallet lock execute
    } catch (error: any) {
      console.error("Bet placement error:", error);
      res.status(500).json({ message: "Failed to place bet" });
    }
  });

  // Build transaction payload for frontend wallet signing
  app.post("/api/bets/build-transaction", async (req: Request, res: Response) => {
    try {
      const { eventId, prediction, betAmount, odds, marketId } = req.body;

      if (!eventId || !prediction || !betAmount || !odds) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const betAmountMist = Math.floor(betAmount * 1e9);
      
      const txPayload = blockchainBetService.buildClientTransaction(
        eventId,
        prediction,
        betAmountMist,
        odds,
        marketId || 'match_winner',
        ''
      );

      res.json({
        success: true,
        transaction: txPayload,
        network: process.env.SUI_NETWORK || 'mainnet',
        instructions: 'Use this payload with your Sui wallet to sign and submit the transaction'
      });
    } catch (error: any) {
      console.error("Transaction build error:", error);
      res.status(500).json({ message: "Failed to build transaction" });
    }
  });

  // Get contract info for frontend
  app.get("/api/contract/info", async (_req: Request, res: Response) => {
    res.json({
      packageId: blockchainBetService.getBettingPackageId(),
      platformId: blockchainBetService.getBettingPlatformId(),
      network: process.env.SUI_NETWORK || 'mainnet',
      revenueWallet: blockchainBetService.getRevenueWallet(),
      adminWallet: blockchainBetService.getAdminWallet(),
      sbetsTokenPackage: blockchainBetService.getPackageId()
    });
  });

  // Get settlement worker status
  app.get("/api/settlement/status", async (_req: Request, res: Response) => {
    const status = settlementWorker.getStatus();
    res.json({
      success: true,
      ...status,
      message: status.isRunning ? 'Settlement worker is active and monitoring for finished matches' : 'Settlement worker is not running'
    });
  });

  // Place a parlay bet (multiple selections)
  app.post("/api/bets/parlay", async (req: Request, res: Response) => {
    try {
      // Validate request
      const validation = validateRequest(ParlaySchema, req.body);
      if (!validation.valid) {
        return res.status(400).json({ 
          message: "Validation failed",
          errors: validation.errors 
        });
      }

      const { userId, selections, betAmount, currency: parlayCurrency, feeCurrency } = validation.data!;
      const userIdStr = String(userId);

      // ANTI-EXPLOIT: Wallet blocklist check (before lock)
      if (userIdStr.startsWith('0x') && isWalletBlocked(userIdStr)) {
        console.log(`🚫 BLOCKED WALLET: Parlay rejected from ${userIdStr.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }

      // ANTI-EXPLOIT: Acquire wallet lock to prevent race conditions
      const parlayLock = userIdStr.startsWith('0x') ? acquireWalletLock(userIdStr) : null;
      const parlayHandler = async () => {

      if (userIdStr.startsWith('0x')) {
        const parlayRateLimit2 = await checkBetRateLimitDB(userIdStr);
        if (!parlayRateLimit2.allowed) {
          return res.status(429).json({
            message: parlayRateLimit2.message || "Daily bet limit reached",
            code: "RATE_LIMIT_EXCEEDED"
          });
        }

        const parlayCooldown2 = await checkBetCooldownDB(userIdStr);
        if (!parlayCooldown2.allowed) {
          return res.status(429).json({
            message: `Please wait ${parlayCooldown2.secondsLeft}s between bets`,
            code: "COOLDOWN_ACTIVE"
          });
        }
      }
      
      const eventIds = selections.map((s: any) => s.eventId);
      const uniqueEventIds = new Set(eventIds);
      if (uniqueEventIds.size < eventIds.length) {
        console.log(`🚫 EXPLOIT BLOCKED: Parlay with duplicate events from ${userIdStr} - ${eventIds.join(', ')}`);
        return res.status(400).json({
          message: "Cannot place parlay with multiple selections from the same match",
          code: "DUPLICATE_EVENT_IN_PARLAY"
        });
      }

      // ANTI-EXPLOIT: Validate all parlay selections reference real events AND check free sports cutoff
      for (const sel of selections) {
        const selEventId = String(sel.eventId);
        const eventLookup = apiSportsService.lookupEventSync(selEventId);
        if (!eventLookup.found) {
          const { freeSportsService } = await import('./services/freeSportsService');
          const freeLookup = freeSportsService.lookupEvent(selEventId);
          if (!freeLookup.found) {
            const esLookup = esportsService.lookupEvent(selEventId);
            if (!esLookup.found) {
              console.log(`🚫 EXPLOIT BLOCKED: Parlay selection references unknown event ${selEventId} from ${userIdStr.slice(0, 12)}...`);
              return res.status(400).json({
                message: "One or more selections reference invalid events. Please refresh and try again.",
                code: "INVALID_PARLAY_EVENT"
              });
            }
            if (esLookup.event?.startTime && new Date(esLookup.event.startTime).getTime() <= Date.now() + 5 * 60 * 1000) {
              return res.status(400).json({
                message: "Betting closes 5 minutes before match start.",
                code: "MATCH_STARTED"
              });
            }
          } else if (freeLookup.shouldBeLive) {
            console.log(`🚫 EXPLOIT BLOCKED: Parlay includes free sport event ${selEventId} within 5min cutoff, from ${userIdStr.slice(0, 12)}...`);
            return res.status(400).json({
              message: "Betting closes 5 minutes before match start.",
              code: "MATCH_STARTED"
            });
          }
        }
        if (eventLookup.found) {
          if (eventLookup.source === 'live') {
            if (eventLookup.minute === undefined || eventLookup.minute === null) {
              console.log(`🚫 EXPLOIT BLOCKED: Parlay leg ${selEventId} live with no minute data — fail-closed`);
              return res.status(400).json({
                message: "Cannot verify match time for a parlay selection. Please try again.",
                code: "UNVERIFIABLE_MATCH_TIME"
              });
            }
            if (eventLookup.minute >= 85) {
              console.log(`🚫 EXPLOIT BLOCKED: Parlay leg ${selEventId} past 85-min cutoff (minute: ${eventLookup.minute})`);
              return res.status(400).json({
                message: "One or more selections are in the final minutes.",
                code: "MATCH_CUTOFF"
              });
            }
          }
          if (eventLookup.shouldBeLive && eventLookup.source !== 'live') {
            console.log(`🚫 EXPLOIT BLOCKED: Parlay includes started event ${selEventId} (not in live API) from ${userIdStr.slice(0, 12)}...`);
            return res.status(400).json({
              message: "One or more selections have already started. Please refresh and try again.",
              code: "MATCH_STARTED"
            });
          }
        }
        
        // ANTI-EXPLOIT: Verify each selection's odds against server cache (FAIL-CLOSED)
        const selOddsCheck = lookupServerOdds(selEventId, sel.prediction, '');
        if (selOddsCheck.found && selOddsCheck.serverOdds && selOddsCheck.maxAllowedOdds) {
          if (sel.odds > selOddsCheck.maxAllowedOdds) {
            console.log(`❌ PARLAY ODDS MANIPULATION BLOCKED: selection ${selEventId} submitted=${sel.odds}, server=${selOddsCheck.serverOdds}, max=${selOddsCheck.maxAllowedOdds}, wallet=${userIdStr.slice(0,12)}...`);
            return res.status(400).json({
              message: "Odds have changed for one or more selections. Please refresh and try again.",
              code: "ODDS_MISMATCH"
            });
          }
        } else if (selOddsCheck.found && selOddsCheck.source && selOddsCheck.source !== 'api-sports-no-odds') {
          console.log(`❌ PARLAY FAIL-CLOSED: selection ${selEventId} event found but selection unmappable, wallet=${userIdStr.slice(0,12)}...`);
          return res.status(400).json({
            message: "Could not verify odds for one or more selections. Please refresh and try again.",
            code: "ODDS_UNMAPPABLE"
          });
        } else if (sel.odds > MAX_ODDS_CAP_FUTURES) {
          console.log(`❌ PARLAY ODDS CAP: selection ${selEventId} odds ${sel.odds} > max ${MAX_ODDS_CAP_FUTURES}, wallet=${userIdStr.slice(0,12)}...`);
          return res.status(400).json({
            message: "Odds appear unusually high for one or more selections. Please refresh and try again.",
            code: "ODDS_TOO_HIGH"
          });
        }
      }

      // ANTI-EXPLOIT: Total parlay odds tolerance check (prevents per-leg tolerance compounding)
      // Even if each leg passes the 10% tolerance individually, the combined inflation must stay under 15%
      {
        let serverProduct = 1;
        let submittedProduct = 1;
        let allVerified = true;
        for (const sel of selections) {
          const selEventId = sel.externalEventId || sel.eventId || '';
          const selOddsCheck = lookupServerOdds(selEventId, sel.prediction, '');
          if (selOddsCheck.found && selOddsCheck.serverOdds) {
            serverProduct *= selOddsCheck.serverOdds;
          } else {
            allVerified = false;
          }
          submittedProduct *= sel.odds;
        }
        if (allVerified && serverProduct > 0) {
          const totalMaxAllowed = serverProduct * (1 + ODDS_TOLERANCE);
          if (submittedProduct > totalMaxAllowed) {
            console.log(`❌ PARLAY TOTAL ODDS INFLATION: submitted=${submittedProduct.toFixed(3)}, serverProduct=${serverProduct.toFixed(3)}, maxAllowed=${totalMaxAllowed.toFixed(3)}, wallet=${userIdStr.slice(0,12)}...`);
            return res.status(400).json({
              message: "Combined parlay odds exceed allowed margin. Please refresh and try again.",
              code: "PARLAY_ODDS_INFLATION"
            });
          }
        }
      }

      const currency: string = parlayCurrency === 'USDSUI' || feeCurrency === 'USDSUI' ? 'USDSUI' : parlayCurrency === 'SBETS' || feeCurrency === 'SBETS' ? 'SBETS' : 'SUI';
      
      if (SUI_BETTING_PAUSED && currency !== 'SBETS') {
        console.log(`❌ SUI parlay blocked - betting paused until treasury funded`);
        return res.status(400).json({
          message: SUI_PAUSE_MESSAGE,
          code: "SUI_BETTING_PAUSED"
        });
      }
      
      // MAX STAKE VALIDATION - Backend enforcement
      const MAX_STAKE_SUI = RUNTIME_MAX_STAKE_SUI;
      const MAX_STAKE_SBETS = RUNTIME_MAX_STAKE_SBETS;
      const MAX_STAKE_USDSUI_P = RUNTIME_MAX_STAKE_USDSUI;
      const maxStake = currency === 'SBETS' ? MAX_STAKE_SBETS : currency === 'USDSUI' ? MAX_STAKE_USDSUI_P : MAX_STAKE_SUI;
      
      if (betAmount > maxStake) {
        console.log(`❌ Parlay rejected (max stake exceeded): ${betAmount} ${currency} > ${maxStake} ${currency}`);
        return res.status(400).json({
          message: `Maximum stake is ${maxStake.toLocaleString()} ${currency}`,
          code: "MAX_STAKE_EXCEEDED"
        });
      }

      const parlayExposure = await getWalletPendingExposure(userIdStr);
      const parlayExpLimit = getMaxExposureForCurrency(currency);
      const parlayCurrentExp = currency === 'SBETS' ? parlayExposure.sbets : currency === 'USDSUI' ? (parlayExposure.usdsui || 0) : parlayExposure.sui;
      const parlayNewPayout = betAmount * selections.reduce((acc: number, sel: any) => acc * sel.odds, 1);
      if (parlayCurrentExp + parlayNewPayout > parlayExpLimit) {
        console.log(`❌ PARLAY EXPOSURE: ${userIdStr.slice(0,12)}... current=${parlayCurrentExp.toLocaleString()} + new=${parlayNewPayout.toLocaleString()} > max ${parlayExpLimit.toLocaleString()} ${currency}`);
        return res.status(400).json({
          message: `Maximum pending exposure would be exceeded. Wait for active bets to settle.`,
          code: "MAX_EXPOSURE_EXCEEDED"
        });
      }

      // Check user balance (using async for accurate DB read)
      const balance = await balanceService.getBalanceAsync(userIdStr);
      
      const PARLAY_PER_LEG_CAP = MAX_ODDS_CAP_FUTURES;
      const highOddsLeg = selections.find((sel: any) => sel.odds > PARLAY_PER_LEG_CAP);
      if (highOddsLeg) {
        console.log(`❌ PARLAY LEG ODDS CAP: leg odds=${highOddsLeg.odds} > max ${PARLAY_PER_LEG_CAP}, wallet=${userIdStr.slice(0,12)}...`);
        return res.status(400).json({
          message: `Maximum odds per selection is ${PARLAY_PER_LEG_CAP}x. Please remove high-odds selections.`,
          code: "MAX_ODDS_EXCEEDED"
        });
      }

      const parlayOdds = selections.reduce((acc: number, sel: any) => acc * sel.odds, 1);
      
      if (!isFinite(parlayOdds) || parlayOdds <= 0) {
        return res.status(400).json({ message: "Invalid parlay odds calculation" });
      }

      const PARLAY_MAX_COMBINED_ODDS = 15;
      if (parlayOdds > PARLAY_MAX_COMBINED_ODDS) {
        console.log(`❌ PARLAY COMBINED ODDS CAP: combined=${parlayOdds.toFixed(2)} > max ${PARLAY_MAX_COMBINED_ODDS}, wallet=${userIdStr.slice(0,12)}...`);
        return res.status(400).json({
          message: `Combined parlay odds of ${parlayOdds.toFixed(1)}x exceed the maximum (${PARLAY_MAX_COMBINED_ODDS}x). Please reduce your selections.`,
          code: "PARLAY_ODDS_TOO_HIGH"
        });
      }

      // ANTI-EXPLOIT: Max payout cap for parlays
      const parlayMaxPayout = getMaxPayoutForCurrency(currency);
      const parlayProjectedPayout = betAmount * parlayOdds;
      if (parlayProjectedPayout > parlayMaxPayout) {
        const safeStake = Math.floor(parlayMaxPayout / parlayOdds);
        console.log(`❌ PARLAY PAYOUT CAP: projected ${parlayProjectedPayout} ${currency} > max ${parlayMaxPayout} ${currency}, wallet=${userIdStr.slice(0,12)}...`);
        return res.status(400).json({
          message: `Maximum potential payout is ${parlayMaxPayout.toLocaleString()} ${currency}. Try a stake of ${safeStake.toLocaleString()} ${currency} or less.`,
          code: "MAX_PAYOUT_EXCEEDED",
          suggestedStake: safeStake
        });
      }

      const platformFee = betAmount * 0.01; // 1% platform fee
      const totalDebit = betAmount + platformFee;

      const availableBalance = currency === 'SBETS' ? balance.sbetsBalance : currency === 'USDSUI' ? (balance.usdsuiBalance || 0) : balance.suiBalance;
      if (availableBalance < totalDebit) {
        return res.status(400).json({ 
          message: `Insufficient balance. Required: ${totalDebit} ${currency}, Available: ${availableBalance} ${currency}`
        });
      }

      // Deduct bet from balance (with currency support)
      const deductSuccess = await balanceService.deductForBet(userIdStr, betAmount, platformFee, currency);
      if (!deductSuccess) {
        return res.status(400).json({ message: "Failed to deduct bet amount from balance" });
      }

      const potentialPayout = Math.round(betAmount * parlayOdds * 100) / 100;

      const parlayId = `parlay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const parlay = {
        id: parlayId,
        userId: userIdStr,
        selections,
        odds: parlayOdds,
        betAmount,
        currency,
        status: 'pending' as const,
        placedAt: Date.now(),
        potentialPayout,
        platformFee,
        totalDebit,
        selectionCount: selections.length
      };

      // Store parlay in storage
      const storedParlay = await storage.createParlay(parlay);

      // Notify user
      notificationService.createNotification(
        userIdStr,
        'bet_placed',
        `Parlay Placed: ${selections.length} Selections`,
        `${selections.length}-leg parlay @ ${parlayOdds.toFixed(2)} odds. Stake: ${betAmount} ${currency}, Potential: ${potentialPayout} ${currency}`,
        parlay
      );


      // Log to monitoring
      monitoringService.logBet({
        betId: parlayId,
        userId: userIdStr,
        eventId: 'parlay',
        odds: parlayOdds,
        amount: betAmount,
        timestamp: Date.now(),
        status: 'pending'
      });

      console.log(`🔥 PARLAY PLACED: ${parlayId} - ${selections.length} selections @ ${parlayOdds.toFixed(2)} odds, Stake: ${betAmount} ${currency}, Potential: ${potentialPayout} ${currency}`);

      let parlayWalrusBlobId: string | null = null;
      try {
        const { storeBetReceipt } = await import('./services/walrusStorageService');
        const parlayLegsStr = selections.map((s: any) => `${s.eventName || s.eventId}: ${s.selection || s.prediction}`).join(' | ');
        const walrusResult = await storeBetReceipt({
          betId: parlayId,
          walletAddress: userIdStr,
          eventId: selections.map((s: any) => s.eventId).join(','),
          eventName: `Parlay (${selections.length} legs): ${parlayLegsStr}`,
          homeTeam: selections[0]?.homeTeam || '',
          awayTeam: selections[0]?.awayTeam || '',
          prediction: parlayLegsStr,
          odds: parlayOdds,
          stake: betAmount,
          currency,
          potentialPayout,
          placedAt: Date.now(),
        });
        const { bets: betsTable } = await import('@shared/schema');
        const { db: walrusDb } = await import('./db');
        const { eq: walrusEq } = await import('drizzle-orm');
        const updateFields: any = { walrusReceiptData: walrusResult.receiptJson };
        if (walrusResult.blobId) {
          updateFields.walrusBlobId = walrusResult.blobId;
          parlayWalrusBlobId = walrusResult.blobId;
        } else {
          updateFields.walrusBlobId = `local_${walrusResult.receiptHash}`;
          parlayWalrusBlobId = updateFields.walrusBlobId;
        }
        const walrusUpdateResult = await walrusDb.update(betsTable)
          .set(updateFields)
          .where(walrusEq(betsTable.wurlusBetId, parlayId))
          .returning({ id: betsTable.id });
        console.log(`🐋 Parlay receipt saved: ${parlayId}: ${updateFields.walrusBlobId} (${walrusUpdateResult.length} rows updated)`);
      } catch (walrusErr: any) {
        console.warn(`[Walrus] Parlay receipt failed: ${walrusErr.message}`);
      }

      res.json({
        success: true,
        parlay: storedParlay || parlay,
        walrusBlobId: parlayWalrusBlobId,
        walrusUrl: parlayWalrusBlobId && !parlayWalrusBlobId.startsWith('local_')
          ? `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${parlayWalrusBlobId}`
          : null,
        calculations: {
          betAmount,
          platformFee,
          totalDebit,
          potentialPayout,
          parlayOdds,
          legCount: selections.length
        }
      });
      }; // end parlayHandler
      if (parlayLock) {
        return await parlayLock.execute(parlayHandler);
      } else {
        return await parlayHandler();
      }
    } catch (error: any) {
      console.error("Parlay placement error:", error);
      res.status(500).json({ message: "Failed to place parlay" });
    }
  });

  // On-chain parlay endpoint - called from frontend after successful on-chain transaction
  // This stores the on-chain bet object ID for settlement
  app.post("/api/parlays", async (req: Request, res: Response) => {
    try {
      const { 
        userId, 
        walletAddress, 
        totalOdds, 
        betAmount, 
        potentialPayout, 
        currency: onChainParlayCurrency,
        feeCurrency, 
        txHash, 
        onChainBetId, 
        status, 
        legs 
      } = req.body;

      const onChainParlayWallet = walletAddress || userId;
      if (onChainParlayWallet && isWalletBlocked(onChainParlayWallet)) {
        return res.status(403).json({ message: "This wallet has been suspended.", code: "WALLET_BLOCKED" });
      }

      const onChainParlayLock = onChainParlayWallet?.startsWith('0x') ? acquireWalletLock(onChainParlayWallet) : null;
      const onChainParlayHandler = async () => {

      // ON-CHAIN bets: Skip rate limit & cooldown when txHash proves funds already moved on-chain
      // Blocking the DB record after on-chain tx = lost bets (user pays but bet never recorded)
      if (!txHash && onChainParlayWallet?.startsWith('0x')) {
        const rl = await checkBetRateLimitDB(onChainParlayWallet);
        if (!rl.allowed) return res.status(429).json({ message: rl.message, code: "RATE_LIMIT_EXCEEDED" });
        const cd = await checkBetCooldownDB(onChainParlayWallet);
        if (!cd.allowed) return res.status(429).json({ message: `Please wait ${cd.secondsLeft}s between bets`, code: "BET_COOLDOWN" });
      }

      if (txHash) {
        try {
          const existingParlay = await storage.getBetByTxHash(txHash);
          if (existingParlay) {
            console.log(`⚡ Duplicate txHash detected (parlay retry-safe): ${txHash.slice(0, 12)}... → returning existing bet`);
            return res.status(200).json({ ...existingParlay, duplicate: true });
          }
        } catch (dupErr) {
          console.error('[TxDedup-Parlay] Check failed - FAIL CLOSED:', dupErr);
          return res.status(503).json({
            message: "Unable to verify transaction uniqueness. Please try again.",
            code: "DEDUP_CHECK_FAILED"
          });
        }
      }

      // ANTI-EXPLOIT: Wallet blocklist check (check both walletAddress and userId)
      const parlayWallet = walletAddress || userId;
      if (parlayWallet && isWalletBlocked(parlayWallet)) {
        console.log(`🚫 BLOCKED WALLET: On-chain parlay rejected from ${parlayWallet.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }
      if (walletAddress && userId && walletAddress !== userId && isWalletBlocked(userId)) {
        console.log(`🚫 BLOCKED WALLET: On-chain parlay rejected (userId) from ${userId.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }

      if (!isValidSuiWallet(walletAddress)) {
        return res.status(400).json({
          message: "Valid Sui wallet address is required for on-chain parlays.",
          code: "MISSING_WALLET"
        });
      }

      // ANTI-EXPLOIT: Strict input validation for on-chain parlays
      if (!Array.isArray(legs) || legs.length < 2 || legs.length > 10) {
        return res.status(400).json({
          message: "Parlay must have between 2 and 10 selections.",
          code: "INVALID_PARLAY_LEGS"
        });
      }
      if (typeof totalOdds !== 'number' || !isFinite(totalOdds) || totalOdds < 1.01 || totalOdds > 50) {
        return res.status(400).json({
          message: "Invalid total odds.",
          code: "INVALID_TOTAL_ODDS"
        });
      }
      if (typeof betAmount !== 'number' || !isFinite(betAmount) || betAmount <= 0) {
        return res.status(400).json({
          message: "Invalid bet amount.",
          code: "INVALID_BET_AMOUNT"
        });
      }
      for (const leg of legs) {
        if (!leg.eventId || typeof leg.odds !== 'number' || !isFinite(leg.odds) || leg.odds < 1.01 || leg.odds > 50) {
          return res.status(400).json({
            message: "Each selection must have a valid event and odds (1.01 - 50).",
            code: "INVALID_PARLAY_LEG"
          });
        }
      }
      // Verify totalOdds matches product of individual leg odds (within 5% tolerance)
      const computedTotalOdds = legs.reduce((acc: number, l: any) => acc * (l.odds || 1), 1);
      if (Math.abs(computedTotalOdds - totalOdds) / computedTotalOdds > 0.05) {
        console.log(`❌ PARLAY ODDS MISMATCH: submitted totalOdds=${totalOdds}, computed=${computedTotalOdds.toFixed(4)}, wallet=${walletAddress.slice(0,12)}...`);
        return res.status(400).json({
          message: "Total odds do not match individual selections.",
          code: "TOTAL_ODDS_MISMATCH"
        });
      }

      const currency: string = onChainParlayCurrency === 'USDSUI' || feeCurrency === 'USDSUI' ? 'USDSUI' : onChainParlayCurrency === 'SBETS' || feeCurrency === 'SBETS' ? 'SBETS' : 'SUI';

      if (!txHash) {
        const parlayRateLimit = await checkBetRateLimitDB(walletAddress);
        if (!parlayRateLimit.allowed) {
          return res.status(429).json({
            message: parlayRateLimit.message || "Daily bet limit reached",
            code: "RATE_LIMIT_EXCEEDED"
          });
        }

        const parlayCooldown = await checkBetCooldownDB(walletAddress);
        if (!parlayCooldown.allowed) {
          return res.status(429).json({
            message: `Please wait ${parlayCooldown.secondsLeft}s between bets`,
            code: "COOLDOWN_ACTIVE"
          });
        }
      }

      // MAX STAKE VALIDATION
      const MAX_STAKE_SUI = RUNTIME_MAX_STAKE_SUI;
      const MAX_STAKE_SBETS = RUNTIME_MAX_STAKE_SBETS;
      const MAX_STAKE_USDSUI_OC = RUNTIME_MAX_STAKE_USDSUI;
      const maxStake = currency === 'SBETS' ? MAX_STAKE_SBETS : currency === 'USDSUI' ? MAX_STAKE_USDSUI_OC : MAX_STAKE_SUI;
      if (betAmount > maxStake) {
        console.log(`❌ On-chain parlay rejected (max stake exceeded): ${betAmount} ${currency} > ${maxStake} ${currency}`);
        return res.status(400).json({
          message: `Maximum stake is ${maxStake.toLocaleString()} ${currency}`,
          code: "MAX_STAKE_EXCEEDED"
        });
      }
      
      if (legs && Array.isArray(legs) && legs.length > 1) {
        const legEventIds = legs.map((l: any) => l.eventId);
        const uniqueLegEventIds = new Set(legEventIds);
        if (uniqueLegEventIds.size < legEventIds.length) {
          console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay with duplicate events from ${walletAddress} - ${legEventIds.join(', ')}`);
          return res.status(400).json({
            message: "Cannot place parlay with multiple selections from the same match",
            code: "DUPLICATE_EVENT_IN_PARLAY"
          });
        }
      }

      // ANTI-EXPLOIT: Validate all parlay legs reference real events AND check free sports cutoff
      if (legs && Array.isArray(legs)) {
        for (const leg of legs) {
          const legEventId = String(leg.eventId || '');
          if (!legEventId) {
            console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay has leg with no event ID from ${walletAddress}`);
            return res.status(400).json({
              message: "Invalid parlay - all selections must reference valid events.",
              code: "INVALID_PARLAY_EVENT"
            });
          }
          const eventLookup = apiSportsService.lookupEventSync(legEventId);
          if (!eventLookup.found) {
            const { freeSportsService } = await import('./services/freeSportsService');
            const freeLookup = freeSportsService.lookupEvent(legEventId);
            if (!freeLookup.found) {
              const esLookup2 = esportsService.lookupEvent(legEventId);
              if (!esLookup2.found) {
                console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay leg references unknown event ${legEventId} from ${walletAddress}`);
                return res.status(400).json({
                  message: "One or more selections reference invalid events.",
                  code: "INVALID_PARLAY_EVENT"
                });
              }
              if (esLookup2.event?.startTime && new Date(esLookup2.event.startTime).getTime() <= Date.now() + 5 * 60 * 1000) {
                return res.status(400).json({
                  message: "Betting closes 5 minutes before match start.",
                  code: "MATCH_STARTED"
                });
              }
            } else if (freeLookup.shouldBeLive) {
              console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay includes free sport event ${legEventId} within 5min cutoff, from ${walletAddress}`);
              return res.status(400).json({
                message: "Betting closes 5 minutes before match start.",
                code: "MATCH_STARTED"
              });
            }
          }
          if (eventLookup.found) {
            if (eventLookup.source === 'live') {
              if (eventLookup.minute === undefined || eventLookup.minute === null) {
                console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay leg ${legEventId} live with no minute data — fail-closed`);
                return res.status(400).json({
                  message: "Cannot verify match time for a parlay selection. Please try again.",
                  code: "UNVERIFIABLE_MATCH_TIME"
                });
              }
              if (eventLookup.minute >= 85) {
                console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay leg ${legEventId} past 85-min cutoff (minute: ${eventLookup.minute})`);
                return res.status(400).json({
                  message: "One or more selections are in the final minutes.",
                  code: "MATCH_CUTOFF"
                });
              }
            }
            if (eventLookup.shouldBeLive && eventLookup.source !== 'live') {
              console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay includes started event ${legEventId} (not in live API) from ${walletAddress}`);
              return res.status(400).json({
                message: "One or more selections have already started. Please refresh and try again.",
                code: "MATCH_STARTED"
              });
            }
          }
          
          // ANTI-EXPLOIT: Per-leg cap for parlays (combined odds + payout caps do the real protection)
          const ON_CHAIN_PARLAY_LEG_CAP = MAX_ODDS_CAP_FUTURES;
          if (leg.odds && typeof leg.odds === 'number' && leg.odds > ON_CHAIN_PARLAY_LEG_CAP) {
            console.log(`❌ ON-CHAIN PARLAY LEG ODDS CAP: leg ${legEventId} odds=${leg.odds} > max ${ON_CHAIN_PARLAY_LEG_CAP}, wallet=${walletAddress.slice(0,12)}...`);
            return res.status(400).json({
              message: `Individual leg odds cannot exceed ${ON_CHAIN_PARLAY_LEG_CAP}x. Please refresh and try again.`,
              code: "LEG_ODDS_TOO_HIGH"
            });
          }

          // ANTI-EXPLOIT: Verify each on-chain parlay leg's odds against server cache (FAIL-CLOSED)
          if (leg.odds && typeof leg.odds === 'number') {
            const legOddsCheck = lookupServerOdds(legEventId, leg.prediction || '', '');
            if (legOddsCheck.found && legOddsCheck.serverOdds && legOddsCheck.maxAllowedOdds) {
              if (leg.odds > legOddsCheck.maxAllowedOdds) {
                console.log(`❌ ON-CHAIN PARLAY ODDS BLOCKED: leg ${legEventId} submitted=${leg.odds}, server=${legOddsCheck.serverOdds}, max=${legOddsCheck.maxAllowedOdds}, wallet=${walletAddress.slice(0,12)}...`);
                return res.status(400).json({
                  message: "Odds have changed for one or more selections. Please refresh and try again.",
                  code: "ODDS_MISMATCH"
                });
              }
            } else if (legOddsCheck.found && legOddsCheck.source && legOddsCheck.source !== 'api-sports-no-odds') {
              console.log(`❌ ON-CHAIN PARLAY FAIL-CLOSED: leg ${legEventId} event found but selection unmappable, wallet=${walletAddress.slice(0,12)}...`);
              return res.status(400).json({
                message: "Could not verify odds for one or more selections. Please refresh and try again.",
                code: "ODDS_UNMAPPABLE"
              });
            } else if (leg.odds > MAX_ODDS_CAP_FUTURES) {
              console.log(`❌ ON-CHAIN PARLAY ODDS CAP: leg ${legEventId} odds ${leg.odds} > max ${MAX_ODDS_CAP_FUTURES}, wallet=${walletAddress.slice(0,12)}...`);
              return res.status(400).json({
                message: "Odds appear unusually high. Please refresh and try again.",
                code: "ODDS_TOO_HIGH"
              });
            }
          }
        }
      }
      
      // ANTI-EXPLOIT: Total on-chain parlay odds tolerance check (prevents per-leg tolerance compounding)
      if (legs && Array.isArray(legs) && legs.length > 0) {
        let ocServerProduct = 1;
        let ocSubmittedProduct = 1;
        let ocAllVerified = true;
        for (const leg of legs) {
          const legEventId = leg.externalEventId || leg.eventId || '';
          const legOC = lookupServerOdds(legEventId, leg.prediction || '', '');
          if (legOC.found && legOC.serverOdds) {
            ocServerProduct *= legOC.serverOdds;
          } else {
            ocAllVerified = false;
          }
          ocSubmittedProduct *= (leg.odds || 1);
        }
        if (ocAllVerified && ocServerProduct > 0) {
          const ocMaxAllowed = ocServerProduct * (1 + ODDS_TOLERANCE);
          if (ocSubmittedProduct > ocMaxAllowed) {
            console.log(`❌ ON-CHAIN PARLAY TOTAL INFLATION: submitted=${ocSubmittedProduct.toFixed(3)}, server=${ocServerProduct.toFixed(3)}, max=${ocMaxAllowed.toFixed(3)}, wallet=${walletAddress.slice(0,12)}...`);
            return res.status(400).json({
              message: "Combined parlay odds exceed allowed margin. Please refresh and try again.",
              code: "PARLAY_ODDS_INFLATION"
            });
          }
        }
      }

      // ANTI-EXPLOIT: Max payout cap + combined odds cap for on-chain parlays
      if (legs && Array.isArray(legs) && legs.length > 0) {
        const onChainParlayOdds = legs.reduce((acc: number, l: any) => acc * (l.odds || 1), 1);
        const ONCHAIN_PARLAY_MAX_COMBINED = 15;
        if (isFinite(onChainParlayOdds) && onChainParlayOdds > ONCHAIN_PARLAY_MAX_COMBINED) {
          console.log(`❌ ON-CHAIN PARLAY ODDS CAP: combined=${onChainParlayOdds.toFixed(2)} > max ${ONCHAIN_PARLAY_MAX_COMBINED}, wallet=${walletAddress.slice(0,12)}...`);
          return res.status(400).json({
            message: `Combined parlay odds of ${onChainParlayOdds.toFixed(1)}x exceed the maximum (${ONCHAIN_PARLAY_MAX_COMBINED}x). Please reduce your selections.`,
            code: "PARLAY_ODDS_TOO_HIGH"
          });
        }
        const onChainParlayMaxPay = getMaxPayoutForCurrency(currency);
        if (isFinite(onChainParlayOdds) && betAmount * onChainParlayOdds > onChainParlayMaxPay) {
          const safeStakeOnChain = Math.floor(onChainParlayMaxPay / onChainParlayOdds);
          console.log(`❌ ON-CHAIN PARLAY PAYOUT CAP: projected ${betAmount * onChainParlayOdds} ${currency} > max ${onChainParlayMaxPay}, wallet=${walletAddress.slice(0,12)}...`);
          return res.status(400).json({
            message: `Maximum potential payout is ${onChainParlayMaxPay.toLocaleString()} ${currency}. Try a stake of ${safeStakeOnChain.toLocaleString()} ${currency} or less.`,
            code: "MAX_PAYOUT_EXCEEDED",
            suggestedStake: safeStakeOnChain
          });
        }
      }

      // ANTI-EXPLOIT: Wallet exposure check for on-chain parlays (additive)
      const onChainExposure = await getWalletPendingExposure(walletAddress);
      const exposureLimit = getMaxExposureForCurrency(currency);
      const currentExposure = currency === 'SBETS' ? onChainExposure.sbets : currency === 'USDSUI' ? (onChainExposure.usdsui || 0) : onChainExposure.sui;
      const onChainNewPayout = legs && Array.isArray(legs) ? betAmount * legs.reduce((a: number, l: any) => a * (l.odds || 1), 1) : betAmount * 2;
      if (currentExposure + onChainNewPayout > exposureLimit) {
        console.log(`❌ ON-CHAIN PARLAY EXPOSURE: ${walletAddress.slice(0,12)}... current=${currentExposure.toLocaleString()} + new=${onChainNewPayout.toLocaleString()} > max ${exposureLimit.toLocaleString()} ${currency}`);
        return res.status(400).json({
          message: `Maximum pending exposure would be exceeded. Wait for active bets to settle.`,
          code: "MAX_EXPOSURE_EXCEEDED"
        });
      }
      
      // SBETS BALANCE VERIFICATION for parlays
      // Only skip when BOTH txHash AND onChainBetId confirm a real on-chain transaction
      const isParlayOnChainConfirmed = !!(txHash && onChainBetId);
      if (currency === 'SBETS' && !isParlayOnChainConfirmed) {
        try {
          const userBal = await blockchainBetService.getWalletBalance(walletAddress);
          if (userBal.sbets < betAmount) {
            console.log(`❌ SBETS parlay rejected: wallet ${walletAddress.slice(0,10)}... has ${userBal.sbets} SBETS but tried to bet ${betAmount}`);
            return res.status(400).json({
              message: `Insufficient SBETS balance. You have ${userBal.sbets.toLocaleString()} SBETS but tried to bet ${betAmount.toLocaleString()} SBETS.`,
              code: "INSUFFICIENT_SBETS_BALANCE"
            });
          }
        } catch (balCheckErr) {
          console.error('[PARLAY] FAIL-CLOSED: Cannot verify SBETS balance:', balCheckErr);
          return res.status(503).json({
            message: "Unable to verify your SBETS balance. Please try again.",
            code: "BALANCE_CHECK_FAILED"
          });
        }
      }
      
      const parlayId = onChainBetId || `parlay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      console.log(`📦 ON-CHAIN PARLAY: ${parlayId} from ${walletAddress}`);
      console.log(`📦 Legs: ${legs?.length || 0}, Odds: ${totalOdds}, Stake: ${betAmount} ${currency}`);
      console.log(`📦 txHash: ${txHash}, betObjectId: ${onChainBetId}`);

      const parlay = {
        id: parlayId,
        userId: walletAddress || userId,
        selections: legs || [],
        combinedOdds: totalOdds,
        totalStake: betAmount,
        potentialPayout: potentialPayout || (betAmount * totalOdds),
        currency,
        status: status || 'pending',
        txHash,
        onChainBetId, // CRITICAL: Pass betObjectId for on-chain settlement
        platformFee: betAmount * 0.01,
        networkFee: 0,
      };

      const storedParlay = await storage.createParlay(parlay);

      console.log(`✅ ON-CHAIN PARLAY STORED: ${parlayId} with betObjectId: ${onChainBetId}`);

      (async () => {
        try {
          const { storeBetReceipt } = await import('./services/walrusStorageService');
          const parlayLegsStr = (legs || []).map((l: any) => `${l.eventName || l.eventId}: ${l.selection || l.prediction}`).join(' | ');
          const walrusResult = await storeBetReceipt({
            betId: parlayId,
            walletAddress: walletAddress || userId,
            eventId: (legs || []).map((l: any) => l.eventId).join(','),
            eventName: `Parlay (${legs?.length || 0} legs): ${parlayLegsStr}`,
            homeTeam: legs?.[0]?.homeTeam || '',
            awayTeam: legs?.[0]?.awayTeam || '',
            prediction: parlayLegsStr,
            odds: totalOdds,
            stake: betAmount,
            currency,
            potentialPayout: potentialPayout || (betAmount * totalOdds),
            txHash: txHash || undefined,
            betObjectId: onChainBetId || undefined,
            placedAt: Date.now(),
          });
          const { bets: betsTable } = await import('@shared/schema');
          const { db: walrusDb } = await import('./db');
          const { eq: walrusEq } = await import('drizzle-orm');
          const updateFields: any = { walrusReceiptData: walrusResult.receiptJson };
          if (walrusResult.blobId) {
            updateFields.walrusBlobId = walrusResult.blobId;
          } else {
            updateFields.walrusBlobId = `local_${walrusResult.receiptHash}`;
          }
          const walrusUpdateResult = await walrusDb.update(betsTable)
            .set(updateFields)
            .where(walrusEq(betsTable.wurlusBetId, parlayId))
            .returning({ id: betsTable.id });
          console.log(`🐋 On-chain parlay receipt saved: ${parlayId}: ${updateFields.walrusBlobId} (${walrusUpdateResult.length} rows updated)`);
        } catch (walrusErr: any) {
          console.warn(`[Walrus] On-chain parlay receipt failed: ${walrusErr.message}`);
        }
      })();

      res.json({
        success: true,
        parlay: storedParlay,
        bet: storedParlay
      });
      }; // end onChainParlayHandler
      if (onChainParlayLock) {
        return await onChainParlayLock.execute(onChainParlayHandler);
      } else {
        return await onChainParlayHandler();
      }
    } catch (error: any) {
      console.error("On-chain parlay storage error:", error);
      res.status(500).json({ message: "Failed to store parlay" });
    }
  });

  const walletSyncInProgress = new Set<string>();
  const walletSyncLastAttempt = new Map<string, number>();
  const WALLET_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

  app.get('/api/bets/recent-feed', async (_req: Request, res: Response) => {
    try {
      const { bets } = await import('@shared/schema');
      const { desc, sql } = await import('drizzle-orm');
      const recentRows = await db.select().from(bets).orderBy(desc(bets.createdAt)).limit(20);

      const sportNameMap: Record<number, string> = {
        1: 'soccer', 2: 'basketball', 3: 'tennis', 4: 'american-football',
        5: 'baseball', 6: 'ice-hockey', 7: 'mma', 8: 'boxing', 9: 'esports',
        10: 'afl', 11: 'formula-1', 13: 'basketball', 14: 'american-football',
        17: 'horse-racing', 18: 'cricket',
      };

      const maskWallet = (addr: string) => {
        if (!addr || addr.length < 10) return '0x****';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      };

      const feed = recentRows.map((b: any) => {
        const isParlay = b.betType === 'parlay' || (b.prediction && typeof b.prediction === 'string' && b.prediction.startsWith('['));
        let displayTeam = b.eventName || b.prediction || 'Unknown';
        let legCount = 0;

        if (isParlay) {
          try {
            const legs = JSON.parse(b.prediction);
            if (Array.isArray(legs) && legs.length > 0) {
              legCount = legs.length;
              const teamNames = legs.map((l: any) => l.prediction || l.homeTeam || l.eventName || '').filter(Boolean);
              displayTeam = teamNames.length > 0 ? teamNames.join(' + ') : `${legs.length}-Leg Parlay`;
            }
          } catch {
            if (typeof b.prediction === 'string' && b.prediction.startsWith('parlay_')) {
              displayTeam = b.eventName || 'Parlay Bet';
            }
          }
        } else if (typeof displayTeam === 'string' && /^\d+$/.test(displayTeam)) {
          displayTeam = b.eventName || 'Match Bet';
        }

        const rawAmount = Number(b.betAmount) || 0;
        const currency = b.currency || b.feeCurrency || 'SUI';
        const isSbets = currency.toUpperCase().includes('SBETS');
        const displayAmount = isSbets && rawAmount > 1000 ? Math.round(rawAmount).toLocaleString('en-US') : rawAmount.toFixed(2);

        return {
          id: String(b.id),
          wallet: maskWallet(b.walletAddress || ''),
          amount: displayAmount,
          currency: isSbets ? 'SBETS' : 'SUI',
          team: displayTeam,
          odds: (b.odds || 1).toFixed(2),
          sport: sportNameMap[b.sportId || 1] || 'soccer',
          timestamp: b.createdAt ? new Date(b.createdAt).getTime() : Date.now(),
          isParlay,
          legCount,
          status: b.status || 'pending',
        };
      });

      res.json(feed);
    } catch (error) {
      console.error('Recent feed error:', error);
      res.json([]);
    }
  });

  app.get("/api/bets", async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      const userId = req.query.userId as string;
      const status = req.query.status as string | undefined;
      
      if (!wallet && !userId) {
        return res.json([]);
      }
      
      const lookupId = wallet || userId;
      let userBets = await storage.getUserBets(lookupId);

      const wLower = wallet?.toLowerCase();
      const lastAttempt = wLower ? (walletSyncLastAttempt.get(wLower) || 0) : Infinity;
      const cooldownExpired = Date.now() - lastAttempt > WALLET_SYNC_COOLDOWN_MS;

      if (wallet && isValidSuiWallet(wallet) && userBets.length === 0 && cooldownExpired && !walletSyncInProgress.has(wLower)) {
        walletSyncInProgress.add(wLower);
        walletSyncLastAttempt.set(wLower, Date.now());
        console.log(`🔄 Auto-sync triggered for wallet with 0 bets: ${wallet.slice(0, 12)}...`);
        try {
          const syncResult = await recoverBetsForWallet(wallet);
          walletSyncInProgress.delete(wLower);
          if (syncResult.recovered > 0) {
            console.log(`✅ Auto-sync recovered ${syncResult.recovered} bets for ${wallet.slice(0, 12)}...`);
            userBets = await storage.getUserBets(lookupId);
          }
          if (syncResult.errors > 0) {
            walletSyncLastAttempt.set(wLower, Date.now() - WALLET_SYNC_COOLDOWN_MS + 60000);
          }
        } catch (err: any) {
          walletSyncInProgress.delete(wLower);
          walletSyncLastAttempt.set(wLower, Date.now() - WALLET_SYNC_COOLDOWN_MS + 60000);
          console.warn(`Auto-sync error for ${wallet.slice(0, 12)}...:`, err.message);
        }
      }
      
      const filtered = status ? userBets.filter(b => b.status === status) : userBets;
      const enriched = await Promise.all(filtered.map(async (bet: any) => {
        if (bet.status !== 'pending' && bet.status !== 'in_progress') {
          return { ...bet, cashOutAvailable: false };
        }
        const isParlay = bet.betType === 'parlay' || (bet.prediction && typeof bet.prediction === 'string' && bet.prediction.startsWith('['));
        if (isParlay && bet.result) {
          try {
            const legResults = JSON.parse(bet.result);
            if (Array.isArray(legResults) && legResults.some((l: any) => l.won === false)) {
              return { ...bet, cashOutAvailable: false, parlayLegLost: true };
            }
          } catch {}
        }

        try {
          const eid = bet.eventId || bet.externalEventId || '';
          const numId = Number(eid);
          if (!isNaN(numId) && numId > 0) {
            const ev = await storage.getEvent(numId);
            if (ev) {
              const pred = (bet.prediction || '').toLowerCase().trim();
              const hS = Number((ev as any).homeScore) || 0;
              const aS = Number((ev as any).awayScore) || 0;
              const hT = (ev as any).homeTeam || '';
              const aT = (ev as any).awayTeam || '';
              const mkt = (bet.marketId || bet.market_id || '').toLowerCase();
              const totalG = hS + aS;
              const predNorm = pred.replace(/\s+/g, ' ');
              const htL = hT.toLowerCase().trim();
              const atL = aT.toLowerCase().trim();
              const isHP = pred === 'home' || pred === '1' || (htL.length >= 4 && predNorm === htL);
              const isAP = pred === 'away' || pred === '2' || (atL.length >= 4 && predNorm === atL);

              let lost = false;
              if (pred.includes('under')) {
                const thr = parseFloat(pred.replace(/[^0-9.]/g, '')) || 2.5;
                if (totalG > thr) lost = true;
              }
              if (mkt.includes('btts') || mkt === '8') {
                if (pred === 'no' && hS > 0 && aS > 0) lost = true;
              }
              if (isHP && aS > hS && totalG >= 2) lost = true;
              if (isAP && hS > aS && totalG >= 2) lost = true;
              if ((pred === 'draw' || pred === 'x') && hS !== aS && totalG >= 2) lost = true;

              if (lost) {
                return { ...bet, cashOutAvailable: false, betLostLive: true };
              }
            }
          }
        } catch {}

        return bet;
      }));
      res.json(enriched);
    } catch (error) {
      console.error('Error fetching bets for wallet:', error);
      res.status(500).json({ message: "Failed to fetch bets" });
    }
  });

  app.get("/api/admin/debug-bets/:wallet", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const wallet = req.params.wallet;
      const normalizedWallet = wallet.toLowerCase();
      
      const { bets: betsTable } = await import('@shared/schema');
      const { db: dbInstance } = await import('./db');
      
      const directMatch = await dbInstance.execute(sql`
        SELECT id, wurlus_bet_id, wallet_address, bet_amount, currency, odds, status, bet_type, prediction, event_name, created_at, tx_hash, bet_object_id
        FROM bets 
        WHERE LOWER(wallet_address) = ${normalizedWallet}
        ORDER BY created_at DESC
      `);
      
      const wurlusMatch = await dbInstance.execute(sql`
        SELECT id, wurlus_bet_id, wallet_address, bet_amount, currency, odds, status, bet_type, prediction, event_name, created_at
        FROM bets 
        WHERE LOWER(wurlus_bet_id) LIKE ${`%${normalizedWallet.slice(0, 10)}%`}
        ORDER BY created_at DESC
      `);
      
      const txMatch = await dbInstance.execute(sql`
        SELECT id, wurlus_bet_id, wallet_address, bet_amount, currency, odds, status, bet_type, tx_hash, created_at
        FROM bets 
        WHERE LOWER(tx_hash) LIKE ${`%${normalizedWallet.slice(0, 10)}%`}
        ORDER BY created_at DESC
      `);

      const giftMatch = await dbInstance.execute(sql`
        SELECT id, wurlus_bet_id, wallet_address, gifted_to, bet_amount, currency, status, created_at
        FROM bets 
        WHERE LOWER(gifted_to) = ${normalizedWallet}
        ORDER BY created_at DESC
      `);

      res.json({
        wallet,
        normalizedWallet,
        directMatch: { count: directMatch.rows?.length || 0, rows: directMatch.rows || [] },
        wurlusMatch: { count: wurlusMatch.rows?.length || 0, rows: wurlusMatch.rows || [] },
        txMatch: { count: txMatch.rows?.length || 0, rows: txMatch.rows || [] },
        giftMatch: { count: giftMatch.rows?.length || 0, rows: giftMatch.rows || [] },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Debug query failed", error: error.message });
    }
  });

  app.post("/api/admin/recover-bets/:wallet", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const wallet = req.params.wallet;
      if (!wallet.startsWith('0x') || wallet.length !== 66) {
        return res.status(400).json({ message: "Invalid wallet address" });
      }

      const CONTRACT_PKG = '0x4d83eab83defa9e2488b3c525f54fc588185cfc1a906e5dada1954bf52296e76';
      const { bets: betsTable } = await import('@shared/schema');
      const { suiJsonRpc } = await import('./lib/suiRpcConfig');

      async function rpc(method: string, params: any[]) {
        return suiJsonRpc(method, params);
      }

      const txList = await rpc('suix_queryTransactionBlocks', [
        { filter: { FromAddress: wallet } }, null, 50, true
      ]);
      const digests = (txList?.data || []).map((t: any) => t.digest);

      const recovered: any[] = [];
      const skipped: any[] = [];

      for (const digest of digests) {
        const tx = await rpc('sui_getTransactionBlock', [
          digest, { showInput: true, showEffects: true, showEvents: true, showObjectChanges: true }
        ]);
        if (!tx) continue;

        const txData = tx.transaction?.data?.transaction;
        const calls = (txData?.transactions || []).filter((c: any) => c.MoveCall);
        const isBetTx = calls.some((c: any) => 
          c.MoveCall?.package === CONTRACT_PKG && c.MoveCall?.function?.includes('place_bet')
        );
        if (!isBetTx) continue;

        if (tx.effects?.status?.status !== 'success') continue;

        const existingByTx = await db.execute(sql`SELECT id FROM bets WHERE tx_hash = ${digest} LIMIT 1`);
        if ((existingByTx.rows?.length || 0) > 0) {
          skipped.push({ digest, reason: 'already_exists' });
          continue;
        }

        const betObjChange = (tx.objectChanges || []).find((c: any) => 
          c.type === 'created' && c.objectType?.includes('::betting::Bet')
        );
        const betObjectId = betObjChange?.objectId || null;

        if (betObjectId) {
          const existingByObj = await db.execute(sql`SELECT id FROM bets WHERE bet_object_id = ${betObjectId} LIMIT 1`);
          if ((existingByObj.rows?.length || 0) > 0) {
            skipped.push({ digest, reason: 'bet_object_exists' });
            continue;
          }
        }

        const event = tx.events?.[0]?.parsedJson || {};
        const eventIdBytes = (event as any).event_id;
        const eventIdStr = Array.isArray(eventIdBytes) ? String.fromCharCode(...eventIdBytes) : 'unknown';
        const oddsBps = (event as any).odds_bps ? Number((event as any).odds_bps) : 200;
        const odds = oddsBps / 100;
        const coinType = getCoinTypeFromCode(parseInt((event as any).coin_type || '0'));
        const amount = (event as any).amount ? Number((event as any).amount) / getDecimalsForCurrency(coinType) : 0;
        const ts = tx.timestampMs ? new Date(parseInt(tx.timestampMs)) : new Date();

        const betId = betObjectId || `recovered-${digest.slice(0, 16)}`;
        const potentialPayout = Math.round(amount * odds * 100) / 100;
        const isParlay = eventIdStr.includes('parlay');

        try {
          const insertResult = await db.insert(betsTable).values({
            userId: null,
            walletAddress: wallet.toLowerCase(),
            betAmount: amount,
            currency: coinType,
            odds,
            prediction: eventIdStr,
            potentialPayout,
            status: 'pending',
            betType: isParlay ? 'parlay' : 'single',
            cashOutAvailable: true,
            wurlusBetId: betId,
            txHash: digest,
            platformFee: 0,
            networkFee: 0,
            feeCurrency: coinType,
            eventName: isParlay ? 'Parlay Bet (Recovered)' : 'Recovered Bet',
            externalEventId: eventIdStr,
            betObjectId: betObjectId,
            createdAt: ts,
          }).returning();

          const inserted = insertResult[0];
          recovered.push({
            id: inserted.id, betId, digest, betObjectId,
            amount, coinType, odds, eventId: eventIdStr, timestamp: ts.toISOString(),
          });
          console.log(`🔧 RECOVERED BET: ${betId} from tx ${digest.slice(0,16)} for ${wallet.slice(0,12)}... (${amount} ${coinType})`);
        } catch (insertErr: any) {
          if (insertErr.code === '23505') {
            skipped.push({ digest, reason: 'duplicate_key', detail: insertErr.detail });
            console.log(`⏭ Skipped duplicate: ${digest.slice(0,16)}`);
          } else {
            throw insertErr;
          }
        }
      }

      res.json({
        wallet,
        recovered: recovered.length,
        skipped: skipped.length,
        details: { recovered, skipped },
      });
    } catch (error: any) {
      console.error('Recovery failed:', error);
      res.status(500).json({ message: "Recovery failed", error: error.message });
    }
  });

  // Get a specific bet
  app.get("/api/bets/:id", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      let bet = await storage.getBet(betId);
      
      if (!bet && /^\d+$/.test(betId)) {
        bet = await storage.getBet(parseInt(betId));
      }
      
      if (!bet) {
        return res.status(404).json({ message: "Bet not found" });
      }
      
      res.json(bet);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bet" });
    }
  });

  // Verify bet in database and on-chain
  app.get("/api/bets/:id/verify", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      
      // Get bet from database
      const bet = await storage.getBet(betId);
      if (!bet) {
        return res.status(404).json({ message: "Bet not found" });
      }

      // Verify on-chain if txHash exists
      let onChainVerification: { confirmed: boolean; blockHeight: number } = { confirmed: false, blockHeight: 0 };
      if (bet.txHash) {
        const verification = await blockchainBetService.verifyTransaction(bet.txHash);
        onChainVerification = { 
          confirmed: verification.confirmed, 
          blockHeight: verification.blockHeight || 0 
        };
      }

      res.json({
        betId,
        database: {
          found: true,
          status: bet.status,
          txHash: bet.txHash
        },
        onChain: {
          verified: onChainVerification.confirmed,
          blockHeight: onChainVerification.blockHeight
        },
        packageId: blockchainBetService.getPackageId()
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to verify bet" });
    }
  });

  // Settlement endpoint - Auto-settle bets based on event results
  app.post("/api/bets/:id/settle", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const betId = req.params.id;
      const { eventResult } = req.body;

      if (!eventResult) {
        return res.status(400).json({ message: "Event result required" });
      }

      // Fetch actual bet from storage
      const storedBet = await storage.getBet(betId);
      
      // Use stored bet or fallback to mock for testing
      if (!storedBet) {
        return res.status(404).json({ message: "Bet not found" });
      }
      if (!storedBet.userId) {
        return res.status(400).json({ message: "Bet has no userId - cannot settle" });
      }
      const bet = {
        id: storedBet.id,
        userId: storedBet.userId,
        eventId: storedBet.eventId,
        marketId: storedBet.marketId || 'match-winner',
        outcomeId: storedBet.outcomeId || 'home',
        odds: storedBet.odds || 2.0,
        betAmount: storedBet.betAmount || 100,
        currency: (storedBet as any).currency || 'SUI' as 'SUI' | 'SBETS',
        status: 'pending' as const,
        prediction: storedBet.prediction || eventResult.result || 'home',
        placedAt: storedBet.placedAt || Date.now(),
        potentialPayout: storedBet.potentialPayout || (storedBet.betAmount || 100) * (storedBet.odds || 2.0)
      };

      const settlement = SettlementService.settleBet(bet, eventResult);
      const platformFee = settlement.payout > 0 ? settlement.payout * 0.01 : 0;
      const netPayout = settlement.payout - platformFee;
      
      // DEFENSE-IN-DEPTH: Payout cap at settlement endpoint
      const settleEndpointMaxPayout = getMaxPayoutForCurrency(bet.currency);
      if (settlement.status === 'won' && settlement.payout > settleEndpointMaxPayout) {
        console.error(`🚨 SETTLEMENT ENDPOINT CAP BREACH: Bet ${betId} payout=${settlement.payout} ${bet.currency} > max ${settleEndpointMaxPayout} — BLOCKING`);
        return res.status(400).json({ message: `Payout ${settlement.payout} ${bet.currency} exceeds maximum payout cap. Contact admin.` });
      }
      
      // ANTI-CHEAT: Sign settlement with oracle key
      const outcome = settlement.status === 'won' ? 'won' : settlement.status === 'lost' ? 'lost' : 'void';
      const settlementData = {
        betId,
        eventId: bet.eventId,
        outcome: outcome as 'won' | 'lost' | 'void',
        payout: settlement.payout,
        timestamp: Date.now()
      };

      // Validate settlement logic to detect manipulation
      const validationCheck = antiCheatService.validateSettlementLogic(settlementData, eventResult);
      if (!validationCheck.valid) {
        console.error(`🚨 ANTI-CHEAT REJECTION: ${validationCheck.reason}`);
        return res.status(400).json({ message: `Settlement validation failed: ${validationCheck.reason}` });
      }

      // Sign settlement data cryptographically
      const signedSettlement = antiCheatService.signSettlementData(settlementData);
      const onChainProof = antiCheatService.generateOnChainProof(signedSettlement);

      // Update bet status - ONLY process payouts if status update succeeds (prevents double payout)
      const statusUpdated = await storage.updateBetStatus(betId, settlement.status, settlement.payout);
      
      if (statusUpdated) {
        if (settlement.status === 'won' && netPayout > 0) {
          let payoutTxHash: string | undefined;
          const walletAddr = bet.userId;

          if (blockchainBetService.isAdminKeyConfigured() && walletAddr && walletAddr.startsWith('0x')) {
            const sendDirect = async () => {
              if (bet.currency === 'SBETS') {
                return blockchainBetService.sendSbetsToUser(walletAddr, netPayout);
              } else {
                return blockchainBetService.sendSuiToUser(walletAddr, netPayout);
              }
            };

            let result = await sendDirect();
            if (!result.success) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              result = await sendDirect();
            }

            if (result.success && result.txHash) {
              payoutTxHash = result.txHash;
              await storage.updateBetStatus(betId, 'paid_out', netPayout, payoutTxHash);
              console.log(`✅ AUTO-PAYOUT ON-CHAIN: ${netPayout} ${bet.currency} -> ${walletAddr.slice(0,10)}... | TX: ${payoutTxHash}`);
            } else {
              console.warn(`⚠️ On-chain payout failed for bet ${betId}: ${result.error} — crediting DB balance as fallback`);
              const winningsAdded = await balanceService.addWinnings(bet.userId, netPayout, bet.currency);
              if (!winningsAdded) {
                await storage.updateBetStatus(betId, 'pending');
                console.error(`❌ SETTLEMENT REVERTED: Failed to credit winnings for bet ${betId}`);
                return res.status(500).json({ message: "Failed to credit winnings - settlement reverted" });
              }
              console.log(`💰 AUTO-PAYOUT (DB fallback): ${bet.userId} received ${netPayout} ${bet.currency}`);
            }
          } else {
            const winningsAdded = await balanceService.addWinnings(bet.userId, netPayout, bet.currency);
            if (!winningsAdded) {
              await storage.updateBetStatus(betId, 'pending');
              console.error(`❌ SETTLEMENT REVERTED: Failed to credit winnings for bet ${betId}`);
              return res.status(500).json({ message: "Failed to credit winnings - settlement reverted" });
            }
            console.log(`💰 AUTO-PAYOUT (DB): ${bet.userId} received ${netPayout} ${bet.currency}`);
          }
          await balanceService.addRevenue(platformFee, bet.currency);
          console.log(`📊 REVENUE: ${platformFee} ${bet.currency} platform fee recorded`);
        } else if (settlement.status === 'void') {
          // VOID: Return stake to treasury (SBETS already in treasury from on-chain transfer)
          await balanceService.addRevenue(bet.betAmount, bet.currency);
          console.log(`🔄 VOID -> TREASURY: ${bet.betAmount} ${bet.currency} returned to treasury from voided bet ${betId}`);
        } else if (settlement.status === 'lost') {
          // Add lost bet stake to platform revenue
          await balanceService.addRevenue(bet.betAmount, bet.currency);
          console.log(`📊 REVENUE (DB): ${bet.betAmount} ${bet.currency} added to platform revenue from lost bet`);
        }
      } else {
        console.log(`⚠️ DUPLICATE SETTLEMENT PREVENTED: Bet ${betId} already settled - no payout applied`);
        return res.status(400).json({ message: "Bet already settled - duplicate settlement prevented" });
      }

      // Notify user of settlement with proof
      notificationService.notifyBetSettled(bet.userId, bet, outcome);


      // Log settlement
      monitoringService.logSettlement({
        settlementId: `settlement-${betId}`,
        betId,
        outcome: settlement.status,
        payout: settlement.payout,
        timestamp: Date.now(),
        fees: platformFee
      });

      console.log(`✅ BET SETTLED: ${betId} - Status: ${settlement.status}, Payout: ${settlement.payout} ${bet.currency}, Fee: ${platformFee} ${bet.currency}, Net: ${netPayout} ${bet.currency}`);
      
      res.json({
        success: true,
        betId,
        settlement: {
          status: settlement.status,
          payout: settlement.payout,
          platformFee: platformFee,
          netPayout: netPayout,
          settledAt: Date.now()
        },
        antiCheat: {
          signed: true,
          signature: onChainProof.signature,
          dataHash: onChainProof.dataHash,
          oraclePublicKey: onChainProof.oraclePublicKey,
          message: 'Settlement cryptographically verified and ready for Sui Move contract verification'
        }
      });
    } catch (error) {
      console.error("Settlement error:", error);
      res.status(500).json({ message: "Failed to settle bet" });
    }
  });

  // ============================================
  // zkLogin Salt Management
  // ============================================
  app.post("/api/zklogin/salt", async (req: Request, res: Response) => {
    try {
      const { zkloginSalts } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { provider, subject } = req.body;

      if (!provider || !subject) {
        return res.status(400).json({ error: 'Provider and subject are required' });
      }

      const existing = await db.select().from(zkloginSalts)
        .where(and(eq(zkloginSalts.provider, provider), eq(zkloginSalts.subject, subject)));

      if (existing.length > 0) {
        console.log(`[zkLogin] Salt retrieved for ${provider}:${subject.substring(0, 8)}...`);
        return res.json({ salt: existing[0].salt });
      }

      const crypto = await import('crypto');
      const newSalt = crypto.randomBytes(16).toString('hex');

      await db.insert(zkloginSalts).values({
        provider,
        subject,
        salt: newSalt
      });

      console.log(`[zkLogin] New salt created for ${provider}:${subject.substring(0, 8)}...`);
      res.json({ salt: newSalt });
    } catch (error: any) {
      console.error('[zkLogin] Salt error:', error.message);
      res.status(500).json({ error: 'Failed to get salt' });
    }
  });

  app.post("/api/zklogin/save-address", async (req: Request, res: Response) => {
    try {
      const { zkloginSalts } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { provider, subject, suiAddress } = req.body;

      if (!provider || !subject || !suiAddress) {
        return res.status(400).json({ error: 'Provider, subject, and suiAddress required' });
      }

      await db.update(zkloginSalts)
        .set({ suiAddress: suiAddress.toLowerCase() })
        .where(and(eq(zkloginSalts.provider, provider), eq(zkloginSalts.subject, subject)));

      console.log(`[zkLogin] Address saved: ${suiAddress.substring(0, 10)}... for ${provider}:${subject.substring(0, 8)}...`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[zkLogin] Save address error:', error.message);
      res.status(500).json({ error: 'Failed to save address' });
    }
  });

  // Wallet connect endpoint - registers/retrieves user by wallet address
  app.post("/api/wallet/connect", async (req: Request, res: Response) => {
    try {
      const { address, walletType } = req.body;
      
      if (!address) {
        return res.status(400).json({ message: "Wallet address is required" });
      }
      
      // CRITICAL: Normalize wallet address to lowercase for consistent storage/retrieval
      const normalizedAddress = address.toLowerCase();
      console.log(`[Wallet Connect] Processing connection for: ${normalizedAddress.substring(0, 10)}...`);
      
      let user;
      let userId = 0;
      let username = normalizedAddress.substring(0, 8);
      let createdAt = new Date().toISOString();
      
      try {
        // Check if user exists with this wallet address
        user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (!user) {
          // Create new user with wallet address (password required by schema, use placeholder for wallet-based auth)
          const placeholderPassword = `wallet_${Date.now()}_${Math.random().toString(36).substring(2)}`;
          user = await storage.createUser({
            username: normalizedAddress.substring(0, 8),
            password: placeholderPassword,
            walletAddress: normalizedAddress,
            walletType: walletType || 'sui'
          });
          console.log(`[Wallet Connect] Created new user for wallet: ${normalizedAddress.substring(0, 10)}...`);
        } else {
          console.log(`[Wallet Connect] Found existing user for wallet: ${normalizedAddress.substring(0, 10)}...`);
        }
        userId = user.id;
        username = user.username;
        createdAt = user.createdAt?.toISOString?.() || user.createdAt || createdAt;
      } catch (dbError: any) {
        // Handle schema mismatch gracefully (e.g., missing free_bet_balance column)
        console.warn(`[Wallet Connect] DB error (schema may be out of sync): ${dbError.message}`);
        // Still allow connection with basic info
      }
      
      // Get balance for user using normalized address
      const balance = await balanceService.getBalanceAsync(normalizedAddress);
      console.log(`[Wallet Connect] Balance retrieved:`, balance);
      
      res.json({
        id: userId || user?.id || 0,
        username: username || user?.username || normalizedAddress.substring(0, 8),
        walletAddress: user?.walletAddress || normalizedAddress,
        walletType: user?.walletType || walletType || 'sui',
        createdAt: createdAt,
        suiBalance: balance.suiBalance || 0,
        sbetsBalance: balance.sbetsBalance || 0,
        balance: {
          SUI: balance.suiBalance || 0,
          SBETS: balance.sbetsBalance || 0
        }
      });
    } catch (error: any) {
      console.error("Wallet connect error:", error?.message || error);
      res.status(500).json({ message: "Failed to connect wallet" });
    }
  });

  // Auth wallet connect endpoint (alias for /api/wallet/connect for client compatibility)
  app.post("/api/auth/wallet-connect", async (req: Request, res: Response) => {
    try {
      const { walletAddress, walletType } = req.body;
      
      if (!walletAddress) {
        return res.status(400).json({ success: false, message: "Wallet address is required" });
      }
      
      const normalizedAddress = walletAddress.toLowerCase();
      console.log(`[Auth Wallet Connect] Processing: ${normalizedAddress.substring(0, 10)}...`);
      
      let user;
      let userId = 0;
      let username = normalizedAddress.substring(0, 8);
      
      try {
        user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (!user) {
          const placeholderPassword = `wallet_${Date.now()}_${Math.random().toString(36).substring(2)}`;
          user = await storage.createUser({
            username: normalizedAddress.substring(0, 8),
            password: placeholderPassword,
            walletAddress: normalizedAddress,
            walletType: walletType || 'sui'
          });
          console.log(`[Auth Wallet Connect] Created new user: ${normalizedAddress.substring(0, 10)}...`);
        }
        userId = user.id;
        username = user.username;
      } catch (dbError: any) {
        // Handle schema mismatch gracefully (e.g., missing free_bet_balance column)
        console.warn(`[Auth Wallet Connect] DB error (schema may be out of sync): ${dbError.message}`);
        // Still allow connection with basic info
      }
      
      const balance = await balanceService.getBalanceAsync(normalizedAddress);
      
      res.json({
        success: true,
        user: {
          id: userId || user?.id || 0,
          username: username || user?.username || normalizedAddress.substring(0, 8),
          walletAddress: user?.walletAddress || normalizedAddress,
          walletType: user?.walletType || walletType || 'sui',
          suiBalance: balance.suiBalance || 0,
          sbetsBalance: balance.sbetsBalance || 0,
          balance: {
            SUI: balance.suiBalance || 0,
            SBETS: balance.sbetsBalance || 0
          }
        }
      });
    } catch (error: any) {
      console.error("Auth wallet connect error:", error?.message || error);
      console.error("Auth wallet connect full error:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to connect wallet"
      });
    }
  });

  // Auth wallet disconnect endpoint
  app.post("/api/auth/wallet-disconnect", async (req: Request, res: Response) => {
    res.json({ success: true, message: "Wallet disconnected" });
  });

  // Auth wallet status endpoint
  app.get("/api/auth/wallet-status", async (req: Request, res: Response) => {
    try {
      // Check if wallet is connected based on session or query param
      const walletAddress = req.query.walletAddress as string;
      
      if (walletAddress) {
        const normalizedAddress = walletAddress.toLowerCase();
        const user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (user) {
          const balance = await balanceService.getBalanceAsync(normalizedAddress);
          return res.json({
            authenticated: true,
            walletAddress: user.walletAddress,
            walletType: user.walletType,
            balance: balance
          });
        }
      }
      
      res.json({ authenticated: false });
    } catch (error) {
      res.json({ authenticated: false });
    }
  });

  // Auth profile endpoint
  app.get("/api/auth/profile", async (req: Request, res: Response) => {
    try {
      const walletAddress = req.query.walletAddress as string;
      
      if (walletAddress) {
        const normalizedAddress = walletAddress.toLowerCase();
        const user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (user) {
          const balance = await balanceService.getBalanceAsync(normalizedAddress);
          return res.json({
            success: true,
            profile: {
              id: user.id,
              username: user.username,
              walletAddress: user.walletAddress,
              walletType: user.walletType,
              suiBalance: balance?.suiBalance || 0,
              sbetsBalance: balance?.sbetsBalance || 0
            }
          });
        }
      }
      
      res.json({ success: false, profile: null });
    } catch (error) {
      res.json({ success: false, profile: null });
    }
  });

  // Get user balance - fetches BOTH on-chain wallet balance AND platform database balance
  app.get("/api/user/balance", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }
      
      // Always get database platform balance (for withdrawals of deposited funds)
      const dbBalance = await balanceService.getBalanceAsync(userId);
      
      // If userId looks like a wallet address (starts with 0x), also fetch on-chain balance
      if (userId && userId.startsWith('0x')) {
        try {
          const onChainBalance = await blockchainBetService.getWalletBalance(userId);
          // Get promotion bonus balance
          let promotionBonus = 0;
          try {
            const promoStatus = await promotionService.getPromotionStatus(userId);
            promotionBonus = promoStatus.bonusBalance || 0;
          } catch (promoError) {
            console.warn('Promotion status fetch error:', promoError);
          }
          return res.json({
            SUI: onChainBalance.sui || 0,
            SBETS: onChainBalance.sbets || 0,
            USDSUI: onChainBalance.usdsui || 0,
            suiBalance: onChainBalance.sui || 0,
            sbetsBalance: onChainBalance.sbets || 0,
            usdsuiBalance: onChainBalance.usdsui || 0,
            platformSuiBalance: dbBalance.suiBalance || 0,
            platformSbetsBalance: dbBalance.sbetsBalance || 0,
            promotionBonusUsd: promotionBonus,
            source: 'combined'
          });
        } catch (chainError) {
          console.warn(`Failed to fetch on-chain balance for ${userId}:`, chainError);
          // Fall back to database only
        }
      }
      
      // Fallback to database balance
      res.json({
        SUI: dbBalance.suiBalance || 0,
        SBETS: dbBalance.sbetsBalance || 0,
        suiBalance: dbBalance.suiBalance || 0,
        sbetsBalance: dbBalance.sbetsBalance || 0,
        platformSuiBalance: dbBalance.suiBalance || 0,
        platformSbetsBalance: dbBalance.sbetsBalance || 0,
        source: 'database'
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch balance" });
    }
  });

  // Get promotion status for user
  app.get("/api/promotion/status", async (req: Request, res: Response) => {
    try {
      const walletAddress = req.query.wallet as string;
      
      if (!walletAddress || !/^0x[a-fA-F0-9]{64}$/.test(walletAddress)) {
        return res.status(400).json({ message: "Valid wallet address required" });
      }
      
      const status = await promotionService.getPromotionStatus(walletAddress);
      res.json({
        success: true,
        promotion: {
          isActive: status.isActive,
          totalBetUsd: status.totalBetUsd,
          bonusesAwarded: status.bonusesAwarded,
          bonusBalance: status.bonusBalance,
          nextBonusAt: status.nextBonusAt,
          promotionEnd: status.promotionEnd,
          thresholdUsd: status.thresholdUsd,
          bonusUsd: status.bonusUsd,
          progressPercent: Math.min(100, ((status.totalBetUsd % status.thresholdUsd) / status.thresholdUsd) * 100)
        }
      });
    } catch (error: any) {
      console.error('Promotion status error:', error);
      res.status(500).json({ message: "Failed to get promotion status" });
    }
  });

  // Deposit SUI to account (for on-chain wallet deposits)
  app.post("/api/user/deposit", async (req: Request, res: Response) => {
    try {
      const { userId, amount, txHash, currency = 'SUI' } = req.body;
      
      if (!userId || !amount) {
        return res.status(400).json({ message: "Missing required fields: userId, amount" });
      }
      
      if (amount <= 0) {
        return res.status(400).json({ message: "Amount must be positive" });
      }

      if (!txHash) {
        return res.status(400).json({ message: "Transaction hash is required for deposits" });
      }
      
      {
        try {
          const verification = await blockchainBetService.verifyTransaction(txHash);
          if (!verification.confirmed) {
            console.warn(`⚠️ DEPOSIT TX NOT CONFIRMED: ${txHash}`);
            return res.status(400).json({ 
              message: "Transaction not confirmed on-chain. Please wait for confirmation and try again.",
              txHash,
              verified: false
            });
          }
          if (verification.sender && userId.startsWith('0x') && verification.sender.toLowerCase() !== userId.toLowerCase()) {
            console.warn(`🚫 DEPOSIT SENDER MISMATCH: tx sender ${verification.sender.slice(0,12)}... != userId ${userId.slice(0,12)}...`);
            return res.status(403).json({
              message: "Transaction sender does not match your wallet address",
              verified: false
            });
          }
          console.log(`✅ DEPOSIT TX VERIFIED: ${txHash} (block: ${verification.blockHeight})`);
        } catch (verifyError) {
          console.warn(`⚠️ Could not verify tx ${txHash}:`, verifyError);
          return res.status(400).json({ 
            message: "Could not verify transaction on-chain. Please try again later.",
            txHash,
            verified: false
          });
        }
      }
      
      // DUPLICATE PREVENTION: Use txHash deduplication in balanceService
      const depositResult = await balanceService.deposit(userId, amount, txHash, 'Wallet deposit', currency as 'SUI' | 'SBETS');
      
      if (!depositResult.success) {
        console.warn(`⚠️ DUPLICATE DEPOSIT BLOCKED: ${txHash} for ${userId}`);
        return res.status(409).json({ 
          success: false, 
          message: depositResult.message,
          duplicate: true
        });
      }
      
      // Notify user of deposit
      notificationService.createNotification(
        userId,
        'deposit',
        '💰 Deposit Received',
        `Successfully deposited ${amount} ${currency} to your account`,
        { amount, currency, txHash }
      );

      console.log(`✅ DEPOSIT PROCESSED: ${userId} - ${amount} ${currency} (tx: ${txHash})`);
      
      res.json({
        success: true,
        deposit: {
          amount,
          currency,
          txHash,
          status: 'completed',
          timestamp: Date.now()
        },
        newBalance: await balanceService.getBalanceAsync(userId)
      });
    } catch (error: any) {
      console.error("Deposit error:", error);
      res.status(500).json({ message: "Failed to process deposit" });
    }
  });

  const withdrawRateLimits = new Map<string, { count: number; resetAt: number }>();
  const WITHDRAW_LIMIT = 3;
  const WITHDRAW_WINDOW = 60 * 60 * 1000;
  app.post("/api/user/withdraw", async (req: Request, res: Response) => {
    try {
      const validation = validateRequest(WithdrawSchema, req.body);
      if (!validation.valid) {
        return res.status(400).json({ 
          message: "Validation failed",
          errors: validation.errors 
        });
      }
      const wKey = (req.body.walletAddress || req.body.userId || '').toLowerCase();
      if (wKey) {
        const wNow = Date.now();
        const wData = withdrawRateLimits.get(wKey);
        if (wData && wData.resetAt > wNow) {
          if (wData.count >= WITHDRAW_LIMIT) {
            return res.status(429).json({ message: `Max ${WITHDRAW_LIMIT} withdrawals per hour` });
          }
          wData.count++;
        } else {
          withdrawRateLimits.set(wKey, { count: 1, resetAt: wNow + WITHDRAW_WINDOW });
        }
      }

      const { userId, amount } = validation.data!;
      const userIdStr = String(userId);
      const walletAddress = req.body.walletAddress;
      const executeOnChain = blockchainBetService.isAdminKeyConfigured() || req.body.executeOnChain === true;
      const currency: string = req.body.currency === 'USDSUI' ? 'USDSUI' : req.body.currency === 'SBETS' ? 'SBETS' : 'SUI';

      if (!isValidSuiWallet(walletAddress)) {
        return res.status(400).json({ message: "Valid Sui wallet address required for withdrawal" });
      }

      const user = await storage.getUserByWalletAddress(walletAddress);
      if (!user || String(user.id) !== userIdStr) {
        console.warn(`🚫 WITHDRAWAL BLOCKED: Wallet ${walletAddress.slice(0, 12)}... does not match userId ${userIdStr}`);
        return res.status(403).json({ message: "Wallet does not match account" });
      }
      
      const result = await balanceService.withdraw(userIdStr, amount, executeOnChain, currency);

      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      // Notify user based on withdrawal status
      if (result.status === 'completed') {
        notificationService.notifyWithdrawal(userIdStr, amount, 'completed');
        console.log(`Withdrawal completed: ${userIdStr} - ${amount} ${currency} | TX: ${result.txHash}`);
      } else {
        notificationService.createNotification(
          userIdStr,
          'withdrawal',
          `Withdrawal Queued`,
          `Your withdrawal of ${amount} ${currency} is being processed`,
          { amount, currency, status: 'pending_admin' }
        );
        console.log(`Withdrawal queued: ${userIdStr} - ${amount} ${currency}`);
      }

      res.json({
        success: true,
        withdrawal: {
          amount,
          currency,
          txHash: result.txHash,
          status: result.status,
          timestamp: Date.now(),
          onChainEnabled: blockchainBetService.isAdminKeyConfigured()
        }
      });
    } catch (error: any) {
      console.error("Withdrawal error:", error);
      res.status(500).json({ message: "Failed to process withdrawal" });
    }
  });

  // Get transaction history
  app.get("/api/user/transactions", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const transactions = await balanceService.getTransactionHistory(userId, limit);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Cash-out estimate endpoint - returns server-computed cash-out value
  app.get("/api/bets/:id/cash-out-estimate", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      const walletParam = (req.query.wallet as string || '').toLowerCase();
      if (!walletParam || !walletParam.startsWith('0x') || walletParam.length < 10) {
        return res.status(400).json({ message: "Valid wallet address required" });
      }

      const storedBet = await storage.getBet(betId);
      if (!storedBet) return res.status(404).json({ message: "Bet not found" });

      if (storedBet.walletAddress && storedBet.walletAddress.toLowerCase() !== walletParam) {
        return res.status(403).json({ message: "Not your bet" });
      }
      if (storedBet.status !== 'pending') return res.json({ estimate: 0, available: false });

      const parsedBetAmount = Number(storedBet.betAmount) || Number((storedBet as any).stake) || 0;
      const parsedOdds = Number(storedBet.odds) || 2.0;
      if (parsedBetAmount <= 0) return res.json({ estimate: 0, available: false });

      const isParlay = (storedBet as any).betType === 'parlay' || 
        (storedBet.prediction && storedBet.prediction.startsWith('['));

      const estCheckBetLost = (prediction: string, homeScore: number, awayScore: number, homeTeam: string, awayTeam: string, marketId?: string): boolean => {
        const pred = prediction.toLowerCase().trim();
        const predNorm = pred.replace(/\s+/g, ' ');
        const totalGoals = homeScore + awayScore;
        const htLow = homeTeam.toLowerCase().trim();
        const atLow = awayTeam.toLowerCase().trim();
        const mkt = (marketId || '').toLowerCase();
        const isHomePred = pred === 'home' || pred === '1' || (htLow.length >= 4 && predNorm === htLow);
        const isAwayPred = pred === 'away' || pred === '2' || (atLow.length >= 4 && predNorm === atLow);
        if (pred.includes('under')) {
          const threshold = parseFloat(pred.replace(/[^0-9.]/g, '')) || 2.5;
          if (totalGoals > threshold) return true;
        }
        if (mkt.includes('over-under') || mkt.includes('o/u') || mkt === '5') {
          if (pred.includes('under')) {
            const threshold = parseFloat(pred.replace(/[^0-9.]/g, '')) || parseFloat((mkt.match(/\d+\.?\d*/)?.[0]) || '2.5');
            if (totalGoals > threshold) return true;
          }
        }
        if (mkt.includes('btts') || mkt === '8') {
          const bothScored = homeScore > 0 && awayScore > 0;
          if (pred === 'no' && bothScored) return true;
        }
        if (isHomePred && awayScore > homeScore && totalGoals >= 2) return true;
        if (isAwayPred && homeScore > awayScore && totalGoals >= 2) return true;
        if ((pred === 'draw' || pred === 'x') && homeScore !== awayScore && totalGoals >= 2) return true;
        return false;
      };

      let cashOutValue: number;
      let legStatuses: Array<{ eventId: string; odds: number; won: boolean | null; eventName?: string }> = [];

      if (isParlay) {
        let legs: any[] = [];
        try {
          if (storedBet.prediction && storedBet.prediction.startsWith('[')) {
            legs = JSON.parse(storedBet.prediction);
          }
        } catch {}

        if (legs.length > 0) {
          for (const leg of legs) {
            const eventId = String(leg.eventId || '').trim();
            const legOdds = Number(leg.odds) || 1.5;

            let legWon: boolean | null = null;
            try {
              const numericId = Number(eventId);
              const event = (!isNaN(numericId) && numericId > 0) ? await storage.getEvent(numericId) : null;
              if (event) {
                const prediction = (leg.prediction || leg.selection || '').toLowerCase().trim();
                const homeScore = Number((event as any).homeScore) || 0;
                const awayScore = Number((event as any).awayScore) || 0;
                const totalGoals = homeScore + awayScore;
                const marketId = (leg.marketId || '').toLowerCase();
                const homeTeam = (event as any).homeTeam || '';
                const awayTeam = (event as any).awayTeam || '';

                if (estCheckBetLost(prediction, homeScore, awayScore, homeTeam, awayTeam, marketId)) {
                  legWon = false;
                } else if ((event as any).status === 'finished') {
                  if (marketId.includes('btts')) {
                    const bothScored = homeScore > 0 && awayScore > 0;
                    legWon = prediction === 'yes' ? bothScored : prediction === 'no' ? !bothScored : null;
                  } else if (marketId.includes('over-under') || marketId.includes('o/u')) {
                    const threshold = parseFloat(marketId.match(/\d+\.?\d*/)?.[0] || '2.5');
                    legWon = prediction.includes('over') ? totalGoals > threshold : prediction.includes('under') ? totalGoals < threshold : null;
                  } else if (marketId.includes('double-chance')) {
                    const isHomeWin = homeScore > awayScore;
                    const isAwayWin = awayScore > homeScore;
                    const isDraw = homeScore === awayScore;
                    if (prediction === '1x' || prediction === 'home_draw') legWon = isHomeWin || isDraw;
                    else if (prediction === 'x2' || prediction === 'draw_away') legWon = isAwayWin || isDraw;
                    else if (prediction === '12' || prediction === 'home_away') legWon = isHomeWin || isAwayWin;
                  } else {
                    if (prediction === 'home' || prediction === '1') legWon = homeScore > awayScore;
                    else if (prediction === 'away' || prediction === '2') legWon = awayScore > homeScore;
                    else if (prediction === 'draw' || prediction === 'x') legWon = homeScore === awayScore;
                  }
                }
              }
            } catch {}

            legStatuses.push({
              eventId,
              odds: legOdds,
              won: legWon,
              eventName: leg.eventName || leg.homeTeam || eventId
            });
          }

          const anyLost = legStatuses.some(l => l.won === false);
          if (anyLost) {
            return res.json({ estimate: 0, available: false, reason: 'A parlay leg has lost based on current score' });
          }

          cashOutValue = SettlementService.calculateParlayCashOut(
            parsedBetAmount, parsedOdds, legStatuses
          );
        } else {
          cashOutValue = SettlementService.calculateCashOut(
            { id: betId, userId: '', eventId: '', marketId: '', outcomeId: '', odds: parsedOdds, betAmount: parsedBetAmount, status: 'pending', prediction: '', placedAt: 0, potentialPayout: parsedBetAmount * parsedOdds },
            parsedOdds, 0.75
          );
        }
      } else {
        const eventId = storedBet.eventId || (storedBet as any).externalEventId || '';
        const prediction = (storedBet.prediction || '').toLowerCase().trim();
        const marketId = storedBet.marketId || (storedBet as any).market_id || '';

        try {
          const numericId = Number(eventId);
          const event = (!isNaN(numericId) && numericId > 0) ? await storage.getEvent(numericId) : null;
          if (event) {
            const homeScore = Number((event as any).homeScore) || 0;
            const awayScore = Number((event as any).awayScore) || 0;
            const homeTeam = (event as any).homeTeam || '';
            const awayTeam = (event as any).awayTeam || '';
            if (estCheckBetLost(prediction, homeScore, awayScore, homeTeam, awayTeam, marketId)) {
              return res.json({ estimate: 0, available: false, reason: 'Bet already lost based on current score' });
            }
          }
        } catch {}

        const cachedOdds = eventId ? apiSportsService.getOddsFromCache(String(eventId)) : null;

        let serverCurrentOdds = parsedOdds;
        if (cachedOdds) {
          if (prediction === 'home' || prediction === '1') serverCurrentOdds = cachedOdds.homeOdds;
          else if (prediction === 'away' || prediction === '2') serverCurrentOdds = cachedOdds.awayOdds;
          else if (prediction === 'draw' || prediction === 'x') serverCurrentOdds = cachedOdds.drawOdds || parsedOdds;
        }

        let estGameContext: { elapsedMinutes?: number; totalMinutes?: number; isLive?: boolean; scoreFavorable?: boolean } | undefined;
        try {
          const numericEvId = Number(eventId);
          const evData = (!isNaN(numericEvId) && numericEvId > 0) ? await storage.getEvent(numericEvId) : null;
          if (evData) {
            const evStatus = ((evData as any).status || '').toLowerCase();
            if (evStatus === 'live' || evStatus === 'in_play' || evStatus === '1h' || evStatus === '2h' || evStatus === 'ht') {
              const elapsed = Number((evData as any).elapsed) || Number((evData as any).minute) || 0;
              const homeScore = Number((evData as any).homeScore) || 0;
              const awayScore = Number((evData as any).awayScore) || 0;
              const isHomePred = prediction === 'home' || prediction === '1';
              const isAwayPred = prediction === 'away' || prediction === '2';
              const isDrawPred = prediction === 'draw' || prediction === 'x';
              let scoreFavorable = true;
              if (isHomePred && awayScore > homeScore) scoreFavorable = false;
              else if (isAwayPred && homeScore > awayScore) scoreFavorable = false;
              else if (isDrawPred && homeScore !== awayScore) scoreFavorable = false;
              estGameContext = { elapsedMinutes: elapsed, totalMinutes: 90, isLive: true, scoreFavorable };
            }
          }
        } catch {}

        const estBetForCalc = { id: betId, userId: '', eventId: '', marketId: '', outcomeId: '', odds: parsedOdds, betAmount: parsedBetAmount, status: 'pending' as const, prediction: '', placedAt: Number(storedBet.placedAt || 0), potentialPayout: parsedBetAmount * parsedOdds };
        cashOutValue = SettlementService.calculateCashOut(estBetForCalc, serverCurrentOdds, 0.75, estGameContext);
      }

      const estPlacedRaw = storedBet.placedAt || storedBet.createdAt || '';
      const estPlacedMs = typeof estPlacedRaw === 'string' ? new Date(estPlacedRaw).getTime() : Number(estPlacedRaw);
      const estBetAge = estPlacedMs > 0 ? Date.now() - estPlacedMs : Infinity;
      if (estBetAge < 60000) {
        const waitSec = Math.ceil((60000 - estBetAge) / 1000);
        return res.json({ estimate: 0, available: false, reason: `Available in ${waitSec}s` });
      }

      const platformFee = Math.round(cashOutValue * 0.02 * 100) / 100;
      const netAmount = Math.round((cashOutValue - platformFee) * 100) / 100;

      res.json({
        estimate: netAmount,
        gross: cashOutValue,
        fee: platformFee,
        available: netAmount > 0,
        isParlay,
        legs: legStatuses.length > 0 ? legStatuses : undefined
      });
    } catch (error) {
      console.error("Cash-out estimate error:", error);
      res.status(500).json({ message: "Failed to compute cash-out estimate" });
    }
  });

  const cashOutRateLimit = new Map<string, number>();
  const CASH_OUT_COOLDOWN_MS = 10000;
  const MIN_BET_AGE_MS = 60000;
  const cashOutBetLocks = new Set<string>();

  app.post("/api/bets/:id/cash-out", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      const { walletAddress, expectedAmount } = req.body;

      if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.startsWith('0x') || walletAddress.length < 10) {
        return res.status(400).json({ message: "Valid wallet address required for cash-out" });
      }

      if (cashOutBetLocks.has(betId)) {
        return res.status(409).json({ message: "Cash-out already in progress for this bet" });
      }

      const walletKey = walletAddress.toLowerCase();
      const lastCashOut = cashOutRateLimit.get(walletKey) || 0;
      if (Date.now() - lastCashOut < CASH_OUT_COOLDOWN_MS) {
        return res.status(429).json({ message: "Cash-out rate limited. Please wait before trying again." });
      }

      const storedBet = await storage.getBet(betId);
      
      if (!storedBet) {
        return res.status(404).json({ message: "Bet not found" });
      }

      if (!storedBet.walletAddress) {
        console.warn(`🚫 CASH-OUT BLOCKED: Bet ${betId} has no walletAddress stored — ownership cannot be verified`);
        return res.status(400).json({ message: "Bet ownership cannot be verified - contact support" });
      }

      if (storedBet.walletAddress.toLowerCase() !== walletKey) {
        console.warn(`🚫 CASH-OUT BLOCKED: Wallet ${walletAddress.slice(0, 12)}... tried to cash out bet ${betId} owned by ${storedBet.walletAddress.slice(0, 12)}...`);
        return res.status(403).json({ message: "You can only cash out your own bets" });
      }
      
      if (!storedBet.userId) {
        return res.status(400).json({ message: "Bet has no userId - cannot cash out" });
      }

      if (storedBet.status !== 'pending') {
        return res.status(400).json({ message: storedBet.status === 'cashed_out' ? "Bet already cashed out" : "Only pending bets can be cashed out" });
      }

      const placedAtRaw = storedBet.placedAt || storedBet.createdAt || '';
      const placedAtMs = typeof placedAtRaw === 'string' ? new Date(placedAtRaw).getTime() : Number(placedAtRaw);
      const betAge = placedAtMs > 0 ? Date.now() - placedAtMs : Infinity;
      if (betAge < MIN_BET_AGE_MS) {
        const waitSec = Math.ceil((MIN_BET_AGE_MS - betAge) / 1000);
        return res.status(400).json({ message: `Cash-out available in ${waitSec} seconds. Bets must be at least 1 minute old.` });
      }

      const parsedBetAmount = Number(storedBet.betAmount) || Number((storedBet as any).stake) || 0;
      const parsedOdds = Number(storedBet.odds) || 2.0;
      
      if (parsedBetAmount <= 0) {
        return res.status(400).json({ message: "Bet has no valid stake amount" });
      }

      const bet = {
        id: storedBet.id,
        userId: storedBet.userId,
        eventId: storedBet.eventId,
        marketId: storedBet.marketId || 'match-winner',
        outcomeId: storedBet.outcomeId || 'home',
        odds: parsedOdds,
        betAmount: parsedBetAmount,
        currency: (storedBet as any).currency || 'SUI' as 'SUI' | 'SBETS',
        status: 'pending' as const,
        prediction: storedBet.prediction || 'home',
        placedAt: storedBet.placedAt || Date.now(),
        potentialPayout: Number(storedBet.potentialPayout) || parsedBetAmount * parsedOdds
      };

      const isParlay = (storedBet as any).betType === 'parlay' || 
        (storedBet.prediction && storedBet.prediction.startsWith('['));

      const checkBetLost = (prediction: string, homeScore: number, awayScore: number, homeTeam: string, awayTeam: string, marketId?: string): boolean => {
        const pred = prediction.toLowerCase().trim();
        const predNorm = pred.replace(/\s+/g, ' ');
        const totalGoals = homeScore + awayScore;
        const htLow = homeTeam.toLowerCase().trim();
        const atLow = awayTeam.toLowerCase().trim();
        const mkt = (marketId || '').toLowerCase();

        const isHomePred = pred === 'home' || pred === '1' || 
            (htLow.length >= 4 && predNorm === htLow);
        const isAwayPred = pred === 'away' || pred === '2' || 
            (atLow.length >= 4 && predNorm === atLow);

        if (pred.includes('under')) {
          const threshold = parseFloat(pred.replace(/[^0-9.]/g, '')) || 2.5;
          if (totalGoals > threshold) return true;
        }
        if (mkt.includes('over-under') || mkt.includes('o/u') || mkt === '5') {
          if (pred.includes('under')) {
            const threshold = parseFloat(pred.replace(/[^0-9.]/g, '')) || 
                              parseFloat((mkt.match(/\d+\.?\d*/)?.[0]) || '2.5');
            if (totalGoals > threshold) return true;
          }
        }
        if (mkt.includes('btts') || mkt === '8') {
          const bothScored = homeScore > 0 && awayScore > 0;
          if (pred === 'no' && bothScored) return true;
          if (pred === 'yes' && !bothScored && totalGoals >= 2) return false;
        }
        if (isHomePred && awayScore > homeScore && totalGoals >= 2) return true;
        if (isAwayPred && homeScore > awayScore && totalGoals >= 2) return true;
        if ((pred === 'draw' || pred === 'x') && homeScore !== awayScore && totalGoals >= 2) return true;

        return false;
      };

      if (!isParlay) {
        const eventId = storedBet.eventId || (storedBet as any).externalEventId || '';
        try {
          const numericId = Number(eventId);
          const event = (!isNaN(numericId) && numericId > 0) ? await storage.getEvent(numericId) : null;
          if (event) {
            const prediction = (storedBet.prediction || '').toLowerCase().trim();
            const homeScore = Number((event as any).homeScore) || 0;
            const awayScore = Number((event as any).awayScore) || 0;
            const homeTeam = (event as any).homeTeam || '';
            const awayTeam = (event as any).awayTeam || '';
            const eventStatus = ((event as any).status || '').toLowerCase();
            const marketId = storedBet.marketId || (storedBet as any).market_id || '';

            const betLost = checkBetLost(prediction, homeScore, awayScore, homeTeam, awayTeam, marketId);
            
            if (betLost) {
              console.warn(`🚫 CASH-OUT BLOCKED (bet lost): Bet ${betId} prediction="${prediction}" score=${homeScore}-${awayScore} status=${eventStatus}`);
              return res.status(400).json({ message: "Your bet has already lost based on the current score - cash-out not available" });
            }

            if (eventStatus === 'finished' || eventStatus === 'completed') {
              const predNorm = prediction.replace(/\s+/g, ' ');
              let betWon = false;
              const isHomePred = prediction === 'home' || prediction === '1' || 
                  (homeTeam.toLowerCase().trim().length >= 4 && predNorm === homeTeam.toLowerCase().trim());
              const isAwayPred = prediction === 'away' || prediction === '2' || 
                  (awayTeam.toLowerCase().trim().length >= 4 && predNorm === awayTeam.toLowerCase().trim());
              if (isHomePred) betWon = homeScore > awayScore;
              else if (isAwayPred) betWon = awayScore > homeScore;
              else if (prediction === 'draw' || prediction === 'x') betWon = homeScore === awayScore;
              else if (prediction.includes('over')) {
                const threshold = parseFloat(prediction.replace(/[^0-9.]/g, '')) || 2.5;
                betWon = (homeScore + awayScore) > threshold;
              } else if (prediction.includes('under')) {
                const threshold = parseFloat(prediction.replace(/[^0-9.]/g, '')) || 2.5;
                betWon = (homeScore + awayScore) < threshold;
              }
              if (!betWon) {
                return res.status(400).json({ message: "Event has finished and your bet lost - cash-out not available" });
              }
            }
          }
        } catch {}
      }

      let cashOutValue: number;

      if (isParlay) {
        let legs: any[] = [];
        try {
          if (storedBet.prediction && storedBet.prediction.startsWith('[')) {
            legs = JSON.parse(storedBet.prediction);
          }
        } catch {}

        if (legs.length > 0) {
          const legStatuses: Array<{ odds: number; won: boolean | null }> = [];
          for (const leg of legs) {
            const eventId = String(leg.eventId || '').trim();
            const legOdds = Number(leg.odds) || 1.5;

            let legWon: boolean | null = null;
            try {
              const numericId = Number(eventId);
              const event = (!isNaN(numericId) && numericId > 0) ? await storage.getEvent(numericId) : null;
              if (event) {
                const prediction = (leg.prediction || leg.selection || '').toLowerCase().trim();
                const homeScore = Number((event as any).homeScore) || 0;
                const awayScore = Number((event as any).awayScore) || 0;
                const totalGoals = homeScore + awayScore;
                const marketId = (leg.marketId || '').toLowerCase();
                const homeTeam = (event as any).homeTeam || '';
                const awayTeam = (event as any).awayTeam || '';

                if (checkBetLost(prediction, homeScore, awayScore, homeTeam, awayTeam, marketId)) {
                  legWon = false;
                } else if ((event as any).status === 'finished') {
                  if (marketId.includes('btts')) {
                    const bothScored = homeScore > 0 && awayScore > 0;
                    legWon = prediction === 'yes' ? bothScored : prediction === 'no' ? !bothScored : null;
                  } else if (marketId.includes('over-under') || marketId.includes('o/u')) {
                    const threshold = parseFloat(marketId.match(/\d+\.?\d*/)?.[0] || '2.5');
                    legWon = prediction.includes('over') ? totalGoals > threshold : prediction.includes('under') ? totalGoals < threshold : null;
                  } else if (marketId.includes('double-chance')) {
                    const isHomeWin = homeScore > awayScore;
                    const isAwayWin = awayScore > homeScore;
                    const isDraw = homeScore === awayScore;
                    if (prediction === '1x' || prediction === 'home_draw') legWon = isHomeWin || isDraw;
                    else if (prediction === 'x2' || prediction === 'draw_away') legWon = isAwayWin || isDraw;
                    else if (prediction === '12' || prediction === 'home_away') legWon = isHomeWin || isAwayWin;
                  } else {
                    if (prediction === 'home' || prediction === '1') legWon = homeScore > awayScore;
                    else if (prediction === 'away' || prediction === '2') legWon = awayScore > homeScore;
                    else if (prediction === 'draw' || prediction === 'x') legWon = homeScore === awayScore;
                  }
                }
              }
            } catch {}

            legStatuses.push({ odds: legOdds, won: legWon });
          }

          const anyLost = legStatuses.some(l => l.won === false);
          if (anyLost) {
            console.warn(`🚫 PARLAY CASH-OUT BLOCKED (leg lost): Bet ${betId}`);
            return res.status(400).json({ message: "Cannot cash out - a parlay leg has already lost" });
          }

          cashOutValue = SettlementService.calculateParlayCashOut(
            parsedBetAmount, parsedOdds, legStatuses
          );
          console.log(`🎰 PARLAY CASH-OUT: ${betId} - ${legStatuses.filter(l => l.won === true).length}/${legs.length} legs won, ${legStatuses.filter(l => l.won === null).length} pending`);
        } else {
          cashOutValue = SettlementService.calculateCashOut(bet, parsedOdds, 0.75);
        }
      } else {
        const eventId = storedBet.eventId || (storedBet as any).externalEventId || '';
        const cachedOdds = eventId ? apiSportsService.getOddsFromCache(String(eventId)) : null;
        const prediction = (storedBet.prediction || '').toLowerCase().trim();

        let serverCurrentOdds = parsedOdds;
        if (cachedOdds) {
          if (prediction === 'home' || prediction === '1') serverCurrentOdds = cachedOdds.homeOdds;
          else if (prediction === 'away' || prediction === '2') serverCurrentOdds = cachedOdds.awayOdds;
          else if (prediction === 'draw' || prediction === 'x') serverCurrentOdds = cachedOdds.drawOdds || parsedOdds;
        }

        let gameContext: { elapsedMinutes?: number; totalMinutes?: number; isLive?: boolean; scoreFavorable?: boolean } | undefined;
        try {
          const numericEvId = Number(eventId);
          const evData = (!isNaN(numericEvId) && numericEvId > 0) ? await storage.getEvent(numericEvId) : null;
          if (evData) {
            const evStatus = ((evData as any).status || '').toLowerCase();
            if (evStatus === 'live' || evStatus === 'in_play' || evStatus === '1h' || evStatus === '2h' || evStatus === 'ht') {
              const elapsed = Number((evData as any).elapsed) || Number((evData as any).minute) || 0;
              const homeScore = Number((evData as any).homeScore) || 0;
              const awayScore = Number((evData as any).awayScore) || 0;
              const isHomePred = prediction === 'home' || prediction === '1';
              const isAwayPred = prediction === 'away' || prediction === '2';
              const isDrawPred = prediction === 'draw' || prediction === 'x';
              let scoreFavorable = true;
              if (isHomePred && awayScore > homeScore) scoreFavorable = false;
              else if (isAwayPred && homeScore > awayScore) scoreFavorable = false;
              else if (isDrawPred && homeScore !== awayScore) scoreFavorable = false;
              gameContext = { elapsedMinutes: elapsed, totalMinutes: 90, isLive: true, scoreFavorable };
            }
          }
        } catch {}

        cashOutValue = SettlementService.calculateCashOut(bet, serverCurrentOdds, 0.75, gameContext);
      }

      if (cashOutValue <= 0) {
        return res.status(400).json({ message: "Cash-out value is zero - bet cannot be cashed out" });
      }

      const maxPossiblePayout = parsedBetAmount * parsedOdds;
      if (cashOutValue > maxPossiblePayout) {
        console.error(`🚨 CASH-OUT CAP BREACH: Bet ${betId} cashOutValue=${cashOutValue} > maxPayout=${maxPossiblePayout} — clamping`);
        cashOutValue = maxPossiblePayout;
      }

      const platformFee = Math.round(cashOutValue * 0.02 * 100) / 100;
      const netCashOut = Math.round((cashOutValue - platformFee) * 100) / 100;

      if (expectedAmount && Number(expectedAmount) > 0) {
        const expected = Number(expectedAmount);
        const tolerance = 0.05;
        const diff = Math.abs(netCashOut - expected) / expected;
        if (diff > tolerance) {
          return res.status(409).json({ 
            message: "Cash-out value has changed since your estimate. Please review the new amount.",
            newEstimate: netCashOut,
            previousEstimate: expected,
            changed: true
          });
        }
      }

      if (netCashOut <= 0) {
        return res.status(400).json({ message: "Cash-out net amount is zero after fees" });
      }

      cashOutBetLocks.add(betId);
      try {
        const statusUpdated = await storage.updateBetStatus(betId, 'cashed_out', netCashOut);
        
        if (!statusUpdated) {
          console.log(`⚠️ DUPLICATE CASH-OUT PREVENTED: Bet ${betId} already cashed out or settled`);
          return res.status(400).json({ message: "Bet already cashed out or settled - duplicate cash-out prevented" });
        }

        cashOutRateLimit.set(walletKey, Date.now());

        console.log(`💸 CASH OUT: ${betId} - Value: ${cashOutValue} ${bet.currency}, Fee: ${platformFee} ${bet.currency}, Net: ${netCashOut} ${bet.currency}`);

        let onChainTxHash: string | undefined;
        let onChainError: string | undefined;
        let txSubmitted = false;

        const sendPayout = async (): Promise<{ success: boolean; txHash?: string; error?: string }> => {
          txSubmitted = true;
          if (bet.currency === 'SBETS') {
            return blockchainBetService.sendSbetsToUser(walletAddress, netCashOut);
          } else {
            return blockchainBetService.sendSuiToUser(walletAddress, netCashOut);
          }
        };

        try {
          let onChainResult = await sendPayout();
          if (!onChainResult.success) {
            console.warn(`⚠️ CASH OUT on-chain attempt 1 failed: ${onChainResult.error} — retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            onChainResult = await sendPayout();
          }

          if (onChainResult.success && onChainResult.txHash) {
            onChainTxHash = onChainResult.txHash;
            await storage.updateBetStatus(betId, 'cashed_out', netCashOut, onChainTxHash);
            console.log(`✅ CASH OUT ON-CHAIN: ${netCashOut} ${bet.currency} -> ${walletAddress.slice(0,10)}... | TX: ${onChainTxHash}`);
          } else {
            onChainError = onChainResult.error || 'Transaction failed';
            console.error(`❌ CASH OUT on-chain failed after retry: ${onChainError}`);
          }
        } catch (onChainErr: any) {
          onChainError = onChainErr.message || 'Unknown error';
          console.error(`❌ CASH OUT on-chain error: ${onChainError}`);
        }

        if (!onChainTxHash) {
          if (txSubmitted) {
            console.error(`🚨 CASH OUT TX SUBMITTED BUT NO CONFIRMATION: Bet ${betId} — keeping as cashed_out to prevent double-payout. Admin must verify.`);
            return res.status(500).json({
              success: false,
              message: `Cash-out transfer could not be confirmed. Your bet has been cashed out — if funds don't arrive, contact support.`,
              betId,
              retryable: false
            });
          } else {
            await storage.updateBetStatus(betId, 'pending');
            console.warn(`⚠️ CASH OUT REVERTED: Bet ${betId} — payout never attempted (admin key issue), reverting to pending`);
            return res.status(500).json({
              success: false,
              message: `Cash-out payout failed: ${onChainError || 'on-chain transfer error'}. Your bet is still active — please try again.`,
              betId,
              retryable: true
            });
          }
        }

        res.json({
          success: true,
          betId,
          cashOut: {
            originalStake: bet.betAmount,
            currency: bet.currency,
            cashOutValue: cashOutValue,
            platformFee: platformFee,
            netAmount: netCashOut,
            cashOutAt: Date.now(),
            status: 'cashed_out',
            txHash: onChainTxHash || null
          }
        });
      } finally {
        cashOutBetLocks.delete(betId);
      }
    } catch (error) {
      console.error("Cash-out error:", error);
      cashOutBetLocks.delete(betId);
      res.status(500).json({ message: "Failed to process cash-out" });
    }
  });

  // Register AI betting routes
  app.use(aiRoutes);

  // =====================================================
  // REVENUE SHARING API - SBETS Holder Revenue Distribution
  // =====================================================
  
  const SBETS_TOKEN_TYPE = process.env.SBETS_TOKEN_ADDRESS || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
  const REVENUE_SHARE_PERCENTAGE = 0.25;
  const LP_SHARE_PERCENTAGE = 0.25;
  
  // Contract deployment date - only count revenue from bets placed after this date
  // This prevents old test bets from inflating revenue statistics
  // Using 12:00 UTC to exclude synced legacy bets that were imported earlier in the day
  const CONTRACT_DEPLOYMENT_DATE = new Date('2026-01-29T12:00:00Z');
  
  // Helper to get settled bets (only from new contract period)
  async function getSettledBetsForRevenue(): Promise<any[]> {
    const allBets = await storage.getAllBets();
    // Include 'paid_out' status - these are winning bets that have been paid (1% fee = revenue)
    // Filter by contract deployment date to exclude old test bets
    return allBets.filter((bet: any) => {
      if (bet.status !== 'won' && bet.status !== 'lost' && bet.status !== 'paid_out') return false;
      const betDate = new Date(bet.placedAt || bet.createdAt || 0);
      return betDate >= CONTRACT_DEPLOYMENT_DATE;
    });
  }
  
  async function getRevenueClaims(walletAddress: string): Promise<Array<{ amount: number; amountSbets: number; timestamp: number; txHash: string; txHashSbets: string | null; weekStart: Date }>> {
    const { revenueClaims } = await import('@shared/schema');
    const { eq, and, or, isNull } = await import('drizzle-orm');
    const { db } = await import('./db');

    const claims = await db.select().from(revenueClaims).where(
      and(
        eq(revenueClaims.walletAddress, walletAddress),
        or(eq(revenueClaims.claimType, 'holder'), isNull(revenueClaims.claimType))
      )
    );
    return claims.map((c: any) => ({
      amount: c.claimAmount,
      amountSbets: c.claimAmountSbets || 0,
      timestamp: new Date(c.claimedAt).getTime(),
      txHash: c.txHash,
      txHashSbets: c.txHashSbets || null,
      weekStart: new Date(c.weekStart)
    }));
  }

  async function getLpRevenueClaims(walletAddress: string): Promise<Array<{ amount: number; amountSbets: number; timestamp: number; txHash: string; txHashSbets: string | null; weekStart: Date }>> {
    const { revenueClaims } = await import('@shared/schema');
    const { eq, and } = await import('drizzle-orm');
    const { db } = await import('./db');

    const claims = await db.select().from(revenueClaims).where(
      and(
        eq(revenueClaims.walletAddress, walletAddress),
        eq(revenueClaims.claimType, 'lp')
      )
    );
    return claims.map((c: any) => ({
      amount: c.claimAmount,
      amountSbets: c.claimAmountSbets || 0,
      timestamp: new Date(c.claimedAt).getTime(),
      txHash: c.txHash,
      txHashSbets: c.txHashSbets || null,
      weekStart: new Date(c.weekStart)
    }));
  }

  async function saveRevenueClaim(walletAddress: string, weekStart: Date, sbetsBalance: number, sharePercentage: number, claimAmount: number, claimAmountSbets: number, txHash: string, txHashSbets: string | null, claimType: string = 'holder'): Promise<boolean> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { db } = await import('./db');

      await db.insert(revenueClaims).values({
        walletAddress,
        weekStart,
        sbetsBalance,
        sharePercentage,
        claimAmount,
        claimAmountSbets,
        txHash,
        txHashSbets,
        claimType
      });
      return true;
    } catch (error) {
      console.error('Error saving revenue claim:', error);
      return false;
    }
  }
  
  // Get SBETS holders from blockchain
  app.get("/api/revenue/holders", async (req: Request, res: Response) => {
    try {
      const coinType = SBETS_TOKEN_TYPE;
      const supplyData = await getCirculatingSupply();

      res.json({
        success: true,
        tokenType: coinType,
        totalSupply: supplyData.totalSupply,
        circulatingSupply: supplyData.circulatingSupply,
        platformHoldings: supplyData.platformHoldings,
        holderCount: 95,
        note: 'Individual holder list requires indexer API. Share calculations use circulating supply denominator for accuracy.',
        lastUpdated: Date.now()
      });
    } catch (error: any) {
      console.error('Error fetching SBETS holders:', error);
      res.status(500).json({ message: 'Failed to fetch holders' });
    }
  });
  
  // Get platform revenue data for distribution
  app.get("/api/revenue/stats", async (req: Request, res: Response) => {
    try {
      const platformInfo = await blockchainBetService.getPlatformInfo();
      const settledBets = await getSettledBetsForRevenue();
      console.log(`[Revenue Stats] Settled bets for revenue: ${settledBets.length} | SBETS token: ${SBETS_TOKEN_TYPE.slice(0,12)}...`);
      
      const now = new Date();
      const startOfWeek = new Date(now);
      const todayDow = now.getDay();
      startOfWeek.setDate(now.getDate() + (todayDow === 0 ? -6 : 1 - todayDow));
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      
      // Filter bets for this week (use placedAt from storage, not createdAt)
      const weeklyBets = settledBets.filter((bet: any) => {
        const betDate = new Date(bet.placedAt || bet.createdAt || 0);
        return betDate >= startOfWeek && betDate <= endOfWeek;
      });
      
      // Price conversion: Convert all revenue to SUI equivalent for display
      // Updated January 27, 2026 - SUI trading at ~$1.50
      const SUI_PRICE_USD = 1.50;
      const SBETS_PRICE_USD = 0.000001;
      const sbetsToSuiRatio = SBETS_PRICE_USD / SUI_PRICE_USD; // ~0.000000667
      
      // Track SUI and SBETS revenue separately
      const FEE_RATE = 0.01;
      const weeklyRevenueSui = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SUI') return sum;
        let revenue = 0;
        const stake = bet.betAmount || bet.stake || 0;
        if (bet.status === 'lost') {
          revenue = stake * FEE_RATE;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const profit = (bet.potentialPayout || bet.potentialWin) - stake;
          revenue = profit * FEE_RATE;
        }
        return sum + revenue;
      }, 0);
      
      const weeklyRevenueSbets = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SBETS') return sum;
        let revenue = 0;
        const stake = bet.betAmount || bet.stake || 0;
        if (bet.status === 'lost') {
          revenue = stake * FEE_RATE;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const profit = (bet.potentialPayout || bet.potentialWin) - stake;
          revenue = profit * FEE_RATE;
        }
        return sum + revenue;
      }, 0);
      
      // Combined for backward compatibility (in SUI equivalent)
      const weeklyRevenue = weeklyRevenueSui + (weeklyRevenueSbets * sbetsToSuiRatio);
      
      // Calculate all-time total revenue - track separately
      const REVENUE_START_DATE = new Date('2026-01-27T00:00:00Z');
      const allTimeBets = settledBets.filter((bet: any) => new Date(bet.placedAt || bet.createdAt || 0) >= REVENUE_START_DATE);
      
      const allTimeRevenueSui = allTimeBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SUI') return sum;
        let revenue = 0;
        const stake = bet.betAmount || bet.stake || 0;
        if (bet.status === 'lost') {
          revenue = stake * FEE_RATE;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const profit = (bet.potentialPayout || bet.potentialWin) - stake;
          revenue = profit * FEE_RATE;
        }
        return sum + revenue;
      }, 0);
      
      const allTimeRevenueSbets = allTimeBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SBETS') return sum;
        let revenue = 0;
        const stake = bet.betAmount || bet.stake || 0;
        if (bet.status === 'lost') {
          revenue = stake * FEE_RATE;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const profit = (bet.potentialPayout || bet.potentialWin) - stake;
          revenue = profit * FEE_RATE;
        }
        return sum + revenue;
      }, 0);
      
      const allTimeRevenue = allTimeRevenueSui + (allTimeRevenueSbets * sbetsToSuiRatio);
      
      const holderShareSui = weeklyRevenueSui * 0.25;
      const holderShareSbets = weeklyRevenueSbets * 0.25;
      const treasuryShareSui = weeklyRevenueSui * 0.25;
      const treasuryShareSbets = weeklyRevenueSbets * 0.25;
      const profitShareSui = weeklyRevenueSui * 0.25;
      const profitShareSbets = weeklyRevenueSbets * 0.25;
      const lpShareSui = weeklyRevenueSui * 0.25;
      const lpShareSbets = weeklyRevenueSbets * 0.25;

      res.json({
        success: true,
        weekStart: startOfWeek.toISOString(),
        weekEnd: endOfWeek.toISOString(),
        totalRevenue: weeklyRevenue,
        allTimeRevenue: allTimeRevenue,
        totalRevenueSui: weeklyRevenueSui,
        totalRevenueSbets: weeklyRevenueSbets,
        allTimeRevenueSui: allTimeRevenueSui,
        allTimeRevenueSbets: allTimeRevenueSbets,
        distribution: {
          holders: {
            percentage: 25,
            amount: holderShareSui + (holderShareSbets * sbetsToSuiRatio),
            sui: holderShareSui,
            sbets: holderShareSbets
          },
          treasury: {
            percentage: 25,
            amount: treasuryShareSui + (treasuryShareSbets * sbetsToSuiRatio),
            sui: treasuryShareSui,
            sbets: treasuryShareSbets
          },
          profit: {
            percentage: 25,
            amount: profitShareSui + (profitShareSbets * sbetsToSuiRatio),
            sui: profitShareSui,
            sbets: profitShareSbets
          },
          lp: {
            percentage: 25,
            amount: lpShareSui + (lpShareSbets * sbetsToSuiRatio),
            sui: lpShareSui,
            sbets: lpShareSbets
          }
        },
        onChainData: {
          treasuryBalance: platformInfo?.treasuryBalanceSui || 0,
          treasuryBalanceSbets: platformInfo?.treasuryBalanceSbets || 0,
          treasuryBalanceUsdsui: platformInfo?.treasuryBalanceUsdsui || 0,
          totalBets: platformInfo?.totalBets || 0,
          totalVolume: platformInfo?.totalVolumeSui || 0,
          accruedFees: platformInfo?.accruedFeesSui || 0,
          accruedFeesSbets: platformInfo?.accruedFeesSbets || 0
        },
        claimed: await (async () => {
          const holderClaimed = await getTotalClaimedByType('holder');
          const lpClaimed = await getTotalClaimedByType('lp');
          const allTimeRev = computeAllTimeRevenue(allTimeBets);
          const holderPoolAllTimeSui = allTimeRev.totalSui * 0.25;
          const holderPoolAllTimeSbets = allTimeRev.totalSbets * 0.25;
          const lpPoolAllTimeSui = allTimeRev.totalSui * 0.25;
          const lpPoolAllTimeSbets = allTimeRev.totalSbets * 0.25;
          return {
            holders: {
              claimedSui: holderClaimed.claimedSui,
              claimedSbets: holderClaimed.claimedSbets,
              remainingSui: Math.max(holderPoolAllTimeSui - holderClaimed.claimedSui, 0),
              remainingSbets: Math.max(holderPoolAllTimeSbets - holderClaimed.claimedSbets, 0)
            },
            lp: {
              claimedSui: lpClaimed.claimedSui,
              claimedSbets: lpClaimed.claimedSbets,
              remainingSui: Math.max(lpPoolAllTimeSui - lpClaimed.claimedSui, 0),
              remainingSbets: Math.max(lpPoolAllTimeSbets - lpClaimed.claimedSbets, 0)
            },
            totalClaimedSui: holderClaimed.claimedSui + lpClaimed.claimedSui,
            totalClaimedSbets: holderClaimed.claimedSbets + lpClaimed.claimedSbets
          };
        })(),
        historicalRevenue: await getWeeklyRevenueHistory(),
        lastUpdated: Date.now()
      });
    } catch (error: any) {
      console.error('Error fetching revenue stats:', error);
      res.status(500).json({ message: 'Failed to fetch revenue stats' });
    }
  });
  
  function computeAllTimeRevenue(settledBets: any[]): { totalSui: number; totalSbets: number } {
    let totalSui = 0;
    let totalSbets = 0;
    const FEE_RATE = 0.01;
    for (const bet of settledBets) {
      let revenue = 0;
      const stake = bet.betAmount || bet.stake || 0;
      if (bet.status === 'lost') {
        revenue = stake * FEE_RATE;
      } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
        const profit = (bet.potentialPayout || bet.potentialWin) - stake;
        revenue = profit * FEE_RATE;
      }
      if (revenue > 0) {
        if (bet.currency === 'SUI') totalSui += revenue;
        else if (bet.currency === 'SBETS') totalSbets += revenue;
      }
    }
    return { totalSui, totalSbets };
  }

  async function getTotalClaimedByType(claimType: string): Promise<{ claimedSui: number; claimedSbets: number }> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { eq, and, ne } = await import('drizzle-orm');
      const { db } = await import('./db');
      const claims = await db.select().from(revenueClaims).where(
        and(
          eq(revenueClaims.claimType, claimType),
          ne(revenueClaims.txHash, 'pending')
        )
      );
      let claimedSui = 0;
      let claimedSbets = 0;
      for (const c of claims) {
        claimedSui += Number(c.claimAmount) || 0;
        claimedSbets += Number(c.claimAmountSbets) || 0;
      }
      return { claimedSui, claimedSbets };
    } catch {
      return { claimedSui: 0, claimedSbets: 0 };
    }
  }

  async function deletePendingClaim(walletAddress: string, weekStart: Date, claimType: string): Promise<void> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { eq, and, gte } = await import('drizzle-orm');
      const { db } = await import('./db');
      await db.delete(revenueClaims).where(
        and(
          eq(revenueClaims.walletAddress, walletAddress),
          eq(revenueClaims.txHash, 'pending'),
          eq(revenueClaims.claimType, claimType),
          gte(revenueClaims.weekStart, weekStart)
        )
      );
      console.log(`[Revenue] Cleaned up pending ${claimType} claim for ${walletAddress.slice(0, 10)}...`);
    } catch (err) {
      console.error(`[Revenue] Failed to clean up pending claim:`, err);
    }
  }

  async function getUserClaimedByType(walletAddress: string, claimType: string): Promise<{ claimedSui: number; claimedSbets: number }> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { eq, and, ne, or, isNull } = await import('drizzle-orm');
      const { db } = await import('./db');
      const typeFilter = claimType === 'holder'
        ? or(eq(revenueClaims.claimType, 'holder'), isNull(revenueClaims.claimType))
        : eq(revenueClaims.claimType, claimType);
      const claims = await db.select().from(revenueClaims).where(
        and(
          eq(revenueClaims.walletAddress, walletAddress),
          typeFilter,
          ne(revenueClaims.txHash, 'pending')
        )
      );
      let claimedSui = 0;
      let claimedSbets = 0;
      for (const c of claims) {
        claimedSui += Number(c.claimAmount) || 0;
        claimedSbets += Number(c.claimAmountSbets) || 0;
      }
      return { claimedSui, claimedSbets };
    } catch {
      return { claimedSui: 0, claimedSbets: 0 };
    }
  }

  // Get user's claimable revenue (accumulated all-time pool minus total claims)
  app.get("/api/revenue/claimable/:walletAddress", async (req: Request, res: Response) => {
    try {
      const rawWallet = req.params.walletAddress;
      
      if (!rawWallet || !/^0x[a-fA-F0-9]{64}$/.test(rawWallet)) {
        return res.status(400).json({ message: 'Valid wallet address required' });
      }
      const walletAddress = rawWallet.toLowerCase();
      
      const supplyData = await getCirculatingSupply();
      const userSbets = await getUserSbetsBalance(walletAddress);

      const sharePercentage = supplyData.circulatingSupply > 0
        ? Math.min((userSbets / supplyData.circulatingSupply) * 100, 100)
        : 0;

      console.log(`[Revenue] User ${walletAddress.slice(0,10)}... has ${userSbets.toLocaleString()} SBETS | Circulating: ${supplyData.circulatingSupply.toLocaleString()} | Share: ${sharePercentage.toFixed(6)}%`);

      const settledBets = await getSettledBetsForRevenue();
      const allTimeRevenue = computeAllTimeRevenue(settledBets);

      const holderPoolSui = allTimeRevenue.totalSui * REVENUE_SHARE_PERCENTAGE;
      const holderPoolSbets = allTimeRevenue.totalSbets * REVENUE_SHARE_PERCENTAGE;

      const userShareRatio = supplyData.circulatingSupply > 0
        ? Math.min(userSbets / supplyData.circulatingSupply, 1.0)
        : 0;

      const userEntitlementSui = holderPoolSui * userShareRatio;
      const userEntitlementSbets = holderPoolSbets * userShareRatio;

      const userClaimed = await getUserClaimedByType(walletAddress, 'holder');
      const userClaimableSui = Math.max(userEntitlementSui - userClaimed.claimedSui, 0);
      const userClaimableSbets = Math.max(userEntitlementSbets - userClaimed.claimedSbets, 0);

      const userClaims = await getRevenueClaims(walletAddress);
      const lastClaim = userClaims.length > 0 ? userClaims[0] : null;

      console.log(`[Revenue] Pool SUI: ${holderPoolSui.toFixed(6)} | Pool SBETS: ${holderPoolSbets.toFixed(2)} | User entitled SUI: ${userEntitlementSui.toFixed(6)} | SBETS: ${userEntitlementSbets.toFixed(2)} | Already claimed SUI: ${userClaimed.claimedSui.toFixed(6)} | SBETS: ${userClaimed.claimedSbets.toFixed(2)} | Claimable SUI: ${userClaimableSui.toFixed(6)} | SBETS: ${userClaimableSbets.toFixed(2)}`);

      res.json({
        success: true,
        walletAddress,
        sbetsBalance: userSbets,
        sharePercentage: sharePercentage.toFixed(6),
        weeklyRevenuePool: holderPoolSui + (holderPoolSbets * 0.000001 / 1.50),
        claimableAmount: userClaimableSui,
        weeklyRevenuePoolSui: holderPoolSui,
        weeklyRevenuePoolSbets: holderPoolSbets,
        claimableSui: userClaimableSui,
        claimableSbets: userClaimableSbets,
        alreadyClaimed: userClaimableSui <= 0 && userClaimableSbets <= 0 && userClaimed.claimedSbets > 0,
        lastClaimTxHash: lastClaim?.txHash || null,
        claimHistory: userClaims.map(c => ({
          amountSui: c.amount,
          amountSbets: c.amountSbets || 0,
          timestamp: c.timestamp,
          txHash: c.txHash,
          txHashSbets: c.txHashSbets
        })),
        totalSupply: supplyData.totalSupply,
        circulatingSupply: supplyData.circulatingSupply,
        lastUpdated: Date.now()
      });
    } catch (error: any) {
      console.error('Error fetching claimable revenue:', error);
      res.status(500).json({ message: 'Failed to fetch claimable amount' });
    }
  });
  
  const claimRateLimits = new Map<string, number>();
  const activeClaimLocks = new Set<string>();

  async function getLastClaimTimestamp(wallet: string, claimType: string): Promise<number | null> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { eq, and, ne, or, isNull, desc } = await import('drizzle-orm');
      const { db } = await import('./db');
      const typeFilter = claimType === 'holder'
        ? or(eq(revenueClaims.claimType, 'holder'), isNull(revenueClaims.claimType))
        : eq(revenueClaims.claimType, claimType);
      const rows = await db.select({ claimedAt: revenueClaims.claimedAt }).from(revenueClaims).where(
        and(eq(revenueClaims.walletAddress, wallet), typeFilter, ne(revenueClaims.txHash, 'pending'))
      ).orderBy(desc(revenueClaims.claimedAt)).limit(1);
      return rows.length > 0 ? new Date(rows[0].claimedAt).getTime() : null;
    } catch { return null; }
  }

  async function cleanupStalePendingClaims(wallet: string, claimType: string): Promise<void> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { eq, and, or, isNull } = await import('drizzle-orm');
      const { db } = await import('./db');
      const typeFilter = claimType === 'holder'
        ? or(eq(revenueClaims.claimType, 'holder'), isNull(revenueClaims.claimType))
        : eq(revenueClaims.claimType, claimType);
      await db.delete(revenueClaims).where(
        and(eq(revenueClaims.walletAddress, wallet), typeFilter, eq(revenueClaims.txHash, 'pending'))
      );
    } catch (e) { console.warn('[Revenue] Failed to cleanup stale pending claims:', e); }
  }

  app.post("/api/revenue/claim", async (req: Request, res: Response) => {
    try {
      const { walletAddress: rawWallet } = req.body;
      
      if (!rawWallet) {
        return res.status(400).json({ message: 'Wallet address required' });
      }
      
      if (!isValidSuiWallet(rawWallet)) {
        return res.status(400).json({ message: 'Invalid wallet address format' });
      }

      const walletAddress = rawWallet.toLowerCase();

      if (isWalletBlocked(walletAddress)) {
        return res.status(403).json({ message: 'This wallet has been suspended due to policy violations.', code: 'WALLET_BLOCKED' });
      }
      
      const claimKey = walletAddress;

      if (activeClaimLocks.has(claimKey)) {
        return res.status(429).json({ message: 'Claim already in progress. Please wait.' });
      }

      const memoryLastClaim = claimRateLimits.get(claimKey);
      const dbLastClaim = await getLastClaimTimestamp(walletAddress, 'holder');
      const lastClaimTime = Math.max(memoryLastClaim || 0, dbLastClaim || 0);
      if (lastClaimTime && Date.now() - lastClaimTime < 24 * 60 * 60 * 1000) {
        const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (Date.now() - lastClaimTime)) / (60 * 60 * 1000));
        return res.status(429).json({ message: `Holder rewards can only be claimed once per day. Try again in ~${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}.` });
      }

      activeClaimLocks.add(claimKey);
      
      try {
      
      const useRevenueWallet = blockchainBetService.isRevenueKeyConfigured();
      if (!useRevenueWallet && !blockchainBetService.isAdminKeyConfigured()) {
        return res.status(400).json({ message: 'Server not configured for payouts' });
      }
      
      const userSbets = await getUserSbetsBalance(walletAddress);

      if (userSbets <= 0) {
        return res.status(400).json({ message: 'You must hold SBETS tokens to claim revenue' });
      }
      
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1);
      startOfWeek.setHours(0, 0, 0, 0);

      await cleanupStalePendingClaims(walletAddress, 'holder');
      
      const supplyData = await getCirculatingSupply();

      console.log(`[Revenue] CLAIM: ${walletAddress.slice(0,10)}... has ${userSbets.toLocaleString()} SBETS | Circulating: ${supplyData.circulatingSupply.toLocaleString()}`);

      const settledBets = await getSettledBetsForRevenue();
      const allTimeRevenue = computeAllTimeRevenue(settledBets);

      const holderPoolSui = allTimeRevenue.totalSui * REVENUE_SHARE_PERCENTAGE;
      const holderPoolSbets = allTimeRevenue.totalSbets * REVENUE_SHARE_PERCENTAGE;

      const userShareRatio = supplyData.circulatingSupply > 0 ? Math.min(userSbets / supplyData.circulatingSupply, 1.0) : 0;
      const userEntitlementSui = holderPoolSui * userShareRatio;
      const userEntitlementSbets = holderPoolSbets * userShareRatio;

      const userClaimed = await getUserClaimedByType(walletAddress, 'holder');
      const claimSui = Math.max(userEntitlementSui - userClaimed.claimedSui, 0);
      const claimSbets = Math.max(userEntitlementSbets - userClaimed.claimedSbets, 0);

      const MIN_CLAIM_SUI = 0.001;
      const MIN_CLAIM_SBETS = 1;

      if (claimSui < MIN_CLAIM_SUI && claimSbets < MIN_CLAIM_SBETS) {
        const sharePercent = (userShareRatio * 100).toFixed(6);
        return res.status(400).json({
          message: `Your claimable amount is too small (${claimSui.toFixed(6)} SUI + ${claimSbets.toFixed(4)} SBETS). You hold ${sharePercent}% of circulating SBETS supply. Accumulate more SBETS tokens to increase your share.`,
          claimableSui: claimSui,
          claimableSbets: claimSbets,
          sharePercentage: sharePercent,
          minimumRequired: { sui: MIN_CLAIM_SUI, sbets: MIN_CLAIM_SBETS }
        });
      }

      console.log(`[Revenue] Processing claim: ${walletAddress.slice(0,10)}... claiming ${claimSui.toFixed(6)} SUI + ${claimSbets.toFixed(2)} SBETS`);
      
      let suiTxHash: string | null = null;
      let sbetsTxHash: string | null = null;
      let actualSuiPaid = 0;
      let actualSbetsPaid = 0;
      
      if (claimSui >= MIN_CLAIM_SUI) {
        if (!useRevenueWallet) {
          try {
            const platformInfo = await blockchainBetService.getPlatformInfo();
            const accruedSui = platformInfo?.accruedFeesSui || 0;
            if (accruedSui >= claimSui) {
              console.log(`[Revenue] Withdrawing ${claimSui.toFixed(6)} SUI from contract accrued fees (available: ${accruedSui.toFixed(6)})`);
              const withdrawResult = await blockchainBetService.withdrawFeesOnChain(claimSui);
              if (withdrawResult.success) {
                console.log(`[Revenue] SUI fee withdrawal successful: TX ${withdrawResult.txHash}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
              } else {
                console.warn(`[Revenue] SUI fee withdrawal failed: ${withdrawResult.error} — falling back to admin balance`);
              }
            } else {
              console.warn(`[Revenue] Not enough accrued SUI fees (${accruedSui.toFixed(6)} < ${claimSui.toFixed(6)}) — using admin balance`);
            }
          } catch (feeErr: any) {
            console.warn(`[Revenue] Fee withdrawal check failed: ${feeErr.message} — using admin balance`);
          }
        }
        
        let suiPayoutResult;
        let suiPayoutSource = 'admin wallet';
        if (useRevenueWallet) {
          suiPayoutResult = await blockchainBetService.sendSuiFromRevenueWallet(walletAddress, claimSui);
          suiPayoutSource = 'revenue wallet';
          if (!suiPayoutResult.success && blockchainBetService.isAdminKeyConfigured()) {
            console.warn(`[Revenue] Revenue wallet SUI payout failed (${suiPayoutResult.error}), falling back to admin wallet`);
            suiPayoutResult = await blockchainBetService.sendSuiToUser(walletAddress, claimSui);
            suiPayoutSource = 'admin wallet (fallback)';
          }
        } else {
          suiPayoutResult = await blockchainBetService.sendSuiToUser(walletAddress, claimSui);
        }
        if (!suiPayoutResult.success) {
          console.error(`[Revenue] SUI claim failed: ${suiPayoutResult.error}`);
          return res.status(400).json({ message: suiPayoutResult.error || 'Failed to send SUI payout' });
        }
        suiTxHash = suiPayoutResult.txHash || null;
        actualSuiPaid = claimSui;
        console.log(`[Revenue] SUI payout successful (${suiPayoutSource}): ${claimSui.toFixed(6)} SUI | TX: ${suiTxHash}`);
      }
      
      if (claimSbets >= MIN_CLAIM_SBETS) {
        if (!useRevenueWallet) {
          try {
            const platformInfo = await blockchainBetService.getPlatformInfo();
            const accruedSbets = platformInfo?.accruedFeesSbets || 0;
            if (accruedSbets >= claimSbets) {
              console.log(`[Revenue] Withdrawing ${claimSbets.toFixed(2)} SBETS from contract accrued fees (available: ${accruedSbets.toFixed(2)})`);
              const withdrawResult = await blockchainBetService.withdrawFeesSbetsOnChain(claimSbets);
              if (withdrawResult.success) {
                console.log(`[Revenue] SBETS fee withdrawal successful: TX ${withdrawResult.txHash}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
              } else {
                console.warn(`[Revenue] SBETS fee withdrawal failed: ${withdrawResult.error} — falling back to admin balance`);
              }
            } else {
              console.warn(`[Revenue] Not enough accrued SBETS fees (${accruedSbets.toFixed(2)} < ${claimSbets.toFixed(2)}) — using admin balance`);
            }
          } catch (feeErr: any) {
            console.warn(`[Revenue] SBETS fee withdrawal check failed: ${feeErr.message} — using admin balance`);
          }
        }
        
        let sbetsPayoutResult;
        let sbetsPayoutSource = 'admin wallet';
        if (useRevenueWallet) {
          sbetsPayoutResult = await blockchainBetService.sendSbetsFromRevenueWallet(walletAddress, claimSbets);
          sbetsPayoutSource = 'revenue wallet';
          if (!sbetsPayoutResult.success && blockchainBetService.isAdminKeyConfigured()) {
            console.warn(`[Revenue] Revenue wallet SBETS payout failed (${sbetsPayoutResult.error}), falling back to admin wallet`);
            sbetsPayoutResult = await blockchainBetService.sendSbetsToUser(walletAddress, claimSbets);
            sbetsPayoutSource = 'admin wallet (fallback)';
          }
        } else {
          sbetsPayoutResult = await blockchainBetService.sendSbetsToUser(walletAddress, claimSbets);
        }
        if (!sbetsPayoutResult.success) {
          console.error(`[Revenue] SBETS claim failed: ${sbetsPayoutResult.error}`);
          if (suiTxHash) {
            const sharePercentage = supplyData.circulatingSupply > 0 ? Math.min((userSbets / supplyData.circulatingSupply) * 100, 100) : 0;
            await saveRevenueClaim(walletAddress, startOfWeek, userSbets, sharePercentage, actualSuiPaid, 0, suiTxHash, null);
            claimRateLimits.set(claimKey, Date.now());
            console.warn(`[Revenue] Partial claim saved: SUI paid (${actualSuiPaid}), SBETS failed — recorded SUI-only claim to prevent double SUI payout`);
          }
          return res.status(400).json({ message: sbetsPayoutResult.error || 'Failed to send SBETS payout', partialSuccess: !!suiTxHash, suiTxHash });
        }
        sbetsTxHash = sbetsPayoutResult.txHash || null;
        actualSbetsPaid = claimSbets;
        console.log(`[Revenue] SBETS payout successful (${sbetsPayoutSource}): ${claimSbets.toFixed(2)} SBETS | TX: ${sbetsTxHash}`);
      }
      
      const sharePercentage = supplyData.circulatingSupply > 0 ? Math.min((userSbets / supplyData.circulatingSupply) * 100, 100) : 0;
      await saveRevenueClaim(walletAddress, startOfWeek, userSbets, sharePercentage, actualSuiPaid, actualSbetsPaid, suiTxHash || 'no_sui', sbetsTxHash);

      claimRateLimits.set(claimKey, Date.now());
      
      console.log(`[Revenue] Claim successful: ${walletAddress.slice(0,10)}... received ${actualSuiPaid.toFixed(6)} SUI + ${actualSbetsPaid.toFixed(2)} SBETS`);
      
      res.json({
        success: true,
        walletAddress,
        claimedAmount: actualSuiPaid,
        claimedSui: actualSuiPaid,
        claimedSbets: actualSbetsPaid,
        txHash: suiTxHash,
        suiTxHash,
        sbetsTxHash,
        timestamp: Date.now()
      });
      } finally {
        activeClaimLocks.delete(claimKey);
      }
    } catch (error: any) {
      console.error('Error processing claim:', error);
      res.status(500).json({ message: 'Failed to process claim' });
    }
  });
  
  app.get("/api/revenue/lp-positions", async (req: Request, res: Response) => {
    try {
      const data = await getCetusLpPositions();
      res.json({
        success: true,
        poolId: '0xa809b51ec650e4ae45224107e62787be5e58f9caf8d3f74542f8edd73dc37a50',
        positionCount: data.positions.length,
        totalLiquidity: data.totalLiquidity.toString(),
        positions: data.positions.map(p => ({
          positionId: p.positionId,
          ownerAddress: p.ownerAddress,
          liquidity: p.liquidity,
          sharePercentage: p.sharePercentage.toFixed(6),
          isBurned: p.isBurned
        })),
        lastUpdated: data.lastUpdated
      });
    } catch (error: any) {
      console.error('Error fetching LP positions:', error);
      res.status(500).json({ message: 'Failed to fetch LP positions' });
    }
  });

  app.get("/api/revenue/lp-claimable/:walletAddress", async (req: Request, res: Response) => {
    try {
      const rawWallet = req.params.walletAddress;

      if (!rawWallet || !/^0x[a-fA-F0-9]{64}$/.test(rawWallet)) {
        return res.status(400).json({ message: 'Valid wallet address required' });
      }
      const walletAddress = rawWallet.toLowerCase();

      const lpData = await getUserLpShare(walletAddress);

      if (!lpData.hasPosition) {
        return res.json({
          success: true,
          walletAddress,
          hasPosition: false,
          lpSharePercentage: '0',
          userLiquidity: 0,
          totalLiquidity: lpData.totalLiquidity,
          positions: [],
          claimableSui: 0,
          claimableSbets: 0,
          alreadyClaimed: false,
          lastClaimTxHash: null,
          claimHistory: [],
          lastUpdated: Date.now()
        });
      }

      const settledBets = await getSettledBetsForRevenue();
      const allTimeRevenue = computeAllTimeRevenue(settledBets);

      const lpPoolSui = allTimeRevenue.totalSui * LP_SHARE_PERCENTAGE;
      const lpPoolSbets = allTimeRevenue.totalSbets * LP_SHARE_PERCENTAGE;

      const userShareRatio = lpData.totalLiquidity > 0
        ? Math.min(lpData.userLiquidity / lpData.totalLiquidity, 1.0)
        : 0;

      const userEntitlementSui = lpPoolSui * userShareRatio;
      const userEntitlementSbets = lpPoolSbets * userShareRatio;

      const userClaimed = await getUserClaimedByType(walletAddress, 'lp');
      const userClaimableSui = Math.max(userEntitlementSui - userClaimed.claimedSui, 0);
      const userClaimableSbets = Math.max(userEntitlementSbets - userClaimed.claimedSbets, 0);

      const userClaims = await getLpRevenueClaims(walletAddress);
      const lastClaim = userClaims.length > 0 ? userClaims[0] : null;

      res.json({
        success: true,
        walletAddress,
        hasPosition: true,
        lpSharePercentage: lpData.sharePercentage.toFixed(6),
        userLiquidity: lpData.userLiquidity,
        totalLiquidity: lpData.totalLiquidity,
        positions: lpData.positions,
        weeklyRevenuePoolSui: lpPoolSui,
        weeklyRevenuePoolSbets: lpPoolSbets,
        claimableSui: userClaimableSui,
        claimableSbets: userClaimableSbets,
        alreadyClaimed: userClaimableSui <= 0 && userClaimableSbets <= 0 && userClaimed.claimedSbets > 0,
        lastClaimTxHash: lastClaim?.txHash || null,
        claimHistory: userClaims.map((c: any) => ({
          amountSui: c.amount,
          amountSbets: c.amountSbets || 0,
          timestamp: c.timestamp,
          txHash: c.txHash,
          txHashSbets: c.txHashSbets
        })),
        lastUpdated: Date.now()
      });
    } catch (error: any) {
      console.error('Error fetching LP claimable:', error);
      res.status(500).json({ message: 'Failed to fetch LP claimable amount' });
    }
  });

  const lpClaimRateLimits = new Map<string, number>();
  const activeLpClaimLocks = new Set<string>();

  app.post("/api/revenue/lp-claim", async (req: Request, res: Response) => {
    try {
      const { walletAddress: rawWallet } = req.body;

      if (!rawWallet) {
        return res.status(400).json({ message: 'Wallet address required' });
      }

      if (!isValidSuiWallet(rawWallet)) {
        return res.status(400).json({ message: 'Invalid wallet address format' });
      }

      const walletAddress = rawWallet.toLowerCase();

      if (isWalletBlocked(walletAddress)) {
        return res.status(403).json({ message: 'This wallet has been suspended due to policy violations.', code: 'WALLET_BLOCKED' });
      }

      const claimKey = walletAddress;

      if (activeLpClaimLocks.has(claimKey)) {
        return res.status(429).json({ message: 'LP claim already in progress. Please wait.' });
      }

      const memoryLastClaim = lpClaimRateLimits.get(claimKey);
      const dbLastClaim = await getLastClaimTimestamp(walletAddress, 'lp');
      const lastClaimTime = Math.max(memoryLastClaim || 0, dbLastClaim || 0);
      if (lastClaimTime && Date.now() - lastClaimTime < 24 * 60 * 60 * 1000) {
        const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (Date.now() - lastClaimTime)) / (60 * 60 * 1000));
        return res.status(429).json({ message: `LP rewards can only be claimed once per day. Try again in ~${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}.` });
      }

      activeLpClaimLocks.add(claimKey);

      try {

        const useRevenueWalletLp = blockchainBetService.isRevenueKeyConfigured();
        if (!useRevenueWalletLp && !blockchainBetService.isAdminKeyConfigured()) {
          return res.status(400).json({ message: 'Server not configured for payouts' });
        }

        const lpData = await getUserLpShare(walletAddress);

        if (!lpData.hasPosition || lpData.userLiquidity <= 0) {
          return res.status(400).json({ message: 'You must provide liquidity to the SBETS-SUI Cetus pool to claim LP revenue' });
        }

        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay() + 1);
        startOfWeek.setHours(0, 0, 0, 0);

        await cleanupStalePendingClaims(walletAddress, 'lp');

        const settledBets = await getSettledBetsForRevenue();
        const allTimeRevenue = computeAllTimeRevenue(settledBets);

        const lpPoolSui = allTimeRevenue.totalSui * LP_SHARE_PERCENTAGE;
        const lpPoolSbets = allTimeRevenue.totalSbets * LP_SHARE_PERCENTAGE;

        const userShareRatio = lpData.totalLiquidity > 0 ? Math.min(lpData.userLiquidity / lpData.totalLiquidity, 1.0) : 0;
        const userEntitlementSui = lpPoolSui * userShareRatio;
        const userEntitlementSbets = lpPoolSbets * userShareRatio;

        const userClaimed = await getUserClaimedByType(walletAddress, 'lp');
        const claimSui = Math.max(userEntitlementSui - userClaimed.claimedSui, 0);
        const claimSbets = Math.max(userEntitlementSbets - userClaimed.claimedSbets, 0);

        const MIN_CLAIM_SUI = 0.001;
        const MIN_CLAIM_SBETS = 1;

        if (claimSui < MIN_CLAIM_SUI && claimSbets < MIN_CLAIM_SBETS) {
          return res.status(400).json({
            message: `Your LP claimable amount is too small (${claimSui.toFixed(6)} SUI + ${claimSbets.toFixed(4)} SBETS). Your liquidity share is ${(userShareRatio * 100).toFixed(6)}%.`,
            claimableSui: claimSui,
            claimableSbets: claimSbets,
            sharePercentage: (userShareRatio * 100).toFixed(6)
          });
        }

        console.log(`[LP Revenue] Processing LP claim: ${walletAddress.slice(0,10)}... claiming ${claimSui.toFixed(6)} SUI + ${claimSbets.toFixed(2)} SBETS (${lpData.sharePercentage.toFixed(4)}% of pool)`);

        let suiTxHash: string | null = null;
        let sbetsTxHash: string | null = null;
        let actualSuiPaid = 0;
        let actualSbetsPaid = 0;

        if (claimSui >= MIN_CLAIM_SUI) {
          try {
            const platformInfo = await blockchainBetService.getPlatformInfo();
            const accruedSui = platformInfo?.accruedFeesSui || 0;
            if (accruedSui >= claimSui) {
              console.log(`[LP Revenue] Withdrawing ${claimSui.toFixed(6)} SUI from contract fees (available: ${accruedSui.toFixed(6)})`);
              const wr = await blockchainBetService.withdrawFeesOnChain(claimSui);
              if (wr.success) { console.log(`[LP Revenue] SUI fee withdrawal OK: TX ${wr.txHash}`); await new Promise(r => setTimeout(r, 2000)); }
              else { console.warn(`[LP Revenue] SUI fee withdrawal failed: ${wr.error}`); }
            } else { console.warn(`[LP Revenue] Not enough accrued SUI fees (${accruedSui.toFixed(6)} < ${claimSui.toFixed(6)})`); }
          } catch (e: any) { console.warn(`[LP Revenue] Fee check failed: ${e.message}`); }

          let suiPayoutResult;
          if (useRevenueWalletLp) {
            suiPayoutResult = await blockchainBetService.sendSuiFromRevenueWallet(walletAddress, claimSui);
            if (!suiPayoutResult.success && blockchainBetService.isAdminKeyConfigured()) {
              console.warn(`[LP Revenue] Revenue wallet SUI payout failed (${suiPayoutResult.error}), falling back to admin wallet`);
              suiPayoutResult = await blockchainBetService.sendSuiToUser(walletAddress, claimSui);
            }
          } else {
            suiPayoutResult = await blockchainBetService.sendSuiToUser(walletAddress, claimSui);
          }
          if (!suiPayoutResult.success) {
            console.error(`[LP Revenue] SUI claim failed: ${suiPayoutResult.error}`);
            return res.status(400).json({ message: suiPayoutResult.error || 'Failed to send SUI payout' });
          }
          suiTxHash = suiPayoutResult.txHash || null;
          actualSuiPaid = claimSui;
        }

        if (claimSbets >= MIN_CLAIM_SBETS) {
          try {
            const platformInfo = await blockchainBetService.getPlatformInfo();
            const accruedSbets = platformInfo?.accruedFeesSbets || 0;
            if (accruedSbets >= claimSbets) {
              console.log(`[LP Revenue] Withdrawing ${claimSbets.toFixed(2)} SBETS from contract fees (available: ${accruedSbets.toFixed(2)})`);
              const wr = await blockchainBetService.withdrawFeesSbetsOnChain(claimSbets);
              if (wr.success) { console.log(`[LP Revenue] SBETS fee withdrawal OK: TX ${wr.txHash}`); await new Promise(r => setTimeout(r, 2000)); }
              else { console.warn(`[LP Revenue] SBETS fee withdrawal failed: ${wr.error}`); }
            } else { console.warn(`[LP Revenue] Not enough accrued SBETS fees (${accruedSbets.toFixed(2)} < ${claimSbets.toFixed(2)})`); }
          } catch (e: any) { console.warn(`[LP Revenue] SBETS fee check failed: ${e.message}`); }

          let sbetsPayoutResult;
          if (useRevenueWalletLp) {
            sbetsPayoutResult = await blockchainBetService.sendSbetsFromRevenueWallet(walletAddress, claimSbets);
            if (!sbetsPayoutResult.success && blockchainBetService.isAdminKeyConfigured()) {
              console.warn(`[LP Revenue] Revenue wallet SBETS payout failed (${sbetsPayoutResult.error}), falling back to admin wallet`);
              sbetsPayoutResult = await blockchainBetService.sendSbetsToUser(walletAddress, claimSbets);
            }
          } else {
            sbetsPayoutResult = await blockchainBetService.sendSbetsToUser(walletAddress, claimSbets);
          }
          if (!sbetsPayoutResult.success) {
            if (suiTxHash) {
              const sharePercentage = lpData.sharePercentage;
              await saveRevenueClaim(walletAddress, startOfWeek, lpData.userLiquidity, sharePercentage, actualSuiPaid, 0, suiTxHash, null, 'lp');
              lpClaimRateLimits.set(claimKey, Date.now());
              console.warn(`[LP Revenue] Partial claim saved: SUI paid (${actualSuiPaid}), SBETS failed — recorded SUI-only claim`);
            }
            return res.status(400).json({ message: sbetsPayoutResult.error || 'Failed to send SBETS payout', partialSuccess: !!suiTxHash, suiTxHash });
          }
          sbetsTxHash = sbetsPayoutResult.txHash || null;
          actualSbetsPaid = claimSbets;
        }

        const sharePercentage = lpData.sharePercentage;
        await saveRevenueClaim(walletAddress, startOfWeek, lpData.userLiquidity, sharePercentage, actualSuiPaid, actualSbetsPaid, suiTxHash || 'no_sui', sbetsTxHash, 'lp');

        lpClaimRateLimits.set(claimKey, Date.now());

        console.log(`[LP Revenue] Claim successful: ${walletAddress.slice(0,10)}... received ${actualSuiPaid.toFixed(6)} SUI + ${actualSbetsPaid.toFixed(2)} SBETS`);

        res.json({
          success: true,
          walletAddress,
          claimedSui: actualSuiPaid,
          claimedSbets: actualSbetsPaid,
          suiTxHash,
          sbetsTxHash,
          lpSharePercentage: sharePercentage.toFixed(6),
          timestamp: Date.now()
        });
      } finally {
        activeLpClaimLocks.delete(claimKey);
      }
    } catch (error: any) {
      console.error('Error processing LP claim:', error);
      res.status(500).json({ message: 'Failed to process LP claim' });
    }
  });

  let circulatingSupplyCache: { totalSupply: number; circulatingSupply: number; platformHoldings: number; lastUpdated: number } | null = null;
  const CIRCULATING_CACHE_TTL = 10 * 60 * 1000;

  const PLATFORM_WALLETS = [
    process.env.ADMIN_WALLET_ADDRESS || '',
    '0xfed2649784e5faa4cec0a0de2e7a4e84fd25e4e81d44cdd68dbb91e9bce3fc85',
  ].filter(Boolean);

  async function getCirculatingSupply(): Promise<{ totalSupply: number; circulatingSupply: number; platformHoldings: number }> {
    if (circulatingSupplyCache && (Date.now() - circulatingSupplyCache.lastUpdated) < CIRCULATING_CACHE_TTL) {
      return circulatingSupplyCache;
    }

    const { getSuiClient } = await import('./lib/suiRpcConfig');
    const suiClient = getSuiClient();
    const coinType = SBETS_TOKEN_TYPE;

    let totalSupply = 10_000_000_000;
    try {
      const supplyInfo = await suiClient.getTotalSupply({ coinType });
      totalSupply = parseInt(supplyInfo.value) / 1e9;
    } catch (e) {
      console.log('[Revenue] Using default SBETS supply: 10B');
    }

    let platformHoldings = 0;
    for (const pw of PLATFORM_WALLETS) {
      if (!pw) continue;
      try {
        const pwBalance = await suiClient.getBalance({ owner: pw, coinType });
        platformHoldings += parseInt(pwBalance.totalBalance) / 1e9;
      } catch (e) {}
    }

    const circulatingSupply = Math.max(totalSupply - platformHoldings, 1);
    console.log(`[Revenue] Supply: total=${totalSupply.toLocaleString()} | platform=${platformHoldings.toLocaleString()} | circulating=${circulatingSupply.toLocaleString()}`);

    circulatingSupplyCache = { totalSupply, circulatingSupply, platformHoldings, lastUpdated: Date.now() };
    return circulatingSupplyCache;
  }

  async function getUserSbetsBalance(walletAddress: string): Promise<number> {
    const { getSuiClient } = await import('./lib/suiRpcConfig');
    const suiClient = getSuiClient();
    try {
      const bal = await suiClient.getBalance({ owner: walletAddress, coinType: SBETS_TOKEN_TYPE });
      return parseInt(bal.totalBalance) / 1e9;
    } catch (e) {
      return 0;
    }
  }

  async function fetchSbetsHolders(): Promise<{ totalSupply: number; circulatingSupply: number; holders: Array<{ address: string; balance: number; percentage: number }> }> {
    const supplyData = await getCirculatingSupply();
    return { totalSupply: supplyData.totalSupply, circulatingSupply: supplyData.circulatingSupply, holders: [] };
  }
  
  // Helper function to get weekly revenue history
  async function getWeeklyRevenueHistory(): Promise<Array<{ week: string; revenue: number; revenueSui: number; revenueSbets: number }>> {
    try {
      const settledBets = await getSettledBetsForRevenue();
      const weeklyDataSui: Map<string, number> = new Map();
      const weeklyDataSbets: Map<string, number> = new Map();
      
      for (const bet of settledBets) {
        const betDate = new Date(bet.placedAt || bet.createdAt || 0);
        const weekStart = new Date(betDate);
        const dayOfWeek = betDate.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        weekStart.setDate(betDate.getDate() + mondayOffset);
        weekStart.setHours(0, 0, 0, 0);
        const weekKey = weekStart.toISOString().split('T')[0];
        
        let revenue = 0;
        const stake = bet.betAmount || bet.stake || 0;
        if (bet.status === 'lost') {
          revenue = stake * 0.01;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const profit = (bet.potentialPayout || bet.potentialWin) - stake;
          revenue = profit * 0.01;
        }
        if (bet.currency === 'SUI') {
          weeklyDataSui.set(weekKey, (weeklyDataSui.get(weekKey) || 0) + revenue);
        } else if (bet.currency === 'SBETS') {
          weeklyDataSbets.set(weekKey, (weeklyDataSbets.get(weekKey) || 0) + revenue);
        }
      }
      
      const allWeeks = new Set([...weeklyDataSui.keys(), ...weeklyDataSbets.keys()]);
      return Array.from(allWeeks)
        .map(week => ({
          week,
          revenue: weeklyDataSbets.get(week) || 0,
          revenueSui: weeklyDataSui.get(week) || 0,
          revenueSbets: weeklyDataSbets.get(week) || 0
        }))
        .sort((a, b) => b.week.localeCompare(a.week))
        .slice(0, 8);
    } catch (error) {
      console.error('Error getting revenue history:', error);
      return [];
    }
  }

  // =====================================================
  // SUINS NAME RESOLUTION ROUTES
  // =====================================================

  app.post('/api/suins/resolve', async (req: Request, res: Response) => {
    try {
      const { addresses } = req.body;
      if (!addresses || !Array.isArray(addresses)) {
        return res.json({ names: {} });
      }
      const limited = addresses.slice(0, 50);
      const { batchResolveSuiNSNames } = await import('./services/suinsService');
      const names = await batchResolveSuiNSNames(limited);
      res.json({ names });
    } catch (error) {
      console.error('[SuiNS] Batch resolve error:', error);
      res.json({ names: {} });
    }
  });

  app.get('/api/suins/resolve', async (req: Request, res: Response) => {
    try {
      const address = req.query.address as string;
      if (!address || !address.startsWith('0x')) {
        return res.json({ name: null });
      }
      const { resolveSuiNSName } = await import('./services/suinsService');
      const name = await resolveSuiNSName(address);
      res.json({ name });
    } catch (error) {
      console.error('[SuiNS] Resolve error:', error);
      res.json({ name: null });
    }
  });

  // =====================================================
  // LEADERBOARD ROUTES
  // =====================================================
  
  app.get('/api/leaderboard', async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as string) || 'weekly';
      const allBets = await storage.getAllBets();
      
      // Calculate date range
      const now = new Date();
      let startDate: Date;
      if (period === 'weekly') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === 'monthly') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        startDate = new Date(0);
      }
      
      // Track SUI and SBETS profits separately per wallet
      const walletStats: Record<string, { 
        suiProfit: number; 
        sbetsProfit: number; 
        suiBets: number;
        sbetsBets: number;
        suiWins: number;
        sbetsWins: number;
        totalBets: number; 
        wins: number;
      }> = {};
      
      for (const bet of allBets) {
        if (!bet.walletAddress && !bet.userId) continue;
        const wallet = bet.walletAddress || String(bet.userId);
        const betDate = new Date(bet.placedAt || bet.createdAt || 0);
        if (betDate < startDate) continue;
        
        if (!walletStats[wallet]) {
          walletStats[wallet] = { 
            suiProfit: 0, sbetsProfit: 0, 
            suiBets: 0, sbetsBets: 0,
            suiWins: 0, sbetsWins: 0,
            totalBets: 0, wins: 0 
          };
        }
        
        const currency = (bet.currency || 'SUI').toUpperCase();
        const isSbets = currency === 'SBETS';
        
        walletStats[wallet].totalBets++;
        if (isSbets) {
          walletStats[wallet].sbetsBets++;
        } else {
          walletStats[wallet].suiBets++;
        }
        
        if (bet.status === 'won' || bet.status === 'paid_out') {
          const payout = bet.payout || bet.potentialWin || 0;
          const profit = payout - (bet.betAmount || 0);
          walletStats[wallet].wins++;
          
          if (isSbets) {
            walletStats[wallet].sbetsProfit += profit;
            walletStats[wallet].sbetsWins++;
          } else {
            walletStats[wallet].suiProfit += profit;
            walletStats[wallet].suiWins++;
          }
        } else if (bet.status === 'lost') {
          if (isSbets) {
            walletStats[wallet].sbetsProfit -= bet.betAmount || 0;
          } else {
            walletStats[wallet].suiProfit -= bet.betAmount || 0;
          }
        }
      }
      
      // Convert SUI and SBETS to USD equivalent for ranking (SUI = $3.50, SBETS = $0.000001)
      const SUI_USD = 3.50;
      const SBETS_USD = 0.000001;
      
      // Convert to array and sort by total USD value profit
      const leaderboardBase = Object.entries(walletStats)
        .filter(([_, stats]) => stats.totalBets >= 1)
        .map(([wallet, stats]) => {
          const totalProfitUsd = (stats.suiProfit * SUI_USD) + (stats.sbetsProfit * SBETS_USD);
          return {
            rank: 0,
            wallet,
            suiProfit: stats.suiProfit,
            sbetsProfit: stats.sbetsProfit,
            totalProfitUsd,
            totalBets: stats.totalBets,
            suiBets: stats.suiBets,
            sbetsBets: stats.sbetsBets,
            winRate: stats.totalBets > 0 ? (stats.wins / stats.totalBets) * 100 : 0
          };
        })
        .sort((a, b) => b.totalProfitUsd - a.totalProfitUsd)
        .slice(0, 50)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      
      // Add loyalty points to leaderboard entries
      const leaderboard = await Promise.all(leaderboardBase.map(async (entry) => {
        try {
          const user = await storage.getUserByWalletAddress(entry.wallet);
          const pts = user?.loyaltyPoints || 0;
          return {
            ...entry,
            loyaltyPoints: pts,
            loyaltyTier: getLoyaltyTier(pts)
          };
        } catch {
          return { ...entry, loyaltyPoints: 0, loyaltyTier: 'Bronze' };
        }
      }));
      
      res.json({ leaderboard });
    } catch (error) {
      console.error('Leaderboard error:', error);
      res.status(500).json({ error: 'Failed to get leaderboard' });
    }
  });

  // =====================================================
  // USER LIMITS ROUTES
  // =====================================================
  
  app.get('/api/user/limits', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const { userLimits } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const [limits] = await db.select().from(userLimits).where(eq(userLimits.walletAddress, wallet));
      
      if (!limits) {
        return res.json({ limits: {
          dailyLimit: null,
          weeklyLimit: null,
          monthlyLimit: null,
          dailySpent: 0,
          weeklySpent: 0,
          monthlySpent: 0,
          sessionReminderMinutes: 60,
          selfExclusionUntil: null
        }});
      }
      
      res.json({ limits });
    } catch (error) {
      console.error('Get limits error:', error);
      res.status(500).json({ error: 'Failed to get limits' });
    }
  });
  
  app.post('/api/user/limits', async (req: Request, res: Response) => {
    try {
      const { wallet, dailyLimit, weeklyLimit, monthlyLimit, sessionReminderMinutes } = req.body;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const { userLimits } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const [existing] = await db.select().from(userLimits).where(eq(userLimits.walletAddress, wallet));
      
      if (existing) {
        await db.update(userLimits)
          .set({
            dailyLimit,
            weeklyLimit,
            monthlyLimit,
            sessionReminderMinutes: sessionReminderMinutes || 60,
            updatedAt: new Date()
          })
          .where(eq(userLimits.walletAddress, wallet));
      } else {
        await db.insert(userLimits).values({
          walletAddress: wallet,
          dailyLimit,
          weeklyLimit,
          monthlyLimit,
          sessionReminderMinutes: sessionReminderMinutes || 60
        });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Set limits error:', error);
      res.status(500).json({ error: 'Failed to set limits' });
    }
  });

  // =====================================================
  // REFERRAL ROUTES
  // =====================================================
  
  // In-memory referral code mapping (code -> wallet)
  const referralCodeMap: Record<string, string> = {};
  
  app.get('/api/referral/code', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !/^0x[a-fA-F0-9]{64}$/.test(wallet)) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      
      const code = wallet.slice(2, 10).toUpperCase();
      referralCodeMap[code] = wallet;
      
      const { referrals } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const userReferrals = await db.select().from(referrals).where(eq(referrals.referrerWallet, wallet));
      const totalReferrals = userReferrals.length;
      const qualifiedReferrals = userReferrals.filter((r: any) => r.status === 'qualified' || r.status === 'rewarded').length;
      const pendingReferrals = userReferrals.filter((r: any) => r.status === 'pending').length;
      const totalEarned = userReferrals.reduce((sum: number, r: any) => sum + (r.rewardAmount || 0), 0);
      
      res.json({ 
        code, 
        link: `https://www.suibets.com/?ref=${code}`,
        totalReferrals,
        qualifiedReferrals,
        pendingReferrals,
        totalEarned
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate referral code' });
    }
  });
  
  app.get('/api/referral/stats', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !/^0x[a-fA-F0-9]{64}$/.test(wallet)) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      
      const { referrals } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const userReferrals = await db.select().from(referrals).where(eq(referrals.referrerWallet, wallet));
      
      const totalReferrals = userReferrals.length;
      const qualifiedReferrals = userReferrals.filter((r: any) => r.status === 'qualified' || r.status === 'rewarded').length;
      const pendingReferrals = userReferrals.filter((r: any) => r.status === 'pending').length;
      const totalEarned = userReferrals.reduce((sum: number, r: any) => sum + (r.rewardAmount || 0), 0);
      
      // $10 bonus for every 100 invites
      const bonusesEarned = Math.floor(totalReferrals / 100);
      const progressToNext = totalReferrals % 100;
      
      res.json({
        totalReferrals,
        qualifiedReferrals,
        pendingReferrals,
        totalEarned,
        bonusesEarned,
        bonusAmount: bonusesEarned * 10,
        progressToNext,
        nextBonusAt: 100 - progressToNext
      });
    } catch (error) {
      console.error('Referral stats error:', error);
      res.status(500).json({ error: 'Failed to get referral stats' });
    }
  });
  
  const referralTrackRateLimits = new Map<string, number>();
  
  app.post('/api/referral/track', async (req: Request, res: Response) => {
    try {
      const { referralCode, referredWallet } = req.body;
      if (!referralCode || !referredWallet) {
        return res.status(400).json({ error: 'Referral code and wallet required' });
      }
      
      if (!/^0x[a-fA-F0-9]{64}$/.test(referredWallet)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }
      
      if (isWalletBlocked(referredWallet)) {
        return res.status(403).json({ error: 'Wallet is blocked' });
      }
      
      if (typeof referralCode !== 'string' || referralCode.length > 20 || !/^[A-Za-z0-9]+$/.test(referralCode)) {
        return res.status(400).json({ error: 'Invalid referral code format' });
      }
      
      const refKey = referredWallet.toLowerCase();
      const lastRef = referralTrackRateLimits.get(refKey);
      if (lastRef && Date.now() - lastRef < 30000) {
        return res.status(429).json({ error: 'Please wait before trying again' });
      }
      referralTrackRateLimits.set(refKey, Date.now());
      
      try {
        const refBal = await blockchainBetService.getWalletBalance(referredWallet);
        if (refBal.sui < 0.01) {
          return res.status(400).json({ error: 'Referred wallet must have at least 0.01 SUI to verify authenticity' });
        }
      } catch (balErr) {
        console.error('[REFERRAL] Balance check failed, denying referral (fail-closed):', balErr);
        return res.status(503).json({ error: 'Unable to verify wallet. Please try again.' });
      }
      
      const { referrals, users } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq, like } = await import('drizzle-orm');
      
      const code = referralCode.toUpperCase();
      
      let referrerWallet = referralCodeMap[code];
      
      if (!referrerWallet) {
        const [existingRef] = await db.select().from(referrals)
          .where(eq(referrals.referralCode, code));
        if (existingRef) {
          referrerWallet = existingRef.referrerWallet;
        }
      }
      
      if (!referrerWallet) {
        // Use SQL LIKE to find wallet matching the code prefix instead of scanning all users
        const matchingUsers = await db.select({ walletAddress: users.walletAddress })
          .from(users)
          .where(like(users.walletAddress, `0x${code.toLowerCase()}%`))
          .limit(1);
        if (matchingUsers.length > 0 && matchingUsers[0].walletAddress) {
          referrerWallet = matchingUsers[0].walletAddress;
          referralCodeMap[code] = referrerWallet;
          console.log(`[REFERRAL] Resolved code ${code} to wallet ${referrerWallet.slice(0, 10)}... via users table`);
        }
      }
      
      if (!referrerWallet) {
        console.warn(`[REFERRAL] Could not resolve referral code: ${code}`);
        return res.status(400).json({ error: 'Invalid referral code' });
      }
      
      if (referrerWallet.toLowerCase() === referredWallet.toLowerCase()) {
        return res.json({ success: false, message: 'Cannot refer yourself' });
      }
      
      const [existing] = await db.select().from(referrals)
        .where(eq(referrals.referredWallet, referredWallet));
      
      if (existing) {
        return res.json({ success: false, message: 'Already referred' });
      }
      
      await db.insert(referrals).values({
        referrerWallet,
        referredWallet,
        referralCode: code,
        status: 'pending'
      });
      
      console.log(`[REFERRAL] ✅ Tracked: ${referredWallet.slice(0, 10)}... referred by ${referrerWallet.slice(0, 10)}... (code: ${code})`);
      res.json({ success: true });
    } catch (error) {
      console.error('Track referral error:', error);
      res.status(500).json({ error: 'Failed to track referral' });
    }
  });

  // ==================== FREE BET SYSTEM ====================
  
  // Get free bet status for a wallet
  app.get('/api/free-bet/status', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !/^0x[a-fA-F0-9]{64}$/.test(wallet)) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      
      let user;
      try {
        user = await storage.getUserByWalletAddress(wallet);
      } catch (dbError: any) {
        console.error('Free bet status DB error:', dbError.message);
        return res.status(503).json({ error: 'Unable to check free bet status. Try again.' });
      }
      
      if (!user) {
        return res.json({ 
          freeBetBalance: 0, 
          welcomeBonusClaimed: false,
          welcomeBonusAmount: 1000, // 1000 SBETS welcome bonus
          welcomeBonusCurrency: 'SBETS',
          loyaltyPoints: 0
        });
      }
      
      const freeBetUsed = user.welcomeBonusClaimed || false;

      res.json({
        freeBetBalance: freeBetUsed ? 0 : (user.freeBetBalance || 0),
        freeBetUsed,
        welcomeBonusClaimed: user.welcomeBonusClaimed || false,
        welcomeBonusAmount: 1000,
        welcomeBonusCurrency: 'SBETS',
        loyaltyPoints: user.loyaltyPoints || 0
      });
    } catch (error) {
      console.error('Free bet status error:', error);
      res.json({ 
        freeBetBalance: 0, 
        freeBetUsed: false,
        welcomeBonusClaimed: false,
        welcomeBonusAmount: 1000,
        welcomeBonusCurrency: 'SBETS',
        loyaltyPoints: 0
      });
    }
  });
  
  // Claim welcome bonus (1000 SBETS - one time only per wallet)
  const welcomeBonusRateLimits = new Map<string, number>();
  
  app.post('/api/free-bet/claim-welcome', async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      if (!/^0x[a-fA-F0-9]{64}$/.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }
      
      if (isWalletBlocked(walletAddress)) {
        return res.status(403).json({ error: 'Wallet is blocked' });
      }
      
      const claimKey = walletAddress.toLowerCase();
      const lastAttempt = welcomeBonusRateLimits.get(claimKey);
      if (lastAttempt && Date.now() - lastAttempt < 60000) {
        return res.status(429).json({ error: 'Please wait before trying again' });
      }
      welcomeBonusRateLimits.set(claimKey, Date.now());
      
      try {
        const walletBal = await blockchainBetService.getWalletBalance(walletAddress);
        if (walletBal.sui < 0.01) {
          return res.status(400).json({ error: 'Your wallet needs at least 0.01 SUI to claim the welcome bonus. This prevents bot abuse.' });
        }
      } catch (balErr) {
        console.error('[FREE BET] Balance check failed, denying claim (fail-closed):', balErr);
        return res.status(503).json({ error: 'Unable to verify wallet. Please try again.' });
      }
      
      const { users } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq, sql, and } = await import('drizzle-orm');
      
      const WELCOME_BONUS_SBETS = 1000;
      
      try {
        // Atomic: only update if welcomeBonusClaimed is false — prevents race condition
        const result = await db.update(users)
          .set({ 
            freeBetBalance: sql`COALESCE(free_bet_balance, 0) + ${WELCOME_BONUS_SBETS}`,
            welcomeBonusClaimed: true
          })
          .where(and(
            eq(users.walletAddress, walletAddress),
            eq(users.welcomeBonusClaimed, false)
          ))
          .returning({ freeBetBalance: users.freeBetBalance });
        
        if (result.length === 0) {
          // Either user doesn't exist or already claimed
          const [user] = await db.select().from(users).where(eq(users.walletAddress, walletAddress));
          if (!user) {
            return res.status(404).json({ error: 'User not found. Please connect wallet first.' });
          }
          return res.status(400).json({ error: 'Welcome bonus already claimed. Each wallet can only claim once.' });
        }
        
        console.log(`[FREE BET] Welcome bonus claimed: ${walletAddress.slice(0, 10)}... received ${WELCOME_BONUS_SBETS} SBETS (one-time)`);
        
        res.json({ 
          success: true, 
          freeBetBalance: result[0].freeBetBalance,
          message: `Congratulations! You received ${WELCOME_BONUS_SBETS} SBETS welcome bonus!`
        });
      } catch (dbError: any) {
        console.warn('[FREE BET] DB schema issue, trying raw SQL fallback:', dbError.message);
        
        try {
          await db.execute(sql`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS free_bet_balance REAL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS welcome_bonus_claimed BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS loyalty_points REAL DEFAULT 0
          `);
          
          // Atomic claim with raw SQL
          const claimResult = await db.execute(sql`
            UPDATE users 
            SET free_bet_balance = COALESCE(free_bet_balance, 0) + ${WELCOME_BONUS_SBETS},
                welcome_bonus_claimed = TRUE
            WHERE wallet_address = ${walletAddress} AND (welcome_bonus_claimed = FALSE OR welcome_bonus_claimed IS NULL)
            RETURNING free_bet_balance
          `);
          
          if (!claimResult || (claimResult as any).length === 0) {
            const [user] = await db.select().from(users).where(eq(users.walletAddress, walletAddress));
            if (!user) {
              return res.status(404).json({ error: 'User not found. Please connect wallet first.' });
            }
            return res.status(400).json({ error: 'Welcome bonus already claimed.' });
          }
          
          await db.update(users)
            .set({ 
              freeBetBalance: (user.freeBetBalance || 0) + WELCOME_BONUS_SBETS,
              welcomeBonusClaimed: true
            })
            .where(eq(users.walletAddress, walletAddress));
          
          console.log(`[FREE BET] Welcome bonus claimed (after schema fix): ${walletAddress.slice(0, 10)}...`);
          
          res.json({ 
            success: true, 
            freeBetBalance: WELCOME_BONUS_SBETS,
            message: `Congratulations! You received ${WELCOME_BONUS_SBETS} SBETS welcome bonus!`
          });
        } catch (sqlError: any) {
          console.error('[FREE BET] Raw SQL fallback failed:', sqlError.message);
          return res.status(500).json({ error: 'Database schema issue. Please contact support.' });
        }
      }
    } catch (error) {
      console.error('Claim welcome bonus error:', error);
      res.status(500).json({ error: 'Failed to claim welcome bonus' });
    }
  });

  // ==================== LOYALTY PROGRAM ====================
  
  // Get loyalty status
  app.get('/api/loyalty/status', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !/^0x[a-fA-F0-9]{64}$/.test(wallet)) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      
      const user = await storage.getUserByWalletAddress(wallet);
      const points = user?.loyaltyPoints || 0;
      const totalVolume = user?.totalBetVolume || 0;
      
      // Loyalty tiers based on points
      let tier = 'Bronze';
      let nextTier = 'Silver';
      let pointsToNext = 1000 - points;
      
      if (points >= 10000) {
        tier = 'Diamond';
        nextTier = 'Diamond';
        pointsToNext = 0;
      } else if (points >= 5000) {
        tier = 'Platinum';
        nextTier = 'Diamond';
        pointsToNext = 10000 - points;
      } else if (points >= 2500) {
        tier = 'Gold';
        nextTier = 'Platinum';
        pointsToNext = 5000 - points;
      } else if (points >= 1000) {
        tier = 'Silver';
        nextTier = 'Gold';
        pointsToNext = 2500 - points;
      }
      
      res.json({
        points,
        tier,
        nextTier,
        pointsToNext: Math.max(0, pointsToNext),
        totalVolume,
        perks: getLoyaltyPerks(tier)
      });
    } catch (error) {
      console.error('Loyalty status error:', error);
      res.status(500).json({ error: 'Failed to get loyalty status' });
    }
  });
  
  function getLoyaltyPerks(tier: string): string[] {
    const perks: Record<string, string[]> = {
      'Bronze': ['1 point per $1 wagered', 'Access to promotions'],
      'Silver': ['1.25x points multiplier', 'Priority support', 'Weekly bonuses'],
      'Gold': ['1.5x points multiplier', 'Exclusive promotions', 'Monthly free bets'],
      'Platinum': ['2x points multiplier', 'VIP support', 'Higher betting limits'],
      'Diamond': ['3x points multiplier', 'Personal account manager', 'Exclusive events']
    };
    return perks[tier] || perks['Bronze'];
  }
  
  function getLoyaltyTier(points: number): string {
    if (points >= 10000) return 'Diamond';
    if (points >= 5000) return 'Platinum';
    if (points >= 2500) return 'Gold';
    if (points >= 1000) return 'Silver';
    return 'Bronze';
  }

  // ==================== REFERRAL REWARD (1000 SBETS) ====================
  
  // Award referral bonus (called when referred user places first bet)
  app.post('/api/referral/award', async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { referredWallet } = req.body;
      if (!referredWallet || !isValidSuiWallet(referredWallet)) {
        return res.status(400).json({ error: 'Valid Sui wallet address required' });
      }
      
      const { referrals } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq, and } = await import('drizzle-orm');
      
      const REFERRAL_REWARD_SBETS = 1000;
      
      // Step 1: Find pending referral WITHOUT updating status yet
      const [pendingReferral] = await db.select()
        .from(referrals)
        .where(and(
          eq(referrals.referredWallet, referredWallet),
          eq(referrals.status, 'pending')
        ));
      
      if (!pendingReferral) {
        const [existing] = await db.select().from(referrals)
          .where(eq(referrals.referredWallet, referredWallet));
        if (!existing) return res.json({ success: false, message: 'No referral found' });
        return res.json({ success: false, message: 'Referral already rewarded' });
      }
      
      // Step 2: Run all eligibility checks BEFORE any state mutation
      if (isWalletBlocked(pendingReferral.referrerWallet)) {
        return res.json({ success: false, message: 'Referrer wallet is blocked' });
      }
      
      try {
        const referrerBal = await blockchainBetService.getWalletBalance(pendingReferral.referrerWallet);
        if (referrerBal.sui < 0.01) {
          console.log(`❌ Referral reward rejected: referrer ${pendingReferral.referrerWallet.slice(0,10)}... has ${referrerBal.sui} SUI (below 0.01 minimum)`);
          return res.json({ success: false, message: 'Referrer wallet does not meet minimum balance requirement' });
        }
      } catch (balErr) {
        console.error('[REFERRAL] FAIL-CLOSED: Cannot verify referrer balance:', balErr);
        return res.status(503).json({ error: 'Unable to verify referrer wallet. Please try again.' });
      }
      
      // Step 3: Atomically update status ONLY after all checks pass (prevents double-credit)
      const updated = await db.update(referrals)
        .set({ 
          status: 'rewarded',
          rewardAmount: REFERRAL_REWARD_SBETS,
          rewardCurrency: 'SBETS',
          rewardedAt: new Date()
        })
        .where(and(
          eq(referrals.referredWallet, referredWallet),
          eq(referrals.status, 'pending')
        ))
        .returning({ referrerWallet: referrals.referrerWallet });
      
      if (updated.length === 0) {
        return res.json({ success: false, message: 'Referral already rewarded (concurrent request)' });
      }
      
      // Step 4: Credit balance after successful status update
      await storage.updateUserBalance(pendingReferral.referrerWallet, 0, REFERRAL_REWARD_SBETS);
      
      console.log(`[REFERRAL] ✅ Awarded ${REFERRAL_REWARD_SBETS} SBETS to referrer ${pendingReferral.referrerWallet.slice(0, 10)}... - ADDED to balance`);
      
      res.json({ 
        success: true, 
        rewardAmount: REFERRAL_REWARD_SBETS,
        rewardCurrency: 'SBETS',
        referrerWallet: pendingReferral.referrerWallet
      });
    } catch (error) {
      console.error('Award referral error:', error);
      res.status(500).json({ error: 'Failed to award referral bonus' });
    }
  });

  // ============================================
  // Social / Network Effect Engine API Routes
  // ============================================

  app.get("/api/social/predictions", async (req: Request, res: Response) => {
    try {
      const { socialPredictions } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      const category = req.query.category as string;
      let query = db.select().from(socialPredictions).orderBy(desc(socialPredictions.createdAt)).limit(50);
      const predictions = await query;
      const filtered = category && category !== 'all' 
        ? predictions.filter(p => p.category === category)
        : predictions;
      res.json(filtered);
    } catch (error) {
      console.error('Social predictions fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch predictions' });
    }
  });

  app.post("/api/social/predictions", async (req: Request, res: Response) => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq, sql } = await import('drizzle-orm');
      const { title, description, category, endDate, wallet, initialAmount, initialSide, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 200) {
        return res.status(400).json({ error: 'Title must be 5-200 characters' });
      }
      if (!endDate) {
        return res.status(400).json({ error: 'End date required' });
      }
      const end = new Date(endDate);
      if (isNaN(end.getTime()) || end <= new Date()) {
        return res.status(400).json({ error: 'End date must be in the future' });
      }
      const maxEnd = new Date();
      maxEnd.setDate(maxEnd.getDate() + 90);
      if (end > maxEnd) {
        return res.status(400).json({ error: 'End date cannot be more than 90 days from now' });
      }
      const VALID_CATEGORIES = ['crypto', 'sports', 'politics', 'entertainment', 'gaming', 'tech', 'other'];
      const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'other';
      const safeTitle = title.trim().slice(0, 200);
      const safeDescription = (description || '').trim().slice(0, 1000);
      const walletLower = wallet.toLowerCase();

      const parsedInitial = initialAmount ? parseFloat(initialAmount) : 0;
      const validSide = initialSide === 'no' ? 'no' : 'yes';

      if (parsedInitial > 0) {
        if (parsedInitial < 100) return res.status(400).json({ error: 'Minimum initial bet is 100 SBETS' });
        if (parsedInitial > 1000000) return res.status(400).json({ error: 'Maximum initial bet is 1,000,000 SBETS' });
        if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
          return res.status(400).json({ error: 'On-chain transaction hash required for initial bet' });
        }
        const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, parsedInitial);
        if (!verification.verified) {
          return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
        }
        const claimed = await claimTxHash(txHash, 'create_prediction', walletLower);
        if (!claimed) {
          return res.status(400).json({ error: 'Transaction already used' });
        }
      }

      const [prediction] = await db.insert(socialPredictions).values({
        creatorWallet: walletLower,
        title: safeTitle,
        description: safeDescription,
        category: safeCategory,
        endDate: end,
        status: 'active',
        totalYesAmount: 0,
        totalNoAmount: 0,
        totalParticipants: 0
      }).returning();

      if (parsedInitial > 0) {
        try {
          await db.insert(socialPredictionBets).values({
            predictionId: prediction.id,
            wallet: walletLower,
            side: validSide,
            amount: parsedInitial,
            currency: 'SBETS',
            txId: txHash
          });
          const yesIncrement = validSide === 'yes' ? parsedInitial : 0;
          const noIncrement = validSide === 'no' ? parsedInitial : 0;
          await db.update(socialPredictions)
            .set({
              totalYesAmount: sql`COALESCE(${socialPredictions.totalYesAmount}, 0) + ${yesIncrement}`,
              totalNoAmount: sql`COALESCE(${socialPredictions.totalNoAmount}, 0) + ${noIncrement}`,
              totalParticipants: sql`COALESCE(${socialPredictions.totalParticipants}, 0) + 1`
            })
            .where(eq(socialPredictions.id, prediction.id));
          console.log(`[Social] Prediction created WITH initial bet: #${prediction.id} "${safeTitle}" by ${walletLower.slice(0,10)}... | ${parsedInitial} SBETS on ${validSide.toUpperCase()} | TX: ${txHash} | VERIFIED`);
        } catch (betErr: any) {
          console.error(`[Social] Initial bet insert failed for prediction #${prediction.id}:`, betErr.message);
        }
      } else {
        console.log(`[Social] Prediction created: #${prediction.id} "${safeTitle}" by ${walletLower.slice(0,10)}... | Ends: ${end.toISOString()}`);
      }

      const [finalPrediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, prediction.id));
      res.json(finalPrediction || prediction);
    } catch (error) {
      console.error('Create prediction error:', error);
      res.status(500).json({ error: 'Failed to create prediction' });
    }
  });

  app.get("/api/social/treasury-wallet", async (_req: Request, res: Response) => {
    res.json({ wallet: blockchainBetService.getAdminWallet() });
  });

  const socialBetRateLimits = new Map<string, { count: number; resetAt: number }>();
  const SOCIAL_BET_LIMIT = 20;
  const SOCIAL_BET_WINDOW = 60 * 60 * 1000;
  async function claimTxHash(txHash: string, purpose: string, wallet?: string): Promise<boolean> {
    const { usedTxHashes: usedTxHashesTable } = await import('@shared/schema');
    try {
      const result = await db.insert(usedTxHashesTable).values({ txHash, purpose, wallet }).onConflictDoNothing().returning();
      return result.length > 0;
    } catch (e) {
      return false;
    }
  }

  app.post("/api/social/predictions/:id/bet", async (req: Request, res: Response) => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq, sql } = await import('drizzle-orm');
      const predictionId = parseInt(req.params.id);
      if (isNaN(predictionId) || predictionId <= 0) {
        return res.status(400).json({ error: 'Invalid prediction ID' });
      }
      const { wallet, side, amount, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!side || !['yes', 'no'].includes(side)) {
        return res.status(400).json({ error: 'Side must be "yes" or "no"' });
      }
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount < 100 || parsedAmount > 10000) {
        return res.status(400).json({ error: 'Amount must be between 100 and 10,000 SBETS' });
      }
      const VALID_AMOUNTS = [100, 500, 1000, 5000, 10000];
      if (!VALID_AMOUNTS.includes(parsedAmount)) {
        return res.status(400).json({ error: 'Amount must be 100, 500, 1000, 5000, or 10000 SBETS' });
      }
      if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
        return res.status(400).json({ error: 'On-chain transaction hash required. Send SBETS to treasury first.' });
      }
      const walletLower = wallet.toLowerCase();
      const now = Date.now();
      const rateKey = walletLower;
      const rateData = socialBetRateLimits.get(rateKey);
      if (rateData && rateData.resetAt > now) {
        if (rateData.count >= SOCIAL_BET_LIMIT) {
          return res.status(429).json({ error: `Rate limit: max ${SOCIAL_BET_LIMIT} prediction bets per hour` });
        }
        rateData.count++;
      } else {
        socialBetRateLimits.set(rateKey, { count: 1, resetAt: now + SOCIAL_BET_WINDOW });
      }
      const [prediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, predictionId));
      if (!prediction) {
        return res.status(404).json({ error: 'Prediction not found' });
      }
      if (prediction.status !== 'active') {
        return res.status(400).json({ error: 'Prediction is no longer active' });
      }
      if (prediction.endDate && new Date(prediction.endDate) < new Date()) {
        return res.status(400).json({ error: 'Prediction has expired - betting is closed' });
      }
      if (walletLower === prediction.creatorWallet?.toLowerCase()) {
        return res.status(403).json({ error: 'Creator cannot bet on their own prediction' });
      }
      const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, parsedAmount);
      if (!verification.verified) {
        console.error(`[Social] On-chain verification FAILED for bet: ${verification.error} | TX: ${txHash} | Wallet: ${walletLower.slice(0,10)}...`);
        return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
      }
      const claimed = await claimTxHash(txHash, 'prediction_bet', walletLower);
      if (!claimed) {
        return res.status(400).json({ error: 'Transaction already used for a bet - each bet requires a new transaction' });
      }
      const [bet] = await db.insert(socialPredictionBets).values({
        predictionId,
        wallet: walletLower,
        side,
        amount: parsedAmount,
        currency: 'SBETS',
        txId: txHash
      }).returning();
      const yesInc = side === 'yes' ? parsedAmount : 0;
      const noInc = side === 'no' ? parsedAmount : 0;
      await db.update(socialPredictions)
        .set({
          totalYesAmount: sql`COALESCE(${socialPredictions.totalYesAmount}, 0) + ${yesInc}`,
          totalNoAmount: sql`COALESCE(${socialPredictions.totalNoAmount}, 0) + ${noInc}`,
          totalParticipants: sql`COALESCE(${socialPredictions.totalParticipants}, 0) + 1`
        })
        .where(eq(socialPredictions.id, predictionId));
      console.log(`[Social] ON-CHAIN prediction bet: ${walletLower.slice(0,10)}... | ${side.toUpperCase()} ${parsedAmount} SBETS on #${predictionId} | TX: ${txHash} | VERIFIED`);
      res.json({ success: true, txId: txHash, betId: bet.id, verified: true });
    } catch (error) {
      console.error('Prediction bet error:', error);
      res.status(500).json({ error: 'Failed to place prediction bet' });
    }
  });

  app.get("/api/social/challenges", async (req: Request, res: Response) => {
    try {
      const { socialChallenges } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      const challenges = await db.select().from(socialChallenges).orderBy(desc(socialChallenges.createdAt)).limit(50);
      res.json(challenges);
    } catch (error) {
      console.error('Social challenges fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch challenges' });
    }
  });

  app.post("/api/social/challenges", async (req: Request, res: Response) => {
    try {
      const { socialChallenges } = await import('@shared/schema');
      const { title, description, stakeAmount, maxParticipants, expiresAt, wallet, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 200) {
        return res.status(400).json({ error: 'Title must be 5-200 characters' });
      }
      const parsedStake = parseFloat(stakeAmount);
      if (isNaN(parsedStake) || parsedStake < 100 || parsedStake > 10000) {
        return res.status(400).json({ error: 'Stake must be between 100 and 10,000 SBETS' });
      }
      if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
        return res.status(400).json({ error: 'On-chain transaction hash required. Send SBETS stake to treasury first.' });
      }
      if (!expiresAt) {
        return res.status(400).json({ error: 'Expiry date required' });
      }
      const expiry = new Date(expiresAt);
      if (isNaN(expiry.getTime()) || expiry <= new Date()) {
        return res.status(400).json({ error: 'Expiry must be in the future' });
      }
      const maxExpiry = new Date();
      maxExpiry.setDate(maxExpiry.getDate() + 30);
      if (expiry > maxExpiry) {
        return res.status(400).json({ error: 'Expiry cannot be more than 30 days from now' });
      }
      const walletLower = wallet.toLowerCase();
      const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, parsedStake);
      if (!verification.verified) {
        console.error(`[Social] Challenge creation verification FAILED: ${verification.error} | TX: ${txHash}`);
        return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
      }
      const claimed = await claimTxHash(txHash, 'create_challenge', walletLower);
      if (!claimed) {
        return res.status(400).json({ error: 'Transaction already used - each challenge requires a new transaction' });
      }
      const safeParts = Math.min(Math.max(parseInt(maxParticipants) || 10, 2), 100);
      const [challenge] = await db.insert(socialChallenges).values({
        creatorWallet: walletLower,
        title: title.trim().slice(0, 200),
        description: (description || '').trim().slice(0, 1000),
        stakeAmount: parsedStake,
        currency: 'SBETS',
        maxParticipants: safeParts,
        currentParticipants: 1,
        status: 'open',
        expiresAt: expiry
      }).returning();
      console.log(`[Social] ON-CHAIN challenge created: #${challenge.id} "${title.trim().slice(0,50)}" by ${walletLower.slice(0,10)}... | Stake: ${parsedStake} SBETS | TX: ${txHash} | VERIFIED`);
      res.json(challenge);
    } catch (error: any) {
      console.error('Create challenge error:', error?.message || error);
      const isBlockchainError = error?.message?.includes('verify') || error?.message?.includes('Sui');
      res.status(500).json({ error: isBlockchainError 
        ? 'Blockchain verification failed - please try again' 
        : 'Failed to create challenge' });
    }
  });

  app.post("/api/social/challenges/:id/join", async (req: Request, res: Response) => {
    try {
      const { socialChallenges, socialChallengeParticipants } = await import('@shared/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      const challengeId = parseInt(req.params.id);
      if (isNaN(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: 'Invalid challenge ID' });
      }
      const { wallet, side, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (side && !['for', 'against'].includes(side)) {
        return res.status(400).json({ error: 'Side must be "for" or "against"' });
      }
      const walletLower = wallet.toLowerCase();
      const [challenge] = await db.select().from(socialChallenges).where(eq(socialChallenges.id, challengeId));
      if (!challenge || challenge.status !== 'open') {
        return res.status(400).json({ error: 'Challenge not found or not open' });
      }
      if (walletLower === challenge.creatorWallet?.toLowerCase()) {
        return res.status(400).json({ error: 'Cannot join your own challenge' });
      }
      if ((challenge.currentParticipants || 0) >= (challenge.maxParticipants || 10)) {
        return res.status(400).json({ error: 'Challenge is full' });
      }
      if (challenge.expiresAt && new Date(challenge.expiresAt) < new Date()) {
        return res.status(400).json({ error: 'Challenge has expired' });
      }
      const existingParticipant = await db.select().from(socialChallengeParticipants).where(
        and(
          eq(socialChallengeParticipants.challengeId, challengeId),
          eq(socialChallengeParticipants.wallet, walletLower)
        )
      );
      if (existingParticipant.length > 0) {
        return res.status(400).json({ error: 'You have already joined this challenge' });
      }
      if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
        return res.status(400).json({ error: 'On-chain transaction hash required. Send SBETS stake to treasury first.' });
      }
      const stakeAmount = challenge.stakeAmount || 0;
      if (stakeAmount <= 0) {
        return res.status(400).json({ error: 'Challenge has invalid stake amount' });
      }
      const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, stakeAmount);
      if (!verification.verified) {
        console.error(`[Social] Challenge join verification FAILED: ${verification.error} | TX: ${txHash}`);
        return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
      }
      const claimed = await claimTxHash(txHash, 'join_challenge', walletLower);
      if (!claimed) {
        return res.status(400).json({ error: 'Transaction already used - each join requires a new transaction' });
      }
      await db.insert(socialChallengeParticipants).values({
        challengeId,
        wallet: walletLower,
        side: side || 'against',
        txHash
      });
      await db.update(socialChallenges)
        .set({ currentParticipants: sql`COALESCE(${socialChallenges.currentParticipants}, 0) + 1` })
        .where(eq(socialChallenges.id, challengeId));
      console.log(`[Social] ON-CHAIN challenge join: ${walletLower.slice(0,10)}... joined #${challengeId} | Stake: ${stakeAmount} SBETS | TX: ${txHash} | VERIFIED`);
      res.json({ success: true, verified: true });
    } catch (error) {
      console.error('Join challenge error:', error);
      res.status(500).json({ error: 'Failed to join challenge' });
    }
  });

  app.post("/api/social/follow", async (req: Request, res: Response) => {
    try {
      const { socialFollows } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { followerWallet, followingWallet } = req.body;
      if (!followerWallet || !followingWallet) {
        return res.status(400).json({ error: 'Both wallets required' });
      }
      if (followerWallet.toLowerCase() === followingWallet.toLowerCase()) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
      }
      const existing = await db.select().from(socialFollows).where(
        and(
          eq(socialFollows.followerWallet, followerWallet.toLowerCase()),
          eq(socialFollows.followingWallet, followingWallet.toLowerCase())
        )
      );
      if (existing.length > 0) {
        await db.delete(socialFollows).where(
          and(
            eq(socialFollows.followerWallet, followerWallet.toLowerCase()),
            eq(socialFollows.followingWallet, followingWallet.toLowerCase())
          )
        );
        return res.json({ success: true, action: 'unfollowed' });
      }
      await db.insert(socialFollows).values({
        followerWallet: followerWallet.toLowerCase(),
        followingWallet: followingWallet.toLowerCase()
      });
      res.json({ success: true, action: 'followed' });
    } catch (error) {
      console.error('Follow error:', error);
      res.status(500).json({ error: 'Failed to follow/unfollow' });
    }
  });

  app.get("/api/social/following", async (req: Request, res: Response) => {
    try {
      const { socialFollows } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const wallet = req.query.wallet as string;
      if (!wallet) return res.json([]);
      const follows = await db.select().from(socialFollows).where(
        eq(socialFollows.followerWallet, wallet.toLowerCase())
      );
      res.json(follows.map(f => f.followingWallet));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch following list' });
    }
  });

  app.get("/api/social/followers-count/:wallet", async (req: Request, res: Response) => {
    try {
      const { socialFollows } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const wallet = req.params.wallet.toLowerCase();
      const followers = await db.select().from(socialFollows).where(
        eq(socialFollows.followingWallet, wallet)
      );
      const following = await db.select().from(socialFollows).where(
        eq(socialFollows.followerWallet, wallet)
      );
      res.json({ followers: followers.length, following: following.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch follower counts' });
    }
  });

  app.get("/api/social/profile/:wallet", async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const userBets = await storage.getUserBets(wallet);
      const totalBets = userBets.length;
      const wonBets = userBets.filter(b => b.status === 'won' || b.status === 'paid_out');
      const lostBets = userBets.filter(b => b.status === 'lost');
      const settledBets = wonBets.length + lostBets.length;
      const winRate = settledBets > 0 ? (wonBets.length / settledBets) * 100 : 0;
      const totalStaked = userBets.reduce((sum, b) => sum + (b.stake || b.betAmount || 0), 0);
      const totalWinnings = wonBets.reduce((sum, b) => sum + (b.potentialPayout || 0), 0);
      const totalLost = lostBets.reduce((sum, b) => sum + (b.stake || b.betAmount || 0), 0);
      const profit = totalWinnings - totalStaked;
      const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
      const biggestWin = wonBets.length > 0 
        ? Math.max(...wonBets.map(b => (b.potentialPayout || 0) - (b.stake || b.betAmount || 0)))
        : 0;
      const sportCounts: Record<string, number> = {};
      userBets.forEach(b => {
        const sid = b.sportId?.toString() || 'unknown';
        sportCounts[sid] = (sportCounts[sid] || 0) + 1;
      });
      const favoriteSport = Object.entries(sportCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const recentBets = userBets
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 10)
        .map(b => ({
          id: b.id,
          event: b.eventName || b.externalEventId || 'Unknown',
          prediction: b.prediction,
          odds: b.odds,
          stake: b.stake || b.betAmount,
          status: b.status,
          potentialPayout: b.potentialPayout,
          createdAt: b.createdAt
        }));
      const { socialFollows } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const followers = await db.select().from(socialFollows).where(eq(socialFollows.followingWallet, wallet));
      const following = await db.select().from(socialFollows).where(eq(socialFollows.followerWallet, wallet));

      res.json({
        wallet,
        totalBets,
        winRate: Math.round(winRate * 10) / 10,
        roi: Math.round(roi * 10) / 10,
        profit: Math.round(profit * 1000) / 1000,
        biggestWin: Math.round(biggestWin * 1000) / 1000,
        totalStaked: Math.round(totalStaked * 1000) / 1000,
        favoriteSport,
        followers: followers.length,
        following: following.length,
        recentBets
      });
    } catch (error) {
      console.error('Social profile error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  app.post("/api/social/predictions/:id/resolve", async (req: Request, res: Response) => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const predictionId = parseInt(req.params.id);
      if (isNaN(predictionId) || predictionId <= 0) {
        return res.status(400).json({ error: 'Invalid prediction ID' });
      }
      const { resolverWallet } = req.body;
      if (!resolverWallet || typeof resolverWallet !== 'string' || !resolverWallet.startsWith('0x')) {
        return res.status(400).json({ error: 'Valid wallet required' });
      }
      if (resolvingPredictions.has(predictionId)) {
        return res.status(409).json({ error: 'Prediction is already being resolved' });
      }
      resolvingPredictions.add(predictionId);
      try {
        const [prediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, predictionId));
        if (!prediction) {
          return res.status(404).json({ error: 'Prediction not found' });
        }
        if (prediction.status !== 'active') {
          return res.status(400).json({ error: 'Prediction is not active - may already be resolved' });
        }
        if (prediction.creatorWallet && prediction.creatorWallet.toLowerCase() !== resolverWallet.toLowerCase()) {
          return res.status(403).json({ error: 'Only the prediction creator can resolve it' });
        }
        if (prediction.endDate && new Date(prediction.endDate) > new Date()) {
          return res.status(400).json({ error: 'Cannot resolve before end date' });
        }
        const allBets = await db.select().from(socialPredictionBets).where(eq(socialPredictionBets.predictionId, predictionId));
        const yesTotal = allBets.filter(b => b.side === 'yes').reduce((sum, b) => sum + (b.amount || 0), 0);
        const noTotal = allBets.filter(b => b.side === 'no').reduce((sum, b) => sum + (b.amount || 0), 0);
        const totalPool = yesTotal + noTotal;
        const resolution = yesTotal >= noTotal ? 'yes' : 'no';
        const winners = allBets.filter(b => b.side === resolution);
        const losers = allBets.filter(b => b.side !== resolution);
        const winnersTotal = winners.reduce((sum, b) => sum + (b.amount || 0), 0);
        const newStatus = resolution === 'yes' ? 'resolved_yes' : 'resolved_no';
        if (totalPool === 0 || winners.length === 0) {
          await db.update(socialPredictions)
            .set({ status: newStatus, resolvedOutcome: resolution, resolvedAt: new Date() })
            .where(eq(socialPredictions.id, predictionId));
          console.log(`[Social] Prediction #${predictionId} resolved ${resolution.toUpperCase()} (majority) - no winners to pay (pool: ${totalPool} SBETS)`);
          return res.json({
            success: true,
            resolution: newStatus,
            totalPool,
            winnersCount: 0,
            losersCount: losers.length,
            winningSide: resolution,
            yesTotal,
            noTotal,
            payouts: [],
            payoutStatus: winners.length === 0 ? 'no_winners' : 'empty_pool'
          });
        }
        const payouts = winners.map(w => ({
          wallet: w.wallet,
          betAmount: w.amount,
          payout: winnersTotal > 0 ? ((w.amount || 0) / winnersTotal) * totalPool : 0
        }));
        console.log(`[Social] Prediction #${predictionId} resolving by majority: YES=${yesTotal} vs NO=${noTotal} → ${resolution.toUpperCase()} wins | Pool: ${totalPool} SBETS | Winners: ${winners.length}`);
        const payoutResults: { wallet: string; amount: number; txHash?: string; error?: string }[] = [];
        for (let i = 0; i < payouts.length; i++) {
          const payout = payouts[i];
          if (payout.payout <= 0) continue;
          if (i > 0) await new Promise(r => setTimeout(r, 3000));
          try {
            const result = await blockchainBetService.sendSbetsToUser(payout.wallet, payout.payout);
            if (result.success) {
              console.log(`[Social] Payout sent: ${payout.payout.toFixed(0)} SBETS -> ${payout.wallet.slice(0,10)}... | TX: ${result.txHash}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, txHash: result.txHash });
            } else {
              console.error(`[Social] Payout failed for ${payout.wallet.slice(0,10)}...: ${result.error}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: result.error });
            }
          } catch (payoutError: any) {
            console.error(`[Social] Payout error for ${payout.wallet.slice(0,10)}...:`, payoutError.message);
            payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: payoutError.message });
          }
        }
        const successfulPayouts = payoutResults.filter(p => p.txHash);
        const failedPayouts = payoutResults.filter(p => p.error);
        const finalStatus = failedPayouts.length === 0 ? newStatus : (successfulPayouts.length > 0 ? `${newStatus}_partial` : `${newStatus}_failed`);
        await db.update(socialPredictions)
          .set({ status: finalStatus, resolvedOutcome: resolution, resolvedAt: new Date() })
          .where(eq(socialPredictions.id, predictionId));
        console.log(`[Social] Settlement complete: ${successfulPayouts.length}/${payoutResults.length} payouts successful | Status: ${finalStatus}`);
        res.json({
          success: true,
          resolution: finalStatus,
          totalPool,
          winnersCount: winners.length,
          losersCount: losers.length,
          winningSide: resolution,
          yesTotal,
          noTotal,
          payouts,
          payoutResults: {
            successful: successfulPayouts.length,
            failed: failedPayouts.length,
            details: payoutResults
          }
        });
      } finally {
        resolvingPredictions.delete(predictionId);
      }
    } catch (error) {
      console.error('Resolve prediction error:', error);
      const pid = parseInt(req.params.id);
      if (!isNaN(pid)) resolvingPredictions.delete(pid);
      res.status(500).json({ error: 'Failed to resolve prediction' });
    }
  });

  app.post("/api/social/challenges/:id/settle", async (req: Request, res: Response) => {
    try {
      const { socialChallenges, socialChallengeParticipants } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const challengeId = parseInt(req.params.id);
      if (isNaN(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: 'Invalid challenge ID' });
      }
      const { winner, settlerWallet } = req.body;
      if (!winner || !['creator', 'challengers'].includes(winner)) {
        return res.status(400).json({ error: 'Winner must be "creator" or "challengers"' });
      }
      if (!settlerWallet || typeof settlerWallet !== 'string' || !settlerWallet.startsWith('0x')) {
        return res.status(400).json({ error: 'Valid settler wallet required' });
      }
      if (settlingChallenges.has(challengeId)) {
        return res.status(409).json({ error: 'Challenge is already being settled' });
      }
      settlingChallenges.add(challengeId);
      try {
        const [challenge] = await db.select().from(socialChallenges).where(eq(socialChallenges.id, challengeId));
        if (!challenge) {
          return res.status(404).json({ error: 'Challenge not found' });
        }
        if (challenge.status !== 'open') {
          return res.status(400).json({ error: 'Challenge is not open - may already be settled' });
        }
        if (settlerWallet.toLowerCase() !== challenge.creatorWallet?.toLowerCase()) {
          return res.status(403).json({ error: 'Only the creator can settle this challenge' });
        }
        if (challenge.expiresAt && new Date(challenge.expiresAt) > new Date()) {
          return res.status(400).json({ error: 'Cannot settle before expiry date' });
        }
        const participants = await db.select().from(socialChallengeParticipants).where(eq(socialChallengeParticipants.challengeId, challengeId));
        const totalPool = (challenge.stakeAmount || 0) * ((challenge.currentParticipants || 1));
        let payouts: { wallet: string; payout: number }[] = [];
        if (winner === 'creator') {
          const forParticipants = participants.filter(p => p.side === 'for');
          const winnerCount = 1 + forParticipants.length;
          const perPerson = totalPool / winnerCount;
          payouts = [
            { wallet: challenge.creatorWallet!, payout: perPerson },
            ...forParticipants.map(p => ({ wallet: p.wallet, payout: perPerson }))
          ];
        } else {
          const challengers = participants.filter(p => p.side === 'against');
          if (challengers.length === 0) {
            return res.status(400).json({ error: 'No challengers to pay - cannot settle as challengers win' });
          }
          const perPerson = totalPool / challengers.length;
          payouts = challengers.map(p => ({ wallet: p.wallet, payout: perPerson }));
        }
        console.log(`[Social] Challenge #${challengeId} settling: ${winner} wins | Pool: ${totalPool} SBETS | Payouts: ${payouts.length}`);
        const payoutResults: { wallet: string; amount: number; txHash?: string; error?: string }[] = [];
        for (let i = 0; i < payouts.length; i++) {
          const payout = payouts[i];
          if (payout.payout <= 0) continue;
          if (i > 0) await new Promise(r => setTimeout(r, 3000));
          try {
            const result = await blockchainBetService.sendSbetsToUser(payout.wallet, payout.payout);
            if (result.success) {
              console.log(`[Social] Challenge payout: ${payout.payout.toFixed(0)} SBETS -> ${payout.wallet.slice(0,10)}... | TX: ${result.txHash}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, txHash: result.txHash });
            } else {
              console.error(`[Social] Challenge payout failed: ${payout.wallet.slice(0,10)}... | ${result.error}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: result.error });
            }
          } catch (payoutError: any) {
            console.error(`[Social] Challenge payout error: ${payout.wallet.slice(0,10)}... | ${payoutError.message}`);
            payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: payoutError.message });
          }
        }
        const successfulPayouts = payoutResults.filter(p => p.txHash);
        const failedPayouts = payoutResults.filter(p => p.error);
        const finalStatus = failedPayouts.length === 0 ? 'settled' : (successfulPayouts.length > 0 ? 'settled_partial' : 'settled_failed');
        await db.update(socialChallenges)
          .set({ status: finalStatus })
          .where(eq(socialChallenges.id, challengeId));
        console.log(`[Social] Challenge settlement complete: ${successfulPayouts.length}/${payoutResults.length} payouts successful | Status: ${finalStatus}`);
        res.json({
          success: true,
          winner,
          totalPool,
          payouts,
          payoutResults: {
            successful: successfulPayouts.length,
            failed: failedPayouts.length,
            details: payoutResults
          }
        });
      } finally {
        settlingChallenges.delete(challengeId);
      }
    } catch (error) {
      console.error('Settle challenge error:', error);
      const cid = parseInt(req.params.id);
      if (!isNaN(cid)) settlingChallenges.delete(cid);
      res.status(500).json({ error: 'Failed to settle challenge' });
    }
  });

  app.get("/api/social/chat", async (req: Request, res: Response) => {
    try {
      const { socialChatMessages } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      const messages = await db.select().from(socialChatMessages).orderBy(desc(socialChatMessages.createdAt)).limit(100);
      res.json(messages.reverse());
    } catch (error) {
      console.error('Chat fetch error:', error);
      res.json([]);
    }
  });

  const chatRateLimits = new Map<string, { count: number; resetAt: number }>();
  const CHAT_LIMIT = 30;
  const CHAT_WINDOW = 60 * 1000;

  app.post("/api/social/chat", async (req: Request, res: Response) => {
    try {
      const { socialChatMessages } = await import('@shared/schema');
      const { wallet, message } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message required' });
      }
      const trimmed = message.trim().slice(0, 500);
      if (!trimmed || trimmed.length < 1) {
        return res.status(400).json({ error: 'Message cannot be empty' });
      }
      const walletLower = wallet.toLowerCase();
      const now = Date.now();
      const rateData = chatRateLimits.get(walletLower);
      if (rateData && rateData.resetAt > now) {
        if (rateData.count >= CHAT_LIMIT) {
          return res.status(429).json({ error: 'Slow down - max 30 messages per minute' });
        }
        rateData.count++;
      } else {
        chatRateLimits.set(walletLower, { count: 1, resetAt: now + CHAT_WINDOW });
      }
      const [chatMsg] = await db.insert(socialChatMessages).values({
        wallet: walletLower,
        message: trimmed
      }).returning();
      res.json(chatMsg);
    } catch (error) {
      console.error('Chat send error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  app.get("/api/social/predictions/bets", async (req: Request, res: Response) => {
    try {
      const { socialPredictionBets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const wallet = (req.query.wallet as string || '').toLowerCase();
      if (!wallet) return res.json([]);
      const bets = await db.select().from(socialPredictionBets).where(
        eq(socialPredictionBets.wallet, wallet)
      );
      res.json(bets);
    } catch (error) {
      res.json([]);
    }
  });

  // ==========================================
  // PUBLIC PLATFORM STATS
  // ==========================================

  let platformStatsCache: { data: any; fetchedAt: number } = { data: null, fetchedAt: 0 };
  const PLATFORM_STATS_CACHE_TTL = 5 * 60 * 1000;

  app.get("/api/platform/stats", async (_req: Request, res: Response) => {
    try {
      if (Date.now() - platformStatsCache.fetchedAt < PLATFORM_STATS_CACHE_TTL && platformStatsCache.data) {
        return res.json(platformStatsCache.data);
      }

      const settledResult = await db.execute(sql`SELECT COUNT(*) as count FROM bets WHERE status IN ('won', 'lost', 'void')`);
      const rows1 = Array.isArray(settledResult) ? settledResult : settledResult.rows || [];
      const settledCount = parseInt(rows1[0]?.count || '0');

      const volumeResult = await db.execute(sql`SELECT COALESCE(SUM(CASE WHEN currency='SBETS' THEN bet_amount ELSE 0 END), 0) as sbets_volume, COALESCE(SUM(CASE WHEN currency='SUI' THEN bet_amount ELSE 0 END), 0) as sui_volume FROM bets`);
      const rows2 = Array.isArray(volumeResult) ? volumeResult : volumeResult.rows || [];
      const sbetsVolume = parseFloat(rows2[0]?.sbets_volume || '0');
      const suiVolume = parseFloat(rows2[0]?.sui_volume || '0');

      const totalResult = await db.execute(sql`SELECT COUNT(*) as count FROM bets`);
      const rows3 = Array.isArray(totalResult) ? totalResult : totalResult.rows || [];
      const totalBets = parseInt(rows3[0]?.count || '0');

      const data = {
        betsSettled: settledCount,
        totalBets,
        sbetsVolume: Math.round(sbetsVolume),
        suiVolume: Math.round(suiVolume * 100) / 100,
      };

      platformStatsCache = { data, fetchedAt: Date.now() };
      res.json(data);
    } catch (error: any) {
      console.error("[PlatformStats] Error:", error.message);
      if (platformStatsCache.data) {
        return res.json(platformStatsCache.data);
      }
      res.json({ betsSettled: 0, totalBets: 0, sbetsVolume: 0, suiVolume: 0 });
    }
  });

  // ==========================================
  // SETTLEMENT TRANSPARENCY DASHBOARD API
  // ==========================================

  let settlementTransparencyCache: { data: any; fetchedAt: number } = { data: null, fetchedAt: 0 };
  const SETTLEMENT_TRANSPARENCY_CACHE_TTL = 60 * 1000;

  app.get("/api/settlement/transparency", async (_req: Request, res: Response) => {
    try {
      if (Date.now() - settlementTransparencyCache.fetchedAt < SETTLEMENT_TRANSPARENCY_CACHE_TTL && settlementTransparencyCache.data) {
        return res.json(settlementTransparencyCache.data);
      }

      const overviewResult = await db.execute(sql`
        SELECT 
          COUNT(*) FILTER (WHERE status IN ('won', 'paid_out', 'lost', 'void')) as total_settled,
          COUNT(*) FILTER (WHERE status IN ('won', 'paid_out')) as total_won,
          COUNT(*) FILTER (WHERE status = 'lost') as total_lost,
          COUNT(*) FILTER (WHERE status = 'void') as total_void,
          COUNT(*) FILTER (WHERE status = 'pending') as total_pending,
          COALESCE(SUM(CASE WHEN status IN ('won', 'paid_out') AND currency = 'SUI' THEN payout ELSE 0 END), 0) as total_sui_paid,
          COALESCE(SUM(CASE WHEN status IN ('won', 'paid_out') AND currency = 'SBETS' THEN payout ELSE 0 END), 0) as total_sbets_paid,
          COALESCE(SUM(CASE WHEN currency = 'SUI' THEN bet_amount ELSE 0 END), 0) as total_sui_wagered,
          COALESCE(SUM(CASE WHEN currency = 'SBETS' THEN bet_amount ELSE 0 END), 0) as total_sbets_wagered,
          COUNT(DISTINCT wallet_address) as unique_bettors,
          COUNT(DISTINCT CASE WHEN status IN ('won', 'paid_out') THEN wallet_address END) as unique_winners,
          COUNT(*) FILTER (WHERE settlement_tx_hash IS NOT NULL) as onchain_settlements,
          AVG(CASE WHEN settled_at IS NOT NULL AND created_at IS NOT NULL THEN EXTRACT(EPOCH FROM (settled_at - created_at)) END) as avg_settlement_secs
        FROM bets
      `);
      const overviewRows = Array.isArray(overviewResult) ? overviewResult : overviewResult.rows || [];
      const ov = overviewRows[0] || {};

      const recentSettledResult = await db.execute(sql`
        SELECT 
          id, wallet_address, event_name, prediction, bet_amount, currency, odds,
          potential_payout, payout, status, result, settlement_tx_hash,
          created_at, settled_at, home_team, away_team, external_event_id,
          bet_type, platform_fee
        FROM bets 
        WHERE status IN ('won', 'paid_out', 'lost') AND settled_at IS NOT NULL
          AND (event_name IS NULL OR event_name NOT ILIKE '%recovered%')
        ORDER BY settled_at DESC 
        LIMIT 50
      `);
      const recentSettled = Array.isArray(recentSettledResult) ? recentSettledResult : recentSettledResult.rows || [];

      const sportBreakdownResult = await db.execute(sql`
        SELECT 
          COALESCE(s.name, 'Other') as sport,
          COUNT(*) FILTER (WHERE b.status IN ('won', 'paid_out', 'lost', 'void')) as settled,
          COUNT(*) FILTER (WHERE b.status IN ('won', 'paid_out')) as won,
          COUNT(*) FILTER (WHERE b.status = 'lost') as lost,
          COALESCE(SUM(CASE WHEN b.status IN ('won', 'paid_out') THEN b.payout ELSE 0 END), 0) as total_paid
        FROM bets b
        LEFT JOIN events e ON b.event_id = e.id
        LEFT JOIN sports s ON e.sport_id = s.id
        WHERE b.status IN ('won', 'paid_out', 'lost', 'void')
        GROUP BY s.name
        ORDER BY settled DESC
      `);
      const sportBreakdown = Array.isArray(sportBreakdownResult) ? sportBreakdownResult : sportBreakdownResult.rows || [];

      const hourlyResult = await db.execute(sql`
        SELECT 
          date_trunc('hour', settled_at) as hour,
          COUNT(*) as settled_count,
          COUNT(*) FILTER (WHERE status IN ('won', 'paid_out')) as won_count,
          COALESCE(SUM(CASE WHEN status IN ('won', 'paid_out') THEN payout ELSE 0 END), 0) as paid_out
        FROM bets
        WHERE settled_at IS NOT NULL AND settled_at > NOW() - INTERVAL '24 hours'
        GROUP BY 1
        ORDER BY 1 DESC
      `);
      const hourlyActivity = Array.isArray(hourlyResult) ? hourlyResult : hourlyResult.rows || [];

      const parlayResult = await db.execute(sql`
        SELECT 
          COUNT(*) as total_parlays,
          COUNT(*) FILTER (WHERE status IN ('won', 'paid_out', 'lost', 'void')) as settled_parlays,
          COUNT(*) FILTER (WHERE status IN ('won', 'paid_out')) as won_parlays,
          COALESCE(AVG(CASE WHEN status IS NOT NULL THEN total_odds END), 0) as avg_odds,
          COALESCE(MAX(CASE WHEN status IN ('won', 'paid_out') THEN payout END), 0) as biggest_parlay_win
        FROM parlays
      `);
      const parlayRows = Array.isArray(parlayResult) ? parlayResult : parlayResult.rows || [];
      const parlayStats = parlayRows[0] || {};

      const bigWinsResult = await db.execute(sql`
        SELECT 
          id, wallet_address, event_name, prediction, bet_amount, currency, odds,
          payout, settlement_tx_hash, settled_at, bet_type
        FROM bets
        WHERE status IN ('won', 'paid_out') AND payout > 0
        ORDER BY payout DESC
        LIMIT 10
      `);
      const biggestWins = Array.isArray(bigWinsResult) ? bigWinsResult : bigWinsResult.rows || [];

      const settledEventsResult = await db.execute(sql`
        SELECT COUNT(*) as count FROM settled_events
      `);
      const seRows = Array.isArray(settledEventsResult) ? settledEventsResult : settledEventsResult.rows || [];
      const totalEventsSettled = parseInt(seRows[0]?.count || '0');

      const avgSettlementSecs = parseFloat(ov.avg_settlement_secs || '0');
      const avgSettlementHours = Math.round(avgSettlementSecs / 3600 * 10) / 10;

      const data = {
        overview: {
          totalSettled: parseInt(ov.total_settled || '0'),
          totalWon: parseInt(ov.total_won || '0'),
          totalLost: parseInt(ov.total_lost || '0'),
          totalVoid: parseInt(ov.total_void || '0'),
          totalPending: parseInt(ov.total_pending || '0'),
          totalSuiPaid: Math.round(parseFloat(ov.total_sui_paid || '0') * 100) / 100,
          totalSbetsPaid: Math.round(parseFloat(ov.total_sbets_paid || '0')),
          totalSuiWagered: Math.round(parseFloat(ov.total_sui_wagered || '0') * 100) / 100,
          totalSbetsWagered: Math.round(parseFloat(ov.total_sbets_wagered || '0')),
          uniqueBettors: parseInt(ov.unique_bettors || '0'),
          uniqueWinners: parseInt(ov.unique_winners || '0'),
          onchainSettlements: parseInt(ov.onchain_settlements || '0'),
          avgSettlementHours,
          totalEventsSettled,
          settlementRate: parseInt(ov.total_settled || '0') > 0 
            ? Math.round((parseInt(ov.total_settled || '0') / (parseInt(ov.total_settled || '0') + parseInt(ov.total_pending || '0'))) * 10000) / 100 
            : 0,
          winRate: parseInt(ov.total_settled || '0') > 0
            ? Math.round((parseInt(ov.total_won || '0') / parseInt(ov.total_settled || '0')) * 10000) / 100
            : 0,
        },
        recentSettlements: recentSettled.map((b: any) => ({
          id: b.id,
          wallet: b.wallet_address ? `${b.wallet_address.slice(0, 6)}...${b.wallet_address.slice(-4)}` : 'Unknown',
          eventName: b.event_name || `${b.home_team || '?'} vs ${b.away_team || '?'}`,
          prediction: b.prediction,
          betAmount: b.bet_amount,
          currency: b.currency || 'SUI',
          odds: b.odds,
          potentialPayout: b.potential_payout,
          payout: b.payout || 0,
          status: b.status === 'paid_out' ? 'won' : b.status,
          result: b.result,
          settlementTxHash: b.settlement_tx_hash,
          createdAt: b.created_at,
          settledAt: b.settled_at,
          betType: b.bet_type || 'single',
          platformFee: b.platform_fee || 0,
          suiscanUrl: b.settlement_tx_hash ? `https://suiscan.xyz/mainnet/tx/${b.settlement_tx_hash}` : null,
        })),
        sportBreakdown,
        hourlyActivity,
        parlayStats: {
          totalParlays: parseInt(parlayStats.total_parlays || '0'),
          settledParlays: parseInt(parlayStats.settled_parlays || '0'),
          wonParlays: parseInt(parlayStats.won_parlays || '0'),
          avgOdds: Math.round(parseFloat(parlayStats.avg_odds || '0') * 100) / 100,
          biggestWin: Math.round(parseFloat(parlayStats.biggest_parlay_win || '0') * 100) / 100,
        },
        biggestWins: biggestWins.map((b: any) => ({
          id: b.id,
          wallet: b.wallet_address ? `${b.wallet_address.slice(0, 6)}...${b.wallet_address.slice(-4)}` : 'Unknown',
          eventName: b.event_name,
          prediction: b.prediction,
          betAmount: b.bet_amount,
          currency: b.currency || 'SUI',
          odds: b.odds,
          payout: b.payout,
          settlementTxHash: b.settlement_tx_hash,
          settledAt: b.settled_at,
          betType: b.bet_type || 'single',
          suiscanUrl: b.settlement_tx_hash ? `https://suiscan.xyz/mainnet/tx/${b.settlement_tx_hash}` : null,
        })),
        security: {
          payoutCapEnforcementPoints: 19,
          maxPayoutSui: 150,
          maxPayoutSbets: 15000000,
          maxOdds: 7.0,
          maxParlayOdds: 15.0,
          maxBetsPerWallet24h: 7,
          maxBetsPerMatch: 3,
          oddsTolerance: '10%',
          oracleDataSource: 'Paid Sports Oracle',
          settlementMode: 'Fully Automated',
          antiExploitChecks: ['Rate limiting', 'Duplicate detection', 'Odds tolerance validation', 'Cooldown enforcement', 'Payout cap at every layer', 'Treasury protection'],
        },
        generatedAt: new Date().toISOString(),
      };

      settlementTransparencyCache = { data, fetchedAt: Date.now() };
      res.json(data);
    } catch (error: any) {
      console.error("[SettlementTransparency] Error:", error.message);
      if (settlementTransparencyCache.data) {
        return res.json({ ...settlementTransparencyCache.data, stale: true, staleReason: 'db_error', servedAt: new Date().toISOString() });
      }
      res.status(500).json({ error: "Failed to load settlement data" });
    }
  });

  // ==========================================
  // WORLD CUP 2026 NEWS (Google News RSS + OG metadata)
  // ==========================================

  let wcNewsCache: { articles: any[]; fetchedAt: number } = { articles: [], fetchedAt: 0 };
  const WC_NEWS_CACHE_TTL = 10 * 60 * 1000;

  async function fetchOgMetadata(url: string): Promise<{ image: string; description: string }> {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return { image: '', description: '' };
      if (['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '[::1]'].includes(parsed.hostname)) return { image: '', description: '' };
      if (parsed.hostname.startsWith('10.') || parsed.hostname.startsWith('192.168.') || parsed.hostname.match(/^172\.(1[6-9]|2\d|3[01])\./)) return { image: '', description: '' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);
      if (!resp.ok) return { image: '', description: '' };
      const html = await resp.text();
      const head = html.substring(0, 20000);
      const getMetaContent = (property: string): string => {
        const patterns = [
          new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
        ];
        for (const p of patterns) {
          const m = head.match(p);
          if (m && m[1]) return m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
        }
        return '';
      };
      const image = getMetaContent('og:image') || getMetaContent('twitter:image');
      const description = getMetaContent('og:description') || getMetaContent('description') || getMetaContent('twitter:description');
      return { image, description: description.substring(0, 300) };
    } catch {
      return { image: '', description: '' };
    }
  }

  app.get("/api/world-cup/news", async (_req: Request, res: Response) => {
    try {
      if (Date.now() - wcNewsCache.fetchedAt < WC_NEWS_CACHE_TTL && wcNewsCache.articles.length > 0) {
        return res.json({ articles: wcNewsCache.articles, cached: true });
      }

      const query = encodeURIComponent('FIFA World Cup 2026');
      const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`;
      const response = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SuiBets/1.0)' }
      });

      if (!response.ok) throw new Error(`RSS fetch failed: ${response.status}`);
      const xml = await response.text();

      const rawArticles: any[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null && rawArticles.length < 15) {
        try {
          const itemXml = match[1];
          const getTag = (tag: string) => {
            const m = itemXml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
            return m ? m[1].trim() : '';
          };
          const title = getTag('title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
          const link = getTag('link');
          const pubDate = getTag('pubDate');
          const source = getTag('source');
          const sourceUrlMatch = itemXml.match(/<source[^>]*url=["']([^"']+)["']/);
          const sourceUrl = sourceUrlMatch ? sourceUrlMatch[1] : '';

          if (title && !title.includes('Google News')) {
            const parsedDate = pubDate ? new Date(pubDate) : null;
            const isValidDate = parsedDate && !isNaN(parsedDate.getTime());
            rawArticles.push({
              title,
              url: link,
              source: source || 'News',
              sourceUrl,
              publishedAt: isValidDate ? parsedDate.toISOString() : new Date().toISOString(),
              timeAgo: isValidDate ? getTimeAgo(parsedDate) : 'recently',
              description: '',
              image: '',
            });
          }
        } catch (itemErr) {
          continue;
        }
      }

      const ogPromises = rawArticles.slice(0, 10).map(async (article) => {
        if (article.sourceUrl) {
          try {
            const og = await fetchOgMetadata(article.sourceUrl);
            if (og.image) article.image = og.image;
            if (og.description) article.description = og.description;
          } catch {}
        }
        return article;
      });
      const articles = await Promise.all(ogPromises);
      for (let i = 10; i < rawArticles.length; i++) {
        articles.push(rawArticles[i]);
      }

      wcNewsCache = { articles, fetchedAt: Date.now() };
      res.json({ articles, cached: false });
    } catch (error: any) {
      console.error("[WorldCupNews] Error fetching news:", error.message);
      if (wcNewsCache.articles.length > 0) {
        return res.json({ articles: wcNewsCache.articles, cached: true, stale: true });
      }
      res.json({ articles: [], error: 'Failed to fetch news' });
    }
  });

  function getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  app.get("/api/world-cup/groups", async (_req: Request, res: Response) => {
    const groups = [
      { group: 'A', teams: [
        { name: 'USA', code: 'US', fifaRank: 11 },
        { name: 'Morocco', code: 'MA', fifaRank: 14 },
        { name: 'Scotland', code: 'GB-SCT', fifaRank: 39 },
        { name: 'South Korea', code: 'KR', fifaRank: 22 },
      ]},
      { group: 'B', teams: [
        { name: 'Mexico', code: 'MX', fifaRank: 15 },
        { name: 'Senegal', code: 'SN', fifaRank: 21 },
        { name: 'Ecuador', code: 'EC', fifaRank: 33 },
        { name: 'Bolivia', code: 'BO', fifaRank: 83 },
      ]},
      { group: 'C', teams: [
        { name: 'Canada', code: 'CA', fifaRank: 43 },
        { name: 'Serbia', code: 'RS', fifaRank: 32 },
        { name: 'Slovenia', code: 'SI', fifaRank: 53 },
        { name: 'Trinidad', code: 'TT', fifaRank: 103 },
      ]},
      { group: 'D', teams: [
        { name: 'Brazil', code: 'BR', fifaRank: 5 },
        { name: 'Colombia', code: 'CO', fifaRank: 12 },
        { name: 'Australia', code: 'AU', fifaRank: 24 },
        { name: 'Bahrain', code: 'BH', fifaRank: 81 },
      ]},
      { group: 'E', teams: [
        { name: 'Argentina', code: 'AR', fifaRank: 1 },
        { name: 'Ukraine', code: 'UA', fifaRank: 23 },
        { name: 'Uzbekistan', code: 'UZ', fifaRank: 64 },
        { name: 'Peru', code: 'PE', fifaRank: 34 },
      ]},
      { group: 'F', teams: [
        { name: 'Spain', code: 'ES', fifaRank: 2 },
        { name: 'Turkey', code: 'TR', fifaRank: 26 },
        { name: 'China', code: 'CN', fifaRank: 72 },
        { name: 'New Zealand', code: 'NZ', fifaRank: 96 },
      ]},
      { group: 'G', teams: [
        { name: 'France', code: 'FR', fifaRank: 3 },
        { name: 'Uruguay', code: 'UY', fifaRank: 16 },
        { name: 'Panama', code: 'PA', fifaRank: 44 },
        { name: 'Saudi Arabia', code: 'SA', fifaRank: 58 },
      ]},
      { group: 'H', teams: [
        { name: 'England', code: 'GB-ENG', fifaRank: 4 },
        { name: 'Poland', code: 'PL', fifaRank: 25 },
        { name: 'Cameroon', code: 'CM', fifaRank: 46 },
        { name: 'Honduras', code: 'HN', fifaRank: 79 },
      ]},
      { group: 'I', teams: [
        { name: 'Portugal', code: 'PT', fifaRank: 6 },
        { name: 'Denmark', code: 'DK', fifaRank: 19 },
        { name: 'Egypt', code: 'EG', fifaRank: 36 },
        { name: 'Paraguay', code: 'PY', fifaRank: 61 },
      ]},
      { group: 'J', teams: [
        { name: 'Germany', code: 'DE', fifaRank: 8 },
        { name: 'Japan', code: 'JP', fifaRank: 17 },
        { name: 'Costa Rica', code: 'CR', fifaRank: 50 },
        { name: 'Indonesia', code: 'ID', fifaRank: 91 },
      ]},
      { group: 'K', teams: [
        { name: 'Netherlands', code: 'NL', fifaRank: 7 },
        { name: 'Austria', code: 'AT', fifaRank: 20 },
        { name: 'Nigeria', code: 'NG', fifaRank: 28 },
        { name: 'Jamaica', code: 'JM', fifaRank: 68 },
      ]},
      { group: 'L', teams: [
        { name: 'Italy', code: 'IT', fifaRank: 9 },
        { name: 'Croatia', code: 'HR', fifaRank: 10 },
        { name: 'Switzerland', code: 'CH', fifaRank: 18 },
        { name: 'Algeria', code: 'DZ', fifaRank: 37 },
      ]},
    ];
    res.json({ groups, drawDate: '2025-12-13', tournamentStart: '2026-06-11', tournamentEnd: '2026-07-19' });
  });

  // ==========================================
  // STREAMING API (SportsRC primary + WeStream fallback)
  // ==========================================

  const SPORTSRC_BASE = 'https://api.sportsrc.org';
  const WESTREAM_BASE = 'https://westream.su';
  const streamCache = new Map<string, { data: any; time: number }>();
  const STREAM_CACHE_TTL = 60_000;

  const fetchSportsRC = async (params: string): Promise<any> => {
    const cacheKey = `sportsrc:${params}`;
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.time < STREAM_CACHE_TTL) return cached.data;
    const response = await fetch(`${SPORTSRC_BASE}/?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`SportsRC API error: ${response.status}`);
    const json = await response.json();
    if (!json.success) throw new Error('SportsRC returned unsuccessful response');
    const data = json.data;
    streamCache.set(cacheKey, { data, time: Date.now() });
    return data;
  };

  const fetchWestream = async (path: string): Promise<any> => {
    const cacheKey = `westream:${path}`;
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.time < STREAM_CACHE_TTL) return cached.data;
    const response = await fetch(`${WESTREAM_BASE}${path}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`WeStream API error: ${response.status}`);
    const data = await response.json();
    streamCache.set(cacheKey, { data, time: Date.now() });
    return data;
  };

  const sanitizeMatch = (m: any): any => ({
    id: m.id || '',
    title: m.title || '',
    category: m.category || '',
    date: m.date || 0,
    popular: !!m.popular,
    poster: typeof m.poster === 'string' ? m.poster : '',
    teams: {
      home: { name: m.teams?.home?.name || null, badge: m.teams?.home?.badge || '' },
      away: { name: m.teams?.away?.name || null, badge: m.teams?.away?.badge || '' },
    },
  });

  const sanitizeMatchList = (matches: any[]): any[] =>
    Array.isArray(matches) ? matches.map(sanitizeMatch) : [];

  const fetchMatchesBySport = async (sport: string): Promise<any[]> => {
    try {
      return await fetchSportsRC(`data=matches&category=${sport}`);
    } catch (e: any) {
      console.warn(`[Streaming] SportsRC failed for ${sport}: ${e.message}, trying WeStream`);
      try {
        return await fetchWestream(`/matches/${sport}`);
      } catch (e2: any) {
        console.error(`[Streaming] WeStream also failed for ${sport}: ${e2.message}`);
        return [];
      }
    }
  };

  app.get("/api/streaming/football", async (_req: Request, res: Response) => {
    try {
      const data = await fetchMatchesBySport('football');
      res.json(sanitizeMatchList(data));
    } catch (error: any) {
      console.error("[Streaming] Football matches error:", error.message);
      res.json([]);
    }
  });

  app.get("/api/streaming/live", async (_req: Request, res: Response) => {
    try {
      const sportsRes = await fetchSportsRC('data=sports');
      const sportIds: string[] = Array.isArray(sportsRes) ? sportsRes.map((s: any) => s.id) : [];
      if (sportIds.length === 0) throw new Error('No sports returned');

      const allMatches: any[] = [];
      const now = Date.now();
      const batchSize = 5;
      for (let i = 0; i < sportIds.length; i += batchSize) {
        const batch = sportIds.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(sport => fetchSportsRC(`data=matches&category=${sport}`))
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            for (const m of r.value) {
              const matchDate = m.date || 0;
              const diff = now - matchDate;
              if (diff >= -30 * 60000 && diff < 4 * 60 * 60 * 1000) {
                allMatches.push(m);
              }
            }
          }
        }
      }

      allMatches.sort((a, b) => {
        if (a.popular && !b.popular) return -1;
        if (!a.popular && b.popular) return 1;
        return (a.date || 0) - (b.date || 0);
      });

      res.json(sanitizeMatchList(allMatches));
    } catch (error: any) {
      console.error("[Streaming] SportsRC live error:", error.message, "- trying WeStream fallback");
      try {
        const data = await fetchWestream('/matches/live');
        res.json(sanitizeMatchList(data));
      } catch (e2: any) {
        console.error("[Streaming] WeStream live also failed:", e2.message);
        res.json([]);
      }
    }
  });

  app.get("/api/streaming/sports", async (_req: Request, res: Response) => {
    try {
      const data = await fetchSportsRC('data=sports');
      res.json(data);
    } catch (error: any) {
      console.error("[Streaming] Sports list error:", error.message);
      try {
        const data = await fetchWestream('/sports');
        res.json(data);
      } catch {
        res.json([]);
      }
    }
  });

  app.get("/api/streaming/matches/:sport", async (req: Request, res: Response) => {
    try {
      const sport = String(req.params.sport).replace(/[^a-zA-Z0-9_-]/g, '');
      const data = await fetchMatchesBySport(sport);
      res.json(sanitizeMatchList(data));
    } catch (error: any) {
      console.error("[Streaming] Sport matches error:", error.message);
      res.json([]);
    }
  });

  app.get("/api/streaming/stream/:source/:id", async (req: Request, res: Response) => {
    try {
      const { source, id } = req.params;
      const safeSource = String(source).replace(/[^a-zA-Z0-9_-]/g, '');
      const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
      res.json([]);
    } catch (error: any) {
      console.error("[Streaming] Stream source error:", error.message);
      res.json([]);
    }
  });

  const ALLOWED_EMBED_DOMAINS = ['embed.streamapi.cc', 'westream.su', 'www.westream.su'];

  const validateEmbedUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && ALLOWED_EMBED_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
    } catch {
      return false;
    }
  };

  app.get("/api/streaming/detail/:category/:id", async (req: Request, res: Response) => {
    try {
      const category = String(req.params.category).replace(/[^a-zA-Z0-9_-]/g, '');
      const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
      let data: any = null;
      try {
        data = await fetchSportsRC(`data=detail&category=${category}&id=${id}`);
      } catch (e: any) {
        console.warn(`[Streaming] SportsRC detail failed: ${e.message}, trying WeStream`);
        try {
          data = await fetchWestream(`/stream/${category}/${id}`);
        } catch { /* both failed */ }
      }
      if (data && data.sources) {
        const sanitized = {
          id: data.id || id,
          title: data.title || '',
          category: data.category || category,
          date: data.date || 0,
          popular: !!data.popular,
          teams: {
            home: { name: data.teams?.home?.name || null, badge: data.teams?.home?.badge || '' },
            away: { name: data.teams?.away?.name || null, badge: data.teams?.away?.badge || '' },
          },
          sources: data.sources
            .filter((s: any) => s.embedUrl && validateEmbedUrl(s.embedUrl))
            .map((s: any) => ({
              streamNo: s.streamNo || 1,
              language: s.language || '',
              hd: !!s.hd,
              source: String(s.source || '').replace(/[^a-zA-Z0-9_-]/g, ''),
              viewers: Math.max(0, parseInt(s.viewers) || 0),
            })),
        };
        res.json(sanitized);
      } else {
        res.status(404).json({ error: 'Match not found' });
      }
    } catch (error: any) {
      console.error("[Streaming] Detail error:", error.message);
      res.status(404).json({ error: 'Match not found' });
    }
  });


  const embedRateLimit = new Map<string, number[]>();
  const checkEmbedRateLimit = (ip: string, maxPerMin: number = 30): boolean => {
    const now = Date.now();
    const timestamps = (embedRateLimit.get(ip) || []).filter(t => now - t < 60000);
    if (timestamps.length >= maxPerMin) return false;
    timestamps.push(now);
    embedRateLimit.set(ip, timestamps);
    return true;
  };
  setInterval(() => {
    const now = Date.now();
    for (const [ip, ts] of embedRateLimit) {
      const valid = ts.filter(t => now - t < 60000);
      if (valid.length === 0) embedRateLimit.delete(ip);
      else embedRateLimit.set(ip, valid);
    }
  }, 300000);

  const AD_DOMAINS = [
    'enteringlacquergiant.com', 'histats.com', 'sstatic1.histats.com',
    'googletagmanager.com', 'googlesyndication.com', 'doubleclick.net',
    'popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com',
    'juicyads.com', 'exoclick.com', 'trafficjunky.com', 'clickadu.com',
    'hilltopads.net', 'pushground.com', 'richpush.co', 'mgid.com',
    'taboola.com', 'outbrain.com', 'revcontent.com', 'contentad.net',
    'adcash.com', 'bidvertiser.com', 'clickagy.com', 'monetag.com',
    'a-ads.com', 'coinzilla.com', 'bitmedia.io', 'ad-maven.com',
    'disqus.com', 'sharethis.com', 'addthis.com',
  ];

  const stripAdsFromHtml = (html: string, embedOrigin: string): string => {
    let clean = html;

    const scriptBlocks = clean.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const block of scriptBlocks) {
      if (/_Hasync|Histats/i.test(block)) {
        clean = clean.replace(block, '');
        continue;
      }
      if (/window\.top|window\.parent|window\.self\s*[!=]==?\s*(window\.top|top|parent)|top\s*[!=]==?\s*self|parent\s*[!=]==?\s*self|top\.location|parent\.location|frameElement|sandbox/i.test(block)) {
        clean = clean.replace(block, '');
        continue;
      }
      const blockLower = block.toLowerCase();
      if (AD_DOMAINS.some(d => blockLower.includes(d))) {
        clean = clean.replace(block, '');
        continue;
      }
      if (/pop(up|under)|adblock|ad[\-_]?banner|ad[\-_]?overlay|clickunder|exo_?click/i.test(block)) {
        clean = clean.replace(block, '');
        continue;
      }
    }
    clean = clean.replace(/<noscript>[\s\S]*?histats[\s\S]*?<\/noscript>/gi, '');
    clean = clean.replace(/<noscript>[\s\S]*?sstatic[\s\S]*?<\/noscript>/gi, '');

    for (const domain of AD_DOMAINS) {
      const domainEsc = domain.replace(/\./g, '\\.');
      clean = clean.replace(new RegExp(`<script[^>]*src\\s*=\\s*["'][^"']*${domainEsc}[^"']*["'][^>]*>[\\s\\S]*?<\\/script>`, 'gi'), '');
      clean = clean.replace(new RegExp(`<link[^>]*href\\s*=\\s*["'][^"']*${domainEsc}[^"']*["'][^>]*\\/?>`, 'gi'), '');
      clean = clean.replace(new RegExp(`<iframe[^>]*src\\s*=\\s*["'][^"']*${domainEsc}[^"']*["'][^>]*>[\\s\\S]*?<\\/iframe>`, 'gi'), '');
      clean = clean.replace(new RegExp(`<img[^>]*src\\s*=\\s*["'][^"']*${domainEsc}[^"']*["'][^>]*\\/?>`, 'gi'), '');
    }

    clean = clean.replace(/<a[^>]*target\s*=\s*["']_blank["'][^>]*>[\s\S]*?<\/a>/gi, '');
    clean = clean.replace(/<div[^>]*class\s*=\s*["'][^"']*(ad[_-]?container|ad[_-]?wrapper|ad[_-]?banner|popup|overlay|modal)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

    const popupBlocker = `<script>
(function(){
  try{Object.defineProperty(window,'top',{get:function(){return window.self},configurable:true});}catch(e){}
  try{Object.defineProperty(window,'parent',{get:function(){return window.self},configurable:true});}catch(e){}
  try{Object.defineProperty(window,'frameElement',{get:function(){return null},configurable:true});}catch(e){}

  window.open=function(){return{closed:false,close:function(){},focus:function(){},blur:function(){},postMessage:function(){},document:{write:function(){},close:function(){}}}};
  window.alert=function(){};
  window.confirm=function(){return true};
  window.prompt=function(){return ''};

  var adStyle=document.createElement('style');
  adStyle.textContent='[class*="ad-"],[class*="ad_"],[class*="popup"],[class*="overlay"],[class*="modal"],[id*="ad-"],[id*="ad_"],[id*="popup"],[id*="overlay"]{display:none!important}a[target="_blank"]{pointer-events:none!important}';
  document.documentElement.appendChild(adStyle);

  function cleanOverlays(){
    document.querySelectorAll('a[target="_blank"]').forEach(function(a){a.removeAttribute('target');a.onclick=function(e){e.preventDefault();e.stopPropagation();return false}});
    var all=document.querySelectorAll('div,section,aside,span,a,iframe');
    for(var i=0;i<all.length;i++){
      var el=all[i];
      try{
        var s=window.getComputedStyle(el);
        var z=parseInt(s.zIndex)||0;
        if(z>99&&(s.position==='fixed'||s.position==='absolute')){
          var isPlayer=el.querySelector('video,canvas,object,embed');
          var isPlayerEl=el.id==='video-iframe'||el.classList.contains('player-container')||el.classList.contains('jw-wrapper')||el.tagName==='VIDEO';
          if(!isPlayer&&!isPlayerEl){el.remove();continue}
        }
        if(el.tagName==='IFRAME'&&!el.src&&!el.dataset.src){el.remove();continue}
        if(el.tagName==='IFRAME'&&el.src){
          var dominated=false;
          for(var d=0;d<arguments.callee.adDomains.length;d++){if(el.src.indexOf(arguments.callee.adDomains[d])!==-1){dominated=true;break}}
          if(dominated){el.remove();continue}
        }
      }catch(e){}
    }
  }
  cleanOverlays.adDomains=${JSON.stringify(AD_DOMAINS)};
  setInterval(cleanOverlays,800);
  setTimeout(cleanOverlays,500);
  setTimeout(cleanOverlays,1500);
  setTimeout(cleanOverlays,3000);

  document.addEventListener('click',function(e){
    var t=e.target;
    while(t&&t!==document.body){
      if(t.tagName==='A'&&t.getAttribute('target')==='_blank'){e.preventDefault();e.stopPropagation();return false}
      t=t.parentElement;
    }
  },true);
})();
</script>`;

    if (clean.includes('<head>')) {
      clean = clean.replace('<head>', '<head>\n' + popupBlocker);
    } else {
      clean = popupBlocker + '\n' + clean;
    }

    return clean;
  };

  const proxyCache = new Map<string, { html: string; time: number }>();
  const PROXY_CACHE_TTL = 300_000;

  app.get("/api/stream-proxy/:category/:id/:streamNo", async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkEmbedRateLimit(clientIp)) {
        return res.status(429).send('Too many requests');
      }
      const category = String(req.params.category).replace(/[^a-zA-Z0-9_-]/g, '');
      const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
      const streamNo = parseInt(String(req.params.streamNo).replace(/[^0-9]/g, ''), 10) || 1;

      const proxyCacheKey = `${category}:${id}:${streamNo}`;
      const cachedProxy = proxyCache.get(proxyCacheKey);
      if (cachedProxy && Date.now() - cachedProxy.time < PROXY_CACHE_TTL) {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(cachedProxy.html);
      }

      let detail: any = null;
      try {
        detail = await fetchSportsRC(`data=detail&category=${category}&id=${id}`);
      } catch (e: any) {
        try { detail = await fetchWestream(`/stream/${category}/${id}`); } catch { /* both failed */ }
      }

      if (!detail?.sources?.length) {
        return res.status(404).send('No streams available');
      }

      const source = detail.sources.find((s: any) => s.streamNo === streamNo) || detail.sources[0];
      const embedUrl = source?.embedUrl;
      if (!embedUrl || !validateEmbedUrl(embedUrl)) {
        return res.status(404).send('Stream not available');
      }

      const embedOrigin = new URL(embedUrl).origin;
      const embedResp = await fetch(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://sportsrc.org/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!embedResp.ok) {
        return res.status(502).send('Stream source unavailable');
      }

      let embedHtml = await embedResp.text();
      const cleanHtml = stripAdsFromHtml(embedHtml, embedOrigin);

      proxyCache.set(proxyCacheKey, { html: cleanHtml, time: Date.now() });

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      res.send(cleanHtml);
    } catch (error: any) {
      console.error("[Streaming] Proxy error:", error.message);
      res.status(502).send('Stream unavailable');
    }
  });

  app.get("/api/watch-embed/:category/:id/:streamNo", async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkEmbedRateLimit(clientIp)) {
        return res.status(429).send('Too many requests');
      }
      const category = String(req.params.category).replace(/[^a-zA-Z0-9_-]/g, '');
      const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
      const streamNo = parseInt(String(req.params.streamNo).replace(/[^0-9]/g, ''), 10) || 1;

      let detail: any = null;
      try {
        detail = await fetchSportsRC(`data=detail&category=${category}&id=${id}`);
      } catch (e: any) {
        console.warn(`[Streaming] SportsRC detail failed: ${e.message}, trying WeStream`);
        try { detail = await fetchWestream(`/stream/${category}/${id}`); } catch { /* both failed */ }
      }

      if (!detail?.sources?.length) {
        return res.status(404).send('No streams available for this match');
      }

      const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const matchTitle = escHtml(detail.title || id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()));
      const proxyUrl = `/api/stream-proxy/${category}/${id}/${streamNo}`;

      const sourceCount = detail.sources.length;
      const sourceButtons = sourceCount > 1 ? detail.sources.map((s: any) => {
        const active = s.streamNo === streamNo;
        const label = `Stream ${s.streamNo}${s.hd ? ' HD' : ''}${s.language ? ' (' + escHtml(s.language) + ')' : ''}`;
        const url = `/api/watch-embed/${category}/${id}/${s.streamNo}`;
        return `<a href="${url}" class="sb ${active ? 'active' : ''}">${label}</a>`;
      }).join('') : '';

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${matchTitle} - SuiBets Live</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;width:100%;overflow:hidden;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
#bar{position:fixed;top:0;left:0;right:0;z-index:999999;background:rgba(10,15,30,0.95);backdrop-filter:blur(12px);display:flex;align-items:center;padding:8px 16px;border-bottom:1px solid rgba(6,182,212,0.3);gap:8px;}
#bar a.bk{color:#06b6d4;text-decoration:none;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;white-space:nowrap;}
#bar a.bk:hover{color:#22d3ee;}
.mt{color:#e2e8f0;font-size:13px;font-weight:500;text-align:center;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lb{color:#06b6d4;font-size:11px;background:rgba(6,182,212,0.15);padding:3px 8px;border-radius:4px;white-space:nowrap;font-weight:600;}
#sources{position:fixed;top:44px;left:0;right:0;z-index:999998;background:rgba(10,15,30,0.9);display:flex;gap:6px;padding:6px 12px;overflow-x:auto;border-bottom:1px solid rgba(6,182,212,0.15);}
.sb{color:#94a3b8;text-decoration:none;font-size:11px;padding:4px 10px;border-radius:4px;border:1px solid rgba(148,163,184,0.2);white-space:nowrap;transition:all 0.2s;}
.sb:hover{color:#06b6d4;border-color:rgba(6,182,212,0.4);}
.sb.active{color:#fff;background:rgba(6,182,212,0.3);border-color:#06b6d4;}
#sf{position:fixed;top:${sourceCount > 1 ? '78' : '44'}px;left:0;right:0;bottom:0;width:100%;height:calc(100vh - ${sourceCount > 1 ? '78' : '44'}px);border:none;background:#000;}
.lo{position:fixed;top:${sourceCount > 1 ? '78' : '44'}px;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;z-index:10;transition:opacity 0.5s;}
.lo.h{opacity:0;pointer-events:none;}
.sp{width:40px;height:40px;border:3px solid rgba(6,182,212,0.2);border-top-color:#06b6d4;border-radius:50%;animation:spin 0.8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.lt{color:#94a3b8;font-size:14px;margin-top:16px;}
</style>
</head>
<body>
<div id="bar">
  <a class="bk" href="/streaming">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    Back
  </a>
  <span class="mt">${matchTitle}</span>
  <span class="lb">LIVE</span>
</div>
${sourceCount > 1 ? `<div id="sources">${sourceButtons}</div>` : ''}
<div class="lo" id="lo">
  <div class="sp"></div>
  <div class="lt">Loading stream...</div>
</div>
<iframe id="sf" src="${escHtml(proxyUrl)}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="no-referrer"></iframe>
<script>
var f=document.getElementById('sf'),l=document.getElementById('lo');
f.addEventListener('load',function(){setTimeout(function(){l.classList.add('h');},800);});
setTimeout(function(){l.classList.add('h');},6000);
window.open=function(){return{closed:false,close:function(){},focus:function(){}}};
</script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy',
        "default-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "frame-src 'self' blob: data:; " +
        "img-src 'self' data: blob: https:; " +
        "connect-src 'self' https:; " +
        "frame-ancestors 'self' https://*.replit.dev https://*.replit.app https://*.suibets.io https://*.suibets.com https://suibets.io https://suibets.com; " +
        "form-action 'none';"
      );
      res.send(html);
    } catch (error: any) {
      console.error("[Streaming] Watch embed error:", error.message);
      res.status(502).send('Stream unavailable');
    }
  });
  // === NFT TROPHY ENDPOINTS ===
  app.get("/api/nft/metadata/:blobId", async (req: Request, res: Response) => {
    try {
      const { blobId } = req.params;
      if (!blobId || blobId.length > 200 || !/^[a-zA-Z0-9_\-]+$/.test(blobId)) {
        return res.status(400).json({ error: 'Invalid blobId' });
      }

      const { db } = await import('./db');
      const { bets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const rows = await db.select().from(bets).where(eq(bets.walrusBlobId, blobId)).limit(1);
      const bet = rows[0];

      const isWinner = bet && (bet.status === 'won' || bet.status === 'paid_out');
      const eventName = bet?.eventName || 'SuiBets Bet';
      const prediction = bet?.prediction || '';
      const odds = bet?.odds ? Number(bet.odds).toFixed(2) : '1.00';
      const payout = bet?.payout ? Number(bet.payout).toFixed(4) : '0';
      const currency = bet?.currency || 'SUI';
      const sportName = bet?.sportName || 'Sports';
      const settledAt = bet?.settledAt || null;

      const tierLabel = (() => {
        const p = Number(payout);
        if (p >= 1000) return 'Legendary';
        if (p >= 100) return 'Epic';
        if (p >= 10) return 'Rare';
        return 'Common';
      })();

      const tierColor = (() => {
        switch (tierLabel) {
          case 'Legendary': return '#ff6b35';
          case 'Epic': return '#a855f7';
          case 'Rare': return '#06b6d4';
          default: return '#10b981';
        }
      })();

      const metadata = {
        name: `SuiBets Trophy — ${eventName.length > 40 ? eventName.slice(0, 40) + '...' : eventName}`,
        description: `Proof of Conviction: Won ${payout} ${currency} betting on "${prediction}" at ${odds}x odds. This trophy is permanently verifiable via Walrus blob ${blobId}. Minted on Sui.`,
        image_url: `${req.protocol}://${req.get('host')}/api/nft/image/${blobId}`,
        external_url: `${req.protocol}://${req.get('host')}/walrus-receipt/${blobId}`,
        attributes: [
          { trait_type: 'Sport', value: sportName },
          { trait_type: 'Event', value: eventName },
          { trait_type: 'Prediction', value: prediction },
          { trait_type: 'Odds', value: `${odds}x` },
          { trait_type: 'Payout', value: `${payout} ${currency}` },
          { trait_type: 'Currency', value: currency },
          { trait_type: 'Result', value: isWinner ? 'Winner' : (bet?.result || 'Pending') },
          { trait_type: 'Tier', value: tierLabel },
          { trait_type: 'Walrus Blob ID', value: blobId },
          ...(settledAt ? [{ trait_type: 'Settled', value: new Date(settledAt).toISOString() }] : []),
          { trait_type: 'Platform', value: 'SuiBets' },
          { trait_type: 'Chain', value: 'Sui Mainnet' },
        ],
        properties: {
          category: 'bet_trophy',
          tier: tierLabel,
          tier_color: tierColor,
          walrus_blob_id: blobId,
          walrus_url: `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`,
          receipt_url: `${req.protocol}://${req.get('host')}/walrus-receipt/${blobId}`,
        },
      };

      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json(metadata);
    } catch (error: any) {
      console.error('[NFT] Metadata error:', error.message);
      res.status(500).json({ error: 'Failed to generate NFT metadata' });
    }
  });

  app.get("/api/nft/image/:blobId", async (_req: Request, res: Response) => {
    try {
      const { blobId } = _req.params;
      if (!blobId || blobId.length > 200 || !/^[a-zA-Z0-9_\-]+$/.test(blobId)) {
        return res.status(400).send('Invalid blobId');
      }

      const { db } = await import('./db');
      const { bets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const rows = await db.select().from(bets).where(eq(bets.walrusBlobId, blobId)).limit(1);
      const bet = rows[0];

      const eventName = bet?.eventName || 'SuiBets Bet';
      const prediction = bet?.prediction || '—';
      const odds = bet?.odds ? Number(bet.odds).toFixed(2) + 'x' : '—';
      const payout = bet?.payout ? Number(bet.payout).toFixed(2) : '0';
      const currency = bet?.currency || 'SUI';
      const isWinner = bet && (bet.status === 'won' || bet.status === 'paid_out');
      const sportName = bet?.sportName || 'Sports';

      const tierLabel = (() => {
        const p = Number(payout);
        if (p >= 1000) return 'LEGENDARY';
        if (p >= 100) return 'EPIC';
        if (p >= 10) return 'RARE';
        return 'COMMON';
      })();

      const tierGradient = (() => {
        switch (tierLabel) {
          case 'LEGENDARY': return { start: '#ff6b35', end: '#ff4500', bg1: '#2a1508', bg2: '#1a0e05' };
          case 'EPIC': return { start: '#a855f7', end: '#7c3aed', bg1: '#1a0a2e', bg2: '#100620' };
          case 'RARE': return { start: '#06b6d4', end: '#0891b2', bg1: '#061a22', bg2: '#040f16' };
          default: return { start: '#10b981', end: '#059669', bg1: '#061a12', bg2: '#040f0a' };
        }
      })();

      const xmlEsc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const truncate = (s: string, n: number) => xmlEsc(s.length > n ? s.slice(0, n) + '...' : s);

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${tierGradient.bg1}"/>
      <stop offset="100%" stop-color="${tierGradient.bg2}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${tierGradient.start}"/>
      <stop offset="100%" stop-color="${tierGradient.end}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#b45309"/>
      <stop offset="30%" stop-color="#d97706"/>
      <stop offset="50%" stop-color="#fbbf24"/>
      <stop offset="70%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="600" height="800" rx="24" fill="url(#bg)"/>
  <rect x="1" y="1" width="598" height="798" rx="23" fill="none" stroke="url(#accent)" stroke-width="2" opacity="0.5"/>
  <rect x="20" y="20" width="560" height="760" rx="16" fill="none" stroke="url(#accent)" stroke-width="0.5" opacity="0.15"/>

  <!-- Header -->
  <text x="300" y="60" text-anchor="middle" fill="#ffffff" font-family="system-ui,sans-serif" font-size="14" font-weight="600" letter-spacing="4" opacity="0.5">SUIBETS</text>

  <!-- Trophy icon area -->
  <circle cx="300" cy="180" r="70" fill="url(#accent)" opacity="0.08"/>
  <circle cx="300" cy="180" r="50" fill="url(#gold)" filter="url(#glow)"/>
  <text x="300" y="195" text-anchor="middle" font-size="36">🏆</text>

  <!-- Tier badge -->
  <rect x="225" y="250" width="150" height="28" rx="14" fill="url(#accent)" opacity="0.2"/>
  <rect x="225" y="250" width="150" height="28" rx="14" fill="none" stroke="url(#accent)" stroke-width="1" opacity="0.5"/>
  <text x="300" y="269" text-anchor="middle" fill="${tierGradient.start}" font-family="system-ui,sans-serif" font-size="11" font-weight="800" letter-spacing="3">${tierLabel}</text>

  <!-- Win badge -->
  <text x="300" y="310" text-anchor="middle" fill="${isWinner ? '#10b981' : '#ef4444'}" font-family="system-ui,sans-serif" font-size="20" font-weight="900" letter-spacing="2">${isWinner ? '✓ WINNER' : '✗ LOST'}</text>

  <!-- Divider -->
  <line x1="80" y1="340" x2="520" y2="340" stroke="url(#accent)" stroke-width="0.5" opacity="0.2"/>

  <!-- Event name -->
  <text x="300" y="375" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11" letter-spacing="2">${xmlEsc(sportName.toUpperCase())}</text>
  <text x="300" y="405" text-anchor="middle" fill="#ffffff" font-family="system-ui,sans-serif" font-size="18" font-weight="700">${truncate(eventName, 35)}</text>

  <!-- Prediction -->
  <text x="300" y="445" text-anchor="middle" fill="${tierGradient.start}" font-family="system-ui,sans-serif" font-size="15" font-weight="600">${truncate(prediction, 30)}</text>

  <!-- Stats boxes -->
  <rect x="50" y="480" width="230" height="80" rx="12" fill="${tierGradient.start}" fill-opacity="0.06" stroke="${tierGradient.start}" stroke-width="0.5" stroke-opacity="0.2"/>
  <text x="165" y="510" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="10" letter-spacing="1.5">PAYOUT</text>
  <text x="165" y="542" text-anchor="middle" fill="#10b981" font-family="system-ui,sans-serif" font-size="26" font-weight="900">${xmlEsc(payout)} ${xmlEsc(currency)}</text>

  <rect x="320" y="480" width="230" height="80" rx="12" fill="${tierGradient.start}" fill-opacity="0.06" stroke="${tierGradient.start}" stroke-width="0.5" stroke-opacity="0.2"/>
  <text x="435" y="510" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="10" letter-spacing="1.5">ODDS</text>
  <text x="435" y="542" text-anchor="middle" fill="#06b6d4" font-family="system-ui,sans-serif" font-size="26" font-weight="900">${xmlEsc(odds)}</text>

  <!-- Divider -->
  <line x1="80" y1="590" x2="520" y2="590" stroke="url(#accent)" stroke-width="0.5" opacity="0.15"/>

  <!-- Walrus verification -->
  <text x="300" y="625" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="10" letter-spacing="1.5">VERIFIED ON WALRUS</text>
  <text x="300" y="650" text-anchor="middle" fill="#a78bfa" font-family="monospace" font-size="10" opacity="0.6">${blobId ? xmlEsc(blobId.slice(0, 20) + '...' + blobId.slice(-8)) : '—'}</text>

  <!-- Footer -->
  <text x="300" y="710" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="10" opacity="0.4">Proof of Conviction • Sui Mainnet</text>
  <text x="300" y="730" text-anchor="middle" fill="${tierGradient.start}" font-family="system-ui,sans-serif" font-size="11" font-weight="600" opacity="0.5">suibets.com</text>

  <!-- Chain badge -->
  <rect x="240" y="745" width="120" height="22" rx="11" fill="url(#accent)" opacity="0.08"/>
  <text x="300" y="760" text-anchor="middle" fill="${tierGradient.start}" font-family="system-ui,sans-serif" font-size="9" font-weight="600" opacity="0.6" letter-spacing="1.5">SUI • WALRUS</text>
</svg>`;

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(svg);
    } catch (error: any) {
      console.error('[NFT] Image generation error:', error.message);
      res.status(500).send('Failed to generate NFT image');
    }
  });

  const signMintRateLimit = new Map<string, { count: number; resetAt: number }>();

  function canonicalSuiAddress(addr: string): string {
    const hex = addr.toLowerCase().replace(/^0x/, '');
    return '0x' + hex.padStart(64, '0');
  }

  app.post("/api/nft/sign-mint", async (req: Request, res: Response) => {
    try {
      const { blobId, walletAddress } = req.body;
      if (!blobId || !walletAddress) {
        return res.status(400).json({ success: false, message: 'Missing required fields: blobId, walletAddress' });
      }

      if (typeof blobId !== 'string' || blobId.length > 256 || !/^[a-zA-Z0-9_\-]+$/.test(blobId)) {
        return res.status(400).json({ success: false, message: 'Invalid blobId format' });
      }
      if (typeof walletAddress !== 'string' || !/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
        return res.status(400).json({ success: false, message: 'Invalid wallet address format' });
      }

      const canonicalWallet = canonicalSuiAddress(walletAddress);

      const now = Date.now();
      const ipKey = req.ip || 'unknown';
      const rateEntry = signMintRateLimit.get(ipKey);
      if (rateEntry && now < rateEntry.resetAt) {
        if (rateEntry.count >= 10) {
          return res.status(429).json({ success: false, message: 'Too many mint requests. Try again later.' });
        }
        rateEntry.count++;
      } else {
        signMintRateLimit.set(ipKey, { count: 1, resetAt: now + 60000 });
      }

      const { db } = await import('./db');
      const { bets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const rows = await db.select().from(bets).where(eq(bets.walrusBlobId, blobId)).limit(1);
      const bet = rows[0];

      if (!bet) {
        return res.status(404).json({ success: false, message: 'Bet not found for this blob ID' });
      }

      if (bet.status !== 'won' && bet.status !== 'paid_out') {
        return res.status(403).json({ success: false, message: 'Only winning bets can be minted as NFT trophies' });
      }

      const dbCanonicalWallet = bet.walletAddress ? canonicalSuiAddress(bet.walletAddress) : '';
      if (dbCanonicalWallet !== canonicalWallet) {
        return res.status(403).json({ success: false, message: 'Only the bet owner can mint the NFT trophy' });
      }

      if (bet.nftMintTx && bet.nftMintTx !== 'pending') {
        return res.status(409).json({ success: false, message: 'This trophy has already been minted as an NFT.' });
      }

      const { oracleSigningService } = await import('./services/oracleSigningService');
      const payoutStr = String(Number(bet.actualPayout || bet.potentialPayout || 0).toFixed(4)).slice(0, 64);
      const currencyStr = (bet.currency || 'SUI').toUpperCase().slice(0, 32);
      const rawName = bet.eventName || bet.prediction || 'Winning Bet';
      const nameStr = rawName.length > 256 ? rawName.slice(0, 253) + '...' : rawName;
      const rawPrediction = bet.prediction || '';
      const predictionStr = rawPrediction.length > 256 ? rawPrediction.slice(0, 253) + '...' : rawPrediction;
      const oddsStr = String(Number(bet.odds || 1).toFixed(2)).slice(0, 32);

      const result = await oracleSigningService.signNftMint(canonicalWallet, blobId, payoutStr, currencyStr);
      if (!result) {
        return res.status(500).json({ success: false, message: 'Oracle signing service unavailable' });
      }

      console.log(`[NFT] Signed mint for wallet ${canonicalWallet.slice(0, 14)}... blob ${blobId.slice(0, 10)}...`);

      res.json({
        success: true,
        signature: result.signature,
        payout: payoutStr,
        currency: currencyStr,
        name: nameStr,
        prediction: predictionStr,
        odds: oddsStr,
      });
    } catch (error: any) {
      console.error('[NFT] Sign-mint error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to sign NFT mint' });
    }
  });

  app.post("/api/nft/confirm-mint", async (req: Request, res: Response) => {
    try {
      const { blobId, txHash, walletAddress } = req.body;
      if (!blobId || !txHash || !walletAddress || typeof blobId !== 'string' || typeof txHash !== 'string' || typeof walletAddress !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing blobId, txHash, or walletAddress' });
      }

      if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
        return res.status(400).json({ success: false, message: 'Invalid wallet address' });
      }
      if (!/^[a-zA-Z0-9]{32,128}$/.test(txHash)) {
        return res.status(400).json({ success: false, message: 'Invalid transaction hash' });
      }

      const { db } = await import('./db');
      const { bets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const rows = await db.select().from(bets).where(eq(bets.walrusBlobId, blobId)).limit(1);
      const bet = rows[0];
      if (!bet) {
        return res.status(404).json({ success: false, message: 'Bet not found' });
      }

      const canonicalCaller = canonicalSuiAddress(walletAddress);
      const canonicalOwner = bet.walletAddress ? canonicalSuiAddress(bet.walletAddress) : '';
      if (canonicalCaller !== canonicalOwner) {
        return res.status(403).json({ success: false, message: 'Only the bet owner can confirm the mint' });
      }

      if (bet.nftMintTx && bet.nftMintTx !== 'pending') {
        return res.status(409).json({ success: false, message: 'Mint already confirmed' });
      }

      await db.update(bets).set({ nftMintTx: txHash }).where(eq(bets.walrusBlobId, blobId));
      console.log(`[NFT] Confirmed mint: blob ${blobId.slice(0, 10)}... tx ${txHash.slice(0, 12)}...`);

      res.json({ success: true });
    } catch (error: any) {
      console.error('[NFT] Confirm-mint error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to confirm mint' });
    }
  });

  const nftRegistrations = new Map<string, { walletAddress: string; registeredAt: number }>();

  app.post("/api/nft/register", async (req: Request, res: Response) => {
    try {
      const { blobId, walletAddress } = req.body;
      if (!blobId || !walletAddress) {
        return res.status(400).json({ success: false, message: 'Missing blobId or walletAddress' });
      }

      if (typeof blobId !== 'string' || blobId.length > 200 || !/^[a-zA-Z0-9_\-]+$/.test(blobId)) {
        return res.status(400).json({ success: false, message: 'Invalid blobId format' });
      }

      if (typeof walletAddress !== 'string' || !walletAddress.startsWith('0x') || walletAddress.length < 10) {
        return res.status(400).json({ success: false, message: 'Invalid wallet address format' });
      }

      if (nftRegistrations.has(blobId)) {
        const existing = nftRegistrations.get(blobId)!;
        return res.json({
          success: true,
          registrationId: `trophy_${blobId}`,
          alreadyRegistered: true,
          message: 'Trophy already registered for this bet',
        });
      }

      const { db } = await import('./db');
      const { bets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const rows = await db.select().from(bets).where(eq(bets.walrusBlobId, blobId)).limit(1);
      const bet = rows[0];

      if (!bet) {
        return res.status(404).json({ success: false, message: 'Bet not found for this blob ID' });
      }

      if (bet.status !== 'won' && bet.status !== 'paid_out') {
        return res.status(403).json({ success: false, message: 'Only winning bets can be registered as NFT trophies' });
      }

      if (bet.walletAddress !== walletAddress) {
        return res.status(403).json({ success: false, message: 'Only the bet owner can register the NFT trophy' });
      }

      const registrationId = `trophy_${blobId}`;
      nftRegistrations.set(blobId, { walletAddress, registeredAt: Date.now() });

      console.log(`[NFT] Trophy registered: ${registrationId} for wallet ${walletAddress.slice(0, 10)}...`);

      res.json({
        success: true,
        registrationId,
        metadata: {
          name: `SuiBets Trophy — ${(bet.eventName || '').slice(0, 40)}`,
          blobId,
          sport: bet.sportName,
          metadataUrl: `${req.protocol}://${req.get('host')}/api/nft/metadata/${blobId}`,
          imageUrl: `${req.protocol}://${req.get('host')}/api/nft/image/${blobId}`,
        },
      });
    } catch (error: any) {
      console.error('[NFT] Registration error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to register NFT trophy' });
    }
  });

  // === WALRUS DECENTRALIZED STORAGE ENDPOINTS ===
  app.get("/api/walrus/receipt/:blobId", async (req: Request, res: Response) => {
    try {
      const { blobId } = req.params;
      if (!blobId) {
        return res.status(400).json({ message: "Missing blobId" });
      }

      let receipt: any = null;
      let source = 'walrus';

      if (blobId.startsWith('local_')) {
        const { bets: betsTable } = await import('@shared/schema');
        const { db: receiptDb } = await import('./db');
        const { eq: receiptEq } = await import('drizzle-orm');
        const rows = await receiptDb.select({ walrusReceiptData: betsTable.walrusReceiptData })
          .from(betsTable)
          .where(receiptEq(betsTable.walrusBlobId, blobId))
          .limit(1);
        if (rows.length > 0 && rows[0].walrusReceiptData) {
          receipt = JSON.parse(rows[0].walrusReceiptData);
          source = 'local';
        }
      } else {
        // For real Walrus blobs: first try to get the enriched version from our DB
        // (it has epoch/cost metadata that was added post-storage)
        try {
          const { bets: betsTable } = await import('@shared/schema');
          const { db: receiptDb } = await import('./db');
          const { eq: receiptEq } = await import('drizzle-orm');
          const rows = await receiptDb.select({ walrusReceiptData: betsTable.walrusReceiptData })
            .from(betsTable)
            .where(receiptEq(betsTable.walrusBlobId, blobId))
            .limit(1);
          if (rows.length > 0 && rows[0].walrusReceiptData) {
            receipt = JSON.parse(rows[0].walrusReceiptData);
            source = 'walrus'; // still show as Walrus since it's a real blob
          }
        } catch {}
        // Fallback: fetch directly from Walrus aggregator
        if (!receipt) {
          const { getBetReceipt } = await import('./services/walrusStorageService');
          receipt = await getBetReceipt(blobId);
        }
      }

      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found" });
      }

      try {
        const { bets: betsTable } = await import('@shared/schema');
        const { db: liveDb } = await import('./db');
        const { eq: liveEq } = await import('drizzle-orm');
        const liveRows = await liveDb.select({
          status: betsTable.status,
          payout: betsTable.payout,
          result: betsTable.result,
          settledAt: betsTable.settledAt,
          settlementTxHash: betsTable.settlementTxHash,
        })
          .from(betsTable)
          .where(liveEq(betsTable.walrusBlobId, blobId))
          .limit(1);
        if (liveRows.length > 0) {
          const liveBet = liveRows[0];
          const receiptData = receipt.receipt || receipt;
          const betData = receiptData.bet || receiptData;
          if (liveBet.status) {
            betData.status = liveBet.status;
          }
          if (liveBet.result) {
            betData.result = liveBet.result;
          }
          if (liveBet.payout) {
            betData.actualPayout = liveBet.payout;
          }
          if (liveBet.settledAt) {
            betData.settledAt = liveBet.settledAt;
          }
          if (liveBet.settlementTxHash) {
            if (!receiptData.blockchain) receiptData.blockchain = {};
            receiptData.blockchain.settlementTxHash = liveBet.settlementTxHash;
          }
        }
      } catch (liveErr: any) {
        // Non-critical — receipt still displays with stored status
      }

      if (req.accepts('html') && !req.query.json) {
        const bet = receipt.bet || receipt;
        const blockchain = receipt.blockchain || {};
        const storage = receipt.storage || {};
        const esc = (s: any) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        const epochStart = storage.storageEpoch ?? null;
        const epochEnd = storage.endEpoch ?? null;
        const walCostRaw = storage.walCost ?? null;
        const walCostDisplay = walCostRaw ? (walCostRaw / 1_000_000_000).toFixed(6) + ' WAL' : null;
        const publisherDisplay = storage.publisherUsed
          ? (storage.publisherUsed.includes('staketab') ? 'StakeTab' : storage.publisherUsed.includes('nami') ? 'Nami Cloud' : storage.publisherUsed.replace('/v1/blobs','').replace('https://',''))
          : null;
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SuiBets — Bet Receipt</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--cyan:#06b6d4;--purple:#8b5cf6;--amber:#f59e0b;--green:#10b981;--red:#ef4444;--bg:#0a0e1a;--surface:#111827;--surface2:#1a2035;--border:rgba(6,182,212,0.2);--text:#e5e7eb;--muted:#6b7280;--muted2:#9ca3af}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px 16px 40px}
.receipt{max-width:500px;width:100%;background:var(--surface);border:1px solid var(--cyan);border-radius:20px;overflow:hidden;box-shadow:0 0 60px rgba(6,182,212,0.12),0 0 120px rgba(139,92,246,0.06)}
/* Header */
.hdr{background:linear-gradient(135deg,#0891b2 0%,#7c3aed 100%);padding:28px 24px 22px;text-align:center;position:relative}
.hdr::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)}
.hdr-logo{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:6px}
.hdr-logo .whale{font-size:28px}
.hdr-logo h1{font-size:32px;font-weight:900;color:#fff;letter-spacing:1px;text-shadow:0 2px 8px rgba(0,0,0,0.3)}
.hdr-sub{color:rgba(255,255,255,0.75);font-size:13px;margin-bottom:10px}
.hdr-badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px}
.badge-walrus{background:rgba(255,255,255,0.18);color:#fff;border:1px solid rgba(255,255,255,0.25)}
.badge-ok{background:rgba(16,185,129,0.25);color:#6ee7b7;border:1px solid rgba(16,185,129,0.4)}
.badge-local{background:rgba(107,114,128,0.25);color:#d1d5db;border:1px solid rgba(107,114,128,0.4)}
/* Body */
.body{padding:24px}
/* Event block */
.event-card{background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.18);border-radius:14px;padding:18px;margin-bottom:16px;text-align:center}
.sport-tag{display:inline-block;background:rgba(6,182,212,0.15);color:var(--cyan);padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px}
.event-name{color:#fff;font-size:17px;font-weight:700;line-height:1.3}
.matchup{color:var(--muted2);font-size:13px;margin-top:5px}
/* Prediction block */
.prediction-card{background:linear-gradient(135deg,rgba(139,92,246,0.12),rgba(6,182,212,0.12));border:1px solid rgba(139,92,246,0.25);border-radius:14px;padding:18px;margin-bottom:16px;text-align:center}
.pred-label{color:var(--muted2);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.pred-val{color:var(--purple);font-size:24px;font-weight:900}
.pred-market{color:var(--muted);font-size:12px;margin-top:4px}
/* Stats grid */
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.stat{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px 10px;text-align:center}
.stat-label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
.stat-val{font-size:16px;font-weight:800}
.c-cyan{color:var(--cyan)}.c-amber{color:var(--amber)}.c-green{color:var(--green)}.c-purple{color:var(--purple)}
/* Chain details */
.details-section{margin-top:4px}
.details-title{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06)}
.row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04)}
.row:last-child{border-bottom:none}
.row-k{color:var(--muted)}
.row-v{color:var(--muted2);font-family:monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.row-v a{color:var(--cyan);text-decoration:none}.row-v a:hover{text-decoration:underline}
/* Walrus section */
.walrus-section{background:linear-gradient(135deg,rgba(6,182,212,0.06),rgba(139,92,246,0.06));border:1px solid rgba(6,182,212,0.2);border-radius:14px;padding:16px;margin-top:16px}
.walrus-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.walrus-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--cyan)}
.walrus-blob{background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.15);border-radius:8px;padding:8px 12px;margin-bottom:10px}
.walrus-blob-label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
.walrus-blob-id{color:var(--cyan);font-family:monospace;font-size:11px;word-break:break-all;line-height:1.5}
.walrus-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.walrus-meta{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;text-align:center}
.wm-label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px}
.wm-val{font-size:13px;font-weight:700}
.walrus-links{display:flex;gap:8px;margin-top:10px}
.walrus-link{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:8px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;transition:opacity 0.2s}
.walrus-link:hover{opacity:0.8}
.wl-raw{background:rgba(139,92,246,0.15);color:#c4b5fd;border:1px solid rgba(139,92,246,0.3)}
/* Verification */
.verified{display:inline-flex;align-items:center;gap:6px;color:var(--green);font-size:12px;font-weight:600;margin-top:14px;padding:6px 12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px}
/* Footer */
.footer{background:rgba(6,182,212,0.04);border-top:1px solid rgba(6,182,212,0.12);padding:18px 24px;text-align:center}
.footer-logo{font-size:14px;font-weight:800;color:var(--cyan);margin-bottom:4px}
.footer-links{color:var(--muted);font-size:11px}
.footer-links a{color:var(--cyan);text-decoration:none}
.footer-links a:hover{text-decoration:underline}
.footer-copy{color:var(--muted);font-size:10px;margin-top:4px}
</style>
</head>
<body>
<div class="receipt">

<!-- Header -->
<div class="hdr">
  <div class="hdr-logo">
    <span class="whale">🐋</span>
    <h1>SuiBets</h1>
  </div>
  <div class="hdr-sub">Decentralized Sports Betting · Sui Blockchain</div>
  <div class="hdr-badges">
    ${source === 'walrus'
      ? '<span class="badge badge-walrus">🐋 Walrus Mainnet</span><span class="badge badge-ok">✓ Verified On-Chain</span>'
      : '<span class="badge badge-local">📋 Local Receipt</span>'}
  </div>
</div>

<!-- Body -->
<div class="body">

  <!-- Event -->
  <div class="event-card">
    ${bet.sportName ? `<div class="sport-tag">${esc(bet.sportName)}</div>` : ''}
    <div class="event-name">${esc(bet.eventName || 'Sports Event')}</div>
    ${bet.homeTeam && bet.awayTeam ? `<div class="matchup">${esc(bet.homeTeam)} <span style="color:var(--muted)">vs</span> ${esc(bet.awayTeam)}</div>` : ''}
  </div>

  <!-- Prediction -->
  <div class="prediction-card">
    <div class="pred-label">Your Prediction</div>
    <div class="pred-val">${esc(bet.prediction || bet.selection || '—')}</div>
    ${bet.marketType ? `<div class="pred-market">${esc(bet.marketType)}</div>` : ''}
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat">
      <div class="stat-label">Stake</div>
      <div class="stat-val c-cyan">${esc(bet.stake || bet.betAmount || 0)} <span style="font-size:11px">${esc(bet.currency || 'SUI')}</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Odds</div>
      <div class="stat-val c-amber">${esc(bet.odds || '—')}×</div>
    </div>
    <div class="stat">
      <div class="stat-label">Potential Win</div>
      <div class="stat-val c-green">${esc(bet.potentialPayout || bet.potentialWin || '—')} <span style="font-size:11px">${esc(bet.currency || 'SUI')}</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Token</div>
      <div class="stat-val c-purple">${esc(bet.currency || 'SUI')}</div>
    </div>
  </div>

  <!-- Details -->
  <div class="details-section">
    <div class="details-title">Transaction Details</div>
    <div class="row"><span class="row-k">Bet ID</span><span class="row-v">${esc(bet.id || bet.betId || '—')}</span></div>
    <div class="row"><span class="row-k">Wallet</span><span class="row-v">${esc(bet.walletAddress || '—')}</span></div>
    <div class="row"><span class="row-k">Network</span><span class="row-v">${esc(blockchain.chain || 'sui:mainnet')}</span></div>
    ${(bet.txHash || blockchain.txHash) ? `<div class="row"><span class="row-k">TX Hash</span><span class="row-v"><a href="https://suiscan.xyz/mainnet/tx/${esc(bet.txHash || blockchain.txHash)}" target="_blank">${esc((bet.txHash || blockchain.txHash || '').slice(0, 22))}…</a></span></div>` : ''}
    ${(bet.betObjectId || blockchain.betObjectId) ? `<div class="row"><span class="row-k">Bet Object</span><span class="row-v"><a href="https://suiscan.xyz/mainnet/object/${esc(bet.betObjectId || blockchain.betObjectId)}" target="_blank">${esc((bet.betObjectId || blockchain.betObjectId || '').slice(0, 22))}…</a></span></div>` : ''}
    <div class="row"><span class="row-k">Placed At</span><span class="row-v">${esc(new Date(bet.placedAt || storage.storedAt || Date.now()).toLocaleString())}</span></div>
  </div>

  <!-- Walrus Storage Section -->
  ${source === 'walrus' ? `
  <div class="walrus-section">
    <div class="walrus-header">
      <div class="walrus-title">🐋 Walrus Decentralized Storage</div>
      <span class="badge badge-ok" style="font-size:10px">Mainnet</span>
    </div>
    <div class="walrus-blob">
      <div class="walrus-blob-label">Blob ID (permanent)</div>
      <div class="walrus-blob-id">${esc(blobId)}</div>
    </div>
    ${(epochStart != null || epochEnd != null || walCostDisplay || publisherDisplay) ? `
    <div class="walrus-meta-grid">
      ${epochStart != null ? `<div class="walrus-meta"><div class="wm-label">Start Epoch</div><div class="wm-val c-cyan">${esc(epochStart)}</div></div>` : ''}
      ${epochEnd != null ? `<div class="walrus-meta"><div class="wm-label">End Epoch</div><div class="wm-val c-cyan">${esc(epochEnd)}</div></div>` : ''}
      ${walCostDisplay ? `<div class="walrus-meta"><div class="wm-label">WAL Cost</div><div class="wm-val c-amber">${esc(walCostDisplay)}</div></div>` : ''}
      ${publisherDisplay ? `<div class="walrus-meta"><div class="wm-label">Publisher</div><div class="wm-val" style="font-size:11px;color:var(--muted2)">${esc(publisherDisplay)}</div></div>` : ''}
      <div class="walrus-meta"><div class="wm-label">Store Duration</div><div class="wm-val c-purple">${esc(storage.storeEpochs || 10)} epochs</div></div>
    </div>` : ''}
    <div class="walrus-links">
      <a href="https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${esc(blobId)}" target="_blank" class="walrus-link wl-raw">
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/></svg>
        Raw JSON on Walrus
      </a>
    </div>
  </div>
  ` : `
  <div class="walrus-section" style="border-color:rgba(107,114,128,0.3)">
    <div class="walrus-title" style="color:var(--muted2)">📋 Local Storage</div>
    <div style="color:var(--muted);font-size:12px;margin-top:8px">This receipt is stored in the SuiBets database. Walrus publishers were unavailable at the time of placement.</div>
  </div>
  `}

  ${receipt.verification ? `<div class="verified"><svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/></svg>Receipt integrity verified · SHA-256</div>` : ''}

</div><!-- /body -->

<!-- Footer -->
<div class="footer">
  <div class="footer-logo">SuiBets</div>
  <div class="footer-links">
    <a href="https://www.suibets.com" target="_blank">suibets.com</a>
    &nbsp;·&nbsp;
    <a href="https://suibets.wal.app" target="_blank">suibets.wal.app</a>
  </div>
  <div class="footer-copy">© ${new Date().getFullYear()} SuiBets · Built on Sui Blockchain · Powered by Walrus</div>
</div>

</div><!-- /receipt -->
</body></html>`;
        return res.type('html').send(html);
      }

      // Normalize any legacy flat-format receipts to the standard nested structure
      const normalizeReceiptFormat = (r: any): any => {
        if (r && typeof r.bet === 'object' && r.bet !== null) return r; // already correct
        // Old/backfilled flat format → convert to nested
        return {
          platform: r.platform || 'SuiBets',
          version: '2.0',
          type: r.type || 'bet_receipt',
          bet: {
            id: r.betId || r.id || null,
            walletAddress: r.wallet || r.walletAddress || null,
            eventName: r.eventName || null,
            homeTeam: r.homeTeam || null,
            awayTeam: r.awayTeam || null,
            prediction: r.prediction || null,
            odds: r.odds ?? null,
            stake: r.stake ?? r.betAmount ?? null,
            currency: r.currency || 'SBETS',
            potentialPayout: r.potentialPayout ?? null,
            sportName: r.sportName || null,
            marketType: r.marketType || null,
            status: r.status || 'pending',
            result: r.result || null,
            actualPayout: r.actualPayout ?? null,
            settledAt: r.settledAt || null,
          },
          blockchain: r.blockchain || {
            chain: 'sui:mainnet',
            network: 'mainnet',
            txHash: r.txHash || null,
            betObjectId: r.betObjectId || null,
            settlementTxHash: r.settlementTxHash || null,
          },
          storage: {
            ...(r.storage || {}),
            placedAt: r.placedAt || r.storage?.placedAt || null,
            storedAt: r.storedAt || r.storage?.storedAt || null,
          },
          verification: r.verification || {},
        };
      };
      receipt = normalizeReceiptFormat(receipt);

      const { getWalrusAggregatorUrl } = await import('./services/walrusStorageService');
      res.json({ 
        receipt, 
        source, 
        verified: true,
        ...(source === 'walrus' ? { aggregatorUrl: getWalrusAggregatorUrl(blobId) } : {})
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch receipt" });
    }
  });

  // ── Walrus Sites Programmatic Deploy ───────────────────────────────────────
  const { deployToWalrusSites, getDeployStatus } = await import('./services/walrusSitesDeployService');

  app.post("/api/admin/deploy-walrus-site", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const currentStatus = getDeployStatus();
      if (currentStatus.status === 'building' || currentStatus.status === 'uploading' || currentStatus.status === 'updating') {
        return res.status(409).json({ message: "Deploy already in progress", status: currentStatus });
      }
      deployToWalrusSites().catch(err => {
        console.error('[WalrusDeploy] Background deploy error:', err.message);
      });
      res.json({ message: "Walrus Sites deploy started", status: getDeployStatus() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/deploy-walrus-status", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      res.json({ status: getDeployStatus() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Publisher health check — tests all configured publishers live
  app.get("/api/admin/walrus-publisher-health", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { checkPublisherHealth } = await import('./services/walrusStorageService');
      console.log('[Walrus] Running publisher health check...');
      const results = await checkPublisherHealth();
      const working = Object.entries(results).filter(([, v]) => v.status.startsWith('✅')).length;
      res.json({
        summary: `${working}/${Object.keys(results).length} publishers working`,
        publishers: results,
        checkedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ message: "Health check failed" });
    }
  });

  // Test Walrus storage with a real receipt — verifies the full store + retrieve cycle
  app.post("/api/admin/walrus-test-store", async (req: Request, res: Response) => {
    try {
      if (!(await validateAdminAuth(req))) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { storeBetReceipt, getBetReceipt } = await import('./services/walrusStorageService');
      const testData = {
        betId: `test_${Date.now()}`,
        walletAddress: '0xtest',
        eventId: 'test_event',
        eventName: 'SuiBets Publisher Test',
        homeTeam: 'Team A',
        awayTeam: 'Team B',
        prediction: 'home',
        odds: 1.95,
        stake: 1,
        currency: 'SUI',
        potentialPayout: 1.95,
        placedAt: Date.now(),
      };
      const stored = await storeBetReceipt(testData);
      if (!stored.blobId || stored.blobId.startsWith('local_')) {
        return res.status(503).json({
          success: false,
          message: 'All publishers unreachable — receipt fell back to local storage',
          error: stored.error,
        });
      }
      // Attempt to verify retrieval
      let retrieved = false;
      try {
        await new Promise(r => setTimeout(r, 3000)); // brief wait for certification
        const receipt = await getBetReceipt(stored.blobId);
        retrieved = !!receipt;
      } catch {}
      res.json({
        success: true,
        blobId: stored.blobId,
        publisherUsed: stored.publisherUsed,
        retrieved,
        aggregatorUrl: `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${stored.blobId}`,
      });
    } catch (error: any) {
      console.error('Walrus test store error:', error);
      res.status(500).json({ success: false, message: 'Walrus storage test failed' });
    }
  });

  // ─── Bluefin Mainnet Proxy Routes (DISABLED — re-enable when new pool is added) ───
  // All /api/bluefin/* endpoints temporarily return 503
  const bluefinDisabledMsg = { error: 'Bluefin integration temporarily disabled', code: 'DISABLED' };
  app.get('/api/bluefin/tickers', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/orderbook', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/recent-trades', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/funding-rate', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/markets', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/account', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/orders', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/user-trades', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/funding-history', (_req, res) => res.status(503).json(bluefinDisabledMsg));
  app.get('/api/bluefin/tx-history', (_req, res) => res.status(503).json(bluefinDisabledMsg));

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/prices — CoinGecko proxy for BTC/ETH/SUI with 60s in-memory cache
   */
  let pricesCache: { data: any; ts: number } | null = null;
  app.get('/api/prices', async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (pricesCache && now - pricesCache.ts < 60_000) {
        return res.json(pricesCache.data);
      }
      const cgRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,sui&vs_currencies=usd&include_24hr_change=true',
        { headers: { Accept: 'application/json' } }
      );
      if (!cgRes.ok) throw new Error(`CoinGecko ${cgRes.status}`);
      const raw: any = await cgRes.json();
      const data = {
        BTC: { price: raw.bitcoin?.usd ?? 0, change24h: raw.bitcoin?.usd_24h_change ?? 0 },
        ETH: { price: raw.ethereum?.usd ?? 0, change24h: raw.ethereum?.usd_24h_change ?? 0 },
        SUI: { price: raw.sui?.usd ?? 0, change24h: raw.sui?.usd_24h_change ?? 0 },
        updatedAt: now,
      };
      pricesCache = { data, ts: now };
      res.json(data);
    } catch (err: any) {
      if (pricesCache) return res.json(pricesCache.data);
      res.status(502).json({ error: 'Price feed unavailable' });
    }
  });

  // ─── Hot Potato Game Routes ───
  app.get('/api/hot-potato/games', async (_req: Request, res: Response) => {
    try {
      const { hotPotatoGames } = await import('@shared/schema');
      const games = await db.select().from(hotPotatoGames).orderBy(sql`created_at DESC`).limit(20);
      res.json(games);
    } catch (err: any) {
      console.error('Hot Potato list error:', err.message);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  });

  app.get('/api/hot-potato/games/:id', async (req: Request, res: Response) => {
    try {
      const { hotPotatoGames } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      const [game] = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.id, id));
      if (!game) return res.status(404).json({ error: 'Game not found' });
      res.json(game);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch game' });
    }
  });

  app.get('/api/hot-potato/games/:id/grabs', async (req: Request, res: Response) => {
    try {
      const { hotPotatoGrabs } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      const grabs = await db.select().from(hotPotatoGrabs)
        .where(eq(hotPotatoGrabs.gameId, id))
        .orderBy(sql`grab_number DESC`)
        .limit(50);
      res.json(grabs);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch grabs' });
    }
  });

  app.post('/api/hot-potato/games', async (req: Request, res: Response) => {
    try {
      const { hotPotatoGames } = await import('@shared/schema');
      const { eventId, teamA, teamB, sportName, leagueName, matchTime,
              minGrabAmount, timerDurationMs, gameDurationMs, createdBy, initialAmount, txHash } = req.body;

      if (!eventId || !teamA || !teamB) {
        return res.status(400).json({ error: 'eventId, teamA, teamB required' });
      }

      const now = Date.now();
      const timer = timerDurationMs || 60000;
      const duration = gameDurationMs || 3600000;

      const [game] = await db.insert(hotPotatoGames).values({
        eventId,
        teamA,
        teamB,
        sportName: sportName || null,
        leagueName: leagueName || null,
        matchTime: matchTime ? new Date(matchTime) : null,
        potAmount: initialAmount || 0,
        currency: 'SBETS',
        minGrabAmount: minGrabAmount || 100,
        currentHolder: createdBy || null,
        holderTeam: 0,
        grabCount: initialAmount ? 1 : 0,
        playerCount: initialAmount ? 1 : 0,
        status: 'active',
        timerDurationMs: timer,
        explosionTimeMs: String(now + timer),
        gameDeadlineMs: String(now + duration),
        createdBy: createdBy || null,
        txHash: txHash || null,
      }).returning();

      console.log(`🥔 Hot Potato game #${game.id} created: ${teamA} vs ${teamB}`);
      res.json(game);
    } catch (err: any) {
      console.error('Hot Potato create error:', err.message);
      res.status(500).json({ error: 'Failed to create game' });
    }
  });

  const hotPotatoGameLocks = new Map<number, Promise<any>>();
  function acquireGameLock(gameId: number): { execute: <T>(fn: () => Promise<T>) => Promise<T> } {
    return {
      execute: async <T>(fn: () => Promise<T>): Promise<T> => {
        const existingLock = hotPotatoGameLocks.get(gameId) || Promise.resolve();
        let resolve: () => void;
        const newLock = new Promise<void>(r => { resolve = r; });
        hotPotatoGameLocks.set(gameId, newLock);
        try {
          await existingLock;
          return await fn();
        } finally {
          resolve!();
          if (hotPotatoGameLocks.get(gameId) === newLock) {
            hotPotatoGameLocks.delete(gameId);
          }
        }
      }
    };
  }

  const usedHpTxHashes = new Set<string>();
  const hpGrabCooldowns = new Map<string, number>();
  const HP_GRAB_COOLDOWN_MS = 15000;
  const HP_MAX_GRAB_AMOUNT = 50000;

  app.post('/api/hot-potato/games/:id/grab', async (req: Request, res: Response) => {
    try {
      const { hotPotatoGames, hotPotatoPlayers, hotPotatoGrabs } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      const { wallet, amount, teamChosen, txHash } = req.body;

      if (!wallet || !amount || teamChosen === undefined) {
        return res.status(400).json({ error: 'wallet, amount, teamChosen required' });
      }

      if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
        return res.status(400).json({ error: 'Valid transaction hash required' });
      }

      if (typeof teamChosen !== 'number' || (teamChosen !== 0 && teamChosen !== 1)) {
        return res.status(400).json({ error: 'teamChosen must be 0 or 1' });
      }

      if (typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
        return res.status(400).json({ error: 'Invalid amount' });
      }

      if (amount > HP_MAX_GRAB_AMOUNT) {
        return res.status(400).json({ error: `Maximum grab amount is ${HP_MAX_GRAB_AMOUNT.toLocaleString()} SBETS` });
      }

      if (!/^0x[0-9a-fA-F]{64}$/.test(wallet)) {
        return res.status(400).json({ error: 'Invalid Sui wallet address' });
      }

      const ADMIN_WALLET = process.env.ADMIN_WALLET_ADDRESS || '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';
      try {
        const { BlockchainBetService } = await import('./services/blockchainBetService');
        const betService = new BlockchainBetService();
        const verification = await betService.verifySbetsTransfer(txHash, wallet, amount);
        if (!verification.verified) {
          console.log(`🥔🚫 FAKE TX REJECTED: game #${id}, wallet ${wallet.slice(0,10)}..., txHash ${txHash.slice(0,16)}... — ${verification.error}`);
          return res.status(400).json({ error: `Transaction verification failed: ${verification.error}` });
        }
        if (verification.recipient && verification.recipient.toLowerCase() !== ADMIN_WALLET.toLowerCase()) {
          console.log(`🥔🚫 WRONG RECIPIENT: game #${id}, sent to ${verification.recipient.slice(0,10)}... instead of admin`);
          return res.status(400).json({ error: 'Transaction sent to wrong recipient' });
        }
        console.log(`🥔✅ TX verified: ${txHash.slice(0,16)}... | ${verification.amount} SBETS from ${wallet.slice(0,10)}...`);
      } catch (verifyErr: any) {
        console.error(`🥔🚫 TX verification FAILED (fail-closed): ${verifyErr.message}`);
        return res.status(503).json({ error: 'Transaction verification temporarily unavailable. Please try again.' });
      }

      const gameLock = acquireGameLock(id);
      return await gameLock.execute(async () => {

      const cooldownKey = `${wallet.toLowerCase()}_${id}`;
      const lastGrabTime = hpGrabCooldowns.get(cooldownKey) || 0;
      const cooldownNow = Date.now();
      if (cooldownNow - lastGrabTime < HP_GRAB_COOLDOWN_MS) {
        const waitSec = Math.ceil((HP_GRAB_COOLDOWN_MS - (cooldownNow - lastGrabTime)) / 1000);
        return res.status(429).json({ error: `Grab cooldown: wait ${waitSec}s before grabbing again` });
      }

      const txNormalized = txHash.toLowerCase();
      if (usedHpTxHashes.has(txNormalized)) {
        return res.status(400).json({ error: 'Transaction already used for a grab (replay rejected)' });
      }
      const existingGrabWithTx2 = await db.select().from(hotPotatoGrabs)
        .where(eq(hotPotatoGrabs.txHash, txHash));
      if (existingGrabWithTx2.length > 0) {
        return res.status(400).json({ error: 'Transaction already used for a grab' });
      }
      usedHpTxHashes.add(txNormalized);

      const [game] = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.id, id));
      if (!game) return res.status(404).json({ error: 'Game not found' });
      if (game.status !== 'active') return res.status(400).json({ error: 'Game is not active' });

      const grabNow = Date.now();
      if (game.explosionTimeMs && grabNow >= parseInt(game.explosionTimeMs)) {
        await db.update(hotPotatoGames).set({ status: 'exploded' }).where(eq(hotPotatoGames.id, id));
        return res.status(400).json({ error: 'Game has exploded!', exploded: true });
      }

      if (game.gameDeadlineMs && grabNow >= parseInt(game.gameDeadlineMs)) {
        await db.update(hotPotatoGames).set({ status: 'exploded' }).where(eq(hotPotatoGames.id, id));
        return res.status(400).json({ error: 'Game deadline passed', exploded: true });
      }

      if (amount < game.minGrabAmount) {
        return res.status(400).json({ error: `Minimum grab amount is ${game.minGrabAmount} SBETS` });
      }

      if (game.currentHolder?.toLowerCase() === wallet.toLowerCase()) {
        return res.status(400).json({ error: 'You already hold the potato!' });
      }

      const newPot = (game.potAmount || 0) + amount;
      const newGrabCount = (game.grabCount || 0) + 1;
      let newTimer = game.timerDurationMs || 60000;
      const decrease = Math.floor(newTimer * 0.05);
      const minTimer = 5000;
      if (newTimer > minTimer + decrease) {
        newTimer = newTimer - decrease;
      } else {
        newTimer = minTimer;
      }

      const newExplosion = String(grabNow + newTimer);

      const existingPlayer = await db.select().from(hotPotatoPlayers)
        .where(and(eq(hotPotatoPlayers.gameId, id), eq(hotPotatoPlayers.wallet, wallet.toLowerCase())));

      let newPlayerCount = game.playerCount || 0;
      if (existingPlayer.length > 0) {
        await db.update(hotPotatoPlayers).set({
          totalContributed: (existingPlayer[0].totalContributed || 0) + amount,
          grabCount: (existingPlayer[0].grabCount || 0) + 1,
          lastTeam: teamChosen,
          lastGrabAt: new Date(),
        }).where(eq(hotPotatoPlayers.id, existingPlayer[0].id));
      } else {
        newPlayerCount += 1;
        await db.insert(hotPotatoPlayers).values({
          gameId: id,
          wallet: wallet.toLowerCase(),
          totalContributed: amount,
          grabCount: 1,
          lastTeam: teamChosen,
          lastGrabAt: new Date(),
        });
      }

      await db.insert(hotPotatoGrabs).values({
        gameId: id,
        wallet: wallet.toLowerCase(),
        amount,
        teamChosen,
        grabNumber: newGrabCount,
        timerAtGrab: newTimer,
        potAfterGrab: newPot,
        txHash: txHash || null,
      });

      await db.update(hotPotatoGames).set({
        potAmount: newPot,
        currentHolder: wallet.toLowerCase(),
        holderTeam: teamChosen,
        grabCount: newGrabCount,
        playerCount: newPlayerCount,
        timerDurationMs: newTimer,
        explosionTimeMs: newExplosion,
      }).where(eq(hotPotatoGames.id, id));

      hpGrabCooldowns.set(cooldownKey, Date.now());

      console.log(`🥔 Grab #${newGrabCount} on game #${id}: ${wallet.slice(0,10)}... added ${amount} SBETS (team ${teamChosen}), pot=${newPot}, timer=${newTimer}ms, TX: ${txHash.slice(0,16)}...`);

      res.json({
        success: true,
        grabNumber: newGrabCount,
        potAmount: newPot,
        timerDurationMs: newTimer,
        explosionTimeMs: newExplosion,
      });

      });
    } catch (err: any) {
      console.error('Hot Potato grab error:', err.message);
      res.status(500).json({ error: 'Failed to grab potato' });
    }
  });

  app.post('/api/hot-potato/games/:id/check-explosion', async (req: Request, res: Response) => {
    try {
      const { hotPotatoGames } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      const [game] = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.id, id));
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const now = Date.now();
      if (game.status === 'active' &&
          ((game.explosionTimeMs && now >= parseInt(game.explosionTimeMs)) ||
           (game.gameDeadlineMs && now >= parseInt(game.gameDeadlineMs)))) {
        await db.update(hotPotatoGames).set({ status: 'exploded' }).where(eq(hotPotatoGames.id, id));
        console.log(`🥔💥 Game #${id} EXPLODED! Last holder: ${game.currentHolder?.slice(0,10)}...`);
        res.json({ exploded: true, lastHolder: game.currentHolder, holderTeam: game.holderTeam });
      } else {
        res.json({ exploded: false, status: game.status });
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to check explosion' });
    }
  });

  async function executeHpPayouts(
    game: any,
    winningTeam: number,
    players: any[],
    betService: any,
  ): Promise<{ payouts: Array<{ wallet: string; amount: number; success: boolean; txHash?: string; error?: string }>; platformFee: number; winnerPot: number }> {
    const { hotPotatoPlayers } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');

    const totalPot = game.potAmount || 0;
    const platformFee = Math.floor(totalPot * 0.05 * 100) / 100;
    const winnerPot = totalPot - platformFee;
    const payouts: Array<{ wallet: string; amount: number; success: boolean; txHash?: string; error?: string }> = [];

    if (totalPot <= 0 || players.length === 0) return { payouts, platformFee, winnerPot };

    const SBETS_TOKEN_TYPE = process.env.SBETS_TOKEN_ADDRESS || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
    try {
      const { getSuiClient } = await import('./lib/suiRpcConfig');
      const client = getSuiClient();
      const adminWallet = process.env.ADMIN_WALLET_ADDRESS || '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';
      const coins = await client.getCoins({ owner: adminWallet, coinType: SBETS_TOKEN_TYPE });
      const totalBalance = coins.data.reduce((sum: bigint, c: any) => sum + BigInt(c.balance), 0n);
      const totalBalanceSbets = Number(totalBalance) / 1_000_000_000;
      if (totalBalanceSbets < winnerPot) {
        console.error(`🥔🚫 BALANCE CHECK FAILED: Admin wallet has ${totalBalanceSbets.toFixed(2)} SBETS but needs ${winnerPot} for game #${game.id}`);
        return { payouts: [{ wallet: 'system', amount: winnerPot, success: false, error: `Insufficient treasury balance: ${totalBalanceSbets.toFixed(2)} < ${winnerPot}` }], platformFee, winnerPot };
      }
      console.log(`🥔💰 Balance check OK: ${totalBalanceSbets.toFixed(2)} SBETS available, need ${winnerPot} for game #${game.id}`);
    } catch (balErr: any) {
      console.error(`🥔⚠️ Balance check failed (proceeding cautiously): ${balErr.message}`);
    }

    const playersToProcess = players.filter(p => p.payoutStatus !== 'paid');

    if (winningTeam === -1) {
      for (const player of playersToProcess) {
        if ((player.totalContributed || 0) > 0) {
          const refund = Math.floor((player.totalContributed! / totalPot) * winnerPot * 100) / 100;
          if (refund > 0) {
            const result = await betService.executePayoutSbetsOnChain(player.wallet, refund);
            payouts.push({ wallet: player.wallet, amount: refund, success: result.success, txHash: result.txHash, error: result.error });
            await db.update(hotPotatoPlayers).set({
              payoutAmount: refund,
              payoutTxHash: result.txHash || null,
              payoutStatus: result.success ? 'paid' : 'failed',
            }).where(eq(hotPotatoPlayers.id, player.id));
          }
        }
      }
    } else if (game.holderTeam === winningTeam) {
      const holderPlayer = playersToProcess.find((p: any) => p.wallet.toLowerCase() === game.currentHolder?.toLowerCase());
      if (!holderPlayer && game.currentHolder) {
        console.error(`🥔🚫 HOLDER ROW MISSING: game #${game.id}, holder ${game.currentHolder.slice(0,10)}... has no player record`);
        payouts.push({ wallet: game.currentHolder, amount: winnerPot, success: false, error: 'Holder player record missing — cannot pay safely' });
      } else if (holderPlayer && winnerPot > 0) {
        const result = await betService.executePayoutSbetsOnChain(game.currentHolder!, winnerPot);
        payouts.push({ wallet: game.currentHolder!, amount: winnerPot, success: result.success, txHash: result.txHash, error: result.error });
        await db.update(hotPotatoPlayers).set({
          payoutAmount: winnerPot,
          payoutTxHash: result.txHash || null,
          payoutStatus: result.success ? 'paid' : 'failed',
        }).where(eq(hotPotatoPlayers.id, holderPlayer.id));
      }
    } else {
      const otherPlayers = playersToProcess.filter((p: any) => p.wallet.toLowerCase() !== game.currentHolder?.toLowerCase());
      if (otherPlayers.length > 0) {
        const totalOtherContributed = otherPlayers.reduce((sum: number, p: any) => sum + (p.totalContributed || 0), 0);
        for (const player of otherPlayers) {
          const proportion = (player.totalContributed || 0) / totalOtherContributed;
          const share = Math.floor(proportion * winnerPot * 100) / 100;
          if (share > 0) {
            const result = await betService.executePayoutSbetsOnChain(player.wallet, share);
            payouts.push({ wallet: player.wallet, amount: share, success: result.success, txHash: result.txHash, error: result.error });
            await db.update(hotPotatoPlayers).set({
              payoutAmount: share,
              payoutTxHash: result.txHash || null,
              payoutStatus: result.success ? 'paid' : 'failed',
            }).where(eq(hotPotatoPlayers.id, player.id));
          }
        }
      }
    }

    return { payouts, platformFee, winnerPot };
  }

  app.post('/api/hot-potato/games/:id/settle', async (req: Request, res: Response) => {
    try {
      const adminPass = req.headers['x-admin-password'] || req.body?.adminPassword;
      if (!process.env.ADMIN_PASSWORD || !adminPass || adminPass !== process.env.ADMIN_PASSWORD) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const { hotPotatoGames, hotPotatoPlayers } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      const [game] = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.id, id));
      if (!game) return res.status(404).json({ error: 'Game not found' });
      if (game.status === 'settled') return res.status(400).json({ error: 'Game already settled' });
      if (game.status !== 'exploded' && game.status !== 'active' && game.status !== 'settlement_failed') {
        return res.status(400).json({ error: `Cannot settle game with status: ${game.status}` });
      }

      const { winningTeam } = req.body;
      if (winningTeam === undefined || winningTeam === null) {
        return res.status(400).json({ error: 'winningTeam required (0=teamA, 1=teamB, -1=draw)' });
      }

      const players = await db.select().from(hotPotatoPlayers).where(eq(hotPotatoPlayers.gameId, game.id));

      const { BlockchainBetService } = await import('./services/blockchainBetService');
      const betService = new BlockchainBetService();

      const { payouts, platformFee, winnerPot } = await executeHpPayouts(game, winningTeam, players, betService);

      const failedPayouts = payouts.filter(p => !p.success);
      const settleStatus = failedPayouts.length > 0 ? 'settlement_failed' : 'settled';

      await db.update(hotPotatoGames).set({
        status: settleStatus,
        winningTeam: winningTeam,
        settledAt: new Date(),
      }).where(eq(hotPotatoGames.id, game.id));

      console.log(`🥔${settleStatus === 'settled' ? '✅' : '⚠️'} Admin settled game #${id}: winner team ${winningTeam} | Payouts: ${payouts.length} (${failedPayouts.length} failed)`);
      res.json({ success: true, winningTeam, payouts, platformFee, totalPot: game.potAmount || 0, failedPayouts: failedPayouts.length });
    } catch (err: any) {
      console.error('Admin HP settle error:', err.message);
      res.status(500).json({ error: 'Failed to settle game' });
    }
  });

  // ─── Hot Potato Background Workers ───

  // 1. Auto-explosion checker — runs every 30 seconds
  async function hotPotatoExplosionChecker() {
    try {
      const { hotPotatoGames } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const activeGames = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.status, 'active'));
      const now = Date.now();

      for (const game of activeGames) {
        const explodeTime = game.explosionTimeMs ? parseInt(game.explosionTimeMs) : 0;
        const deadline = game.gameDeadlineMs ? parseInt(game.gameDeadlineMs) : 0;
        const matchTimeMs = game.matchTime ? new Date(game.matchTime).getTime() : 0;

        if ((explodeTime && now >= explodeTime) || (deadline && now >= deadline) || (matchTimeMs && now >= matchTimeMs)) {
          const hasPlayers = game.grabCount && game.grabCount > 0;
          const newStatus = hasPlayers ? 'exploded' : 'cancelled';
          await db.update(hotPotatoGames).set({ status: newStatus }).where(eq(hotPotatoGames.id, game.id));
          console.log(`🥔💥 Auto-${newStatus} game #${game.id}: ${game.teamA} vs ${game.teamB} | Holder: ${game.currentHolder?.slice(0,10)}... on team ${game.holderTeam}`);
        }
      }
    } catch (err: any) {
      console.error('Hot Potato explosion checker error:', err.message);
    }
  }

  setInterval(hotPotatoExplosionChecker, 5 * 1000);
  console.log('🥔 Hot Potato explosion checker started — runs every 5 seconds');

  // 2. Settlement worker — settles exploded games when match results are available
  async function hotPotatoSettlementWorker() {
    try {
      const { hotPotatoGames, hotPotatoPlayers } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const explodedGames = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.status, 'exploded'));
      if (!explodedGames.length) return;

      for (const game of explodedGames) {
        try {
          const apiKey = process.env.API_SPORTS_KEY;
          if (!apiKey || !game.eventId) continue;

          const fixtureRes = await fetch(`https://v3.football.api-sports.io/fixtures?id=${game.eventId}`, {
            headers: { 'x-apisports-key': apiKey }
          });
          if (!fixtureRes.ok) continue;

          const fixtureData: any = await fixtureRes.json();
          const fixture = fixtureData?.response?.[0];
          if (!fixture) continue;

          const statusShort = fixture.fixture?.status?.short;
          if (statusShort !== 'FT' && statusShort !== 'AET' && statusShort !== 'PEN') continue;

          const homeGoals = fixture.goals?.home ?? 0;
          const awayGoals = fixture.goals?.away ?? 0;

          let winningTeam: number;
          if (homeGoals > awayGoals) {
            winningTeam = 0;
          } else if (awayGoals > homeGoals) {
            winningTeam = 1;
          } else {
            winningTeam = -1;
          }

          const players = await db.select().from(hotPotatoPlayers).where(eq(hotPotatoPlayers.gameId, game.id));

          const { BlockchainBetService } = await import('./services/blockchainBetService');
          const betService = new BlockchainBetService();

          console.log(`🥔 Game #${game.id}: ${game.teamA} ${homeGoals}-${awayGoals} ${game.teamB} | Winner: ${winningTeam === -1 ? 'DRAW' : winningTeam === 0 ? game.teamA : game.teamB}`);

          const { payouts } = await executeHpPayouts(game, winningTeam, players, betService);

          const payoutsSuccess = payouts.filter(p => p.success).length;
          const payoutsFailed = payouts.filter(p => !p.success).length;

          for (const p of payouts) {
            console.log(`  🥔 ${p.success ? '✅' : '❌'} ${p.amount} SBETS → ${p.wallet.slice(0,10)}...${p.txHash ? ' TX: ' + p.txHash.slice(0,16) : ''}${p.error ? ' ERR: ' + p.error : ''}`);
          }

          const settleStatus = payoutsFailed > 0 ? 'settlement_failed' : 'settled';
          await db.update(hotPotatoGames).set({
            status: settleStatus,
            winningTeam,
            settledAt: new Date(),
          }).where(eq(hotPotatoGames.id, game.id));

          console.log(`🥔${settleStatus === 'settled' ? '✅' : '⚠️'} Game #${game.id}: ${payoutsSuccess} paid, ${payoutsFailed} failed`);
        } catch (gameErr: any) {
          console.error(`🥔 Settlement error for game #${game.id}:`, gameErr.message);
        }
      }
    } catch (err: any) {
      console.error('Hot Potato settlement worker error:', err.message);
    }
  }

  setTimeout(hotPotatoSettlementWorker, 60 * 1000);
  setInterval(hotPotatoSettlementWorker, 3 * 60 * 1000);
  console.log('🥔 Hot Potato settlement worker started — checks every 3 minutes for finished matches');

  // 3. Auto-game creation — picks popular upcoming matches and creates HP games
  async function hotPotatoAutoGameCreator() {
    try {
      const { hotPotatoGames } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const activeGames = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.status, 'active'));
      console.log(`🥔🤖 Auto-creator: ${activeGames.length} active HP games`);
      if (activeGames.length >= 5) {
        console.log('🥔🤖 Already at max (5) active games, skipping');
        return;
      }

      const slotsAvailable = 5 - activeGames.length;
      const now = Date.now();

      const snapshot = getUpcomingSnapshot();
      if (!snapshot || !snapshot.events || snapshot.events.length === 0) {
        console.log('🥔🤖 No upcoming events in snapshot cache yet');
        return;
      }

      console.log(`🥔🤖 Upcoming snapshot has ${snapshot.events.length} events`);

      const allHpGames = await db.select({ eventId: hotPotatoGames.eventId }).from(hotPotatoGames);
      const existingEventIds = new Set(allHpGames.map(g => g.eventId));

      const eligibleMatches = snapshot.events.filter((e: any) => {
        const eventId = String(e.id);
        const hasTeams = e.homeTeam && e.awayTeam;
        const startTimeMs = e.startTime ? new Date(e.startTime).getTime() : 0;
        const startsInFuture = startTimeMs > now + 60 * 60 * 1000;
        const notTooFar = startTimeMs < now + 24 * 60 * 60 * 1000;
        const notAlreadyUsed = !existingEventIds.has(eventId);
        const isFootball = e.sportId === 1 || e.sportId === '1';
        return hasTeams && startsInFuture && notTooFar && notAlreadyUsed && isFootball;
      });

      console.log(`🥔🤖 ${eligibleMatches.length} eligible football matches (start 1-24h, not already used)`);
      if (!eligibleMatches.length) return;

      eligibleMatches.sort((a: any, b: any) => {
        const aTime = new Date(a.startTime).getTime();
        const bTime = new Date(b.startTime).getTime();
        return aTime - bTime;
      });

      const gamesToCreate = eligibleMatches.slice(0, Math.min(3, slotsAvailable));

      for (const match of gamesToCreate) {
        const matchStartMs = new Date(match.startTime).getTime();
        const gameDeadlineMs = matchStartMs - 5 * 60 * 1000;
        const timerMs = 10 * 60 * 1000;

        try {
          const [newGame] = await db.insert(hotPotatoGames).values({
            eventId: String(match.id),
            teamA: match.homeTeam,
            teamB: match.awayTeam,
            sportName: 'Football',
            leagueName: match.leagueName || null,
            matchTime: new Date(match.startTime),
            potAmount: 0,
            currency: 'SBETS',
            minGrabAmount: 1000,
            currentHolder: null,
            holderTeam: 0,
            grabCount: 0,
            playerCount: 0,
            status: 'active',
            timerDurationMs: timerMs,
            explosionTimeMs: null,
            gameDeadlineMs: String(gameDeadlineMs),
            createdBy: 'auto',
          }).returning();

          console.log(`🥔🤖 Auto-created HP game #${newGame.id}: ${match.homeTeam} vs ${match.awayTeam} (${match.leagueName}) — match starts ${match.startTime}`);
        } catch (createErr: any) {
          if (createErr.code !== '23505') {
            console.error(`Auto HP game create error:`, createErr.message);
          } else {
            console.log(`🥔🤖 Game already exists for event ${match.id}, skipping`);
          }
        }
      }
    } catch (err: any) {
      console.error('Hot Potato auto-creator error:', err.message);
    }
  }

  setTimeout(hotPotatoAutoGameCreator, 60 * 1000);
  setInterval(hotPotatoAutoGameCreator, 10 * 60 * 1000);
  console.log('🥔 Hot Potato auto-game creator started — checks every 10 minutes for upcoming matches');

  // HP Treasury info endpoint (separate from betting treasury)
  app.get('/api/hot-potato/treasury', async (req: Request, res: Response) => {
    try {
      const { hotPotatoGames } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const adminPass = req.headers['x-admin-password'] as string | undefined;
      const isAdmin = process.env.ADMIN_PASSWORD && adminPass === process.env.ADMIN_PASSWORD;

      const activeGames = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.status, 'active'));
      const explodedGames = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.status, 'exploded'));
      const settledGames = await db.select().from(hotPotatoGames).where(eq(hotPotatoGames.status, 'settled'));

      const activePot = activeGames.reduce((sum, g) => sum + (g.potAmount || 0), 0);
      const pendingPot = explodedGames.reduce((sum, g) => sum + (g.potAmount || 0), 0);
      const totalSettled = settledGames.reduce((sum, g) => sum + (g.potAmount || 0), 0);

      if (isAdmin) {
        res.json({
          activePot,
          pendingPot,
          totalSettled,
          activeGames: activeGames.length,
          explodedGames: explodedGames.length,
          settledGames: settledGames.length,
          totalVolume: activePot + pendingPot + totalSettled,
        });
      } else {
        res.json({
          activeGames: activeGames.length,
          totalVolume: Math.round(activePot + pendingPot + totalSettled),
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get treasury info' });
    }
  });

  // ─── Pool Stats (DISABLED — re-enable when new pools are added) ───
  const poolDisabledMsg = { error: 'Pool stats temporarily disabled', code: 'DISABLED' };
  app.get('/api/bluefin/pool-stats', (_req, res) => res.status(503).json(poolDisabledMsg));
  app.get('/api/turbos/pool-stats', (_req, res) => res.status(503).json(poolDisabledMsg));

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGING SYSTEM — Chat, P2P Challenges, Settlement Notifications
  // ═══════════════════════════════════════════════════════════════════

  (async () => {
    try {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`
        CREATE TABLE IF NOT EXISTS chat_rooms (
          id SERIAL PRIMARY KEY,
          event_id INTEGER,
          name TEXT NOT NULL,
          room_type TEXT NOT NULL DEFAULT 'global',
          member_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(rawSql`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_event_id_unique 
        ON chat_rooms (event_id) WHERE event_id IS NOT NULL
      `);
      await db.execute(rawSql`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id SERIAL PRIMARY KEY,
          room_id INTEGER NOT NULL,
          sender_wallet TEXT NOT NULL,
          encrypted_content TEXT NOT NULL,
          message_type TEXT NOT NULL DEFAULT 'text',
          reply_to_id INTEGER,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(rawSql`
        CREATE TABLE IF NOT EXISTS p2p_challenges (
          id SERIAL PRIMARY KEY,
          challenger_wallet TEXT NOT NULL,
          challenged_wallet TEXT NOT NULL,
          event_id INTEGER,
          event_name TEXT,
          prediction TEXT NOT NULL,
          amount NUMERIC NOT NULL,
          currency TEXT NOT NULL DEFAULT 'SBETS',
          odds NUMERIC DEFAULT 2,
          status TEXT NOT NULL DEFAULT 'pending',
          message TEXT,
          tx_hash TEXT,
          accepted_at TIMESTAMP,
          resolved_at TIMESTAMP,
          winner TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(rawSql`
        CREATE TABLE IF NOT EXISTS settlement_messages (
          id SERIAL PRIMARY KEY,
          recipient_wallet TEXT NOT NULL,
          bet_id INTEGER NOT NULL,
          event_name TEXT,
          result TEXT NOT NULL,
          payout_amount NUMERIC,
          currency TEXT,
          tx_hash TEXT,
          read BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      const rooms = await db.execute(rawSql`SELECT COUNT(*) as cnt FROM chat_rooms`);
      const count = parseInt((rooms as any).rows?.[0]?.cnt || (rooms as any)[0]?.cnt || '0');
      if (count === 0) {
        await db.execute(rawSql`INSERT INTO chat_rooms (name, room_type) VALUES ('General Chat', 'global'), ('Winners Circle', 'global'), ('Match Day', 'global'), ('Strategy', 'global')`);
        console.log('[Chat] Seeded 4 default chat rooms');
      }
      console.log('[Chat] Messaging tables ready');
    } catch (err: any) {
      console.error('[Chat] Failed to initialize messaging tables:', err.message);
    }
  })();

  app.get('/api/chat/rooms', async (req: Request, res: Response) => {
    try {
      const { sql: rawSql } = await import('drizzle-orm');

      try {
        await db.execute(rawSql`
          INSERT INTO chat_rooms (name, event_id, room_type, member_count)
          SELECT 
            COALESCE(MIN(home_team) || ' vs ' || MIN(away_team), MIN(event_name), 'Match #' || MIN(external_event_id)),
            CAST(MIN(external_event_id) AS INTEGER),
            'match',
            0
          FROM bets
          WHERE status IN ('pending', 'confirmed')
            AND external_event_id IS NOT NULL
            AND external_event_id ~ '^[0-9]+$'
          GROUP BY external_event_id
          ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
        `);
      } catch (syncErr: any) {
        console.warn('[Chat] Room sync warning:', syncErr.message);
      }

      const roomsResult = await db.execute(rawSql`
        SELECT 
          r.id, r.event_id as "eventId", r.name, r.room_type as "roomType", 
          r.member_count as "memberCount", r.created_at as "createdAt",
          lm.encrypted_content as "lastMessage",
          lm.created_at as "lastMessageTime",
          COALESCE(bc.bet_count, 0)::int as "activeBets"
        FROM chat_rooms r
        LEFT JOIN LATERAL (
          SELECT encrypted_content, created_at
          FROM chat_messages WHERE room_id = r.id
          ORDER BY created_at DESC LIMIT 1
        ) lm ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int as bet_count
          FROM bets
          WHERE r.event_id IS NOT NULL 
            AND external_event_id = r.event_id::text
            AND status IN ('pending', 'confirmed')
        ) bc ON true
        ORDER BY 
          CASE WHEN r.room_type = 'match' THEN 0 ELSE 1 END,
          COALESCE(bc.bet_count, 0) DESC,
          r.created_at DESC
        LIMIT 100
      `);

      const rows = (roomsResult as any).rows || roomsResult;
      res.json(rows || []);
    } catch (err: any) {
      console.error('[Chat] Failed to fetch rooms:', err.message);
      res.status(500).json({ error: 'Failed to fetch rooms' });
    }
  });

  app.post('/api/chat/rooms', async (req: Request, res: Response) => {
    try {
      const { chatRooms } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { name, eventId, roomType } = req.body;
      if (!name) return res.status(400).json({ error: 'Room name required' });

      if (eventId) {
        const existing = await db.select().from(chatRooms)
          .where(eq(chatRooms.eventId, eventId))
          .limit(1);
        if (existing.length > 0) return res.json(existing[0]);
      }

      const [room] = await db.insert(chatRooms).values({
        name,
        eventId: eventId || null,
        roomType: roomType || 'match',
        memberCount: 0,
      }).returning();
      res.json(room);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create room' });
    }
  });

  app.get('/api/chat/rooms/:roomId/messages', async (req: Request, res: Response) => {
    try {
      const { chatMessages } = await import('@shared/schema');
      const { desc, eq } = await import('drizzle-orm');
      const roomId = parseInt(req.params.roomId);
      if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID' });
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

      const messages = await db.select().from(chatMessages)
        .where(eq(chatMessages.roomId, roomId))
        .orderBy(desc(chatMessages.createdAt))
        .limit(limit);
      res.json(messages.reverse());
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  app.post('/api/chat/rooms/:roomId/messages', async (req: Request, res: Response) => {
    try {
      const { chatRooms, chatMessages } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const roomId = parseInt(req.params.roomId);
      if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID' });
      const { senderWallet, encryptedContent, messageType } = req.body;
      if (!senderWallet || !encryptedContent) {
        return res.status(400).json({ error: 'Missing sender or content' });
      }

      const wallet = senderWallet.toLowerCase();
      if (!/^0x[0-9a-fA-F]{64}$/.test(wallet)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }
      if (encryptedContent.length > 2000) {
        return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
      }

      const [msg] = await db.insert(chatMessages).values({
        roomId,
        senderWallet: wallet,
        encryptedContent,
        messageType: messageType || 'text',
      }).returning();

      await db.update(chatRooms)
        .set({ memberCount: sql`(SELECT COUNT(DISTINCT sender_wallet) FROM chat_messages WHERE room_id = ${roomId})` })
        .where(eq(chatRooms.id, roomId));

      res.json(msg);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  app.get('/api/chat/match/:eventId', async (req: Request, res: Response) => {
    try {
      const { chatRooms, events } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const eventId = parseInt(req.params.eventId);
      let rooms = await db.select().from(chatRooms)
        .where(eq(chatRooms.eventId, eventId));

      if (rooms.length === 0) {
        const event = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
        const name = event[0] ? `${event[0].homeTeam} vs ${event[0].awayTeam}` : `Match #${eventId}`;
        const [room] = await db.insert(chatRooms).values({
          name,
          eventId,
          roomType: 'match',
          memberCount: 0,
        }).returning();
        rooms = [room];
      }
      res.json(rooms[0]);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get match room' });
    }
  });

  app.post('/api/p2p/challenges', async (req: Request, res: Response) => {
    try {
      const { p2pChallenges } = await import('@shared/schema');
      const { challengerWallet, challengedWallet, eventId, eventName, prediction, amount, currency, message } = req.body;
      if (!challengerWallet || !challengedWallet || !prediction || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const challenger = challengerWallet.toLowerCase();
      const challenged = challengedWallet.toLowerCase();
      if (challenger === challenged) {
        return res.status(400).json({ error: 'Cannot challenge yourself' });
      }
      if (amount > 1000000) {
        return res.status(400).json({ error: 'Max challenge amount is 1,000,000 SBETS' });
      }

      const [challenge] = await db.insert(p2pChallenges).values({
        challengerWallet: challenger,
        challengedWallet: challenged,
        eventId: eventId || null,
        eventName: eventName || null,
        prediction,
        amount,
        currency: currency || 'SBETS',
        message: message || null,
        status: 'pending',
      }).returning();
      res.json(challenge);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create challenge' });
    }
  });

  app.get('/api/p2p/challenges', async (req: Request, res: Response) => {
    try {
      const { p2pChallenges } = await import('@shared/schema');
      const { desc, eq, or } = await import('drizzle-orm');
      const wallet = (req.query.wallet as string || '').toLowerCase();
      if (!wallet) return res.status(400).json({ error: 'Wallet required' });

      const challenges = await db.select().from(p2pChallenges)
        .where(
          or(
            eq(p2pChallenges.challengerWallet, wallet),
            eq(p2pChallenges.challengedWallet, wallet)
          )
        )
        .orderBy(desc(p2pChallenges.createdAt))
        .limit(50);
      res.json(challenges);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch challenges' });
    }
  });

  app.post('/api/p2p/challenges/:id/accept', async (req: Request, res: Response) => {
    try {
      const { p2pChallenges } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid challenge ID' });
      const { wallet } = req.body;
      if (!wallet || !/^0x[0-9a-fA-F]{64}$/.test(wallet)) return res.status(400).json({ error: 'Valid wallet required' });

      const [challenge] = await db.select().from(p2pChallenges).where(eq(p2pChallenges.id, id));
      if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
      if (challenge.challengedWallet !== wallet.toLowerCase()) {
        return res.status(403).json({ error: 'Only the challenged wallet can accept' });
      }
      if (challenge.status !== 'pending') {
        return res.status(400).json({ error: 'Challenge already responded to' });
      }

      const [updated] = await db.update(p2pChallenges)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(p2pChallenges.id, id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to accept challenge' });
    }
  });

  app.post('/api/p2p/challenges/:id/decline', async (req: Request, res: Response) => {
    try {
      const { p2pChallenges } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid challenge ID' });
      const { wallet } = req.body;
      if (!wallet || !/^0x[0-9a-fA-F]{64}$/.test(wallet)) return res.status(400).json({ error: 'Valid wallet required' });

      const [challenge] = await db.select().from(p2pChallenges).where(eq(p2pChallenges.id, id));
      if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
      if (challenge.challengedWallet !== wallet.toLowerCase()) {
        return res.status(403).json({ error: 'Only the challenged wallet can decline' });
      }

      const [updated] = await db.update(p2pChallenges)
        .set({ status: 'declined' })
        .where(eq(p2pChallenges.id, id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to decline challenge' });
    }
  });

  app.get('/api/settlement-notifications', async (req: Request, res: Response) => {
    try {
      const { settlementMessages } = await import('@shared/schema');
      const { desc, eq } = await import('drizzle-orm');
      const wallet = (req.query.wallet as string || '').toLowerCase();
      if (!wallet) return res.status(400).json({ error: 'Wallet required' });

      const notifications = await db.select().from(settlementMessages)
        .where(eq(settlementMessages.recipientWallet, wallet))
        .orderBy(desc(settlementMessages.createdAt))
        .limit(50);
      res.json(notifications);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  app.post('/api/settlement-notifications/:id/read', async (req: Request, res: Response) => {
    try {
      const { settlementMessages } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid notification ID' });
      const wallet = (req.body.wallet || '').toLowerCase();
      if (!wallet || !/^0x[0-9a-fA-F]{64}$/.test(wallet)) return res.status(400).json({ error: 'Valid wallet required' });

      const [notif] = await db.select().from(settlementMessages).where(eq(settlementMessages.id, id));
      if (!notif) return res.status(404).json({ error: 'Notification not found' });
      if (notif.recipientWallet !== wallet) return res.status(403).json({ error: 'Not your notification' });

      await db.update(settlementMessages)
        .set({ read: true })
        .where(eq(settlementMessages.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to mark as read' });
    }
  });

  app.get('/api/chat/profile/:wallet', async (req: Request, res: Response) => {
    try {
      const { bets, chatMessages } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const wallet = req.params.wallet.toLowerCase();
      if (!/^0x[0-9a-fA-F]{64}$/.test(wallet)) {
        return res.status(400).json({ error: 'Invalid wallet' });
      }

      const allBets = await db.select().from(bets)
        .where(eq(bets.walletAddress, wallet));

      const totalBets = allBets.length;
      const wonBets = allBets.filter((b: any) => b.status === 'won' || b.status === 'paid_out').length;
      const lostBets = allBets.filter((b: any) => b.result === 'lost').length;
      const pendingBets = allBets.filter((b: any) => b.status === 'pending').length;
      const totalWagered = allBets.reduce((sum: number, b: any) => sum + (b.betAmount || 0), 0);
      const totalWon = allBets.filter((b: any) => b.status === 'won' || b.status === 'paid_out')
        .reduce((sum: number, b: any) => sum + (b.payout || 0), 0);
      const winRate = totalBets > 0 ? Math.round((wonBets / Math.max(wonBets + lostBets, 1)) * 100) : 0;

      const messageCount = await db.select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .where(eq(chatMessages.senderWallet, wallet));

      const firstBet = allBets.sort((a: any, b: any) =>
        (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0)
      )[0];

      res.json({
        wallet,
        totalBets,
        wonBets,
        lostBets,
        pendingBets,
        totalWagered: Math.round(totalWagered),
        totalWon: Math.round(totalWon),
        winRate,
        messagesSent: messageCount[0]?.count || 0,
        memberSince: firstBet?.createdAt || null,
        verified: totalBets >= 10,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  return httpServer;
}