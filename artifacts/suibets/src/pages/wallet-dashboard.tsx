import { useState, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import { useBetting } from '@/context/BettingContext';
import { useToast } from '@/hooks/use-toast';
import SuiNSName from '@/components/SuiNSName';
import { useBetObjects } from '@/hooks/useBetObjects';
import { BetObjectList } from '@/components/betting/BetObjectCard';
import {
  Wallet, Copy, ExternalLink, TrendingUp, CheckCircle, XCircle,
  Clock, RefreshCw, Layers, ChevronRight, ArrowRight,
  Filter, Share2, Target, Zap, DollarSign, Users,
  ShieldCheck, Trophy, TrendingDown, FileText, BarChart3,
} from 'lucide-react';

interface Bet {
  id: string;
  eventName: string;
  selection: string;
  odds: number;
  stake: number;
  potentialWin: number;
  status: 'pending' | 'won' | 'lost' | 'paid_out' | 'cashed_out';
  placedAt: string;
  settledAt?: string;
  txHash?: string;
  currency?: 'SUI' | 'SBETS';
  result?: string;
  walrusBlobId?: string;
  giftedTo?: string | null;
  giftedFrom?: string | null;
  leagueName?: string;
  sportName?: string;
  matchDate?: string;
  parlayLegLost?: boolean;
  betLostLive?: boolean;
  betType?: string;
  prediction?: string;
  parlayLegs?: any[];
}

export default function WalletDashboardPage() {
  const { toast } = useToast();
  const currentAccount = useCurrentAccount();
  const { selectedBets } = useBetting();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { bets: onChainBets, isLoading: isLoadingOnChainBets } = useBetObjects();

  const walletAddress = currentAccount?.address;

  // ── bet history state ──────────────────────────────────────────────────────
  const [filter, setFilter] = useState<string>('all');

  const [isSyncing, setIsSyncing] = useState(false);
  const [sharedOfferId, setSharedOfferId] = useState<number | null>(null);
  const autoSyncDone = useRef(false);

  // ── queries ────────────────────────────────────────────────────────────────
  const { data: betsData, refetch: refetchBets, isLoading } = useQuery({
    queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const { data: balanceData, refetch: refetchBalance } = useQuery<{
    suiBalance: number;
    sbetsBalance: number;
    usdsuiBalance?: number;
    usdcBalance?: number;
    lbtcBalance?: number;
  }>({
    queryKey: [`/api/user/balance?userId=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: p2pActivity, isLoading: isP2PLoading, refetch: refetchP2P } = useQuery<{
    myOffers: any[];
    myMatches: any[];
    myParlayOffers: any[];
  }>({
    queryKey: ['/api/p2p/my', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return { myOffers: [], myMatches: [], myParlayOffers: [] };
      const r = await fetch(`/api/p2p/my?wallet=${walletAddress}`);
      if (!r.ok) return { myOffers: [], myMatches: [], myParlayOffers: [] };
      const data = await r.json();
      return {
        myOffers:       Array.isArray(data.myOffers)       ? data.myOffers       : [],
        myMatches:      Array.isArray(data.myMatches)      ? data.myMatches      : [],
        myParlayOffers: Array.isArray(data.myParlayOffers) ? data.myParlayOffers : [],
      };
    },
    enabled: !!walletAddress,
    refetchInterval: 30000,
    staleTime: 20000,
  });

  // ── derived ────────────────────────────────────────────────────────────────
  const userBets: Bet[] = Array.isArray(betsData) ? betsData : [];
  const openSportsbookBets = userBets.filter((b) => ['pending', 'matched', 'waiting_taker', 'open'].includes(b.status));
  const openP2POffers  = (p2pActivity?.myOffers  ?? []).filter((o: any) => o.status === 'open');
  const activeP2PBets  = (p2pActivity?.myMatches ?? []).filter((m: any) => !['settled', 'cancelled', 'won', 'lost', 'creator_won', 'taker_won', 'expired'].includes(m.status));
  const openBets = [...openSportsbookBets, ...openP2POffers, ...activeP2PBets];
  const histBets   = userBets.filter((b) => ['won', 'lost', 'paid_out', 'cashed_out', 'settled'].includes(b.status));
  const wonBets    = userBets.filter((b) => b.status === 'won' || b.status === 'paid_out').length;
  const lostBets   = userBets.filter((b) => b.status === 'lost').length;
  const totalStaked = userBets.reduce((acc, b) => acc + (b.stake || 0), 0);
  const totalWon   = userBets.filter((b) => b.status === 'won' || b.status === 'paid_out')
                              .reduce((acc, b) => acc + (b.potentialWin || 0), 0);
  const netPL      = totalWon - totalStaked;
  const winRate    = wonBets + lostBets > 0 ? ((wonBets / (wonBets + lostBets)) * 100).toFixed(0) : '—';

  const filteredBets = filter === 'all'
    ? userBets
    : filter === 'won'
      ? userBets.filter(b => b.status === 'won' || b.status === 'paid_out')
      : userBets.filter(b => b.status === filter);

  const stats = {
    total:       userBets.length,
    won:         wonBets,
    lost:        lostBets,
    pending:     userBets.filter(b => b.status === 'pending').length,
    totalStaked,
    totalWon,
  };

  // ── auto-sync ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (walletAddress && !isLoading && userBets.length === 0 && !isSyncing && !autoSyncDone.current) {
      autoSyncDone.current = true;
      handleSyncFromChain();
    }
  }, [walletAddress, isLoading, userBets.length, isSyncing]);

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchBets(), refetchBalance(), refetchP2P()]);
    toast({ title: 'Refreshed', description: 'Dashboard updated' });
    setIsRefreshing(false);
  };

  const handleSyncFromChain = async () => {
    if (!walletAddress || isSyncing) return;
    setIsSyncing(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch('/api/bets/sync-wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: walletAddress }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (res.ok) {
          toast({ title: data.recovered > 0 ? 'Bets Recovered!' : 'All Synced', description: data.message });
          await refetchBets();
        } else {
          toast({ title: 'Sync Failed', description: data.message || 'Could not sync bets', variant: 'destructive' });
        }
      } finally { clearTimeout(timeoutId); }
    } catch {
      toast({ title: 'Sync Error', description: 'Network error — please try again', variant: 'destructive' });
    }
    setIsSyncing(false);
  };

  const handleShareOffer = async (offer: any) => {
    let url = offer.shareToken
      ? `${window.location.origin}/p2p/c/${offer.shareToken}`
      : `${window.location.origin}/p2p/offer/${offer.id}`;
    try {
      const res = await fetch(`/api/p2p/offers/${offer.id}/share-link`);
      if (res.ok) { const d = await res.json(); if (d.shareUrl) url = d.shareUrl; }
    } catch (_) {}
    const predLbl = offer.prediction === 'home' ? offer.homeTeam : offer.prediction === 'away' ? offer.awayTeam : 'Draw';
    const tweetText = `🎯 P2P Bet: ${offer.homeTeam} vs ${offer.awayTeam}\n${predLbl} @ ${(offer.odds ?? 0).toFixed(2)}x odds\n💰 Stake: ${offer.creatorStake} ${offer.currency || 'SUI'}\n\nAccept my challenge 👇`;
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
      setSharedOfferId(offer.id);
      setTimeout(() => setSharedOfferId(null), 2500);
    };
    if (navigator.share) {
      navigator.share({ title: `P2P Bet: ${offer.eventName}`, text: tweetText, url }).catch(() => doCopy());
    } else {
      doCopy();
    }
  };

  const handleConnectWallet = () => {
    window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  };

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      toast({ title: 'Copied', description: 'Wallet address copied to clipboard' });
    }
  };

  const shortAddr = walletAddress ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}` : '';

  // ── helper renderers ────────────────────────────────────────────────────────
  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; bg: string; color: string }> = {
      matched:       { label: 'Matched',       bg: 'rgba(0,255,255,0.08)',  color: '#00ffff' },
      pending:       { label: 'Waiting taker', bg: 'rgba(251,191,36,0.08)', color: '#fbbf24' },
      waiting_taker: { label: 'Waiting taker', bg: 'rgba(251,191,36,0.08)', color: '#fbbf24' },
      open:          { label: 'Open',          bg: 'rgba(251,191,36,0.08)', color: '#fbbf24' },
      won:           { label: 'Won',           bg: 'rgba(74,222,128,0.12)', color: '#4ade80' },
      paid_out:      { label: 'Won',           bg: 'rgba(74,222,128,0.12)', color: '#4ade80' },
      cashed_out:    { label: 'Cashed out',    bg: 'rgba(74,222,128,0.12)', color: '#4ade80' },
      lost:          { label: 'Lost',          bg: 'rgba(248,113,113,0.1)', color: '#f87171' },
      settled:       { label: 'Settled',       bg: 'rgba(156,163,175,0.1)', color: '#9ca3af' },
    };
    const cfg = map[status] ?? { label: status, bg: 'rgba(156,163,175,0.08)', color: '#9ca3af' };
    return (
      <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg" style={{ background: cfg.bg, color: cfg.color }}>
        {cfg.label}
      </span>
    );
  };

  const resultAmount = (b: any) => {
    const won  = b.status === 'won' || b.status === 'paid_out' || b.status === 'cashed_out';
    const lost = b.status === 'lost';
    if (!won && !lost) return null;
    const amount   = won ? (b.potentialWin || 0) : (b.stake || 0);
    const currency = b.currency || 'SUI';
    return (
      <span className="text-sm font-black" style={{ color: won ? '#4ade80' : '#f87171' }}>
        {won ? '+' : '-'}{amount.toFixed(2)} {currency}
      </span>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'won':       return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'paid_out':  return <CheckCircle className="h-5 w-5 text-emerald-400" />;
      case 'cashed_out':return <DollarSign  className="h-5 w-5 text-orange-400" />;
      case 'lost':      return <XCircle     className="h-5 w-5 text-red-400" />;
      case 'pending':   return <Clock       className="h-5 w-5 text-yellow-400 animate-pulse" />;
      default:          return null;
    }
  };

  const tryParseJsonLegs = (str: string | undefined): any[] => {
    if (!str) return [];
    try {
      if (str.startsWith('[')) {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed) && parsed.length > 1) return parsed;
      }
    } catch {}
    return [];
  };

  const parsePipeLegs = (str: string): any[] => {
    return str.split(' | ').map(part => {
      const colonIdx = part.lastIndexOf(':');
      if (colonIdx > 0) {
        return { eventName: part.slice(0, colonIdx).trim(), selection: part.slice(colonIdx + 1).trim(), odds: 0 };
      }
      return { eventName: part.trim(), selection: part.trim(), odds: 0 };
    });
  };

  const isParlay = (bet: Bet): boolean => {
    if ((bet as any).betType === 'parlay') return true;
    if (tryParseJsonLegs(bet.eventName).length > 1) return true;
    if (tryParseJsonLegs(bet.selection).length > 1) return true;
    if (typeof bet.eventName === 'string' && bet.eventName.includes(' | ') && bet.eventName.split(' | ').length > 2) return true;
    if (typeof bet.selection === 'string' && bet.selection.includes(' | ') && bet.selection.split(' | ').length > 2) return true;
    return false;
  };

  const getParlaySelections = (bet: Bet): { eventName: string; selection: string; odds: number }[] => {
    let legs = tryParseJsonLegs(bet.eventName);
    if (legs.length === 0) legs = tryParseJsonLegs(bet.selection);
    if (legs.length === 0 && typeof bet.selection === 'string' && bet.selection.includes(' | ')) legs = parsePipeLegs(bet.selection);
    if (legs.length === 0 && typeof bet.eventName === 'string' && bet.eventName.includes(' | ')) legs = parsePipeLegs(bet.eventName);
    return legs;
  };

  const getBetDisplayName = (bet: Bet): string => {
    if (isParlay(bet)) {
      const selections = getParlaySelections(bet);
      return `Parlay (${selections.length} Legs)`;
    }
    return bet.eventName || 'Unknown Event';
  };

  const getSelectionDisplay = (bet: Bet): string => {
    if (isParlay(bet)) {
      const selections = getParlaySelections(bet);
      return selections.map(s => s.selection || (s as any).prediction || 'Pick').join(', ');
    }
    return bet.selection || 'Unknown';
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080a0f] text-white" data-testid="dashboard-page">

      {/* ── NAV ── */}
      <nav className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 z-50 bg-[#080a0f]/95 backdrop-blur-md">
        <Link href="/" data-testid="nav-logo">
          <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-8 w-auto" />
        </Link>
        <div className="flex items-center gap-3">
          {walletAddress && (
            <>
              <button
                onClick={handleSyncFromChain}
                disabled={isSyncing}
                className="text-xs px-3 py-1.5 rounded-xl font-medium disabled:opacity-50 flex items-center gap-1.5 transition-all"
                style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.15)', color: '#00ffff' }}
                data-testid="btn-sync-chain"
              >
                <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing…' : 'Sync chain'}
              </button>
              <button
                onClick={handleRefresh}
                className="p-2 rounded-xl transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
                data-testid="btn-refresh"
              >
                <RefreshCw size={15} className={`text-gray-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
          <Link
            href="/"
            className="text-sm font-medium px-4 py-2 rounded-xl transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: '#9ca3af' }}
          >
            ← Home
          </Link>
        </div>
      </nav>

      <div className="px-5 py-10" style={{ maxWidth: 720, margin: '0 auto' }}>

        {!walletAddress ? (
          /* ── NOT CONNECTED ── */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
              style={{ background: 'rgba(0,255,255,0.07)', border: '1px solid rgba(0,255,255,0.15)' }}>
              <Wallet size={28} className="text-cyan-400" />
            </div>
            <h2 className="text-2xl font-black text-white mb-3">Connect your wallet</h2>
            <p className="text-sm mb-8 max-w-xs" style={{ color: '#6b7280' }}>
              Connect your Sui wallet to view your balances, bets, and stats.
            </p>
            <button
              onClick={handleConnectWallet}
              className="flex items-center gap-2 font-black px-8 py-3 rounded-xl text-black text-sm transition-all hover:opacity-90"
              style={{ background: '#00ffff', boxShadow: '0 0 20px rgba(0,255,255,0.25)' }}
              data-testid="btn-connect-dashboard"
            >
              <Wallet size={16} />
              Connect wallet
            </button>
          </div>
        ) : (
          <>
            {/* ── HEADING ── */}
            <h1 className="text-5xl font-black mb-2">
              Dash<em className="not-italic text-cyan-400" style={{ fontStyle: 'italic' }}>board</em>
            </h1>

            {/* address pill */}
            <div className="inline-flex items-center gap-2 mb-8 rounded-xl px-3 py-2"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-mono" style={{ color: '#6b7280' }}>
                <SuiNSName address={walletAddress} className="text-cyan-400 font-bold" />
                {' '}{shortAddr}
              </span>
              <button onClick={copyAddress} className="text-gray-600 hover:text-gray-300 transition-colors" data-testid="btn-copy-address">
                <Copy size={12} />
              </button>
              <a href={`https://suiscan.xyz/mainnet/account/${walletAddress}`} target="_blank" rel="noopener noreferrer"
                className="text-gray-600 hover:text-gray-300 transition-colors" data-testid="btn-explorer">
                <ExternalLink size={12} />
              </a>
            </div>

            {/* ── STAT CARDS ── */}
            <div className="grid grid-cols-2 gap-3 mb-8">
              {[
                { value: openBets.length.toString(), label: 'Open positions', color: '#00ffff', bg: 'rgba(0,255,255,0.05)', border: 'rgba(0,255,255,0.12)' },
                { value: winRate === '—' ? '—' : `${winRate}%`, label: `Win rate · ${wonBets}W ${lostBets}L`, color: '#00ffff', bg: 'rgba(0,255,255,0.05)', border: 'rgba(0,255,255,0.12)' },
                { value: netPL >= 0 ? `+${netPL.toFixed(2)}` : netPL.toFixed(2), label: 'Net P/L (SUI)', color: netPL >= 0 ? '#4ade80' : '#f87171', bg: netPL >= 0 ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)', border: netPL >= 0 ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)' },
                { value: totalStaked.toFixed(2), label: 'Total staked ever', color: '#00ffff', bg: 'rgba(0,255,255,0.05)', border: 'rgba(0,255,255,0.12)' },
              ].map(({ value, label, color, bg, border }) => (
                <div key={label} className="rounded-2xl p-5" style={{ background: bg, border: `1px solid ${border}` }}>
                  <div className="text-3xl font-black mb-1" style={{ color }}>{value}</div>
                  <div className="text-xs" style={{ color: '#6b7280' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* ── BALANCES ── */}
            <div className="grid grid-cols-3 gap-3 mb-8">
              {[
                { label: 'SUI',    value: (balanceData?.suiBalance    || 0).toFixed(3), accent: '#00ffff', bg: 'rgba(0,255,255,0.04)',    border: 'rgba(0,255,255,0.1)' },
                { label: 'SBETS',  value: Math.round(balanceData?.sbetsBalance || 0).toLocaleString(), accent: '#a855f7', bg: 'rgba(168,85,247,0.04)', border: 'rgba(168,85,247,0.1)' },
                { label: 'USDSUI', value: (balanceData?.usdsuiBalance || 0).toFixed(2), accent: '#4ade80', bg: 'rgba(74,222,128,0.04)',   border: 'rgba(74,222,128,0.1)' },
                { label: 'USDC',   value: (balanceData?.usdcBalance   || 0).toFixed(2), accent: '#60a5fa', bg: 'rgba(96,165,250,0.04)',   border: 'rgba(96,165,250,0.1)' },
                { label: 'LBTC',   value: (balanceData?.lbtcBalance   || 0).toFixed(6), accent: '#f59e0b', bg: 'rgba(245,158,11,0.04)',   border: 'rgba(245,158,11,0.1)' },
              ].map(({ label, value, accent, bg, border }) => (
                <div key={label} className="rounded-2xl p-4" style={{ background: bg, border: `1px solid ${border}` }}>
                  <div className="text-[11px] font-black uppercase tracking-wider mb-1" style={{ color: accent }}>{label}</div>
                  <div className="text-lg font-black text-white">{value}</div>
                </div>
              ))}
            </div>

            {/* ══════════════════════════════════════════════════════════════
                ── FULL BET HISTORY (merged from My Bets page) ──
                ══════════════════════════════════════════════════════════════ */}

            {/* Section header + controls */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-white text-lg">My Bets</h2>
              <div className="flex items-center gap-2">
                {walletAddress && (
                  <button
                    onClick={handleSyncFromChain}
                    disabled={isSyncing}
                    className="text-xs px-3 py-1.5 rounded-xl font-medium disabled:opacity-50 flex items-center gap-1.5 transition-all"
                    style={{ background: 'rgba(0,255,255,0.06)', border: '1px solid rgba(0,255,255,0.12)', color: '#00ffff' }}
                  >
                    <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
                    {isSyncing ? 'Syncing…' : 'Sync'}
                  </button>
                )}
                <div className="flex items-center gap-1.5 text-xs rounded-xl px-2 py-1.5"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <Filter size={11} className="text-gray-500" />
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="bg-transparent text-gray-300 focus:outline-none text-xs"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── P2P ── */}
            <div className="mb-8 space-y-6">
                {/* P2P stats */}
                {p2pActivity && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'My Offers',      value: p2pActivity.myOffers?.length ?? 0,      color: '#a855f7' },
                      { label: 'Accepted Bets',  value: p2pActivity.myMatches?.length ?? 0,     color: '#00ffff' },
                      { label: 'Parlays',        value: p2pActivity.myParlayOffers?.length ?? 0, color: '#fbbf24' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-xl p-4 text-center"
                        style={{ background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.12)' }}>
                        <div className="text-2xl font-black" style={{ color }}>{value}</div>
                        <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: '#4b5563' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {isP2PLoading ? (
                  <div className="py-12 text-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <RefreshCw className="h-8 w-8 mx-auto mb-3 animate-spin text-purple-400" />
                    <p className="text-sm" style={{ color: '#6b7280' }}>Loading P2P activity…</p>
                  </div>
                ) : (
                  <>
                    {/* Offers I created */}
                    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(168,85,247,0.12)' }}>
                      <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: 'rgba(168,85,247,0.1)' }}>
                        <ShieldCheck className="h-4 w-4 text-purple-400" />
                        <span className="font-bold text-white text-sm">My Offers</span>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
                          {p2pActivity?.myOffers?.length ?? 0}
                        </span>
                      </div>
                      <div className="p-4">
                        {!p2pActivity?.myOffers?.length ? (
                          <div className="text-center py-8">
                            <p className="text-sm mb-3" style={{ color: '#4b5563' }}>No offers posted yet</p>
                            <a href="/p2p" className="inline-block px-4 py-2 rounded-xl text-sm font-bold transition-all"
                              style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', color: '#a855f7' }}>
                              Post an Offer
                            </a>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {p2pActivity!.myOffers.map((offer: any) => {
                              const isWon  = offer.winner === 'creator';
                              const isLost = offer.winner === 'taker';
                              return (
                                <div key={offer.id}
                                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-xl border gap-3 transition-colors"
                                  style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${isWon ? 'rgba(74,222,128,0.2)' : isLost ? 'rgba(248,113,113,0.15)' : 'rgba(168,85,247,0.15)'}` }}>
                                  <div className="flex items-start gap-3 min-w-0">
                                    <div className={`p-2 rounded-xl flex-shrink-0 ${isWon ? 'bg-green-500/20' : isLost ? 'bg-red-500/20' : 'bg-purple-500/10'}`}>
                                      {isWon ? <Trophy className="h-4 w-4 text-green-400" /> : isLost ? <XCircle className="h-4 w-4 text-red-400" /> : <ShieldCheck className="h-4 w-4 text-purple-400" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${offer.status === 'filled' ? 'text-green-400 bg-green-500/10' : offer.status === 'settled' ? 'text-emerald-400 bg-emerald-500/10' : offer.status === 'cancelled' || offer.status === 'expired' ? 'text-red-400 bg-red-500/10' : 'text-yellow-400 bg-yellow-500/10'}`}>{offer.status}</span>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>{offer.currency || 'SUI'}</span>
                                        {isWon && <span className="text-[10px] font-black px-2 py-0.5 rounded" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>WON ✓</span>}
                                        {isLost && <span className="text-[10px] font-black px-2 py-0.5 rounded" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>LOST</span>}
                                      </div>
                                      <p className="text-white font-bold text-sm truncate">{offer.eventName || 'Unknown Event'}</p>
                                      <p className="text-xs capitalize mt-0.5" style={{ color: '#6b7280' }}>{offer.prediction} — {offer.homeTeam} vs {offer.awayTeam}</p>
                                      {offer.matchDate && <p className="text-[10px] mt-0.5" style={{ color: '#374151' }}>{new Date(offer.matchDate).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</p>}
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                                    <div className="font-black text-white text-sm">{offer.creatorStake} {offer.currency || 'SUI'}</div>
                                    <div className="text-xs" style={{ color: '#6b7280' }}>@ <span className="text-green-400 font-bold">{(offer.odds ?? 0).toFixed(2)}x</span></div>
                                    {offer.onchainOfferId && (
                                      <a href={`https://suiscan.xyz/mainnet/object/${offer.onchainOfferId}`} target="_blank" rel="noreferrer"
                                        className="text-[10px] flex items-center gap-1" style={{ color: '#374151' }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.color = '#00ffff'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.color = '#374151'}>
                                        On-chain <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                    {offer.matchWalrusBlobId && !String(offer.matchWalrusBlobId).startsWith('local_') ? (
                                      <a href={`/walrus-receipt/${offer.matchWalrusBlobId}`}
                                        className="text-[10px] flex items-center gap-1 font-bold"
                                        style={{ color: '#a855f7' }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.color = '#c084fc'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.color = '#a855f7'}>
                                        🐋 Receipt
                                      </a>
                                    ) : (offer.matchHasLocalReceipt || String(offer.matchWalrusBlobId ?? '').startsWith('local_')) ? (
                                      <a
                                        href={offer.matchWalrusBlobId ? `/walrus-receipt/${offer.matchWalrusBlobId}` : '#'}
                                        className="text-[10px] flex items-center gap-1"
                                        style={{ color: '#a855f7' }}
                                        title="Receipt stored locally — uploading to Walrus in background"
                                        onMouseEnter={(e: any) => e.currentTarget.style.color = '#c084fc'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.color = '#a855f7'}
                                      >
                                        🐋 Receipt ↗
                                      </a>
                                    ) : null}
                                    {offer.status === 'open' && (
                                      <button
                                        onClick={() => handleShareOffer(offer)}
                                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all"
                                        style={sharedOfferId === offer.id
                                          ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80' }
                                          : { background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}
                                      >
                                        {sharedOfferId === offer.id ? <><Copy className="h-3 w-3" /> Copied!</> : <><Share2 className="h-3 w-3" /> Share</>}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bets I accepted (taker) */}
                    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(0,255,255,0.1)' }}>
                      <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: 'rgba(0,255,255,0.08)' }}>
                        <Users className="h-4 w-4 text-cyan-400" />
                        <span className="font-bold text-white text-sm">Bets I Accepted</span>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(0,255,255,0.1)', color: '#00ffff' }}>
                          {p2pActivity?.myMatches?.length ?? 0}
                        </span>
                      </div>
                      <div className="p-4">
                        {!p2pActivity?.myMatches?.length ? (
                          <div className="text-center py-8">
                            <p className="text-sm mb-3" style={{ color: '#4b5563' }}>No bets accepted yet</p>
                            <a href="/p2p" className="inline-block px-4 py-2 rounded-xl text-sm font-bold transition-all"
                              style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.15)', color: '#00ffff' }}>
                              Browse Offers
                            </a>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {p2pActivity!.myMatches.map((match: any) => {
                              const isWon    = match.winner === 'taker';
                              const isLost   = match.winner === 'creator';
                              const isSettled = !!match.winner;
                              return (
                                <div key={match.id}
                                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-xl border gap-3"
                                  style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${isWon ? 'rgba(74,222,128,0.2)' : isLost ? 'rgba(248,113,113,0.15)' : 'rgba(0,255,255,0.1)'}` }}>
                                  <div className="flex items-start gap-3 min-w-0">
                                    <div className={`p-2 rounded-xl flex-shrink-0 ${isWon ? 'bg-green-500/20' : isLost ? 'bg-red-500/20' : 'bg-cyan-500/10'}`}>
                                      {isWon ? <Trophy className="h-4 w-4 text-green-400" /> : isLost ? <XCircle className="h-4 w-4 text-red-400" /> : <Clock className="h-4 w-4 text-yellow-400 animate-pulse" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${isSettled ? (isWon ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10') : 'text-yellow-400 bg-yellow-500/10'}`}>
                                          {isWon ? 'WON' : isLost ? 'LOST' : match.status || 'active'}
                                        </span>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(0,255,255,0.08)', color: '#00ffff' }}>Taker</span>
                                        {(match.currency || match.offer?.currency) && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: '#9ca3af' }}>{match.currency || match.offer?.currency}</span>}
                                      </div>
                                      <p className="text-white font-bold text-sm truncate">{match.eventName || match.offer?.eventName || 'P2P Bet'}</p>
                                      <p className="text-xs capitalize mt-0.5" style={{ color: '#6b7280' }}>{match.prediction || match.offer?.prediction} — {match.homeTeam || match.offer?.homeTeam} vs {match.awayTeam || match.offer?.awayTeam}</p>
                                      {match.matchDate && <p className="text-[10px] mt-0.5" style={{ color: '#374151' }}>{new Date(match.matchDate).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</p>}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <div className="font-black text-white text-sm">{match.stake} {match.currency || match.offer?.currency || 'SUI'}</div>
                                    <div className="text-xs mt-0.5" style={{ color: '#6b7280' }}>@ <span className="text-green-400 font-bold">{((match.offer?.odds) ?? 0).toFixed(2)}x</span></div>
                                    {isWon && <div className="text-green-400 text-sm font-black mt-1">+{(match.actualPayout ?? match.potentialPayout ?? 0).toFixed(3)} {match.currency || match.offer?.currency || 'SUI'}</div>}
                                    {match.takerTxHash && (
                                      <a href={`https://suiscan.xyz/mainnet/tx/${match.takerTxHash}`} target="_blank" rel="noreferrer"
                                        className="text-[10px] flex items-center gap-1 justify-end mt-1" style={{ color: '#374151' }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.color = '#00ffff'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.color = '#374151'}>
                                        TX <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                    {match.walrusBlobId && !String(match.walrusBlobId).startsWith('local_') ? (
                                      <a href={`/walrus-receipt/${match.walrusBlobId}`}
                                        className="text-[10px] flex items-center gap-1 justify-end font-bold"
                                        style={{ color: '#a855f7' }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.color = '#c084fc'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.color = '#a855f7'}>
                                        🐋 Receipt
                                      </a>
                                    ) : String(match.walrusBlobId ?? '').startsWith('local_') || match.walrusReceiptJson ? (
                                      <span className="text-[10px] text-right" style={{ color: '#6b7280' }} title="Receipt pending Walrus upload — retrying automatically">
                                        🐋 Pending…
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* P2P Parlays */}
                    {(p2pActivity?.myParlayOffers?.length ?? 0) > 0 && (
                      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(168,85,247,0.12)' }}>
                        <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: 'rgba(168,85,247,0.1)' }}>
                          <Zap className="h-4 w-4 text-purple-400" />
                          <span className="font-bold text-white text-sm">P2P Parlays</span>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
                            {p2pActivity!.myParlayOffers.length}
                          </span>
                        </div>
                        <div className="p-4 space-y-3">
                          {p2pActivity!.myParlayOffers.map((parlay: any) => {
                            const isCreator = parlay.creatorWallet?.toLowerCase() === walletAddress?.toLowerCase();
                            const isWon  = parlay.winner === (isCreator ? 'creator' : 'taker');
                            const isLost = parlay.winner && !isWon;
                            return (
                              <div key={parlay.id}
                                className="p-4 rounded-xl border"
                                style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${isWon ? 'rgba(74,222,128,0.2)' : isLost ? 'rgba(248,113,113,0.15)' : 'rgba(168,85,247,0.15)'}` }}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${isCreator ? 'text-purple-400 bg-purple-500/15' : 'text-cyan-400 bg-cyan-500/10'}`}>{isCreator ? 'Creator' : 'Taker'}</span>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${isWon ? 'text-green-400 bg-green-500/10' : isLost ? 'text-red-400 bg-red-500/10' : 'text-yellow-400 bg-yellow-500/10'}`}>{isWon ? 'WON' : isLost ? 'LOST' : parlay.status}</span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: '#6b7280' }}>{parlay.legCount} legs</span>
                                  </div>
                                  <span className="font-black text-white text-sm">{parlay.creatorStake} {parlay.currency || 'SUI'}</span>
                                </div>
                                <p className="text-xs" style={{ color: '#6b7280' }}>
                                  Total odds: <span className="text-green-400 font-bold">{(parlay.totalOdds ?? 0).toFixed(2)}x</span>
                                  {' · '}To win: <span className="text-cyan-400 font-bold">{((parlay.creatorStake ?? 0) * (parlay.totalOdds ?? 1)).toFixed(3)} {parlay.currency || 'SUI'}</span>
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="text-center">
                      <a href="/p2p" className="inline-flex items-center gap-2 text-sm font-bold transition-all"
                        style={{ color: '#a855f7' }}
                        onMouseEnter={(e: any) => e.currentTarget.style.color = '#c084fc'}
                        onMouseLeave={(e: any) => e.currentTarget.style.color = '#a855f7'}>
                        <Users className="h-4 w-4" />
                        View full P2P order book
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </>
                )}
            </div>

            {/* ── ON-CHAIN OBJECTS ── */}
            {(() => {
              // Merge: live owned objects (pending bets still in wallet) + DB bets with txHash (settled/consumed objects)
              const dbOnChainBets = userBets.filter((b: any) => b.txHash || b.betObjectId);
              const liveObjectIds = new Set(onChainBets.map(o => o.objectId));
              // Show live first (pending), then DB-tracked that aren't already shown live
              const allOnChainBets = [
                ...onChainBets,
                ...dbOnChainBets.filter((b: any) => !b.betObjectId || !liveObjectIds.has(b.betObjectId)),
              ];
              if (allOnChainBets.length === 0 && !isLoadingOnChainBets && !isLoading) return null;
              return (
                <div className="rounded-2xl p-5 mb-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="font-bold text-white text-sm">On-chain bet objects</div>
                      <div className="text-[11px] mt-0.5" style={{ color: '#4b5563' }}>
                        {allOnChainBets.length} confirmed on-chain {allOnChainBets.length === 1 ? 'bet' : 'bets'}
                      </div>
                    </div>
                    <BarChart3 className="h-4 w-4" style={{ color: '#374151' }} />
                  </div>
                  {(isLoadingOnChainBets || isLoading) && allOnChainBets.length === 0 ? (
                    <div className="text-center py-4 text-gray-600 text-xs">Loading…</div>
                  ) : (
                    <div className="space-y-2">
                      {/* Live on-chain objects (pending, still owned) */}
                      {onChainBets.map(bet => (
                        <div key={bet.objectId}
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                            bet.statusLabel === 'Won' ? 'bg-emerald-500/10 border-emerald-500/30' :
                            bet.statusLabel === 'Lost' ? 'bg-red-500/10 border-red-500/30' :
                            bet.statusLabel === 'Void' ? 'bg-gray-500/10 border-gray-500/30' :
                            'bg-cyan-500/10 border-cyan-500/30'
                          }`}>
                          <div className="flex items-center gap-2 min-w-0">
                            {bet.statusLabel === 'Won' ? <Trophy size={13} className="text-emerald-400 shrink-0" /> :
                             bet.statusLabel === 'Lost' ? <XCircle size={13} className="text-red-400 shrink-0" /> :
                             <Clock size={13} className="text-cyan-400 shrink-0" />}
                            <span className="text-white truncate text-xs">{bet.prediction || bet.eventId || bet.objectId.slice(0, 12) + '…'}</span>
                            <span className="text-[10px] px-1.5 py-px rounded shrink-0" style={{ background: 'rgba(0,255,255,0.08)', color: '#00ffff' }}>LIVE</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-gray-400 text-xs">{bet.oddsDisplay}</span>
                            <span className={`font-semibold text-xs ${bet.statusColor}`}>{bet.stakeDisplay}</span>
                            <a href={`https://suiscan.xyz/mainnet/object/${bet.objectId}`} target="_blank" rel="noreferrer"
                              className="text-gray-500 hover:text-cyan-400 transition-colors">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      ))}
                      {/* DB-tracked bets with txHash (settled objects, no longer owned) */}
                      {dbOnChainBets
                        .filter((b: any) => !b.betObjectId || !liveObjectIds.has(b.betObjectId))
                        .map((b: any) => {
                          const isWon  = b.status === 'won' || b.status === 'paid_out';
                          const isLost = b.status === 'lost';
                          const isPending = ['pending', 'open', 'matched', 'waiting_taker'].includes(b.status);
                          return (
                            <div key={b.id}
                              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                                isWon ? 'bg-emerald-500/10 border-emerald-500/30' :
                                isLost ? 'bg-red-500/10 border-red-500/30' :
                                isPending ? 'bg-cyan-500/10 border-cyan-500/30' :
                                'bg-gray-500/10 border-gray-500/30'
                              }`}>
                              <div className="flex items-center gap-2 min-w-0">
                                {isWon ? <Trophy size={13} className="text-emerald-400 shrink-0" /> :
                                 isLost ? <XCircle size={13} className="text-red-400 shrink-0" /> :
                                 <Clock size={13} className={isPending ? 'text-cyan-400 shrink-0' : 'text-gray-400 shrink-0'} />}
                                <span className="text-white truncate text-xs">{b.eventName || b.selection || '—'}</span>
                                <span className="text-[10px] font-bold uppercase px-1.5 py-px rounded shrink-0"
                                  style={{ background: isWon ? 'rgba(74,222,128,0.1)' : isLost ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)', color: isWon ? '#4ade80' : isLost ? '#f87171' : '#9ca3af' }}>
                                  {isWon ? 'Won' : isLost ? 'Lost' : b.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-gray-400 text-xs">{(b.odds ?? 0).toFixed(2)}x</span>
                                <span className={`font-semibold text-xs ${isWon ? 'text-emerald-400' : isLost ? 'text-red-400' : 'text-cyan-400'}`}>
                                  {b.stake} {b.currency || 'SUI'}
                                </span>
                                {b.txHash && (
                                  <a href={`https://suiscan.xyz/mainnet/tx/${b.txHash}`} target="_blank" rel="noreferrer"
                                    className="text-gray-500 hover:text-cyan-400 transition-colors" title="View transaction">
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                                {b.betObjectId && !liveObjectIds.has(b.betObjectId) && (
                                  <a href={`https://suiscan.xyz/mainnet/object/${b.betObjectId}`} target="_blank" rel="noreferrer"
                                    className="text-gray-500 hover:text-purple-400 transition-colors" title="View bet object">
                                    <ExternalLink className="h-3 w-3" />
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
            })()}

            {/* ── QUICK ACTIONS ── */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {[
                { href: '/p2p',         label: 'P2P Market',  sub: 'Browse & post offers',  icon: '⚔️', accent: '#00ffff' },
                { href: '/parlay',      label: 'Parlays',     sub: 'Multi-leg bets',        icon: '🎯', accent: '#f97316' },
                { href: '/leaderboard', label: 'Leaderboard', sub: 'Top bettors this week', icon: '🥇', accent: '#fbbf24' },
                { href: '/tokenomics',  label: 'Revenue',     sub: 'Earn from platform fees',icon: '◈', accent: '#a855f7' },
              ].map(({ href, label, sub, icon, accent }) => (
                <Link key={href} href={href}
                  className="flex items-center gap-3 p-4 rounded-2xl transition-all group"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                  onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                    style={{ background: `${accent}12`, border: `1px solid ${accent}20` }}>
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white text-sm">{label}</div>
                    <div className="text-[11px] mt-0.5 truncate" style={{ color: '#4b5563' }}>{sub}</div>
                  </div>
                  <ChevronRight size={14} className="text-gray-700 flex-shrink-0 group-hover:text-gray-400 transition-colors" />
                </Link>
              ))}
            </div>

            {/* ── ACTIVE BET SLIP ── */}
            {selectedBets.length > 0 && (
              <div className="rounded-2xl p-5 mb-6" style={{ background: 'rgba(0,255,255,0.03)', border: '1px solid rgba(0,255,255,0.12)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Layers size={16} className="text-cyan-400" />
                  <span className="font-bold text-white text-sm">Active bet slip</span>
                  <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-cyan-400 text-black ml-1">{selectedBets.length}</span>
                </div>
                <div className="space-y-2 mb-4">
                  {selectedBets.slice(0, 3).map((bet: any, i: number) => (
                    <div key={bet.id || i} className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                      style={{ background: 'rgba(0,0,0,0.3)' }}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white truncate">{bet.eventName || 'Unknown Event'}</div>
                        <div className="text-xs text-cyan-400">{bet.selectionName || 'Unknown Selection'}</div>
                      </div>
                      <span className="text-green-400 font-black text-sm ml-3 flex-shrink-0">{(bet.odds || 1.5).toFixed(2)}×</span>
                    </div>
                  ))}
                  {selectedBets.length > 3 && (
                    <p className="text-xs text-center pt-1" style={{ color: '#4b5563' }}>+{selectedBets.length - 3} more selections</p>
                  )}
                </div>
                <Link href="/parlay">
                  <button className="w-full py-3 rounded-xl font-black text-black text-sm transition-all hover:opacity-90"
                    style={{ background: '#00ffff' }} data-testid="btn-view-slip">
                    View full bet slip
                  </button>
                </Link>
              </div>
            )}

            {/* ── MORE LINKS ── */}
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="font-bold text-white text-sm mb-3">More</div>
              <div className="space-y-1">
                {[
                  { href: '/tokenomics', label: 'Tokenomics',   sub: 'Earn from platform fees' },
                  { href: '/settlement', label: 'Settlement',   sub: 'Check bet outcomes' },
                  { href: '/whitepaper', label: 'Whitepaper', sub: 'Protocol docs' },
                ].map(({ href, label, sub }) => (
                  <Link key={href} href={href}
                    className="flex items-center justify-between py-2.5 px-3 rounded-xl transition-all"
                    style={{ color: '#9ca3af' }}
                    onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={(e: any) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = '#9ca3af'; }}>
                    <div>
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-[11px]" style={{ color: '#4b5563' }}>{sub}</div>
                    </div>
                    <ChevronRight size={14} className="text-gray-700 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>

            <div className="h-20" />
          </>
        )}
      </div>
    </div>
  );
}
