import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Search, Clock, TrendingUp, TrendingDown, Wallet, LogOut, RefreshCw, Menu, X, Star, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trash2, Info, MoreHorizontal, FileText, Activity, ArrowUpDown, ArrowRight, Target, Trophy, Brain, Zap, Users, BarChart3, Shield, Bell, Globe, DollarSign, CheckCircle, XCircle, MessageCircle, MinusCircle, Loader2, Copy, ExternalLink, Layers } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuiNSName from '@/components/SuiNSName';
import sportMarketsAdapter from "@/lib/sportMarketsAdapter";
import { useBetting } from "@/context/BettingContext";
import { useToast } from "@/hooks/use-toast";
import { useCurrentAccount, useDisconnectWallet, useSuiClientQuery } from '@/lib/dapp-kit-compat';
import { useZkLogin } from "@/context/ZkLoginContext";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import Footer from "@/components/layout/Footer";
import LiveBetFeed from "@/components/betting/LiveBetFeed";
import OddsHistoryChart from "@/components/betting/OddsHistoryChart";
import { PremiumBadge } from "@/components/ui/PremiumBadge";
import { useLiveEvents, useUpcomingEvents } from "@/hooks/useEvents";
import { LiveClockBadge } from "@/components/sports/LiveClockBadge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { Transaction } from '@mysten/sui/transactions';
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage, LANGUAGES, type Language } from "@/context/LanguageContext";
import { HomeOrderBook, ParlayAcceptModal } from "@/components/p2p/HomeOrderBook";
import type { ParlayOffer } from "@/components/p2p/HomeOrderBook";
import { P2PLiveTicker } from "@/components/p2p/P2PLiveTicker";
import { P2PFeaturedOffers } from "@/components/p2p/P2PFeaturedOffers";
import { P2POrderBook } from "@/components/p2p/P2POrderBook";
const suibetsHeroImage = "/images/hero-banner-original.png";

// ─── P2P Accept Modal: constants & helpers ────────────────────────────────────
const P2P_SUI_COIN_TYPE    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const P2P_SBETS_COIN_TYPE  = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const P2P_USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
const P2P_USDC_COIN_TYPE   = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const P2P_LBTC_COIN_TYPE   = '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC';
const P2P_CLOCK_ID         = '0x0000000000000000000000000000000000000000000000000000000000000006';
const P2P_FALLBACK_PACKAGE_ID  = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const P2P_FALLBACK_CONFIG_ID   = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const P2P_FALLBACK_REGISTRY_ID = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';

function p2pResolveCoinType(currency: string | undefined | null): string {
  switch ((currency ?? '').toUpperCase()) {
    case 'SBETS':  return P2P_SBETS_COIN_TYPE;
    case 'USDSUI': return P2P_USDSUI_COIN_TYPE;
    case 'USDC':   return P2P_USDC_COIN_TYPE;
    case 'LBTC':   return P2P_LBTC_COIN_TYPE;
    default:       return P2P_SUI_COIN_TYPE;
  }
}
function p2pGetDecimals(currency: string | undefined | null): number {
  const c = (currency ?? '').toUpperCase();
  if (c === 'USDSUI' || c === 'USDC') return 6;
  if (c === 'LBTC') return 8;
  return 9;
}
function p2pIsGasless(currency: string | undefined | null): boolean {
  return (currency ?? '').toUpperCase() === 'USDC';
}
const p2pR3 = (n: number) => Math.round(n * 1000) / 1000;
function p2pFmtN(n: number, dec = 3): string {
  const parts = n.toFixed(dec).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return parts.join('.');
}
function p2pPredLabel(pred: string, home: string, away: string): string {
  if (pred === 'home') return home;
  if (pred === 'away') return away;
  if (pred === 'draw') return 'Draw';
  if (pred === 'btts_yes') return 'BTTS Yes';
  if (pred === 'btts_no')  return 'BTTS No';
  if (pred === 'home_or_draw') return `${home} or Draw`;
  if (pred === 'away_or_draw') return `${away} or Draw`;
  const ou = pred.match(/^(over|under)_([\d.]+)$/);
  if (ou) return `${ou[1] === 'over' ? 'Over' : 'Under'} ${ou[2]}`;
  return pred;
}
function p2pOppPred(pred: string, home: string, away: string, hasDraw = true): string {
  if (pred === 'home') return hasDraw ? `${away} win or Draw` : `${away} win`;
  if (pred === 'away') return hasDraw ? `${home} win or Draw` : `${home} win`;
  if (pred === 'draw') return `${home} or ${away} win`;
  if (pred === 'btts_yes') return 'BTTS No';
  if (pred === 'btts_no')  return 'BTTS Yes';
  if (pred === 'home_or_draw') return `${away} win`;
  if (pred === 'away_or_draw') return `${home} win`;
  const ou = pred.match(/^(over|under)_([\d.]+)$/);
  if (ou) return `${ou[1] === 'over' ? 'Under' : 'Over'} ${ou[2]}`;
  return 'opposite';
}
// Detect if a P2P offer's sport can end in a draw (football/soccer yes; hockey/baseball/basketball/etc. no)
function p2pOfferHasDraw(offer: any): boolean {
  const text = [offer.sportName, offer.leagueName, offer.eventName, offer.homeTeam, offer.awayTeam]
    .filter(Boolean).join(' ').toLowerCase();
  const noDrawTerms = [
    // Volleyball / Formula 1 / Tennis / MMA / Esports
    'volleyball', 'formula', 'grand prix', 'motogp', 'nascar', 'tennis', 'mma', 'ufc',
    'boxing', 'esports', 'e-sports', 'gaming', 'dota', 'csgo', 'valorant',
    // Basketball
    'basketball', 'nba', 'wnba', 'euroleague',
    'connecticut sun', 'dallas wings', 'indiana fever', 'new york liberty',
    'phoenix mercury', 'seattle storm', 'washington mystics', 'atlanta dream',
    'chicago sky', 'las vegas aces', 'los angeles sparks', 'minnesota lynx',
    'lakers', 'celtics', 'bucks', 'nuggets', 'heat', 'warriors', 'clippers',
    'raptors', 'bulls', 'cavaliers', 'spurs', 'grizzlies', 'pacers', 'magic',
    'pistons', 'knicks', '76ers', 'nets', 'pelicans', 'timberwolves', 'kings', 'hawks',
    // MLB Baseball
    'baseball', 'mlb', 'astros', 'rays', 'brewers', 'marlins', 'guardians',
    'phillies', 'padres', 'dodgers', 'mariners', 'orioles', 'athletics', 'twins',
    'blue jays', 'white sox', 'red sox', 'yankees', 'mets', 'pirates', 'reds',
    'rockies', 'royals', 'angels', 'cubs', 'diamondbacks', 'braves', 'nationals',
    // NHL Hockey
    'hockey', 'nhl', 'khl', 'oilers', 'canadiens', 'maple leafs', 'kraken', 'canucks',
    'flames', 'senators', 'sabres', 'bruins', 'blackhawks', 'predators', 'avalanche',
    'hurricanes', 'lightning', 'islanders', 'penguins', 'flyers', 'capitals',
    'blue jackets', 'wild', 'coyotes', 'ducks', 'sharks', 'stars',
    // Cricket
    'cricket', 'knight riders', 't20', 'ipl', 'mlc',
  ];
  return !noDrawTerms.some(term => text.includes(term));
}
function p2pCalcPayout(takerStake: number, offer: any, takerFeeRate = 0.02) {
  if (!takerStake || takerStake <= 0) return null;
  const creatorEquiv = offer.creatorStake * (takerStake / offer.takerStake);
  const grossPot  = p2pR3(takerStake + creatorEquiv);
  const takerFee  = p2pR3(grossPot * takerFeeRate);
  const winnerPayout = p2pR3(grossPot - takerFee);
  return { grossPot, takerFee, winnerPayout };
}

