import { useState, useEffect, useMemo } from 'react';
import { Swords, Trophy, Clock, Coins, AlertCircle, Star, Send, Copy, Loader2, Shield, X } from 'lucide-react';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { PLAYERS, calcPlayerPoints, FLAG_EMOJI, POS_TEXT_COLOR, type Position, type ResultRound } from './WorldCupFantasy';

const SUI_COIN_TYPE   = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const SBETS_COIN_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const FALLBACK_ESCROW = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';
const SUI_CLOCK_ID    = '0x0000000000000000000000000000000000000000000000000000000000000006';

// ─── Types ─────────────────────────────────────────────────────────────────────
export type Gameweek = 'md1' | 'group' | 'knockout' | 'tournament';

// ─── H2H Market Types ─────────────────────────────────────────────────────────
export type H2HMarketType =
  | 'squad_points'      // Full 11-player fantasy points — highest wins
  | 'captain_duel'      // Only captain's points (×2) count
  | 'top_scorer'        // Each picks 1 FWD; whose nation scores more team goals wins
  | 'clean_sheet_race'  // GK + DEF clean sheet bonus points only
  | 'over_under'        // Total goals from squad nations vs a set line
  | 'fwd_firepower'     // Only FWD players' points — pure striking power
  | 'engine_room'       // Only MID players' points — midfield battle
  | 'fortress';         // All GK + DEF points (wins + clean sheets) — defensive unit

export const H2H_MARKETS: Record<H2HMarketType, {
  label: string; emoji: string; shortDesc: string; longDesc: string; color: string; bgColor: string;
}> = {
  squad_points:      { label: 'Squad Points',      emoji: '⚽', color: 'text-cyan-400',    bgColor: 'bg-cyan-500/10 border-cyan-500/25',
    shortDesc: 'Full squad pts',
    longDesc:  'Total fantasy points from all 11 starters. Captain earns 2×. Highest score wins.' },
  captain_duel:      { label: 'Captain Duel',      emoji: '⭐', color: 'text-amber-400',   bgColor: 'bg-amber-500/10 border-amber-500/25',
    shortDesc: 'Captain vs captain',
    longDesc:  'Only your captain\'s fantasy points count (2× applied). Whose captain performs better?' },
  top_scorer:        { label: 'Top Scorer Pick',   emoji: '🎯', color: 'text-orange-400',  bgColor: 'bg-orange-500/10 border-orange-500/25',
    shortDesc: 'Pick your FWD',
    longDesc:  'Each player nominates 1 Forward. Whose national team scores the most goals wins.' },
  clean_sheet_race:  { label: 'Clean Sheet Race',  emoji: '🔒', color: 'text-green-400',   bgColor: 'bg-green-500/10 border-green-500/25',
    shortDesc: 'GK + DEF shutouts',
    longDesc:  'Only goalkeeper & defender clean sheet bonuses count. Most defensive points wins.' },
  over_under:        { label: 'Goals Over/Under',  emoji: '📊', color: 'text-purple-400',  bgColor: 'bg-purple-500/10 border-purple-500/25',
    shortDesc: 'Set a goals line',
    longDesc:  'Creator sets a goals line and picks Over or Under. Total goals from your squad\'s nations counted. Taker gets the other side.' },
  fwd_firepower:     { label: 'Striker Showdown',  emoji: '🔥', color: 'text-red-400',     bgColor: 'bg-red-500/10 border-red-500/25',
    shortDesc: 'FWD players only',
    longDesc:  'Only your Forwards\' fantasy points count — goals, wins, contributions. Who has the deadlier attack?' },
  engine_room:       { label: 'Engine Room',       emoji: '⚙️', color: 'text-blue-400',    bgColor: 'bg-blue-500/10 border-blue-500/25',
    shortDesc: 'MID players only',
    longDesc:  'Only your Midfielders\' fantasy points count — goals, assists, wins. Whose engine room dominates?' },
  fortress:          { label: 'Fortress',           emoji: '🛡️', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10 border-emerald-500/25',
    shortDesc: 'GK + DEF full pts',
    longDesc:  'All Goalkeeper & Defender fantasy points count — wins, clean sheets, and goal contributions. Best defensive unit wins.' },
};

export interface H2HChallenge {
  id: string;
  creatorWallet: string;
  creatorTeamName: string;
  creatorStarterIds: string[];
  creatorCaptainId: string;
  creatorPreviewPts: number;
  stake: number;
  currency: 'SUI' | 'SBETS';
  gameweek: Gameweek;
  status: 'open' | 'matched' | 'settled';
  createdAt: number;
  expiresAt: number;
  takerWallet?: string;
  takerTeamName?: string;
  takerStarterIds?: string[];
  takerCaptainId?: string;
  takerPreviewPts?: number;
  winnerSide?: 'creator' | 'taker' | 'draw';
  offerId?: string;
  onchainOfferId?: string;
  shareLink?: string;
  // Market-specific fields
  h2hMarket?: H2HMarketType;
  creatorPickId?: string;     // top_scorer: creator's nominated FWD id
  takerPickId?: string;       // top_scorer: taker's nominated FWD id
  goalsLine?: number;         // over_under: goals threshold
  creatorOuSide?: 'over' | 'under'; // over_under: creator's side
}

const LS_H2H_KEY = 'suibets_fantasy_h2h';

