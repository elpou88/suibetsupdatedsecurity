import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { useToast } from '@/hooks/use-toast';
import { useWsOn } from '@/hooks/useWebSocket';
import { ChainEventFeed } from './ChainEventFeed';
import {
  Copy, ExternalLink, ChevronDown, ChevronUp, Info,
  Shield, Clock, Zap, Users, TrendingUp, BarChart2, Trophy, Activity, Loader2, Bell,
  Check, ArrowRight, SortAsc, Sparkles, Lock, Cpu, Database, Share2, Search, X, Layers,
} from 'lucide-react';

// ─── Coin type constants (Sui mainnet) ────────────────────────────────────────
const P2P_SUI_COIN_TYPE    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const P2P_SBETS_COIN_TYPE  = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const P2P_USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
const P2P_USDC_COIN_TYPE   = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const P2P_LBTC_COIN_TYPE   = '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC';
const P2P_CLOCK_ID         = '0x0000000000000000000000000000000000000000000000000000000000000006';

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
  createdAt: string;
  winner?: string;
  onchainOfferId?: string;
};

export type ParlayOffer = {
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
  tier: VolumeTier;
  totalVolume: number;
  totalBets: number;
  totalNetPnl: number;
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
  winner: string | null;
  creatorWallet: string | null;
  takerWallet: string | null;
  payoutAmount: number | null;
  payoutTxHash: string | null;
  settledAt: string | null;
  legCount: number | null;
  currency: string;
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
    const oppositeVal = -val;
    return `${otherSide} ${oppositeVal > 0 ? '+' : ''}${oppositeVal}`;
  }
  return 'opposite';
};

const formatTimeLeft = (expiresAt: string) => {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m >= 5) return `${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const getExpiryUrgency = (expiresAt: string): 'expired' | 'urgent' | 'warning' | 'normal' => {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  if (diff < 60_000) return 'urgent';
  if (diff < 300_000) return 'warning';
  return 'normal';
};

function CountUpNumber({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    prevRef.current = value;
    if (start === end) return;
    const duration = 900;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span className={className}>{display}</span>;
}

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return;
    const interval = diff < 300_000 ? 1000 : 60_000;
    const id = setInterval(() => tick(n => n + 1), interval);
    return () => clearInterval(id);
  }, [expiresAt, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 300_000)]);

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
    <div className={`${cls} text-[10px] mt-0.5 flex items-center justify-end gap-1 tabular-nums`}>
      <Clock size={9} />
      {label}
    </div>
  );
}

const truncateWallet = (addr: string) =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const timeAgo = (ts: string | null): string => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

function calcPayoutPreview(
  takerStake: number,
  offer: Offer,
  takerFeeRate = 0.02,
  makerRebateRate = 0,
) {
  if (!takerStake || takerStake <= 0) return null;
  if (!offer.takerStake || offer.takerStake <= 0) return null;
  const creatorEquiv = offer.creatorStake * (takerStake / offer.takerStake);
  const grossPot = r3(takerStake + creatorEquiv);
  const takerFee = r3(grossPot * takerFeeRate);
  const makerRebate = r3(grossPot * makerRebateRate);
  const netFee = r3(takerFee - makerRebate);
  const winnerPayout = r3(grossPot - netFee);
  return { grossPot, takerFee, makerRebate, netFee, winnerPayout };
}

function calcParlayPayoutPreview(
  offer: ParlayOffer,
  takerFeeRate = 0.02,
  makerRebateRate = 0,
) {
  const grossPot = r3(offer.creatorStake + offer.takerStake);
  const takerFee = r3(grossPot * takerFeeRate);
  const makerRebate = r3(grossPot * makerRebateRate);
  const netFee = r3(takerFee - makerRebate);
  const winnerPayout = r3(grossPot - netFee);
  return { grossPot, takerFee, makerRebate, netFee, winnerPayout };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier?: VolumeTier | null }) {
  if (!tier) return null;
  const icons: Record<string, string> = {
    Bronze: '🥉', Silver: '🥈', Gold: '🥇', Diamond: '💎', Elite: '⚡',
  };
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border"
      style={{ color: tier.color, borderColor: tier.color + '50', background: tier.color + '15' }}
    >
      {icons[tier.name] ?? '🎖️'} {tier.name}
    </span>
  );
}

function OnchainBadge({ objectId }: { objectId?: string }) {
  if (!objectId) return null;
  return (
    <a
      href={`https://suiscan.xyz/mainnet/object/${objectId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:text-cyan-300 transition-colors"
      title={`View on-chain object: ${objectId}`}
    >
      <Shield size={9} /> On-chain
    </a>
  );
}

// ─── Sui Address Link ──────────────────────────────────────────────────────────
function SuiAddressLink({ address, label }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const short = label ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={`https://suiscan.xyz/mainnet/account/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-500 hover:text-cyan-400 text-xs font-mono transition-colors"
        title={address}
      >
        {short}
      </a>
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-gray-700 hover:text-cyan-400 transition-colors"
        title="Copy address"
      >
        {copied ? <Check size={9} className="text-green-400" /> : <Copy size={9} />}
      </button>
    </span>
  );
}

// ─── New Badge ────────────────────────────────────────────────────────────────
function NewBadge({ createdAt }: { createdAt?: string | null }) {
  if (!createdAt) return null;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (ageMs > 10 * 60 * 1000) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-500/20 border border-green-500/40 text-green-400 animate-pulse uppercase tracking-wider">
      New
    </span>
  );
}

// ─── Odds Accent ─────────────────────────────────────────────────────────────
function oddsAccent(odds: number) {
  if (odds >= 5) return { border: 'border-l-4 border-l-orange-500', text: 'text-orange-400', glow: 'hover:shadow-[0_0_18px_rgba(249,115,22,0.20)]' };
  if (odds >= 3) return { border: 'border-l-4 border-l-purple-500', text: 'text-purple-400', glow: 'hover:shadow-[0_0_18px_rgba(168,85,247,0.18)]' };
  if (odds >= 2) return { border: 'border-l-4 border-l-cyan-500', text: 'text-cyan-400', glow: 'hover:shadow-[0_0_18px_rgba(34,211,238,0.15)]' };
  return { border: 'border-l-4 border-l-blue-600', text: 'text-blue-400', glow: '' };
}

// ─── Parallel Exec Badge ──────────────────────────────────────────────────────
function ParallelExecBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-sky-500/35 bg-sky-500/10 text-sky-400"
      title="Each leg settles independently via Sui parallel execution"
    >
      <Cpu size={8} /> Parallel Exec
    </span>
  );
}

// ─── Tx Hash Link ─────────────────────────────────────────────────────────────
function TxLink({ hash, label }: { hash?: string | null; label?: string }) {
  if (!hash) return null;
  return (
    <a
      href={`https://suiscan.xyz/mainnet/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] text-gray-600 hover:text-cyan-400 transition-colors font-mono"
      title={`View transaction: ${hash}`}
    >
      {label ?? `${hash.slice(0, 8)}…`}
      <ExternalLink size={8} />
    </a>
  );
}

function PayoutBreakdown({
  grossPot, takerFee, makerRebate, netFee, winnerPayout, currency, takerTier, makerTier,
}: {
  grossPot: number; takerFee: number; makerRebate: number; netFee: number; winnerPayout: number;
  currency: string; takerTier?: VolumeTier | null; makerTier?: VolumeTier | null;
}) {
  return (
    <div className="bg-[#0d1420] border border-[#1e2a3a] rounded-xl p-3 space-y-2 text-sm">
      <div className="flex justify-between text-gray-400">
        <span>Gross pot</span>
        <span className="text-white font-medium">{grossPot.toFixed(4)} {currency}</span>
      </div>
      <div className="flex justify-between text-gray-400">
        <span>
          Taker fee
          {takerTier && (
            <span className="ml-1 text-xs" style={{ color: takerTier.color }}>
              ({(takerTier.takerFee * 100).toFixed(2)}% · {takerTier.name})
            </span>
          )}
        </span>
        <span className="text-red-400">−{takerFee.toFixed(4)} {currency}</span>
      </div>
      {makerRebate > 0 && (
        <div className="flex justify-between text-gray-400">
          <span>
            Maker rebate
            {makerTier && (
              <span className="ml-1 text-xs" style={{ color: makerTier.color }}>
                ({(makerTier.makerRebate * 100).toFixed(2)}% · {makerTier.name})
              </span>
            )}
          </span>
          <span className="text-green-400">+{makerRebate.toFixed(4)} {currency}</span>
        </div>
      )}
      <div className="border-t border-[#1e2a3a] pt-2 flex justify-between font-bold">
        <span className="text-gray-300">You receive if you win</span>
        <span className="text-green-400">{winnerPayout.toFixed(4)} {currency}</span>
      </div>
    </div>
  );
}