function HomeAcceptModal({ offer, onClose, onConfirm, myWallet, contractWallet, packageId, configId, registryId, onchainEscrow }: {
  offer: any; onClose: () => void;
  onConfirm: (stake: number, txHash: string) => void;
  myWallet?: string; contractWallet: string;
  packageId?: string; configId?: string; registryId?: string;
  onchainEscrow?: boolean;
}) {
  const [stake, setStake] = useState('');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const [copied, setCopied] = useState(false);
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();

  const maxStake   = p2pR3((Number(offer.takerStake) || 0) - (Number(offer.filledStake) || 0));
  const stakeNum   = parseFloat(stake) || 0;
  const preview    = stakeNum > 0 ? p2pCalcPayout(stakeNum, offer) : null;
  const isOnchain  = !!offer.onchainOfferId;
  const effectivePkg = packageId  || P2P_FALLBACK_PACKAGE_ID;
  const effectiveCfg = configId   || P2P_FALLBACK_CONFIG_ID;
  const effectiveReg = registryId || P2P_FALLBACK_REGISTRY_ID;
  const cur = offer.currency || 'SUI';

  const handleAccept = async () => {
    if (stakeNum <= 0 || stakeNum > maxStake + 0.0001) return;
    setSignError('');
    if (!myWallet) { setSignError('Connect your wallet first to accept this bet'); return; }
    if (new Date(offer.expiresAt).getTime() <= Date.now()) {
      setSignError('This offer has expired and can no longer be accepted.'); return;
    }
    setSigning(true);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);
      const decimals    = p2pGetDecimals(cur);
      const amountBase  = BigInt(Math.round(stakeNum * Math.pow(10, decimals)));
      const coinTypeStr = p2pResolveCoinType(cur);
      if (p2pIsGasless(cur)) { tx.setGasPrice(0); tx.setGasBudget(0); }
      let paymentCoin: any;
      if (cur === 'SUI') {
        [paymentCoin] = tx.splitCoins(tx.gas, [amountBase]);
      } else {
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType: coinTypeStr });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${cur} found in your wallet.`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amountBase]);
      }
      if (isOnchain) {
        tx.moveCall({
          target: `${effectivePkg}::p2p_betting::accept_offer`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(effectiveCfg),
            tx.object(effectiveReg),
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

  const copyWallet = () => {
    navigator.clipboard.writeText(contractWallet).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/80 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div style={{ background: '#0e1117', border: '1px solid rgba(0,255,255,0.18)' }} className="rounded-2xl p-5 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-white font-black text-xl">Accept Bet</h2>
            <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors p-1"><X size={16} /></button>
          </div>
          <p className="text-gray-500 text-xs mb-4">Stakes locked on Sui blockchain</p>

          {isOnchain && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
              <Shield size={12} className="text-green-400 flex-shrink-0" />
              <span className="text-green-400 text-xs font-medium">On-chain escrow · wallet signs in one step</span>
            </div>
          )}

          <div className="rounded-xl p-3 mb-4 space-y-2 text-sm" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex justify-between">
              <span className="text-gray-400">Match</span>
              <span className="text-white font-medium text-right max-w-[60%] truncate">{offer.eventName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Creator picked</span>
              <span className="text-green-400 font-bold">{p2pPredLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">You back</span>
              <span className="text-orange-400 font-bold">{p2pOppPred(offer.prediction, offer.homeTeam, offer.awayTeam)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Max stake</span>
              <span className="text-cyan-400 font-bold">{p2pFmtN(maxStake, 4)} {cur}</span>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-gray-400 text-xs">Your Stake ({cur})</label>
              <button type="button" onClick={() => setStake(String(maxStake))}
                className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 px-2 py-0.5 rounded transition-colors">
                Max
              </button>
            </div>
            <input
              type="number" value={stake} onChange={e => setStake(e.target.value)}
              max={maxStake} step="0.01" placeholder={`0 – ${maxStake.toFixed(4)}`}
              className="w-full rounded-lg px-3 py-2 text-white outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }} onFocus={e => e.currentTarget.style.borderColor='rgba(0,255,255,0.4)'} onBlur={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'}
            />
          </div>

          {preview && (
            <div className="rounded-xl p-3 mb-4 space-y-2 text-sm" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex justify-between text-gray-400">
                <span>Gross pot</span>
                <span className="text-white font-medium">{p2pFmtN(preview.grossPot, 4)} {cur}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Platform fee (2%)</span>
                <span className="text-red-400">−{p2pFmtN(preview.takerFee, 4)} {cur}</span>
              </div>
              <div className="pt-2 flex justify-between font-bold" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-gray-300">You receive if you win</span>
                <span className="text-green-400 text-base">{p2pFmtN(preview.winnerPayout, 4)} {cur}</span>
              </div>
            </div>
          )}

          {!isOnchain && contractWallet && (
            <div className="border border-yellow-500/25 bg-yellow-400/10 rounded-xl p-3 mb-4">
              <p className="text-yellow-400 text-xs font-bold mb-1.5">🔐 Send your stake to the escrow wallet:</p>
              <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
                <span className="text-gray-200 text-xs font-mono flex-1 truncate">{contractWallet}</span>
                <button onClick={copyWallet} className="text-gray-400 hover:text-cyan-400 transition-colors" title="Copy">
                  <Copy size={13} />
                </button>
                <a href={`https://suiscan.xyz/mainnet/account/${contractWallet}`} target="_blank" rel="noopener noreferrer"
                  className="text-gray-400 hover:text-cyan-400 transition-colors"><ExternalLink size={13} /></a>
              </div>
              {copied && <p className="text-cyan-400 text-xs mt-1">Copied!</p>}
            </div>
          )}

          {signError && <p className="text-red-400 text-xs mb-3 px-1">{signError}</p>}

          <div className="flex gap-3">
            <button onClick={onClose} disabled={signing}
              className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={handleAccept}
              disabled={stakeNum <= 0 || stakeNum > maxStake + 0.0001 || signing}
              className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
              {signing ? <><Loader2 size={14} className="animate-spin" /> Signing…</> : isOnchain ? 'Accept Bet' : 'Sign & Accept'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FadeInSection({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function AnimatedCounter({ end, duration = 2000, suffix = "" }: { end: number; duration?: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);
  useEffect(() => {
    if (!started) return;
    let startTime: number;
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [started, end, duration]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// Favorites management using localStorage
const FAVORITES_KEY = 'suibets_favorites';

function getFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

const suibetsLogo = "/images/suibets-logo.png";
const suibetsHeroBg = "/images/hero-bg.png";

// Sport IDs match DB: 1=Soccer,2=Basketball,3=Tennis,4=AmericanFootball,5=Baseball,6=IceHockey,
// 7=MMA,8=Boxing,9=Esports,10=AFL,11=Formula1,12=Handball,13=NBA,14=NFL,15=Rugby,16=Volleyball,17=HorseRacing
const SPORTS_LIST = [
  { id: 1, name: "Football", icon: "⚽" },
  { id: 2, name: "Basketball", icon: "🏀" },
  { id: 6, name: "Hockey", icon: "🏒" },
  { id: 5, name: "Baseball", icon: "⚾" },
  { id: 16, name: "Volleyball", icon: "🏐" },
  { id: 12, name: "Handball", icon: "🤾" },
  { id: 15, name: "Rugby", icon: "🏉" },
  { id: 9, name: "Esports", icon: "🎮" },
  { id: 7, name: "MMA", icon: "🥊" },
  { id: 8, name: "Boxing", icon: "🥊" },
  { id: 11, name: "Formula 1", icon: "🏎️" },
  { id: 10, name: "AFL", icon: "🏉" },
  { id: 4, name: "American Football", icon: "🏈" },
  { id: 17, name: "Horse Racing", icon: "🏇" },
  { id: 18, name: "Cricket", icon: "🏏" },
];

interface Outcome {
  id: string;
  name: string;
  odds: number;
  probability?: number;
}

interface Market {
  id: string;
  name: string;
  outcomes: Outcome[];
}

interface Event {
  id: string | number;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueName?: string;
  league?: string;
  startTime: string;
  isLive: boolean;
  score?: string;
  homeScore?: number;
  awayScore?: number;
  minute?: string;
  status?: string;
  markets?: Market[];
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  sportId: number;
}

interface BetNotification {
  id: string;
  type: 'won' | 'lost' | 'draw';
  message: string;
  amount?: string;
  timestamp: number;
  read: boolean;
}

function useNotifications(walletAddress?: string) {
  const [notifications, setNotifications] = useState<BetNotification[]>(() => {
    try {
      const saved = localStorage.getItem('suibets-notifications');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [lastChecked, setLastChecked] = useState<number>(() => {
    return parseInt(localStorage.getItem('suibets-notif-last') || '0');
  });

  useEffect(() => {
    if (!walletAddress) return;
    const checkBets = async () => {
      try {
        const res = await fetch(`/api/bets?wallet=${walletAddress}&limit=20`);
        if (!res.ok) return;
        const data = await res.json();
        const bets = Array.isArray(data) ? data : data.bets || [];
        const newNotifs: BetNotification[] = [];
        for (const bet of bets) {
          const settledAt = new Date(bet.settledAt || bet.updatedAt || 0).getTime();
          if (settledAt <= lastChecked) continue;
          if (bet.status === 'won' || bet.status === 'lost' || bet.status === 'draw') {
            const exists = notifications.some(n => n.id === `bet-${bet.id}`);
            if (!exists) {
              const matchName = `${bet.homeTeam || bet.event_name || 'Bet'} vs ${bet.awayTeam || ''}`.trim().replace(/vs\s*$/, '');
              newNotifs.push({
                id: `bet-${bet.id}`,
                type: bet.status as 'won' | 'lost' | 'draw',
                message: bet.status === 'won'
                  ? `${matchName} - You won!`
                  : bet.status === 'draw'
                  ? `${matchName} - Match drawn, stake refunded`
                  : `${matchName} - Better luck next time`,
                amount: bet.status === 'won'
                  ? `+${(bet.potentialPayout || bet.potentialWin || 0).toFixed(2)} ${bet.currency || 'SBETS'}`
                  : bet.status === 'draw'
                  ? `${(bet.bet_amount || bet.stake || 0).toFixed(2)} ${bet.currency || 'SBETS'} refunded`
                  : undefined,
                timestamp: settledAt,
                read: false,
              });
            }
          }
        }
        if (newNotifs.length > 0) {
          setNotifications(prev => {
            const updated = [...newNotifs, ...prev].slice(0, 50);
            localStorage.setItem('suibets-notifications', JSON.stringify(updated));
            return updated;
          });
          setLastChecked(Date.now());
          localStorage.setItem('suibets-notif-last', Date.now().toString());
        }
      } catch {}
    };
    checkBets();
    const interval = setInterval(checkBets, 30000);
    return () => clearInterval(interval);
  }, [walletAddress, lastChecked]);

  const markAllRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      localStorage.setItem('suibets-notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    localStorage.setItem('suibets-notifications', '[]');
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, markAllRead, clearNotifications };
}

export default function CleanHome() {
  const [, setLocation] = useLocation();
  const [selectedSport, setSelectedSport] = useState<number | null>(1);
  const [activeTab, setActiveTab] = useState<"live" | "upcoming">("live");
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isBetSlipOpen, setIsBetSlipOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => getFavorites());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showOddsOnly, setShowOddsOnly] = useState(false);
  const [showTodayOnly, setShowTodayOnly] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBetToken, setSelectedBetToken] = useState<'all' | 'sbets' | 'sui' | 'usdsui'>('all');

  useEffect(() => {
    const getScrollY = () =>
      window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const onScroll = () => setShowScrollTop(getScrollY() > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true });
    const onOpenBetSlip = () => setIsBetSlipOpen(true);
    window.addEventListener('open-betslip', onOpenBetSlip);
    window.addEventListener('open-betslip-p2p', onOpenBetSlip);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll);
      window.removeEventListener('open-betslip', onOpenBetSlip);
      window.removeEventListener('open-betslip-p2p', onOpenBetSlip);
    };
  }, []);
  const matchesSectionRef = useRef<HTMLDivElement>(null);
  
  const { language, setLanguage, t } = useLanguage();
  
  // Betting context for bet slip
  const { selectedBets, removeBet, clearBets } = useBetting();
  
  // Toggle favorite team
  const toggleFavorite = (teamName: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(teamName)) {
        newFavorites.delete(teamName);
      } else {
        newFavorites.add(teamName);
      }
      saveFavorites(newFavorites);
      return newFavorites;
    });
  };

  const scrollToMatches = () => {
    matchesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleTabClick = (tab: "live" | "upcoming") => {
    setActiveTab(tab);
    setTimeout(() => scrollToMatches(), 100);
  };
  
  const currentAccount = useCurrentAccount();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { isZkLoginActive, zkLoginAddress, logout: zkLogout } = useZkLogin();
  const walletAddress = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);
  const isConnected = !!walletAddress;
  
  const { notifications, unreadCount, markAllRead, clearNotifications } = useNotifications(walletAddress || undefined);
  
  // Fetch on-chain wallet SUI balance
  const { data: onChainBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '' },
    { enabled: !!walletAddress }
  );
  
  // Fetch on-chain SBETS token balance
  const SBETS_COIN_TYPE = import.meta.env.VITE_SBETS_TOKEN_TYPE || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
  const { data: onChainSbetsBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '', coinType: SBETS_COIN_TYPE },
    { enabled: !!walletAddress }
  );

  const USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
  const { data: onChainUsdsuiBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '', coinType: USDSUI_COIN_TYPE },
    { enabled: !!walletAddress }
  );
  
  // Convert from MIST to SUI (1 SUI = 1,000,000,000 MIST)
  const walletSuiBalance = onChainBalance?.totalBalance 
    ? Number(onChainBalance.totalBalance) / 1_000_000_000 
    : 0;
  
  // SBETS token balance (assuming 9 decimals like SUI)
  const walletSbetsBalance = onChainSbetsBalance?.totalBalance 
    ? Number(onChainSbetsBalance.totalBalance) / 1_000_000_000 
    : 0;

  const walletUsdsuiBalance = onChainUsdsuiBalance?.totalBalance 
    ? Number(onChainUsdsuiBalance.totalBalance) / 1_000_000 
    : 0;
  

  // Fetch promotion status
  const { data: platformStats } = useQuery<{ betsSettled: number; totalBets: number; sbetsVolume: number; suiVolume: number }>({
    queryKey: ['/api/platform/stats'],
    staleTime: 5 * 60 * 1000,
  });

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${Math.round(vol / 1_000)}K`;
    return vol.toString();
  };

  const disconnect = () => {
    if (isZkLoginActive) {
      zkLogout();
    }
    disconnectWallet();
  };

  const { data: liveEvents = [], isLoading: liveLoading, refetch: refetchLive } = useLiveEvents(selectedSport);
  const { data: upcomingEvents = [], isLoading: upcomingLoading, refetch: refetchUpcoming } = useUpcomingEvents(selectedSport);

  const { data: sportEventCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ['events', 'counts'],
    queryFn: async () => {
      const response = await fetch('/api/events/counts', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch counts');
      return await response.json();
    },
    staleTime: 30000,
    gcTime: 120000,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const rawEvents = activeTab === "live" ? liveEvents : upcomingEvents;
  const isLoading = activeTab === "live" ? liveLoading : upcomingLoading;

  // P2P on-chain registry snapshot (refresh every 30s)
  const { data: p2pBook } = useQuery<{
    openOffers: number; openParlays: number;
    contractDeployed: boolean; supportedCoins: { symbol: string }[];
  }>({
    queryKey: ['/api/p2p/onchain-book'],
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Open offers for current sport (subset for inline badge)
  const { data: sportOffers, isLoading: offersLoading } = useQuery<any[]>({
    queryKey: ['/api/p2p/offers', 'all-open'],
    queryFn: () =>
      fetch('/api/p2p/offers?status=open')
        .then(r => r.json())
        .then((offers: any) => Array.isArray(offers) ? offers : []),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Open parlay offers for the Open market section
  const { data: openParlays = [] } = useQuery<any[]>({
    queryKey: ['/api/p2p/parlays', 'home-open'],
    queryFn: () =>
      fetch('/api/p2p/parlays?status=open')
        .then(r => r.json())
        .then((d: any) => {
          const arr: any[] = Array.isArray(d) ? d : [];
          return arr.filter((p: any) => p.status === 'open' && new Date(p.expiresAt).getTime() > Date.now());
        }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // World Cup offers: fantasy_h2h H2H challenges + regular match_winner bets on WC fixtures
  const { data: wcOffers } = useQuery<any[]>({
    queryKey: ['/api/p2p/offers', 'wc-all'],
    queryFn: () =>
      fetch('/api/p2p/offers?status=open&limit=100')
        .then(r => r.json())
        .then((d: any) => Array.isArray(d) ? d.filter((o: any) => {
          if (o.status !== 'open' && o.status !== 'partial') return false;
          const remaining = Math.max(0, (Number(o.takerStake) || 0) - (Number(o.filledStake) || 0));
          if (remaining <= 0) return false;
          if (o.marketType === 'fantasy_h2h') return true;
          const league = (o.leagueName || '').toLowerCase();
          const eventName = (o.eventName || '').toLowerCase();
          const eventId = String(o.eventId || '');
          // Detect via league/event name tags
          if (league.includes('world cup') || league.includes('fifa') || eventName.includes('world cup') || eventName.includes('wc2026')) return true;
          // Detect WC outright offers (event_id starts with wc2026_)
          if (eventId.startsWith('wc2026_')) return true;
          // Detect WC hub match offers: awayTeam is always "Opponent" placeholder
          if ((o.awayTeam === 'Opponent' || o.away_team === 'Opponent') && o.status === 'open') return true;
          return false;
        }) : []),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  
  // Filter events based on search query, favorites, and odds availability
  const events = useMemo(() => {
    let filtered = rawEvents;
    
    // Odds filter - only show matches with real bookmaker odds
    if (showOddsOnly) {
      filtered = filtered.filter((e: Event) => 
        e.homeOdds && e.awayOdds && e.homeOdds > 0 && e.awayOdds > 0
      );
    }

    // Today filter - only show matches starting today
    if (showTodayOnly) {
      const todayStr = new Date().toDateString();
      filtered = filtered.filter((e: Event) => {
        if (!e.startTime) return false;
        return new Date(e.startTime).toDateString() === todayStr;
      });
    }
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((e: Event) => 
        e.homeTeam.toLowerCase().includes(query) ||
        e.awayTeam.toLowerCase().includes(query) ||
        (e.leagueName || '').toLowerCase().includes(query)
      );
    }
    
    // Favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter((e: Event) => 
        favorites.has(e.homeTeam) || favorites.has(e.awayTeam)
      );
    }
    
    return filtered;
  }, [rawEvents, searchQuery, showFavoritesOnly, showOddsOnly, showTodayOnly, favorites]);

  const LIVE_SPORT_IDS = new Set([1, 2, 4, 5, 6, 7, 10, 12, 15, 16]);

  const handleSportClick = (sportId: number) => {
    setSelectedSport(sportId);
    if (!LIVE_SPORT_IDS.has(sportId)) {
      setActiveTab("upcoming");
    } else {
      setActiveTab("live");
    }
  };

  // Auto-fallback: if the selected sport is in LIVE_SPORT_IDS but has no live events
  // (and isn't still loading), switch to the upcoming tab so events are visible
  useEffect(() => {
    if (activeTab !== "live") return;
    if (liveLoading) return;
    if (liveEvents.length === 0 && upcomingEvents.length > 0) {
      setActiveTab("upcoming");
    }
  }, [liveEvents, upcomingEvents, liveLoading, activeTab]);

  const handleConnectWallet = () => {
    setIsWalletModalOpen(true);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  // ── P2P accept modal state ───────────────────────────────────────────
  const [acceptingOffer, setAcceptingOffer] = useState<any | null>(null);
  const [acceptingParlay, setAcceptingParlay] = useState<ParlayOffer | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: contractData } = useQuery<{ wallet: string; onchainEscrow?: boolean; packageId?: string; configId?: string; registryId?: string }>({
    queryKey: ['/api/p2p/contract-wallet'],
    queryFn: () => fetch('/api/p2p/contract-wallet').then(r => r.json()),
    staleTime: 60_000,
  });
  const contractWallet = contractData?.wallet ?? '';
  const onchainEscrow  = contractData?.onchainEscrow ?? false;
  const p2pPackageId   = contractData?.packageId  ?? '';
  const p2pConfigId    = contractData?.configId   ?? '';
  const p2pRegistryId  = contractData?.registryId ?? '';

  const acceptOfferMutation = useMutation({
    mutationFn: async ({ offerId, stake, txHash, currency }: { offerId: number; stake: number; txHash: string; currency?: string }) => {
      const res = await fetch(`/api/p2p/offers/${offerId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: walletAddress, stake, takerTxHash: txHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onMutate: async ({ offerId, stake }) => {
      await qc.cancelQueries({ queryKey: ['/api/p2p/offers', 'all-open'] });
      const prev = qc.getQueryData<any[]>(['/api/p2p/offers', 'all-open']);
      qc.setQueryData<any[]>(['/api/p2p/offers', 'all-open'], (old = []) =>
        old.map(o => {
          if (o.id !== offerId) return o;
          const newFilled = Math.min((o.filledStake ?? 0) + stake, o.takerStake);
          return { ...o, filledStake: newFilled, status: newFilled >= o.takerStake - 0.001 ? 'filled' : 'partial' };
        })
      );
      setAcceptingOffer(null);
      return { prev };
    },
    onSuccess: (data, vars) => {
      const payout = data?.winnerPayout ?? data?.actualPayout;
      const cur = vars?.currency ?? '';
      toast({
        title: '✅ Bet Accepted!',
        description: payout
          ? `Awaiting match result. If you win: ${Number(payout).toFixed(4)} ${cur}`
          : 'You are in the game. Awaiting match result.',
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all-open'] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'wc-all'] });
    },
    onError: (e: Error, vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['/api/p2p/offers', 'all-open'], ctx.prev);
      if (vars?.txHash && vars?.offerId) {
        try {
          const stored: any[] = JSON.parse(localStorage.getItem('pendingP2PMatches') ?? '[]');
          if (!stored.some((m: any) => m.takerTxHash === vars.txHash)) {
            stored.push({ offerId: vars.offerId, takerWallet: walletAddress, stake: vars.stake, takerTxHash: vars.txHash, savedAt: new Date().toISOString() });
            localStorage.setItem('pendingP2PMatches', JSON.stringify(stored));
          }
        } catch { /* ignore */ }
      }
      toast({ title: 'Error accepting bet', description: e.message, variant: 'destructive' });
    },
  });

  const acceptParlayMutation = useMutation({
    mutationFn: async ({ parlayId, txHash }: { parlayId: number; txHash: string }) => {
      const res = await fetch(`/api/p2p/parlays/${parlayId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: walletAddress, takerTxHash: txHash }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onMutate: async ({ parlayId }) => {
      await qc.cancelQueries({ queryKey: ['/api/p2p/parlays', 'home-open'] });
      const prev = qc.getQueryData<any[]>(['/api/p2p/parlays', 'home-open']);
      qc.setQueryData<any[]>(['/api/p2p/parlays', 'home-open'], (old = []) =>
        old.filter(p => p.id !== parlayId)
      );
      setAcceptingParlay(null);
      return { prev };
    },
    onSuccess: (data) => {
      const payout = data?.winnerPayout ?? data?.actualPayout;
      const cur = acceptingParlay?.currency ?? '';
      toast({
        title: '✅ Parlay Accepted!',
        description: payout
          ? `Win if any leg fails. Your payout: ${Number(payout).toFixed(4)} ${cur}`
          : 'You are in the game. Awaiting match results.',
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/parlays', 'home-open'] });
    },
    onError: (e: Error, vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['/api/p2p/parlays', 'home-open'], ctx.prev);
      toast({ title: 'Error accepting parlay', description: e.message, variant: 'destructive' });
    },
  });

  // ── New UI state ────────────────────────────────────────────────────
  const [offerSort, setOfferSort] = useState<'ending' | 'biggest' | 'payout' | 'newest'>('ending');
  const [marketSport, setMarketSport] = useState<string>('all');
  const [marketCurrency, setMarketCurrency] = useState<'all' | 'SUI' | 'SBETS' | 'USDSUI' | 'USDC' | 'LBTC'>('all');

  // Sport tab → keywords matched against ALL text fields (event name, sport name, teams)
  // NOTE: sport_name / league_name are often empty in DB — event_name is the primary signal
  const SPORT_KEYWORDS: Record<string, string[]> = {
    football: [
      'football', 'soccer', 'premier league', 'bundesliga', 'serie a', 'ligue 1', 'la liga',
      'champions league', 'europa league', 'mls', 'world cup', 'wc2026', 'fantasy wc',
      'nations league', 'euro ', 'copa america', 'concacaf', 'gold cup', 'conmebol',
      'africa cup', 'afcon', 'round of 32', 'round of 16', 'qualification',
      // Country names that appear in international football matchups
      'argentina', 'cape verde', 'belgium', 'senegal', 'brazil', 'japan', 'colombia',
      'ghana', 'england', 'congo', 'france', 'germany', 'paraguay', 'mexico', 'ecuador',
      'netherlands', 'morocco', 'portugal', 'croatia', 'spain', 'austria', 'bosnia',
      'panama', 'south africa', 'algeria', 'ivory coast', 'cameroon', 'nigeria',
      'mali', 'uruguay', 'chile', 'peru', 'costa rica', 'honduras', 'venezuela',
      'south korea', 'iran', 'iraq', 'saudi arabia', 'ukraine', 'poland', 'romania',
      'serbia', 'hungary', 'slovakia', 'czechia', 'scotland', 'ireland', 'wales',
      'turkey', 'greece', 'norway', 'russia', 'united states vs', 'usa vs',
    ],
    basketball: [
      'basketball', 'nba', 'wnba', 'euroleague', 'ncaa basketball',
      // WNBA team names (full phrases to avoid ambiguity)
      'connecticut sun', 'dallas wings', 'indiana fever', 'new york liberty',
      'phoenix mercury', 'seattle storm', 'washington mystics', 'atlanta dream',
      'chicago sky', 'las vegas aces', 'los angeles sparks', 'minnesota lynx',
      'golden state valkyries',
      // NBA keywords
      'lakers', 'celtics', 'warriors', 'heat', 'bucks', 'nuggets', 'clippers',
      'thunder', 'grizzlies', 'knicks', '76ers', 'sixers', 'nets', 'bulls',
      'cavaliers', 'pacers', 'magic', 'raptors', 'pistons', 'spurs', 'pelicans',
      'timberwolves', 'kings', 'hornets', 'hawks', 'mavs', 'mavericks',
    ],
    esports: ['esports', 'e-sports', 'gaming', 'dota', 'csgo', 'lol', 'valorant', 'overwatch', 'fortnite', 'pubg'],
    tennis:  ['tennis', 'atp', 'wta', 'grand slam', 'wimbledon', 'us open', 'roland', 'australian open'],
    hockey: [
      'hockey', 'nhl', 'khl', 'ice hockey',
      // NHL teams (distinctive mascot names)
      'oilers', 'canadiens', 'maple leafs', 'kraken', 'canucks', 'flames', 'senators',
      'sabres', 'bruins', 'blackhawks', 'predators', 'avalanche', 'hurricanes',
      'lightning', 'islanders', 'penguins', 'flyers', 'capitals', 'blue jackets',
      'wild', 'stars', 'coyotes', 'ducks', 'sharks',
    ],
    mma:     ['mma', 'ufc', 'boxing', 'bellator', 'combat sports', 'fight night', 'martial arts'],
    baseball: [
      'baseball', 'mlb', 'softball', 'npb',
      // MLB team names (unambiguous ones first)
      'diamondbacks', 'brewers', 'marlins', 'guardians', 'astros', 'rays', 'braves',
      'phillies', 'padres', 'dodgers', 'mariners', 'orioles', 'athletics', 'twins',
      'blue jays', 'white sox', 'red sox', 'yankees', 'mets', 'pirates', 'reds',
      'rockies', 'royals', 'angels', 'cubs', 'nationals',
    ],
    volleyball: ['volleyball', 'volley', 'vnl', 'fivb', 'beach volley'],
    'formula-1': ['formula 1', 'formula1', 'f1', 'formula-1', 'grand prix', 'pirelli', 'motogp', 'nascar'],
  };

  // sportId → sport tab key (used when the API sets a numeric sport ID)
  const SPORT_ID_MAP: Record<number, string> = {
    1: 'football', 2: 'basketball', 3: 'tennis',
    4: 'football',
    5: 'baseball', 6: 'hockey', 7: 'mma', 8: 'mma',
    9: 'esports', 11: 'esports',
    12: 'volleyball', 13: 'volleyball',
    14: 'formula-1', 15: 'formula-1',
  };

  const matchesSportFilter = (o: any, sport: string): boolean => {
    if (sport === 'all') return true;
    // sportId match is most reliable when available
    if (o.sportId && SPORT_ID_MAP[o.sportId]) {
      return SPORT_ID_MAP[o.sportId] === sport;
    }
    // Build a single text blob from every available field — sport_name / league_name
    // are often empty in DB so we must rely on event_name, homeTeam, awayTeam
    const text = [o.sportName, o.leagueName, o.eventName, o.homeTeam, o.awayTeam]
      .filter(Boolean).join(' ').toLowerCase();
    if (!text) return false; // no info → hide from specific tabs
    const kws = SPORT_KEYWORDS[sport] ?? [sport];
    return kws.some(kw => text.includes(kw));
  };

  const sortedOffers = useMemo(() => {
    const arr: any[] = Array.isArray(sportOffers)
      ? sportOffers.filter((o: any) => o.status === 'open' || o.status === 'partial')
      : [];
    const filtered = arr.filter(o => {
      if (!matchesSportFilter(o, marketSport)) return false;
      if (marketCurrency !== 'all') {
        const c = (o.currency || 'SUI').toUpperCase();
        if (c !== marketCurrency) return false;
      }
      return true;
    });
    const s = [...filtered];
    if (offerSort === 'ending') s.sort((a, b) => new Date(a.expiresAt || 0).getTime() - new Date(b.expiresAt || 0).getTime());
    if (offerSort === 'biggest') s.sort((a, b) => (Number(b.creatorStake) || 0) - (Number(a.creatorStake) || 0));
    if (offerSort === 'payout') s.sort((a, b) => (Number(b.takerStake) || 0) - (Number(a.takerStake) || 0));
    if (offerSort === 'newest') s.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return s;
  }, [sportOffers, offerSort, marketSport, marketCurrency]);

  const featuredOffers = useMemo(() => {
    const arr: any[] = Array.isArray(sportOffers)
      ? sportOffers.filter((o: any) => o.status === 'open' || o.status === 'partial')
      : [];
    const s = [...arr];
    if (offerSort === 'ending') s.sort((a, b) => new Date(a.expiresAt || 0).getTime() - new Date(b.expiresAt || 0).getTime());
    if (offerSort === 'biggest') s.sort((a, b) => (Number(b.creatorStake) || 0) - (Number(a.creatorStake) || 0));
    if (offerSort === 'payout') s.sort((a, b) => (Number(b.takerStake) || 0) - (Number(a.takerStake) || 0));
    if (offerSort === 'newest') s.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return s.slice(0, 5);
  }, [sportOffers, offerSort]);

  const fmtAmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    if (n === 0) return '0';
    if (n < 1) return parseFloat(n.toFixed(4)).toString();
    return parseFloat(n.toFixed(2)).toString();
  };

  const sportEmoji: Record<string, string> = {
    football: '⚽', soccer: '⚽', basketball: '🏀', esports: '🎮',
    tennis: '🎾', hockey: '🏒', mma: '🥊', boxing: '🥊',
    baseball: '⚾', rugby: '🏉', volleyball: '🏐', handball: '🤾',
    formula: '🏎️', afl: '🏉', cricket: '🏏',
  };

  return (
    <div className="min-h-screen bg-[#080a0f] text-white" style={{ overflowX: 'clip' }} data-testid="clean-home">
      {/* Top Navigation Bar */}

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 z-50 bg-[#080a0f]/95 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <Link href="/" data-testid="nav-logo">
            <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-8 w-auto" />
          </Link>
          <Link href="/p2p" className="hidden md:flex items-center gap-1.5 text-sm font-bold text-cyan-400 hover:text-cyan-300 transition-colors px-3 py-1.5 rounded-xl" style={{ background: 'rgba(0,255,255,0.07)', border: '1px solid rgba(0,255,255,0.15)' }}>
            ⚔️ P2P Markets
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && walletAddress && (
            <div className="relative">
              <button
                onClick={() => { setIsNotificationsOpen(!isNotificationsOpen); if (!isNotificationsOpen) markAllRead(); }}
                className="p-2 text-gray-500 hover:text-white transition-colors relative"
                aria-label="Notifications"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {isNotificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 max-h-80 overflow-y-auto rounded-2xl shadow-2xl z-[9999]"
                  style={{ background: '#0e1117', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="p-3 border-b border-white/5 flex items-center justify-between">
                    <span className="text-white text-sm font-bold">Notifications</span>
                    {notifications.length > 0 && (
                      <button onClick={clearNotifications} className="text-gray-600 hover:text-red-400 text-xs">Clear</button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-gray-600 text-sm">Nothing yet</div>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {notifications.slice(0, 15).map(notif => (
                        <div key={notif.id} className={`p-3 flex items-start gap-3 ${!notif.read ? 'bg-white/[0.02]' : ''}`}>
                          {notif.type === 'won' ? <CheckCircle size={16} className="text-green-400 flex-shrink-0 mt-0.5" /> : notif.type === 'draw' ? <MinusCircle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" /> : <XCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold ${notif.type === 'won' ? 'text-green-400' : notif.type === 'draw' ? 'text-yellow-400' : 'text-red-400'}`}>{notif.type === 'won' ? 'Won!' : notif.type === 'draw' ? 'Draw' : 'Lost'}</p>
                            <p className="text-gray-500 text-xs truncate">{notif.message}</p>
                            {notif.amount && <p className="text-xs font-semibold mt-0.5 text-cyan-400">{notif.amount}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {isConnected && walletAddress ? (
            <>
              <div className="hidden md:block text-right">
                <div className="text-xs text-cyan-400">{walletSuiBalance.toFixed(2)} SUI · {walletSbetsBalance.toFixed(0)} SBETS</div>
                <div className="text-[10px] text-gray-600"><SuiNSName address={walletAddress} className="text-gray-600 text-[10px]" /></div>
              </div>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 text-gray-500 hover:text-white font-medium px-3 py-2 rounded-xl text-sm transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
                data-testid="btn-disconnect"
              >
                <LogOut size={13} />
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleConnectWallet}
              className="flex items-center gap-2 font-bold px-4 py-2 rounded-xl text-sm transition-all hover:opacity-90"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
              data-testid="btn-connect-wallet"
            >
              <Wallet size={14} />
              Connect wallet
            </button>
          )}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-xl transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
            data-testid="btn-mobile-menu"
          >
            {isMobileMenuOpen ? <X size={18} className="text-white" /> : <Menu size={18} className="text-gray-400" />}
          </button>
        </div>
      </nav>

      {/* ── Side drawer overlay ───────────────────────────────── */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-[100] flex"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          {/* Dim backdrop */}
          <div className="flex-1 bg-black/60 backdrop-blur-sm" />

          {/* Drawer panel */}
          <div
            className="w-72 flex flex-col h-full overflow-y-auto"
            style={{ background: '#0c0e15', borderLeft: '1px solid rgba(255,255,255,0.07)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <Link href="/" onClick={() => setIsMobileMenuOpen(false)}>
                <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-7 w-auto" />
              </Link>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <X size={15} className="text-gray-400" />
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 px-3 py-4">
              <div className="space-y-1">
                {[
                  { href: '/', label: 'Home', icon: '🏠' },
                  { href: '/wallet-dashboard', label: 'Dashboard', icon: '⊟' },
                  { href: '/tokenomics', label: 'Revenue', icon: '◈' },
                  { href: '/whitepaper', label: 'Whitepaper', icon: '◎' },
                  { href: '/faq', label: 'FAQ', icon: '?' },
                ].map(({ href, label, icon }) => {
                  const isActive = typeof window !== 'undefined' && window.location.pathname === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all"
                      style={{
                        background: isActive ? 'rgba(0,255,255,0.08)' : 'transparent',
                        color: isActive ? '#00ffff' : '#9ca3af',
                        border: isActive ? '1px solid rgba(0,255,255,0.15)' : '1px solid transparent',
                      }}
                    >
                      <span className="w-5 text-center text-base opacity-70">{icon}</span>
                      {label}
                    </Link>
                  );
                })}
              </div>

              {/* Divider */}
              <div className="my-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }} />

              {/* More links */}
              <div className="space-y-1">
                {[
                  { href: '/leaderboard', label: 'Leaderboard', icon: '🥇' },
                  { href: '/results', label: 'Results', icon: '📊' },
                  { href: '/chat', label: 'Chat', icon: '💬' },
                ].map(({ href, label, icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm transition-all"
                    style={{ color: '#6b7280' }}
                    onMouseEnter={(e: any) => { e.currentTarget.style.color = '#d1d5db'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e: any) => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.background = ''; }}
                  >
                    <span className="w-5 text-center text-sm">{icon}</span>
                    {label}
                  </Link>
                ))}
              </div>

              {/* Buy SBETS */}
              <div className="mt-4 px-1">
                <a
                  href="https://app.cetus.zone/swap/0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS/0x2::sui::SUI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-black transition-all"
                  style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.15)', color: '#00ffff' }}
                >
                  Buy SBETS
                </a>
              </div>
            </nav>

            {/* Disclaimer box */}
            <div className="px-4 pb-4">
              <div className="rounded-2xl p-4 mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-black px-2 py-0.5 rounded-full border" style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#6b7280' }}>18+</span>
                  <span className="text-xs font-bold" style={{ color: '#9ca3af' }}>Play responsibly</span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: '#4b5563' }}>
                  Betting carries financial risk and outcomes are uncertain — only stake what you can afford to lose. SUI &amp; SBETS are volatile. Restricted where prohibited; check your local laws.
                </p>
                <a href="/whitepaper" onClick={() => setIsMobileMenuOpen(false)}
                  className="inline-block mt-2 text-[11px] font-bold transition-colors"
                  style={{ color: '#00ffff' }}>
                  Read the FAQ &amp; disclaimers →
                </a>
              </div>

              <p className="text-[10px] leading-relaxed text-center" style={{ color: '#374151' }}>
                P2P betting exchange on Sui.<br />
                SUI · SBETS · zkLogin · Passkey · Walrus · DeepBook · WARP · FLUX · PULSE
              </p>
            </div>
          </div>
        </div>
      )}

      {/* P2P Live Ticker */}
      <P2PLiveTicker />


      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="pt-10 pb-6">
        <div className="px-5" style={{ maxWidth: 680 }}>
          <div className="flex items-center gap-2 text-[11px] font-black tracking-[0.18em] uppercase mb-4" style={{ color: '#00ffff' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#00ffff' }} />
            Live · Open Market
          </div>
          <h1 className="font-black leading-[1.05] mb-2" style={{ fontSize: 'clamp(2.6rem,8vw,4rem)' }}>
            Back your{' '}
            <em className="not-italic" style={{ color: '#00ffff', fontStyle: 'italic' }}>hunch.</em>
          </h1>
          <div className="mb-5 mt-1 w-20 h-[3px] rounded-full" style={{ background: 'linear-gradient(90deg,#00ffff,transparent)' }} />

          {/* Platform stats strip */}
          {(() => {
            const s = (platformStats as any) ?? {};
            const currencies: { key: string; label: string; color: string; decimals: number; fmt?: (v: number) => string }[] = [
              { key: 'suiVolume',    label: 'SUI',    color: '#38bdf8', decimals: 2 },
              { key: 'sbetsVolume',  label: 'SBETS',  color: '#a78bfa', decimals: 0, fmt: (v) => formatVolume(v) },
              { key: 'usdsuiVolume', label: 'USDSui', color: '#34d399', decimals: 2 },
              { key: 'usdcVolume',   label: 'USDC',   color: '#60a5fa', decimals: 2 },
              { key: 'lbtcVolume',   label: 'LBTC',   color: '#f59e0b', decimals: 6 },
            ];
            const betsSettled = s.betsSettled ?? 0;
            const totalBets = s.totalBets ?? 0;
            return (
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
                    <span className="text-[11px] font-black tracking-wide" style={{ color: '#00ffff' }}>
                      <AnimatedCounter end={betsSettled} />
                    </span>
                    <span className="text-[11px]" style={{ color: '#4b5563' }}>on-chain settled</span>
                  </div>
                  <span style={{ color: 'rgba(255,255,255,0.08)' }}>·</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-black tracking-wide" style={{ color: '#00ffff' }}>
                      <AnimatedCounter end={totalBets} />
                    </span>
                    <span className="text-[11px]" style={{ color: '#4b5563' }}>total bets</span>
                  </div>
                  {currencies.map(({ key, label, color, decimals, fmt }) => {
                    const val: number = s[key] ?? 0;
                    if (val <= 0) return null;
                    const display = fmt ? fmt(val) : val.toFixed(decimals);
                    return (
                      <span key={key} className="flex items-center gap-1.5">
                        <span style={{ color: 'rgba(255,255,255,0.08)' }}>·</span>
                        <span className="text-[11px] font-black tracking-wide" style={{ color }}>{display} {label}</span>
                      </span>
                    );
                  })}
                </div>
                {/* Supported currencies strip — always visible */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: '#374151' }}>Bet with</span>
                  {[
                    { label: 'SUI',    color: '#38bdf8', icon: '𝕊' },
                    { label: 'SBETS',  color: '#a78bfa', icon: '⚡' },
                    { label: 'USDSui', color: '#34d399', icon: '$' },
                    { label: 'USDC',   color: '#60a5fa', icon: '$' },
                    { label: 'LBTC',   color: '#f59e0b', icon: '₿' },
                  ].map(c => (
                    <span key={c.label} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: c.color + '15', border: `1px solid ${c.color}30`, color: c.color }}>
                      {c.label}
                    </span>
                  ))}
                  <span className="text-[10px]" style={{ color: '#374151' }}>· LBTC &amp; USDC via DeFi</span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Featured offers section header ─── */}
        <div className="flex items-center justify-between px-5 mb-3 mt-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#4b5563' }}>Live P2P Challenges</span>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && walletAddress && (
              <button
                onClick={() => setLocation('/p2p?tab=my')}
                className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all"
                style={{ background: 'rgba(0,255,255,0.06)', border: '1px solid rgba(0,255,255,0.15)', color: '#00ffff' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,255,0.12)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,255,0.06)'; }}>
                🎴 My NFT Bets
              </button>
            )}
            <button
              onClick={() => setLocation('/p2p')}
              className="flex items-center gap-1 text-[11px] font-bold transition-colors"
              style={{ color: '#4b5563' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#9ca3af')}
              onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}>
              View all <ArrowRight size={11} />
            </button>
          </div>
        </div>

        {/* ── Featured offer cards ─── */}
        {offersLoading ? (
          <div className="flex gap-4 pb-3 -mx-5 px-5">
            {[1,2,3].map(i => (
              <div key={i} className="flex-shrink-0 rounded-2xl animate-pulse" style={{ width: 310, height: 188, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }} />
            ))}
          </div>
        ) : featuredOffers.length > 0 ? (
          <div className="flex gap-3 pb-3 -mx-5 px-5 snap-x snap-mandatory" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            {featuredOffers.map((offer: any) => {
              const pred = offer.prediction === 'home' ? offer.homeTeam : offer.prediction === 'away' ? offer.awayTeam : 'Draw';
              const hasDraw = p2pOfferHasDraw(offer);
              const opponent = p2pOppPred(offer.prediction, offer.homeTeam || 'Home', offer.awayTeam || 'Away', hasDraw);
              const takerPayout = ((Number(offer.creatorStake) || 0) + (Number(offer.takerStake) || 0)) * 0.98;
              const remaining = offer.expiresAt
                ? Math.max(0, Math.floor((new Date(offer.expiresAt).getTime() - Date.now()) / 60000))
                : null;
              const endingSoon = remaining !== null && remaining < 120;
              const cur = offer.currency || 'SUI';
              const isOwnOffer = !!walletAddress && offer.creatorWallet === walletAddress;
              return (
                <div key={offer.id}
                  className="flex-shrink-0 snap-start rounded-2xl p-5 transition-all duration-200"
                  style={{
                    width: 'min(310px, 82vw)',
                    background: isOwnOffer ? 'linear-gradient(145deg,#140e25,#0f0b1d)' : 'linear-gradient(145deg,#0f1420,#111828)',
                    border: isOwnOffer ? '1.5px solid rgba(168,85,247,0.50)' : '1px solid rgba(255,255,255,0.08)',
                    cursor: isOwnOffer ? 'default' : 'pointer',
                  }}
                  onClick={() => { if (!isOwnOffer) setAcceptingOffer(offer); }}>
                  {/* YOUR OFFER banner for own cards */}
                  {isOwnOffer && (
                    <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-purple-500/20 -mx-5 px-5">
                      <span className="text-[11px] font-black text-purple-200 bg-purple-500/20 border border-purple-400/40 px-2.5 py-0.5 rounded-full tracking-wider">
                        👤 YOUR OFFER
                      </span>
                      <span className="text-[10px] text-purple-400/60">Waiting for taker</span>
                    </div>
                  )}
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-1 rounded-full"
                      style={{ background: endingSoon ? 'rgba(249,115,22,0.12)' : 'rgba(0,255,255,0.08)', border: `1px solid ${endingSoon ? 'rgba(249,115,22,0.25)' : 'rgba(0,255,255,0.18)'}`, color: endingSoon ? '#fb923c' : '#00ffff' }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: endingSoon ? '#fb923c' : '#00ffff' }} />
                      {endingSoon ? 'ENDING SOON' : 'OPEN'}
                    </span>
                    {remaining !== null && (
                      <span className="text-[11px]" style={{ color: '#4b5563' }}>
                        ends in {remaining < 60 ? `${remaining}m` : `${Math.floor(remaining / 60)}h`}
                      </span>
                    )}
                  </div>
                  {/* Teams */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-[3px] h-5 rounded-full flex-shrink-0" style={{ background: '#00ffff' }} />
                      <span className="font-black text-white text-[15px] truncate">{offer.homeTeam || 'Home'}</span>
                    </div>
                    <span className="text-[11px] flex-shrink-0" style={{ color: '#374151' }}>v</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                      <span className="font-black text-white text-[15px] truncate text-right">{offer.awayTeam || 'Away'}</span>
                      <div className="w-[3px] h-5 rounded-full flex-shrink-0" style={{ background: '#a855f7' }} />
                    </div>
                  </div>
                  {/* Description */}
                  <p className="text-[13px] leading-snug mb-5" style={{ color: '#6b7280' }}>
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle" />
                    {isOwnOffer ? 'You back' : 'Someone backs'} <strong className="text-white">{pred}</strong> with <strong className="text-white">{fmtAmt(Number(offer.creatorStake) || 0)} {cur}</strong>.{' '}
                    {isOwnOffer
                      ? <span>Taker wins if <strong className="text-white">{opponent}</strong>.</span>
                      : <>Take the other side — <strong className="text-white">you win if {opponent}</strong>.</>
                    }
                  </p>
                  {/* CTA row */}
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: '#4b5563' }}>
                        {isOwnOffer ? 'Taker would win' : 'Take it and walk away with'}
                      </div>
                      <div className="font-black text-white" style={{ fontSize: '1.6rem', lineHeight: 1 }}>
                        {fmtAmt(takerPayout)} <span className="text-sm font-bold" style={{ color: '#6b7280' }}>{cur}</span>
                      </div>
                    </div>
                    {isOwnOffer ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setLocation('/p2p?tab=my'); }}
                        className="flex-shrink-0 px-4 py-2.5 rounded-xl font-black text-purple-200 text-sm transition-all active:scale-95 border border-purple-500/30"
                        style={{ background: 'rgba(168,85,247,0.15)' }}>
                        My Bets →
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setAcceptingOffer(offer); }}
                        className="flex-shrink-0 px-4 py-2.5 rounded-xl font-black text-black text-sm transition-all active:scale-95"
                        style={{ background: '#00ffff', boxShadow: '0 0 18px rgba(0,255,255,0.28)' }}>
                        Take the other side
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-4 py-6 px-5">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>⚽</div>
            <div>
              <div className="text-sm text-gray-400 font-medium">No open offers yet</div>
              <button onClick={() => setLocation('/p2p?tab=upcoming')} className="text-xs text-cyan-400 hover:underline mt-0.5">
                Be the first to post one →
              </button>
            </div>
          </div>
        )}

        {/* Sort tabs */}
        <div className="flex gap-2 mt-5 flex-wrap px-5">
          {([
            { key: 'ending', label: 'Ending soon' },
            { key: 'biggest', label: 'Biggest stake' },
            { key: 'payout', label: 'Best payout' },
            { key: 'newest', label: 'Newest' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setOfferSort(key)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{
                background: offerSort === key ? 'rgba(0,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${offerSort === key ? 'rgba(0,255,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: offerSort === key ? '#00ffff' : '#6b7280',
              }}>
              {offerSort === key && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#00ffff' }} />}
              {label}
            </button>
          ))}
        </div>

        {/* Create your own */}
        <button onClick={() => setLocation('/p2p?tab=upcoming')}
          className="w-full mt-4 flex items-center gap-4 p-4 rounded-2xl text-left transition-all group mx-5"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', width: 'calc(100% - 2.5rem)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(0,255,255,0.07)', border: '1px solid rgba(0,255,255,0.15)' }}>
            <span className="text-cyan-400 text-xl font-black">+</span>
          </div>
          <div className="flex-1">
            <div className="font-bold text-white text-sm">Create your own</div>
            <div className="text-xs mt-0.5" style={{ color: '#6b7280' }}>Set the match, your side and your odds — the market takes the rest</div>
          </div>
          <ArrowRight size={17} className="text-cyan-400 flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      </section>

      {/* ── OPEN MARKET ─────────────────────────────────────────────── */}
      <section className="px-5 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black">Open market</h2>
          <span className="text-sm" style={{ color: '#4b5563' }}>{sortedOffers.length} open</span>
        </div>

        {/* Currency filter + sort toggle */}
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-0.5 -mx-1 px-1">
          {([
            { key: 'all',    label: 'All',    color: '#e5e7eb', bg: 'rgba(255,255,255,0.1)',  border: 'rgba(255,255,255,0.15)' },
            { key: 'SUI',    label: 'SUI',    color: '#00ffff', bg: 'rgba(0,255,255,0.15)',   border: 'rgba(0,255,255,0.35)' },
            { key: 'SBETS',  label: 'SBETS',  color: '#c084fc', bg: 'rgba(168,85,247,0.25)',  border: 'rgba(168,85,247,0.4)' },
            { key: 'USDSUI', label: 'USDSui', color: '#fbbf24', bg: 'rgba(251,191,36,0.18)',  border: 'rgba(251,191,36,0.4)' },
            { key: 'USDC',   label: 'USDC',   color: '#22c55e', bg: 'rgba(34,197,94,0.18)',   border: 'rgba(34,197,94,0.4)' },
            { key: 'LBTC',   label: 'LBTC',   color: '#f97316', bg: 'rgba(249,115,22,0.18)',  border: 'rgba(249,115,22,0.4)' },
          ] as const).map(({ key, label, color, bg, border }) => (
            <button key={key} onClick={() => setMarketCurrency(key)}
              className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap"
              style={{
                background: marketCurrency === key ? bg : 'rgba(255,255,255,0.04)',
                color: marketCurrency === key ? color : '#6b7280',
                border: `1px solid ${marketCurrency === key ? border : 'rgba(255,255,255,0.06)'}`,
              }}>
              {label}
            </button>
          ))}
          <button onClick={() => setOfferSort(o => o === 'ending' ? 'newest' : o === 'newest' ? 'biggest' : o === 'biggest' ? 'payout' : 'ending')}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ml-auto transition-all whitespace-nowrap"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af' }}>
            <ArrowUpDown size={12} />
            {offerSort === 'ending' ? 'Ending soon' : offerSort === 'biggest' ? 'Biggest stake' : offerSort === 'payout' ? 'Best payout' : 'Newest'}
          </button>
        </div>

        {/* Sport filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-4 -mx-5 px-5">
          {[
            { key: 'all', label: 'All' },
            { key: 'football', label: '⚽ Football' },
            { key: 'basketball', label: '🏀 Basketball' },
            { key: 'esports', label: '🎮 Esports' },
            { key: 'tennis', label: '🎾 Tennis' },
            { key: 'hockey', label: '🏒 Hockey' },
            { key: 'mma', label: '🥊 MMA' },
            { key: 'baseball', label: '⚾ Baseball' },
            { key: 'volleyball', label: '🏐 Volleyball' },
            { key: 'formula-1', label: '🏎️ Formula 1' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setMarketSport(key)}
              className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all"
              style={{
                background: marketSport === key ? '#00ffff' : 'rgba(255,255,255,0.05)',
                color: marketSport === key ? '#000' : '#6b7280',
                border: `1px solid ${marketSport === key ? '#00ffff' : 'rgba(255,255,255,0.07)'}`,
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Offer list */}
        {sortedOffers.length === 0 ? (
          <div className="text-center py-14" style={{ color: '#374151' }}>
            <div className="text-5xl mb-4">⚽</div>
            <p className="text-sm mb-2">No open offers right now.</p>
            <button onClick={() => setLocation('/p2p?tab=upcoming')} className="text-cyan-400 text-sm hover:underline">
              Post the first one →
            </button>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {sortedOffers.map((offer: any) => {
              const pred = offer.prediction === 'home' ? offer.homeTeam : offer.prediction === 'away' ? offer.awayTeam : 'Draw';
              const hasDraw = p2pOfferHasDraw(offer);
              const opponent = p2pOppPred(offer.prediction, offer.homeTeam || 'Home', offer.awayTeam || 'Away', hasDraw);
              const takerWin = ((Number(offer.creatorStake) || 0) + (Number(offer.takerStake) || 0)) * 0.98;
              const cur = offer.currency || 'SUI';
              const stake = Number(offer.creatorStake) || 0;
              const sportKey = Object.keys(sportEmoji).find(k => (offer.sportName || '').toLowerCase().includes(k)) || '';
              const icon = sportEmoji[sportKey] || '🌍';
              return (
                <div key={offer.id}
                  className="flex items-center gap-3 py-3.5 cursor-pointer rounded-xl px-1 -mx-1 transition-all"
                  style={{}}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                  onClick={() => setAcceptingOffer(offer)}>
                  {/* Sport icon */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-base"
                    style={{ background: 'rgba(255,255,255,0.06)' }}>
                    {icon}
                  </div>
                  {/* Match info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div className="w-[2px] h-[14px] rounded-full bg-cyan-400 flex-shrink-0" />
                      <span className="font-bold text-white text-sm truncate">{offer.homeTeam || 'Home'}</span>
                      <span className="text-[11px]" style={{ color: '#4b5563' }}>v</span>
                      <span className="font-bold text-white text-sm truncate">{offer.awayTeam || 'Away'}</span>
                      <div className="w-[2px] h-[14px] rounded-full bg-purple-400 flex-shrink-0" />
                    </div>
                    <div className="flex items-center gap-1 text-xs" style={{ color: '#6b7280' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                      <span>backs <strong className="text-gray-300">{pred}</strong></span>
                      <span style={{ color: '#374151' }}>·</span>
                      <span>you win if <strong className="text-gray-300">{opponent}</strong></span>
                    </div>
                  </div>
                  {/* Badge + button */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] font-bold px-2 py-1 rounded-lg"
                      style={{
                        background: cur === 'SBETS' ? 'rgba(168,85,247,0.12)' : cur === 'USDSUI' ? 'rgba(251,191,36,0.10)' : cur === 'USDC' ? 'rgba(34,197,94,0.10)' : cur === 'LBTC' ? 'rgba(249,115,22,0.10)' : 'rgba(0,255,255,0.08)',
                        color: cur === 'SBETS' ? '#c084fc' : cur === 'USDSUI' ? '#fbbf24' : cur === 'USDC' ? '#22c55e' : cur === 'LBTC' ? '#f97316' : '#67e8f9',
                        border: `1px solid ${cur === 'SBETS' ? 'rgba(168,85,247,0.2)' : cur === 'USDSUI' ? 'rgba(251,191,36,0.2)' : cur === 'USDC' ? 'rgba(34,197,94,0.2)' : cur === 'LBTC' ? 'rgba(249,115,22,0.2)' : 'rgba(0,255,255,0.15)'}`,
                      }}>
                      {fmtAmt(stake)} {cur}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setAcceptingOffer(offer); }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-black text-xs transition-all active:scale-95"
                      style={{ background: '#00ffff' }}>
                      Take · win {fmtAmt(takerWin)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── PARLAY MARKET ─────────────────────────────────────────── */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
              <h3 className="text-lg font-black">Parlay market</h3>
              {openParlays.length > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)' }}>
                  {openParlays.length} open
                </span>
              )}
            </div>
            <button
              onClick={() => setLocation('/p2p?tab=parlays')}
              className="text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
            >
              View all <ArrowRight size={12} />
            </button>
          </div>

          {openParlays.length === 0 ? (
            <div className="rounded-2xl p-8 text-center"
              style={{ background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.1)' }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.25)' }}>
                <Layers size={22} className="text-purple-400" />
              </div>
              <p className="text-sm font-bold text-gray-400 mb-1">No open parlays yet</p>
              <p className="text-xs text-gray-600 mb-4">Post a multi-leg parlay offer and let the market take the other side</p>
              <button
                onClick={() => setLocation('/p2p?tab=upcoming')}
                className="text-xs font-bold px-4 py-2 rounded-xl text-black transition-all"
                style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', boxShadow: '0 0 12px rgba(168,85,247,0.3)' }}
              >
                + Post a Parlay
              </button>
            </div>
          ) : (
            <div className="space-y-0 divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
              {openParlays.slice(0, 6).map((parlay: any) => {
                const legs: any[] = Array.isArray(parlay.legs) ? parlay.legs : [];
                const totalOdds = Number(parlay.totalOdds) || 1;
                const creatorStake = Number(parlay.creatorStake) || 0;
                const takerStake = creatorStake * totalOdds - creatorStake;
                const takerWin = creatorStake * totalOdds * 0.98;
                const cur: string = parlay.currency || 'SUI';
                const currColor = cur === 'SUI' ? '#00ffff' : cur === 'SBETS' ? '#c084fc' : cur === 'USDC' ? '#22c55e' : '#34d399';
                const currBg = cur === 'SUI' ? 'rgba(0,255,255,0.08)' : cur === 'SBETS' ? 'rgba(168,85,247,0.12)' : 'rgba(34,197,94,0.08)';
                const currBorder = cur === 'SUI' ? 'rgba(0,255,255,0.15)' : cur === 'SBETS' ? 'rgba(168,85,247,0.2)' : 'rgba(34,197,94,0.15)';
                const expiryMs = new Date(parlay.expiresAt).getTime() - Date.now();
                const expiryH = Math.floor(expiryMs / 3600000);
                const expiryM = Math.floor((expiryMs % 3600000) / 60000);
                const expiryStr = expiryMs <= 0 ? 'Expired' : expiryH > 0 ? `${expiryH}h ${expiryM}m` : `${expiryM}m`;
                const stakeStr = creatorStake >= 1_000_000 ? `${(creatorStake / 1_000_000).toFixed(1)}M` : creatorStake >= 1000 ? `${(creatorStake / 1000).toFixed(1)}k` : creatorStake.toFixed(2);
                const takerWinStr = takerWin >= 1_000_000 ? `${(takerWin / 1_000_000).toFixed(1)}M` : takerWin >= 1000 ? `${(takerWin / 1000).toFixed(1)}k` : takerWin.toFixed(2);
                const legCount: number = parlay.legCount ?? legs.length ?? 0;

                return (
                  <div key={parlay.id}
                    className="flex items-center gap-3 py-3.5 cursor-pointer rounded-xl px-1 -mx-1 transition-all"
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(168,85,247,0.04)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                    onClick={() => setAcceptingParlay(parlay as ParlayOffer)}>
                    {/* Icon */}
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.2)' }}>
                      <Layers size={16} className="text-purple-400" />
                    </div>
                    {/* Parlay info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(168,85,247,0.12)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.2)' }}>
                          {legCount}-Leg
                        </span>
                        <span className="font-black text-sm" style={{ background: 'linear-gradient(135deg,#c084fc,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                          {totalOdds.toFixed(2)}x
                        </span>
                        {legs[0] && (
                          <span className="text-xs text-gray-400 truncate">
                            {legs[0].homeTeam} v {legs[0].awayTeam}
                            {legCount > 1 && <span className="text-gray-600"> +{legCount - 1} more</span>}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs" style={{ color: '#6b7280' }}>
                        <span>creator bets <strong style={{ color: '#d1d5db' }}>{stakeStr} {cur}</strong></span>
                        <span style={{ color: '#374151' }}>·</span>
                        <span style={{ color: expiryMs < 3600000 ? '#f87171' : '#6b7280' }}>{expiryStr} left</span>
                      </div>
                    </div>
                    {/* Badge + button */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] font-bold px-2 py-1 rounded-lg"
                        style={{ background: currBg, color: currColor, border: `1px solid ${currBorder}` }}>
                        {stakeStr} {cur}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setAcceptingParlay(parlay as ParlayOffer); }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-white text-xs transition-all active:scale-95"
                        style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', boxShadow: '0 0 10px rgba(168,85,247,0.3)' }}>
                        Take · win {takerWinStr}
                      </button>
                    </div>
                  </div>
                );
              })}
              {openParlays.length > 6 && (
                <div className="pt-3 text-center">
                  <button onClick={() => setLocation('/p2p?tab=parlays')}
                    className="text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors">
                    View all {openParlays.length} parlay offers →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Post a parlay CTA */}
          <div className="mt-5 rounded-2xl p-4 flex items-center gap-4"
            style={{ background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.1)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)' }}>
              <Layers size={16} className="text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold text-sm">Post a parlay offer</div>
              <div className="text-gray-500 text-xs mt-0.5">Add multiple legs to your bet slip → switch to P2P mode → post your parlay</div>
            </div>
            <button
              onClick={() => setLocation('/p2p?tab=upcoming')}
              className="flex-shrink-0 font-bold px-4 py-2 rounded-xl text-white text-sm transition-all"
              style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', boxShadow: '0 0 12px rgba(168,85,247,0.25)' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 20px rgba(168,85,247,0.45)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 12px rgba(168,85,247,0.25)')}>
              Browse Matches
            </button>
          </div>
        </div>

      </section>

      {/* ── MINIMAL FOOTER ──────────────────────────────────────────── */}
      <footer className="border-t px-5 pt-8 pb-24" style={{ borderColor: 'rgba(255,255,255,0.05)', background: '#060810' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div className="flex items-center justify-between mb-6">
            <Link href="/">
              <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-7 w-auto opacity-70" />
            </Link>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ border: '1px solid rgba(255,255,255,0.15)', color: '#6b7280' }}>18+</span>
              <span className="text-sm" style={{ color: '#6b7280' }}>Play responsibly</span>
            </div>
          </div>

          <div className="rounded-xl p-4 mb-6 flex items-start gap-3"
            style={{ background: 'rgba(0,255,255,0.02)', border: '1px solid rgba(0,255,255,0.07)' }}>
            <div className="w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ borderColor: 'rgba(0,255,255,0.2)' }}>
              <span className="text-cyan-400 text-xs font-bold">!</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
              <strong style={{ color: '#9ca3af' }}>Betting should be fun, never a way to make money.</strong>{' '}
              Only stake what you can afford to lose. If it stops being fun, take a break or reach out to a support service in your country.
            </p>
          </div>

          <div className="flex items-center gap-3 mb-5">
            <a href="https://x.com/Sui_Bets" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              @Sui_Bets
            </a>
            <a href="https://t.me/Sui_Bets" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.26 14.242l-2.944-.919c-.64-.203-.654-.64.136-.95l11.49-4.429c.533-.194 1.0.131.62.304z"/></svg>
              Telegram
            </a>
            <a href="/settlement" className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-medium"
              style={{ background: 'rgba(0,255,255,0.04)', border: '1px solid rgba(0,255,255,0.12)', color: '#6b7280' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ffff'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,255,0.3)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6b7280'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,255,0.12)'; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Settlement Transparency
            </a>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 mb-6">
            {[
              { label: 'Whitepaper', href: '/whitepaper' },
              { label: 'FAQ', href: '/faq' },
              { label: 'Terms of use', href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
              { label: 'Responsible play', href: '/responsible' },
              { label: 'Docs', href: '/whitepaper' },
            ].map(({ label, href }) => (
              <a key={label} href={href} className="text-xs transition-colors" style={{ color: '#4b5563' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#9ca3af')}
                onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}>
                {label}
              </a>
            ))}
          </div>

          <div className="space-y-2.5 text-[11px] leading-relaxed" style={{ color: '#374151' }}>
            <p><strong style={{ color: '#4b5563' }}>Risk warning.</strong> SuiBets is a non-custodial, peer-to-peer betting exchange on the Sui network. Bets are wagers with real value and outcomes are uncertain — you can lose your entire stake. SUI and SBETS are crypto-assets whose value is volatile and may fall as well as rise.</p>
            <p><strong style={{ color: '#4b5563' }}>Your responsibility.</strong> You control your own wallet and keys; lost keys or signed transactions cannot be reversed by anyone, including us. Always verify what you sign.</p>
            <p><strong style={{ color: '#4b5563' }}>Eligibility.</strong> You must be of legal age to bet where you live (18+, or higher where required). Online betting and crypto are restricted or prohibited in some jurisdictions — it is your responsibility to check that participation is lawful for you.</p>
            <p style={{ color: '#1f2937' }}>© 2026 SuiBets. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Floating Bet Slip */}
      <FloatingBetSlip
        isOpen={isBetSlipOpen}
        onToggle={() => setIsBetSlipOpen(!isBetSlipOpen)}
        bets={selectedBets}
        onRemoveBet={removeBet}
        onClearAll={clearBets}
      />

      {/* Wallet Modal */}
      <ConnectWalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />

      {/* Live Bet Feed */}
      <LiveBetFeed />

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-24 right-4 z-50 flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold px-3 py-2 rounded-full shadow-lg transition-all"
          aria-label="Return to top"
        >
          <ChevronUp size={14} />
          Top
        </button>
      )}

      {/* ── Inline P2P Accept Modal ─── */}
      {acceptingOffer && (
        <HomeAcceptModal
          offer={acceptingOffer}
          onClose={() => setAcceptingOffer(null)}
          onConfirm={(stake, txHash) => {
            acceptOfferMutation.mutate({ offerId: acceptingOffer.id, stake, txHash, currency: acceptingOffer.currency ?? 'SUI' });
          }}
          myWallet={walletAddress ?? undefined}
          contractWallet={contractWallet}
          packageId={p2pPackageId}
          configId={p2pConfigId}
          registryId={p2pRegistryId}
          onchainEscrow={onchainEscrow}
        />
      )}

      {/* ── Inline Parlay Accept Modal ─── */}
      <ParlayAcceptModal
        offer={acceptingParlay}
        onClose={() => setAcceptingParlay(null)}
        onConfirm={(txHash) => {
          if (!acceptingParlay) return;
          acceptParlayMutation.mutate({ parlayId: acceptingParlay.id, txHash });
        }}
        myWallet={walletAddress ?? undefined}
        contractWallet={contractWallet}
        packageId={p2pPackageId}
        configId={p2pConfigId}
        onchainEscrow={onchainEscrow}
      />
    </div>
  );
}


// League priority for sorting (major leagues first)
const LEAGUE_PRIORITY: Record<string, number> = {
  'Premier League': 1,
  'La Liga': 2,
  'Serie A': 3,
  'Bundesliga': 4,
  'Ligue 1': 5,
  'Champions League': 6,
  'UEFA Champions League': 6,
  'Europa League': 7,
  'UEFA Europa League': 7,
  'FA Cup': 8,
  'Copa del Rey': 9,
  'DFB Pokal': 10,
  'Eredivisie': 11,
  'Liga Portugal': 12,
  'MLS': 13,
};

// Floating Bet Slip Drawer Component
interface FloatingBetSlipProps {
  isOpen: boolean;
  onToggle: () => void;
  bets: any[];
  onRemoveBet: (id: string) => void;
  onClearAll: () => void;
}

function FloatingBetSlip({ isOpen, onToggle, bets, onRemoveBet, onClearAll }: FloatingBetSlipProps) {
  const [stake, setStake] = useState<string>('');
  const [, setLocation] = useLocation();
  
  // Calculate combined parlay odds (multiply all individual odds)
  const combinedOdds = useMemo(() => {
    if (bets.length === 0) return 0;
    if (bets.length === 1) return bets[0].odds || 1;
    return bets.reduce((acc, bet) => acc * (bet.odds || 1), 1);
  }, [bets]);
  
  // Calculate potential winnings based on stake
  const stakeNum = parseFloat(stake) || 0;
  const potentialWin = stakeNum * combinedOdds;
  
  // Handle place bet - navigates to parlay page with stake pre-filled
  const handlePlaceBet = () => {
    if (bets.length === 0) return;
    // Store stake in session storage for parlay page to pick up
    if (stake) {
      sessionStorage.setItem('parlayStake', stake);
    }
    setLocation('/parlay');
  };
  
  const isParlay = bets.length > 1;
  
  return (
    <>
      {/* When collapsed: floating pill above the bottom safe-area so it's always tappable on mobile */}
      {!isOpen && bets.length > 0 && (
        <button
          onClick={onToggle}
          data-testid="btn-betslip-toggle-collapsed"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-cyan-400 text-black font-black text-sm px-5 py-3 rounded-full shadow-2xl shadow-cyan-500/40 border border-cyan-300/30 active:scale-95 transition-transform"
          style={{ minWidth: 160 }}
        >
          <ChevronUp size={18} />
          <span>{isParlay ? 'Parlay' : 'Bet Slip'}</span>
          <span className="bg-black/25 px-2 py-0.5 rounded-full text-xs font-black">
            {bets.length}
          </span>
        </button>
      )}

      {/* When open: full-width bar + drawer from bottom */}
    <div className="fixed bottom-0 left-0 right-0 z-[70]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {isOpen && (
      <div className="flex">
        <button
          onClick={onToggle}
          className="flex-1 bg-gradient-to-r from-cyan-600 to-cyan-500 text-black font-bold px-3 md:px-4 py-2.5 md:py-3 flex items-center justify-between"
          data-testid="btn-betslip-toggle"
        >
          <div className="flex items-center gap-2 md:gap-3">
            <span className="bg-black/20 px-2 py-0.5 rounded-full text-xs md:text-sm">
              {bets.length}
            </span>
            <span className="text-sm md:text-base">{isParlay ? 'Parlay' : 'Bet Slip'}</span>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {bets.length > 0 && (
              <span className="text-xs md:text-sm font-medium">
                {combinedOdds.toFixed(2)}x
              </span>
            )}
            <ChevronDown size={18} />
          </div>
        </button>
      </div>
      )}
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="glass-card-strong border-t border-cyan-900/30 overflow-hidden"
          >
            <div className="max-h-40 md:max-h-48 overflow-y-auto p-3 md:p-4">
              {bets.length === 0 ? (
                <p className="text-gray-500 text-center py-3 text-sm">
                  Tap on odds to add selections
                </p>
              ) : (
                <div className="space-y-1.5 md:space-y-2">
                  {bets.map((bet, index) => (
                    <div 
                      key={bet.id || index}
                      className="bg-[#111111] rounded-lg p-2.5 md:p-3 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs md:text-sm truncate">{bet.eventName}</p>
                        <p className="text-cyan-400 text-[11px] md:text-xs">{bet.selectionName} @ {bet.odds?.toFixed(2)}</p>
                      </div>
                      <button
                        onClick={() => onRemoveBet(bet.id)}
                        className="text-red-400 hover:text-red-300 p-1 flex-shrink-0"
                        data-testid={`btn-remove-bet-${index}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {bets.length > 0 && (
              <div className="p-3 md:p-4 border-t border-cyan-900/30 space-y-2.5 md:space-y-3">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="flex-1">
                    <label className="text-gray-400 text-[10px] md:text-xs mb-0.5 md:mb-1 block">Stake (SUI)</label>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Amount..."
                      className="w-full bg-[#111111] border border-cyan-900/30 rounded-lg px-2.5 md:px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      data-testid="input-stake"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-gray-400 text-[10px] md:text-xs mb-0.5 md:mb-1 block">Potential Win</label>
                    <div className="bg-[#111111] border border-cyan-900/30 rounded-lg px-2.5 md:px-3 py-2 text-green-400 text-sm font-bold truncate">
                      {potentialWin > 0 ? `${potentialWin.toFixed(2)} SUI` : '-'}
                    </div>
                  </div>
                </div>
                
                {isParlay && (
                  <div className="flex items-center justify-between text-xs md:text-sm bg-[#111111] rounded-lg p-2">
                    <span className="text-gray-400">Combined ({bets.length} legs)</span>
                    <span className="text-cyan-400 font-bold">{combinedOdds.toFixed(2)}x</span>
                  </div>
                )}
                
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={onClearAll}
                    className="text-red-400 hover:text-red-300 text-xs md:text-sm py-2 px-3"
                    data-testid="btn-clear-bets"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handlePlaceBet}
                    disabled={bets.length === 0}
                    className="bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-bold px-4 md:px-6 py-2 rounded-lg text-sm flex-1 max-w-[200px]"
                    data-testid="btn-place-bet"
                  >
                    {isParlay ? `Place Parlay` : 'Place Bet'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
}

function RaceEventCard({ event }: { event: Event }) {
  const { addBet } = useBetting();
  const { toast } = useToast();
  const allMarkets = (event as any).markets || [];
  const winMarket = allMarkets.find((m: any) => m.id === 'race_winner') || allMarkets[0];
  const placeMarket = allMarkets.find((m: any) => m.id === 'race_place');
  const showMarket = allMarkets.find((m: any) => m.id === 'race_show');
  const runners = winMarket?.outcomes || [];
  const runnersInfo = (event as any).runnersInfo || [];
  const raceDetails = (event as any).raceDetails;
  const isHorseRacing = event.sportId === 17;
  const isMotorsport = event.sportId === 11 || event.sportId === 19;
  const hasWPS = (isHorseRacing || isMotorsport) && placeMarket && showMarket;

  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return timeStr;
      if (isTomorrow) return `Tomorrow\n${timeStr}`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + '\n' + timeStr;
    } catch { return ''; }
  };

  const handleRunnerBet = (runner: any, idx: number, marketType: string, marketId: string, odds: number) => {
    addBet({
      id: `${event.id}-${marketId}-${runner.id || idx}`,
      eventId: String(event.id),
      eventName: `${event.homeTeam}`,
      marketId,
      market: marketType,
      outcomeId: runner.id || `runner_${idx}`,
      selectionId: runner.id || `runner_${idx}`,
      selectionName: runner.name || `Runner ${idx + 1}`,
      odds,
      homeTeam: event.homeTeam,
      awayTeam: runner.name,
      isLive: false,
      leagueName: event.leagueName || event.league || undefined,
      sportName: event.sport || undefined,
      matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
    });
    toast({ title: "Added to bet slip", description: `${runner.name} ${marketType} @ ${odds.toFixed(2)}` });
  };

  return (
    <div className="px-4 py-3" data-testid={`horse-race-${event.id}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-16 md:w-20 flex-shrink-0 text-gray-500 text-xs whitespace-pre-line">
          {formatTime(event.startTime)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-semibold truncate">{event.homeTeam}</div>
          <div className="text-gray-500 text-xs">{event.awayTeam}</div>
          {raceDetails && (
            <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-600 flex-wrap">
              {raceDetails.surface && <span>{raceDetails.surface}</span>}
              {raceDetails.distance && <><span>•</span><span>{raceDetails.distance}</span></>}
              {raceDetails.going && <><span>•</span><span>{raceDetails.going}</span></>}
              {raceDetails.prize && <><span>•</span><span>{raceDetails.prize}</span></>}
              <span>•</span>
              <span>{raceDetails.fieldSize || runners.length} {(event.sportId === 11 || event.sportId === 19) ? 'riders' : 'runners'}</span>
            </div>
          )}
        </div>
      </div>

      {hasWPS && (
        <div className="flex items-center justify-end gap-1 mb-1 ml-0 md:ml-[80px] pr-3">
          <div className="flex-1" />
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">Win</span>
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">{isMotorsport ? 'Top 2' : 'Place'}</span>
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">{isMotorsport ? 'Podium' : 'Show'}</span>
        </div>
      )}

      <div className="space-y-1 ml-0 md:ml-[80px]">
        {runners.map((runner: any, idx: number) => {
          const info = runnersInfo[idx];
          const placeOdds = placeMarket?.outcomes?.[idx]?.odds;
          const showOdds = showMarket?.outcomes?.[idx]?.odds;
          return (
            <div
              key={runner.id || idx}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111111] border border-cyan-900/10 hover:border-cyan-500/30 hover:bg-[#151515] transition-all group/runner"
              data-testid={`runner-row-${event.id}-${idx}`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-cyan-400 font-bold text-xs w-5 text-center">{info?.number || idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-white text-sm font-medium">{runner.name}</span>
                  {info && (
                    <span className="text-gray-500 text-[10px] ml-2">
                      {(event.sportId === 11 || event.sportId === 19) ? (info.jockey || '') : `J: ${info.jockey || 'TBA'}${info.trainer ? ` / ${info.trainer}` : ''}`}
                    </span>
                  )}
                </div>
                {info?.form && event.sportId !== 11 && event.sportId !== 19 && (
                  <span className="text-yellow-400/60 text-[10px] font-mono bg-yellow-400/5 px-1.5 py-0.5 rounded hidden md:inline">
                    {info.form}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => handleRunnerBet(runner, idx, 'Win', 'race_winner', runner.odds)}
                  className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-cyan-400 hover:bg-cyan-500 hover:text-black transition-all min-w-[48px] text-center"
                  data-testid={`odds-win-${event.id}-${idx}`}
                >
                  {runner.odds?.toFixed(2) || 'N/A'}
                </button>
                {hasWPS && (
                  <>
                    <button
                      onClick={() => placeOdds && handleRunnerBet(runner, idx, isMotorsport ? 'Top 2' : 'Place', 'race_place', placeOdds)}
                      className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all min-w-[48px] text-center"
                      data-testid={`odds-place-${event.id}-${idx}`}
                      disabled={!placeOdds}
                    >
                      {placeOdds?.toFixed(2) || 'N/A'}
                    </button>
                    <button
                      onClick={() => showOdds && handleRunnerBet(runner, idx, isMotorsport ? 'Podium' : 'Show', 'race_show', showOdds)}
                      className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-amber-400 hover:bg-amber-500 hover:text-black transition-all min-w-[48px] text-center"
                      data-testid={`odds-show-${event.id}-${idx}`}
                      disabled={!showOdds}
                    >
                      {showOdds?.toFixed(2) || 'N/A'}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LeagueGroupProps {
  leagueName: string;
  events: Event[];
  defaultExpanded?: boolean;
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
  p2pCounts?: Record<string, number>;
}

function LeagueGroup({ leagueName, events, defaultExpanded = false, favorites, toggleFavorite, p2pCounts = {} }: LeagueGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const leagueId = leagueName.replace(/\s+/g, '-').toLowerCase();
  const NO_DRAW_SPORTS_SET = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
  const RACE_SPORTS_SET = new Set([17, 11, 19]);
  const isRaceLeague = events.length > 0 && RACE_SPORTS_SET.has(events[0].sportId);
  const hasDraws = events.length > 0 && !NO_DRAW_SPORTS_SET.has(events[0].sportId);
  
  return (
    <div className="glass-card rounded-xl overflow-hidden transition-all duration-300">
      {/* League Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); }}}
        className="w-full px-4 py-3 flex items-center justify-between bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
        data-testid={`league-header-${leagueId}`}
        aria-expanded={isExpanded}
        aria-controls={`league-events-${leagueId}`}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-semibold">{leagueName}</span>
          <span className="bg-cyan-500/20 text-cyan-400 text-xs px-2 py-0.5 rounded-full">
            {events.length} {events.length === 1 ? 'match' : 'matches'}
          </span>
        </div>
        <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true">
          ▼
        </span>
      </button>
      
      {/* Events List */}
      {isExpanded && (
        <div id={`league-events-${leagueId}`} className="divide-y divide-cyan-900/20" role="list">
          {!isRaceLeague && (
            <div className="px-4 py-1.5 flex items-center gap-2 md:gap-4 bg-white/[0.02] border-b border-cyan-900/30" data-testid={`column-headers-${leagueId}`}>
              <div className="w-12 md:w-20 flex-shrink-0 text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Time</div>
              <div className="flex-1 min-w-0 flex items-center gap-2 md:gap-4">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Teams</span>
                <span className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold ml-auto hidden md:block">Score</span>
              </div>
              <div className="hidden md:flex items-center gap-1">
                <span className="text-[10px] text-cyan-600 uppercase tracking-wider font-semibold w-[52px] text-center" title="Home Win">H</span>
                {hasDraws && <span className="text-[10px] text-yellow-600 uppercase tracking-wider font-semibold w-[52px] text-center" title="Draw">X</span>}
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold w-[52px] text-center" title="Away Win">A</span>
              </div>
              <div className="md:hidden flex items-center gap-2 ml-auto">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Odds:</span>
                <span className="text-[10px] text-cyan-600 font-semibold">H</span>
                {hasDraws && (<><span className="text-[10px] text-gray-600">·</span><span className="text-[10px] text-yellow-600 font-semibold">X</span></>)}
                <span className="text-[10px] text-gray-600">·</span>
                <span className="text-[10px] text-gray-400 font-semibold">A</span>
              </div>
              <div className="w-6 flex-shrink-0 hidden md:block"></div>
            </div>
          )}
          {events.map((event, index) => (
            (event.sportId === 17 || event.sportId === 11 || event.sportId === 19) ? (
              <RaceEventCard
                key={`${event.sportId}-${event.id}-${index}`}
                event={event}
              />
            ) : (
              <CompactEventCard 
                key={`${event.sportId}-${event.id}-${index}`} 
                event={event}
                favorites={favorites}
                toggleFavorite={toggleFavorite}
                p2pCount={p2pCounts[String(event.id)] ?? 0}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

interface LeagueGroupedEventsProps {
  events: Event[];
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
}

function LeagueGroupedEvents({ events, favorites, toggleFavorite }: LeagueGroupedEventsProps) {
  const { data: offerCountsData } = useQuery<{ counts: Record<string, number> }>({
    queryKey: ['/api/p2p/offer-counts'],
    queryFn: () => fetch('/api/p2p/offer-counts').then(r => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const p2pCounts = offerCountsData?.counts ?? {};

  // Group events by league
  const groupedByLeague = events.reduce((acc, event) => {
    const league = event.leagueName || event.league || 'Other';
    if (!acc[league]) {
      acc[league] = [];
    }
    acc[league].push(event);
    return acc;
  }, {} as Record<string, Event[]>);
  
  // Sort leagues by priority (major leagues first)
  const sortedLeagues = Object.keys(groupedByLeague).sort((a, b) => {
    const priorityA = LEAGUE_PRIORITY[a] || 100;
    const priorityB = LEAGUE_PRIORITY[b] || 100;
    if (priorityA !== priorityB) return priorityA - priorityB;
    // If same priority, sort by number of matches (more matches first)
    return groupedByLeague[b].length - groupedByLeague[a].length;
  });
  
  return (
    <div className="space-y-3">
      {sortedLeagues.map((league, index) => (
        <LeagueGroup
          key={league}
          leagueName={league}
          events={groupedByLeague[league]}
          defaultExpanded={index < 3}
          favorites={favorites}
          toggleFavorite={toggleFavorite}
          p2pCounts={p2pCounts}
        />
      ))}
    </div>
  );
}

// Odds Movement Indicator Component
function OddsMovement({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'stable') return null;
  return direction === 'up' ? (
    <TrendingUp size={10} className="text-green-400" />
  ) : (
    <TrendingDown size={10} className="text-red-400" />
  );
}

// Props interface for CompactEventCard
interface CompactEventCardProps {
  event: Event;
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
  p2pCount?: number;
}

// Compact event card for league-grouped view
function CompactEventCard({ event, favorites, toggleFavorite, p2pCount = 0 }: CompactEventCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [showMoreMarkets, setShowMoreMarkets] = useState(false);
  const [showOddsChart, setShowOddsChart] = useState(false);

  const { addBet } = useBetting();
  const { toast } = useToast();
  
  // Calculate these values FIRST so they are available for helpers and memo
  const minuteNum = useMemo(() => {
    if (!event || !event.minute) return 0;
    try {
      const minStr = String(event.minute).replace(/[^0-9]/g, '');
      return minStr ? parseInt(minStr, 10) : 0;
    } catch (e) {
      console.error("Error parsing minute:", e);
      return 0;
    }
  }, [event?.minute]);

  const isBettingClosed = useMemo(() => {
    return !!(event?.isLive && minuteNum >= 80);
  }, [event?.isLive, minuteNum]);

  // Helper to check if a market is closed based on match minute
  const isMarketClosed = useCallback((marketId: any) => {
    if (!event?.isLive || !marketId) return false;
    try {
      const marketStr = String(marketId).toLowerCase();
      const isFirstHalf = marketStr.includes('1st_half') || 
                         marketStr.includes('1st-half') ||
                         marketStr.includes('first_half') ||
                         marketStr.includes('first-half') ||
                         marketStr.includes('half_time_result') ||
                         marketStr.includes('half-time-result') ||
                         marketStr === '4';
      
      if (isFirstHalf && minuteNum >= 45) return true;
      
      const isMatchWinner = marketStr.includes('match_winner') || marketStr.includes('match-winner') ||
                            marketStr.includes('match_result') || marketStr.includes('match-result') ||
                            marketStr === 'match winner' || marketStr === 'match result';
      if (!isMatchWinner) return true;
      
      if (minuteNum >= 80) return true;
    } catch (e) {
      console.error("Error in isMarketClosed:", e);
    }
    return false;
  }, [event?.isLive, minuteNum]);

  // Get secondary markets for this event (BTTS, Double Chance, etc.) - NOT available for live matches
  const secondaryMarkets = useMemo(() => {
    if (!event) return [];
    if (event.isLive) return [];
    try {
      const apiMarkets = (event.markets || [])
        .filter((m: any) => {
          const name = (m.name || '').toLowerCase();
          return !name.includes('match winner') && !name.includes('match result') && !name.includes('home/away') && !name.includes('1x2');
        })
        .filter((m: any) => m.outcomes && m.outcomes.length >= 2)
        .filter((m: any) => !isMarketClosed(m.id));

      if (apiMarkets.length > 0) return apiMarkets;

      if (event.sportId === 1) {
        return sportMarketsAdapter.getDefaultMarkets(1, event.homeTeam, event.awayTeam, { home: event.homeOdds, draw: event.drawOdds, away: event.awayOdds })
          .slice(1)
          .filter(m => !isMarketClosed(m.id));
      }

      return [];
    } catch (e) {
      console.error("Error generating secondary markets:", e);
      return [];
    }
  }, [event?.id, event?.homeTeam, event?.awayTeam, event?.sportId, event?.homeScore, event?.awayScore, event?.score, event?.isLive, minuteNum, isMarketClosed]);
  
  const NO_DRAW_SPORTS = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
  const hasRealOdds = !!(event?.homeOdds !== null && event?.homeOdds !== undefined && event?.homeOdds > 0)
    || ((event as any).oddsSource === 'live-fallback');
  const odds = {
    home: event?.homeOdds || null,
    draw: NO_DRAW_SPORTS.has(event?.sportId) ? null : (event?.drawOdds || null),
    away: event?.awayOdds || null
  };
  
  const getOddsMovement = (_oddsValue: number): 'up' | 'down' | 'stable' => {
    return 'stable';
  };

  const calcPcts = (h: number | null, d: number | null, a: number | null) => {
    const rH = h && h > 0 ? 1 / h : 0;
    const rD = d && d > 0 ? 1 / d : 0;
    const rA = a && a > 0 ? 1 / a : 0;
    const tot = rH + rD + rA || 1;
    return { home: Math.round(rH / tot * 100), draw: Math.round(rD / tot * 100), away: Math.round(rA / tot * 100) };
  };
  const pcts = calcPcts(odds.home, odds.draw, odds.away);

  const score = {
    home: event.homeScore ?? (event.score?.split('-')[0]?.trim() || '0'),
    away: event.awayScore ?? (event.score?.split('-')[1]?.trim() || '0')
  };
  
  const isHomeFavorite = favorites.has(event.homeTeam);
  const isAwayFavorite = favorites.has(event.awayTeam);
  
  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today ${timeStr}`;
      if (isTomorrow) return `Tomorrow ${timeStr}`;
      return date.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) + ' ' + timeStr;
    } catch {
      return '';
    }
  };

  const handleOutcomeClick = (outcome: string) => {
    setSelectedOutcome(selectedOutcome === outcome ? null : outcome);
  };

  const handleQuickBet = () => {
    if (!selectedOutcome) {
      toast({ title: "Select an outcome", description: "Click Home, Draw, or Away to select" });
      return;
    }
    
    const selectedOdds = selectedOutcome === 'home' ? odds.home : selectedOutcome === 'draw' ? odds.draw : odds.away;
    const outcomeName = selectedOutcome === 'home' ? event.homeTeam : selectedOutcome === 'draw' ? 'Draw' : event.awayTeam;
    
    addBet({
      id: `${event.id}-match-winner-${selectedOutcome}`,
      eventId: String(event.id),
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      marketId: "match-winner",
      market: "Match Winner",
      outcomeId: selectedOutcome,
      selectionId: selectedOutcome,
      selectionName: outcomeName,
      odds: selectedOdds,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      isLive: event.isLive || false,
      leagueName: event.leagueName || event.league || undefined,
      sportName: event.sport || undefined,
      matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
    });
    
    toast({ title: "Added to bet slip", description: `${outcomeName} @ ${selectedOdds.toFixed(2)}` });
    setSelectedOutcome(null);
  };
  
  return (
    <div 
      className="px-4 py-3 hover:bg-white/[0.04] hover:backdrop-blur-sm transition-all duration-200 relative group" 
      data-testid={`compact-event-${event.id}`}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Time / Live indicator */}
          <div className="w-12 md:w-20 flex-shrink-0">
            {event.isLive ? (
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                <LiveClockBadge event={event} sportId={(event as any).sportId} className="text-red-400 text-xs font-medium" />
              </div>
            ) : (
              <span className="text-gray-500 text-xs">{formatTime(event.startTime)}</span>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-600 font-medium uppercase w-3 flex-shrink-0">H</span>
              {event.homeLogo && (
                <img src={event.homeLogo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />
              )}
              <span className="text-white text-sm truncate flex-1">{event.homeTeam}</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(event.homeTeam); }}
                className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ visibility: 'visible' }}
                data-testid={`btn-favorite-home-${event.id}`}
              >
                <Star 
                  size={14} 
                  className={isHomeFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} 
                />
              </button>
              {event.isLive && <span className="text-cyan-400 font-bold text-sm score-pulse" aria-live="polite" aria-atomic="true">{score.home}</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] text-gray-600 font-medium uppercase w-3 flex-shrink-0">A</span>
              {event.awayLogo && (
                <img src={event.awayLogo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />
              )}
              <span className="text-gray-400 text-sm truncate flex-1">{event.awayTeam}</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(event.awayTeam); }}
                className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ visibility: 'visible' }}
                data-testid={`btn-favorite-away-${event.id}`}
              >
                <Star 
                  size={14} 
                  className={isAwayFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} 
                />
              </button>
              {event.isLive && <span className="text-cyan-400 font-bold text-sm score-pulse" aria-live="polite" aria-atomic="true">{score.away}</span>}
            </div>
          </div>

          {/* Desktop: Odds inline */}
          <div className="hidden md:flex items-center gap-1">
            {isBettingClosed ? (
              <div className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 border border-red-800/50 rounded">
                <Clock size={12} className="text-red-400" />
                <span className="text-red-400 text-xs font-medium">Betting closed</span>
              </div>
            ) : hasRealOdds ? (
              <div className="flex gap-1">
                {odds.home && (
                  <button
                    onClick={() => handleOutcomeClick('home')}
                    className={`flex flex-col items-center px-2 py-1 rounded transition-all min-w-[52px] ${
                      selectedOutcome === 'home'
                        ? 'bg-cyan-500/20 ring-1 ring-cyan-500'
                        : 'bg-[#1a1a1a] hover:bg-[#222]'
                    }`}
                    data-testid={`compact-odds-home-${event.id}`}
                  >
                    <span className="text-[9px] text-gray-500 mb-0.5">H</span>
                    <div className="w-full h-1 bg-[#333] rounded-full overflow-hidden mb-0.5">
                      <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${pcts.home}%` }} />
                    </div>
                    <span className="text-[11px] font-bold text-cyan-400">{pcts.home}%</span>
                  </button>
                )}
                {odds.draw && (
                  <button
                    onClick={() => handleOutcomeClick('draw')}
                    className={`flex flex-col items-center px-2 py-1 rounded transition-all min-w-[52px] ${
                      selectedOutcome === 'draw'
                        ? 'bg-yellow-500/20 ring-1 ring-yellow-500'
                        : 'bg-[#1a1a1a] hover:bg-[#222]'
                    }`}
                    data-testid={`compact-odds-draw-${event.id}`}
                  >
                    <span className="text-[9px] text-gray-500 mb-0.5">X</span>
                    <div className="w-full h-1 bg-[#333] rounded-full overflow-hidden mb-0.5">
                      <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${pcts.draw}%` }} />
                    </div>
                    <span className="text-[11px] font-bold text-yellow-400">{pcts.draw}%</span>
                  </button>
                )}
                {odds.away && (
                  <button
                    onClick={() => handleOutcomeClick('away')}
                    className={`flex flex-col items-center px-2 py-1 rounded transition-all min-w-[52px] ${
                      selectedOutcome === 'away'
                        ? 'bg-cyan-500/20 ring-1 ring-cyan-500'
                        : 'bg-[#1a1a1a] hover:bg-[#222]'
                    }`}
                    data-testid={`compact-odds-away-${event.id}`}
                  >
                    <span className="text-[9px] text-gray-500 mb-0.5">A</span>
                    <div className="w-full h-1 bg-[#333] rounded-full overflow-hidden mb-0.5">
                      <div className="h-full bg-white/60 rounded-full" style={{ width: `${pcts.away}%` }} />
                    </div>
                    <span className="text-[11px] font-bold text-white">{pcts.away}%</span>
                  </button>
                )}
                {selectedOutcome && (
                  <button
                    onClick={handleQuickBet}
                    className="px-2 py-1.5 bg-green-500 hover:bg-green-600 text-black rounded text-xs font-bold transition-all"
                    data-testid={`compact-bet-${event.id}`}
                  >
                    +
                  </button>
                )}
              </div>
            ) : (
              <span className="text-gray-600 text-xs">No odds</span>
            )}
            {p2pCount > 0 && (
              <Link href="/p2p"
                className="ml-0.5 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/15 text-purple-400 hover:bg-purple-500/30 hover:text-purple-300 transition-colors whitespace-nowrap flex-shrink-0"
                title={`${p2pCount} open P2P offer${p2pCount > 1 ? 's' : ''} — click to view`}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                ⚔ {p2pCount}
              </Link>
            )}
          </div>
          
          {/* Match Info Tooltip */}
          <button 
            className="p-1 text-gray-600 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title={`${event.leagueName || ''} - Click for match details`}
            data-testid={`btn-info-${event.id}`}
          >
            <Info size={14} />
          </button>
        </div>

        {/* Mobile: Odds row below teams */}
        <div className="flex md:hidden items-center gap-1 pl-12">
          {isBettingClosed ? (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 border border-red-800/50 rounded">
              <Clock size={12} className="text-red-400" />
              <span className="text-red-400 text-xs font-medium">Betting closed</span>
            </div>
          ) : hasRealOdds ? (
            <div className="flex gap-1.5 flex-1">
              {odds.home && (
                <button
                  onClick={() => handleOutcomeClick('home')}
                  className={`flex-1 flex flex-col items-center px-2 py-1.5 rounded transition-all ${
                    selectedOutcome === 'home'
                      ? 'bg-cyan-500/20 ring-1 ring-cyan-500'
                      : 'bg-[#1a1a1a] hover:bg-[#222]'
                  }`}
                  data-testid={`compact-odds-home-mobile-${event.id}`}
                >
                  <span className="text-[9px] text-gray-500 mb-0.5">H</span>
                  <div className="w-full h-1 bg-[#333] rounded-full overflow-hidden mb-0.5">
                    <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${pcts.home}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-cyan-400">{pcts.home}%</span>
                </button>
              )}
              {odds.draw && (
                <button
                  onClick={() => handleOutcomeClick('draw')}
                  className={`flex-1 flex flex-col items-center px-2 py-1.5 rounded transition-all ${
                    selectedOutcome === 'draw'
                      ? 'bg-yellow-500/20 ring-1 ring-yellow-500'
                      : 'bg-[#1a1a1a] hover:bg-[#222]'
                  }`}
                  data-testid={`compact-odds-draw-mobile-${event.id}`}
                >
                  <span className="text-[9px] text-gray-500 mb-0.5">X</span>
                  <div className="w-full h-1 bg-[#333] rounded-full overflow-hidden mb-0.5">
                    <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${pcts.draw}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-yellow-400">{pcts.draw}%</span>
                </button>
              )}
              {odds.away && (
                <button
                  onClick={() => handleOutcomeClick('away')}
                  className={`flex-1 flex flex-col items-center px-2 py-1.5 rounded transition-all ${
                    selectedOutcome === 'away'
                      ? 'bg-cyan-500/20 ring-1 ring-cyan-500'
                      : 'bg-[#1a1a1a] hover:bg-[#222]'
                  }`}
                  data-testid={`compact-odds-away-mobile-${event.id}`}
                >
                  <span className="text-[9px] text-gray-500 mb-0.5">A</span>
                  <div className="w-full h-1 bg-[#333] rounded-full overflow-hidden mb-0.5">
                    <div className="h-full bg-white/60 rounded-full" style={{ width: `${pcts.away}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-white">{pcts.away}%</span>
                </button>
              )}
              {selectedOutcome && (
                <button
                  onClick={handleQuickBet}
                  className="px-3 py-2 bg-green-500 hover:bg-green-600 text-black rounded text-xs font-bold transition-all"
                  data-testid={`compact-bet-mobile-${event.id}`}
                >
                  +
                </button>
              )}
            </div>
          ) : (
            <span className="text-gray-600 text-xs">No odds</span>
          )}
        </div>
      </div>

      {/* Mobile: P2P badge row */}
      {p2pCount > 0 && (
        <div className="flex md:hidden items-center pl-14 mt-1 mb-0.5">
          <Link href="/p2p"
            className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-500/30 bg-purple-500/12 text-purple-400 hover:text-purple-300 transition-colors"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            ⚔ {p2pCount} P2P offer{p2pCount > 1 ? 's' : ''}
          </Link>
        </div>
      )}

      {/* More Markets Button and Expandable Section */}
      {secondaryMarkets.length > 0 && hasRealOdds && (
        <>
          <button
            onClick={() => setShowMoreMarkets(!showMoreMarkets)}
            className="w-full mt-2 py-1.5 flex items-center justify-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors border-t border-cyan-900/20"
            data-testid={`btn-more-markets-${event.id}`}
          >
            <MoreHorizontal size={14} />
            <span>{showMoreMarkets ? 'Hide Markets' : `+${secondaryMarkets.length} More Markets`}</span>
            {showMoreMarkets ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          
          <AnimatePresence>
            {showMoreMarkets && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 py-3 bg-[#0a0a0a] space-y-3">
                  {secondaryMarkets.map((market) => (
                    <div key={market.id} className="space-y-2">
                      <div className="text-xs text-gray-400 font-medium">{market.name}</div>
                      <div className="flex flex-wrap gap-1">
                        {market.outcomes.map((outcome) => (
                          <button
                            key={outcome.id}
                            onClick={() => {
                              addBet({
                                id: `${event.id}-${market.id}-${outcome.id}`,
                                eventId: String(event.id),
                                eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                                marketId: String(market.id),
                                market: market.name,
                                outcomeId: String(outcome.id),
                                selectionId: String(outcome.id),
                                selectionName: outcome.name,
                                odds: outcome.odds,
                                homeTeam: event.homeTeam,
                                awayTeam: event.awayTeam,
                                isLive: event.isLive || false,
                                leagueName: event.leagueName || event.league || undefined,
                                sportName: event.sport || undefined,
                                matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
                              });
                              toast({ 
                                title: "Added to bet slip", 
                                description: `${market.name}: ${outcome.name} @ ${outcome.odds.toFixed(2)}` 
                              });
                            }}
                            className="px-2 py-1 bg-[#1a1a1a] hover:bg-[#222] text-xs rounded transition-colors"
                            data-testid={`btn-market-${market.id}-${outcome.id}-${event.id}`}
                          >
                            <span className="text-gray-400">{outcome.name}</span>
                            <span className="ml-1 text-cyan-400 font-medium">{outcome.odds.toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Odds movement chart trigger */}
      <div className="flex justify-end mt-1 px-4 pb-1">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowOddsChart(v => !v); }}
          className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-cyan-400 transition-colors px-1 py-0.5"
          title="View odds movement chart"
        >
          <TrendingUp className="h-3 w-3" />
          <span>odds movement</span>
        </button>
      </div>
      {showOddsChart && (
        <div className="px-4 pb-3">
          <OddsHistoryChart
            eventId={typeof event.id === 'number' ? event.id.toString() : String(event.id)}
            homeTeam={event.homeTeam}
            awayTeam={event.awayTeam}
            onClose={() => setShowOddsChart(false)}
          />
        </div>
      )}
    </div>
  );
}

interface EventCardProps {
  event: Event;
}

function EventCard({ event }: EventCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [stake, setStake] = useState<string>("10");
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOddsChart, setShowOddsChart] = useState(false);
  const { addBet } = useBetting();
  const { toast } = useToast();
  
  // Odds are available when the event has valid numeric home/away odds regardless of source.
  // ESPN live events carry oddsSource='live-api' — we must accept that alongside api-sports / live-fallback.
  const hasRealOdds = !!(event?.homeOdds && event.homeOdds > 0 && event?.awayOdds && event.awayOdds > 0)
    || (event as any).oddsSource === 'live-fallback'
    || (event as any).oddsSource === 'live-api'
    || (event as any).oddsSource === 'api-sports';
  
  // Check if live match is past 45 minutes (betting closed)
  const getMatchMinute = (): number | null => {
    const eventAny = event as any;
    if (eventAny.minute !== undefined && eventAny.minute !== null) {
      const min = parseInt(String(eventAny.minute));
      if (!isNaN(min)) return min;
    }
    if (eventAny.matchMinute !== undefined && eventAny.matchMinute !== null) {
      const min = parseInt(String(eventAny.matchMinute));
      if (!isNaN(min)) return min;
    }
    // Try to extract from status string like "75'" or "HT"
    if (typeof eventAny.status === 'string') {
      const match = eventAny.status.match(/(\d+)/);
      if (match) return parseInt(match[1]);
      if (eventAny.status === 'HT') return 45;
      if (eventAny.status.includes('2H')) return 46;
    }
    return null;
  };
  
  const matchMinute = getMatchMinute();
  const isLiveMatch = event.isLive || event.status?.toLowerCase().includes('live') || 
                      event.status?.includes('H') || event.status?.includes("'");
  const isBettingClosed = isLiveMatch && matchMinute !== null && matchMinute >= 80;

  const getOddsFromMarkets = () => {
    const NO_DRAW_SPORTS = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
    const sportHasDraws = !NO_DRAW_SPORTS.has(event.sportId);
    const defaultOdds = { home: 2.05, draw: sportHasDraws ? 3.40 : null, away: 3.00 };
    
    if (!event.markets || event.markets.length === 0) {
      return { 
        home: event.homeOdds || defaultOdds.home, 
        draw: sportHasDraws ? (event.drawOdds || defaultOdds.draw) : null, 
        away: event.awayOdds || defaultOdds.away 
      };
    }
    
    const matchWinner = event.markets.find(m => m.name === "Match Result" || m.name === "Match Winner");
    if (matchWinner && matchWinner.outcomes && matchWinner.outcomes.length > 0) {
      const homeOutcome = matchWinner.outcomes.find(o => o.name === event.homeTeam);
      const drawOutcome = sportHasDraws ? matchWinner.outcomes.find(o => o.name === "Draw") : null;
      const awayOutcome = matchWinner.outcomes.find(o => o.name === event.awayTeam);
      return {
        home: (homeOutcome?.odds && !isNaN(homeOutcome.odds)) ? homeOutcome.odds : defaultOdds.home,
        draw: sportHasDraws && drawOutcome?.odds && !isNaN(drawOutcome.odds) ? drawOutcome.odds : defaultOdds.draw,
        away: (awayOutcome?.odds && !isNaN(awayOutcome.odds)) ? awayOutcome.odds : defaultOdds.away
      };
    }
    return defaultOdds;
  };

  const odds = getOddsFromMarkets();

  const calcCardPcts = (h: number | null, d: number | null, a: number | null) => {
    const rH = h && h > 0 ? 1 / h : 0;
    const rD = d && d > 0 ? 1 / d : 0;
    const rA = a && a > 0 ? 1 / a : 0;
    const tot = rH + rD + rA || 1;
    return { home: Math.round(rH / tot * 100), draw: Math.round(rD / tot * 100), away: Math.round(rA / tot * 100) };
  };
  const cardPcts = calcCardPcts(odds.home, odds.draw, odds.away);

  const getOdds = (outcome: string): number => {
    switch (outcome) {
      case "home": return odds.home;
      case "draw": return odds.draw;
      case "away": return odds.away;
      default: return 2.0;
    }
  };

  const handleOutcomeClick = (outcome: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBettingClosed) {
      toast({
        title: "Betting Closed",
        description: "Betting closed — final minutes of the match",
        variant: "destructive",
      });
      return;
    }
    setSelectedOutcome(outcome === selectedOutcome ? null : outcome);
  };

  const handleBetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedOutcome) {
      const selectedOdds = getOdds(selectedOutcome);
      const selectionName = selectedOutcome === "home" 
        ? event.homeTeam 
        : selectedOutcome === "away" 
          ? event.awayTeam 
          : "Draw";
      
      const betId = `${event.id}-${selectedOutcome}-${Date.now()}`;
      
      addBet({
        id: betId,
        eventId: String(event.id),
        eventName: `${event.homeTeam} vs ${event.awayTeam}`,
        marketId: "match-result",
        market: "Match Result",
        outcomeId: selectedOutcome,
        selectionName,
        odds: selectedOdds,
        stake: parseFloat(stake) || 10,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        isLive: event.isLive || false,
        leagueName: event.leagueName || event.league || undefined,
        sportName: event.sport || undefined,
        matchDate: event.startTime ? new Date(event.startTime).toISOString() : undefined,
      });
      
      setSelectedOutcome(null);
    }
  };

  const parseScore = () => {
    if (event.score) {
      const parts = event.score.split(" - ");
      return { home: parseInt(parts[0]) || 0, away: parseInt(parts[1]) || 0 };
    }
    return { home: event.homeScore || 0, away: event.awayScore || 0 };
  };

  const score = parseScore();
  const leagueName = event.leagueName || event.league || "League";

  const potentialWin = selectedOutcome 
    ? (parseFloat(stake) * getOdds(selectedOutcome)).toFixed(2) 
    : "0";

  const formatDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      if (isToday) {
        return `Today ${timeStr}`;
      } else if (isTomorrow) {
        return `Tomorrow ${timeStr}`;
      } else {
        const dayStr = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        return `${dayStr} ${timeStr}`;
      }
    } catch {
      return '';
    }
  };

  return (
    <div 
      className="bg-[#111111] rounded-xl border border-cyan-900/30 overflow-hidden hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/5 transition-all duration-300"
      data-testid={`event-card-${event.id}`}
    >
      {/* League Header with Date/Time */}
      <div 
        className="px-4 py-2 border-b border-cyan-900/30 flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {event.isLive && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
          <span className="text-cyan-400 text-sm">{leagueName}</span>
        </div>
        <div className="flex items-center gap-3">
          {event.isLive ? (
            <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded font-medium">
              <LiveClockBadge event={event} sportId={(event as any).sportId} />
            </span>
          ) : (
            <span className="text-yellow-400 text-xs font-medium bg-yellow-500/10 px-2 py-1 rounded">
              {formatDateTime(event.startTime)}
            </span>
          )}
          <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </div>

      {/* Match Info */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            {event.isLive ? (
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block bg-red-500 text-white text-xs px-2 py-1 rounded font-bold">
                  LIVE <LiveClockBadge event={event} sportId={(event as any).sportId} />
                </span>
                <span className="text-cyan-400 text-2xl font-bold">
                  {score.home} - {score.away}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <Clock size={14} className="text-yellow-400" />
                <span className="text-yellow-400 text-sm font-medium">
                  {formatDateTime(event.startTime)}
                </span>
              </div>
            )}
            <h3 className="text-white font-semibold text-lg mb-1">
              {event.homeTeam} vs {event.awayTeam}
            </h3>
            <p className="text-gray-500 text-sm">{leagueName}</p>
          </div>

          {/* Win Probability Bars */}
          <div className="flex gap-2">
            {hasRealOdds ? (
              <>
                {odds.home && (
                  <div
                    className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                      selectedOutcome === "home" ? "ring-2 ring-cyan-500" : "hover:bg-[#222222]"
                    }`}
                    onClick={(e) => handleOutcomeClick("home", e)}
                    data-testid={`odds-home-${event.id}`}
                  >
                    <div className="text-cyan-400 text-xs mb-1">Home</div>
                    <div className="text-cyan-400 text-2xl font-bold">{cardPcts.home}%</div>
                    <div className="w-full h-1.5 bg-[#333] rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${cardPcts.home}%` }} />
                    </div>
                    <div className="text-gray-500 text-xs mt-1">{event.homeTeam?.split(' ')[0]}</div>
                  </div>
                )}
                {odds.draw && (
                  <div
                    className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                      selectedOutcome === "draw" ? "ring-2 ring-yellow-500" : "hover:bg-[#222222]"
                    }`}
                    onClick={(e) => handleOutcomeClick("draw", e)}
                    data-testid={`odds-draw-${event.id}`}
                  >
                    <div className="text-yellow-400 text-xs mb-1">Draw</div>
                    <div className="text-yellow-400 text-2xl font-bold">{cardPcts.draw}%</div>
                    <div className="w-full h-1.5 bg-[#333] rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${cardPcts.draw}%` }} />
                    </div>
                  </div>
                )}
                {odds.away && (
                  <div
                    className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                      selectedOutcome === "away" ? "ring-2 ring-cyan-500" : "hover:bg-[#222222]"
                    }`}
                    onClick={(e) => handleOutcomeClick("away", e)}
                    data-testid={`odds-away-${event.id}`}
                  >
                    <div className="text-white text-xs mb-1">Away</div>
                    <div className="text-white text-2xl font-bold">{cardPcts.away}%</div>
                    <div className="w-full h-1.5 bg-[#333] rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-white/60 rounded-full" style={{ width: `${cardPcts.away}%` }} />
                    </div>
                    <div className="text-gray-500 text-xs mt-1">{event.awayTeam?.split(' ')[0]}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-[#1a1a1a] rounded-lg p-3 text-center">
                <div className="text-gray-500 text-xs mb-1">Win %</div>
                <div className="text-gray-400 text-sm font-medium">Not Available</div>
              </div>
            )}
          </div>
        </div>

        {/* Bet Button */}
        <div className="flex justify-center mb-4">
          {isBettingClosed ? (
            <div className="bg-red-900/30 border border-red-500/40 rounded-lg px-4 py-2 text-center">
              <span className="text-red-400 font-bold text-sm">Betting Closed</span>
              <span className="text-red-400/70 text-xs block">Betting closed</span>
            </div>
          ) : hasRealOdds ? (
            <>
              <button 
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-2 rounded-lg flex items-center gap-2 transition-all"
                onClick={handleBetClick}
                data-testid={`btn-bet-${event.id}`}
              >
                ✓ Bet
              </button>
              <button 
                className={`text-sm ml-4 transition-all ${selectedOutcome ? 'text-cyan-400' : 'text-gray-500 hover:text-cyan-400'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!selectedOutcome) {
                    toast({
                      title: "Select a team first",
                      description: "Click on Home, Draw, or Away odds above to select your pick",
                    });
                  } else {
                    handleBetClick(e);
                  }
                }}
                data-testid={`btn-select-team-${event.id}`}
              >
                {selectedOutcome ? '+ Add to slip' : '+ Select team'}
              </button>
            </>
          ) : (
            <div className="text-gray-500 text-sm py-2">
              Betting unavailable - no bookmaker coverage
            </div>
          )}
        </div>

        {/* Betting Panel (shown when outcome selected) */}
        {selectedOutcome && (
          <div className="border-t border-cyan-900/30 pt-4 mt-4">
            <div className="bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded inline-block mb-4 text-sm font-medium">
              Match Winner
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Pick Options */}
              <div>
                <div className="text-gray-400 text-sm mb-2">Pick</div>
                <div className="space-y-2">
                  {["home", "draw", "away"].map((outcome) => (
                    <button
                      key={outcome}
                      onClick={(e) => handleOutcomeClick(outcome, e)}
                      className={`w-full py-2 px-4 rounded-lg text-center transition-all ${
                        selectedOutcome === outcome
                          ? "bg-cyan-500 text-black font-bold"
                          : "bg-[#1a1a1a] text-gray-300 hover:bg-[#222222]"
                      }`}
                      data-testid={`pick-${outcome}-${event.id}`}
                    >
                      {outcome === "home" ? event.homeTeam : outcome === "away" ? event.awayTeam : "Draw"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stake & Potential Win */}
              <div>
                <div className="text-gray-400 text-sm mb-2">Stake (SUI)</div>
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-cyan-900/30 rounded-lg py-2 px-4 text-white mb-4"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`input-stake-${event.id}`}
                />
                
                <div className="text-gray-400 text-sm mb-2">Odds</div>
                <div className="bg-[#1a1a1a] rounded-lg py-2 px-4 text-cyan-400 mb-4">
                  {getOdds(selectedOutcome).toFixed(2)}
                </div>
                
                <div className="text-gray-400 text-sm mb-2">To Win</div>
                <div className="bg-cyan-500 rounded-lg py-3 px-4 text-black font-bold text-center">
                  {potentialWin} SUI
                </div>
              </div>
            </div>

            {/* Place Bet Button */}
            <button 
              className="w-full mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-3 rounded-lg transition-all"
              onClick={handleBetClick}
              data-testid={`btn-place-bet-${event.id}`}
            >
              Place Bet
            </button>
          </div>
        )}

        {/* Expanded Markets Section */}
        {isExpanded && (
          <div className="border-t border-cyan-900/30 pt-4 mt-4">
            <h4 className="text-cyan-400 font-semibold mb-3">All Markets</h4>
            
            {/* Over/Under Markets */}
            {odds.home && odds.away && (
              <div className="mb-4">
                <div className="text-gray-400 text-sm mb-2">Over/Under 2.5 Goals</div>
                <div className="flex gap-2">
                  <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                    <span className="text-xs text-gray-400">Over 2.5</span>
                    <div className="text-cyan-400 font-bold">{(odds.home * 0.9).toFixed(2)}</div>
                  </button>
                  <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                    <span className="text-xs text-gray-400">Under 2.5</span>
                    <div className="text-cyan-400 font-bold">{(odds.away * 1.1).toFixed(2)}</div>
                  </button>
                </div>
              </div>
            )}

            {/* Both Teams to Score */}
            <div className="mb-4">
              <div className="text-gray-400 text-sm mb-2">Both Teams to Score</div>
              <div className="flex gap-2">
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">Yes</span>
                  <div className="text-cyan-400 font-bold">{(1.85).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">No</span>
                  <div className="text-cyan-400 font-bold">{(1.95).toFixed(2)}</div>
                </button>
              </div>
            </div>

            {/* Double Chance */}
            <div className="mb-4">
              <div className="text-gray-400 text-sm mb-2">Double Chance</div>
              <div className="flex gap-2">
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">1X</span>
                  <div className="text-cyan-400 font-bold">{(1.35).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">12</span>
                  <div className="text-cyan-400 font-bold">{(1.25).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">X2</span>
                  <div className="text-cyan-400 font-bold">{(1.45).toFixed(2)}</div>
                </button>
              </div>
            </div>

            {/* Match Info */}
            <div className="bg-[#0a0a0a] rounded-lg p-3 mt-4">
              <div className="text-gray-400 text-xs mb-1">Match ID</div>
              <div className="text-white text-sm font-mono">{event.id}</div>
              <div className="text-gray-400 text-xs mt-2 mb-1">Start Time</div>
              <div className="text-white text-sm">{new Date(event.startTime).toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>

      {/* Odds movement chart trigger */}
      <div className="flex justify-end px-4 py-1 border-t border-cyan-900/20">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowOddsChart(v => !v); }}
          className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-cyan-400 transition-colors px-1 py-0.5"
          title="View odds movement chart"
        >
          <TrendingUp className="h-3 w-3" />
          <span>odds movement</span>
        </button>
      </div>
      {showOddsChart && (
        <div className="px-4 pb-3">
          <OddsHistoryChart
            eventId={typeof event.id === 'number' ? event.id.toString() : String(event.id)}
            homeTeam={event.homeTeam}
            awayTeam={event.awayTeam}
            onClose={() => setShowOddsChart(false)}
          />
        </div>
      )}
    </div>
  );
}