function loadChallenges(): H2HChallenge[] {
  try {
    const raw = localStorage.getItem(LS_H2H_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveChallenges(cs: H2HChallenge[]) {
  try { localStorage.setItem(LS_H2H_KEY, JSON.stringify(cs)); } catch {}
}

// Tournament starts June 11, 2026 — points are only real after this date
const TOURNAMENT_START_MS = new Date('2026-06-11T00:00:00Z').getTime();
export function tournamentStarted(): boolean { return Date.now() >= TOURNAMENT_START_MS; }

// Gameweek settlement deadlines — points are final after these dates
const GAMEWEEK_SETTLE_DATES: Record<Gameweek, string> = {
  md1:        '2026-06-27', // MD1 complete for all 12 groups
  group:      '2026-07-03', // All group matches finished
  knockout:   '2026-07-19', // Final played
  tournament: '2026-07-20', // Tournament settled
};

const GAMEWEEK_LABELS: Record<Gameweek, { label: string; emoji: string; desc: string }> = {
  md1:        { label: 'Matchday 1',      emoji: '1️⃣', desc: 'Group stage MD1 results only' },
  group:      { label: 'Group Stage',     emoji: '🔵', desc: 'All 3 group stage matchdays' },
  knockout:   { label: 'Knockouts',       emoji: '⚡', desc: 'Round of 32 through Final' },
  tournament: { label: 'Full Tournament', emoji: '🏆', desc: 'Every match, Jul 11 – Aug 19' },
};

const STAKE_PRESETS: Record<'SUI' | 'SBETS', number[]> = {
  SUI:   [0.5, 1, 2, 5, 10, 25],
  SBETS: [500, 1000, 5000, 10000, 50000],
};

// ─── Settlement countdown helper ──────────────────────────────────────────────
function timeToSettle(gameweek: Gameweek): string {
  const deadline = new Date(GAMEWEEK_SETTLE_DATES[gameweek]).getTime();
  const diff = deadline - Date.now();
  if (diff <= 0) return 'Settling soon';
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 1) return `Settles in ${days}d ${hours}h`;
  if (days === 1) return `Settles in 1d ${hours}h`;
  return `Settles in ${hours}h`;
}

// ─── Market-specific scoring ───────────────────────────────────────────────────
export function computeMarketScore(
  market: H2HMarketType,
  starterIds: string[],
  captainId: string,
  results: ResultRound[],
  pickedPlayerId?: string,
): number {
  switch (market) {
    case 'squad_points':
      return computePts(starterIds, captainId, results);

    case 'captain_duel': {
      const captain = PLAYERS.find(p => p.id === captainId);
      if (!captain) return 0;
      let pts = 0;
      for (const round of results) {
        const r = round.teams.find(t => t.country === captain.country);
        if (r) pts += calcPlayerPoints(captain, r);
      }
      return pts * 2;
    }

    case 'top_scorer': {
      const player = PLAYERS.find(p => p.id === pickedPlayerId);
      if (!player) return 0;
      let goals = 0;
      for (const round of results) {
        const r = round.teams.find(t => t.country === player.country);
        if (r) goals += r.goalsFor;
      }
      return goals;
    }

    case 'clean_sheet_race': {
      let pts = 0;
      for (const id of starterIds) {
        const player = PLAYERS.find(p => p.id === id);
        if (!player || (player.position !== 'GK' && player.position !== 'DEF')) continue;
        for (const round of results) {
          const r = round.teams.find(t => t.country === player.country);
          if (r && r.goalsAgainst === 0) {
            pts += player.position === 'GK' ? 6 : 4;
          }
        }
      }
      return pts;
    }

    case 'over_under': {
      // Return total goals scored by all teams represented in this squad
      const countries = new Set(
        starterIds.map(id => PLAYERS.find(p => p.id === id)?.country).filter(Boolean) as string[]
      );
      let goals = 0;
      for (const round of results) {
        for (const t of round.teams) {
          if (countries.has(t.country)) goals += t.goalsFor;
        }
      }
      return goals;
    }

    case 'fwd_firepower': {
      let pts = 0;
      for (const id of starterIds) {
        const player = PLAYERS.find(p => p.id === id);
        if (!player || player.position !== 'FWD') continue;
        for (const round of results) {
          const r = round.teams.find(t => t.country === player.country);
          if (r) pts += calcPlayerPoints(player, r);
        }
      }
      return pts;
    }

    case 'engine_room': {
      let pts = 0;
      for (const id of starterIds) {
        const player = PLAYERS.find(p => p.id === id);
        if (!player || player.position !== 'MID') continue;
        for (const round of results) {
          const r = round.teams.find(t => t.country === player.country);
          if (r) pts += calcPlayerPoints(player, r);
        }
      }
      return pts;
    }

    case 'fortress': {
      let pts = 0;
      for (const id of starterIds) {
        const player = PLAYERS.find(p => p.id === id);
        if (!player || (player.position !== 'GK' && player.position !== 'DEF')) continue;
        for (const round of results) {
          const r = round.teams.find(t => t.country === player.country);
          if (r) pts += calcPlayerPoints(player, r);
        }
      }
      return pts;
    }

    default:
      return computePts(starterIds, captainId, results);
  }
}

// ─── Compute fantasy points for a squad ───────────────────────────────────────
// Returns 0 when no real match results are available (pre-tournament).
// NEVER falls back to SAMPLE_RESULTS — points are only from played matches.
export function computePts(starterIds: string[], captainId: string, results?: ResultRound[]): number {
  const rounds = (results && results.length > 0) ? results : [];
  if (rounds.length === 0) return 0;
  let total = 0;
  for (const id of starterIds) {
    const player = PLAYERS.find(p => p.id === id);
    if (!player) continue;
    let pts = 0;
    for (const round of rounds) {
      const r = round.teams.find(t => t.country === player.country);
      if (r) pts += calcPlayerPoints(player, r);
    }
    total += id === captainId ? pts * 2 : pts;
  }
  return total;
}

// ─── Mini squad preview (captain + top 3 players) ─────────────────────────────
function SquadMini({ starterIds, captainId }: { starterIds: string[]; captainId: string }) {
  const captain = PLAYERS.find(p => p.id === captainId);
  const top3 = starterIds
    .filter(id => id !== captainId)
    .map(id => PLAYERS.find(p => p.id === id)!)
    .filter(Boolean)
    .slice(0, 3);
  return (
    <div className="flex flex-wrap gap-1.5">
      {captain && (
        <div className="flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 rounded-lg px-2 py-1">
          <Star size={9} className="text-amber-400 fill-current" />
          <span className="text-[10px] text-amber-300 font-bold">{captain.name.split(' ').pop()}</span>
          <span className="text-[9px]">{FLAG_EMOJI[captain.country] || ''}</span>
        </div>
      )}
      {top3.map(p => (
        <div key={p.id} className="flex items-center gap-1 bg-white/[0.04] border border-white/8 rounded-lg px-2 py-1">
          <span className={`text-[8px] font-black ${POS_TEXT_COLOR[p.position as Position]}`}>{p.position}</span>
          <span className="text-[10px] text-gray-300">{p.name.split(' ').pop()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── H2H score bar ────────────────────────────────────────────────────────────
function ScoreBar({ creatorPts, takerPts, creatorName, takerName }: {
  creatorPts: number; takerPts: number; creatorName: string; takerName: string;
}) {
  const total = creatorPts + takerPts || 1;
  const creatorPct = (creatorPts / total) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-bold">
        <span className={creatorPts >= takerPts ? 'text-cyan-400' : 'text-gray-500'}>{creatorName}</span>
        <span className={takerPts > creatorPts ? 'text-green-400' : 'text-gray-500'}>{takerName}</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden">
        <div className="bg-cyan-500 transition-all" style={{ width: `${creatorPct}%` }} />
        <div className="bg-green-500 flex-1" />
      </div>
      <div className="flex justify-between text-xs font-black">
        <span className="text-cyan-300">{creatorPts} pts</span>
        <span className="text-green-300">{takerPts} pts</span>
      </div>
    </div>
  );
}

// ─── Challenge card ───────────────────────────────────────────────────────────
function ChallengeCard({
  challenge, isOwn, myPts, onAccept, onCopyLink, onCancel, isAccepting, isCancelling,
}: {
  challenge: H2HChallenge;
  isOwn: boolean;
  myPts?: number;
  onAccept?: () => void;
  onCopyLink?: () => void;
  onCancel?: () => void;
  isAccepting?: boolean;
  isCancelling?: boolean;
}) {
  const gw = GAMEWEEK_LABELS[challenge.gameweek];
  const market = H2H_MARKETS[challenge.h2hMarket ?? 'squad_points'];
  const isOpen = challenge.status === 'open';
  const isMatched = challenge.status === 'matched';
  const expiresSoon = challenge.expiresAt - Date.now() < 86400000 * 2;

  // Market-specific detail line
  const marketDetail = (() => {
    switch (challenge.h2hMarket) {
      case 'top_scorer': {
        const pick = PLAYERS.find(p => p.id === challenge.creatorPickId);
        return pick ? `Pick: ${pick.name} (${FLAG_EMOJI[pick.country] || ''} ${pick.country})` : null;
      }
      case 'over_under':
        return challenge.goalsLine !== undefined
          ? `Line: ${challenge.goalsLine} goals · Creator: ${challenge.creatorOuSide?.toUpperCase() ?? 'OVER'}`
          : null;
      case 'captain_duel': {
        const cap = PLAYERS.find(p => p.id === challenge.creatorCaptainId);
        return cap ? `Captain: ${cap.name} (${FLAG_EMOJI[cap.country] || ''})` : null;
      }
      default: return null;
    }
  })();

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      isOwn ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-white/8 bg-white/[0.02] hover:border-white/15'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-white/5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${isOwn ? 'bg-cyan-500/20' : 'bg-white/[0.06]'}`}>
          {market.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-black text-white truncate">{challenge.creatorTeamName}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border flex-shrink-0 ${market.bgColor} ${market.color}`}>
              {market.label}
            </span>
            {isOwn && <span className="text-[9px] font-black bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full flex-shrink-0">YOU</span>}
            {expiresSoon && isOpen && <span className="text-[9px] font-black bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full flex-shrink-0">EXPIRING</span>}
          </div>
          <div className="text-[10px] text-gray-500 font-mono">{challenge.creatorWallet.slice(0, 8)}…{challenge.creatorWallet.slice(-4)}</div>
          {marketDetail && <div className={`text-[10px] mt-0.5 ${market.color}`}>{marketDetail}</div>}
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`text-base font-black ${challenge.currency === 'SUI' ? 'text-cyan-400' : 'text-amber-400'}`}>
            {challenge.stake} {challenge.currency}
          </div>
          <div className="text-[9px] text-gray-600">each side</div>
        </div>
      </div>

      {/* Squad preview */}
      <div className="px-3 py-2 bg-white/[0.01]">
        <SquadMini starterIds={challenge.creatorStarterIds} captainId={challenge.creatorCaptainId} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-white/5">
        <div className="flex items-center gap-1 text-[10px] text-gray-500">
          <span>{gw.emoji}</span>
          <span>{gw.label}</span>
        </div>

        {/* Only show pts when real match data exists (tournament started + pts > 0) */}
        {challenge.creatorPreviewPts > 0 ? (
          <div className="flex items-center gap-1 text-[10px] text-gray-400 font-bold">
            <Trophy size={9} />
            <span>{challenge.creatorPreviewPts} pts</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[10px] text-gray-600 italic">
            <Trophy size={9} />
            <span>pts after Jun 11</span>
          </div>
        )}

        {/* Real pts comparison: only after tournament started and both have scored */}
        {myPts !== undefined && myPts > 0 && challenge.creatorPreviewPts > 0 && isOpen && (
          <div className={`flex items-center gap-1 text-[10px] font-bold ml-auto ${myPts > challenge.creatorPreviewPts ? 'text-green-400' : 'text-orange-400'}`}>
            {myPts > challenge.creatorPreviewPts ? '🔥 Leading' : '⚠ Behind'}
            <span className="text-gray-600 font-normal">({myPts} vs {challenge.creatorPreviewPts})</span>
          </div>
        )}

        {/* Settled result */}
        {challenge.status === 'settled' && challenge.winnerSide && (
          <div className={`ml-auto flex items-center gap-1 text-[10px] font-black rounded-full px-2 py-0.5 ${
            challenge.winnerSide === 'creator' ? 'bg-cyan-500/15 text-cyan-400' : challenge.winnerSide === 'taker' ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'
          }`}>
            {challenge.winnerSide === 'creator' ? '🏆 Creator won' : challenge.winnerSide === 'taker' ? '🏆 Taker won' : '🤝 Draw'}
          </div>
        )}

        {/* Matched but not settled — countdown to gameweek settlement */}
        {isMatched && challenge.status !== 'settled' && (
          <div className="ml-auto flex items-center gap-1 text-[10px] text-amber-500/70">
            <Clock size={9} /> {timeToSettle(challenge.gameweek)}
          </div>
        )}
      </div>

      {/* Matched: show real score bar only when we have actual match data (pts > 0) */}
      {isMatched && challenge.takerStarterIds && challenge.takerCaptainId &&
        (challenge.creatorPreviewPts > 0 || (challenge.takerPreviewPts ?? 0) > 0) && (
        <div className="px-3 pb-3">
          <ScoreBar
            creatorPts={challenge.creatorPreviewPts}
            takerPts={challenge.takerPreviewPts ?? 0}
            creatorName={challenge.creatorTeamName}
            takerName={challenge.takerTeamName ?? 'Opponent'}
          />
        </div>
      )}

      {/* Actions */}
      {(isOwn || isOpen) && (
        <div className="flex gap-2 p-3 border-t border-white/5 flex-wrap">
          {isOwn && isOpen && (
            <>
              <button
                onClick={onCopyLink}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/8 text-gray-400 hover:text-white text-xs transition-all"
              >
                <Copy size={11} /> Copy Link
              </button>
              {/* Share to X */}
              <button
                onClick={() => {
                  const url = challenge.offerId
                    ? `${window.location.origin}/p2p/offer/${challenge.offerId}`
                    : `${window.location.origin}/p2p`;
                  const mk = H2H_MARKETS[challenge.h2hMarket ?? 'squad_points'];
                  const gw = GAMEWEEK_LABELS[challenge.gameweek];
                  const text = `⚔️ I just posted a Fantasy WC2026 H2H challenge on @SuiBets!\n\n${mk.emoji} Market: ${mk.label}\n🏆 Scope: ${gw.label}\n💰 Stake: ${challenge.stake} ${challenge.currency}\n\nBeat my fantasy squad and win the pot 👇`;
                  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/20 text-xs transition-all"
              >
                𝕏 Share
              </button>
              {onCancel && (
                <button
                  onClick={onCancel}
                  disabled={isCancelling}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs transition-all disabled:opacity-50"
                >
                  {isCancelling ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                  Cancel
                </button>
              )}
              <div className="ml-auto flex items-center gap-1 text-[10px] text-gray-600">
                <Clock size={10} /> Waiting for opponent…
              </div>
            </>
          )}
          {!isOwn && isOpen && onAccept && (
            <button
              onClick={onAccept}
              disabled={isAccepting}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-sm hover:from-orange-400 hover:to-red-400 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-60"
            >
              {isAccepting
                ? <><Loader2 size={14} className="animate-spin" /> Signing with wallet…</>
                : <><Swords size={14} /> Accept — Stake {challenge.stake} {challenge.currency}</>
              }
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main H2H component ───────────────────────────────────────────────────────
interface FantasyH2HProps {
  walletAddress?: string;
  teamName: string;
  starterIds: (string | null)[];
  captainId: string | null;
  isTeamComplete: boolean;
  myPreviewPts: number;
  results?: ResultRound[];
}

export default function FantasyH2H({
  walletAddress, teamName, starterIds, captainId, isTeamComplete, myPreviewPts, results
}: FantasyH2HProps) {
  const [tab, setTab] = useState<'browse' | 'post' | 'mine'>('browse');
  const [challenges, setChallenges] = useState<H2HChallenge[]>([]);
  const [postStake, setPostStake] = useState(1);
  const [postCurrency, setPostCurrency] = useState<'SUI' | 'SBETS'>('SUI');
  const [postGameweek, setPostGameweek] = useState<Gameweek>('md1');
  const [posting, setPosting] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [escrowWallet, setEscrowWallet]   = useState<string>(FALLBACK_ESCROW);
  const [contractPkg,  setContractPkg]    = useState<string>('');
  const [contractCfg,  setContractCfg]    = useState<string>('');
  const [contractReg,  setContractReg]    = useState<string>('');
  const [onchainEscrow, setOnchainEscrow] = useState<boolean>(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [apiChallenges, setApiChallenges] = useState<H2HChallenge[]>([]);
  const [apiMyChallenges, setApiMyChallenges] = useState<H2HChallenge[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  // Market selection state
  const [postMarket, setPostMarket] = useState<H2HMarketType>('squad_points');
  const [postFwdPickId, setPostFwdPickId] = useState<string>('');
  const [postGoalsLine, setPostGoalsLine] = useState<number>(4.5);
  const [postOuSide, setPostOuSide] = useState<'over' | 'under'>('over');

  // Wallet hooks — same as normal P2P system
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const connectedWallet = account?.address ?? null;

  useEffect(() => {
    setChallenges(loadChallenges());
    fetch('/api/p2p/contract-wallet')
      .then(r => r.json())
      .then(d => {
        if (d.wallet) setEscrowWallet(d.wallet);
        if (d.packageId)  setContractPkg(d.packageId);
        if (d.configId)   setContractCfg(d.configId);
        if (d.registryId) setContractReg(d.registryId);
        if (d.onchainEscrow) setOnchainEscrow(true);
      })
      .catch(() => {});

    // Fetch real open Fantasy H2H challenges from the API (posted by real users)
    const walletAddr = walletAddress || '';

    // Helper: parse market metadata from prediction field (JSON-encoded) or legacy plain string
    const parsePrediction = (o: any): {
      h2hMarket: H2HMarketType;
      creatorPickId?: string;
      goalsLine?: number;
      creatorOuSide?: 'over' | 'under';
    } => {
      try {
        const pred = JSON.parse(o.prediction ?? '{}');
        return {
          h2hMarket:     (pred.market as H2HMarketType) ?? 'squad_points',
          creatorPickId: pred.pickId,
          goalsLine:     pred.goalsLine !== undefined ? Number(pred.goalsLine) : undefined,
          creatorOuSide: pred.ouSide as 'over' | 'under' | undefined,
        };
      } catch {
        return { h2hMarket: 'squad_points' };
      }
    };

    const toChallenge = (o: any, forceStatus?: H2HChallenge['status']): H2HChallenge => {
      const market = parsePrediction(o);
      return {
        id:                 String(o.id),
        offerId:            String(o.id),
        onchainOfferId:     o.onchainOfferId ?? o.onchain_offer_id ?? undefined,
        creatorWallet:      o.creatorWallet ?? o.creator_wallet ?? '',
        creatorTeamName:    o.homeTeam ?? o.home_team ?? 'Unknown Team',
        creatorStarterIds:  [],
        creatorCaptainId:   '',
        creatorPreviewPts:  0,
        stake:              Number(o.creatorStake ?? o.creator_stake ?? 0),
        currency:           (o.currency ?? 'SUI') as 'SUI' | 'SBETS',
        gameweek:           ((o.eventId ?? o.event_id ?? '').replace(/^.*_h2h_/, '') as Gameweek) || 'tournament',
        status:             forceStatus ?? ((o.status ?? 'open') as H2HChallenge['status']),
        createdAt:          new Date(o.createdAt ?? o.created_at ?? Date.now()).getTime(),
        expiresAt:          new Date(o.expiresAt ?? o.expires_at ?? Date.now() + 86400000 * 30).getTime(),
        h2hMarket:          market.h2hMarket,
        creatorPickId:      market.creatorPickId,
        goalsLine:          market.goalsLine,
        creatorOuSide:      market.creatorOuSide,
      };
    };

    // All offers — for Browse tab (open from others) and Mine tab (creator)
    fetch('/api/p2p/offers?limit=200&marketType=fantasy_h2h')
      .then(r => r.json())
      .then((offers: any[]) => {
        if (!Array.isArray(offers)) return;

        // Open challenges from other users — for Browse tab
        const h2h = offers
          .filter(o => o.marketType === 'fantasy_h2h' && o.status === 'open')
          .map(o => toChallenge(o, 'open'));
        setApiChallenges(h2h);

        // User's own open challenges from API (as creator)
        if (walletAddr) {
          const mine = offers
            .filter(o => o.marketType === 'fantasy_h2h' &&
              (o.creatorWallet ?? o.creator_wallet ?? '').toLowerCase() === walletAddr.toLowerCase())
            .map(o => toChallenge(o));
          setApiMyChallenges(prev => {
            // Merge in — don't override richer local data if offerId matches
            const fromApi = mine.filter(c => !prev.find(e => e.offerId === c.offerId));
            return [...prev, ...fromApi];
          });
        }
      })
      .catch(() => {});

    // Also fetch user's matched/settled challenges via /api/p2p/my
    // getMyActivity returns { myOffers: [...], myMatches: [...], myParlayOffers: [...] }
    if (walletAddr) {
      fetch(`/api/p2p/my?wallet=${encodeURIComponent(walletAddr)}`)
        .then(r => r.json())
        .then((data: any) => {
          // Collect creator offers + taker offers (via matches) for all statuses
          const creatorOffers: any[] = Array.isArray(data) ? data : (data?.myOffers ?? []);
          const takerMatchOffers: any[] = (data?.myMatches ?? []).map((m: any) => m.offer).filter(Boolean);
          const all = [...creatorOffers, ...takerMatchOffers];
          const mine = all
            .filter((o: any) => o?.marketType === 'fantasy_h2h')
            .map((o: any) => {
              // For taker matches, infer the status from the offer status
              return toChallenge(o);
            });
          // Deduplicate by offerId and merge with any existing API challenges
          setApiMyChallenges(mine);
        })
        .catch(() => {});
    }
  }, [walletAddress]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const wallet = walletAddress || 'guest';

  // Merge localStorage + API challenges for "My H2H Bets" tab (cross-device)
  const myChallenges = useMemo(() => {
    const local = challenges.filter(c => c.creatorWallet === wallet || c.takerWallet === wallet);
    const apiOnly = apiMyChallenges.filter(c => !local.find(lc => lc.offerId === c.offerId));
    return [...local, ...apiOnly];
  }, [challenges, apiMyChallenges, wallet]);

  const openFromOthers = [
    // Real challenges from other users fetched from the API
    ...apiChallenges.filter(c =>
      c.creatorWallet !== wallet &&
      !challenges.find(lc => lc.offerId === c.offerId)
    ),
    // Locally-tracked open challenges from other users
    ...challenges.filter(c => c.status === 'open' && c.creatorWallet !== wallet),
  ];

  // ── Helper: encode string as BCS byte vector (for Move call arguments) ────────
  const toBytes = (s: string) => new TextEncoder().encode(s);

  // ── Helper: build + fund a coin for the payment argument ────────────────────
  async function buildPaymentCoin(tx: Transaction, amount: bigint, currency: 'SUI' | 'SBETS', sender: string) {
    if (currency === 'SUI') {
      const [coin] = tx.splitCoins(tx.gas, [amount]);
      return coin;
    }
    const allCoins = await (suiClient as any).getCoins({ owner: sender, coinType: SBETS_COIN_TYPE });
    const coins: any[] = allCoins?.data ?? [];
    if (!coins.length) throw new Error('No SBETS found in your wallet. Please add SBETS to continue.');
    const primary = tx.object(coins[0].coinObjectId);
    if (coins.length > 1)
      tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
    const [coin] = tx.splitCoins(primary, [amount]);
    return coin;
  }

  // ── Creator signs post_offer on the Move contract ────────────────────────────
  // Returns { digest, onchainOfferId } — onchainOfferId is null if contract not configured.
  async function signPostOfferTx(
    stakeAmount: number,
    currency: 'SUI' | 'SBETS',
    signerWallet: string,
    gameweek: Gameweek,
  ): Promise<{ digest: string; onchainOfferId: string | null }> {
    const tx = new Transaction();
    tx.setSender(signerWallet);
    tx.setGasBudget(50_000_000);

    const coinTypeStr  = currency === 'SBETS' ? SBETS_COIN_TYPE : SUI_COIN_TYPE;
    const amountBase   = BigInt(Math.round(stakeAmount * 1_000_000_000));
    const paymentCoin  = await buildPaymentCoin(tx, amountBase, currency, signerWallet);

    const useContract = onchainEscrow && contractPkg && contractCfg && contractReg;

    if (useContract) {
      // On-chain escrow: post_offer<T> locks funds in a P2POffer shared object
      const deadline   = GAMEWEEK_SETTLE_DATES[gameweek];
      const expiresMs  = BigInt(new Date(deadline).getTime());
      const oddsBps    = 20_000n; // 2.00x — even money for H2H

      tx.moveCall({
        target:        `${contractPkg}::p2p_betting::post_offer`,
        typeArguments: [coinTypeStr],
        arguments: [
          tx.object(contractCfg),
          tx.object(contractReg),
          paymentCoin,
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(`fantasy_wc2026_h2h_${gameweek}`))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(`Fantasy WC2026 H2H \u2014 ${GAMEWEEK_LABELS[gameweek].label}`))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('fantasy_h2h'))),
          tx.pure.u64(oddsBps),
          tx.pure.u64(expiresMs),
          tx.object(SUI_CLOCK_ID),
        ],
      });
    } else {
      // Custodial fallback: transfer stake to platform escrow wallet
      tx.transferObjects([paymentCoin], escrowWallet);
    }

    const result = await signAndExecute({ transaction: tx as any });
    const digest = (result as any)?.digest ?? '';
    if (!digest) throw new Error('No transaction digest returned from wallet.');

    // Extract P2POffer object ID created by post_offer
    let onchainOfferId: string | null = null;
    if (useContract) {
      try {
        const txDetails = await (suiClient as any).getTransactionBlock({
          digest,
          options: { showObjectChanges: true },
        });
        const created = (txDetails?.objectChanges ?? []).find(
          (c: any) => c.type === 'created' && c.objectType?.includes('::p2p_betting::P2POffer'),
        );
        if (created?.objectId) onchainOfferId = created.objectId;
      } catch { /* non-fatal — API will also verify on-chain */ }
    }

    return { digest, onchainOfferId };
  }

  // ── Taker signs accept_offer on the Move contract ────────────────────────────
  // Returns { digest, onchainMatchId } — onchainMatchId is null if custodial path.
  async function signAcceptOfferTx(
    stakeAmount:     number,
    currency:        'SUI' | 'SBETS',
    signerWallet:    string,
    offerOnchainId:  string | undefined,
  ): Promise<{ digest: string; onchainMatchId: string | null }> {
    const tx = new Transaction();
    tx.setSender(signerWallet);
    tx.setGasBudget(50_000_000);

    const coinTypeStr  = currency === 'SBETS' ? SBETS_COIN_TYPE : SUI_COIN_TYPE;
    const amountBase   = BigInt(Math.round(stakeAmount * 1_000_000_000));
    const paymentCoin  = await buildPaymentCoin(tx, amountBase, currency, signerWallet);

    const useContract = !!(onchainEscrow && contractPkg && contractCfg && contractReg && offerOnchainId);

    if (useContract) {
      // On-chain escrow: accept_offer<T> creates a P2PMatchedBet holding both stakes
      tx.moveCall({
        target:        `${contractPkg}::p2p_betting::accept_offer`,
        typeArguments: [coinTypeStr],
        arguments: [
          tx.object(contractCfg),
          tx.object(contractReg),
          tx.object(offerOnchainId!),
          paymentCoin,
          tx.pure.u64(amountBase),
          tx.object(SUI_CLOCK_ID),
        ],
      });
    } else {
      // Custodial fallback: transfer stake to platform escrow wallet
      tx.transferObjects([paymentCoin], escrowWallet);
    }

    const result = await signAndExecute({ transaction: tx as any });
    const digest = (result as any)?.digest ?? '';
    if (!digest) throw new Error('No transaction digest returned from wallet.');

    // Extract P2PMatchedBet object ID created by accept_offer
    let onchainMatchId: string | null = null;
    if (useContract) {
      try {
        const txDetails = await (suiClient as any).getTransactionBlock({
          digest,
          options: { showObjectChanges: true },
        });
        const created = (txDetails?.objectChanges ?? []).find(
          (c: any) => c.type === 'created' && c.objectType?.includes('::p2p_betting::P2PMatchedBet'),
        );
        if (created?.objectId) onchainMatchId = created.objectId;
      } catch { /* non-fatal */ }
    }

    return { digest, onchainMatchId };
  }

  async function handlePost() {
    if (!isTeamComplete) return;
    setSignError(null);

    if (!connectedWallet) {
      setSignError('Connect your Sui wallet first to post a challenge.');
      return;
    }

    // Market-specific validation
    if (postMarket === 'top_scorer' && !postFwdPickId) {
      setSignError('Top Scorer market: please nominate a Forward from your squad.');
      return;
    }

    setPosting(true);
    try {
      // 1. Sign wallet transaction — on-chain contract if configured, else custodial escrow
      const { digest: txHash, onchainOfferId } = await signPostOfferTx(
        postStake, postCurrency, connectedWallet, postGameweek,
      );

      // 2. Register offer with API
      const validStarters = starterIds.filter(Boolean) as string[];
      let offerId: string | undefined;
      try {
        const deadline = GAMEWEEK_SETTLE_DATES[postGameweek];
        // Encode market-specific metadata in the prediction field as JSON
        // so the server stores it and we can parse it back on GET.
        const predictionPayload: Record<string, any> = { market: postMarket };
        if (postMarket === 'top_scorer' && postFwdPickId) predictionPayload.pickId = postFwdPickId;
        if (postMarket === 'over_under') { predictionPayload.goalsLine = postGoalsLine; predictionPayload.ouSide = postOuSide; }
        const body: Record<string, any> = {
          creatorWallet: connectedWallet,
          eventId: `fantasy_h2h_${postGameweek}`,
          eventName: `Fantasy WC2026 H2H — ${GAMEWEEK_LABELS[postGameweek].label}`,
          homeTeam: teamName,
          awayTeam: 'Open Challenge',
          leagueName: 'Fantasy World Cup 2026',
          sportName: 'fantasy',
          prediction: JSON.stringify(predictionPayload),
          marketType: 'fantasy_h2h',
          odds: 2.0,
          creatorStake: postStake,
          currency: postCurrency,
          matchDate: new Date('2026-06-11T00:00:00Z').toISOString(),
          expiresAt: new Date(deadline).toISOString(),
        };
        if (onchainOfferId) {
          // On-chain path: send the P2POffer object ID as proof of escrow
          body.onchainOfferId = onchainOfferId;
        } else {
          // Custodial path: send the tx hash so API can verify the transfer
          body.creatorTxHash = txHash;
        }
        const res = await fetch('/api/p2p/offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          offerId = data.offer?.id?.toString() ?? data.id?.toString();
        }
      } catch (_) { /* API is best-effort */ }

      // 3. Save challenge locally
      const newChallenge: H2HChallenge = {
        id: `h2h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        creatorWallet: connectedWallet,
        creatorTeamName: teamName,
        creatorStarterIds: validStarters,
        creatorCaptainId: captainId || '',
        creatorPreviewPts: myPreviewPts,
        stake: postStake,
        currency: postCurrency,
        gameweek: postGameweek,
        status: 'open',
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000 * (postGameweek === 'tournament' ? 40 : postGameweek === 'group' ? 14 : 3),
        offerId,
        onchainOfferId: onchainOfferId ?? undefined,
        shareLink: offerId ? `/p2p/offer/${offerId}` : `/p2p`,
        h2hMarket: postMarket,
        creatorPickId: postMarket === 'top_scorer' ? postFwdPickId : undefined,
        goalsLine: postMarket === 'over_under' ? postGoalsLine : undefined,
        creatorOuSide: postMarket === 'over_under' ? postOuSide : undefined,
      };

      const updated = [...challenges, newChallenge];
      setChallenges(updated);
      saveChallenges(updated);
      setTab('mine');
      const escrowLabel = onchainOfferId ? '🔒 locked in contract' : '🏦 custodial escrow';
      showToast(`✅ Challenge posted! Stake ${escrowLabel}. TX: ${txHash.slice(0, 12)}…`);
    } catch (e: any) {
      setSignError(e.message ?? 'Wallet signing failed. Please try again.');
    } finally {
      setPosting(false);
    }
  }

  async function handleAccept(challengeId: string) {
    if (!isTeamComplete) {
      showToast('Complete your squad first to accept a challenge!');
      return;
    }
    if (!connectedWallet) {
      showToast('Connect your Sui wallet to accept a challenge.');
      return;
    }

    setSignError(null);
    setAccepting(challengeId);

    try {
      // Find challenge from local cache or from API-fetched challenges
      const existing  = challenges.find(c => c.id === challengeId);
      const fromApi   = apiChallenges.find(c => c.id === challengeId);
      const source    = existing || fromApi;
      if (!source) { setAccepting(null); return; }

      // Sign wallet transaction — on-chain contract if the offer was posted on-chain
      // (onchainOfferId from the source challenge), else custodial escrow fallback.
      const offerOnchainId = (source as any).onchainOfferId ?? undefined;
      const { digest: txHash, onchainMatchId } = await signAcceptOfferTx(
        source.stake, source.currency, connectedWallet, offerOnchainId,
      );

      const validStarters = starterIds.filter(Boolean) as string[];

      // Mark as matched (settlement is server-side after the gameweek ends — NOT immediate)
      const alreadyLocal = challenges.find(c => c.id === challengeId);
      const updated: H2HChallenge = {
        ...(alreadyLocal || source),
        status: 'matched',
        takerWallet: connectedWallet,
        takerTeamName: teamName,
        takerStarterIds: validStarters,
        takerCaptainId: captainId || '',
        takerPreviewPts: 0,  // real pts set by server after matches played
      };

      // Notify API of acceptance — server will settle after gameweek ends
      const offerId = source.offerId;
      if (offerId) {
        const acceptBody: Record<string, any> = {
          takerWallet: connectedWallet,
          stake: source.stake,
          takerTxHash: txHash,
        };
        // For on-chain offers, also send the P2PMatchedBet object ID so the
        // backend can call instantSettleBet instead of a custodial transfer.
        if (onchainMatchId) acceptBody.onchainMatchId = onchainMatchId;
        fetch(`/api/p2p/offers/${offerId}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(acceptBody),
        }).catch(() => {});
      }

      const newList = alreadyLocal
        ? challenges.map(c => c.id === challengeId ? updated : c)
        : [...challenges, updated];

      setChallenges(newList);
      saveChallenges(newList);
      setTab('mine');

      const gwLabel = GAMEWEEK_LABELS[source.gameweek]?.label ?? 'the gameweek';
      const settleDate = GAMEWEEK_SETTLE_DATES[source.gameweek];
      const escrowType = onchainMatchId ? '🔒 locked in contract' : '🏦 custodial escrow';
      showToast(`✅ Accepted! Stake ${escrowType}. Settles after ${gwLabel} (~${settleDate}).`);
    } catch (e: any) {
      setSignError(e.message ?? 'Wallet signing failed. Please try again.');
      showToast('Wallet signing failed — ' + (e.message ?? 'unknown error'));
    } finally {
      setAccepting(null);
    }
  }

  function handleCopyLink(id: string) {
    const challenge = challenges.find(c => c.id === id) ?? apiMyChallenges.find(c => c.id === id);
    const url = challenge?.offerId
      ? `${window.location.origin}/p2p/offer/${challenge.offerId}`
      : `${window.location.origin}/p2p`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
    showToast('Challenge link copied!');
  }

  async function handleCancel(challengeId: string) {
    const challenge = myChallenges.find(c => c.id === challengeId);
    if (!challenge || challenge.status !== 'open') return;
    if (!connectedWallet) {
      showToast('Connect your wallet to cancel this challenge.');
      return;
    }
    setCancelling(challengeId);
    try {
      let cancelTxHash: string | undefined;

      // On-chain offers: must call cancel_offer on the Move contract first.
      // This returns funds directly to the maker's wallet from the contract escrow.
      if (challenge.onchainOfferId && contractPkg && contractReg) {
        const tx = new Transaction();
        tx.setSender(connectedWallet);
        tx.setGasBudget(20_000_000);
        const coinTypeStr = challenge.currency === 'SBETS' ? SBETS_COIN_TYPE : SUI_COIN_TYPE;
        tx.moveCall({
          target: `${contractPkg}::p2p_betting::cancel_offer`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(challenge.onchainOfferId),
            tx.object(contractReg),
            tx.object(SUI_CLOCK_ID),
          ],
        });
        const result = await signAndExecute({ transaction: tx as any });
        cancelTxHash = (result as any)?.digest;
        if (!cancelTxHash) throw new Error('On-chain cancel failed — no transaction digest returned.');
        // Wait for finality before notifying the API
        const txCheck = await (suiClient as any).waitForTransaction({
          digest: cancelTxHash,
          options: { showEffects: true },
        });
        if (txCheck?.effects?.status?.status !== 'success') {
          const errMsg = txCheck?.effects?.status?.error ?? 'Transaction failed on-chain';
          throw new Error(`Cancel failed on-chain: ${errMsg}`);
        }
      }

      // Notify API — marks offer cancelled + triggers custodial refund if no on-chain tx
      if (challenge.offerId) {
        const res = await fetch(`/api/p2p/offers/${challenge.offerId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorWallet: connectedWallet, cancelTxHash }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Cancel failed' }));
          throw new Error(err.message || 'Failed to cancel offer');
        }
      }

      const updated = challenges.filter(c => c.id !== challengeId);
      setChallenges(updated);
      saveChallenges(updated);
      setApiMyChallenges(prev => prev.filter(c => c.id !== challengeId));
      showToast(challenge.onchainOfferId
        ? '✅ Cancelled on-chain — stake returned to your wallet.'
        : '✅ Challenge cancelled — stake will be refunded to your wallet.');
    } catch (e: any) {
      showToast('Cancel failed: ' + (e.message ?? 'unknown error'));
    } finally {
      setCancelling(null);
    }
  }

  const pot = useMemo(() => postStake * 2 * 0.98, [postStake]);

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#0f1923] border border-cyan-500/30 rounded-2xl px-5 py-3 text-sm text-white shadow-2xl shadow-black/40 max-w-sm text-center">
          {toast}
        </div>
      )}

      {/* Wallet not connected warning */}
      {!connectedWallet && (
        <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300">
          <AlertCircle size={13} className="flex-shrink-0" />
          Connect your Sui wallet to post or accept H2H challenges — your stake is signed directly from your wallet.
        </div>
      )}

      {/* Wallet connected indicator */}
      {connectedWallet && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/8 border border-green-500/20 rounded-xl text-xs text-green-400">
          <Shield size={11} className="flex-shrink-0" />
          <span>Wallet connected · stake signed on-chain · escrow locked</span>
        </div>
      )}

      {/* Sign error */}
      {signError && (
        <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-300">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span>{signError}</span>
        </div>
      )}

      {/* Tournament countdown banner */}
      {(() => {
        const now = Date.now();
        const start = TOURNAMENT_START_MS;
        const end   = new Date('2026-07-20T00:00:00Z').getTime();
        if (now >= end) return null;
        if (now >= start) {
          return (
            <div className="flex items-center gap-2.5 bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-xs text-green-300">
              <span className="text-base">🟢</span>
              <span><span className="font-black">WC 2026 is LIVE</span> — matches are being played and fantasy points are updating in real time!</span>
            </div>
          );
        }
        const diff  = start - now;
        const days  = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const mins  = Math.floor((diff % 3600000) / 60000);
        return (
          <div className="flex items-center gap-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-xs text-orange-300">
            <span className="text-base">⏳</span>
            <span>
              <span className="font-black">WC 2026 starts in {days}d {hours}h {mins}m</span> — lock your squad and post challenges now, scored from June 11!
            </span>
          </div>
        );
      })()}

      {/* Hero banner */}
      <div className="relative rounded-2xl overflow-hidden border border-orange-500/20 bg-gradient-to-br from-orange-900/20 to-red-900/15 p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center flex-shrink-0 text-2xl">⚔️</div>
          <div className="flex-1">
            <h3 className="text-lg font-black text-white mb-1">Fantasy H2H Betting</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Lock your squad and challenge anyone. Whoever scores more fantasy points wins the pot.
              Choose from <span className="text-orange-300 font-bold">8 market types</span> — full squad, captain duel, striker showdown, and more.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { label: 'Stake', value: 'SUI or SBETS', color: 'text-cyan-400' },
            { label: 'Fee', value: '2% of pot', color: 'text-gray-400' },
            { label: 'Markets', value: '8 types', color: 'text-orange-400' },
          ].map(item => (
            <div key={item.label} className="bg-white/[0.04] rounded-xl p-2.5 text-center border border-white/5">
              <div className={`text-xs font-black ${item.color}`}>{item.value}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          { id: 'browse', label: '🔍 Find Opponents', count: openFromOthers.length },
          { id: 'post',   label: '📤 Post Challenge', count: null },
          { id: 'mine',   label: '⚔️ My H2H Bets',   count: myChallenges.length },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              tab === t.id
                ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                : 'bg-white/[0.04] text-gray-400 border border-white/8 hover:text-white'
            }`}
          >
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-400'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── BROWSE ─────────────────────────────────────────────────────────── */}
      {tab === 'browse' && (
        <div className="space-y-3">
          {openFromOthers.length === 0 ? (
            <div className="text-center py-10 text-gray-600">
              <div className="text-3xl mb-2">🏜️</div>
              <div className="text-sm">No open challenges yet. Be the first to post one!</div>
            </div>
          ) : openFromOthers.map(c => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              isOwn={false}
              myPts={isTeamComplete ? myPreviewPts : undefined}
              onAccept={() => handleAccept(c.id)}
              onCopyLink={() => handleCopyLink(c.id)}
              isAccepting={accepting === c.id}
            />
          ))}

          {!isTeamComplete && openFromOthers.length > 0 && (
            <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300">
              <AlertCircle size={13} className="flex-shrink-0" />
              Complete your squad in "My Squad" before you can accept a challenge.
            </div>
          )}
        </div>
      )}

      {/* ── POST CHALLENGE ──────────────────────────────────────────────────── */}
      {tab === 'post' && (
        <div className="space-y-4">
          {!isTeamComplete && (
            <div className="flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-300">
              <AlertCircle size={15} className="flex-shrink-0" />
              You need a complete squad (11 starters + captain) before posting an H2H challenge.
              Go to ⚽ My Squad to finish your team.
            </div>
          )}

          {isTeamComplete && (
            <>
              {/* Squad preview */}
              <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Your Squad</div>
                <div className="flex items-center gap-3 mb-3">
                  {myPreviewPts > 0 ? (
                    <>
                      <div className="text-2xl font-black text-amber-400">{myPreviewPts}</div>
                      <div className="text-xs text-gray-500">pts (live)</div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-500 italic">Points visible after Jun 11</div>
                  )}
                  <div className="ml-auto text-sm font-bold text-white">{teamName}</div>
                </div>
                <SquadMini
                  starterIds={starterIds.filter(Boolean) as string[]}
                  captainId={captainId || ''}
                />
              </div>

              {/* ── Market Type selector ── */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Market Type</label>
                <div className="grid grid-cols-1 gap-2">
                  {(Object.keys(H2H_MARKETS) as H2HMarketType[]).map(mk => {
                    const m = H2H_MARKETS[mk];
                    const active = postMarket === mk;
                    return (
                      <button
                        key={mk}
                        onClick={() => setPostMarket(mk)}
                        className={`flex items-start gap-3 p-3 rounded-xl text-left border transition-all ${
                          active ? `${m.bgColor} border-opacity-60` : 'border-white/8 bg-white/[0.02] hover:border-white/15'
                        }`}
                      >
                        <span className="text-lg flex-shrink-0 mt-0.5">{m.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-black ${active ? m.color : 'text-gray-300'}`}>{m.label}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{m.longDesc}</div>
                        </div>
                        {active && (
                          <div className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border flex-shrink-0 mt-1 ${m.bgColor} ${m.color}`}>
                            SELECTED
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Top Scorer: pick your FWD ── */}
              {postMarket === 'top_scorer' && (() => {
                const myFwds = starterIds
                  .filter(Boolean)
                  .map(id => PLAYERS.find(p => p.id === id)!)
                  .filter(p => p && p.position === 'FWD');
                if (myFwds.length === 0) return (
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-xs text-orange-300">
                    You need at least 1 Forward in your starters to use Top Scorer market.
                  </div>
                );
                return (
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Your Top Scorer Nomination</label>
                    <div className="grid grid-cols-2 gap-2">
                      {myFwds.map(p => (
                        <button
                          key={p.id}
                          onClick={() => setPostFwdPickId(p.id)}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                            postFwdPickId === p.id
                              ? 'border-orange-500/50 bg-orange-500/10'
                              : 'border-white/8 bg-white/[0.03] hover:border-white/20'
                          }`}
                        >
                          <span className="text-base">{FLAG_EMOJI[p.country] || '🌍'}</span>
                          <div>
                            <div className="text-xs font-bold text-white">{p.name}</div>
                            <div className="text-[10px] text-orange-400">FWD · {p.country}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-1.5">
                      Taker will pick their own FWD when they accept. Most team goals from your pick's nation wins.
                    </div>
                  </div>
                );
              })()}

              {/* ── Over/Under: set the line and side ── */}
              {postMarket === 'over_under' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">
                      Goals Line (total goals from your squad's nations)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[2.5, 3.5, 4.5, 5.5, 6.5, 8.5].map(line => (
                        <button
                          key={line}
                          onClick={() => setPostGoalsLine(line)}
                          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                            postGoalsLine === line
                              ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                              : 'bg-white/[0.04] text-gray-400 border border-white/8 hover:text-gray-200'
                          }`}
                        >
                          {line}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Your Side</label>
                    <div className="flex gap-2">
                      {(['over', 'under'] as const).map(side => (
                        <button
                          key={side}
                          onClick={() => setPostOuSide(side)}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border ${
                            postOuSide === side
                              ? side === 'over'
                                ? 'bg-green-500/20 border-green-500/50 text-green-300'
                                : 'bg-red-500/20 border-red-500/50 text-red-300'
                              : 'bg-white/[0.04] border-white/8 text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {side === 'over' ? '⬆️ OVER' : '⬇️ UNDER'} {postGoalsLine}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-1.5">
                      Taker automatically gets the {postOuSide === 'over' ? 'UNDER' : 'OVER'} side.
                      Total goals counted from all nations in <em>both</em> squads' starting 11.
                    </div>
                  </div>
                </div>
              )}

              {/* Currency */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Currency</label>
                <div className="flex gap-2">
                  {(['SUI', 'SBETS'] as const).map(c => (
                    <button
                      key={c}
                      onClick={() => { setPostCurrency(c); setPostStake(STAKE_PRESETS[c][1]); }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border ${
                        postCurrency === c
                          ? c === 'SUI' ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                          : 'bg-white/[0.04] border-white/8 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {c === 'SUI' ? '💧 SUI' : '🟡 SBETS'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stake */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">
                  Stake — each player puts in {postStake} {postCurrency}
                </label>
                <div className="flex flex-wrap gap-2">
                  {STAKE_PRESETS[postCurrency].map(s => (
                    <button
                      key={s}
                      onClick={() => setPostStake(s)}
                      className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                        postStake === s && !STAKE_PRESETS[postCurrency].includes(postStake) === false
                          ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                          : postStake === s
                          ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                          : 'bg-white/[0.04] text-gray-400 border border-white/8 hover:text-gray-200'
                      }`}
                    >
                      {s} {postCurrency}
                    </button>
                  ))}
                </div>
                {/* Custom stake input */}
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min={postCurrency === 'SUI' ? 0.1 : 100}
                    step={postCurrency === 'SUI' ? 0.5 : 100}
                    value={postStake}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) setPostStake(v);
                    }}
                    className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-bold focus:outline-none focus:border-orange-500/50 transition-colors"
                    placeholder={`Custom amount in ${postCurrency}`}
                  />
                  <span className="text-xs text-gray-500 flex-shrink-0">{postCurrency}</span>
                </div>
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                  <Coins size={11} />
                  Winner takes <span className="text-green-400 font-bold">{pot.toFixed(2)} {postCurrency}</span> (pot minus 2% fee)
                </div>
              </div>

              {/* Gameweek scope */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Score Over</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(GAMEWEEK_LABELS) as Gameweek[]).map(gw => {
                    const { label, emoji, desc } = GAMEWEEK_LABELS[gw];
                    return (
                      <button
                        key={gw}
                        onClick={() => setPostGameweek(gw)}
                        className={`p-3 rounded-xl text-left border transition-all ${
                          postGameweek === gw
                            ? 'border-orange-500/50 bg-orange-500/10'
                            : 'border-white/8 bg-white/[0.02] hover:border-white/15'
                        }`}
                      >
                        <div className="text-sm font-bold text-white">{emoji} {label}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Summary & submit */}
              <div className={`border rounded-2xl p-4 space-y-2 ${H2H_MARKETS[postMarket].bgColor}`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${H2H_MARKETS[postMarket].color}`}>
                  {H2H_MARKETS[postMarket].emoji} Challenge Summary — {H2H_MARKETS[postMarket].label}
                </div>
                <div className="text-sm text-gray-300 space-y-1">
                  <div className="flex justify-between"><span className="text-gray-500">Your team</span><span className="font-bold">{teamName}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Market</span><span className={`font-bold ${H2H_MARKETS[postMarket].color}`}>{H2H_MARKETS[postMarket].label}</span></div>
                  {postMarket === 'top_scorer' && postFwdPickId && (() => {
                    const p = PLAYERS.find(pl => pl.id === postFwdPickId);
                    return p ? <div className="flex justify-between"><span className="text-gray-500">Your scorer pick</span><span className="font-bold text-orange-400">{p.name}</span></div> : null;
                  })()}
                  {postMarket === 'over_under' && (
                    <div className="flex justify-between"><span className="text-gray-500">Your bet</span><span className="font-bold text-purple-400">{postOuSide.toUpperCase()} {postGoalsLine} goals</span></div>
                  )}
                  {myPreviewPts > 0 && postMarket === 'squad_points' && (
                    <div className="flex justify-between"><span className="text-gray-500">Current pts</span><span className="font-bold text-amber-400">{myPreviewPts} pts (live)</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-gray-500">Stake</span><span className="font-bold">{postStake} {postCurrency}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Winner gets</span><span className="font-bold text-green-400">{pot.toFixed(2)} {postCurrency}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Scored over</span><span className="font-bold">{GAMEWEEK_LABELS[postGameweek].label}</span></div>
                </div>
              </div>

              <button
                onClick={handlePost}
                disabled={posting || !connectedWallet}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-black text-sm hover:from-orange-400 hover:to-red-400 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50"
              >
                {posting ? (
                  <><Loader2 size={14} className="animate-spin" /> Signing with wallet…</>
                ) : !connectedWallet ? (
                  <>Connect Wallet to Post</>
                ) : (
                  <><Send size={14} /> Post H2H Challenge — {postStake} {postCurrency}</>
                )}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── MY H2H BETS ────────────────────────────────────────────────────── */}
      {tab === 'mine' && (
        <div className="space-y-3">
          {myChallenges.length === 0 ? (
            <div className="text-center py-10 text-gray-600">
              <div className="text-3xl mb-2">⚔️</div>
              <div className="text-sm">No H2H bets yet. Post a challenge or accept one from another user.</div>
            </div>
          ) : myChallenges.map(c => (
            <div key={c.id}>
              <ChallengeCard
                challenge={c}
                isOwn={c.creatorWallet === wallet}
                onCopyLink={() => handleCopyLink(c.id)}
                onCancel={c.status === 'open' && c.creatorWallet === wallet ? () => handleCancel(c.id) : undefined}
                isCancelling={cancelling === c.id}
              />
              {c.status === 'matched' && c.takerStarterIds && c.takerCaptainId && (
                <div className="mt-2 bg-white/[0.02] border border-white/8 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Opponent Squad</div>
                  <SquadMini starterIds={c.takerStarterIds} captainId={c.takerCaptainId} />
                </div>
              )}
              {c.status === 'settled' && (
                <div className="mt-2 p-3 bg-white/[0.02] border border-white/8 rounded-xl">
                  <ScoreBar
                    creatorPts={c.creatorPreviewPts}
                    takerPts={c.takerPreviewPts ?? 0}
                    creatorName={c.creatorTeamName}
                    takerName={c.takerTeamName ?? 'Opponent'}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