function ContractAddressBox({
  wallet, amount, currency, onchainEscrow,
}: {
  wallet: string; amount?: number; currency?: string; onchainEscrow?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  if (!wallet) return null;
  return (
    <div
      className={`border rounded-xl p-3 mb-3 ${
        onchainEscrow
          ? 'bg-cyan-400/8 border-cyan-500/30'
          : 'bg-yellow-400/10 border-yellow-500/25'
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <span className={`text-sm ${onchainEscrow ? 'text-cyan-400' : 'text-yellow-400'}`}>
          {onchainEscrow ? '🔒' : '🔐'}
        </span>
        <div>
          <p className={`text-xs font-bold ${onchainEscrow ? 'text-cyan-400' : 'text-yellow-400'}`}>
            {amount != null && currency
              ? `Send exactly ${amount.toFixed(4)} ${currency} to contract:`
              : 'Contract escrow — send your stake here:'}
          </p>
          <p className={`text-xs mt-0.5 ${onchainEscrow ? 'text-cyan-300/60' : 'text-yellow-300/60'}`}>
            {onchainEscrow
              ? 'On-chain escrow: funds locked until settlement.'
              : 'Funds held securely. Winner receives payout automatically on-chain.'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
        <span className="text-gray-200 text-xs font-mono flex-1 truncate">{wallet}</span>
        <button onClick={copy} className="text-gray-400 hover:text-cyan-400 transition-colors" title="Copy">
          <Copy size={13} />
        </button>
        <a
          href={`https://suiscan.xyz/mainnet/account/${wallet}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-cyan-400 transition-colors"
        >
          <ExternalLink size={13} />
        </a>
      </div>
      {copied && <p className="text-cyan-400 text-xs mt-1">Copied!</p>}
    </div>
  );
}

// ─── Offer Card ───────────────────────────────────────────────────────────────

function OfferCard({
  offer, onAccept, onCancel, myWallet, justFilled,
}: {
  offer: Offer;
  onAccept: (o: Offer) => void;
  onCancel?: (info: { id: number; onchainOfferId?: string; currency?: string }) => void;
  myWallet?: string;
  justFilled?: boolean;
}) {
  const isOwn = offer.creatorWallet === myWallet;
  const remaining = r3(offer.takerStake - (offer.filledStake ?? 0));
  const filledPct =
    offer.takerStake > 0 ? ((offer.filledStake ?? 0) / offer.takerStake) * 100 : 0;
  const grossPotFull = r3(offer.creatorStake + offer.takerStake);
  const accent = oddsAccent(offer.odds);
  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/p2p/offer/${offer.id}`;
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

  return (
    <div
      className={`backdrop-blur-sm rounded-xl overflow-hidden transition-all duration-200 ${
        isOwn
          ? 'border-[1.5px] border-purple-500/50 shadow-[0_0_18px_rgba(168,85,247,0.12)]'
          : `border border-[#1e2a3a] ${accent.border} ${accent.glow} ${
              justFilled
                ? 'border-cyan-400/70 shadow-[0_0_22px_rgba(34,211,238,0.30)]'
                : offer.status === 'open'
                ? 'hover:border-cyan-900/50 hover:-translate-y-[2px] hover:shadow-[0_10px_30px_rgba(0,255,255,0.07),0_2px_10px_rgba(0,0,0,0.5)]'
                : 'opacity-70'
            }`
      }`}
      style={{
        background: isOwn ? 'linear-gradient(135deg,rgba(13,11,24,0.97),rgba(10,8,20,0.97))' : 'rgba(13,17,23,0.95)',
        boxShadow: isOwn ? '0 0 18px rgba(168,85,247,0.12), inset 0 1px 0 rgba(255,255,255,0.04)' : 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Top bar */}
      <div className="px-4 pt-3 pb-2">
        {/* YOUR OFFER banner */}
        {isOwn && !justFilled && (
          <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-purple-500/20 -mx-4 px-4">
            <span className="text-[11px] font-black text-purple-200 bg-purple-500/20 border border-purple-400/40 px-2.5 py-0.5 rounded-full tracking-wider">
              👤 YOUR OFFER
            </span>
            <span className="text-[10px] text-purple-400/60">Share to find a taker</span>
          </div>
        )}
        {justFilled && (
          <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-cyan-300 animate-pulse">
            <Bell size={11} className="text-cyan-400" />
            Your offer was just accepted!
          </div>
        )}

        {/* Header row: event + odds */}
        <div className="flex justify-between items-start gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5 mb-0.5">
              <span className="text-white font-bold text-sm leading-tight truncate max-w-[180px]">{offer.eventName}</span>
              <NewBadge createdAt={offer.createdAt} />
              {offer.onchainOfferId && <OnchainBadge objectId={offer.onchainOfferId} />}
            </div>
            <div className="text-gray-600 text-[11px] flex items-center gap-1">
              {offer.leagueName && <span>{offer.leagueName}</span>}
              {offer.sportName && <span className="text-gray-700">· {offer.sportName}</span>}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`font-black text-2xl leading-none tabular-nums ${accent.text}`}>{Number(offer.odds ?? 0).toFixed(2)}x</div>
            <ExpiryCountdown expiresAt={offer.expiresAt} />
          </div>
        </div>

        {/* Stakes vs block */}
        <div className="flex items-stretch gap-2 mb-2.5">
          <div className="flex-1 bg-green-500/5 border border-green-500/12 rounded-lg p-2.5 text-center">
            <div className="text-[10px] text-gray-600 mb-1 uppercase tracking-wide">Creator bets</div>
            <div className="text-green-400 font-bold text-xs leading-snug truncate">
              {predictionLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}
            </div>
            <div className="text-white font-black text-sm mt-0.5">
              {offer.creatorStake.toLocaleString()}{' '}
              <span className="text-gray-500 font-normal text-[10px]">{offer.currency}</span>
            </div>
          </div>
          <div className="flex items-center justify-center text-gray-700 font-black text-base px-1">⚔</div>
          <div className="flex-1 bg-orange-500/5 border border-orange-500/12 rounded-lg p-2.5 text-center">
            <div className="text-[10px] text-gray-600 mb-1 uppercase tracking-wide">{isOwn ? 'Taker risks' : 'You stake'}</div>
            <div className="text-orange-400 font-bold text-xs leading-snug truncate">
              {oppositePrediction(offer.prediction, offer.homeTeam, offer.awayTeam)}
            </div>
            <div className="text-white font-black text-sm mt-0.5">
              {remaining.toLocaleString(undefined, { maximumFractionDigits: 3 })}{' '}
              <span className="text-gray-500 font-normal text-[10px]">{offer.currency}</span>
            </div>
          </div>
        </div>

        {/* Max win */}
        {!isOwn && offer.status === 'open' && (
          <div className="bg-gradient-to-r from-green-500/8 to-cyan-500/5 border border-green-500/15 rounded-lg px-3 py-1.5 mb-2.5 flex items-center justify-between text-xs">
            <span className="text-gray-500 flex items-center gap-1"><Sparkles size={10} className="text-green-400" /> Max win</span>
            <span className="text-green-400 font-bold">≈{r3(grossPotFull * 0.98).toLocaleString(undefined, { maximumFractionDigits: 3 })} {offer.currency}</span>
          </div>
        )}

        {/* Winner banner */}
        {offer.winner && (
          <div
            className={`text-xs font-bold text-center rounded-lg py-1.5 mb-2.5 ${
              offer.winner === 'creator'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-orange-500/10 text-orange-400'
            }`}
          >
            {offer.winner === 'creator' ? '🏆 Creator won' : '🏆 Taker won'}
          </div>
        )}

        {/* Fill progress */}
        {filledPct > 0 && filledPct < 100 && (
          <div className="mb-2.5">
            <div className="flex justify-between text-[10px] text-gray-600 mb-1">
              <span>Filled {(offer.filledStake ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} / {offer.takerStake.toLocaleString()} {offer.currency}</span>
              <span className="text-cyan-400 font-bold">{filledPct.toFixed(0)}%</span>
            </div>
            <div className="relative h-2 bg-[#1a2235] rounded-full">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${filledPct}%`,
                  background: 'linear-gradient(90deg, #06b6d4, #8b5cf6)',
                  boxShadow: '0 0 8px rgba(6,182,212,0.55)',
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-cyan-400 animate-pulse"
                style={{
                  left: `calc(${filledPct}% - 6px)`,
                  boxShadow: '0 0 10px 3px rgba(6,182,212,0.7)',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[#1a2235] px-4 py-2.5 flex items-center justify-between bg-[#0a0d14]">
        <div className="flex items-center gap-2 min-w-0">
          <Lock size={9} className="text-gray-700 flex-shrink-0" />
          <span className="text-gray-700 text-[10px] flex-shrink-0">By</span>
          <SuiAddressLink address={offer.creatorWallet} />
          <button
            onClick={handleShare}
            title="Copy shareable link"
            className="ml-1 text-gray-400 hover:text-cyan-400 transition-colors flex-shrink-0"
          >
            {shareCopied ? <Check size={10} className="text-green-400" /> : <Share2 size={10} />}
          </button>
        </div>
        {isOwn ? (
          <div className="flex items-center gap-2">
            {justFilled ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-cyan-300 bg-cyan-500/15 border border-cyan-500/40 px-2 py-1 rounded-full animate-pulse">
                <Bell size={10} /> Filled!
              </span>
            ) : (
              <span className="text-[10px] text-purple-400 bg-purple-500/10 px-2 py-1 rounded-full">
                Your offer
              </span>
            )}
            {offer.status === 'open' && onCancel && (
              <button
                onClick={() => onCancel({ id: offer.id, onchainOfferId: offer.onchainOfferId, currency: offer.currency })}
                className="text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2 py-1 rounded-full transition-colors font-bold"
              >
                Cancel
              </button>
            )}
          </div>
        ) : offer.status === 'open' ? (
          <button
            onClick={() => onAccept(offer)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-black font-black text-xs px-4 py-1.5 rounded-lg transition-all shadow-[0_2px_10px_rgba(34,211,238,0.25)] hover:shadow-[0_2px_16px_rgba(34,211,238,0.40)]"
          >
            Accept <ArrowRight size={11} />
          </button>
        ) : (
          <span className="text-[10px] px-2 py-1 rounded-full font-bold text-gray-600 bg-gray-800/60">
            {offer.status.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Parlay Card ──────────────────────────────────────────────────────────────

function ParlayCard({
  offer, onAccept, onCancel, myWallet, justFilled,
}: {
  offer: ParlayOffer;
  onAccept: (o: ParlayOffer) => void;
  onCancel?: (info: { id: number; onchainParlayId?: string; currency?: string }) => void;
  myWallet?: string;
  justFilled?: boolean;
}) {
  const isOwn = offer.creatorWallet === myWallet;
  const [expanded, setExpanded] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/p2p/parlay/${offer.id}`;
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
  const winPayout = r3((offer.creatorStake + offer.takerStake) * 0.98);
  const accent = oddsAccent(offer.totalOdds);
  const INLINE_LEGS = 2;
  const visibleLegs = expanded ? offer.legs : offer.legs.slice(0, INLINE_LEGS);
  const hiddenCount = offer.legs.length - INLINE_LEGS;

  return (
    <div
      className={`rounded-xl overflow-hidden transition-all ${accent.glow} ${
        isOwn
          ? 'border-[1.5px] border-purple-500/50 shadow-[0_0_18px_rgba(168,85,247,0.12)]'
          : `bg-[#0d1117] border border-[#1e2a3a] border-l-4 border-l-purple-500 ${
              justFilled
                ? 'border-purple-400/70 shadow-[0_0_22px_rgba(168,85,247,0.30)]'
                : offer.status === 'open'
                  ? 'hover:border-[#2a3a52]'
                  : 'opacity-70'
            }`
      }`}
      style={{ background: isOwn ? 'linear-gradient(135deg,#110d20,#0d0b1a)' : undefined }}
    >
      <div className="px-4 pt-3 pb-2">
        {/* YOUR PARLAY banner */}
        {isOwn && !justFilled && (
          <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-purple-500/20 -mx-4 px-4">
            <span className="text-[11px] font-black text-purple-200 bg-purple-500/20 border border-purple-400/40 px-2.5 py-0.5 rounded-full tracking-wider">
              👤 YOUR PARLAY
            </span>
            <span className="text-[10px] text-purple-400/60">Share to find a taker</span>
          </div>
        )}
        {justFilled && (
          <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-purple-300 animate-pulse">
            <Bell size={11} className="text-purple-400" />
            Your parlay was just accepted!
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-start gap-3 mb-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5 mb-1">
              <span className="text-purple-400 text-[10px] font-black bg-purple-500/10 border border-purple-500/25 px-2 py-0.5 rounded-full uppercase tracking-wide">
                {offer.legCount}-Leg Parlay
              </span>
              <NewBadge createdAt={offer.createdAt} />
              <ParallelExecBadge />
              {offer.onchainParlayId && <OnchainBadge objectId={offer.onchainParlayId} />}
            </div>
            <div className="text-white text-xs font-semibold leading-snug text-gray-300">
              {offer.legs.slice(0, 2).map(l => l.homeTeam.split(' ').slice(-1)[0]).join(' · ')}
              {offer.legs.length > 2 && <span className="text-gray-600"> +{offer.legs.length - 2} more</span>}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-purple-400 font-black text-2xl leading-none tabular-nums">
              {Number(offer.totalOdds ?? 0).toFixed(2)}x
            </div>
            <ExpiryCountdown expiresAt={offer.expiresAt} />
          </div>
        </div>

        {/* Stakes */}
        <div className="grid grid-cols-2 gap-2 mb-2.5">
          <div className="bg-green-500/5 border border-green-500/12 rounded-lg p-2.5 text-center">
            <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-0.5">Creator stakes</div>
            <div className="text-green-400 font-black text-lg leading-none">{offer.creatorStake.toLocaleString()}</div>
            <div className="text-gray-600 text-[10px] mt-0.5">{offer.currency} · ALL legs must hit</div>
          </div>
          <div className="bg-orange-500/5 border border-orange-500/12 rounded-lg p-2.5 text-center">
            <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-0.5">{isOwn ? 'Taker stakes' : 'You stake'}</div>
            <div className="text-orange-400 font-black text-lg leading-none">{offer.takerStake.toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>
            <div className="text-gray-600 text-[10px] mt-0.5">{offer.currency} · ANY leg fails</div>
          </div>
        </div>

        {/* Max win */}
        {offer.status === 'open' && !isOwn && (
          <div className="bg-gradient-to-r from-green-500/8 to-purple-500/5 border border-green-500/15 rounded-lg px-3 py-1.5 mb-2.5 flex items-center justify-between text-xs">
            <span className="text-gray-500 flex items-center gap-1"><Sparkles size={10} className="text-green-400" /> If you win</span>
            <span className="text-green-400 font-bold">≈{winPayout.toFixed(3)} {offer.currency}</span>
          </div>
        )}

        {/* Winner banner */}
        {offer.winner && (
          <div
            className={`text-xs font-bold text-center rounded-lg py-1.5 mb-2.5 ${
              offer.winner === 'creator'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-orange-500/10 text-orange-400'
            }`}
          >
            {offer.winner === 'creator'
              ? `🏆 Creator won (${offer.legsWon}/${offer.legCount} legs)`
              : '🏆 Taker won (leg failed)'}
          </div>
        )}

        {/* Legs — first 2 always visible */}
        <div className="space-y-1 mb-1.5">
          {visibleLegs.map((leg, i) => {
            const dot =
              leg.status === 'won'
                ? 'bg-green-500'
                : leg.status === 'lost'
                ? 'bg-red-500'
                : 'bg-gray-600 animate-pulse';
            return (
              <div
                key={i}
                className="flex items-center justify-between bg-[#0a0d14] border border-[#161e2e] rounded-lg px-3 py-1.5"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                  <div className="min-w-0">
                    <div className="text-gray-300 text-[11px] font-medium truncate">{leg.eventName}</div>
                    <div className="text-green-400 text-[10px] truncate">
                      {predictionLabel(leg.prediction, leg.homeTeam, leg.awayTeam)}
                    </div>
                  </div>
                </div>
                <span className="text-purple-400 font-bold text-[11px] flex-shrink-0">{Number(leg.odds ?? 0).toFixed(2)}x</span>
              </div>
            );
          })}
        </div>

        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-600 text-[10px] hover:text-gray-400 transition-colors mb-1 flex items-center gap-1"
          >
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {expanded ? 'Show less' : `+${hiddenCount} more leg${hiddenCount > 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[#1a2235] px-4 py-2.5 flex items-center justify-between bg-[#0a0d14]">
        <div className="flex items-center gap-2 min-w-0">
          <Lock size={9} className="text-gray-700 flex-shrink-0" />
          <span className="text-gray-700 text-[10px] flex-shrink-0">By</span>
          <SuiAddressLink address={offer.creatorWallet} />
          <button
            onClick={handleShare}
            title="Copy shareable link"
            className="ml-1 text-gray-400 hover:text-purple-400 transition-colors flex-shrink-0"
          >
            {shareCopied ? <Check size={10} className="text-green-400" /> : <Share2 size={10} />}
          </button>
        </div>
        {isOwn ? (
          <div className="flex items-center gap-2">
            {justFilled ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-purple-300 bg-purple-500/15 border border-purple-500/40 px-2 py-1 rounded-full animate-pulse">
                <Bell size={10} /> Filled!
              </span>
            ) : (
              <span className="text-[10px] text-purple-400 bg-purple-500/10 px-2 py-1 rounded-full">
                Your parlay
              </span>
            )}
            {offer.status === 'open' && onCancel && (
              <button
                onClick={() => onCancel({ id: offer.id, onchainParlayId: offer.onchainParlayId, currency: offer.currency })}
                className="text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2 py-1 rounded-full transition-colors font-bold"
              >
                Cancel
              </button>
            )}
          </div>
        ) : offer.status === 'open' ? (
          <button
            onClick={() => onAccept(offer)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white font-black text-xs px-4 py-1.5 rounded-lg transition-all shadow-[0_2px_10px_rgba(168,85,247,0.25)] hover:shadow-[0_2px_16px_rgba(168,85,247,0.40)]"
          >
            Accept <ArrowRight size={11} />
          </button>
        ) : (
          <span className="text-[10px] text-gray-600 capitalize bg-gray-800/60 px-2 py-1 rounded-full">{offer.status}</span>
        )}
      </div>
    </div>
  );
}

// ─── Settled Tape (Proof-of-Fairness Feed) ────────────────────────────────────

function SettledTape({ myWallet }: { myWallet?: string }) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery<{ tape: TapeEntry[]; updatedAt: number }>({
    queryKey: ['/api/p2p/settled-tape'],
    queryFn: () => fetch('/api/p2p/settled-tape').then(r => r.json()),
    refetchInterval: 30_000,
  });

  const all = data?.tape ?? [];
  const tape = all.slice(0, expanded ? 10 : 5);
  const extra = all.length > 5 ? all.length - 5 : 0;

  return (
    <div className="mt-8 mb-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-black tracking-[0.14em] uppercase text-green-400">
            Proof of Fairness
          </span>
          <span className="text-[10px] text-gray-600 font-mono">· Settled P2P Bets</span>
          <span className="text-[10px] bg-green-500/10 border border-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold ml-1">
            LIVE
          </span>
        </div>
        {extra > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            {expanded ? 'Show less' : `+${extra} more`}
            <ChevronDown size={10} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 gap-2 text-gray-600 text-xs">
          <Loader2 size={12} className="animate-spin" /> Loading settlement history…
        </div>
      ) : tape.length === 0 ? (
        <div className="border border-dashed border-gray-800 rounded-xl py-6 px-4 text-center">
          <div className="text-gray-600 text-xs mb-1">No settled bets yet</div>
          <div className="text-gray-700 text-[10px]">
            Be the first to place and win a P2P bet — it will appear here as cryptographic proof
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {tape.map((entry) => {
            const winnerWallet = entry.winner ?? entry.creatorWallet ?? '';
            const isMe = !!myWallet && winnerWallet.toLowerCase() === myWallet.toLowerCase();
            const txUrl = entry.payoutTxHash
              ? `https://suiscan.xyz/mainnet/tx/${entry.payoutTxHash}`
              : null;
            const payout = entry.payoutAmount ?? entry.totalPot;
            const isParlay = entry.type === 'parlay';

            return (
              <div
                key={`${entry.type}-${entry.id}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs transition-all
                  ${isMe
                    ? 'bg-green-500/5 border-green-500/20'
                    : 'bg-[#0d1420] border-gray-800/60 hover:border-gray-700/60'}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0
                  ${isParlay ? 'bg-purple-500/15' : 'bg-cyan-500/15'}`}>
                  {isParlay
                    ? <Zap size={13} className="text-purple-400" />
                    : <Activity size={13} className="text-cyan-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {isParlay ? (
                      <span className="text-purple-300 font-bold truncate">
                        {entry.legCount ?? '?'}-leg Parlay · {entry.odds.toFixed(2)}x
                      </span>
                    ) : (
                      <span className="text-white font-bold truncate">
                        {entry.homeTeam && entry.awayTeam
                          ? `${entry.homeTeam} vs ${entry.awayTeam}`
                          : entry.eventName ?? 'Match'}
                      </span>
                    )}
                    {isMe && (
                      <span className="shrink-0 text-[9px] bg-green-500/20 text-green-400 border border-green-500/30 px-1 py-0.5 rounded font-black">
                        YOU WON
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] flex-wrap">
                    <span className="text-gray-500">Winner</span>
                    <a
                      href={`https://suiscan.xyz/mainnet/account/${winnerWallet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-mono transition-colors flex items-center gap-0.5"
                    >
                      {truncateWallet(winnerWallet)}
                      <ExternalLink size={8} />
                    </a>
                    <span className="text-gray-700">·</span>
                    <span className="text-gray-600">{timeAgo(entry.settledAt)}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`font-black text-sm ${isMe ? 'text-green-400' : 'text-amber-400'}`}>
                    +{payout.toFixed(2)}
                    <span className="text-[9px] font-normal ml-0.5 text-gray-500">{entry.currency}</span>
                  </span>
                  {txUrl ? (
                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] text-purple-400 hover:text-purple-300 font-mono flex items-center gap-0.5 transition-colors"
                    >
                      on-chain TX <ExternalLink size={7} />
                    </a>
                  ) : (
                    <span className="text-[9px] text-gray-700 font-mono">pending tx</span>
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

// ─── Accept Modal (Single Offer) ──────────────────────────────────────────────

function AcceptModal({
  offer, onClose, onConfirm, myWallet, contractWallet, myTier, makerTier, onchainEscrow,
  packageId, configId, registryId,
}: {
  offer: Offer | null;
  onClose: () => void;
  onConfirm: (stake: number, txHash: string) => void;
  myWallet?: string;
  contractWallet: string;
  myTier?: VolumeTier | null;
  makerTier?: VolumeTier | null;
  onchainEscrow?: boolean;
  packageId?: string;
  configId?: string;
  registryId?: string;
}) {
  const [stake, setStake] = useState('');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();

  if (!offer) return null;

  // On-chain mode requires all three contract IDs to be present
  const isOnchain = !!(offer.onchainOfferId && packageId && configId && registryId);
  const maxStake = r3(offer.takerStake - (offer.filledStake ?? 0));
  const stakeNum = parseFloat(stake) || 0;
  const takerFeeRate = myTier?.takerFee ?? 0.02;
  const makerRebateRate = makerTier?.makerRebate ?? 0;
  const preview = stakeNum > 0 ? calcPayoutPreview(stakeNum, offer, takerFeeRate, makerRebateRate) : null;

  const handleAccept = async () => {
    if (stakeNum <= 0 || stakeNum > maxStake + 0.0001) return;
    setSignError('');
    if (!myWallet) { setSignError('Connect your wallet first to accept this bet'); return; }
    if (new Date(offer.expiresAt).getTime() <= Date.now()) {
      setSignError('This offer has expired and can no longer be accepted.');
      return;
    }
    setSigning(true);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);

      const decimals = (offer.currency === 'USDSUI' || offer.currency === 'USDC') ? 6 : offer.currency === 'LBTC' ? 8 : 9;
      const amountBase = BigInt(Math.round(stakeNum * Math.pow(10, decimals)));
      const coinTypeStr = offer.currency === 'SBETS' ? P2P_SBETS_COIN_TYPE
        : offer.currency === 'USDSUI' ? P2P_USDSUI_COIN_TYPE
        : offer.currency === 'USDC' ? P2P_USDC_COIN_TYPE
        : offer.currency === 'LBTC' ? P2P_LBTC_COIN_TYPE
        : P2P_SUI_COIN_TYPE;
      if (offer.currency === 'USDC') { tx.setGasPrice(0); tx.setGasBudget(0); }

      // Build payment coin — SUI comes from gas object; SBETS/USDSUI need fetched coin objects
      let paymentCoin: any;
      if (offer.currency === 'SUI') {
        [paymentCoin] = tx.splitCoins(tx.gas, [amountBase]);
      } else {
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType: coinTypeStr });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${offer.currency} found in your wallet. Please acquire ${offer.currency} before accepting this bet.`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amountBase]);
      }

      if (isOnchain) {
        // On-chain escrow: call accept_offer on the Move contract
        tx.moveCall({
          target:        `${packageId}::p2p_betting::accept_offer`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(configId!),
            tx.object(registryId!),
            tx.object(offer.onchainOfferId!),
            paymentCoin,
            tx.pure.u64(amountBase),
            tx.object(P2P_CLOCK_ID),
          ],
        });
      } else {
        // Custodial fallback: transfer stake to platform escrow wallet
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-4">
      <div className="bg-[#111827] border border-cyan-500/30 rounded-2xl p-5 w-full max-w-sm mx-4 my-auto">
        <h2 className="text-white font-black text-xl mb-1">Accept P2P Bet</h2>
        <p className="text-gray-500 text-xs mb-4">Take the opposite side of this offer</p>

        {isOnchain && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Shield size={12} className="text-green-400 flex-shrink-0" />
            <span className="text-green-400 text-xs font-medium">On-chain escrow · wallet signs in one step</span>
          </div>
        )}

        <div className="bg-[#0d1420] rounded-xl p-3 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Match</span>
            <span className="text-white font-medium text-right max-w-[60%] truncate">
              {offer.eventName}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Creator picked</span>
            <span className="text-green-400 font-bold">
              {predictionLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">You back</span>
            <span className="text-orange-400 font-bold">
              {oppositePrediction(offer.prediction, offer.homeTeam, offer.awayTeam)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Odds</span>
            <span className="text-cyan-400 font-bold">{Number(offer.odds ?? 0).toFixed(2)}x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Max stake</span>
            <span className="text-cyan-400 font-bold">
              {maxStake.toFixed(4)} {offer.currency}
            </span>
          </div>
        </div>

        {myTier && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-gray-500 text-xs">Your tier:</span>
            <TierBadge tier={myTier} />
            <span className="text-gray-500 text-xs">
              Fee: {(myTier.takerFee * 100).toFixed(2)}%
            </span>
          </div>
        )}

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-gray-400 text-xs">
              Your Stake ({offer.currency}) — partial fill supported
            </label>
            <div className="flex gap-1">
              {[25, 50, 100].map(pct => {
                const val = r3(maxStake * pct / 100);
                const active = stakeNum > 0 && Math.abs(stakeNum - val) < 0.0001;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setStake(val.toString())}
                    className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                      active
                        ? 'bg-cyan-500 text-black'
                        : 'bg-[#1e2a3a] text-cyan-400 hover:bg-cyan-500/20'
                    }`}
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>
          </div>
          <input
            type="number"
            value={stake}
            onChange={e => setStake(e.target.value)}
            max={maxStake}
            step="0.01"
            placeholder={`0 – ${maxStake.toFixed(4)}`}
            className="w-full bg-[#0d1420] border border-[#1e2a3a] focus:border-cyan-500 rounded-lg px-3 py-2 text-white outline-none"
          />
        </div>

        {preview && (
          <div className="mb-4">
            <div className="text-gray-500 text-xs mb-2 flex items-center gap-1">
              <Info size={11} /> Payout breakdown
            </div>
            <PayoutBreakdown
              {...preview}
              currency={offer.currency}
              takerTier={myTier}
              makerTier={makerTier}
            />
          </div>
        )}

        {!isOnchain && (
          <ContractAddressBox
            wallet={contractWallet}
            amount={stakeNum > 0 ? stakeNum : undefined}
            currency={offer.currency}
            onchainEscrow={onchainEscrow}
          />
        )}

        {signError && (
          <p className="text-red-400 text-xs mb-3 px-1">{signError}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={signing}
            className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={stakeNum <= 0 || stakeNum > maxStake + 0.0001 || signing}
            className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {signing ? (
              <><Loader2 size={14} className="animate-spin" /> Signing…</>
            ) : isOnchain ? (
              'Accept Bet'
            ) : (
              'Sign & Accept'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Accept Modal (Parlay) ────────────────────────────────────────────────────

export function ParlayAcceptModal({
  offer, onClose, onConfirm, contractWallet, myWallet, myTier, makerTier, onchainEscrow, packageId, configId,
}: {
  offer: ParlayOffer | null;
  onClose: () => void;
  onConfirm: (txHash: string) => void;
  contractWallet: string;
  myWallet?: string;
  myTier?: VolumeTier | null;
  makerTier?: VolumeTier | null;
  onchainEscrow?: boolean;
  packageId?: string;
  configId?: string;
}) {
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();

  if (!offer) return null;

  const isOnchain = !!(offer.onchainParlayId && packageId && configId);
  const takerFeeRate = myTier?.takerFee ?? 0.02;
  const makerRebateRate = makerTier?.makerRebate ?? 0;
  const preview = calcParlayPayoutPreview(offer, takerFeeRate, makerRebateRate);

  const handleAccept = async () => {
    setSignError('');
    if (!myWallet) { setSignError('Connect your wallet first to accept this parlay'); return; }
    if (new Date(offer.expiresAt).getTime() <= Date.now()) {
      setSignError('This parlay has expired and can no longer be accepted.');
      return;
    }
    setSigning(true);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);

      const coinTypeStr = offer.currency === 'SBETS' ? P2P_SBETS_COIN_TYPE
        : offer.currency === 'USDSUI' ? P2P_USDSUI_COIN_TYPE
        : offer.currency === 'USDC' ? P2P_USDC_COIN_TYPE
        : offer.currency === 'LBTC' ? P2P_LBTC_COIN_TYPE
        : P2P_SUI_COIN_TYPE;

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
        const decimals = (offer.currency === 'USDSUI' || offer.currency === 'USDC') ? 6 : offer.currency === 'LBTC' ? 8 : 9;
        amountBase = BigInt(Math.round(offer.takerStake * Math.pow(10, decimals)));
      }

      let paymentCoin: any;
      if (offer.currency === 'SUI') {
        [paymentCoin] = tx.splitCoins(tx.gas, [amountBase]);
      } else {
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType: coinTypeStr });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${offer.currency} found in your wallet. Please acquire ${offer.currency} first.`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amountBase]);
      }

      if (isOnchain) {
        tx.moveCall({
          target: `${packageId}::p2p_betting::accept_parlay`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(configId!),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-4">
      <div className="bg-[#111827] border border-purple-500/30 rounded-2xl p-5 w-full max-w-sm mx-4 my-auto">
        <h2 className="text-white font-black text-xl mb-1">Accept P2P Parlay</h2>
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
            <span className="text-green-400 font-bold">
              {offer.creatorStake} {offer.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Your stake</span>
            <span className="text-orange-400 font-bold">
              {offer.takerStake.toFixed(4)} {offer.currency}
            </span>
          </div>
        </div>

        {myTier && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-gray-500 text-xs">Your tier:</span>
            <TierBadge tier={myTier} />
            <span className="text-gray-500 text-xs">
              Fee: {(myTier.takerFee * 100).toFixed(2)}%
            </span>
          </div>
        )}

        <div className="mb-4">
          <div className="text-gray-500 text-xs mb-2 flex items-center gap-1">
            <Info size={11} /> Payout breakdown
          </div>
          <PayoutBreakdown
            {...preview}
            currency={offer.currency}
            takerTier={myTier}
            makerTier={makerTier}
          />
        </div>

        {!isOnchain && (
          <ContractAddressBox
            wallet={contractWallet}
            amount={offer.takerStake}
            currency={offer.currency}
            onchainEscrow={onchainEscrow}
          />
        )}

        {signError && (
          <p className="text-red-400 text-xs mb-3 px-1">{signError}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={signing}
            className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={signing}
            className="flex-1 bg-purple-500 hover:bg-purple-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {signing ? (
              <><Loader2 size={14} className="animate-spin" /> Signing…</>
            ) : isOnchain ? (
              'Accept Parlay'
            ) : (
              'Sign & Accept'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PnL Today Widget ─────────────────────────────────────────────────────────

type PnLData = {
  pnl: number;
  wins: number;
  losses: number;
  winRate: number | null;
  volumeToday: number;
  activeBets: number;
  lifetimePnl: number;
  lifeVolume: number;
  totalBets: number;
  wonBets: number;
  currentTier: { name: string; color: string; takerFee: number; makerRebate: number; minVolume: number };
  nextTier: { name: string; minVolume: number } | null;
  tierProgress: number;
};

function PnLWidget({ wallet }: { wallet: string }) {
  const [settled, setSettled] = useState<{ winner: boolean } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, refetch } = useQuery<PnLData>({
    queryKey: ['/api/p2p/pnl-today', wallet],
    queryFn: async () => {
      const r = await fetch(`/api/p2p/pnl-today?wallet=${wallet}`);
      if (!r.ok) throw new Error('Failed to fetch PnL');
      const json = await r.json();
      if (typeof json.pnl !== 'number') throw new Error('Invalid PnL response');
      return json;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Real-time: refetch instantly when one of our bets settles via WS push
  useWsOn((msg) => {
    if (msg.type !== 'p2p-updates') return;
    const d = msg.data;
    if (d?.action !== 'settled') return;
    const wallets: string[] = d?.data?.wallets ?? [];
    if (!wallets.map((w: string) => w.toLowerCase()).includes(wallet.toLowerCase())) return;
    // Our bet just settled — refetch immediately and trigger flash
    refetch();
    const isWinner =
      (d.data.winner === 'creator' && d.data.wallets?.[0]?.toLowerCase() === wallet.toLowerCase()) ||
      (d.data.winner === 'taker'   && d.data.wallets?.[1]?.toLowerCase() === wallet.toLowerCase());
    setSettled({ winner: isWinner });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSettled(null), 3000);
  });

  const pnlPositive = (data?.pnl ?? 0) >= 0;
  const hasActivity = (data?.totalBets ?? 0) > 0 || (data?.activeBets ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="mb-4 rounded-xl border border-cyan-900/20 bg-[#0a0e1a] px-4 py-3 animate-pulse">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-8 w-24 bg-gray-800 rounded-lg" />
          <div className="h-5 w-16 bg-gray-800 rounded" />
          <div className="h-5 w-16 bg-gray-800 rounded" />
          <div className="h-5 w-32 bg-gray-800 rounded-full ml-auto" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`mb-4 rounded-xl border bg-[#0a0e1a] overflow-hidden transition-all duration-500 ${
      settled
        ? settled.winner
          ? 'border-green-400/60 shadow-[0_0_16px_rgba(74,222,128,0.25)]'
          : 'border-red-400/50 shadow-[0_0_16px_rgba(248,113,113,0.2)]'
        : 'border-cyan-900/20'
    }`}>
      {/* Settlement flash banner */}
      {settled && (
        <div className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold animate-pulse ${
          settled.winner ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
        }`}>
          <span>{settled.winner ? '✅ Bet settled — you won!' : '❌ Bet settled — taker wins'}</span>
          <span className="ml-auto text-[10px] opacity-60">PnL updated</span>
        </div>
      )}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-cyan-900/15 bg-cyan-500/4">
        <BarChart2 size={11} className="text-cyan-500" />
        <span className="text-[10px] font-bold text-cyan-500/80 uppercase tracking-widest">Your PnL Today</span>
        {data.activeBets > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-orange-400 font-bold">
            <Activity size={9} />
            {data.activeBets} active
          </span>
        )}
      </div>

      <div className="px-4 py-3 flex items-center gap-4 flex-wrap">
        {/* PnL */}
        <div className="flex items-baseline gap-1.5 flex-shrink-0">
          <span
            className={`text-2xl font-black tabular-nums ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}
          >
            {pnlPositive ? '+' : ''}{(data.pnl ?? 0).toFixed(2)}
          </span>
          <span className="text-gray-500 text-xs">SUI</span>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-800 flex-shrink-0 hidden sm:block" />

        {/* W/L */}
        {(data.wins > 0 || data.losses > 0) ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-green-400 text-sm font-bold">{data.wins}W</span>
            <span className="text-gray-600 text-xs">/</span>
            <span className="text-red-400 text-sm font-bold">{data.losses}L</span>
            {data.winRate !== null && (
              <span className="text-gray-400 text-xs ml-1">({data.winRate}%)</span>
            )}
          </div>
        ) : (
          <span className="text-gray-600 text-xs italic">No settled bets today</span>
        )}

        {/* Divider */}
        <div className="w-px h-8 bg-gray-800 flex-shrink-0 hidden sm:block" />

        {/* Volume today */}
        <div className="flex-shrink-0">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider">Today vol</div>
          <div className="text-white text-xs font-bold">{(data.volumeToday ?? 0) > 0 ? `${(data.volumeToday ?? 0).toFixed(1)} SUI` : '—'}</div>
        </div>

        {/* Tier + progress — pushed to the right */}
        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="flex items-center gap-1.5 justify-end">
              <Trophy size={11} style={{ color: data.currentTier.color }} />
              <span className="text-xs font-black" style={{ color: data.currentTier.color }}>
                {data.currentTier.name}
              </span>
            </div>
            {data.nextTier ? (
              <div className="mt-1 w-28">
                <div className="flex justify-between text-[9px] text-gray-600 mb-0.5">
                  <span>{(data.lifeVolume ?? 0).toFixed(0)}</span>
                  <span>{data.nextTier.minVolume.toLocaleString()} SUI</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${data.tierProgress}%`,
                      background: `linear-gradient(90deg, ${data.currentTier.color}80, ${data.currentTier.color})`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-purple-400 font-bold mt-0.5">Max tier ✦</div>
            )}
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-gray-500 text-[10px] uppercase tracking-wider">Fee</div>
            <div className="text-xs font-bold text-white">{((data.currentTier?.takerFee ?? 0) * 100).toFixed(2)}%</div>
            {(data.currentTier?.makerRebate ?? 0) > 0 && (
              <div className="text-[10px] text-green-400">+{((data.currentTier?.makerRebate ?? 0) * 100).toFixed(2)}% rebate</div>
            )}
          </div>
        </div>
      </div>

      {/* Lifetime summary bar */}
      {hasActivity && (
        <div className="px-4 py-1.5 border-t border-cyan-900/10 flex items-center gap-4 bg-[#080b14]">
          <span className="text-[10px] text-gray-600">All-time:</span>
          <span className={`text-[10px] font-bold ${(data.lifetimePnl ?? 0) >= 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>
            {(data.lifetimePnl ?? 0) >= 0 ? '+' : ''}{(data.lifetimePnl ?? 0).toFixed(2)} SUI PnL
          </span>
          <span className="text-[10px] text-gray-600">{data.totalBets ?? 0} bets · {(data.lifeVolume ?? 0).toFixed(1)} SUI vol</span>
        </div>
      )}
    </div>
  );
}

// ─── Live Fill Notification Banner ────────────────────────────────────────────

type FillNotif = {
  id: string;
  kind: 'offer' | 'parlay';
  offerId?: number;
  parlayId?: number;
  takerWallet: string;
  takerTierName?: string;
  stake: number;
  currency: string;
  eventName?: string;
  legCount?: number;
  odds?: number;
  ts: number;
};

function FillNotifBanner({ notif, onDismiss }: { notif: FillNotif; onDismiss: () => void }) {
  const [progress, setProgress] = useState(100);
  const DURATION = 15000;

  useEffect(() => {
    const shrink = setTimeout(() => setProgress(0), 60);
    const auto   = setTimeout(onDismiss, DURATION);
    return () => { clearTimeout(shrink); clearTimeout(auto); };
  }, [onDismiss]);

  const short = (w: string) => w ? `${w.slice(0, 6)}…${w.slice(-4)}` : '';
  const suiscanWallet = `https://suiscan.xyz/mainnet/account/${notif.takerWallet}`;
  const shareLink     = notif.kind === 'offer'
    ? `/p2p/offer/${notif.offerId}`
    : `/p2p/parlay/${notif.parlayId}`;

  const tierColor: Record<string, string> = {
    Bronze:   'text-orange-400',
    Silver:   'text-gray-300',
    Gold:     'text-yellow-400',
    Platinum: 'text-cyan-300',
    Diamond:  'text-violet-300',
  };

  return (
    <div className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-cyan-500/30 bg-[#07101e] animate-in slide-in-from-right-8 duration-300">
      {/* Glow strip */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />

      <div className="px-4 pt-3 pb-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-base flex-shrink-0">
              ✓
            </span>
            <div>
              <div className="text-white font-black text-sm leading-tight">
                {notif.kind === 'offer' ? 'Your offer was filled!' : 'Your parlay was taken!'}
              </div>
              <div className="text-gray-500 text-[10px] leading-none mt-0.5">
                {notif.kind === 'offer'
                  ? `Offer #${notif.offerId}`
                  : `Parlay #${notif.parlayId} · ${notif.legCount ?? '?'} legs`}
              </div>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0 mt-0.5"
          >
            <X size={13} />
          </button>
        </div>

        {/* Event / leg info */}
        {notif.eventName && (
          <div className="text-cyan-400/80 text-xs font-semibold mb-2 truncate leading-tight">
            {notif.eventName}
          </div>
        )}

        {/* Data pills row */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1 bg-white/5 rounded-full px-2 py-0.5 text-[10px] text-gray-300 font-medium border border-white/10">
            <span className="text-orange-400 font-bold">{notif.stake.toFixed(4)}</span>
            <span className="text-gray-500">{notif.currency}</span>
            <span className="text-gray-600 ml-0.5">staked</span>
          </span>
          {notif.odds && (
            <span className="inline-flex items-center gap-1 bg-white/5 rounded-full px-2 py-0.5 text-[10px] text-gray-300 font-medium border border-white/10">
              <span className="text-purple-400 font-bold">{Number(notif.odds).toFixed(2)}x</span>
              <span className="text-gray-600">odds</span>
            </span>
          )}
          {notif.takerTierName && (
            <span className={`inline-flex items-center gap-1 bg-white/5 rounded-full px-2 py-0.5 text-[10px] font-bold border border-white/10 ${tierColor[notif.takerTierName] ?? 'text-gray-400'}`}>
              {notif.takerTierName}
            </span>
          )}
        </div>

        {/* Taker + links row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-600">Taker</span>
            <a
              href={suiscanWallet}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300 font-mono font-bold transition-colors flex items-center gap-0.5"
            >
              {short(notif.takerWallet)}
              <ExternalLink size={9} className="opacity-60" />
            </a>
          </div>
          <a
            href={shareLink}
            className="text-[10px] text-purple-400 hover:text-purple-300 font-bold transition-colors flex items-center gap-0.5"
          >
            View bet <ArrowRight size={9} />
          </a>
        </div>
      </div>

      {/* Countdown progress bar */}
      <div className="h-0.5 bg-white/5">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
          style={{ width: `${progress}%`, transition: `width ${DURATION}ms linear` }}
        />
      </div>
    </div>
  );
}

// ─── QuickPostBar ─────────────────────────────────────────────────────────────

type QPBEvent = { id: string | number; homeTeam: string; awayTeam: string; leagueName?: string; startTime: string };

function QuickPostBar({
  events, packageId, configId, registryId,
}: {
  events: QPBEvent[];
  packageId: string;
  configId: string;
  registryId: string;
}) {
  const [open, setOpen]                 = useState(false);
  const [query, setQuery]               = useState('');
  const [selectedEvent, setSelectedEvent] = useState<QPBEvent | null>(null);
  const [prediction, setPrediction]     = useState<'home' | 'draw' | 'away'>('home');
  const [oddsStr, setOddsStr]           = useState('2.00');
  const [stakeStr, setStakeStr]         = useState('');
  const [currency, setCurrency]         = useState<'SUI' | 'SBETS' | 'USDSUI' | 'USDC' | 'LBTC'>('SUI');
  const [posting, setPosting]           = useState(false);
  const [showDrop, setShowDrop]         = useState(false);
  const [expiryHours, setExpiryHours]   = useState(24);
  const searchRef                       = useRef<HTMLDivElement>(null);

  const account                                    = useCurrentAccount();
  const myWallet                                   = account?.address ?? '';
  const { mutateAsync: signAndExecute }            = useSignAndExecuteTransaction();
  const suiClient                                  = useSuiClient();
  const { toast }                                  = useToast();
  const qc                                         = useQueryClient();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const odds     = parseFloat(oddsStr) || 0;
  const stakeNum = parseFloat(stakeStr) || 0;
  const takerStake = stakeNum > 0 && odds > 1 ? Math.round(stakeNum * (odds - 1) * 10000) / 10000 : 0;
  const maxWin     = stakeNum > 0 && odds > 1 ? Math.round(stakeNum * odds * 0.98 * 10000) / 10000 : 0;

  const filteredEvents = events
    .filter(e => {
      if (!query) return true;
      const q = query.toLowerCase();
      return e.homeTeam.toLowerCase().includes(q) || e.awayTeam.toLowerCase().includes(q) || (e.leagueName ?? '').toLowerCase().includes(q);
    })
    .slice(0, 8);

  const reset = () => {
    setQuery(''); setSelectedEvent(null); setPrediction('home');
    setOddsStr('2.00'); setStakeStr(''); setCurrency('SUI'); setPosting(false); setShowDrop(false);
  };

  const enc      = new TextEncoder();
  const toBytes  = (s: string) => Array.from(enc.encode(s));
  const coinType = currency === 'SUI' ? P2P_SUI_COIN_TYPE
    : currency === 'SBETS' ? P2P_SBETS_COIN_TYPE
    : currency === 'USDC' ? P2P_USDC_COIN_TYPE
    : currency === 'LBTC' ? P2P_LBTC_COIN_TYPE
    : P2P_USDSUI_COIN_TYPE;

  const handlePost = async () => {
    if (!myWallet) { window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required')); return; }
    if (!selectedEvent) { toast({ title: 'Pick an event', variant: 'destructive' }); return; }
    if (odds < 1.01 || odds > 100) { toast({ title: 'Odds must be 1.01–100', variant: 'destructive' }); return; }
    if (stakeNum <= 0) { toast({ title: 'Enter your stake', variant: 'destructive' }); return; }
    if (!packageId || !configId || !registryId) {
      toast({ title: 'Contract IDs loading…', description: 'Wait a moment and try again.', variant: 'destructive' }); return;
    }

    setPosting(true);
    try {
      const tx = new Transaction();
      tx.setGasBudget(20_000_000);

      // USDC supports gasless — override gas settings
      if (currency === 'USDC') { tx.setGasPrice(0); tx.setGasBudget(0); }

      let paymentCoin: any;
      if (currency === 'SUI') {
        const amount = BigInt(Math.floor(stakeNum * 1_000_000_000));
        [paymentCoin] = tx.splitCoins(tx.gas, [amount]);
      } else {
        const decimals = (currency === 'USDSUI' || currency === 'USDC') ? 6 : currency === 'LBTC' ? 8 : 9;
        const amount   = BigInt(Math.floor(stakeNum * Math.pow(10, decimals)));
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${currency} coins found in your wallet.`);
        const totalBal = coins.reduce((sum: bigint, c: any) => sum + BigInt(c.balance), 0n);
        if (totalBal < amount) throw new Error(`Insufficient ${currency} balance. Need ${stakeNum} ${currency}.`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amount]);
      }

      const eventId      = String(selectedEvent.id);
      const eventName    = `${selectedEvent.homeTeam} vs ${selectedEvent.awayTeam}`;
      const oddsBps      = BigInt(Math.round(odds * 10_000));
      // expiryHours === 0 means "until kickoff" — expire exactly at match start
      const matchStartMs = selectedEvent.startTime ? new Date(selectedEvent.startTime).getTime() : Infinity;
      const expiresAtEpoch = expiryHours === 0
        ? (isFinite(matchStartMs) && matchStartMs > Date.now() ? matchStartMs : Date.now() + 72 * 3600 * 1000)
        : Date.now() + expiryHours * 3600 * 1000;
      // Cap at match kickoff — mirrors the server-side cap in routes-p2p.ts so the
      // on-chain expiresAt always matches what the DB stores (no mismatch).
      const effectiveExpiresAtEpoch = (isFinite(matchStartMs) && matchStartMs > 0 && matchStartMs < expiresAtEpoch)
        ? matchStartMs
        : expiresAtEpoch;
      const expiresMs    = BigInt(effectiveExpiresAtEpoch);

      tx.moveCall({
        target:        `${packageId}::p2p_betting::post_offer`,
        typeArguments: [coinType],
        arguments: [
          tx.object(configId),
          tx.object(registryId),
          paymentCoin,
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(eventId))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(eventName))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(prediction))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
          tx.pure.u64(oddsBps),
          tx.pure.u64(expiresMs),
          tx.object(P2P_CLOCK_ID),
        ],
      });

      toast({ title: 'Approve in wallet', description: `post_offer: ${stakeNum} ${currency} → contract escrow` });

      const result = await signAndExecute({ transaction: tx } as any);
      const digest: string = result?.digest || (result as any)?.Transaction?.digest || '';
      if (!digest) throw new Error('Wallet did not return a transaction digest.');

      let onchainOfferId = '';
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const txBlock = await (suiClient as any).getTransactionBlock({ digest, options: { showObjectChanges: true } });
          const created = (txBlock?.objectChanges ?? []).find((c: any) =>
            c.type === 'created' && c.objectType?.includes('::p2p_betting::P2POffer')
          );
          if (created?.objectId) { onchainOfferId = created.objectId; break; }
        } catch (err) { console.warn(`[QuickPost] TX parse attempt ${attempt}/5:`, err); }
        if (!onchainOfferId && attempt < 5) await new Promise(r => setTimeout(r, 2000));
      }

      const offerPayload = {
        creatorWallet:   myWallet,
        eventId, eventName,
        homeTeam:        selectedEvent.homeTeam,
        awayTeam:        selectedEvent.awayTeam,
        leagueName:      selectedEvent.leagueName ?? '',
        sportName:       (selectedEvent as any).sportName ?? '',
        prediction, odds,
        creatorStake:    stakeNum,
        currency,
        creatorTxHash:   digest,
        onchainOfferId,
        onchainConfigId: configId,
        expiresAt:       new Date(effectiveExpiresAtEpoch).toISOString(),
        savedAt:         new Date().toISOString(),
      };

      const res = await fetch('/api/p2p/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offerPayload),
      });
      const data = await res.json();
      if (!res.ok) {
        // API save failed after a successful on-chain TX — persist locally so the
        // user can recover it from the My Bets tab without losing the bet.
        try {
          const pending: any[] = JSON.parse(localStorage.getItem('pendingP2POffers') ?? '[]');
          if (!pending.some((p: any) => p.creatorTxHash === digest)) {
            pending.push(offerPayload);
            localStorage.setItem('pendingP2POffers', JSON.stringify(pending));
          }
        } catch { /* ignore storage errors */ }
        throw new Error(data.message || 'Failed to post offer — your bet is on-chain. Open "My Bets" tab to sync it.');
      }

      toast({
        title: '✅ Offer Posted On-Chain!',
        description: `Offer #${data.id} at ${odds.toFixed(2)}x · taker needs ${takerStake.toFixed(4)} ${currency}`,
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers'] });
      window.dispatchEvent(new CustomEvent('p2p-offer-created'));
      reset();
      setOpen(false);
    } catch (e: any) {
      const msg = e?.message ?? 'Unknown error';
      if (/cancel|reject|denied/i.test(msg)) {
        toast({ title: 'Cancelled', description: 'Transaction was cancelled in your wallet.', variant: 'destructive' });
      } else {
        toast({ title: 'Error posting offer', description: msg, variant: 'destructive' });
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-cyan-500/20 bg-[#06090f] overflow-hidden">

      {/* Collapsed header bar */}
      <button
        onClick={() => { if (open) { setOpen(false); reset(); } else setOpen(true); }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.025] transition-colors group"
      >
        <span className="text-base leading-none select-none">⚔️</span>
        <div className="flex-1 min-w-0">
          <span className="text-white font-bold text-sm">Post a Bet</span>
          <span className="text-gray-600 text-xs ml-2 hidden sm:inline">
            · pick an event, side &amp; odds without leaving this page
          </span>
        </div>
        {myWallet ? (
          <span className={`text-[11px] px-2.5 py-1 rounded-full border font-bold transition-colors ${
            open
              ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-400'
              : 'border-gray-700/50 text-gray-500 group-hover:border-cyan-500/30 group-hover:text-cyan-500/70'
          }`}>
            {open ? 'Close' : 'Quick post'}
          </span>
        ) : (
          <span className="text-[11px] text-yellow-500/60">Connect wallet</span>
        )}
        {open
          ? <ChevronUp size={14} className="text-cyan-400 flex-shrink-0" />
          : <ChevronDown size={14} className="text-gray-600 group-hover:text-gray-400 flex-shrink-0" />
        }
      </button>

      {/* Expanded form */}
      {open && (
        <div className="border-t border-[#1a2235] px-4 pb-4 pt-3 space-y-3">

          {/* Event search */}
          <div ref={searchRef} className="relative">
            <label className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 block">Event</label>
            {selectedEvent ? (
              <div className="flex items-center justify-between bg-[#0d1420] border border-cyan-500/30 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-white font-bold text-sm truncate">{selectedEvent.homeTeam} vs {selectedEvent.awayTeam}</div>
                  {selectedEvent.leagueName && <div className="text-gray-600 text-[10px]">{selectedEvent.leagueName}</div>}
                </div>
                <button onClick={() => { setSelectedEvent(null); setQuery(''); }} className="ml-2 text-gray-600 hover:text-red-400 transition-colors flex-shrink-0">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <input
                    type="text"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setShowDrop(true); }}
                    onFocus={() => setShowDrop(true)}
                    placeholder="Search teams or league…"
                    className="w-full bg-[#0d1420] border border-[#1e2a3a] focus:border-cyan-500/60 rounded-lg px-3 py-2 pr-8 text-white text-sm placeholder-gray-600 outline-none transition-colors"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none">
                    <Search size={13} />
                  </span>
                </div>
                {showDrop && filteredEvents.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-[#0d1420] border border-[#1e2a3a] rounded-xl overflow-hidden shadow-2xl max-h-52 overflow-y-auto">
                    {filteredEvents.map(e => (
                      <button
                        key={e.id}
                        onClick={() => { setSelectedEvent(e); setQuery(''); setShowDrop(false); }}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-cyan-500/10 transition-colors text-left border-b border-[#1a2235] last:border-0"
                      >
                        <div className="min-w-0">
                          <div className="text-white text-sm font-medium truncate">{e.homeTeam} vs {e.awayTeam}</div>
                          {e.leagueName && <div className="text-gray-600 text-[10px]">{e.leagueName}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showDrop && filteredEvents.length === 0 && query && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-[#0d1420] border border-[#1e2a3a] rounded-xl px-3 py-3 text-gray-600 text-xs text-center shadow-2xl">
                    No matches for &ldquo;{query}&rdquo;
                  </div>
                )}
                {showDrop && events.length === 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-[#0d1420] border border-[#1e2a3a] rounded-xl px-3 py-3 text-gray-600 text-xs text-center shadow-2xl">
                    No events loaded — select a sport above first.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Pick + Odds */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 block">Your Pick</label>
              <div className="grid grid-cols-3 gap-1">
                {(['home', 'draw', 'away'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPrediction(p)}
                    className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                      prediction === p
                        ? 'bg-cyan-500 text-black'
                        : 'bg-[#0d1420] border border-[#1e2a3a] text-gray-400 hover:text-white hover:border-cyan-500/40'
                    }`}
                  >
                    {selectedEvent
                      ? p === 'home' ? selectedEvent.homeTeam.split(' ').pop()!
                        : p === 'away' ? selectedEvent.awayTeam.split(' ').pop()!
                        : 'Draw'
                      : p === 'home' ? 'Home' : p === 'away' ? 'Away' : 'Draw'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 block">Odds (decimal)</label>
              <input
                type="number"
                value={oddsStr}
                onChange={e => setOddsStr(e.target.value)}
                min="1.01" max="100" step="0.05"
                className="w-full bg-[#0d1420] border border-[#1e2a3a] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-white text-sm outline-none tabular-nums transition-colors"
              />
            </div>
          </div>

          {/* Stake + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 block">Your Stake</label>
              <input
                type="number"
                value={stakeStr}
                onChange={e => setStakeStr(e.target.value)}
                min="0.001" step="0.1" placeholder="0.00"
                className="w-full bg-[#0d1420] border border-[#1e2a3a] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-white text-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 block">Currency</label>
              <div className="grid grid-cols-5 gap-1">
                {([
                  { key: 'SUI',    icon: '◎', activeClass: 'bg-cyan-500 text-black' },
                  { key: 'SBETS',  icon: '⚡', activeClass: 'bg-purple-500 text-white' },
                  { key: 'USDSUI', icon: '$',  activeClass: 'bg-teal-500 text-black' },
                  { key: 'USDC',   icon: '🟢', activeClass: 'bg-green-500 text-black' },
                  { key: 'LBTC',   icon: '₿',  activeClass: 'bg-orange-500 text-white' },
                ] as const).map(({ key, icon, activeClass }) => (
                  <button
                    key={key}
                    onClick={() => setCurrency(key)}
                    title={key}
                    className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                      currency === key
                        ? activeClass
                        : 'bg-[#0d1420] border border-[#1e2a3a] text-gray-400 hover:text-white hover:border-gray-600'
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Payout preview */}
          {stakeNum > 0 && odds > 1 && (
            <div className="flex items-center gap-3 bg-[#0a0d14] rounded-lg px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 text-gray-500">
                <span>Taker needs</span>
                <span className="text-orange-400 font-bold">{takerStake.toFixed(4)} {currency}</span>
              </div>
              <span className="text-gray-700">·</span>
              <div className="flex items-center gap-1.5 text-gray-500">
                <span>If you win</span>
                <span className="text-green-400 font-bold">≈{maxWin.toFixed(4)} {currency}</span>
              </div>
            </div>
          )}

          {/* Expiry Duration */}
          <div>
            <label className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 block">Offer valid for</label>
            <div className="flex gap-1 flex-wrap">
              {[6, 12, 24, 48, 72].map(h => (
                <button
                  key={h}
                  onClick={() => setExpiryHours(h)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                    expiryHours === h
                      ? 'bg-cyan-500 text-black'
                      : 'bg-[#0d1420] border border-[#1e2a3a] text-gray-400 hover:text-white hover:border-cyan-500/40'
                  }`}
                >
                  {h}h
                </button>
              ))}
              <button
                onClick={() => setExpiryHours(0)}
                title="Offer stays open until the match kicks off"
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap ${
                  expiryHours === 0
                    ? 'bg-green-500 text-black'
                    : 'bg-[#0d1420] border border-[#1e2a3a] text-gray-400 hover:text-white hover:border-green-500/40'
                }`}
              >
                ⚽ Kickoff
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setOpen(false); reset(); }}
              className="px-4 py-2.5 rounded-lg text-sm text-gray-400 bg-[#0d1420] border border-[#1e2a3a] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePost}
              disabled={posting || !selectedEvent || stakeNum <= 0 || odds < 1.01 || !myWallet}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-black text-sm bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white transition-all"
            >
              {posting
                ? <><Loader2 size={13} className="animate-spin" /> Posting…</>
                : <>⚔️ Post Offer</>
              }
            </button>
          </div>
          {!myWallet && (
            <p className="text-center text-[11px] text-yellow-400/60">Connect your wallet to post a bet</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main HomeOrderBook Component ─────────────────────────────────────────────

interface HomeOrderBookProps {
  selectedSport: number | null;
  sportName?: string;
  events?: Array<{
    id: string | number;
    homeTeam: string;
    awayTeam: string;
    leagueName?: string;
    startTime: string;
  }>;
}

export function HomeOrderBook({ selectedSport, sportName, events = [] }: HomeOrderBookProps) {
  const [tab, setTab] = useState<'offers' | 'parlays'>('offers');
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [currencyFilter, setCurrencyFilter] = useState<string | null>(null);
  const [acceptingOffer, setAcceptingOffer] = useState<Offer | null>(null);
  const [acceptingParlay, setAcceptingParlay] = useState<ParlayOffer | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'odds' | 'stake' | 'expiry'>('newest');

  // Live fill notifications
  const [fillNotifs, setFillNotifs] = useState<FillNotif[]>([]);
  const dismissNotif = useCallback((id: string) => {
    setFillNotifs(prev => prev.filter(n => n.id !== id));
  }, []);

  // Track recently-filled offer/parlay IDs for the live status badge (auto-clears after 30s)
  const [filledOfferIds, setFilledOfferIds] = useState<Set<number>>(new Set());
  const [filledParlayIds, setFilledParlayIds] = useState<Set<number>>(new Set());
  const filledTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Listen for event-card "show P2P offers for this match" clicks
  useEffect(() => {
    const handler = (e: Event) => {
      const { eventName } = (e as CustomEvent<{ eventName: string }>).detail;
      setEventFilter(eventName);
      setTab('offers');
      setTimeout(() => {
        document.getElementById('p2p-order-book')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    };
    window.addEventListener('set-p2p-event-filter', handler);
    return () => window.removeEventListener('set-p2p-event-filter', handler);
  }, []);

  const currentAccount = useCurrentAccount();
  const myWallet = currentAccount?.address;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();

  const { data: rawOffers = [], isLoading: offersLoading, refetch: refetchOffers } = useQuery<Offer[]>({
    queryKey: ['/api/p2p/offers', 'open'],
    queryFn: () => fetch('/api/p2p/offers?status=open').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    staleTime: 0,
    refetchInterval: 8000,
  });
  const offers: Offer[] = Array.isArray(rawOffers) ? rawOffers : [];

  const { data: rawParlays = [], isLoading: parlaysLoading, refetch: refetchParlays } = useQuery<ParlayOffer[]>({
    queryKey: ['/api/p2p/parlays', 'open'],
    queryFn: () => fetch('/api/p2p/parlays?status=open').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    staleTime: 0,
    refetchInterval: 8000,
  });
  const parlays: ParlayOffer[] = Array.isArray(rawParlays) ? rawParlays : [];

  // Instantly refresh when a new offer is posted (from BetSlip or P2P page)
  useEffect(() => {
    const handler = () => {
      refetchOffers();
      refetchParlays();
    };
    window.addEventListener('p2p-offer-created', handler);
    return () => window.removeEventListener('p2p-offer-created', handler);
  }, [refetchOffers, refetchParlays]);

  // WebSocket: light up "Your offer" badge when a taker fills one of your offers
  const myWalletRef = useRef(myWallet);
  myWalletRef.current = myWallet;

  const markFilled = useCallback((kind: 'offer' | 'parlay', id: number) => {
    const key = `${kind}:${id}`;
    if (filledTimers.current.has(key)) clearTimeout(filledTimers.current.get(key)!);

    if (kind === 'offer') {
      setFilledOfferIds(prev => new Set([...prev, id]));
    } else {
      setFilledParlayIds(prev => new Set([...prev, id]));
    }

    const t = setTimeout(() => {
      if (kind === 'offer') setFilledOfferIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      else setFilledParlayIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      filledTimers.current.delete(key);
    }, 30_000);
    filledTimers.current.set(key, t);
  }, []);

  useWsOn(useCallback((msg) => {
    if (msg.type !== 'p2p-updates') return;
    const { action, type: kind, data } = msg.data ?? {};
    if (!action) return;

    // New offer or parlay posted by anyone — refresh the book immediately
    if (action === 'created') {
      refetchOffers();
      refetchParlays();
      return;
    }

    // Offer cancelled or expired — remove it from the book
    if (action === 'cancelled') {
      refetchOffers();
      refetchParlays();
      return;
    }

    if (action !== 'accepted' || !data) return;
    const wallet = myWalletRef.current;

    // Refresh the book for everyone when an offer is accepted
    refetchOffers();
    refetchParlays();

    // Personal banner only for the creator
    if (!wallet || data.creatorWallet !== wallet) return;

    if (kind === 'offer' && data.offerId) {
      markFilled('offer', data.offerId);
      setFillNotifs(prev => [
        {
          id:            `offer-${data.offerId}-${Date.now()}`,
          kind:          'offer',
          offerId:       data.offerId,
          takerWallet:   data.takerWallet ?? '',
          takerTierName: data.takerTierName,
          stake:         Number(data.stake) || 0,
          currency:      data.currency ?? 'SUI',
          eventName:     data.eventName,
          odds:          data.odds,
          ts:            Date.now(),
        },
        ...prev,
      ].slice(0, 4));
    }
    if (kind === 'parlay' && data.parlayId) {
      markFilled('parlay', data.parlayId);
      setFillNotifs(prev => [
        {
          id:            `parlay-${data.parlayId}-${Date.now()}`,
          kind:          'parlay',
          parlayId:      data.parlayId,
          takerWallet:   data.takerWallet ?? '',
          takerTierName: data.takerTierName,
          stake:         Number(data.takerStake) || 0,
          currency:      data.currency ?? 'SUI',
          legCount:      data.legCount,
          odds:          data.totalOdds,
          ts:            Date.now(),
        },
        ...prev,
      ].slice(0, 4));
    }
  }, [markFilled, refetchOffers, refetchParlays, setFillNotifs]));

  // Real-time chain-event listener: auto-refresh order book when Sui emits P2P events
  useWsOn((msg) => {
    if (msg.type !== 'p2p-chain-event') return;
    const et: string = msg.data?.eventType ?? '';
    if (et === 'OfferPosted' || et === 'OfferFilled' || et === 'OfferCancelled' || et === 'OfferExpired') {
      refetchOffers();
      refetchParlays();
    }
  });

  const { data: contractData } = useQuery<{ wallet: string; onchainEscrow?: boolean }>({
    queryKey: ['/api/p2p/contract-wallet'],
    queryFn: () => fetch('/api/p2p/contract-wallet').then(r => r.json()),
    staleTime: Infinity,
  });
  const contractWallet = contractData?.wallet ?? '';
  const onchainEscrow = contractData?.onchainEscrow ?? false;

  const { data: onchainBookData } = useQuery<{ packageId?: string; configId?: string; registryId?: string }>({
    queryKey: ['/api/p2p/onchain-book'],
    queryFn: () => fetch('/api/p2p/onchain-book').then(r => r.json()),
    staleTime: Infinity,
  });
  const packageId  = onchainBookData?.packageId  ?? '';
  const configId   = onchainBookData?.configId   ?? '';
  const registryId = onchainBookData?.registryId ?? '';

  const { data: myVolumeData } = useQuery<VolumeStats>({
    queryKey: ['/api/p2p/volume', myWallet],
    queryFn: () => fetch(`/api/p2p/volume?wallet=${myWallet}`).then(r => r.json()),
    enabled: !!myWallet,
    staleTime: 30000,
  });
  const myTier = myVolumeData?.tier ?? null;

  const { data: offerCreatorVolume } = useQuery<VolumeStats>({
    queryKey: ['/api/p2p/volume', acceptingOffer?.creatorWallet],
    queryFn: () =>
      fetch(`/api/p2p/volume?wallet=${acceptingOffer!.creatorWallet}`).then(r => r.json()),
    enabled: !!acceptingOffer?.creatorWallet,
    staleTime: 30000,
  });

  const { data: parlayCreatorVolume } = useQuery<VolumeStats>({
    queryKey: ['/api/p2p/volume', acceptingParlay?.creatorWallet],
    queryFn: () =>
      fetch(`/api/p2p/volume?wallet=${acceptingParlay!.creatorWallet}`).then(r => r.json()),
    enabled: !!acceptingParlay?.creatorWallet,
    staleTime: 30000,
  });

  const acceptOfferMutation = useMutation({
    mutationFn: async ({
      offerId, stake, txHash,
    }: { offerId: number; stake: number; txHash: string }) => {
      const res = await fetch(`/api/p2p/offers/${offerId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: myWallet, stake, takerTxHash: txHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      const payout = data?.winnerPayout ?? data?.actualPayout;
      toast({
        title: '✅ Bet Accepted!',
        description: payout
          ? `Awaiting match result. If you win: ${Number(payout).toFixed(4)} ${acceptingOffer?.currency ?? ''}`
          : 'You are in the game. Awaiting match result.',
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
      setAcceptingOffer(null);
    },
    onError: (e: Error) =>
      toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const acceptParlayMutation = useMutation({
    mutationFn: async ({ parlayId, txHash }: { parlayId: number; txHash: string }) => {
      const res = await fetch(`/api/p2p/parlays/${parlayId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: myWallet, takerTxHash: txHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      const payout = data?.winnerPayout;
      toast({
        title: '✅ Parlay Accepted!',
        description: payout
          ? `Win if any leg fails. Your payout: ${Number(payout).toFixed(4)} ${acceptingParlay?.currency ?? ''}`
          : 'You win if any leg fails!',
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
      setAcceptingParlay(null);
    },
    onError: (e: Error) =>
      toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const cancelOfferMutation = useMutation({
    mutationFn: async ({ id: offerId, onchainOfferId, currency }: { id: number; onchainOfferId?: string; currency?: string }) => {
      let cancelTxHash: string | undefined;
      if (onchainOfferId && packageId && registryId) {
        if (!myWallet) throw new Error('Connect your wallet to cancel this offer');
        const tx = new Transaction();
        tx.setSender(myWallet);
        tx.setGasBudget(20_000_000);
        const coinTypeStr = currency === 'SBETS' ? P2P_SBETS_COIN_TYPE
          : currency === 'USDSUI' ? P2P_USDSUI_COIN_TYPE
          : P2P_SUI_COIN_TYPE;
        tx.moveCall({
          target: `${packageId}::p2p_betting::cancel_offer`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(onchainOfferId),
            tx.object(registryId),
            tx.object(P2P_CLOCK_ID),
          ],
        });
        const result = await signAndExecute({ transaction: tx } as any);
        cancelTxHash = (result as any)?.digest;
        if (!cancelTxHash) throw new Error('On-chain cancel failed — no transaction digest returned');
        const txCheck = await (suiClient as any).waitForTransaction({ digest: cancelTxHash, options: { showEffects: true } });
        if (txCheck?.effects?.status?.status !== 'success') {
          const errMsg = txCheck?.effects?.status?.error ?? 'Transaction failed on-chain';
          throw new Error(`Cancel failed on-chain: ${errMsg}`);
        }
      }
      const res = await fetch(`/api/p2p/offers/${offerId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorWallet: myWallet, cancelTxHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: 'Offer cancelled', description: vars.onchainOfferId ? 'Stake returned to your wallet.' : undefined });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers'] });
    },
    onError: (e: Error) =>
      toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' }),
  });

  const cancelParlayMutation = useMutation({
    mutationFn: async ({ id: parlayId, onchainParlayId, currency }: { id: number; onchainParlayId?: string; currency?: string }) => {
      if (parlayId == null || isNaN(Number(parlayId))) throw new Error(`Invalid parlay ID: ${parlayId}`);
      if (!myWallet) throw new Error('Connect your wallet to cancel this parlay');
      let cancelTxHash: string | undefined;
      if (onchainParlayId && packageId && registryId) {
        if (typeof signAndExecute !== 'function') throw new Error('Wallet not connected — please reconnect your Sui wallet and try again');
        const tx = new Transaction();
        tx.setSender(myWallet);
        tx.setGasBudget(20_000_000);
        const coinTypeStr = currency === 'SBETS' ? P2P_SBETS_COIN_TYPE
          : currency === 'USDSUI' ? P2P_USDSUI_COIN_TYPE
          : P2P_SUI_COIN_TYPE;
        tx.moveCall({
          target: `${packageId}::p2p_betting::cancel_parlay`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(onchainParlayId),
            tx.object(registryId),
            tx.object(P2P_CLOCK_ID),
          ],
        });
        const result = await signAndExecute({ transaction: tx } as any);
        cancelTxHash = (result as any)?.digest;
        if (!cancelTxHash) throw new Error('On-chain cancel failed — no transaction digest returned');
        const txCheck = await (suiClient as any).waitForTransaction({ digest: cancelTxHash, options: { showEffects: true } });
        if (txCheck?.effects?.status?.status !== 'success') {
          const errMsg = txCheck?.effects?.status?.error ?? 'Transaction failed on-chain';
          throw new Error(`Cancel failed on-chain: ${errMsg}`);
        }
      }
      const res = await fetch(`/api/p2p/parlays/${parlayId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorWallet: myWallet, cancelTxHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: 'Parlay cancelled', description: vars.onchainParlayId ? 'Stake returned to your wallet.' : 'Your parlay has been removed.' });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    },
    onError: (e: Error) =>
      toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' }),
  });

  // Build sport keywords — sport ID 1 is "Football" in the UI but stored as "Soccer" in DB
  const sportKeywords: string[] = selectedSport && sportName
    ? (() => {
        const base = sportName.toLowerCase().split(' ').filter(Boolean);
        // Handle Football ↔ Soccer synonym (sport ID 1)
        if (selectedSport === 1) return [...base, 'soccer', 'football'];
        return base;
      })()
    : [];

  const matchesSport = (name?: string | null) => {
    if (!sportKeywords.length || !name) return true;
    const lower = name.toLowerCase();
    return sportKeywords.some(k => lower.includes(k));
  };

  // Filter offers by selected sport — offers with no sportName always pass through
  const sportFilteredOffers = selectedSport && sportName
    ? offers.filter(o => !o.sportName || matchesSport(o.sportName))
    : offers;

  // Further filter by event if selected
  const filteredOffers = eventFilter
    ? sportFilteredOffers.filter(o =>
        o.eventName.toLowerCase().includes(eventFilter.toLowerCase()),
      )
    : sportFilteredOffers;

  // Filter parlays by sport — check leg sportName (not eventName), legs with no sportName pass through
  const sportFilteredParlays = selectedSport && sportName
    ? parlays.filter(p => {
        if (!p.legs || p.legs.length === 0) return true;
        return p.legs.some(l => matchesSport((l as any).sportName) || matchesSport((l as any).leagueName));
      })
    : parlays;

  const filteredParlays = eventFilter
    ? sportFilteredParlays.filter(p =>
        p.legs.some(l => l.eventName.toLowerCase().includes(eventFilter.toLowerCase())),
      )
    : sportFilteredParlays;

  // Sort helpers
  const sortOffers = (arr: Offer[]) => {
    const a = [...arr];
    if (sortBy === 'odds') return a.sort((x, y) => y.odds - x.odds);
    if (sortBy === 'stake') return a.sort((x, y) => y.creatorStake - x.creatorStake);
    if (sortBy === 'expiry') return a.sort((x, y) => new Date(x.expiresAt).getTime() - new Date(y.expiresAt).getTime());
    return a.sort((x, y) => y.id - x.id); // newest
  };
  const sortParlays = (arr: ParlayOffer[]) => {
    const a = [...arr];
    if (sortBy === 'odds') return a.sort((x, y) => y.totalOdds - x.totalOdds);
    if (sortBy === 'stake') return a.sort((x, y) => y.creatorStake - x.creatorStake);
    if (sortBy === 'expiry') return a.sort((x, y) => new Date(x.expiresAt).getTime() - new Date(y.expiresAt).getTime());
    return a.sort((x, y) => y.id - x.id);
  };

  const now = Date.now();
  const currencyFilteredOffers = currencyFilter
    ? filteredOffers.filter(o => o.currency === currencyFilter)
    : filteredOffers;
  const currencyFilteredParlays = currencyFilter
    ? filteredParlays.filter(p => p.currency === currencyFilter)
    : filteredParlays;
  const openOffers = sortOffers(currencyFilteredOffers.filter(o => {
    if (o.status !== 'open' && o.status !== 'partial') return false;
    if (new Date(o.expiresAt).getTime() <= now) return false;
    // Hide offers where the match has already kicked off — expiresAt may still be
    // in the future, but a started match cannot be bet on.
    if (o.matchDate && new Date(o.matchDate).getTime() <= now) return false;
    return true;
  }));
  const openParlayList = sortParlays(currencyFilteredParlays.filter(p => {
    if (p.status !== 'open' && p.status !== 'partial') return false;
    if (new Date(p.expiresAt).getTime() <= now) return false;
    // If any leg's match has started, hide the parlay
    if (p.legs?.some((leg: any) => leg.matchDate && new Date(leg.matchDate).getTime() <= now)) return false;
    return true;
  }));
  const openCount = openOffers.length;
  const openParlayCount = openParlayList.length;

  // Total Value Locked — always computed over ALL open offers/parlays across every
  // sport so the TVL tile reflects true platform-wide capital, not just the
  // currently-selected sport filter.
  const tvlByCurrency: Record<string, number> = {};
  for (const o of offers.filter(o => o.status === 'open' || o.status === 'partial')) {
    const c = o.currency || 'SUI';
    tvlByCurrency[c] = (tvlByCurrency[c] ?? 0) + o.creatorStake + o.takerStake;
  }
  for (const p of parlays.filter(p => p.status === 'open' || p.status === 'partial')) {
    const c = p.currency || 'SUI';
    tvlByCurrency[c] = (tvlByCurrency[c] ?? 0) + p.creatorStake + p.takerStake;
  }
  const fmtTvl = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000   ? `${(n / 1_000).toFixed(0)}K`
    : n.toFixed(0);
  const tvlEntries = (['SUI', 'SBETS', 'USDSUI', 'USDC'] as const)
    .map(c => ({ c, v: tvlByCurrency[c] ?? 0 }))
    .filter(x => x.v > 0);

  const handlePostOffer = () => {
    if (!myWallet) {
      window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
      return;
    }
    window.dispatchEvent(new CustomEvent('open-betslip'));
  };

  // Unique events that have offers for the quick filter pills
  const eventPills = Array.from(
    new Map(
      filteredOffers
        .filter(o => o.status === 'open' || o.status === 'partial')
        .map(o => [o.eventName, { name: o.eventName, count: 0 }]),
    ).values(),
  ).slice(0, 6);

  return (
    <>
      <div className="mt-8 mb-6" id="p2p-order-book">

        {/* ── Protocol Hero Banner ─────────────────────────────────────── */}
        <div className="relative rounded-2xl overflow-hidden border border-cyan-900/25 mb-6"
          style={{ background: 'linear-gradient(135deg,#05080f 0%,#080e1c 50%,#050b14 100%)' }}
        >
          {/* Dot-grid overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: 'radial-gradient(rgba(6,182,212,0.18) 1px,transparent 1px)',
            backgroundSize: '22px 22px',
            opacity: 0.35,
          }} />
          {/* Glow blobs */}
          <div className="absolute -top-6 left-1/3 w-56 h-32 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-6 right-1/4 w-56 h-32 rounded-full bg-purple-600/10 blur-3xl pointer-events-none" />

          <div className="relative px-5 pt-5 pb-4">
            {/* Top row: live pill + hub link */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live Protocol
                </span>
                <ChainEventFeed compact />
                <span className="h-3 w-px bg-white/10" />
                <a href="https://sui.io" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300 transition-colors">
                  <Database size={8} /> Sui Mainnet
                </a>
                <span className="h-3 w-px bg-white/10" />
                <span className="text-[10px] text-gray-600 font-medium">MoveVM · Object-centric · DAG Parallel Exec</span>
              </div>
              <a href="/p2p"
                className="inline-flex items-center gap-1 text-[10px] font-black px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:text-purple-300 hover:bg-purple-500/25 transition-all whitespace-nowrap">
                Full P2P Hub <ArrowRight size={9} />
              </a>
            </div>

            {/* Headline */}
            <h2
              className="text-2xl md:text-3xl font-black uppercase leading-none mb-0.5 tracking-tight"
              style={{
                background: 'linear-gradient(110deg,#06b6d4 0%,#a78bfa 45%,#06b6d4 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              P2P Sports Order Book
            </h2>
            <div className="text-white/40 font-black text-[11px] uppercase tracking-[0.2em] mb-3">
              Decentralized · Non-Custodial · Trustless Settlement · Zero House Edge
            </div>

            {/* Description */}
            <p className="text-gray-500 text-xs leading-relaxed mb-4 max-w-2xl">
              Peer-to-peer wagering protocol powered by{' '}
              <span className="text-cyan-500 font-semibold">Sui MoveVM</span>.
              Cryptographic smart-contract escrow, atomic on-chain settlement, and{' '}
              <span className="text-purple-400 font-semibold">Sui parallel execution</span>{' '}
              for multi-leg parlays — no intermediary, no oracle manipulation, no counterparty risk.
              Post offers at custom odds; takers fill the opposite side.{' '}
              <span className="text-white/60 font-semibold">You set the price. The chain enforces it.</span>
            </p>

            {/* Tech badges */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {[
                { label: 'Smart Contract Escrow', color: 'cyan' },
                { label: 'Parallel Execution', color: 'sky' },
                { label: 'Immutable Odds', color: 'purple' },
                { label: 'On-chain Settlement', color: 'green' },
                { label: 'Non-custodial', color: 'teal' },
                { label: 'Censorship Resistant', color: 'pink' },
                { label: 'Sub-second Finality', color: 'amber' },
                { label: 'ZK-compatible', color: 'violet' },
              ].map(b => {
                const c: Record<string, string> = {
                  cyan:   'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
                  sky:    'bg-sky-500/10 border-sky-500/30 text-sky-400',
                  purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
                  green:  'bg-green-500/10 border-green-500/30 text-green-400',
                  teal:   'bg-teal-500/10 border-teal-500/30 text-teal-400',
                  pink:   'bg-pink-500/10 border-pink-500/30 text-pink-400',
                  amber:  'bg-amber-500/10 border-amber-500/30 text-amber-400',
                  violet: 'bg-violet-500/10 border-violet-500/30 text-violet-400',
                };
                return (
                  <span key={b.label}
                    className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${c[b.color]}`}>
                    {b.label}
                  </span>
                );
              })}
            </div>

            {/* Protocol stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-white/5 pt-4">
              {[
                { value: String(openCount),           label: 'Open Offers',    color: 'text-cyan-400' },
                { value: String(openParlayCount),     label: 'Live Parlays',   color: 'text-purple-400' },
                {
                  value: tvlEntries.length === 0 ? '0' : '__TVL__',
                  label: 'TVL Locked',
                  color: 'text-green-400',
                },
                { value: '2%',                        label: 'Max Protocol Fee', color: 'text-orange-400' },
              ].map(s => (
                <div key={s.label} className="bg-white/[0.025] rounded-xl px-3 py-2 text-center border border-white/5">
                  {s.value === '__TVL__' ? (
                    <div className="flex flex-col items-center gap-0.5">
                      {tvlEntries.map(({ c, v }) => (
                        <div key={c} className="flex items-baseline gap-1 leading-none">
                          <span className="font-black text-lg tabular-nums text-green-400">{fmtTvl(v)}</span>
                          <span className="text-[9px] text-gray-500 font-bold">{c}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`font-black text-xl leading-none tabular-nums ${s.color}`}>{s.value}</div>
                  )}
                  <div className="text-gray-600 text-[10px] uppercase tracking-wider mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* ── end Protocol Hero Banner ─────────────────────────────────── */}

        {/* ── On-Chain Activity Feed ───────────────────────────────────── */}
        <div className="mb-5 rounded-xl border border-gray-800/60 bg-[#080c16] overflow-hidden" style={{ maxHeight: 260 }}>
          <ChainEventFeed maxItems={12} />
        </div>
        {/* ── end On-Chain Activity Feed ───────────────────────────────── */}

        {/* PnL Today Widget — visible only when wallet connected */}
        {myWallet ? (
          <PnLWidget wallet={myWallet} />
        ) : (
          <div className="mb-4 rounded-xl border border-cyan-900/15 bg-[#0a0e1a] px-4 py-3 flex items-center gap-3">
            <BarChart2 size={14} className="text-gray-700 flex-shrink-0" />
            <span className="text-gray-600 text-xs">Connect your wallet to see your PnL today, win rate &amp; tier progress.</span>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3 bg-[#0d1117] border border-cyan-900/20 rounded-xl px-4 py-2.5 flex-shrink-0">
            <div className="text-center">
              <CountUpNumber value={openCount} className="text-cyan-400 font-black text-xl leading-none tabular-nums" />
              <div className="text-gray-500 text-[10px] uppercase tracking-wider">Open Bets</div>
            </div>
            <div className="w-px h-8 bg-gray-700/50" />
            <div className="text-center">
              <CountUpNumber value={openParlayCount} className="text-purple-400 font-black text-xl leading-none tabular-nums" />
              <div className="text-gray-500 text-[10px] uppercase tracking-wider">Parlays</div>
            </div>
            <div className="w-px h-8 bg-gray-700/50" />
            <div className="text-center">
              {tvlEntries.length === 0 ? (
                <div className="text-green-400 font-black text-xl leading-none tabular-nums">0</div>
              ) : (
                <div className="flex flex-col items-center gap-0.5">
                  {tvlEntries.map(({ c, v }) => (
                    <div key={c} className="flex items-baseline gap-1 leading-none">
                      <span className="font-black text-base tabular-nums text-green-400">{fmtTvl(v)}</span>
                      <span className="text-[9px] text-gray-500 font-bold">{c}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-gray-500 text-[10px] uppercase tracking-wider">TVL</div>
            </div>
            <div className="w-px h-8 bg-gray-700/50" />
            <div className="text-center">
              <div className="text-orange-400 font-black text-xl leading-none">2%</div>
              <div className="text-gray-500 text-[10px] uppercase tracking-wider">Max Fee</div>
            </div>
          </div>

          {/* Coin labels */}
          <div className="flex items-center gap-1.5">
            {(['SUI', 'SBETS', 'USDSUI', 'USDC'] as const).map(sym => (
              <span
                key={sym}
                className={`text-[11px] font-bold px-2 py-1 rounded-full border ${
                  sym === 'SUI'
                    ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                    : sym === 'SBETS'
                    ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                    : sym === 'USDC'
                    ? 'bg-green-500/15 text-green-400 border-green-500/30'
                    : 'bg-teal-500/15 text-teal-400 border-teal-500/30'
                }`}
              >
                {sym === 'SUI' ? '◎' : sym === 'SBETS' ? '⚡' : '$'} {sym}
              </span>
            ))}
          </div>

          {/* Post Offer CTA */}
          <button
            onClick={handlePostOffer}
            className="btn-shimmer ml-auto flex-shrink-0 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-black text-xs px-4 py-2.5 rounded-xl transition-all whitespace-nowrap flex items-center gap-2"
          >
            <span>⚔️</span>
            Post P2P Offer
          </button>
        </div>

        {/* Quick-entry offer posting bar */}
        <QuickPostBar
          events={events}
          packageId={packageId}
          configId={configId}
          registryId={registryId}
        />

        {/* Event filter pills (if there are offers with known events) */}
        {eventPills.length > 1 && (
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setEventFilter(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                eventFilter === null
                  ? 'text-white border-cyan-500 bg-cyan-500/15'
                  : 'text-gray-500 border-gray-700/40 bg-[#0a0a0a]/60 hover:text-gray-300'
              }`}
            >
              All events
            </button>
            {eventPills.map(e => (
              <button
                key={e.name}
                onClick={() => setEventFilter(eventFilter === e.name ? null : e.name)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border truncate max-w-[200px] ${
                  eventFilter === e.name
                    ? 'text-white border-purple-500 bg-purple-500/15'
                    : 'text-gray-500 border-gray-700/40 bg-[#0a0a0a]/60 hover:text-gray-300'
                }`}
              >
                {e.name}
              </button>
            ))}
          </div>
        )}

        {/* Currency filter pills */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-gray-600 text-[10px] uppercase tracking-wider mr-1">Token</span>
          {([
            { key: null,      label: 'All',    activeColor: 'text-cyan-400',   activeBg: 'bg-cyan-500/20',   activeBorder: 'border-cyan-500/40' },
            { key: 'SUI',     label: 'SUI',    activeColor: 'text-cyan-400',   activeBg: 'bg-cyan-500/20',   activeBorder: 'border-cyan-500/40' },
            { key: 'SBETS',   label: 'SBETS',  activeColor: 'text-purple-400', activeBg: 'bg-purple-500/20', activeBorder: 'border-purple-500/40' },
            { key: 'USDSUI',  label: 'USDSui', activeColor: 'text-yellow-400', activeBg: 'bg-yellow-500/20', activeBorder: 'border-yellow-500/40' },
            { key: 'USDC',    label: 'USDC',   activeColor: 'text-green-400',  activeBg: 'bg-green-500/20',  activeBorder: 'border-green-500/40' },
            { key: 'LBTC',    label: 'LBTC',   activeColor: 'text-orange-400', activeBg: 'bg-orange-500/20', activeBorder: 'border-orange-500/40' },
          ] as const).map(({ key, label, activeColor, activeBg, activeBorder }) => (
            <button
              key={key ?? 'all'}
              onClick={() => setCurrencyFilter(key)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${
                currencyFilter === key
                  ? `${activeBg} ${activeColor} ${activeBorder}`
                  : 'text-gray-500 border-gray-700/40 bg-[#0a0a0a]/60 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tabs + Sort */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex gap-2">
            {([
              { key: 'offers' as const,  label: '⚔️ Offers',  count: openCount },
              { key: 'parlays' as const, label: '🎯 Parlays', count: openParlayCount },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  tab === t.key
                    ? 'bg-cyan-500 text-black'
                    : 'bg-[#111827] text-gray-400 hover:text-white hover:bg-[#1a2235]'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={`text-xs ${tab === t.key ? 'text-black/60' : 'text-gray-600'}`}>
                    ({t.count})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Sort control */}
          <div className="flex items-center gap-1.5 bg-[#0d1117] border border-[#1e2a3a] rounded-xl px-3 py-1.5">
            <SortAsc size={11} className="text-gray-600" />
            <span className="text-gray-600 text-[10px] uppercase tracking-wider mr-1">Sort</span>
            {([
              { key: 'newest' as const, label: 'Newest' },
              { key: 'odds' as const, label: 'Best Odds' },
              { key: 'stake' as const, label: 'Largest' },
              { key: 'expiry' as const, label: 'Expiring' },
            ]).map(s => (
              <button
                key={s.key}
                onClick={() => setSortBy(s.key)}
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold transition-all ${
                  sortBy === s.key
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Offers Tab */}
        {tab === 'offers' && (
          <div>
            {offersLoading ? (
              <div className="text-center py-10 text-gray-500 text-sm">Loading offers…</div>
            ) : openOffers.length === 0 ? (
              <div className="text-center py-10 bg-[#0d1117] rounded-xl border border-cyan-900/20">
                {(eventFilter || currencyFilter) ? (
                  <>
                    <div className="text-3xl mb-3">🔍</div>
                    <div className="text-gray-400 font-bold text-sm">No offers match this filter</div>
                    <div className="text-gray-600 text-xs mt-1 mb-4">
                      Try clearing the {[eventFilter && 'event', currencyFilter && 'token'].filter(Boolean).join(' or ')} filter
                    </div>
                    <button
                      onClick={() => { setEventFilter(null); setCurrencyFilter(null); }}
                      className="bg-[#1a2235] hover:bg-[#1e2a3a] text-cyan-400 font-bold text-xs px-5 py-2.5 rounded-xl transition-all border border-cyan-500/30"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-3">🤝</div>
                    <div className="text-gray-400 font-bold text-sm">No open offers yet</div>
                    <div className="text-gray-600 text-xs mt-1 mb-4">
                      Be the first — select a match above and post a P2P offer!
                    </div>
                    <button
                      onClick={handlePostOffer}
                      className="bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-black text-xs px-5 py-2.5 rounded-xl transition-all"
                    >
                      ⚔️ Post First Offer
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {openOffers.map(o => (
                  <OfferCard
                    key={o.id}
                    offer={o}
                    onAccept={setAcceptingOffer}
                    onCancel={cancelOfferMutation.mutate}
                    myWallet={myWallet}
                    justFilled={filledOfferIds.has(o.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Parlays Tab */}
        {tab === 'parlays' && (
          <div>
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={14} className="text-purple-400 flex-shrink-0" />
                <span className="text-purple-400 text-xs font-bold uppercase tracking-wider">
                  How P2P Parlays Work
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2">
                  <div className="text-green-400 font-bold mb-1">Creator wins if…</div>
                  <div className="text-gray-300">ALL legs hit. All-or-nothing.</div>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-2">
                  <div className="text-orange-400 font-bold mb-1">Taker wins if…</div>
                  <div className="text-gray-300">ANY leg fails. One miss wins the pot.</div>
                </div>
              </div>
              <div className="mt-2 text-gray-500 text-xs">
                <span className="text-cyan-400 font-medium">Payout:</span> grossPot = creatorStake +
                takerStake. Each leg settles independently via Sui parallel execution.
              </div>
            </div>

            {parlaysLoading ? (
              <div className="text-center py-10 text-gray-500 text-sm">Loading parlays…</div>
            ) : openParlayList.length === 0 ? (
              <div className="text-center py-10 bg-[#0d1117] rounded-xl border border-cyan-900/20">
                {(eventFilter || currencyFilter) ? (
                  <>
                    <div className="text-3xl mb-3">🔍</div>
                    <div className="text-gray-400 font-bold text-sm">No parlays match this filter</div>
                    <div className="text-gray-600 text-xs mt-1 mb-4">
                      Try clearing the {[eventFilter && 'event', currencyFilter && 'token'].filter(Boolean).join(' or ')} filter
                    </div>
                    <button
                      onClick={() => { setEventFilter(null); setCurrencyFilter(null); }}
                      className="bg-[#1a2235] hover:bg-[#1e2a3a] text-cyan-400 font-bold text-xs px-5 py-2.5 rounded-xl transition-all border border-cyan-500/30"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.25)' }}>
                      <Layers size={22} className="text-purple-400" />
                    </div>
                    <div className="text-gray-400 font-bold text-sm">No open parlay offers</div>
                    <div className="text-gray-600 text-xs mt-1 mb-4">
                      Add multiple matches to your bet slip and post a P2P parlay!
                    </div>
                    <button
                      onClick={handlePostOffer}
                      className="bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-black text-xs px-5 py-2.5 rounded-xl transition-all"
                    >
                      Post Parlay Offer
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {openParlayList.map(p => (
                  <ParlayCard
                    key={p.id}
                    offer={p}
                    onAccept={setAcceptingParlay}
                    onCancel={cancelParlayMutation.mutate}
                    myWallet={myWallet}
                    justFilled={filledParlayIds.has(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recently Settled — Proof-of-Fairness feed */}
        <SettledTape myWallet={myWallet} />

        {/* "More on P2P hub" footer link */}
        <div className="mt-5 flex items-center justify-center gap-3 text-xs text-gray-600">
          <TrendingUp size={12} />
          <span>Leaderboard, settling bets, and on-chain contract details available on the</span>
          <a href="/p2p" className="text-purple-400 hover:text-purple-300 font-bold transition-colors">
            full P2P hub →
          </a>
        </div>
      </div>

      {/* Modals */}
      <AcceptModal
        offer={acceptingOffer}
        onClose={() => setAcceptingOffer(null)}
        onConfirm={(stake, txHash) => {
          if (!acceptingOffer) return;
          acceptOfferMutation.mutate({ offerId: acceptingOffer.id, stake, txHash });
        }}
        myWallet={myWallet}
        contractWallet={contractWallet}
        myTier={myTier}
        makerTier={offerCreatorVolume?.tier ?? null}
        onchainEscrow={onchainEscrow}
        packageId={packageId}
        configId={configId}
        registryId={registryId}
      />
      <ParlayAcceptModal
        offer={acceptingParlay}
        onClose={() => setAcceptingParlay(null)}
        onConfirm={(txHash) => {
          if (!acceptingParlay) return;
          acceptParlayMutation.mutate({ parlayId: acceptingParlay.id, txHash });
        }}
        contractWallet={contractWallet}
        myWallet={myWallet}
        myTier={myTier}
        makerTier={parlayCreatorVolume?.tier ?? null}
        onchainEscrow={onchainEscrow}
        packageId={packageId}
        configId={configId}
      />

      {/* ── Live fill notification stack (bottom-right, fixed) ─────────────── */}
      {fillNotifs.length > 0 && (
        <div className="fixed bottom-6 right-4 z-[300] flex flex-col-reverse gap-2 w-[340px] max-w-[calc(100vw-2rem)] pointer-events-none">
          {fillNotifs.map(n => (
            <div key={n.id} className="pointer-events-auto">
              <FillNotifBanner notif={n} onDismiss={() => dismissNotif(n.id)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
