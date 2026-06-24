import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/hooks/use-toast';
import { useLocation, useSearch } from 'wouter';
import {
  Copy, ExternalLink, ChevronDown, ChevronUp, Info,
  TrendingUp, Trophy, Zap, Shield, Clock, AlertTriangle,
  BookOpen, Layers, FileCode, Loader2, Share2, Check,
  Star, Activity, MessageSquare, Search, Plus, ArrowRight, GitMerge,
} from 'lucide-react';
import { useUpcomingEvents } from '@/hooks/useEvents';
import { useBetting } from '@/context/BettingContext';
import { ToastAction } from '@/components/ui/toast';
import Layout from '@/components/layout/Layout';
import { useWebSocket, useWsOn } from '@/hooks/useWebSocket';
import { useSuiNSNameWithStatus } from '@/hooks/useSuiNSName';
import { DisputeCountdown } from '@/components/p2p/DisputeCountdown';
import { P2PContractModal } from '@/components/p2p/P2PContractModal';
import { P2POrderBook } from '@/components/p2p/P2POrderBook';
import { P2PClobBook } from '@/components/p2p/P2PClobBook';

// ─── Types ────────────────────────────────────────────────────────────────────

type Offer = {
  id: number;
  creatorWallet: string;
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  leagueName?: string;
  sportName?: string;
  prediction: string;
  odds: number;
  creatorStake: number;
  takerStake: number;
  currency: string;
  filledStake: number;
  status: string;
  expiresAt: string;
  matchDate?: string;
  createdAt: string;
  winner?: string;
  onchainOfferId?: string;
  // Sui-native feature extensions
  shareToken?: string;
  suinsGated?: boolean;
  liveOdds?: boolean;
  scoreSnapshot?: string;
  matchMinute?: number;
  // Walrus receipt fields
  walrusBlobId?: string | null;
  matchWalrusBlobId?: string | null;
  matchHasLocalReceipt?: boolean;
  checkpointSeq?: string | null;
  settlementTxHash?: string | null;
};

type ParlayOffer = {
  id: number;
  creatorWallet: string;
  totalOdds: number;
  legCount: number;
  legsWon: number;
  legsLost: number;
  creatorStake: number;
  takerStake: number;
  currency: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  takerWallet?: string;
  winner?: string;
  onchainParlayId?: string;
  legs: Array<{
    eventId: string;
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    prediction: string;
    odds: number;
    status: string;
    matchDate?: string;
  }>;
};

type VolumeTier = {
  name: string;
  minVolume: number;
  makerRebate: number;
  takerFee: number;
  color: string;
};

type VolumeStats = {
  walletAddress: string;
  totalVolumeMaker: number;
  totalVolumeTaker: number;
  totalVolume: number;
  totalBets: number;
  wonBets: number;
  totalNetPnl: number;
  tier: VolumeTier;
};

type TapeEntry = {
  type: 'single' | 'parlay';
  id: number;
  eventName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  prediction: string | null;
  odds: number;
  creatorStake: number;
  takerStake: number;
  totalPot: number;
  winner: 'creator' | 'taker' | null;
  creatorWallet: string | null;
  takerWallet: string | null;
  payoutAmount: number | null;
  payoutTxHash: string | null;
  settledAt: string | null;
  legCount: number | null;
};

type OnchainBook = {
  contractDeployed: boolean;
  packageId: string | null;
  registryId: string | null;
  configId: string | null;
  network: string;
  version: string;
  features: string[];
  supportedCoins: Array<{ symbol: string; type: string; default: boolean }>;
  suiscanUrls: { package: string | null; config: string | null; registry: string | null };
  disputeWindowMs: number;
  hipFourTiers: Array<{ name: string; minVolumeSUI: number; takerFeeBps: number; makerRebateBps: number; netFeeBps: number }>;
  description: string;
  onchainCounts: { openOffers: number; liveBets: number; openParlays: number } | null;
  dbCounts: { openOffers: number; openParlays: number };
  message: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const predictionLabel = (pred: string, homeTeam: string, awayTeam: string): string => {
  if (pred === 'home') return homeTeam;
  if (pred === 'away') return awayTeam;
  if (pred === 'draw') return 'Draw';
  if (pred === 'btts_yes') return 'BTTS Yes';
  if (pred === 'btts_no')  return 'BTTS No';
  if (pred === 'home_or_draw') return `${homeTeam} or Draw`;
  if (pred === 'away_or_draw') return `${awayTeam} or Draw`;
  if (pred === 'home_or_away') return 'Either Team Wins';
  const ouMatch = pred.match(/^(over|under)_([\d.]+)$/);
  if (ouMatch) return `${ouMatch[1] === 'over' ? 'Over' : 'Under'} ${ouMatch[2]}`;
  const hcapMatch = pred.match(/^(home|away)_([-+]?[\d.]+)$/);
  if (hcapMatch) {
    const side = hcapMatch[1] === 'home' ? homeTeam : awayTeam;
    const val = parseFloat(hcapMatch[2]);
    return `${side} ${val > 0 ? '+' : ''}${hcapMatch[2]}`;
  }
  return pred;
};

const oppositePrediction = (pred: string, homeTeam: string, awayTeam: string): string => {
  if (pred === 'home') return `${awayTeam} or Draw`;
  if (pred === 'away') return `${homeTeam} or Draw`;
  if (pred === 'draw') return `${homeTeam} or ${awayTeam}`;
  if (pred === 'btts_yes') return 'BTTS No';
  if (pred === 'btts_no')  return 'BTTS Yes';
  if (pred === 'home_or_draw') return awayTeam;
  if (pred === 'away_or_draw') return homeTeam;
  if (pred === 'home_or_away') return 'Draw';
  const ouMatch = pred.match(/^(over|under)_([\d.]+)$/);
  if (ouMatch) return `${ouMatch[1] === 'over' ? 'Under' : 'Over'} ${ouMatch[2]}`;
  const hcapMatch = pred.match(/^(home|away)_([-+]?[\d.]+)$/);
  if (hcapMatch) {
    const otherSide = hcapMatch[1] === 'home' ? awayTeam : homeTeam;
    const val = parseFloat(hcapMatch[2]);
    const opposite = -val;
    return `${otherSide} ${opposite > 0 ? '+' : ''}${opposite}`;
  }
  return 'opposite';
};

const formatTimeLeft = (expiresAt: string) => {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

function ExpiryCountdown({ expiresAt, matchDate, onchain }: { expiresAt: string; matchDate?: string; onchain?: boolean }) {
  const [, tick] = useState(0);

  // If the match has started, show a static "Match started" label — no ticking needed.
  const matchStartedMs = matchDate ? new Date(matchDate).getTime() : 0;

  useEffect(() => {
    // Don't tick if match already started (or if already expired)
    if (matchStartedMs > 0 && matchStartedMs <= Date.now()) return;
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return;
    const interval = diff < 300_000 ? 1000 : 60_000;
    const id = setInterval(() => tick(n => n + 1), interval);
    return () => clearInterval(id);
  }, [expiresAt, matchStartedMs, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 300_000)]);

  // Match has already kicked off — the offer should be or will be auto-expired.
  // Show a clear "Match started" label rather than a misleading offer-expiry countdown.
  if (matchStartedMs > 0 && matchStartedMs <= Date.now()) {
    return (
      <div className="text-amber-500/80 text-xs mt-1 flex items-center justify-end gap-1">
        <AlertTriangle size={9} />
        Match started
      </div>
    );
  }

  const diff = new Date(expiresAt).getTime() - Date.now();
  const urg = diff <= 0 ? 'expired' : diff < 60_000 ? 'urgent' : diff < 3_600_000 ? 'warning' : diff < 86_400_000 ? 'soon' : 'normal';

  const cls =
    urg === 'expired' ? 'text-gray-600' :
    urg === 'urgent'  ? 'text-red-400 animate-pulse' :
    urg === 'warning' ? 'text-orange-400' :
    urg === 'soon'    ? 'text-amber-400' :
                        'text-gray-500';

  let label: string;
  if (diff <= 0) {
    label = 'Expired';
  } else {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1_000);
    if (h > 48)  label = `${Math.floor(h / 24)}d ${h % 24}h`;
    else if (h > 0 && m === 0) label = `${h}h`;
    else if (h > 0)  label = `${h}h ${m}m`;
    else if (m >= 5) label = `${m}m`;
    else if (m > 0)  label = `${m}m ${s}s`;
    else             label = `${s}s`;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className={`${cls} text-xs flex items-center justify-end gap-1 tabular-nums`}>
        <Clock size={9} />
        {label}
      </div>
      {onchain && (
        <div className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.25)', color: 'rgba(0,255,255,0.7)' }}>
          ⛓ on-chain
        </div>
      )}
    </div>
  );
}

const formatDisputeCountdown = (queuedAtMs: number, windowMs = 7_200_000) => {
  const dueMs = queuedAtMs + windowMs;
  const diff  = dueMs - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const truncateWallet = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Convert decimal odds to the user's chosen display format. */
function formatOdds(dec: number | undefined | null, fmt: 'dec' | 'us' | 'frac'): string {
  const d = Number(dec ?? 0) || 0;
  if (fmt === 'dec') return `${d.toFixed(2)}x`;
  if (fmt === 'us') {
    if (d >= 2) return `+${Math.round((d - 1) * 100)}`;
    if (d <= 1) return '—';
    return `${Math.round(-100 / (d - 1))}`;
  }
  // Fractional: approximate with gcd
  const num = d - 1;
  const denom = 1;
  // Find a reasonable fraction up to /16
  let bestN = 1, bestD = 1, bestErr = Infinity;
  for (let d = 1; d <= 20; d++) {
    const n = Math.round(num * d);
    const err = Math.abs(n / d - num);
    if (err < bestErr) { bestErr = err; bestN = n; bestD = d; }
  }
  return `${bestN}/${bestD}`;
}

// Format number with non-breaking space as thousands separator
// e.g. 1000000.5 → "1 000 000.500"
function fmtN(n: number | undefined | null, dec = 3): string {
  const parts = (Number(n ?? 0) || 0).toFixed(dec).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return parts.join('.');
}

function calcPayoutPreview(takerStake: number, offer: Offer, takerFeeRate = 0.02, makerRebateRate = 0) {
  if (!takerStake || takerStake <= 0) return null;
  const creatorEquiv = offer.creatorStake * (takerStake / offer.takerStake);
  const grossPot = r3(takerStake + creatorEquiv);
  const takerFee = r3(grossPot * takerFeeRate);
  const makerRebate = r3(grossPot * makerRebateRate);
  const netFee = r3(takerFee - makerRebate);
  const winnerPayout = r3(grossPot - netFee);
  return { grossPot, takerFee, makerRebate, netFee, winnerPayout };
}

function calcParlayPayoutPreview(offer: ParlayOffer, takerFeeRate = 0.02, makerRebateRate = 0) {
  const grossPot = r3(offer.creatorStake + offer.takerStake);
  const takerFee = r3(grossPot * takerFeeRate);
  const makerRebate = r3(grossPot * makerRebateRate);
  const netFee = r3(takerFee - makerRebate);
  const winnerPayout = r3(grossPot - netFee);
  return { grossPot, takerFee, makerRebate, netFee, winnerPayout };
}

// ─── Tier Badge ───────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier?: VolumeTier | null }) {
  if (!tier) return null;
  const icons: Record<string, string> = { Bronze: '🥉', Silver: '🥈', Gold: '🥇', Diamond: '💎', Elite: '⚡' };
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border"
      style={{ color: tier.color, borderColor: tier.color + '50', background: tier.color + '15' }}
    >
      {icons[tier.name] ?? '🎖️'} {tier.name}
    </span>
  );
}

// ─── On-chain Badge ───────────────────────────────────────────────────────────

function OnchainBadge({ objectId }: { objectId?: string }) {
  if (!objectId) return null;
  return (
    <a
      href={`https://suiscan.xyz/mainnet/object/${objectId}`}
      target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:text-cyan-300 transition-colors"
      title="View on-chain object on SuiScan"
    >
      <Shield size={9} /> On-chain
    </a>
  );
}

// ─── Payout Breakdown ─────────────────────────────────────────────────────────

function PayoutBreakdown({
  grossPot, takerFee, makerRebate, netFee, winnerPayout, currency, takerTier, makerTier,
}: {
  grossPot: number; takerFee: number; makerRebate: number; netFee: number; winnerPayout: number;
  currency: string; takerTier?: VolumeTier | null; makerTier?: VolumeTier | null;
}) {
  return (
    <div className="bg-[#0d1420] border border-[#1e2a3a] rounded-xl p-4 space-y-2 text-sm">
      <div className="flex justify-between text-gray-400">
        <span>Gross pot</span>
        <span className="text-white font-medium">{fmtN(grossPot, 4)} {currency}</span>
      </div>
      <div className="flex justify-between text-gray-400">
        <span>
          Taker fee
          {takerTier && <span className="ml-1 text-xs" style={{ color: takerTier.color }}>({(takerTier.takerFee * 100).toFixed(2)}% · {takerTier.name})</span>}
        </span>
        <span className="text-red-400">−{fmtN(takerFee, 4)} {currency}</span>
      </div>
      {makerRebate > 0 && (
        <div className="flex justify-between text-gray-400">
          <span>
            Maker rebate
            {makerTier && <span className="ml-1 text-xs" style={{ color: makerTier.color }}>({(makerTier.makerRebate * 100).toFixed(2)}% · {makerTier.name})</span>}
          </span>
          <span className="text-green-400">+{fmtN(makerRebate, 4)} {currency}</span>
        </div>
      )}
      <div className="border-t border-[#1e2a3a] pt-2 flex justify-between font-bold">
        <span className="text-gray-300">You receive if you win</span>
        <span className="text-green-400 text-base">{fmtN(winnerPayout, 4)} {currency}</span>
      </div>
    </div>
  );
}

// ─── Contract Address Box ─────────────────────────────────────────────────────

function ContractAddressBox({ wallet, amount, currency, onchainEscrow }: { wallet: string; amount?: number; currency?: string; onchainEscrow?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(wallet); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  if (!wallet) return null;
  return (
    <div className={`border rounded-xl p-3 mb-4 ${onchainEscrow ? 'bg-cyan-400/8 border-cyan-500/30' : 'bg-yellow-400/10 border-yellow-500/25'}`}>
      <div className="flex items-start gap-2 mb-2">
        <span className={`text-sm ${onchainEscrow ? 'text-cyan-400' : 'text-yellow-400'}`}>{onchainEscrow ? '🔒' : '🔐'}</span>
        <div>
          <p className={`text-xs font-bold ${onchainEscrow ? 'text-cyan-400' : 'text-yellow-400'}`}>
            {amount != null && currency ? `Send exactly ${fmtN(amount, 4)} ${currency} to contract:` : 'Contract escrow — send your stake here:'}
          </p>
          <p className={`text-xs mt-0.5 ${onchainEscrow ? 'text-cyan-300/60' : 'text-yellow-300/60'}`}>
            {onchainEscrow
              ? 'On-chain escrow: funds locked in a P2PMatchedBet object. Oracle settles instantly — winner paid in the same transaction.'
              : 'Funds held securely until match settles. Winner receives payout automatically on-chain.'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
        <span className="text-gray-200 text-xs font-mono flex-1 truncate">{wallet}</span>
        <button onClick={copy} className="text-gray-400 hover:text-cyan-400 transition-colors" title="Copy">
          <Copy size={13} />
        </button>
        <a href={`https://suiscan.xyz/mainnet/account/${wallet}`} target="_blank" rel="noopener noreferrer"
          className="text-gray-400 hover:text-cyan-400 transition-colors" title="View on SuiScan">
          <ExternalLink size={13} />
        </a>
      </div>
      {copied && <p className="text-cyan-400 text-xs mt-1">Copied!</p>}
    </div>
  );
}

// ─── Fund Flow Explainer ──────────────────────────────────────────────────────

function FundFlowPanel({ onchainEscrow }: { onchainEscrow?: boolean }) {
  const steps = onchainEscrow ? [
    { icon: '💸', label: 'You send stake', sub: 'Coin transferred via Sui wallet', color: 'text-orange-400' },
    { icon: '🔒', label: 'Contract locks funds', sub: 'P2PMatchedBet object on mainnet', color: 'text-cyan-400' },
    { icon: '⚡', label: 'Instant oracle settle', sub: 'Winner paid atomically — same tx', color: 'text-purple-400' },
    { icon: '🏆', label: 'Winner paid', sub: 'Paid directly from contract escrow', color: 'text-green-400' },
  ] : [
    { icon: '💸', label: 'You send stake', sub: 'Sent to contract wallet on-chain', color: 'text-orange-400' },
    { icon: '🔐', label: 'Contract holds funds', sub: 'Both stakes locked in platform wallet', color: 'text-yellow-400' },
    { icon: '🏆', label: 'Winner paid', sub: 'Sui blockchain tx sent automatically', color: 'text-green-400' },
  ];
  return (
    <div className="bg-[#0d1420] border border-cyan-500/20 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={14} className="text-cyan-400" />
        <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider">How funds work</span>
        {onchainEscrow && <span className="text-xs font-bold text-cyan-400 bg-cyan-500/15 px-2 py-0.5 rounded-full border border-cyan-500/30">On-chain Escrow</span>}
      </div>
      <div className={`flex items-stretch gap-2 text-xs ${onchainEscrow ? 'flex-wrap' : ''}`}>
        {steps.map((step, i) => (
          <div key={i} className="flex-1 bg-[#111827] rounded-lg p-2 text-center min-w-[70px]">
            <div className="text-lg mb-1">{step.icon}</div>
            <div className={`font-bold ${step.color}`}>{step.label}</div>
            <div className="text-gray-500 mt-0.5">{step.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Parlay Explainer ─────────────────────────────────────────────────────────

function ParlayRulesPanel() {
  return (
    <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Layers size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-purple-400 text-xs font-bold uppercase tracking-wider">How P2P Parlays Work</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
          <div className="text-green-400 font-bold mb-1">Creator wins if…</div>
          <div className="text-gray-300">ALL {'>'}= 2 legs hit. Every prediction must be correct. Impossible to win partially — it's all or nothing.</div>
        </div>
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
          <div className="text-orange-400 font-bold mb-1">Taker wins if…</div>
          <div className="text-gray-300">ANY leg fails. You only need ONE wrong prediction to win the whole pot. Legs settle independently on Sui.</div>
        </div>
      </div>
      <div className="mt-3 text-gray-500 text-xs">
        <span className="text-cyan-400 font-medium">Payout math:</span> grossPot = creatorStake + takerStake. Winner receives grossPot − platform fee. Each leg settles independently via Sui parallel execution.
      </div>
    </div>
  );
}

// ─── On-chain Transaction Feed ───────────────────────────────────────────────

type OnchainTxEntry = {
  digest: string;
  fn: string;
  rawFn: string;
  module: string;
  status: string;
  timestampMs: number | null;
  suiscanUrl: string;
};

const FN_COLOR: Record<string, string> = {
  create_offer: '#4da2ff',
  accept_offer: '#22c55e',
  settle:       '#fbbf24',
  cancel:       '#6b7280',
  dispute:      '#f97316',
  reclaim:      '#a78bfa',
};

const FN_ICON: Record<string, string> = {
  create_offer: '📋',
  accept_offer: '🤝',
  settle:       '⚡',
  cancel:       '✕',
  dispute:      '⚠',
  reclaim:      '↩',
};

function txTimeAgo(ms: number | null): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function shortDigest(d: string): string {
  return `${d.slice(0, 8)}…${d.slice(-5)}`;
}

function OnchainTxFeed({ entries, packageId, stale }: {
  entries: OnchainTxEntry[];
  packageId?: string;
  stale?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-[#0d1420] border border-[#1e2a3a] rounded-xl mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Activity size={14} className="text-green-400 flex-shrink-0" />
          <span className="text-green-400 text-xs font-bold uppercase tracking-wider flex-shrink-0">Live On-chain</span>
          {entries.length > 0 && (
            <>
              <span className="text-gray-500 text-[10px]">·</span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400 truncate">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0"
                  style={{ boxShadow: '0 0 4px #22c55e' }}
                />
                {entries[0]?.fn} · {shortDigest(entries[0]?.digest ?? '')}
              </span>
            </>
          )}
          {stale && <span className="text-yellow-500/60 text-[9px] flex-shrink-0">cached</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 text-[10px]">{entries.length} txs</span>
          {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.04] max-h-64 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-600 text-xs">
              No on-chain transactions found for this contract yet.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.03]">
              {entries.map((e) => {
                const color = FN_COLOR[e.fn] ?? '#9ca3af';
                const icon  = FN_ICON[e.fn] ?? '·';
                const ok    = e.status === 'success';
                return (
                  <div key={e.digest} className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02] transition-colors group">
                    <span className="text-sm flex-shrink-0 w-4 text-center">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[11px] font-bold"
                          style={{ color }}
                        >
                          {e.fn}
                        </span>
                        <span className={`text-[9px] px-1 rounded ${ok ? 'text-green-500/70' : 'text-red-400/70'}`}>
                          {ok ? '✓' : '✗'}
                        </span>
                      </div>
                      <div className="text-gray-600 text-[10px] font-mono truncate">{e.module}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-gray-500 text-[10px]">{txTimeAgo(e.timestampMs)}</div>
                      <a
                        href={e.suiscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] text-gray-600 hover:text-[#4da2ff] transition-colors font-mono"
                        onClick={e => e.stopPropagation()}
                      >
                        {shortDigest(e.digest)}
                        <ExternalLink size={9} className="opacity-50 group-hover:opacity-100" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {packageId && (
            <div className="px-3 py-2 border-t border-white/[0.04] flex items-center justify-between">
              <span className="text-gray-700 text-[9px] font-mono">pkg: {packageId.slice(0, 14)}…</span>
              <a
                href={`https://suiscan.xyz/mainnet/object/${packageId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-[#4da2ff]/50 hover:text-[#4da2ff] flex items-center gap-0.5 transition-colors"
              >
                View contract <ExternalLink size={8} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── HIP-4 Fee Tiers Panel ────────────────────────────────────────────────────

function FeeTiersPanel({ tiers, myVolumeData }: { tiers: VolumeTier[]; myVolumeData?: VolumeStats | null }) {
  const [open, setOpen] = useState(false);

  const myVolume   = myVolumeData?.totalVolume ?? 0;
  const myTier     = myVolumeData?.tier ?? null;
  const tierIdx    = myTier ? tiers.findIndex(t => t.name === myTier.name) : -1;
  const nextTier   = tierIdx >= 0 && tierIdx < tiers.length - 1 ? tiers[tierIdx + 1] : null;
  const prevMin    = myTier ? myTier.minVolume : 0;
  const nextMin    = nextTier ? nextTier.minVolume : 0;
  const rangeSize  = nextTier ? nextMin - prevMin : 1;
  const progress   = nextTier ? Math.min(100, ((myVolume - prevMin) / rangeSize) * 100) : 100;
  const remaining  = nextTier ? Math.max(0, nextMin - myVolume) : 0;

  const fmtVol = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` :
    v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` :
    v.toFixed(1);

  return (
    <div className="bg-[#0d1420] border border-[#1e2a3a] rounded-xl mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <TrendingUp size={14} className="text-cyan-400 flex-shrink-0" />
          <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider flex-shrink-0">HIP-4 Fee Engine</span>
          {myTier ? (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: myTier.color + '22', color: myTier.color, border: `1px solid ${myTier.color}44` }}
            >
              {myTier.name}
            </span>
          ) : (
            <span className="text-gray-500 text-xs truncate">· Taker fees get cheaper the more you trade</span>
          )}
          {myTier && nextTier && (
            <span className="text-gray-500 text-[10px] truncate">
              · {fmtVol(remaining)} SUI to {nextTier.name}
            </span>
          )}
          {myTier && !nextTier && (
            <span className="text-[10px] text-yellow-400/80">· Max tier reached 🏆</span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-gray-500 flex-shrink-0" /> : <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />}
      </button>

      {/* Wallet tier progress — always visible when wallet connected */}
      {myTier && (
        <div className="px-3 pb-3 border-t border-white/[0.04]">
          <div className="mt-2.5 mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold" style={{ color: myTier.color }}>{myTier.name} Tier</span>
              <span className="text-gray-500 text-[10px]">· {fmtVol(myVolume)} SUI lifetime volume</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-red-400">Fee: {(myTier.takerFee * 100).toFixed(2)}%</span>
              {myTier.makerRebate > 0 && (
                <span className="text-green-400">Rebate: +{(myTier.makerRebate * 100).toFixed(2)}%</span>
              )}
            </div>
          </div>

          {nextTier ? (
            <>
              <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${progress}%`,
                    background: `linear-gradient(90deg, ${myTier.color}cc, ${nextTier.color}99)`,
                    boxShadow: `0 0 6px ${myTier.color}66`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] text-gray-600">{myTier.name} ({fmtVol(prevMin)} SUI)</span>
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: nextTier.color }}
                >
                  {fmtVol(remaining)} SUI → {nextTier.name}
                  {nextTier.makerRebate > 0 && (
                    <span className="text-green-400 ml-1">· earn {(nextTier.makerRebate * 100).toFixed(2)}% rebates</span>
                  )}
                </span>
                <span className="text-[9px] text-gray-600">{nextTier.name} ({fmtVol(nextMin)} SUI)</span>
              </div>
            </>
          ) : (
            <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${myTier.color}cc, ${myTier.color}44)` }} />
          )}
        </div>
      )}

      {open && (
        <div className="px-3 pb-3 border-t border-white/[0.04]">
          <div className="grid grid-cols-5 gap-1.5 mb-2 mt-2.5">
            {tiers.map((tier) => {
              const isActive = myTier?.name === tier.name;
              return (
                <div
                  key={tier.name}
                  className="rounded-lg p-2 text-center text-xs transition-all"
                  style={{
                    background: isActive ? tier.color + '22' : tier.color + '0d',
                    border: `1px solid ${isActive ? tier.color + '66' : tier.color + '25'}`,
                    boxShadow: isActive ? `0 0 10px ${tier.color}22` : 'none',
                  }}
                >
                  <div className="font-bold mb-1 flex items-center justify-center gap-0.5" style={{ color: tier.color }}>
                    {tier.name}
                    {isActive && <span className="text-[8px] opacity-80">✓</span>}
                  </div>
                  <div className="text-gray-400 text-[10px]">{tier.minVolume >= 1000 ? `${tier.minVolume / 1000}K+` : tier.minVolume === 0 ? '0+' : `${tier.minVolume}+`} SUI</div>
                  <div className="text-red-400 mt-1 text-[10px]">Fee: {(tier.takerFee * 100).toFixed(2)}%</div>
                  {tier.makerRebate > 0
                    ? <div className="text-green-400 text-[10px]">+{(tier.makerRebate * 100).toFixed(2)}% rebate</div>
                    : <div className="text-gray-600 text-[10px]">No rebate</div>}
                </div>
              );
            })}
          </div>
          <p className="text-gray-600 text-xs mt-2">Maker = offer creator · Taker = offer acceptor · Net fee = taker fee − maker rebate. Elite makers earn a rebate on every bet filled.</p>
        </div>
      )}
    </div>
  );
}

// ─── Offer Card ───────────────────────────────────────────────────────────────

function OfferCard({ offer, onAccept, onCancel, onReclaimContract, reclaimingId, myWallet, oddsFormat = 'dec' }: {
  offer: Offer;
  onAccept: (o: Offer) => void;
  onCancel?: (info: { id: number; onchainOfferId?: string; currency?: string }) => void;
  onReclaimContract?: (info: { id: number; onchainOfferId: string; currency?: string }) => void;
  reclaimingId?: number | null;
  myWallet?: string;
  oddsFormat?: 'dec' | 'us' | 'frac';
}) {
  const isOwn = offer.creatorWallet === myWallet;
  const remaining = r3(offer.takerStake - (offer.filledStake ?? 0));
  const filledPct = offer.takerStake > 0 ? ((offer.filledStake ?? 0) / offer.takerStake) * 100 : 0;
  const grossPotFull = r3(offer.creatorStake + offer.takerStake);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Prefer the zkSend challenge link (single-use, direct-accept URL)
    let url = offer.shareToken
      ? `${window.location.origin}/p2p/c/${offer.shareToken}`
      : `${window.location.origin}/p2p/offer/${offer.id}`;
    try {
      const res = await fetch(`/api/p2p/offers/${offer.id}/share-link`);
      if (res.ok) { const d = await res.json(); if (d.shareUrl) url = d.shareUrl; }
    } catch (_) {}
    const predLbl = offer.prediction === 'home' ? offer.homeTeam : offer.prediction === 'away' ? offer.awayTeam : 'Draw';
    const maxWin = r3((offer.creatorStake + offer.takerStake) * 0.98);
    const tweetText = `🎯 P2P Bet: ${offer.homeTeam} vs ${offer.awayTeam}\n${predLbl} @ ${Number(offer.odds ?? 0).toFixed(2)}x odds\n💰 Max win: ${maxWin} ${offer.currency}\n\nAccept my challenge 👇`;
    const doCopy = () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {
          const el = Object.assign(document.createElement('textarea'), { value: url });
          Object.assign(el.style, { position: 'fixed', left: '-9999px', top: '-9999px', opacity: '0' });
          document.body.appendChild(el); el.select();
          try { document.execCommand('copy'); } catch {}
          document.body.removeChild(el);
        });
      } else {
        const el = Object.assign(document.createElement('textarea'), { value: url });
        Object.assign(el.style, { position: 'fixed', left: '-9999px', top: '-9999px', opacity: '0' });
        document.body.appendChild(el); el.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(el);
      }
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    };
    if (navigator.share) {
      navigator.share({ title: `P2P Bet: ${offer.eventName}`, text: tweetText, url }).catch(() => doCopy());
    } else {
      doCopy();
    }
  };
  // Client-side guard: block accept when match has already kicked off
  // Use expiresAt (server-capped at matchDate) as the primary guard, with matchDate as defence-in-depth.
  // No 5-minute buffer — strict check to prevent betting on live matches.
  const offerExpired = new Date(offer.expiresAt).getTime() <= Date.now();
  const matchStarted = !isOwn && (offerExpired || (!!offer.matchDate && new Date(offer.matchDate).getTime() <= Date.now()));

  const statusColor: Record<string, string> = {
    open: 'text-green-400', filled: 'text-blue-400', settled: 'text-purple-400',
    cancelled: 'text-gray-500', expired: 'text-gray-500',
  };

  return (
    <div className={`rounded-2xl p-4 transition-all duration-200 relative overflow-hidden group ${
      offer.status === 'open' ? 'opacity-100' : 'opacity-65'
    }`}
      style={{
        background: 'linear-gradient(135deg, #0d1828 0%, #0a1520 100%)',
        border: offer.status === 'open' ? '1px solid rgba(0,200,220,0.18)' : '1px solid rgba(255,255,255,0.06)',
        boxShadow: offer.status === 'open' ? '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,255,255,0.04)' : 'none',
      }}
      onMouseEnter={e => { if (offer.status === 'open') (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,255,255,0.08)'; }}
      onMouseLeave={e => { if (offer.status === 'open') (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,255,255,0.04)'; }}
    >
      {/* Top strip for own offers */}
      {isOwn && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-purple-500/60 to-transparent" />}

      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <div className="text-white font-bold text-sm truncate leading-tight">{offer.eventName}</div>
            {offer.onchainOfferId && <OnchainBadge objectId={offer.onchainOfferId} />}
            {offer.suinsGated && (
              <span title="VIP Pool: taker must own a .sui name to accept"
                className="flex items-center gap-0.5 text-[10px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 cursor-help"
                style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)', color: '#a78bfa' }}>
                <Star size={9} /> VIP
              </span>
            )}
            {offer.liveOdds && (
              <span title="Live In-Play: offer is voided automatically if the score changes before someone accepts"
                className="flex items-center gap-0.5 text-[10px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 animate-pulse cursor-help"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}>
                <Activity size={9} /> LIVE{offer.scoreSnapshot ? ` ${offer.scoreSnapshot.replace('-', ' – ')}` : ''}
                {offer.matchMinute !== undefined && offer.matchMinute !== null ? ` ${offer.matchMinute}'` : ''}
              </span>
            )}
            {!isOwn && filledPct > 0 && filledPct < 100 && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(0,255,255,0.12)', border: '1px solid rgba(0,255,255,0.4)', color: '#00ffff' }}>
                {filledPct.toFixed(0)}% filled · {fmtN(remaining)} left
              </span>
            )}
          </div>
          <div className="text-gray-600 text-xs">{offer.leagueName ?? ''}{offer.sportName ? ` · ${offer.sportName}` : ''}</div>
        </div>
        <div className="text-right flex-shrink-0 pl-2">
          <div className="font-black text-2xl leading-none tabular-nums" style={{ background: 'linear-gradient(135deg,#00ffff,#00d4e0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {formatOdds(offer.odds, oddsFormat)}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5 font-mono">
            {(100 / offer.odds).toFixed(1)}% implied
          </div>
          <ExpiryCountdown expiresAt={offer.expiresAt} matchDate={offer.matchDate} onchain={!!offer.onchainOfferId} />
        </div>
      </div>

      <div className="flex items-stretch gap-2 mb-3">
        <div className="flex-1 rounded-xl p-2.5 text-center" style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)' }}>
          <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-bold">Creator</div>
          <div className="text-green-400 font-bold text-xs leading-tight mb-1">{predictionLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}</div>
          <div className="text-white font-black text-sm">{fmtN(offer.creatorStake)} <span className="text-gray-500 font-normal text-xs">{offer.currency}</span></div>
        </div>
        <div className="flex items-center text-gray-600 font-black text-base px-0.5 flex-shrink-0 self-center">⚔</div>
        <div className="flex-1 rounded-xl p-2.5 text-center" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
          <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-bold">{isOwn ? 'Taker risks' : 'You risk'}</div>
          <div className="text-orange-400 font-bold text-xs leading-tight mb-1">{oppositePrediction(offer.prediction, offer.homeTeam, offer.awayTeam)}</div>
          <div className="text-white font-black text-sm">{fmtN(
            (offer.status === 'open' || offer.status === 'partial')
              ? (remaining > 0 ? remaining : offer.takerStake)
              : (offer.filledStake && offer.filledStake > 0 ? offer.filledStake : offer.takerStake)
          )} <span className="text-gray-500 font-normal text-xs">{offer.currency}</span></div>
        </div>
      </div>

      {!isOwn && offer.status === 'open' && (
        <div className="rounded-xl px-3 py-2 mb-3 flex items-center justify-between" style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.12)' }}>
          <span className="text-gray-500 text-xs">Max win</span>
          <span className="text-green-400 font-black text-sm">≈{fmtN(r3(grossPotFull * 0.98))} <span className="text-gray-500 font-normal text-xs">{offer.currency}</span></span>
        </div>
      )}

      {offer.winner && (
        <div className={`text-xs font-black text-center rounded-xl py-2 mb-3 tracking-wide ${offer.winner === 'creator' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
          {offer.winner === 'creator' ? '🏆 Creator won' : '🏆 Taker won'}
        </div>
      )}

      {filledPct > 0 && filledPct < 100 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-gray-600">Filled</span>
            <span className="text-cyan-500 font-bold">{filledPct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${filledPct}%`, background: 'linear-gradient(90deg, #00bcd4, #00ffff)', boxShadow: '0 0 6px rgba(0,255,255,0.5)' }} />
          </div>
        </div>
      )}

      {isOwn && (() => {
        const blobId = offer.matchWalrusBlobId || offer.walrusBlobId;
        const isPending = offer.matchHasLocalReceipt && !blobId;
        if (!blobId && !isPending) return null;
        return (
          <div className="mb-3 pt-2 border-t border-white/5">
            {isPending || (blobId && blobId.startsWith('local_')) ? (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span>🐋</span>
                <span>Receipt pending upload…</span>
              </div>
            ) : blobId ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">🐋</span>
                <a
                  href={`/walrus-receipt/${blobId}`}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                >
                  <ExternalLink size={11} />
                  View Receipt
                </a>
                <span className="text-gray-700 text-xs">·</span>
                <a
                  href={`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-400/70 hover:text-purple-400 flex items-center gap-1 transition-colors"
                >
                  Raw <ExternalLink size={11} />
                </a>
                <span className="text-gray-700 text-xs">·</span>
                <a
                  href={`https://walruscan.com/mainnet/blob/${blobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 px-2 py-0.5 rounded-full transition-colors"
                >
                  <Shield size={11} />
                  Verify on Walrus
                </a>
              </div>
            ) : null}
          </div>
        );
      })()}

      <div className="flex justify-between items-center pt-1">
        <div className="flex items-center gap-1.5">
          <div className="text-xs text-gray-500 font-mono">By {truncateWallet(offer.creatorWallet)}</div>
          {!isOwn && (
            <button
              onClick={handleShare}
              title="Share this offer"
              className="p-1 rounded-md transition-colors text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10"
            >
              {shareCopied ? <Check size={11} className="text-green-400" /> : <Share2 size={11} />}
            </button>
          )}
          <a
            href={`/messaging?eventId=${encodeURIComponent(offer.eventId)}`}
            title="Discuss in encrypted chat"
            onClick={e => e.stopPropagation()}
            className="p-1 rounded-md transition-colors text-gray-600 hover:text-cyan-400 hover:bg-cyan-500/10"
          >
            <MessageSquare size={11} />
          </a>
        </div>
        {isOwn ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              title="Copy shareable link"
              className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg border transition-all ${shareCopied ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20 hover:bg-cyan-500/20'}`}
            >
              {shareCopied ? <><Check size={10} /> Copied!</> : <><Share2 size={10} /> Share</>}
            </button>
            <span className="text-[10px] text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-1 rounded-full font-bold">YOUR OFFER</span>
            {offer.status === 'open' && onCancel && (
              confirmCancel ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => onCancel({ id: offer.id, onchainOfferId: offer.onchainOfferId, currency: offer.currency })}
                    className="text-xs text-red-400 bg-red-500/20 hover:bg-red-500/30 border border-red-500/20 px-2 py-1 rounded-lg font-bold transition-all">
                    Confirm
                  </button>
                  <button onClick={() => setConfirmCancel(false)}
                    className="text-xs text-gray-400 bg-gray-800/80 hover:bg-gray-700 px-2 py-1 rounded-lg transition-all">
                    Keep
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmCancel(true)}
                  className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/15 px-2 py-1 rounded-lg transition-all font-bold">
                  Cancel
                </button>
              )
            )}
            {offer.status === 'cancelled' && offer.onchainOfferId && onReclaimContract && (
              <button
                onClick={() => onReclaimContract({ id: offer.id, onchainOfferId: offer.onchainOfferId!, currency: offer.currency })}
                disabled={reclaimingId === offer.id}
                className="text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/15 px-2 py-1 rounded-lg transition-all font-bold disabled:opacity-50 flex items-center gap-1"
              >
                {reclaimingId === offer.id ? <Loader2 size={10} className="animate-spin" /> : null}
                {reclaimingId === offer.id ? 'Reclaiming…' : 'Reclaim Funds'}
              </button>
            )}
          </div>
        ) : offer.status === 'open' && matchStarted ? (
          <span className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg font-bold">
            Match started
          </span>
        ) : offer.status === 'open' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              title="Share on X"
              className="p-2 rounded-xl transition-colors text-gray-400 hover:text-white hover:bg-white/5 border border-white/10"
            >
              {shareCopied ? <Check size={13} className="text-green-400" /> : <Share2 size={13} />}
            </button>
            <button onClick={() => onAccept(offer)}
              className="font-black px-5 py-2 rounded-xl text-sm transition-all text-black"
              style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)', boxShadow: '0 0 14px rgba(0,255,255,0.3)' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 22px rgba(0,255,255,0.5)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 14px rgba(0,255,255,0.3)')}>
              Accept
            </button>
          </div>
        ) : (
          <span className={`text-xs px-2 py-1 rounded-lg font-bold border ${statusColor[offer.status] ?? 'text-gray-400'}`} style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}>
            {offer.status.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Parlay Card ──────────────────────────────────────────────────────────────

function ParlayCard({ offer, onAccept, onCancel, myWallet }: { offer: ParlayOffer; onAccept: (o: ParlayOffer) => void; onCancel?: (info: { id: number; onchainParlayId?: string; currency?: string }) => void; myWallet?: string }) {
  const isOwn = offer.creatorWallet === myWallet;
  const [expanded, setExpanded] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const winPayout = r3((offer.creatorStake + offer.takerStake) * 0.98);

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/p2p/parlay/${offer.id}`;
    const legSummary = offer.legs.slice(0, 3).map(l => `${l.homeTeam} vs ${l.awayTeam}`).join(', ');
    const tweetText = `🎰 ${offer.legCount}-Leg Parlay @ ${Number(offer.totalOdds ?? 0).toFixed(2)}x\n${legSummary}${offer.legs.length > 3 ? ` +${offer.legs.length - 3} more` : ''}\n💰 Win ${winPayout.toFixed(3)} ${offer.currency}\n\nAccept my parlay on SuiBets 👇`;
    const doCopy = () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {
          const el = Object.assign(document.createElement('textarea'), { value: url });
          Object.assign(el.style, { position: 'fixed', left: '-9999px', top: '-9999px', opacity: '0' });
          document.body.appendChild(el); el.select();
          try { document.execCommand('copy'); } catch {}
          document.body.removeChild(el);
        });
      } else {
        const el = Object.assign(document.createElement('textarea'), { value: url });
        Object.assign(el.style, { position: 'fixed', left: '-9999px', top: '-9999px', opacity: '0' });
        document.body.appendChild(el); el.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(el);
      }
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    };
    if (navigator.share) {
      navigator.share({ title: `${offer.legCount}-Leg Parlay on SuiBets`, text: tweetText, url }).catch(() => doCopy());
    } else {
      doCopy();
    }
  };
  // Client-side guard: block accept when any leg's match has already kicked off
  // Strict check — no 5-minute buffer. Use expiresAt (capped at earliest leg kickoff) as primary,
  // with per-leg matchDate as defence-in-depth. Prevents betting on already-started parlays.
  const parlayExpired = new Date(offer.expiresAt).getTime() <= Date.now();
  const matchStarted = !isOwn && (parlayExpired || offer.legs?.some(
    l => l.matchDate && new Date(l.matchDate).getTime() <= Date.now()
  ));

  return (
    <div className={`rounded-2xl p-4 transition-all duration-200 relative overflow-hidden ${offer.status === 'open' ? 'opacity-100' : 'opacity-65'}`}
      style={{
        background: 'linear-gradient(135deg, #100d22 0%, #0a0e1a 100%)',
        border: offer.status === 'open' ? '1px solid rgba(168,85,247,0.22)' : '1px solid rgba(255,255,255,0.06)',
        boxShadow: offer.status === 'open' ? '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(168,85,247,0.05)' : 'none',
      }}
      onMouseEnter={e => { if (offer.status === 'open') (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 32px rgba(0,0,0,0.5), 0 0 20px rgba(168,85,247,0.10)'; }}
      onMouseLeave={e => { if (offer.status === 'open') (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(168,85,247,0.05)'; }}
    >
      {isOwn && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-purple-500/70 to-transparent" />}

      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-black text-purple-300 bg-purple-500/15 border border-purple-500/25 px-2 py-0.5 rounded-full tracking-wider">{offer.legCount}-LEG PARLAY</span>
            <span className="text-gray-700 text-xs">{offer.currency}</span>
            {offer.onchainParlayId && <OnchainBadge objectId={offer.onchainParlayId} />}
          </div>
          <div className="text-white text-sm font-bold leading-tight line-clamp-1">
            {offer.legs.slice(0, 3).map(l => l.homeTeam.split(' ').pop()).join(' · ')}
            {offer.legs.length > 3 && <span className="text-gray-500"> +{offer.legs.length - 3}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-black text-2xl leading-none tabular-nums" style={{ background: 'linear-gradient(135deg,#c084fc,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {Number(offer.totalOdds ?? 0).toFixed(2)}x
          </div>
          <ExpiryCountdown expiresAt={offer.expiresAt} matchDate={offer.legs[0]?.matchDate} onchain={!!offer.onchainOfferId} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)' }}>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">Creator</div>
          <div className="text-green-400 font-black text-lg leading-none">{fmtN(offer.creatorStake)}</div>
          <div className="text-gray-600 text-[10px] mt-1">{offer.currency} · ALL legs win</div>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">{isOwn ? 'Taker' : 'You'}</div>
          <div className="text-orange-400 font-black text-lg leading-none">{fmtN(offer.takerStake)}</div>
          <div className="text-gray-600 text-[10px] mt-1">{offer.currency} · ANY leg fails</div>
        </div>
      </div>

      {offer.status === 'open' && !isOwn && (
        <div className="rounded-xl px-3 py-2 mb-3 flex items-center justify-between" style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.12)' }}>
          <span className="text-gray-500 text-xs">If you win</span>
          <span className="text-green-400 font-black text-sm">≈{fmtN(winPayout)} <span className="text-gray-500 font-normal text-xs">{offer.currency}</span></span>
        </div>
      )}

      {offer.winner && (
        <div className={`text-xs font-black text-center rounded-xl py-2 mb-3 tracking-wide border ${offer.winner === 'creator' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
          {offer.winner === 'creator' ? `🏆 Creator won (${offer.legsWon}/${offer.legCount} legs)` : `🏆 Taker won (leg failed)`}
        </div>
      )}

      {offer.status === 'settling' && (
        <div className="rounded-xl px-3 py-2 mb-3 text-xs text-center font-bold" style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', color: '#60a5fa' }}>
          <Loader2 size={11} className="inline mr-1.5 animate-spin" />Settling… {offer.legsWon}/{offer.legCount} legs done
        </div>
      )}

      <button onClick={() => setExpanded(!expanded)}
        className="text-gray-600 text-xs hover:text-purple-400 transition-colors mb-2.5 flex items-center gap-1 font-medium">
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? 'Hide legs' : `View ${offer.legCount} legs`}
      </button>

      {expanded && (
        <div className="space-y-1.5 mb-3">
          {offer.legs.map((leg, i) => {
            const legStatusIcon = leg.status === 'won' ? '✅' : leg.status === 'lost' ? '❌' : '⏳';
            return (
              <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex-1 min-w-0 mr-2">
                  <div className="text-white text-xs font-medium truncate">{leg.eventName}</div>
                  <div className="text-green-400 text-xs mt-0.5">{predictionLabel(leg.prediction, leg.homeTeam, leg.awayTeam)}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-purple-400 font-bold text-xs tabular-nums">{Number(leg.odds ?? 0).toFixed(2)}x</span>
                  {leg.status !== 'pending' && <span className="text-sm">{legStatusIcon}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-between items-center pt-1">
        <div className="flex items-center gap-1.5">
          <div className="text-xs text-gray-500 font-mono">By {truncateWallet(offer.creatorWallet ?? '')}</div>
          {!isOwn && (
            <button
              onClick={handleShare}
              title="Share this parlay"
              className="p-1 rounded-md transition-colors text-gray-400 hover:text-purple-400 hover:bg-purple-500/10"
            >
              {shareCopied ? <Check size={11} className="text-green-400" /> : <Share2 size={11} />}
            </button>
          )}
        </div>
        {isOwn ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              title="Copy shareable link"
              className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg border transition-all ${shareCopied ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-purple-400 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20'}`}
            >
              {shareCopied ? <><Check size={10} /> Copied!</> : <><Share2 size={10} /> Share</>}
            </button>
            <span className="text-[10px] text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-1 rounded-full font-bold">YOUR PARLAY</span>
            {offer.status === 'open' && onCancel && (
              confirmCancel ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => onCancel({ id: offer.id, onchainParlayId: offer.onchainParlayId, currency: offer.currency })}
                    className="text-xs text-red-400 bg-red-500/20 hover:bg-red-500/30 border border-red-500/20 px-2 py-1 rounded-lg font-bold transition-all">Confirm</button>
                  <button onClick={() => setConfirmCancel(false)}
                    className="text-xs text-gray-400 bg-gray-800/80 hover:bg-gray-700 px-2 py-1 rounded-lg transition-all">Keep</button>
                </div>
              ) : (
                <button onClick={() => setConfirmCancel(true)}
                  className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/15 px-2 py-1 rounded-lg transition-all font-bold">Cancel</button>
              )
            )}
          </div>
        ) : offer.status === 'open' && matchStarted ? (
          <span className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg font-bold">Match started</span>
        ) : offer.status === 'open' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              title="Share on X"
              className="p-2 rounded-xl transition-colors text-gray-400 hover:text-white hover:bg-white/5 border border-white/10"
            >
              {shareCopied ? <Check size={13} className="text-green-400" /> : <Share2 size={13} />}
            </button>
            <button onClick={() => onAccept(offer)}
              className="font-black px-5 py-2 rounded-xl text-sm transition-all text-white"
              style={{ background: 'linear-gradient(135deg,#a855f7,#9333ea)', boxShadow: '0 0 14px rgba(168,85,247,0.35)' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 22px rgba(168,85,247,0.55)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 14px rgba(168,85,247,0.35)')}>
              Accept Parlay
            </button>
          </div>
        ) : (
          <span className="text-xs text-gray-500 capitalize font-bold">{offer.status}</span>
        )}
      </div>
    </div>
  );
}

// ─── Accept Modal (Single Offer) ──────────────────────────────────────────────

const P2P_SUI_COIN_TYPE    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const P2P_SBETS_COIN_TYPE  = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const P2P_USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
const P2P_USDC_COIN_TYPE   = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const P2P_LBTC_COIN_TYPE   = '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC';

function resolveCoinType(currency: string | undefined | null): string {
  switch ((currency ?? '').toUpperCase()) {
    case 'SBETS':  return P2P_SBETS_COIN_TYPE;
    case 'USDSUI': return P2P_USDSUI_COIN_TYPE;
    case 'USDC':   return P2P_USDC_COIN_TYPE;
    case 'LBTC':   return P2P_LBTC_COIN_TYPE;
    default:       return P2P_SUI_COIN_TYPE;
  }
}

function getCurrencyDecimals(currency: string | undefined | null): number {
  const c = (currency ?? '').toUpperCase();
  if (c === 'USDSUI' || c === 'USDC') return 6;
  if (c === 'LBTC') return 8;
  return 9;
}

function isGaslessCurrency(currency: string | undefined | null): boolean {
  const c = (currency ?? '').toUpperCase();
  return c === 'USDC';
}
const P2P_CLOCK_ID         = '0x0000000000000000000000000000000000000000000000000000000000000006';
// Hardcoded mainnet contract addresses — same fallbacks the server uses.
// These ensure the on-chain path works even if contractData hasn't loaded yet.
const P2P_FALLBACK_PACKAGE_ID  = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const P2P_FALLBACK_CONFIG_ID   = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const P2P_FALLBACK_REGISTRY_ID = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';

function AcceptModal({ offer, onClose, onConfirm, myWallet, contractWallet, myTier, makerTier, onchainEscrow, packageId, configId, registryId }: {
  offer: Offer | null; onClose: () => void;
  onConfirm: (stake: number, txHash: string) => void;
  myWallet?: string; contractWallet: string;
  myTier?: VolumeTier | null; makerTier?: VolumeTier | null;
  onchainEscrow?: boolean;
  packageId?: string; configId?: string; registryId?: string;
}) {
  const [stake, setStake] = useState('');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { name: myNsName, isLoading: nsLoading } = useSuiNSNameWithStatus(myWallet);

  if (!offer) return null;

  const isVipGated = !!offer.suinsGated;
  const blockedByVip = isVipGated && !!myWallet && !nsLoading && myNsName === null;

  // Always use fallback IDs if the API hasn't loaded yet — prevents the modal
  // from falling back to a custodial transferObjects call (which shows the
  // admin wallet as recipient in the Sui wallet popup instead of the contract).
  const effectivePackageId  = packageId  || P2P_FALLBACK_PACKAGE_ID;
  const effectiveConfigId   = configId   || P2P_FALLBACK_CONFIG_ID;
  const effectiveRegistryId = registryId || P2P_FALLBACK_REGISTRY_ID;
  const isOnchain = !!offer.onchainOfferId;

  const maxStake = r3(offer.takerStake - (offer.filledStake ?? 0));
  const stakeNum = parseFloat(stake) || 0;
  const takerFeeRate = myTier?.takerFee ?? 0.02;
  const makerRebateRate = makerTier?.makerRebate ?? 0;
  const preview = stakeNum > 0 ? calcPayoutPreview(stakeNum, offer, takerFeeRate, makerRebateRate) : null;

  const handleAccept = async () => {
    if (stakeNum <= 0 || stakeNum > maxStake + 0.0001) return;
    setSignError('');
    if (!myWallet) { setSignError('Connect your wallet first to accept this bet'); return; }
    if (offer && new Date(offer.expiresAt).getTime() <= Date.now()) {
      setSignError('This offer has expired and can no longer be accepted.');
      return;
    }
    setSigning(true);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);

      const decimals = getCurrencyDecimals(offer.currency);
      const amountBase = BigInt(Math.round(stakeNum * Math.pow(10, decimals)));
      const coinTypeStr = resolveCoinType(offer.currency);

      // USDC supports gasless transactions — gas is paid from USDC balance
      if (isGaslessCurrency(offer.currency)) {
        tx.setGasPrice(0);
        tx.setGasBudget(0);
      }

      let paymentCoin: any;
      if (offer.currency === 'SUI') {
        [paymentCoin] = tx.splitCoins(tx.gas, [amountBase]);
      } else {
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType: coinTypeStr });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${offer.currency} found in your wallet.`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amountBase]);
      }

      if (isOnchain) {
        tx.moveCall({
          target:        `${effectivePackageId}::p2p_betting::accept_offer`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(effectiveConfigId),
            tx.object(effectiveRegistryId),
            tx.object(offer.onchainOfferId!),
            paymentCoin,
            tx.pure.u64(amountBase),
            tx.object(P2P_CLOCK_ID),
          ],
        });
      } else {
        if (!contractWallet) throw new Error('No escrow wallet configured');
        tx.transferObjects([paymentCoin], contractWallet);
      }

      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest ?? '';
      if (!digest) throw new Error('No transaction digest returned');
      onConfirm(stakeNum, digest);
    } catch (e: any) {
      setSignError(e.message ?? 'Wallet signing failed');
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="bg-[#111827] border border-cyan-500/30 rounded-2xl p-5 w-full max-w-sm">
        <h2 className="text-white font-black text-xl mb-1">SuiDuel</h2>
        <p className="text-gray-500 text-xs mb-4">Enter the duel — stakes locked on Sui</p>

        {isVipGated && (
          <div className={`flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg border ${blockedByVip ? 'bg-red-500/10 border-red-500/30' : nsLoading ? 'bg-gray-700/30 border-gray-600/30' : 'bg-purple-500/10 border-purple-500/25'}`}>
            <span className="text-base flex-shrink-0">{blockedByVip ? '🚫' : nsLoading ? '🔍' : '⭐'}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold ${blockedByVip ? 'text-red-400' : nsLoading ? 'text-gray-400' : 'text-purple-300'}`}>
                {blockedByVip ? 'VIP Pool — .sui name required' : nsLoading ? 'VIP Pool · checking…' : `VIP Pool · ${myNsName}`}
              </p>
              {blockedByVip ? (
                <p className="text-xs text-red-400/70 mt-0.5">
                  Your wallet has no .sui name.{' '}
                  <a href="https://app.suins.io" target="_blank" rel="noreferrer" className="underline hover:text-red-300">Get one →</a>
                </p>
              ) : nsLoading ? (
                <p className="text-xs text-gray-500 mt-0.5">Verifying your .sui name…</p>
              ) : (
                <p className="text-xs text-purple-400/60 mt-0.5">Elite tier auto-applied</p>
              )}
            </div>
          </div>
        )}

        {isOnchain && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Shield size={12} className="text-green-400 flex-shrink-0" />
            <span className="text-green-400 text-xs font-medium">On-chain escrow · wallet signs in one step</span>
          </div>
        )}

        <div className="bg-[#0d1420] rounded-xl p-3 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Match</span>
            <span className="text-white font-medium text-right max-w-[60%] truncate">{offer.eventName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Creator picked</span>
            <span className="text-green-400 font-bold">{predictionLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">You back</span>
            <span className="text-orange-400 font-bold">{oppositePrediction(offer.prediction, offer.homeTeam, offer.awayTeam)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Odds</span>
            <span className="text-cyan-400 font-bold">{formatOdds(offer.odds, 'dec')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Max stake</span>
            <span className="text-cyan-400 font-bold">{fmtN(maxStake, 4)} {offer.currency}</span>
          </div>
        </div>

        {myTier && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-gray-500 text-xs">Your tier:</span>
            <TierBadge tier={myTier} />
            <span className="text-gray-500 text-xs">Taker fee: {(myTier.takerFee * 100).toFixed(2)}%</span>
          </div>
        )}

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-gray-400 text-xs">Your Stake ({offer.currency}) — partial fill supported</label>
            <button
              type="button"
              onClick={() => setStake(String(maxStake))}
              className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 px-2 py-0.5 rounded transition-colors"
            >
              Max
            </button>
          </div>
          <input
            type="number" value={stake} onChange={e => setStake(e.target.value)}
            max={maxStake} step="0.01" placeholder={`0 – ${maxStake.toFixed(4)}`}
            className="w-full bg-[#0d1420] border border-[#1e2a3a] focus:border-cyan-500 rounded-lg px-3 py-2 text-white outline-none"
          />
          <p className="text-gray-600 text-xs mt-1">Partial fills supported — a separate on-chain bet is created per fill.</p>
        </div>

        {preview && (
          <div className="mb-4">
            <div className="text-gray-500 text-xs mb-2 flex items-center gap-1"><Info size={11} /> Payout breakdown</div>
            <PayoutBreakdown {...preview} currency={offer.currency} takerTier={myTier} makerTier={makerTier} />
          </div>
        )}

        {!isOnchain && (
          <ContractAddressBox wallet={contractWallet} amount={stakeNum > 0 ? stakeNum : undefined} currency={offer.currency} onchainEscrow={onchainEscrow} />
        )}

        {signError && <p className="text-red-400 text-xs mb-3 px-1">{signError}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} disabled={signing} className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors">Cancel</button>
          <button
            onClick={handleAccept}
            disabled={stakeNum <= 0 || stakeNum > maxStake + 0.0001 || signing || blockedByVip}
            className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {signing ? <><Loader2 size={14} className="animate-spin" /> Signing…</> : blockedByVip ? '.sui name required' : isOnchain ? 'Accept Bet' : 'Sign & Accept'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── Accept Modal (Parlay) ────────────────────────────────────────────────────

function ParlayAcceptModal({ offer, onClose, onConfirm, contractWallet, myWallet, myTier, makerTier, onchainEscrow, packageId, configId }: {
  offer: ParlayOffer | null; onClose: () => void;
  onConfirm: (txHash: string) => void;
  contractWallet: string; myWallet?: string;
  myTier?: VolumeTier | null; makerTier?: VolumeTier | null;
  onchainEscrow?: boolean;
  packageId?: string; configId?: string;
}) {
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();

  if (!offer) return null;

  // Always use fallback IDs — same reason as AcceptModal above.
  const effectivePackageId = packageId || P2P_FALLBACK_PACKAGE_ID;
  const effectiveConfigId  = configId  || P2P_FALLBACK_CONFIG_ID;
  const isOnchain = !!offer.onchainParlayId;

  const takerFeeRate = myTier?.takerFee ?? 0.02;
  const makerRebateRate = makerTier?.makerRebate ?? 0;
  const preview = calcParlayPayoutPreview(offer, takerFeeRate, makerRebateRate);

  const handleAccept = async () => {
    setSignError('');
    if (!myWallet) { setSignError('Connect your wallet first to accept this parlay'); return; }
    if (offer && new Date(offer.expiresAt).getTime() <= Date.now()) {
      setSignError('This parlay has expired and can no longer be accepted.');
      return;
    }
    setSigning(true);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);

      const coinTypeStr = resolveCoinType(offer.currency);

      // USDC supports gasless transactions — gas is paid from USDC balance
      if (isGaslessCurrency(offer.currency)) {
        tx.setGasPrice(0);
        tx.setGasBudget(0);
      }

      // Fetch exact taker_required from on-chain parlay object to avoid rounding
      // errors that arise from storing total_odds with limited decimal precision.
      let amountBase: bigint;
      if (isOnchain) {
        const parlayObj = await (suiClient as any).getObject({
          id: offer.onchainParlayId!,
          options: { showContent: true },
        });
        const fields = parlayObj?.data?.content?.fields;
        const takerRequired = fields?.taker_required;
        if (!takerRequired) throw new Error('Could not fetch parlay state from chain. Please try again.');
        // Check on-chain status — abort before signing if already taken
        const onchainStatus = Number(fields?.status ?? 0);
        const takerOpt = fields?.taker;
        const alreadyTaken = !!(takerOpt !== null && takerOpt !== undefined &&
          (typeof takerOpt === 'string' ||
           (typeof takerOpt === 'object' && (takerOpt.fields?.vec?.length > 0 || takerOpt.vec?.length > 0))));
        if (alreadyTaken || onchainStatus !== 0) {
          throw new Error('This parlay has already been accepted by someone else. Please refresh to see the latest offers.');
        }
        amountBase = BigInt(takerRequired);
      } else {
        const decimals = getCurrencyDecimals(offer.currency);
        amountBase = BigInt(Math.round(offer.takerStake * Math.pow(10, decimals)));
      }

      let paymentCoin: any;
      if (offer.currency === 'SUI') {
        [paymentCoin] = tx.splitCoins(tx.gas, [amountBase]);
      } else {
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType: coinTypeStr });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${offer.currency} found in your wallet.`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amountBase]);
      }

      if (isOnchain) {
        tx.moveCall({
          target:        `${effectivePackageId}::p2p_betting::accept_parlay`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(effectiveConfigId),
            tx.object(offer.onchainParlayId!),
            paymentCoin,
            tx.object(P2P_CLOCK_ID),
          ],
        });
      } else {
        if (!contractWallet) throw new Error('No escrow wallet configured');
        tx.transferObjects([paymentCoin], contractWallet);
      }

      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest ?? '';
      if (!digest) throw new Error('No transaction digest returned');
      onConfirm(digest);
    } catch (e: any) {
      setSignError(e.message ?? 'Wallet signing failed');
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="bg-[#111827] border border-purple-500/30 rounded-2xl p-5 w-full max-w-sm">
        <h2 className="text-white font-black text-xl mb-1">SuiDuel Parlay</h2>
        <p className="text-gray-500 text-xs mb-4">You win if ANY of the creator's legs fails</p>

        {isOnchain && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Shield size={12} className="text-green-400 flex-shrink-0" />
            <span className="text-green-400 text-xs font-medium">On-chain escrow · wallet signs in one step</span>
          </div>
        )}

        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 mb-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2">
              <div className="text-green-400 font-bold mb-1">Creator wins if…</div>
              <div className="text-gray-300">ALL legs hit</div>
            </div>
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-2">
              <div className="text-orange-400 font-bold mb-1">You win if…</div>
              <div className="text-gray-300">ANY leg fails</div>
            </div>
          </div>
        </div>

        <div className="bg-[#0d1420] rounded-xl p-3 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Legs</span>
            <span className="text-purple-400 font-bold">{offer.legCount} selections</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Combined odds</span>
            <span className="text-white font-bold">{Number(offer.totalOdds ?? 0).toFixed(2)}x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Creator stakes</span>
            <span className="text-green-400 font-bold">{fmtN(offer.creatorStake)} {offer.currency}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Your stake</span>
            <span className="text-orange-400 font-bold">{fmtN(offer.takerStake, 4)} {offer.currency}</span>
          </div>
        </div>

        {myTier && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-gray-500 text-xs">Your tier:</span>
            <TierBadge tier={myTier} />
            <span className="text-gray-500 text-xs">Fee: {(myTier.takerFee * 100).toFixed(2)}%</span>
          </div>
        )}

        <div className="mb-4">
          <div className="text-gray-500 text-xs mb-2 flex items-center gap-1"><Info size={11} /> Payout breakdown</div>
          <PayoutBreakdown {...preview} currency={offer.currency} takerTier={myTier} makerTier={makerTier} />
        </div>

        {!isOnchain && (
          <ContractAddressBox wallet={contractWallet} amount={offer.takerStake} currency={offer.currency} onchainEscrow={onchainEscrow} />
        )}

        {signError && <p className="text-red-400 text-xs mb-3 px-1">{signError}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} disabled={signing} className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors">Cancel</button>
          <button
            onClick={handleAccept}
            disabled={signing}
            className="flex-1 bg-purple-500 hover:bg-purple-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {signing ? <><Loader2 size={14} className="animate-spin" /> Signing…</> : isOnchain ? 'Accept Parlay' : 'Sign & Accept'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── Settlement Tape ──────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SettlementTape({ entries, loading }: { entries: TapeEntry[]; loading: boolean }) {
  const fmtSui = (n: number | null) =>
    n != null ? `${fmtN(Number(n))} SUI` : '—';

  const predLabel = (e: TapeEntry): string => {
    if (e.type === 'parlay') return `${e.legCount ?? '?'}-leg parlay`;
    if (!e.prediction) return '—';
    return predictionLabel(e.prediction, e.homeTeam ?? 'Home', e.awayTeam ?? 'Away');
  };

  const matchLabel = (e: TapeEntry) => {
    if (e.type === 'parlay') return `${e.legCount ?? '?'}-leg parlay`;
    if (e.homeTeam && e.awayTeam) return `${e.homeTeam} vs ${e.awayTeam}`;
    return e.eventName ?? `Bet #${e.id}`;
  };

  const winnerWallet = (e: TapeEntry) => {
    if (!e.winner) return null;
    const w = e.winner === 'creator' ? e.creatorWallet : e.takerWallet;
    if (!w) return e.winner;
    return `${w.slice(0, 6)}…${w.slice(-4)}`;
  };

  return (
    <div className="mt-6 rounded-xl border border-[#1e2a3a] bg-[#0d1520] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e2a3a]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        <span className="text-white font-bold text-sm">Live Settlement Tape</span>
        <span className="ml-1 text-gray-500 text-xs">— most recent payouts across all users</span>
        {loading && <Loader2 size={12} className="ml-auto text-gray-600 animate-spin" />}
      </div>

      {/* Rows */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <div className="text-3xl">🏆</div>
          <div className="text-gray-400 font-bold text-sm">No settled bets yet</div>
          <div className="text-gray-600 text-xs">Be the first — post a P2P offer and watch results flow in here.</div>
        </div>
      ) : (
        <div className="divide-y divide-[#1e2a3a] max-h-72 overflow-y-auto">
          {entries.map((e) => {
            const won = e.winner != null;
            const payout = e.payoutAmount ?? (won ? e.totalPot * 0.98 : null);
            return (
              <div key={`${e.type}-${e.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                {/* Type badge */}
                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                  e.type === 'parlay'
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                }`}>
                  {e.type === 'parlay' ? `${e.legCount ?? '?'}L` : '1v1'}
                </span>

                {/* Match + prediction */}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-medium truncate">{matchLabel(e)}</div>
                  <div className="text-gray-500 text-[11px] truncate">{predLabel(e)} · {e.odds.toFixed(2)}x</div>
                </div>

                {/* Pot size */}
                <div className="hidden sm:block text-right shrink-0">
                  <div className="text-gray-400 text-[10px] uppercase tracking-wide">Pot</div>
                  <div className="text-white text-xs font-mono">{fmtSui(e.totalPot)}</div>
                </div>

                {/* Winner + payout */}
                <div className="text-right shrink-0">
                  {e.winner ? (
                    <>
                      <div className="text-green-400 text-xs font-bold flex items-center gap-1 justify-end">
                        <Trophy size={10} />
                        {winnerWallet(e)}
                      </div>
                      <div className="text-green-300 text-[11px] font-mono">{fmtSui(payout)}</div>
                    </>
                  ) : (
                    <div className="text-gray-600 text-xs italic">pending</div>
                  )}
                </div>

                {/* Time + TX link */}
                <div className="text-right shrink-0 w-16">
                  <div className="text-gray-600 text-[11px]">{timeAgo(e.settledAt)}</div>
                  {e.payoutTxHash && (
                    <a
                      href={`https://suiscan.xyz/mainnet/tx/${e.payoutTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-600 hover:text-cyan-400 text-[10px] flex items-center gap-0.5 justify-end mt-0.5 transition-colors"
                    >
                      <ExternalLink size={9} /> tx
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── On-chain Order Book Tab ──────────────────────────────────────────────────

function OnchainBookTab({ data }: { data: OnchainBook | undefined }) {
  if (!data) {
    return <div className="text-center py-12 text-gray-500">Loading on-chain data…</div>;
  }

  const featureLabels: Record<string, string> = {
    'generic-coin-type':         '🪙 Generic Coin Type (SUI + USDC)',
    'partial-fills':             '📊 Partial Fills (CLOB-style)',
    'on-chain-order-book':       '📖 On-chain Order Book Registry',
    'dispute-window':            '⏳ 2-Hour Dispute Window',
    'hip4-maker-rebates':        '⚡ HIP-4 Maker Rebates',
    'on-chain-settlement-proof': '🔏 On-chain Settlement Proof',
    'on-chain-event-history':    '📜 Full Event History On-chain',
    'multi-token-fee-vault':     '💰 Multi-token Fee Vault (Bag)',
  };

  return (
    <div className="space-y-5">
      {/* Status Banner */}
      <div className="rounded-xl p-4 border bg-cyan-500/8 border-cyan-500/30">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="text-cyan-400" />
          <span className="font-bold text-sm text-cyan-400">All bets settled on Sui blockchain</span>
          <span className="ml-auto text-xs text-cyan-400 bg-cyan-500/15 px-2 py-0.5 rounded-full border border-cyan-500/30">
            {data.network ?? 'mainnet'}
          </span>
        </div>
        <p className="text-xs text-gray-400">{data.message}</p>
      </div>

      {/* Live Registry Counts */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={13} className="text-cyan-400" />
          <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider">Live Order Book</span>
          {data.contractDeployed && data.onchainCounts && (
            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">● On-chain</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Open Offers',  value: data.onchainCounts?.openOffers  ?? data.dbCounts.openOffers,  color: 'text-cyan-400',   sub: 'Sui' },
            { label: 'Live Bets',   value: data.onchainCounts?.liveBets     ?? 0,                         color: 'text-orange-400', sub: 'Sui' },
            { label: 'Open Parlays',value: data.onchainCounts?.openParlays ?? data.dbCounts.openParlays,  color: 'text-purple-400', sub: 'Sui' },
          ].map(stat => (
            <div key={stat.label} className="bg-[#111827] border border-[#1e2a3a] rounded-xl p-3 text-center">
              <div className={`font-black text-2xl ${stat.color}`}>{stat.value}</div>
              <div className="text-gray-400 text-xs mt-0.5">{stat.label}</div>
              <div className="text-gray-600 text-xs">{stat.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Contract Objects */}
      {(data.packageId || data.registryId || data.configId) && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Layers size={13} className="text-cyan-400" />
            <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider">Contract Objects</span>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Package',  id: data.packageId,  url: data.suiscanUrls.package  },
              { label: 'Config',   id: data.configId,   url: data.suiscanUrls.config   },
              { label: 'Registry', id: data.registryId, url: data.suiscanUrls.registry },
            ].filter(r => r.id).map(row => (
              <div key={row.label} className="flex items-center justify-between bg-[#111827] border border-[#1e2a3a] rounded-lg px-3 py-2.5">
                <span className="text-gray-400 text-xs w-16 font-medium">{row.label}</span>
                <span className="text-gray-300 text-xs font-mono flex-1 mx-3 truncate">{row.id}</span>
                {row.url && (
                  <a href={row.url} target="_blank" rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 transition-colors flex-shrink-0">
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dispute Window */}
      <div className="bg-[#111827] border border-[#1e2a3a] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Clock size={13} className="text-yellow-400" />
          <span className="text-yellow-400 text-xs font-bold uppercase tracking-wider">Dispute Window</span>
        </div>
        <p className="text-gray-400 text-xs">
          After oracle queues a settlement, a <span className="text-white font-bold">
            {(data.disputeWindowMs / 3_600_000).toFixed(0)}-hour challenge period
          </span> opens. Any user can flag an incorrect result during this window. If disputed, the oracle reviews and re-confirms (or overrides). Settlement is only final after the window closes without dispute.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {[
            { step: '1', label: 'Oracle queues result', color: 'text-cyan-400' },
            { step: '2', label: 'Users can dispute (2hrs)', color: 'text-yellow-400' },
            { step: '3', label: 'Winner paid on-chain', color: 'text-green-400' },
          ].map(s => (
            <div key={s.step} className="bg-[#0d1420] rounded-lg p-2 text-center">
              <div className={`font-black ${s.color} text-lg`}>{s.step}</div>
              <div className="text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Supported Coins */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider">Supported Coins</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.supportedCoins.map(coin => (
            <div key={coin.symbol}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold ${coin.default ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-[#111827] border-[#1e2a3a] text-gray-400'}`}>
              <span>{coin.symbol === 'SUI' ? '𝕊' : coin.symbol === 'SBETS' ? '⚡' : coin.symbol === 'LBTC' ? '₿' : '$'}</span>
              <span>{coin.symbol}</span>
              {coin.default && <span className="text-cyan-500/60 font-normal">Default</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Feature Matrix */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider">Contract Feature Set</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.features.map(f => (
            <div key={f} className="flex items-center gap-2 bg-[#111827] border border-[#1e2a3a] rounded-lg px-3 py-2.5 text-xs">
              <span className="text-green-400 font-bold">✓</span>
              <span className="text-gray-300">{featureLabels[f] ?? f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* HIP-4 Tiers */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={13} className="text-cyan-400" />
          <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider">HIP-4 On-chain Fee Tiers</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {data.hipFourTiers.map((tier, i) => {
            const colors = ['#cd7f32', '#c0c0c0', '#ffd700', '#b9f2ff', '#e040fb'];
            const color  = colors[i] ?? '#888';
            return (
              <div key={tier.name} className="rounded-lg p-2 text-center text-xs"
                style={{ background: color + '12', border: `1px solid ${color}30` }}>
                <div className="font-bold" style={{ color }}>{tier.name}</div>
                <div className="text-gray-500 mt-0.5">{tier.minVolumeSUI >= 1000 ? `${tier.minVolumeSUI / 1000}K+` : '0+'}</div>
                <div className="text-red-400 mt-1">{(tier.takerFeeBps / 100).toFixed(2)}%</div>
                {tier.makerRebateBps > 0
                  ? <div className="text-green-400">−{(tier.makerRebateBps / 100).toFixed(2)}%</div>
                  : <div className="text-gray-600">—</div>}
                <div className="text-gray-500 border-t border-gray-800 mt-1 pt-1">Net {(tier.netFeeBps / 100).toFixed(2)}%</div>
              </div>
            );
          })}
        </div>
        <p className="text-gray-600 text-xs mt-2">Tier thresholds enforced on-chain in P2PConfig. Elite makers net 0.20% fee — earn revenue by posting well-priced offers.</p>
      </div>

      {/* sui::clock — Trustless Expiry */}
      <SuiClockPanel />

      {/* sui::random — Provably Fair */}
      <SuiRandomPanel />
    </div>
  );
}

// ─── sui::clock Info Panel ─────────────────────────────────────────────────────

type ClockInfo = {
  networkTimestampMs: number;
  systemTimestampMs: number;
  driftMs: number;
  clockObjectId: string;
  version: string;
  note: string;
};

function SuiClockPanel() {
  const { data, isLoading } = useQuery<ClockInfo>({
    queryKey: ['/api/p2p/clock'],
    queryFn: () => fetch('/api/p2p/clock').then(r => r.json()),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const drift = data ? Math.abs(data.driftMs) : null;
  const driftOk = drift !== null && drift < 2_000;

  return (
    <div className="rounded-xl p-4 border" style={{ background: 'rgba(0,255,255,0.04)', borderColor: 'rgba(0,255,255,0.2)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Clock size={14} className="text-cyan-400" />
        <span className="text-cyan-400 text-xs font-bold uppercase tracking-wider">sui::clock — Trustless Expiry</span>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold"
          style={{ background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.3)', color: '#00ffff' }}>
          0x6
        </span>
      </div>

      {isLoading ? (
        <div className="text-gray-600 text-xs animate-pulse">Reading network clock…</div>
      ) : data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0d1420] rounded-lg p-2.5 text-center">
              <div className="text-cyan-400 font-black text-sm tabular-nums">
                {new Date(data.networkTimestampMs).toLocaleTimeString()}
              </div>
              <div className="text-gray-500 text-[10px] mt-0.5">Sui Network Time</div>
            </div>
            <div className="bg-[#0d1420] rounded-lg p-2.5 text-center">
              <div className={`font-black text-sm tabular-nums ${driftOk ? 'text-green-400' : 'text-yellow-400'}`}>
                {drift !== null ? `${drift < 1000 ? `${drift}ms` : `${(drift / 1000).toFixed(1)}s`}` : '—'}
              </div>
              <div className="text-gray-500 text-[10px] mt-0.5">Clock drift vs system</div>
            </div>
          </div>

          <div className="text-xs text-gray-400 leading-relaxed">
            <span className="text-white font-semibold">How expiry works: </span>
            The Move contract reads <code className="text-cyan-400 bg-cyan-500/10 px-1 rounded text-[10px]">clock.timestamp_ms()</code> inside{' '}
            <code className="text-cyan-400 bg-cyan-500/10 px-1 rounded text-[10px]">accept_offer</code> and{' '}
            <code className="text-cyan-400 bg-cyan-500/10 px-1 rounded text-[10px]">expire_offer</code>.
            If the network time has passed your expiry, the transaction aborts on Sui Move VM — not our backend.
            No backend drift can ever let an expired offer be accepted.
          </div>

          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span className="font-mono truncate">Object: {data.clockObjectId?.slice(0, 20)}…</span>
            <span className="ml-auto">v{data.version}</span>
          </div>
        </div>
      ) : (
        <div className="text-gray-600 text-xs">Clock unavailable</div>
      )}
    </div>
  );
}

// ─── sui::random Info Panel ────────────────────────────────────────────────────

type RandomInfo = {
  randomObjectId: string;
  epoch: number | null;
  randomnessRound: number | null;
  version: string;
  description: string;
  useCases: string[];
};

function SuiRandomPanel() {
  const { data, isLoading } = useQuery<RandomInfo>({
    queryKey: ['/api/p2p/random/info'],
    queryFn: () => fetch('/api/p2p/random/info').then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div className="rounded-xl p-4 border" style={{ background: 'rgba(168,85,247,0.04)', borderColor: 'rgba(168,85,247,0.2)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-purple-400 text-sm">🎲</span>
        <span className="text-purple-400 text-xs font-bold uppercase tracking-wider">sui::random — Provably Fair</span>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold"
          style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc' }}>
          0x8
        </span>
      </div>

      {isLoading ? (
        <div className="text-gray-600 text-xs animate-pulse">Reading random beacon…</div>
      ) : data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0d1420] rounded-lg p-2.5 text-center">
              <div className="text-purple-400 font-black text-sm tabular-nums">
                {data.epoch !== null ? `Epoch ${data.epoch}` : '—'}
              </div>
              <div className="text-gray-500 text-[10px] mt-0.5">Current epoch</div>
            </div>
            <div className="bg-[#0d1420] rounded-lg p-2.5 text-center">
              <div className="text-purple-400 font-black text-sm tabular-nums">
                {data.randomnessRound !== null ? `#${data.randomnessRound.toLocaleString()}` : '—'}
              </div>
              <div className="text-gray-500 text-[10px] mt-0.5">Randomness round</div>
            </div>
          </div>

          <div className="text-xs text-gray-400 leading-relaxed">
            <span className="text-white font-semibold">How draw tiebreakers work: </span>
            When a match ends in a draw and neither side bet on 'draw', we compute{' '}
            <code className="text-purple-400 bg-purple-500/10 px-1 rounded text-[10px]">SHA-256(round ‖ offerId ‖ matchId)</code>.
            The result is determined by Sui validators' BLS signatures — not our server.
            Anyone can reproduce and verify the result independently.
          </div>

          <div className="space-y-1">
            {(data.useCases ?? []).map((uc, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-gray-400">
                <span className="text-purple-400 font-bold mt-0.5 flex-shrink-0">✓</span>
                <span>{uc}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span className="font-mono truncate">Object: {data.randomObjectId?.slice(0, 20)}…</span>
            <span className="ml-auto">v{data.version}</span>
          </div>
        </div>
      ) : (
        <div className="text-gray-600 text-xs">Random beacon unavailable</div>
      )}
    </div>
  );
}

// ─── Pending Refunds Panel (Admin only) ───────────────────────────────────────

type PendingRefundsData = {
  pendingOffers:  { id: number; creator_wallet: string; creator_stake: number; currency: string; created_at: string; status: string }[];
  pendingParlays: { id: number; creator_wallet: string; creator_stake: number; currency: string; created_at: string; status: string }[];
  pendingMatches: { id: number; wallet: string; stake: number; currency: string; created_at: string; offer_id: number }[];
  totalPending: number;
};

function PendingRefundsPanel({ adminToken, onTokenChange }: { adminToken: string; onTokenChange: (t: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<PendingRefundsData>({
    queryKey: ['/api/p2p/pending-refunds'],
    queryFn: () => fetch('/api/p2p/pending-refunds').then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`,
  });

  async function retryOne(kind: 'offer' | 'parlay' | 'match', id: number) {
    const key = `${kind}:${id}`;
    setRetrying(p => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`/api/p2p/refunds/retry-${kind}/${id}`, {
        method: 'POST', headers: authHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast({ title: '✅ Refund sent', description: `TX: ${json.txHash?.slice(0, 16)}…`, duration: 6000 });
        refetch();
      } else if (json.skipped) {
        toast({ title: 'ℹ️ Already done', description: json.error ?? 'This refund was already processed', duration: 4000 });
        refetch();
      } else if (res.status === 401) {
        toast({ title: '🔒 Not authorised', description: 'Admin token invalid or expired', variant: 'destructive', duration: 4000 });
      } else {
        toast({ title: '❌ Retry failed', description: json.error ?? 'Unknown error', variant: 'destructive', duration: 5000 });
      }
    } catch (e: any) {
      toast({ title: '❌ Network error', description: e.message, variant: 'destructive', duration: 4000 });
    }
    setRetrying(p => ({ ...p, [key]: false }));
  }

  async function processAll() {
    setRetrying(p => ({ ...p, '__all__': true }));
    try {
      const res = await fetch('/api/p2p/process-pending-refunds', {
        method: 'POST', headers: authHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast({ title: `✅ Sweep done`, description: `${json.succeeded}/${json.processed} refunds sent`, duration: 6000 });
        refetch();
      } else if (res.status === 401) {
        toast({ title: '🔒 Not authorised', description: 'Admin token invalid or expired', variant: 'destructive' });
      } else {
        toast({ title: '❌ Sweep failed', description: json.message ?? 'Unknown error', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: '❌ Network error', description: e.message, variant: 'destructive' });
    }
    setRetrying(p => ({ ...p, '__all__': false }));
  }

  const short = (w: string) => w ? `${w.slice(0, 8)}…${w.slice(-4)}` : '—';
  const ts    = (d: string) => new Date(d).toLocaleString();

  const totalSui = [
    ...(data?.pendingOffers  ?? []).map(r => Number(r.creator_stake)),
    ...(data?.pendingParlays ?? []).map(r => Number(r.creator_stake)),
    ...(data?.pendingMatches ?? []).map(r => Number(r.stake)),
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-base flex items-center gap-2">
            <span className="text-yellow-400">⚠️</span> Pending Refunds
          </div>
          <div className="text-gray-500 text-xs mt-0.5">
            Cancelled / expired offers whose creator or taker stake was not yet returned.
            Refunds require admin auth. Last refreshed: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => refetch()}
            className="text-xs px-3 py-1.5 rounded-lg font-bold text-cyan-400 hover:text-white transition-colors"
            style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.2)' }}>
            ↺ Refresh
          </button>
          <button onClick={processAll} disabled={retrying['__all__'] || (data?.totalPending ?? 0) === 0}
            className="text-xs px-4 py-1.5 rounded-lg font-bold transition-all disabled:opacity-40 text-black"
            style={{ background: 'linear-gradient(135deg,#facc15,#f59e0b)', boxShadow: '0 0 12px rgba(250,204,21,0.3)' }}>
            {retrying['__all__'] ? 'Processing…' : `Process All (${data?.totalPending ?? 0})`}
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        {([
          { label: 'Creator Offers',  count: data?.pendingOffers?.length  ?? 0, color: '#00ffff' },
          { label: 'Creator Parlays', count: data?.pendingParlays?.length ?? 0, color: '#a855f7' },
          { label: 'Taker Matches',   count: data?.pendingMatches?.length ?? 0, color: '#f97316' },
          { label: 'Total at risk',   value: `${totalSui.toFixed(4)} SUI`, color: '#facc15' },
        ] as any[]).map(c => (
          <div key={c.label} className="rounded-xl px-4 py-2.5 text-center"
            style={{ background: `${c.color}11`, border: `1px solid ${c.color}33` }}>
            <div className="font-black text-lg leading-none" style={{ color: c.color }}>{c.value ?? c.count}</div>
            <div className="text-gray-500 text-xs mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {isLoading && <div className="text-center py-10 text-gray-500 text-sm">Loading…</div>}

      {/* ── Creator Offer Refunds ── */}
      {!isLoading && (data?.pendingOffers?.length ?? 0) > 0 && (
        <div>
          <div className="text-cyan-400 font-bold text-xs mb-2 flex items-center gap-1.5">
            ⚔️ Creator Offer Refunds <span className="text-gray-600 font-normal">({data!.pendingOffers.length})</span>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(0,255,255,0.15)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'rgba(0,255,255,0.06)' }}>
                  {['ID', 'Status', 'Creator', 'Stake', 'Created', 'Action'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-semibold px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.pendingOffers.map((row, i) => {
                  const k = `offer:${row.id}`;
                  return (
                    <tr key={row.id} style={{ background: i % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-3 py-2 text-gray-400 font-mono">#{row.id}</td>
                      <td className="px-3 py-2"><span className="text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{row.status}</span></td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{short(row.creator_wallet)}</td>
                      <td className="px-3 py-2 text-cyan-300 font-bold">{Number(row.creator_stake).toFixed(4)} {row.currency}</td>
                      <td className="px-3 py-2 text-gray-500">{ts(row.created_at)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => retryOne('offer', row.id)} disabled={retrying[k]}
                          className="px-3 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-30 text-black"
                          style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)' }}>
                          {retrying[k] ? '…' : 'Retry'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Creator Parlay Refunds ── */}
      {!isLoading && (data?.pendingParlays?.length ?? 0) > 0 && (
        <div>
          <div className="text-purple-400 font-bold text-xs mb-2 flex items-center gap-1.5">
            🎯 Creator Parlay Refunds <span className="text-gray-600 font-normal">({data!.pendingParlays.length})</span>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'rgba(168,85,247,0.06)' }}>
                  {['ID', 'Status', 'Creator', 'Stake', 'Created', 'Action'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-semibold px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.pendingParlays.map((row, i) => {
                  const k = `parlay:${row.id}`;
                  return (
                    <tr key={row.id} style={{ background: i % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-3 py-2 text-gray-400 font-mono">#{row.id}</td>
                      <td className="px-3 py-2"><span className="text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{row.status}</span></td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{short(row.creator_wallet)}</td>
                      <td className="px-3 py-2 text-purple-300 font-bold">{Number(row.creator_stake).toFixed(4)} {row.currency}</td>
                      <td className="px-3 py-2 text-gray-500">{ts(row.created_at)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => retryOne('parlay', row.id)} disabled={retrying[k]}
                          className="px-3 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-30 text-black"
                          style={{ background: 'linear-gradient(135deg,#a855f7,#9333ea)' }}>
                          {retrying[k] ? '…' : 'Retry'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Taker Match Refunds ── */}
      {!isLoading && (data?.pendingMatches?.length ?? 0) > 0 && (
        <div>
          <div className="text-orange-400 font-bold text-xs mb-2 flex items-center gap-1.5">
            👤 Taker Match Refunds <span className="text-gray-600 font-normal">({data!.pendingMatches.length})</span>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(249,115,22,0.2)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'rgba(249,115,22,0.06)' }}>
                  {['Match ID', 'Offer', 'Taker', 'Stake', 'Created', 'Action'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-semibold px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.pendingMatches.map((row, i) => {
                  const k = `match:${row.id}`;
                  return (
                    <tr key={row.id} style={{ background: i % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-3 py-2 text-gray-400 font-mono">#{row.id}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono">#{row.offer_id}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{short(row.wallet)}</td>
                      <td className="px-3 py-2 text-orange-300 font-bold">{Number(row.stake).toFixed(4)} {row.currency}</td>
                      <td className="px-3 py-2 text-gray-500">{ts(row.created_at)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => retryOne('match', row.id)} disabled={retrying[k]}
                          className="px-3 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-30 text-white"
                          style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)' }}>
                          {retrying[k] ? '…' : 'Retry'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && (data?.totalPending ?? 0) === 0 && (
        <div className="text-center py-14 text-gray-600">
          <div className="text-3xl mb-2">✅</div>
          <div className="font-bold text-sm text-gray-500">No pending refunds</div>
          <div className="text-xs mt-1">All cancelled/expired bets have been refunded.</div>
        </div>
      )}

      {/* Settled bets exclusion notice */}
      <div className="rounded-xl p-3 text-xs flex items-start gap-2"
        style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <span className="text-red-400 flex-shrink-0 mt-0.5">🚫</span>
        <span className="text-red-300">
          <strong>Accepted bets are never refundable.</strong> Once a taker accepts an offer, the match can only end as
          a <strong>win</strong> or <strong>loss</strong> — the winner's payout is sent on settlement, the loser's stake is forfeit.
          This panel only shows offers/parlays that were cancelled or expired <em>before any outcome was determined</em>, and
          taker matches where the <em>offer itself was cancelled</em> before settlement. Won/lost matches are permanently excluded.
        </span>
      </div>

      {/* Security note */}
      <div className="rounded-xl p-3 text-xs text-gray-600 flex items-start gap-2"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-gray-500 flex-shrink-0">🛡️</span>
        <span>
          Each retry is admin-only and idempotent — the server checks <code className="text-gray-400">refund_tx_hash IS NULL</code> and
          verifies no settled (won/lost) matches exist before sending any blockchain transaction. A 60-second in-memory rate
          limit prevents duplicate sends per item. "Process All" sweeps all eligible rows in sequence.
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function P2PPage() {
  const [tab, setTab] = useState<'offers' | 'parlays' | 'my' | 'leaderboard' | 'onchain' | 'settling' | 'refunds' | 'upcoming'>('upcoming');
  const [oddsFormat, setOddsFormat] = useState<'dec' | 'us' | 'frac'>('dec');
  const [acceptingOffer, setAcceptingOffer] = useState<Offer | null>(null);
  const [acceptingParlay, setAcceptingParlay] = useState<ParlayOffer | null>(null);
  const [showContractModal, setShowContractModal] = useState(false);
  // Admin token for the Pending Refunds panel — prefilled from sessionStorage if present
  const [adminToken, setAdminToken] = useState<string>(() => sessionStorage.getItem('adminToken') ?? '');
  const currentAccount = useCurrentAccount();
  const myWallet = currentAccount?.address;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const [reclaimingId, setReclaimingId] = useState<number | null>(null);
  const [pendingOffers, setPendingOffers] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('pendingP2POffers') ?? '[]'); } catch { return []; }
  });
  const [syncingPending, setSyncingPending] = useState(false);
  const [, navigate] = useLocation();
  const { isConnected: wsConnected } = useWebSocket();

  // Real-time WS alerts
  useWsOn((msg) => {
    // Handle live odds updates from the in-play odds service
    if (msg.type === 'live-odds' && msg.data?.updates) {
      const newMap: typeof liveOddsMap = {};
      for (const upd of msg.data.updates) {
        newMap[upd.eventId] = { shift: upd.shift, homeScore: upd.homeScore, awayScore: upd.awayScore, minute: upd.minute };
      }
      setLiveOddsMap(prev => ({ ...prev, ...newMap }));
      return;
    }
    if (msg.type !== 'p2p-updates' || !msg.data) return;
    const { action, type: betType, data } = msg.data;
    if (action === 'created' && betType === 'offer') {
      toast({ title: '⚔️ New bet offer', description: data?.eventName ? `${data.eventName} — ${Number(data.odds).toFixed(2)}x` : 'New single-match offer posted', duration: 3500 });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
    } else if (action === 'created' && betType === 'parlay') {
      toast({ title: '🎯 New parlay offer', description: data?.legCount ? `${data.legCount}-leg parlay just posted` : 'New parlay offer', duration: 3500 });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays', 'all'] });
    } else if (action === 'accepted') {
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays', 'all'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });

      // Personalized alert when it's THIS user's offer that got taken
      if (myWallet && data?.creatorWallet && data.creatorWallet === myWallet) {
        const short = (w: string) => w ? `${w.slice(0, 6)}…${w.slice(-4)}` : 'someone';
        const curr  = data.currency ?? 'SUI';

        if (betType === 'offer') {
          const matchSnip = data.eventName
            ? (data.eventName.length > 38 ? data.eventName.slice(0, 38) + '…' : data.eventName)
            : 'your match';
          toast({
            title: '🎉 Your offer was accepted!',
            description: `${short(data.takerWallet)} staked ${data.stake} ${curr} on ${matchSnip}${data.takerTierName ? ` · ${data.takerTierName} tier` : ''}`,
            duration: 10000,
            action: (
              <ToastAction altText="View in My Bets" onClick={() => setTab('my')}>
                View My Bets
              </ToastAction>
            ),
          });
        } else if (betType === 'parlay') {
          toast({
            title: '🎉 Your parlay was accepted!',
            description: `${short(data.takerWallet)} staked ${Number(data.takerStake ?? 0).toFixed(4)} ${curr} on your ${data.legCount}-leg parlay at ${Number(data.totalOdds ?? 0).toFixed(2)}x${data.takerTierName ? ` · ${data.takerTierName} tier` : ''}`,
            duration: 10000,
            action: (
              <ToastAction altText="View in My Bets" onClick={() => setTab('my')}>
                View My Bets
              </ToastAction>
            ),
          });
        }
      }
    } else if (action === 'cancelled') {
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays', 'all'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    } else if (action === 'settled') {
      toast({
        title: '🏁 Bet settled!',
        description: `${betType === 'parlay' ? 'Parlay' : 'Bet'} settled — ${data?.winner === 'creator' ? 'creator' : 'taker'} wins.`,
        duration: 5000,
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    }
  });

  // Sync on-chain bets that failed to save to DB (e.g. during an API outage)
  const syncPendingOffers = async () => {
    if (!myWallet || pendingOffers.length === 0) return;
    setSyncingPending(true);
    let synced = 0;
    const remaining: any[] = [];
    for (const offer of pendingOffers) {
      if (offer.creatorWallet !== myWallet) { remaining.push(offer); continue; }
      try {
        const res = await fetch('/api/p2p/recover-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(offer),
        });
        if (res.ok) { synced++; }
        else { remaining.push(offer); }
      } catch { remaining.push(offer); }
    }
    localStorage.setItem('pendingP2POffers', JSON.stringify(remaining));
    setPendingOffers(remaining);
    setSyncingPending(false);
    if (synced > 0) {
      toast({ title: `✅ Synced ${synced} bet${synced > 1 ? 's' : ''} to database`, description: 'Your bets now appear in My Bets.' });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
    } else {
      toast({ title: 'Nothing new to sync', variant: 'destructive' });
    }
  };

  const [offerFilter, setOfferFilter] = useState<string>('open');
  const [parlayFilter, setParlayFilter] = useState<string>('open');
  const [suinsFilter, setSuinsFilter] = useState(false);
  const [liveOddsMap, setLiveOddsMap] = useState<Record<string, { shift: Record<string, number>; homeScore: number; awayScore: number; minute: number }>>({});
  const [upcomingSport, setUpcomingSport] = useState<number | null>(null);
  const [upcomingSearch, setUpcomingSearch] = useState('');

  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const acceptOfferIdParam = searchParams.get('acceptOffer');
  const tabParam = searchParams.get('tab');

  // Auto-activate tab from URL param ?tab=upcoming
  useEffect(() => {
    if (tabParam === 'upcoming') setTab('upcoming');
    else if (tabParam === 'offers') setTab('offers');
    else if (tabParam === 'parlays') setTab('parlays');
    else if (tabParam === 'my') setTab('my');
  }, [tabParam]);

  const { addBet } = useBetting();
  const { data: upcomingEvents = [], isLoading: upcomingLoading } = useUpcomingEvents(upcomingSport);

  const { data: rawOffers = [], isLoading: offersLoading, refetch: refetchOffers } = useQuery<Offer[]>({
    queryKey: ['/api/p2p/offers', 'all'],
    queryFn: () => fetch('/api/p2p/offers?status=all&limit=500').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    staleTime: 0,
    refetchInterval: 3000,
  });
  const allOffers: Offer[] = Array.isArray(rawOffers) ? rawOffers : [];

  // Auto-open AcceptModal when ?acceptOffer=<id> is present in the URL
  useEffect(() => {
    if (!acceptOfferIdParam || allOffers.length === 0 || acceptingOffer) return;
    const target = allOffers.find(o => String(o.id) === acceptOfferIdParam && (o.status === 'open' || o.status === 'partial'));
    if (target) {
      setTab('offers');
      setAcceptingOffer(target);
      navigate('/p2p', { replace: true });
    }
  }, [acceptOfferIdParam, allOffers]);
  const _p2pNow = Date.now();
  const offers: Offer[] = (offerFilter === 'open'
    ? allOffers.filter(o =>
        (o.status === 'open' || o.status === 'partial') &&
        new Date(o.expiresAt).getTime() > _p2pNow &&
        // For pre-match offers: hide once match has kicked off.
        // For live offers (liveOdds=true): keep visible — the score-snapshot guard
        // on the server voids them if a goal is scored before acceptance.
        (o.liveOdds || !(o.matchDate && new Date(o.matchDate).getTime() <= _p2pNow))
      )
    : offerFilter === 'all'
    ? allOffers
    : allOffers.filter(o => o.status === offerFilter)
  )
   .filter(o => !suinsFilter || !!o.suinsGated);

  const { data: rawParlays = [], isLoading: parlaysLoading, refetch: refetchParlays } = useQuery<ParlayOffer[]>({
    queryKey: ['/api/p2p/parlays', 'all'],
    queryFn: () => fetch('/api/p2p/parlays?status=all').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    staleTime: 0,
    refetchInterval: 3000,
  });
  const allParlays: ParlayOffer[] = Array.isArray(rawParlays) ? rawParlays : [];
  const parlays: ParlayOffer[] = parlayFilter === 'open'
    ? allParlays.filter(p => p.status === 'open' && new Date(p.expiresAt).getTime() > _p2pNow)
    : parlayFilter === 'all'
    ? allParlays
    : allParlays.filter(p => p.status === parlayFilter);

  const { data: myActivityRaw } = useQuery({
    queryKey: ['/api/p2p/my', myWallet],
    queryFn: () => fetch(`/api/p2p/my?wallet=${myWallet}`).then(r => r.json()),
    enabled: !!myWallet,
    refetchInterval: 5000,
  });
  const myActivity = myActivityRaw && typeof myActivityRaw === 'object' ? myActivityRaw : {};

  const { data: contractData } = useQuery<{ wallet: string; onchainEscrow?: boolean; packageId?: string; configId?: string; registryId?: string }>({
    queryKey: ['/api/p2p/contract-wallet'],
    queryFn: () => fetch('/api/p2p/contract-wallet').then(r => r.json()),
    staleTime: Infinity,
  });

  const { data: onchainBook, isLoading: onchainLoading } = useQuery<OnchainBook>({
    queryKey: ['/api/p2p/onchain-book'],
    queryFn: () => fetch('/api/p2p/onchain-book').then(r => r.json()),
    refetchInterval: tab === 'onchain' ? 30000 : 120000,
    staleTime: 15000,
  });

  const { data: myVolumeData } = useQuery<VolumeStats>({
    queryKey: ['/api/p2p/volume', myWallet],
    queryFn: () => fetch(`/api/p2p/volume?wallet=${myWallet}`).then(r => r.json()),
    enabled: !!myWallet,
    staleTime: 30000,
  });

  const { data: feeTiersData } = useQuery<{ tiers: VolumeTier[] }>({
    queryKey: ['/api/p2p/fee-tiers'],
    queryFn: () => fetch('/api/p2p/fee-tiers').then(r => r.json()),
    staleTime: Infinity,
  });

  const { data: onchainFeedData } = useQuery<{ entries: OnchainTxEntry[]; packageId: string; stale?: boolean }>({
    queryKey: ['/api/p2p/onchain-tx-feed'],
    queryFn: () => fetch('/api/p2p/onchain-tx-feed').then(r => r.json()),
    staleTime: 15000,
    refetchInterval: 30000,
  });
  const onchainEntries: OnchainTxEntry[] = onchainFeedData?.entries ?? [];

  const { data: rawLeaderboard = [] } = useQuery<any[]>({
    queryKey: ['/api/p2p/leaderboard'],
    queryFn: () => fetch('/api/p2p/leaderboard?limit=20').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: tab === 'leaderboard',
    staleTime: 60000,
  });
  const leaderboard: any[] = Array.isArray(rawLeaderboard) ? rawLeaderboard : [];

  const contractWallet  = contractData?.wallet ?? '';
  const onchainEscrow   = contractData?.onchainEscrow ?? false;
  const p2pPackageId    = contractData?.packageId  ?? '';
  const p2pConfigId     = contractData?.configId   ?? '';
  const p2pRegistryId   = contractData?.registryId ?? '';
  const myTier          = myVolumeData?.tier ?? null;
  const feeTiers        = feeTiersData?.tiers ?? [];

  const { data: offerCreatorVolume } = useQuery<VolumeStats>({
    queryKey: ['/api/p2p/volume', acceptingOffer?.creatorWallet],
    queryFn: () => fetch(`/api/p2p/volume?wallet=${acceptingOffer!.creatorWallet}`).then(r => r.json()),
    enabled: !!acceptingOffer?.creatorWallet,
    staleTime: 30000,
  });
  const { data: parlayCreatorVolume } = useQuery<VolumeStats>({
    queryKey: ['/api/p2p/volume', acceptingParlay?.creatorWallet],
    queryFn: () => fetch(`/api/p2p/volume?wallet=${acceptingParlay!.creatorWallet}`).then(r => r.json()),
    enabled: !!acceptingParlay?.creatorWallet,
    staleTime: 30000,
  });

  const acceptOfferMutation = useMutation({
    mutationFn: async ({ offerId, stake, txHash }: { offerId: number; stake: number; txHash: string; currency?: string }) => {
      const res = await fetch(`/api/p2p/offers/${offerId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: myWallet, stake, takerTxHash: txHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onMutate: async ({ offerId, stake }) => {
      await qc.cancelQueries({ queryKey: ['/api/p2p/offers', 'all'] });
      const prev = qc.getQueryData<Offer[]>(['/api/p2p/offers', 'all']);
      qc.setQueryData<Offer[]>(['/api/p2p/offers', 'all'], (old = []) =>
        old.map(o => {
          if (o.id !== offerId) return o;
          const newFilled = Math.min((o.filledStake ?? 0) + stake, o.takerStake);
          return { ...o, filledStake: newFilled, status: newFilled >= o.takerStake - 0.001 ? 'filled' : 'partial' };
        })
      );
      setAcceptingOffer(null);
      return { prev };
    },
    onSuccess: (data, { currency }) => {
      const payout = data?.winnerPayout ?? data?.actualPayout;
      toast({
        title: '✅ Bet Accepted!',
        description: payout ? `Awaiting match result. If you win: ${Number(payout).toFixed(4)} ${currency ?? ''}` : 'You are in the game. Awaiting match result.',
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/volume', myWallet] });
    },
    onError: (e: Error, vars: any, ctx) => {
      if (ctx?.prev) qc.setQueryData(['/api/p2p/offers', 'all'], ctx.prev);
      // If the on-chain TX already happened (takerTxHash present), save locally for recovery
      if (vars?.txHash && vars?.offerId) {
        try {
          const stored: any[] = JSON.parse(localStorage.getItem('pendingP2PMatches') ?? '[]');
          if (!stored.some((m: any) => m.takerTxHash === vars.txHash)) {
            stored.push({ offerId: vars.offerId, takerWallet: myWallet, stake: vars.stake, takerTxHash: vars.txHash, savedAt: new Date().toISOString() });
            localStorage.setItem('pendingP2PMatches', JSON.stringify(stored));
          }
        } catch { /* ignore */ }
      }
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    },
  });

  const acceptParlayMutation = useMutation({
    mutationFn: async ({ parlayId, txHash }: { parlayId: number; txHash: string; currency?: string }) => {
      const res = await fetch(`/api/p2p/parlays/${parlayId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: myWallet, takerTxHash: txHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onMutate: async ({ parlayId }) => {
      await qc.cancelQueries({ queryKey: ['/api/p2p/parlays', 'all'] });
      const prev = qc.getQueryData<ParlayOffer[]>(['/api/p2p/parlays', 'all']);
      qc.setQueryData<ParlayOffer[]>(['/api/p2p/parlays', 'all'], (old = []) =>
        old.map(p => p.id !== parlayId ? p : { ...p, status: 'filled' })
      );
      setAcceptingParlay(null);
      return { prev };
    },
    onSuccess: (data, { currency }) => {
      const payout = data?.winnerPayout;
      toast({
        title: '✅ Parlay Accepted!',
        description: payout ? `Win if any leg fails. Your payout: ${Number(payout).toFixed(4)} ${currency ?? ''}` : 'You win if any leg fails!',
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays', 'all'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/volume', myWallet] });
    },
    onError: (e: Error, _, ctx) => {
      if (ctx?.prev) qc.setQueryData(['/api/p2p/parlays', 'all'], ctx.prev);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    },
  });

  const cancelOfferMutation = useMutation({
    mutationFn: async ({ id: offerId, onchainOfferId, currency }: { id: number; onchainOfferId?: string; currency?: string }) => {
      if (offerId == null || isNaN(Number(offerId))) throw new Error(`Invalid offer ID: ${offerId}`);
      if (!myWallet) throw new Error('Connect your wallet to cancel this offer');
      let cancelTxHash: string | undefined;
      if (onchainOfferId) {
        if (typeof signAndExecute !== 'function') throw new Error('Wallet not connected — please reconnect your Sui wallet and try again');
        const effectivePackageId  = p2pPackageId  || P2P_FALLBACK_PACKAGE_ID;
        const effectiveRegistryId = p2pRegistryId || P2P_FALLBACK_REGISTRY_ID;
        const tx = new Transaction();
        tx.setSender(myWallet);
        tx.setGasBudget(20_000_000);
        const coinTypeStr = resolveCoinType(currency);
        if (isGaslessCurrency(currency)) { tx.setGasPrice(0); tx.setGasBudget(0); }
        tx.moveCall({
          target: `${effectivePackageId}::p2p_betting::cancel_offer`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(onchainOfferId),
            tx.object(effectiveRegistryId),
            tx.object(P2P_CLOCK_ID),
          ],
        });
        const result = await signAndExecute({ transaction: tx });
        cancelTxHash = (result as any)?.digest;
        if (!cancelTxHash) throw new Error('On-chain cancel failed — no transaction digest returned');
        const txCheck = await (suiClient as any).waitForTransaction({ digest: cancelTxHash, options: { showEffects: true } });
        if (txCheck?.effects?.status?.status !== 'success') {
          const errMsg = txCheck?.effects?.status?.error ?? 'Transaction failed on-chain';
          throw new Error(`Cancel failed on-chain: ${errMsg}`);
        }
      }
      // Optimistic update: mark as cancelled immediately after on-chain TX (or for custodial, before API call)
      qc.setQueryData<Offer[]>(['/api/p2p/offers', 'all'], (old = []) =>
        old.map(o => o.id !== offerId ? o : { ...o, status: 'cancelled' })
      );
      const res = await fetch(`/api/p2p/offers/${offerId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorWallet: myWallet, cancelTxHash }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: 'Cancel failed' }));
        throw new Error(errData.message || 'Failed to cancel offer');
      }
      return res.json().catch(() => ({ success: true }));
    },
    onSuccess: (_, vars) => {
      const msg = vars.onchainOfferId ? 'Contract released your stake back to your wallet.' : 'Your offer has been removed from the market.';
      toast({ title: 'Offer cancelled', description: msg });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
      toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' });
    },
  });

  const handleReclaimFromContract = async ({ id, onchainOfferId, currency }: { id: number; onchainOfferId: string; currency?: string }) => {
    if (!myWallet) {
      toast({ title: 'Connect wallet', description: 'Connect your wallet to reclaim your funds', variant: 'destructive' });
      return;
    }
    if (typeof signAndExecute !== 'function') {
      toast({ title: 'Wallet not ready', description: 'Please reconnect your Sui wallet and try again', variant: 'destructive' });
      return;
    }
    if (!p2pPackageId || !p2pRegistryId) {
      toast({ title: 'Contract not configured', description: 'Contract IDs not loaded yet', variant: 'destructive' });
      return;
    }
    setReclaimingId(id);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);
      const coinTypeStr = resolveCoinType(currency);
      if (isGaslessCurrency(currency)) { tx.setGasPrice(0); tx.setGasBudget(0); }
      tx.moveCall({
        target: `${p2pPackageId}::p2p_betting::cancel_offer`,
        typeArguments: [coinTypeStr],
        arguments: [
          tx.object(onchainOfferId),
          tx.object(p2pRegistryId),
          tx.object(P2P_CLOCK_ID),
        ],
      });
      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest;
      if (!digest) throw new Error('No transaction digest returned');
      const txCheck = await (suiClient as any).waitForTransaction({ digest, options: { showEffects: true } });
      if (txCheck?.effects?.status?.status !== 'success') {
        const errMsg = txCheck?.effects?.status?.error ?? 'Transaction failed on-chain';
        throw new Error(`Reclaim failed on-chain: ${errMsg}`);
      }
      await fetch(`/api/p2p/offers/${id}/reclaim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: myWallet, txHash: digest }),
      });
      toast({ title: '✅ Funds reclaimed!', description: `${currency ?? 'SUI'} returned to your wallet. TX: ${digest.slice(0, 16)}…`, duration: 8000 });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    } catch (e: any) {
      toast({ title: 'Reclaim failed', description: e.message ?? 'Unknown error', variant: 'destructive' });
    } finally {
      setReclaimingId(null);
    }
  };

  const cancelParlayMutation = useMutation({
    mutationFn: async ({ id, onchainParlayId, currency }: { id: number; onchainParlayId?: string; currency?: string }) => {
      if (id == null || isNaN(Number(id))) throw new Error(`Invalid parlay ID: ${id}`);
      if (!myWallet) throw new Error('Connect your wallet to cancel this parlay');
      let cancelTxHash: string | undefined;
      if (onchainParlayId) {
        if (typeof signAndExecute !== 'function') throw new Error('Wallet not connected — please reconnect your Sui wallet and try again');
        const effectivePackageId  = p2pPackageId  || P2P_FALLBACK_PACKAGE_ID;
        const effectiveRegistryId = p2pRegistryId || P2P_FALLBACK_REGISTRY_ID;
        const tx = new Transaction();
        tx.setSender(myWallet);
        tx.setGasBudget(20_000_000);
        const coinTypeStr = resolveCoinType(currency);
        if (isGaslessCurrency(currency)) { tx.setGasPrice(0); tx.setGasBudget(0); }
        tx.moveCall({
          target: `${effectivePackageId}::p2p_betting::cancel_parlay`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(onchainParlayId),
            tx.object(effectiveRegistryId),
            tx.object(P2P_CLOCK_ID),
          ],
        });
        const result = await signAndExecute({ transaction: tx });
        cancelTxHash = (result as any)?.digest;
        if (!cancelTxHash) throw new Error('On-chain cancel failed — no transaction digest returned');
        const txCheck = await (suiClient as any).waitForTransaction({ digest: cancelTxHash, options: { showEffects: true } });
        if (txCheck?.effects?.status?.status !== 'success') {
          const errMsg = txCheck?.effects?.status?.error ?? 'Transaction failed on-chain';
          throw new Error(`Cancel failed on-chain: ${errMsg}`);
        }
      }
      const res = await fetch(`/api/p2p/parlays/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorWallet: myWallet, cancelTxHash }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: 'Cancel failed' }));
        throw new Error(errData.message || 'Failed to cancel parlay');
      }
      return res.json().catch(() => ({ success: true }));
    },
    onSuccess: (_, vars) => {
      const msg = vars.onchainParlayId ? 'Contract released your stake back to your wallet.' : 'Your parlay offer has been removed.';
      toast({ title: 'Parlay cancelled', description: msg });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    },
    onError: (e: Error) => toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' }),
  });

  const myOffers: Offer[]           = myActivity?.myOffers ?? [];
  const myMatches: any[]            = myActivity?.myMatches ?? [];
  const myParlayOffers: ParlayOffer[] = myActivity?.myParlayOffers ?? [];
  const myBetCount = myOffers.length + myMatches.length + myParlayOffers.length;

  return (
    <Layout>
      <div className="min-h-screen bg-[#070c16] text-white">
        {/* Header */}
        <div className="relative overflow-hidden border-b border-cyan-500/20" style={{ background: 'linear-gradient(135deg, #081520 0%, #0b1e2e 50%, #081218 100%)' }}>
          {/* Glow orbs */}
          <div className="absolute top-0 left-1/4 w-64 h-32 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-0 right-1/4 w-48 h-24 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, rgba(0,255,255,0.15), rgba(0,180,220,0.08))', border: '1px solid rgba(0,255,255,0.25)', boxShadow: '0 0 20px rgba(0,255,255,0.1)' }}>
                  ⚔️
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight" style={{ background: 'linear-gradient(90deg, #00ffff, #00bcd4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    P2P Betting
                  </h1>
                  <p className="text-gray-400 text-sm mt-0.5 flex items-center gap-2">
                    <span className="text-cyan-500/70">No house edge</span>
                    <span className="text-gray-700">·</span>
                    <span className="text-cyan-500/70">Pure P2P</span>
                    <span className="text-gray-700">·</span>
                    <span className="text-cyan-500/70">Winner takes all</span>
                    {onchainEscrow && (
                      <span className="ml-1 text-[11px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-full">⛓ On-chain Escrow</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowContractModal(true)}
                  className="hidden sm:flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-all border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/15 hover:shadow-[0_0_12px_rgba(0,255,255,0.15)]"
                >
                  <FileCode size={11} /> Contract
                </button>
                <div className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${wsConnected ? 'text-green-400 border-green-500/30 bg-green-500/10 shadow-[0_0_8px_rgba(74,222,128,0.1)]' : 'text-gray-500 border-gray-700 bg-gray-800/40'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                  {wsConnected ? 'Live' : 'Connecting…'}
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap gap-3">
              {[
                { value: offers.length, label: 'Open Bets', color: '#00ffff', glow: 'rgba(0,255,255,0.15)' },
                { value: parlays.length, label: 'Open Parlays', color: '#a855f7', glow: 'rgba(168,85,247,0.15)' },
                ...(onchainBook?.onchainCounts ? [{ value: onchainBook.onchainCounts.liveBets, label: 'Live ⛓', color: '#f97316', glow: 'rgba(249,115,22,0.15)' }] : []),
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl px-4 py-3 text-center min-w-[80px] transition-all"
                  style={{ background: `linear-gradient(135deg, ${stat.glow}, rgba(0,0,0,0.3))`, border: `1px solid ${stat.color}25`, boxShadow: `0 0 16px ${stat.glow}` }}>
                  <div className="font-black text-xl leading-none" style={{ color: stat.color }}>{stat.value}</div>
                  <div className="text-gray-500 text-xs mt-1">{stat.label}</div>
                </div>
              ))}
              {myTier ? (
                <div className="rounded-xl px-4 py-3 flex items-center gap-3"
                  style={{ background: `linear-gradient(135deg, ${myTier.color}12, rgba(0,0,0,0.3))`, border: `1px solid ${myTier.color}25` }}>
                  <div>
                    <div className="text-gray-500 text-xs mb-1">Your tier</div>
                    <TierBadge tier={myTier} />
                  </div>
                  <div className="border-l border-gray-700 pl-3">
                    <div className="text-gray-500 text-xs">Taker fee</div>
                    <div className="text-sm font-black text-white">{(myTier.takerFee * 100).toFixed(2)}%</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl px-4 py-3 text-center min-w-[80px]"
                  style={{ background: 'linear-gradient(135deg, rgba(74,222,128,0.1), rgba(0,0,0,0.3))', border: '1px solid rgba(74,222,128,0.2)' }}>
                  <div className="text-green-400 font-black text-xl leading-none">2%</div>
                  <div className="text-gray-500 text-xs mt-1">Base Fee</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── P2P Order Book ── */}
        <div className="max-w-7xl mx-auto px-4 pt-5 pb-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <P2POrderBook
              onAccept={() => setTab('offers')}
            />
            {/* Parlays order book */}
            <div
              className="flex flex-col"
              style={{
                background: '#070c16',
                border: '1px solid rgba(168,85,247,0.15)',
                borderRadius: 14,
                overflow: 'hidden',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              }}
            >
              <div
                className="flex items-center justify-between px-3 py-2.5"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(168,85,247,0.04)' }}
              >
                <span className="text-xs font-black tracking-tight" style={{ color: '#c084fc', textShadow: '0 0 8px rgba(168,85,247,0.4)' }}>
                  <Layers size={12} className="inline mr-1 -mt-0.5" />Open Parlays
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                  {parlays.length}
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                {parlays.length === 0 ? (
                  <div className="text-center py-8 text-gray-700 text-xs">No open parlays</div>
                ) : (
                  parlays.slice(0, 6).map((p, i) => {
                    const firstLeg = p.legs?.[0];
                    const stake = Number(p.creatorStake);
                    const stakeStr = stake >= 1_000_000 ? `${(stake/1_000_000).toFixed(1)}M` : stake >= 1000 ? `${(stake/1000).toFixed(1)}k` : stake.toFixed(2);
                    const expiryDiff = new Date(p.expiresAt).getTime() - Date.now();
                    const expiryH = Math.floor(expiryDiff / 3600000);
                    const expiryM = Math.floor((expiryDiff % 3600000) / 60000);
                    const expiryStr = expiryDiff <= 0 ? 'Expired' : expiryH > 0 ? `${expiryH}h ${expiryM}m` : `${expiryM}m`;
                    const currColor = p.currency === 'SUI' ? '#00ffff' : p.currency === 'SBETS' ? '#c084fc' : p.currency === 'USDC' ? '#22c55e' : p.currency === 'LBTC' ? '#f97316' : '#34d399';
                    return (
                      <button
                        key={p.id}
                        onClick={() => setTab('parlays')}
                        className="w-full px-3 py-2.5 transition-all group hover:bg-white/[0.03] text-left"
                        style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-purple-400 text-xs font-black">{Number(p.totalOdds).toFixed(2)}x</span>
                              <span className="text-gray-600 text-[10px] border border-gray-700/50 rounded px-1">{p.legCount}-leg</span>
                              <span className="text-[9px] font-bold px-1 rounded" style={{ color: currColor, background: `${currColor}18` }}>{p.currency}</span>
                            </div>
                            {firstLeg ? (
                              <div className="text-[10px] text-gray-400 truncate leading-tight">
                                {firstLeg.homeTeam} <span className="text-gray-600">vs</span> {firstLeg.awayTeam}
                                {p.legCount > 1 && <span className="text-gray-600 ml-1">+{p.legCount - 1} more</span>}
                              </div>
                            ) : (
                              <div className="text-[10px] text-gray-600">{p.legCount} legs</div>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-gray-200 text-xs font-bold">{stakeStr}</div>
                            <div className="text-[9px]" style={{ color: expiryDiff < 3600000 ? '#f87171' : '#6b7280' }}>{expiryStr}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {parlays.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(168,85,247,0.04)' }}>
                  <button
                    onClick={() => setTab('parlays')}
                    className="w-full text-[10px] font-semibold py-2 text-purple-500 hover:text-purple-400 transition-all"
                  >
                    View all {parlays.length} parlays →
                  </button>
                </div>
              )}
            </div>

            {/* Market depth summary */}
            <div
              className="flex flex-col gap-2.5"
              style={{
                background: '#070c16',
                border: '1px solid rgba(0,255,255,0.10)',
                borderRadius: 14,
                padding: '14px 14px',
              }}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-black tracking-tight" style={{ color: '#00ffff', textShadow: '0 0 8px rgba(0,255,255,0.4)' }}>
                  📊 Market Depth
                </span>
                <span className="text-[10px] text-gray-600">
                  {new Set(allOffers.filter(o => (o.status === 'open' || o.status === 'partial') && new Date(o.expiresAt).getTime() > Date.now()).map(o => o.eventId)).size} markets
                </span>
              </div>

              {(['SUI', 'SBETS', 'USDSUI', 'USDC', 'LBTC'] as const).map(c => {
                const now2 = Date.now();
                const cOffers = allOffers.filter(o => o.currency === c && (o.status === 'open' || o.status === 'partial') && new Date(o.expiresAt).getTime() > now2);
                const vol = cOffers.reduce((s, o) => s + Math.max(0, (o.takerStake ?? 0) - (o.filledStake ?? 0)), 0);
                const volStr = vol >= 1_000_000 ? `${(vol/1_000_000).toFixed(1)}M` : vol >= 1000 ? `${(vol/1000).toFixed(1)}k` : vol.toFixed(2);
                const minOdds = cOffers.length > 0 ? Math.min(...cOffers.map(o => o.odds)) : 0;
                const maxOdds = cOffers.length > 0 ? Math.max(...cOffers.map(o => o.odds)) : 0;
                const avgOdds = cOffers.length > 0 ? cOffers.reduce((s, o) => s + o.odds, 0) / cOffers.length : 0;
                const uniqueMarkets = new Set(cOffers.map(o => o.eventId)).size;
                const topEventOffers = cOffers.reduce((acc, o) => {
                  acc[o.eventId] = (acc[o.eventId] ?? 0) + 1;
                  return acc;
                }, {} as Record<string, number>);
                const topEventId = Object.entries(topEventOffers).sort((a, b) => b[1] - a[1])[0]?.[0];
                const topEventOffer = cOffers.find(o => o.eventId === topEventId);
                const topMktName = topEventOffer ? `${topEventOffer.homeTeam} vs ${topEventOffer.awayTeam}` : null;
                const rgb = c === 'SUI' ? '0,255,255' : c === 'SBETS' ? '168,85,247' : c === 'USDC' ? '34,197,94' : c === 'LBTC' ? '249,115,22' : '34,211,238';
                const color = c === 'SUI' ? '#00ffff' : c === 'SBETS' ? '#a855f7' : c === 'USDC' ? '#22c55e' : c === 'LBTC' ? '#f97316' : '#22d3ee';
                return (
                  <div key={c} className="rounded-xl px-3 py-2.5" style={{ background: `rgba(${rgb},0.04)`, border: `1px solid rgba(${rgb},0.1)` }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-black" style={{ color }}>{c}</span>
                      <span className="text-[10px] font-semibold text-gray-500">{cOffers.length} offer{cOffers.length !== 1 ? 's' : ''}</span>
                    </div>
                    {cOffers.length > 0 ? (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <div className="text-[9px] text-gray-600 uppercase tracking-wider">Avail. stake</div>
                            <div className="text-xs font-bold text-gray-200">{volStr}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[9px] text-gray-600 uppercase tracking-wider">Avg odds</div>
                            <div className="text-xs font-bold" style={{ color }}>{avgOdds.toFixed(2)}x</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[9px] text-gray-600 uppercase tracking-wider">Range</div>
                            <div className="text-[10px] font-bold" style={{ color }}>{minOdds.toFixed(2)}–{maxOdds.toFixed(2)}x</div>
                          </div>
                        </div>
                        {topMktName && (
                          <div className="text-[9px] text-gray-600 truncate" title={topMktName}>
                            🔥 <span className="text-gray-500">{topMktName}</span>
                            {uniqueMarkets > 1 && <span className="text-gray-700 ml-1">+{uniqueMarkets - 1} more</span>}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-[10px] text-gray-700">No open offers</div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={() => setTab('offers')}
                className="mt-auto text-xs font-bold py-2 rounded-xl transition-all text-black"
                style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)', boxShadow: '0 0 12px rgba(0,255,255,0.25)' }}
              >
                ⚔️ Browse All Offers
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-5">
          {/* Tabs */}
          <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
            {([
              { key: 'upcoming',   label: '📅 Upcoming',     count: 0 },
              { key: 'parlays',    label: '⧉ Parlays',        count: parlays.length },
              { key: 'my',         label: '👤 My Bets',        count: myBetCount },
              { key: 'settling',   label: '⏳ Settling',       count: 0, pulse: true },
              { key: 'leaderboard',label: '🏆 Board',          count: 0 },
              { key: 'onchain',    label: '⛓ On-chain',       count: 0 },
              { key: 'refunds',    label: '♻️ Refunds',        count: 0, adminOnly: true },
            ] as { key: typeof tab; label: string; count: number; pulse?: boolean; adminOnly?: boolean }[]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  tab === t.key
                    ? t.key === 'onchain'   ? 'text-white'
                    : t.key === 'settling'  ? 'text-white'
                    : t.key === 'refunds'   ? 'text-white'
                    : 'text-black'
                    : 'text-gray-400 hover:text-white'
                }`}
                style={tab === t.key ? {
                  background: t.key === 'onchain'    ? 'linear-gradient(135deg,#0e7490,#0891b2)' :
                              t.key === 'settling'   ? 'linear-gradient(135deg,#ea580c,#f97316)' :
                              t.key === 'refunds'    ? 'linear-gradient(135deg,#854d0e,#a16207)' :
                              'linear-gradient(135deg,#00ffff,#00bcd4)',
                  boxShadow: t.key === 'settling'
                    ? '0 0 16px rgba(249,115,22,0.4)'
                    : t.key === 'refunds'
                    ? '0 0 16px rgba(250,204,21,0.3)'
                    : '0 0 16px rgba(0,255,255,0.35)',
                } : { background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                {t.label}
                {t.pulse && tab !== t.key && myWallet && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse flex-shrink-0" />
                )}
                {t.count > 0 && (
                  <span className={`text-xs font-bold rounded-full px-1.5 leading-5 ${tab === t.key ? 'bg-black/20 text-black/70' : 'bg-cyan-500/15 text-cyan-400'}`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* CTA banner — only show on non-upcoming, non-onchain tabs */}
          {tab !== 'onchain' && tab !== 'upcoming' && (
            <div className="relative overflow-hidden rounded-2xl p-4 mb-6 flex items-center gap-4"
              style={{ background: 'linear-gradient(135deg, rgba(0,255,255,0.06) 0%, rgba(0,150,200,0.04) 50%, rgba(168,85,247,0.06) 100%)', border: '1px solid rgba(0,255,255,0.12)', boxShadow: '0 0 30px rgba(0,255,255,0.04)' }}>
              <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(0,255,255,0.04) 0%, transparent 60%)' }} />
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.2)' }}>💡</div>
              <div className="flex-1 min-w-0 relative">
                <div className="text-white font-bold text-sm">Create your own offer</div>
                <div className="text-gray-500 text-xs mt-0.5">Pick a match from the Upcoming tab, open the bet slip, and switch to P2P mode</div>
              </div>
              <button onClick={() => setTab('upcoming')}
                className="relative font-bold px-5 py-2 rounded-xl text-sm whitespace-nowrap flex-shrink-0 transition-all text-black"
                style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)', boxShadow: '0 0 16px rgba(0,255,255,0.35)' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 24px rgba(0,255,255,0.55)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 16px rgba(0,255,255,0.35)')}>
                Browse Matches
              </button>
            </div>
          )}

          {/* ─── Upcoming Matches Tab ─── */}
          {tab === 'upcoming' && (() => {
            const P2P_SPORTS = [
              { id: null,  name: 'All',             icon: '🌍' },
              { id: 1,     name: 'Football',        icon: '⚽' },
              { id: 2,     name: 'Basketball',      icon: '🏀' },
              { id: 6,     name: 'Hockey',          icon: '🏒' },
              { id: 5,     name: 'Baseball',        icon: '⚾' },
              { id: 9,     name: 'Esports',         icon: '🎮' },
              { id: 7,     name: 'MMA',             icon: '🥊' },
              { id: 4,     name: 'American Football', icon: '🏈' },
              { id: 18,    name: 'Cricket',         icon: '🏏' },
            ];

            const formatMatchTime = (dateStr: string) => {
              try {
                const d = new Date(dateStr);
                const now = new Date();
                const isToday = d.toDateString() === now.toDateString();
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const isTomorrow = d.toDateString() === tomorrow.toDateString();
                const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                if (isToday) return { label: 'Today', time: t, urgent: true };
                if (isTomorrow) return { label: 'Tomorrow', time: t, urgent: false };
                return { label: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }), time: t, urgent: false };
              } catch { return { label: '—', time: '', urgent: false }; }
            };

            const filtered = (Array.isArray(upcomingEvents) ? upcomingEvents : []).filter((ev: any) => {
              if (!upcomingSearch.trim()) return true;
              const q = upcomingSearch.toLowerCase();
              return (ev.homeTeam || '').toLowerCase().includes(q) ||
                     (ev.awayTeam || '').toLowerCase().includes(q) ||
                     (ev.leagueName || ev.league || '').toLowerCase().includes(q);
            });

            // Group by league
            const byLeague: Record<string, any[]> = {};
            for (const ev of filtered) {
              const league = ev.leagueName || ev.league || 'Other';
              if (!byLeague[league]) byLeague[league] = [];
              byLeague[league].push(ev);
            }
            const leagueEntries = Object.entries(byLeague);

            return (
              <div>
                {/* Header */}
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    <span className="text-xs font-black tracking-widest uppercase text-cyan-400">Upcoming Matches</span>
                  </div>
                  <p className="text-gray-500 text-xs">Pick a match, add to bet slip, switch to P2P mode to post your offer</p>
                </div>

                {/* Sport filter pills */}
                <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4">
                  {P2P_SPORTS.map(s => (
                    <button key={String(s.id)} onClick={() => setUpcomingSport(s.id as number | null)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all"
                      style={{
                        background: upcomingSport === s.id ? '#00ffff' : 'rgba(255,255,255,0.05)',
                        color: upcomingSport === s.id ? '#000' : '#6b7280',
                        border: `1px solid ${upcomingSport === s.id ? '#00ffff' : 'rgba(255,255,255,0.07)'}`,
                      }}>
                      {s.icon} {s.name}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="relative mb-5">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                  <input
                    value={upcomingSearch}
                    onChange={e => setUpcomingSearch(e.target.value)}
                    placeholder="Search teams or leagues…"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm bg-transparent text-white placeholder-gray-600 focus:outline-none"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  />
                </div>

                {upcomingLoading ? (
                  <div className="space-y-3">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className="rounded-2xl animate-pulse h-20"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }} />
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="text-5xl mb-4">📅</div>
                    <div className="text-gray-400 font-bold">No upcoming matches</div>
                    <div className="text-gray-600 text-sm mt-2">Try a different sport or clear your search</div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {leagueEntries.map(([league, evs]) => (
                      <div key={league} className="rounded-2xl overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        {/* League header */}
                        <div className="px-4 py-2.5 flex items-center gap-2"
                          style={{ background: 'rgba(0,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <span className="text-cyan-400 font-bold text-xs">{league}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                            style={{ background: 'rgba(0,255,255,0.1)', color: '#00ffff' }}>{evs.length}</span>
                        </div>
                        {/* Events */}
                        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                          {evs.map((ev: any, idx: number) => {
                            const { label, time, urgent } = formatMatchTime(ev.startTime);
                            const hasOdds = ev.homeOdds && ev.homeOdds > 0;
                            return (
                              <div key={`${ev.id}-${idx}`}
                                className="flex items-center gap-3 px-4 py-3.5 transition-all group"
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                {/* Time */}
                                <div className="w-16 flex-shrink-0 text-right">
                                  <div className="text-[10px] font-bold" style={{ color: urgent ? '#fb923c' : '#4b5563' }}>{label}</div>
                                  <div className="text-xs font-mono text-gray-500">{time}</div>
                                </div>
                                {/* Teams */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    {ev.homeLogo && <img src={ev.homeLogo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />}
                                    <span className="font-bold text-white text-sm truncate">{ev.homeTeam}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {ev.awayLogo && <img src={ev.awayLogo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />}
                                    <span className="font-bold text-white text-sm truncate">{ev.awayTeam}</span>
                                  </div>
                                </div>
                                {/* Team picker — always visible, lets user choose who they think wins */}
                                {(() => {
                                  const rH = ev.homeOdds ? 1 / ev.homeOdds : 0;
                                  const rX = ev.drawOdds ? 1 / ev.drawOdds : 0;
                                  const rA = ev.awayOdds ? 1 / ev.awayOdds : 0;
                                  const tot = rH + rX + rA || 1;
                                  const outcomes = hasOdds ? [
                                    { label: 'H', outcomeId: 'home', selectionName: ev.homeTeam, val: ev.homeOdds, pct: Math.round(rH / tot * 100), color: '#00ffff' },
                                    ...(ev.drawOdds ? [{ label: 'X', outcomeId: 'draw', selectionName: 'Draw', val: ev.drawOdds, pct: Math.round(rX / tot * 100), color: '#facc15' }] : []),
                                    { label: 'A', outcomeId: 'away', selectionName: ev.awayTeam, val: ev.awayOdds, pct: Math.round(rA / tot * 100), color: '#a78bfa' },
                                  ] : [
                                    { label: 'H', outcomeId: 'home', selectionName: ev.homeTeam, val: 2.0, pct: null, color: '#00ffff' },
                                    { label: 'X', outcomeId: 'draw', selectionName: 'Draw', val: 2.0, pct: null, color: '#facc15' },
                                    { label: 'A', outcomeId: 'away', selectionName: ev.awayTeam, val: 2.0, pct: null, color: '#a78bfa' },
                                  ];
                                  return (
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      {outcomes.map(o => (
                                        <button key={o.label}
                                          onClick={() => {
                                            addBet({
                                              id: `${ev.id}-match-winner-${o.outcomeId}`,
                                              eventId: String(ev.id),
                                              eventName: `${ev.homeTeam} vs ${ev.awayTeam}`,
                                              marketId: 'match-winner',
                                              market: 'Match Winner',
                                              outcomeId: o.outcomeId,
                                              selectionId: o.outcomeId,
                                              selectionName: o.selectionName,
                                              odds: o.val,
                                              homeTeam: ev.homeTeam,
                                              awayTeam: ev.awayTeam,
                                              isLive: false,
                                              leagueName: ev.leagueName || ev.league,
                                              sportName: ev.sport,
                                              matchDate: ev.startTime ? new Date(ev.startTime).toISOString() : undefined,
                                            });
                                            window.dispatchEvent(new CustomEvent('open-betslip-p2p', { detail: { odds: String(o.val?.toFixed(2)) } }));
                                            toast({ title: '📋 Added to bet slip', description: `${o.selectionName} — switch to P2P mode to post your offer` });
                                          }}
                                          className="px-2.5 py-1.5 rounded-lg text-xs font-black transition-all"
                                          style={{ background: `${o.color}12`, color: o.color, border: `1px solid ${o.color}30` }}
                                          onMouseEnter={e => (e.currentTarget.style.background = `${o.color}22`)}
                                          onMouseLeave={e => (e.currentTarget.style.background = `${o.color}12`)}>
                                          {o.label}{o.pct !== null ? ` ${o.pct}%` : ''}
                                        </button>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tip at bottom */}
                <div className="mt-6 rounded-2xl p-4 flex items-start gap-3"
                  style={{ background: 'rgba(0,255,255,0.04)', border: '1px solid rgba(0,255,255,0.1)' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.2)' }}>
                    <span className="text-cyan-400 text-xs font-black">?</span>
                  </div>
                  <div>
                    <div className="text-white font-bold text-xs mb-1">How to create an offer</div>
                    <div className="text-gray-500 text-xs leading-relaxed">
                      Click <strong className="text-cyan-400">H</strong> (home win), <strong className="text-yellow-400">X</strong> (draw), or <strong className="text-purple-400">A</strong> (away win) on any match → added to your bet slip → switch to <strong className="text-cyan-400">P2P mode</strong> in the slip → set your odds &amp; stake → post. Anyone can take the other side.
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ─── Offers Tab ─── */}
          {tab === 'offers' && (
            <div>
              {/* Filter bar */}
              <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                <span className="text-gray-600 text-xs mr-1">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="inline"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                </span>
                {(['all','open','partial','filled','settled','cancelled','expired','voided'] as const).map(f => {
                  const count = f === 'all' ? allOffers.length
                    : f === 'open' ? allOffers.filter(o => o.status === 'open' || o.status === 'partial').length
                    : allOffers.filter(o => o.status === f).length;
                  const isActive = offerFilter === f;
                  const accentColor =
                    f === 'open' || f === 'partial' ? '#00ffff' :
                    f === 'filled' ? '#3b82f6' :
                    f === 'settled' ? '#a855f7' :
                    f === 'cancelled' || f === 'expired' || f === 'voided' ? '#6b7280' :
                    '#00ffff';
                  return (
                    <button key={f} onClick={() => setOfferFilter(f)}
                      className="text-xs font-bold px-3 py-1.5 rounded-full transition-all whitespace-nowrap"
                      style={isActive ? {
                        background: `${accentColor}22`,
                        border: `1px solid ${accentColor}88`,
                        color: accentColor,
                        boxShadow: `0 0 8px ${accentColor}33`,
                      } : {
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#6b7280',
                      }}>
                      {f}{count > 0 && !isActive ? <span className="ml-1 opacity-60">({count})</span> : null}
                    </button>
                  );
                })}
                {/* SuiNS VIP filter */}
                <button onClick={() => setSuinsFilter(f => !f)}
                  title="Show only VIP (.sui name required) pools"
                  className="text-xs font-bold px-3 py-1.5 rounded-full transition-all whitespace-nowrap flex items-center gap-1"
                  style={suinsFilter ? {
                    background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.6)', color: '#a78bfa',
                  } : {
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#6b7280',
                  }}>
                  <Star size={11} /> VIP
                </button>
                {/* Odds format toggle */}
                <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {(['dec','us','frac'] as const).map(f => (
                    <button key={f} onClick={() => setOddsFormat(f)}
                      className="text-[10px] font-bold px-2 py-1 rounded-md transition-all"
                      style={oddsFormat === f
                        ? { background: 'rgba(0,255,255,0.12)', color: '#00ffff', border: '1px solid rgba(0,255,255,0.3)' }
                        : { color: '#4b5563', border: '1px solid transparent' }}>
                      {f === 'dec' ? 'Dec' : f === 'us' ? 'US' : 'Frac'}
                    </button>
                  ))}
                </div>
                <button onClick={() => refetchOffers()} className="text-gray-600 hover:text-gray-400 transition-colors p-1 rounded-lg hover:bg-white/5" title="Refresh">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
              </div>

              {offersLoading ? (
                <div className="text-center py-12 text-gray-500">Loading offers…</div>
              ) : offers.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">🤝</div>
                  <div className="text-gray-400 font-bold">
                    {offerFilter === 'open' ? 'No open offers yet' : `No ${offerFilter} offers`}
                  </div>
                  <div className="text-gray-600 text-sm mt-2">
                    {offerFilter === 'open' ? 'Be first — select a match and post a P2P offer!' : 'Try a different filter above.'}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {offers.map(o => <OfferCard key={o.id} offer={o} onAccept={setAcceptingOffer} myWallet={myWallet} oddsFormat={oddsFormat} />)}
                </div>
              )}
              <FundFlowPanel onchainEscrow={onchainEscrow} />
              <OnchainTxFeed entries={onchainEntries} packageId={onchainFeedData?.packageId} stale={onchainFeedData?.stale} />
              <FeeTiersPanel tiers={feeTiers.length > 0 ? feeTiers : [
                { name: 'Bronze', minVolume: 0, takerFee: 0.02, makerRebate: 0, color: '#cd7f32' },
                { name: 'Silver', minVolume: 100, takerFee: 0.015, makerRebate: 0.001, color: '#c0c0c0' },
                { name: 'Gold', minVolume: 1000, takerFee: 0.01, makerRebate: 0.002, color: '#ffd700' },
                { name: 'Platinum', minVolume: 10000, takerFee: 0.007, makerRebate: 0.003, color: '#b9f2ff' },
                { name: 'Elite', minVolume: 100000, takerFee: 0.005, makerRebate: 0.003, color: '#e040fb' },
              ]} myVolumeData={myVolumeData} />
            </div>
          )}

          {/* ─── Parlays Tab ─── */}
          {tab === 'parlays' && (
            <div>
              {/* Filter bar */}
              <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                <span className="text-gray-600 text-xs mr-1">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="inline"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                </span>
                {(['all','open','filled','settled','cancelled','expired','voided'] as const).map(f => {
                  const count = f === 'all' ? allParlays.length : allParlays.filter(p => p.status === f).length;
                  const isActive = parlayFilter === f;
                  const accentColor =
                    f === 'open' ? '#a855f7' :
                    f === 'filled' ? '#3b82f6' :
                    f === 'settled' ? '#22c55e' :
                    f === 'cancelled' || f === 'expired' || f === 'voided' ? '#6b7280' :
                    '#a855f7';
                  return (
                    <button key={f} onClick={() => setParlayFilter(f)}
                      className="text-xs font-bold px-3 py-1.5 rounded-full transition-all whitespace-nowrap"
                      style={isActive ? {
                        background: `${accentColor}22`,
                        border: `1px solid ${accentColor}88`,
                        color: accentColor,
                        boxShadow: `0 0 8px ${accentColor}33`,
                      } : {
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#6b7280',
                      }}>
                      {f}{count > 0 && !isActive ? <span className="ml-1 opacity-60">({count})</span> : null}
                    </button>
                  );
                })}
                <button onClick={() => refetchParlays()} className="ml-auto text-gray-600 hover:text-gray-400 transition-colors p-1 rounded-lg hover:bg-white/5" title="Refresh">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
              </div>

              {parlaysLoading ? (
                <div className="text-center py-12 text-gray-500">Loading parlays…</div>
              ) : parlays.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.25)' }}>
                    <Layers size={26} className="text-purple-400" />
                  </div>
                  <div className="text-gray-400 font-bold">
                    {parlayFilter === 'open' ? 'No open parlay offers' : `No ${parlayFilter} parlays`}
                  </div>
                  <div className="text-gray-600 text-sm mt-2">
                    {parlayFilter === 'open' ? 'Add multiple matches to your bet slip and post a P2P parlay!' : 'Try a different filter above.'}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {parlays.map(p => <ParlayCard key={p.id} offer={p} onAccept={setAcceptingParlay} myWallet={myWallet} />)}
                </div>
              )}
              <ParlayRulesPanel />
              <OnchainTxFeed entries={onchainEntries} packageId={onchainFeedData?.packageId} stale={onchainFeedData?.stale} />
              <FeeTiersPanel tiers={feeTiers.length > 0 ? feeTiers : [
                { name: 'Bronze', minVolume: 0, takerFee: 0.02, makerRebate: 0, color: '#cd7f32' },
                { name: 'Silver', minVolume: 100, takerFee: 0.015, makerRebate: 0.001, color: '#c0c0c0' },
                { name: 'Gold', minVolume: 1000, takerFee: 0.01, makerRebate: 0.002, color: '#ffd700' },
                { name: 'Platinum', minVolume: 10000, takerFee: 0.007, makerRebate: 0.003, color: '#b9f2ff' },
                { name: 'Elite', minVolume: 100000, takerFee: 0.005, makerRebate: 0.003, color: '#e040fb' },
              ]} myVolumeData={myVolumeData} />
            </div>
          )}

          {/* ─── My Bets Tab ─── */}
          {tab === 'my' && (
            <div className="space-y-6">
              {!myWallet ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">🔗</div>
                  <div className="text-gray-400 font-bold">Connect your wallet to see your bets</div>
                </div>
              ) : (
                <>
                  {/* NFT Bet Objects on Sui */}
                  {(() => {
                    const allOnchainIds: { id: string; type: string; event: string; status: string; currency: string; stake: number }[] = [
                      ...myOffers.filter(o => o.onchainOfferId).map(o => ({
                        id: o.onchainOfferId!,
                        type: 'Offer (Maker)',
                        event: o.eventName ?? 'Event',
                        status: o.status,
                        currency: o.currency ?? 'SUI',
                        stake: o.creatorStake,
                      })),
                      ...myMatches.filter((m: any) => m.onchainBetId).map((m: any) => ({
                        id: m.onchainBetId!,
                        type: 'Bet (Taker)',
                        event: m.offer?.eventName ?? 'Event',
                        status: m.status ?? 'active',
                        currency: m.offer?.currency ?? 'SUI',
                        stake: m.stake ?? 0,
                      })),
                      ...myParlayOffers.filter(p => p.onchainParlayId).map(p => ({
                        id: p.onchainParlayId!,
                        type: 'Parlay',
                        event: `${p.legs?.length ?? '?'}-leg parlay`,
                        status: p.status,
                        currency: p.currency ?? 'SUI',
                        stake: p.creatorStake,
                      })),
                    ];
                    return (
                      <div className="rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a1628, #0d1e30)', border: '1px solid rgba(0,255,255,0.2)', boxShadow: '0 0 24px rgba(0,255,255,0.05)' }}>
                        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'rgba(0,255,255,0.1)', background: 'rgba(0,255,255,0.04)' }}>
                          <span className="text-lg">🎴</span>
                          <span className="text-cyan-400 text-xs font-black uppercase tracking-wider">My P2P NFT Bet Objects</span>
                          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.25)', color: '#00ffff' }}>
                            {allOnchainIds.length} on-chain
                          </span>
                        </div>
                        <div className="p-3">
                          {allOnchainIds.length === 0 ? (
                            <div className="text-center py-6">
                              <div className="text-3xl mb-2">🔷</div>
                              <div className="text-gray-500 text-xs">No on-chain bet objects yet.</div>
                              <div className="text-gray-600 text-xs mt-1">Post or accept a P2P offer to mint your first Sui bet NFT.</div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {allOnchainIds.map(item => {
                                const curColor = item.currency === 'SUI' ? '#38bdf8' : item.currency === 'SBETS' ? '#a78bfa' : item.currency === 'LBTC' ? '#f59e0b' : item.currency === 'USDC' ? '#60a5fa' : '#34d399';
                                const statusColor = item.status === 'open' || item.status === 'active' ? '#22c55e' : item.status === 'filled' || item.status === 'settling' ? '#f97316' : item.status === 'won' ? '#22c55e' : item.status === 'settled' ? '#a855f7' : '#6b7280';
                                return (
                                  <a key={item.id} href={`https://suivision.xyz/object/${item.id}`} target="_blank" rel="noopener noreferrer"
                                    className="group rounded-lg p-3 transition-all"
                                    style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)' }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,255,0.2)'; (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,255,0.03)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.4)'; }}>
                                    <div className="flex items-start justify-between mb-2">
                                      <div>
                                        <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: curColor }}>{item.type}</div>
                                        <div className="text-white text-xs font-medium truncate max-w-[150px]">{item.event}</div>
                                      </div>
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ color: statusColor, background: statusColor + '20', border: `1px solid ${statusColor}40` }}>{item.status.toUpperCase()}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <code className="text-[9px] font-mono text-gray-500 truncate flex-1">{item.id.slice(0, 12)}…{item.id.slice(-8)}</code>
                                      <span className="text-[10px] font-bold" style={{ color: curColor }}>{item.stake} {item.currency}</span>
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-600 group-hover:text-cyan-400 flex-shrink-0 transition-colors"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                    </div>
                                  </a>
                                );
                              })}
                            </div>
                          )}
                          {allOnchainIds.length > 0 && (
                            <p className="text-gray-600 text-[10px] mt-2 text-center">Each bet is a Sui ownable object (NFT). Click to view on SuiVision explorer.</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {myVolumeData && (
                    <div className="bg-[#111827] border border-[#1e2a3a] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-gray-400 text-xs font-bold uppercase tracking-wider">Your Volume Stats</div>
                        <TierBadge tier={myVolumeData.tier} />
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-center text-xs">
                        <div>
                          <div className="text-white font-bold text-sm">{(myVolumeData.totalVolume ?? 0).toFixed(2)}</div>
                          <div className="text-gray-500">Total Vol (SUI)</div>
                        </div>
                        <div>
                          <div className="text-white font-bold text-sm">{myVolumeData.totalBets ?? 0}</div>
                          <div className="text-gray-500">Total Bets</div>
                        </div>
                        <div>
                          <div className={`font-bold text-sm ${(myVolumeData.totalNetPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(myVolumeData.totalNetPnl ?? 0) >= 0 ? '+' : ''}{(myVolumeData.totalNetPnl ?? 0).toFixed(3)}
                          </div>
                          <div className="text-gray-500">Net P&L (SUI)</div>
                        </div>
                      </div>
                      {myVolumeData.tier?.name !== 'Elite' && (() => {
                        const tierThresholds = [100, 1000, 10000, 100000];
                        const nextThreshold = tierThresholds.find(t => t > myVolumeData.totalVolume);
                        const needed = nextThreshold ? (nextThreshold - myVolumeData.totalVolume).toFixed(1) : '';
                        return needed ? (
                          <div className="mt-3 text-xs text-gray-600">
                            Next tier: trade {needed} more SUI for lower fees
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}

                  {myOffers.length > 0 && (
                    <div>
                      <h3 className="text-gray-400 font-bold text-xs mb-3 uppercase tracking-wider">My Offers ({myOffers.length})</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {myOffers.map(o => <OfferCard key={o.id} offer={o} onAccept={() => {}} onCancel={cancelOfferMutation.mutate} onReclaimContract={handleReclaimFromContract} reclaimingId={reclaimingId} myWallet={myWallet} oddsFormat={oddsFormat} />)}
                      </div>
                    </div>
                  )}

                  {myMatches.length > 0 && (
                    <div>
                      <h3 className="text-gray-400 font-bold text-xs mb-3 uppercase tracking-wider">Offers I Accepted ({myMatches.length})</h3>
                      <div className="space-y-2">
                        {myMatches.map((m: any) => (
                          <div key={m.id} className="bg-[#111827] border border-[#1e2a3a] rounded-xl p-4">
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="flex items-center gap-2">
                                  <div className="text-white font-bold text-sm">{m.offer?.eventName ?? 'Event'}</div>
                                  {m.onchainBetId && <OnchainBadge objectId={m.onchainBetId} />}
                                </div>
                                <div className="text-orange-400 text-xs mt-0.5">Took opposite · Stake: {m.stake} {m.offer?.currency}</div>
                                {m.actualPayout && m.status === 'won' && (
                                  <div className="text-green-400 text-xs mt-0.5">Won: {Number(m.actualPayout).toFixed(4)} {m.offer?.currency}</div>
                                )}
                                {m.netFee != null && (
                                  <div className="text-gray-600 text-xs mt-0.5">Fee paid: {Number(m.netFee).toFixed(4)} {m.offer?.currency}</div>
                                )}
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full font-bold flex-shrink-0 ${
                                m.status === 'active'  ? 'bg-blue-500/20 text-blue-400' :
                                m.status === 'settling'? 'bg-yellow-500/20 text-yellow-400' :
                                m.status === 'won'     ? 'bg-green-500/20 text-green-400' :
                                'bg-red-500/20 text-red-400'
                              }`}>{m.status.toUpperCase()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {myParlayOffers.length > 0 && (
                    <div>
                      <h3 className="text-gray-400 font-bold text-xs mb-3 uppercase tracking-wider">My Parlays ({myParlayOffers.length})</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {myParlayOffers.map(p => <ParlayCard key={p.id} offer={p} onAccept={() => {}} onCancel={cancelParlayMutation.mutate} myWallet={myWallet} />)}
                      </div>
                    </div>
                  )}

                  {/* Recovery panel — shown when localStorage has bets that didn't save to DB */}
                  {(() => {
                    const myPending = pendingOffers.filter(p => p.creatorWallet === myWallet);
                    const myPendingMatches: any[] = (() => {
                      try { return JSON.parse(localStorage.getItem('pendingP2PMatches') ?? '[]').filter((m: any) => m.takerWallet === myWallet); } catch { return []; }
                    })();
                    const total = myPending.length + myPendingMatches.length;
                    if (total === 0) return null;
                    return (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-2">
                        <div className="flex items-start gap-3">
                          <span className="text-yellow-400 text-xl flex-shrink-0">⚠️</span>
                          <div className="flex-1">
                            <div className="text-yellow-400 font-bold text-sm mb-1">
                              {total} on-chain bet{total > 1 ? 's' : ''} need{total === 1 ? 's' : ''} syncing
                            </div>
                            <div className="text-gray-400 text-xs mb-3">
                              {total > 1 ? 'These bets were' : 'This bet was'} confirmed on-chain but didn't save to the database due to a temporary issue. Click below to sync {total > 1 ? 'them' : 'it'} now.
                            </div>
                            <div className="space-y-1 mb-3">
                              {myPending.map((p, i) => (
                                <div key={i} className="text-xs text-gray-500 flex items-center gap-2">
                                  <span className="text-cyan-500">⚔️</span>
                                  <span>{p.eventName ?? 'Unknown event'} — {p.creatorStake} {p.currency} @ {Number(p.odds).toFixed(2)}x</span>
                                </div>
                              ))}
                              {myPendingMatches.map((m, i) => (
                                <div key={i} className="text-xs text-gray-500 flex items-center gap-2">
                                  <span className="text-orange-400">🤝</span>
                                  <span>Accepted offer #{m.offerId} — stake: {m.stake}</span>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={syncPendingOffers}
                              disabled={syncingPending}
                              className="bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-500/40 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                            >
                              {syncingPending ? 'Syncing...' : `Sync ${total} Bet${total > 1 ? 's' : ''} to Database`}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {myOffers.length === 0 && myMatches.length === 0 && myParlayOffers.length === 0 && pendingOffers.filter(p => p.creatorWallet === myWallet).length === 0 && (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-4">🎲</div>
                      <div className="text-gray-400 font-bold">No P2P activity yet</div>
                      <div className="text-gray-600 text-sm mt-2">Browse matches and post your first challenge!</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── Leaderboard Tab ─── */}
          {tab === 'leaderboard' && (
            <div>
              <div className="bg-[#111827] border border-[#1e2a3a] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e2a3a] flex items-center gap-2">
                  <Trophy size={14} className="text-yellow-400" />
                  <span className="text-white font-bold text-sm">Top P2P Traders by Volume</span>
                </div>
                {leaderboard.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">No data yet</div>
                ) : (
                  <div className="divide-y divide-[#1e2a3a]">
                    {leaderboard.map((entry: any, i: number) => (
                      <div key={entry.walletAddress ?? i} className={`flex items-center gap-3 px-4 py-3 ${entry.walletAddress === myWallet ? 'bg-cyan-500/5' : ''}`}>
                        <div className="w-7 text-center font-black text-sm text-gray-500">
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-xs font-mono">{truncateWallet(entry.walletAddress)}</span>
                            <TierBadge tier={entry.tier} />
                            {entry.walletAddress === myWallet && <span className="text-cyan-400 text-xs font-bold">YOU</span>}
                          </div>
                          <div className="text-gray-600 text-xs mt-0.5">{entry.totalBets ?? 0} bets</div>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-bold text-sm">{(entry.totalVolume ?? 0).toFixed(1)} SUI</div>
                          <div className={`text-xs ${(entry.totalNetPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(entry.totalNetPnl ?? 0) >= 0 ? '+' : ''}{(entry.totalNetPnl ?? 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Settling / Dispute Window Tab ─── */}
          {tab === 'settling' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-white font-bold text-sm flex items-center gap-2">
                  <Clock size={14} className="text-orange-400" /> Active Dispute Windows
                </div>
                <a href="/settlement"
                  className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-bold transition-colors border border-cyan-500/30 px-2.5 py-1 rounded-lg hover:border-cyan-400/50"
                >
                  <ExternalLink size={11} /> Full settlement page
                </a>
              </div>
              <DisputeCountdown />
            </div>
          )}

          {/* ─── On-chain Tab ─── */}
          {tab === 'onchain' && (
            <OnchainBookTab data={onchainBook} />
          )}

          {/* ─── Pending Refunds Tab (admin) ─── */}
          {tab === 'refunds' && (
            <PendingRefundsPanel
              adminToken={adminToken}
              onTokenChange={(t) => {
                setAdminToken(t);
                if (t) sessionStorage.setItem('adminToken', t);
                else sessionStorage.removeItem('adminToken');
              }}
            />
          )}
        </div>

        {/* YourOpenBetsPanel is now global — rendered in App.tsx for all pages */}

        {/* Modals */}
        {showContractModal && <P2PContractModal onClose={() => setShowContractModal(false)} />}
        <AcceptModal
          offer={acceptingOffer}
          onClose={() => setAcceptingOffer(null)}
          onConfirm={(stake, txHash) => {
            if (!acceptingOffer) return;
            acceptOfferMutation.mutate({ offerId: acceptingOffer.id, stake, txHash, currency: acceptingOffer.currency });
          }}
          myWallet={myWallet}
          contractWallet={contractWallet}
          myTier={myTier}
          makerTier={offerCreatorVolume?.tier ?? null}
          onchainEscrow={onchainEscrow}
          packageId={p2pPackageId}
          configId={p2pConfigId}
          registryId={p2pRegistryId}
        />
        <ParlayAcceptModal
          offer={acceptingParlay}
          onClose={() => setAcceptingParlay(null)}
          onConfirm={(txHash) => {
            if (!acceptingParlay) return;
            acceptParlayMutation.mutate({ parlayId: acceptingParlay.id, txHash, currency: acceptingParlay.currency });
          }}
          contractWallet={contractWallet}
          myWallet={myWallet}
          myTier={myTier}
          makerTier={parlayCreatorVolume?.tier ?? null}
          onchainEscrow={onchainEscrow}
          packageId={p2pPackageId}
          configId={p2pConfigId}
        />
      </div>
    </Layout>
  );
}
