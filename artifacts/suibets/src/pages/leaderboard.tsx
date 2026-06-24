import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Trophy, Medal, TrendingUp, Calendar, Coins, ArrowLeft, Star, Crown, Flame, Award, ChevronUp, ChevronDown, GitMerge, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSuiNSNames, formatAddress } from '@/hooks/useSuiNSName';

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  suiProfit: number;
  sbetsProfit: number;
  usdsuiProfit: number;
  usdcProfit: number;
  lbtcProfit: number;
  totalProfitUsd: number;
  totalBets: number;
  suiBets: number;
  sbetsBets: number;
  usdssuiBets: number;
  usdcBets: number;
  lbtcBets: number;
  winRate: number;
  loyaltyPoints?: number;
  loyaltyTier?: string;
}

interface P2PEntry {
  walletAddress: string;
  totalVolume: number;
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  winRate: number | null;
  totalNetPnl: number;
  tier: { name: string; color: string };
}

function PodiumCard({ entry, rank, name }: { entry: LeaderboardEntry; rank: number; name?: string }) {
  const heights: Record<number, string> = { 1: 'h-36', 2: 'h-28', 3: 'h-24' };
  const colors: Record<number, { bg: string; border: string; glow: string; icon: string }> = {
    1: { bg: 'from-yellow-500/20 via-yellow-600/10 to-transparent', border: 'border-yellow-500/40', glow: 'shadow-[0_0_30px_rgba(234,179,8,0.2)]', icon: 'text-yellow-400' },
    2: { bg: 'from-gray-300/15 via-gray-400/5 to-transparent', border: 'border-gray-400/30', glow: 'shadow-[0_0_20px_rgba(156,163,175,0.15)]', icon: 'text-gray-300' },
    3: { bg: 'from-amber-600/15 via-amber-700/5 to-transparent', border: 'border-amber-600/30', glow: 'shadow-[0_0_20px_rgba(180,83,9,0.15)]', icon: 'text-amber-500' },
  };
  const c = colors[rank];
  const order = rank === 1 ? 'order-2' : rank === 2 ? 'order-1' : 'order-3';

  return (
    <div className={`flex-1 flex flex-col items-center ${order}`} data-testid={`podium-${rank}`}>
      <div className="relative mb-2">
        {rank === 1 ? <Crown className={`h-8 w-8 ${c.icon} drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]`} /> :
         rank === 2 ? <Medal className={`h-7 w-7 ${c.icon}`} /> :
         <Award className={`h-7 w-7 ${c.icon}`} />}
      </div>
      <div className="text-white text-sm font-bold truncate max-w-[120px] text-center" title={entry.wallet}>
        {name || formatAddress(entry.wallet)}
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{entry.winRate.toFixed(0)}% WR</div>
      <div className={`mt-2 w-full ${heights[rank]} bg-gradient-to-t ${c.bg} rounded-t-xl border ${c.border} ${c.glow} flex flex-col items-center justify-center p-2`}>
        <span className="text-2xl font-black text-white">#{rank}</span>
        {entry.suiProfit !== 0 && (
          <span className={`text-xs font-bold mt-1 ${entry.suiProfit >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
            {entry.suiProfit >= 0 ? '+' : ''}{entry.suiProfit.toFixed(2)} SUI
          </span>
        )}
        {entry.sbetsProfit !== 0 && (
          <span className={`text-xs font-bold ${entry.sbetsProfit >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
            {entry.sbetsProfit >= 0 ? '+' : ''}{entry.sbetsProfit >= 1000000
              ? `${(entry.sbetsProfit / 1000000).toFixed(1)}M`
              : entry.sbetsProfit.toLocaleString()} SBETS
          </span>
        )}
        {(entry.usdsuiProfit || 0) !== 0 && (
          <span className={`text-xs font-bold ${(entry.usdsuiProfit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(entry.usdsuiProfit || 0) >= 0 ? '+' : ''}{(entry.usdsuiProfit || 0).toFixed(2)} $USDsui
          </span>
        )}
        {(entry.usdcProfit || 0) !== 0 && (
          <span className={`text-xs font-bold ${(entry.usdcProfit || 0) >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
            {(entry.usdcProfit || 0) >= 0 ? '+' : ''}{(entry.usdcProfit || 0).toFixed(2)} USDC
          </span>
        )}
        {(entry.lbtcProfit || 0) !== 0 && (
          <span className={`text-xs font-bold ${(entry.lbtcProfit || 0) >= 0 ? 'text-orange-400' : 'text-red-400'}`}>
            {(entry.lbtcProfit || 0) >= 0 ? '+' : ''}{(entry.lbtcProfit || 0).toFixed(6)} LBTC
          </span>
        )}
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: { name: string; color: string } }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-bold border"
      style={{ color: tier.color, borderColor: `${tier.color}50`, backgroundColor: `${tier.color}15` }}
    >
      {tier.name}
    </span>
  );
}

function fmtVol(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(3);
}

export default function LeaderboardPage() {
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'allTime' | 'p2p'>('weekly');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ leaderboard: LeaderboardEntry[] }>({
    queryKey: ['/api/leaderboard', period],
    queryFn: async () => {
      const res = await fetch(`/api/leaderboard?period=${period}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch leaderboard');
      return res.json();
    },
    enabled: period !== 'p2p',
  });

  const { data: p2pData, isLoading: isLoadingP2P } = useQuery<P2PEntry[]>({
    queryKey: ['/api/p2p/leaderboard'],
    queryFn: async () => {
      const res = await fetch('/api/p2p/leaderboard?limit=50');
      if (!res.ok) throw new Error('Failed to fetch P2P leaderboard');
      return res.json();
    },
    enabled: period === 'p2p',
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation('/');
    }
  };

  const walletAddresses = useMemo(() => 
    (data?.leaderboard || []).map(e => e.wallet).filter(Boolean),
    [data?.leaderboard]
  );
  const p2pWallets = useMemo(() =>
    (p2pData || []).map(e => e.walletAddress).filter(Boolean),
    [p2pData]
  );
  const names = useSuiNSNames([...walletAddresses, ...p2pWallets]);

  const top3 = useMemo(() => (data?.leaderboard || []).slice(0, 3), [data?.leaderboard]);
  const rest = useMemo(() => (data?.leaderboard || []).slice(3), [data?.leaderboard]);

  const getRankBg = (rank: number) => {
    if (rank <= 5) return 'bg-gradient-to-r from-cyan-500/8 to-transparent border-cyan-900/25 hover:border-cyan-500/40';
    if (rank <= 10) return 'bg-[#0a0a0a]/80 border-cyan-900/15 hover:border-cyan-500/25';
    return 'bg-[#060606] border-cyan-900/10 hover:border-cyan-900/25';
  };

  const getP2PRankBg = (idx: number) => {
    if (idx < 3) return 'bg-gradient-to-r from-emerald-500/8 to-transparent border-emerald-900/25 hover:border-emerald-500/40';
    if (idx < 10) return 'bg-[#0a0a0a]/80 border-emerald-900/15 hover:border-emerald-500/25';
    return 'bg-[#060606] border-emerald-900/10 hover:border-emerald-900/25';
  };

  return (
    <div className="min-h-screen bg-black p-3 md:p-8 relative overflow-hidden" data-testid="leaderboard-page">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-20 right-0 w-[300px] h-[300px] bg-yellow-500/3 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-4xl mx-auto relative z-10">
        <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
          <button 
            onClick={handleBack}
            className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
            data-testid="btn-back"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="p-2.5 md:p-3 bg-gradient-to-br from-yellow-400/20 to-yellow-600/20 rounded-xl border border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.2)]">
            <Trophy className="h-6 w-6 md:h-8 md:w-8 text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Leaderboard</h1>
            <p className="text-gray-400 text-sm font-medium">
              {period === 'p2p' ? 'Top P2P traders by volume & PnL' : 'Top winners by profit'}
            </p>
          </div>
        </div>

        <div className="flex gap-1.5 md:gap-2 mb-6 md:mb-8 p-1 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 w-fit flex-wrap">
          {(['weekly', 'monthly', 'allTime', 'p2p'] as const).map((p) => (
            <Button
              key={p}
              variant="ghost"
              onClick={() => { setPeriod(p); setExpandedRow(null); }}
              className={`gap-1.5 rounded-lg transition-all text-xs md:text-sm px-3 md:px-4 ${
                period === p
                  ? p === 'p2p'
                    ? 'bg-emerald-500 text-black font-bold shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:bg-emerald-400'
                    : 'bg-cyan-500 text-black font-bold shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:bg-cyan-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              data-testid={`btn-period-${p === 'allTime' ? 'alltime' : p}`}
            >
              {p === 'p2p' ? <GitMerge className="h-3.5 w-3.5" /> :
               p === 'allTime' ? <TrendingUp className="h-3.5 w-3.5" /> :
               <Calendar className="h-3.5 w-3.5" />}
              {p === 'weekly' ? 'Week' : p === 'monthly' ? 'Month' : p === 'allTime' ? 'All Time' : 'P2P'}
            </Button>
          ))}
        </div>

        {/* P2P Leaderboard */}
        {period === 'p2p' && (
          <>
            {isLoadingP2P ? (
              <div className="space-y-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full bg-white/5 rounded-xl" />
                ))}
              </div>
            ) : p2pData && p2pData.length > 0 ? (
              <>
                {/* P2P stats banner */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="bg-gradient-to-r from-emerald-900/30 to-transparent rounded-xl border border-emerald-900/30 p-3 text-center">
                    <p className="text-gray-400 text-xs mb-1">Traders</p>
                    <p className="text-xl font-bold text-emerald-400">{p2pData.length}</p>
                  </div>
                  <div className="bg-gradient-to-r from-emerald-900/30 to-transparent rounded-xl border border-emerald-900/30 p-3 text-center">
                    <p className="text-gray-400 text-xs mb-1">Total Volume</p>
                    <p className="text-xl font-bold text-emerald-400">
                      {fmtVol(p2pData.reduce((s, e) => s + e.totalVolume, 0))} SBETS
                    </p>
                  </div>
                  <div className="bg-gradient-to-r from-emerald-900/30 to-transparent rounded-xl border border-emerald-900/30 p-3 text-center">
                    <p className="text-gray-400 text-xs mb-1">Total Bets</p>
                    <p className="text-xl font-bold text-emerald-400">
                      {p2pData.reduce((s, e) => s + e.totalBets, 0)}
                    </p>
                  </div>
                </div>

                <Card className="bg-black/40 backdrop-blur-md border-emerald-900/20 shadow-2xl overflow-hidden">
                  <CardContent className="p-0">
                    {p2pData.map((entry, idx) => {
                      const winRate = entry.winRate ?? (entry.totalWins + entry.totalLosses > 0 ? Math.round((entry.totalWins / (entry.totalWins + entry.totalLosses)) * 100) : 0);
                      const rank = idx + 1;
                      return (
                        <div
                          key={entry.walletAddress}
                          className={`border-b last:border-b-0 transition-all duration-200 ${getP2PRankBg(idx)}`}
                        >
                          <div
                            className="flex items-center justify-between px-3 md:px-5 py-3 md:py-4 cursor-pointer"
                            onClick={() => setExpandedRow(expandedRow === rank ? null : rank)}
                          >
                            <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-sm font-bold text-gray-400 flex-shrink-0">
                                {rank <= 3 ? (
                                  rank === 1 ? <Flame className="h-4 w-4 text-yellow-400" /> :
                                  rank === 2 ? <Medal className="h-4 w-4 text-gray-300" /> :
                                  <Award className="h-4 w-4 text-amber-500" />
                                ) : rank}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-white font-semibold text-sm md:text-base truncate" title={entry.walletAddress}>
                                    {names[entry.walletAddress] || formatAddress(entry.walletAddress)}
                                  </p>
                                  <TierBadge tier={entry.tier} />
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-gray-500 text-[11px]">{entry.totalBets} bets</span>
                                  <span className="text-gray-600">·</span>
                                  <span className={`text-[11px] font-medium ${winRate >= 60 ? 'text-green-400' : winRate >= 40 ? 'text-gray-400' : 'text-red-400'}`}>
                                    {winRate.toFixed(0)}% WR
                                  </span>
                                  <span className="text-gray-600">·</span>
                                  <span className="text-emerald-400 text-[11px]">{fmtVol(entry.totalVolume)} vol</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right flex items-center gap-2 md:gap-3 flex-shrink-0">
                              <div>
                                <div className={`text-sm md:text-base font-bold ${entry.totalNetPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {entry.totalNetPnl >= 0 ? '+' : ''}{fmtVol(entry.totalNetPnl)}
                                  <span className="text-[9px] md:text-[10px] ml-1 opacity-60">SBETS</span>
                                </div>
                              </div>
                              <div className="text-gray-600">
                                {expandedRow === rank ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </div>
                            </div>
                          </div>

                          {expandedRow === rank && (
                            <div className="px-3 md:px-5 pb-3 md:pb-4 pt-0">
                              <div className="bg-white/[0.03] rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                <div>
                                  <span className="text-gray-500 block mb-0.5">Total Volume</span>
                                  <span className="text-white font-medium">{fmtVol(entry.totalVolume)} SBETS</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-0.5">Won Bets</span>
                                  <span className="text-green-400 font-medium">{entry.totalWins}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-0.5">Lost Bets</span>
                                  <span className="text-red-400 font-medium">{entry.totalLosses}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-0.5">Net PnL</span>
                                  <span className={`font-medium ${entry.totalNetPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {entry.totalNetPnl >= 0 ? '+' : ''}{fmtVol(entry.totalNetPnl)} SBETS
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-20 bg-white/[0.02] rounded-2xl border border-dashed border-white/10">
                <div className="relative inline-block mb-6">
                  <GitMerge className="h-16 w-16 text-gray-800" />
                  <div className="absolute inset-0 bg-emerald-500/10 blur-xl rounded-full" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">No P2P traders yet</h3>
                <p className="text-gray-400 max-w-xs mx-auto">Be the first to create a P2P bet offer!</p>
              </div>
            )}
          </>
        )}

        {/* Regular leaderboard (weekly / monthly / allTime) */}
        {period !== 'p2p' && (
          <>
            {isLoading ? (
              <div className="space-y-3">
                <div className="flex gap-4 justify-center items-end mb-8">
                  {[2, 1, 3].map(i => <Skeleton key={i} className={`flex-1 ${i === 1 ? 'h-52' : 'h-40'} bg-white/5 rounded-xl`} />)}
                </div>
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full bg-white/5 rounded-xl" />
                ))}
              </div>
            ) : data?.leaderboard && data.leaderboard.length > 0 ? (
              <>
                {top3.length >= 3 && (
                  <div className="flex gap-3 md:gap-4 justify-center items-end mb-8 px-2">
                    {top3.map((entry) => (
                      <PodiumCard key={entry.rank} entry={entry} rank={entry.rank} name={names[entry.wallet]} />
                    ))}
                  </div>
                )}

                <Card className="bg-black/40 backdrop-blur-md border-cyan-900/20 shadow-2xl overflow-hidden">
                  <CardContent className="p-0">
                    {(top3.length < 3 ? data.leaderboard : rest).map((entry) => (
                      <div
                        key={entry.rank}
                        className={`border-b last:border-b-0 transition-all duration-200 ${getRankBg(entry.rank)}`}
                        data-testid={`leaderboard-entry-${entry.rank}`}
                      >
                        <div
                          className="flex items-center justify-between px-3 md:px-5 py-3 md:py-4 cursor-pointer"
                          onClick={() => setExpandedRow(expandedRow === entry.rank ? null : entry.rank)}
                        >
                          <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                            <div className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-sm font-bold text-gray-400 flex-shrink-0">
                              {entry.rank <= 3 ? (
                                entry.rank === 1 ? <Flame className="h-4 w-4 text-yellow-400" /> :
                                entry.rank === 2 ? <Medal className="h-4 w-4 text-gray-300" /> :
                                <Award className="h-4 w-4 text-amber-500" />
                              ) : entry.rank}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-sm md:text-base truncate" title={entry.wallet}>
                                {names[entry.wallet] || formatAddress(entry.wallet)}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-gray-500 text-[11px]">{entry.totalBets} bets</span>
                                <span className="text-gray-600">·</span>
                                <span className={`text-[11px] font-medium ${entry.winRate >= 60 ? 'text-green-400' : entry.winRate >= 40 ? 'text-gray-400' : 'text-red-400'}`}>{entry.winRate.toFixed(0)}%</span>
                                {entry.loyaltyPoints !== undefined && entry.loyaltyPoints > 0 && (
                                  <>
                                    <span className="text-gray-600">·</span>
                                    <span className="text-yellow-500 text-[11px] flex items-center gap-0.5">
                                      <Star className="h-2.5 w-2.5" /> {entry.loyaltyPoints.toLocaleString()}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex items-center gap-2 md:gap-3 flex-shrink-0">
                            <div>
                              {entry.suiProfit !== 0 && (
                                <div className={`text-sm md:text-base font-bold ${entry.suiProfit >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                                  {entry.suiProfit >= 0 ? '+' : ''}{entry.suiProfit.toFixed(2)}
                                  <span className="text-[9px] md:text-[10px] ml-1 opacity-60">SUI</span>
                                </div>
                              )}
                              {entry.sbetsProfit !== 0 && (
                                <div className={`text-sm md:text-base font-bold ${entry.sbetsProfit >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  {entry.sbetsProfit >= 0 ? '+' : ''}{entry.sbetsProfit >= 1000000
                                    ? `${(entry.sbetsProfit / 1000000).toFixed(1)}M`
                                    : entry.sbetsProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  <span className="text-[9px] md:text-[10px] ml-1 opacity-60">SBETS</span>
                                </div>
                              )}
                              {(entry.usdsuiProfit || 0) !== 0 && (
                                <div className={`text-sm md:text-base font-bold ${(entry.usdsuiProfit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {(entry.usdsuiProfit || 0) >= 0 ? '+' : ''}{(entry.usdsuiProfit || 0).toFixed(2)}
                                  <span className="text-[9px] md:text-[10px] ml-1 opacity-60">$USDsui</span>
                                </div>
                              )}
                              {(entry.usdcProfit || 0) !== 0 && (
                                <div className={`text-sm md:text-base font-bold ${(entry.usdcProfit || 0) >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                  {(entry.usdcProfit || 0) >= 0 ? '+' : ''}{(entry.usdcProfit || 0).toFixed(2)}
                                  <span className="text-[9px] md:text-[10px] ml-1 opacity-60">USDC</span>
                                </div>
                              )}
                              {(entry.lbtcProfit || 0) !== 0 && (
                                <div className={`text-sm md:text-base font-bold ${(entry.lbtcProfit || 0) >= 0 ? 'text-orange-400' : 'text-red-400'}`}>
                                  {(entry.lbtcProfit || 0) >= 0 ? '+' : ''}{(entry.lbtcProfit || 0).toFixed(6)}
                                  <span className="text-[9px] md:text-[10px] ml-1 opacity-60">LBTC</span>
                                </div>
                              )}
                            </div>
                            <div className="text-gray-600">
                              {expandedRow === entry.rank ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>
                          </div>
                        </div>

                        {expandedRow === entry.rank && (
                          <div className="px-3 md:px-5 pb-3 md:pb-4 pt-0">
                            <div className="bg-white/[0.03] rounded-lg p-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                              {entry.suiBets > 0 && (
                                <div>
                                  <span className="text-gray-500 block mb-0.5">SUI Bets</span>
                                  <span className="text-white font-medium">{entry.suiBets}</span>
                                </div>
                              )}
                              {entry.sbetsBets > 0 && (
                                <div>
                                  <span className="text-gray-500 block mb-0.5">SBETS Bets</span>
                                  <span className="text-white font-medium">{entry.sbetsBets}</span>
                                </div>
                              )}
                              {(entry.usdssuiBets || 0) > 0 && (
                                <div>
                                  <span className="text-gray-500 block mb-0.5">$USDsui Bets</span>
                                  <span className="text-white font-medium">{entry.usdssuiBets || 0}</span>
                                </div>
                              )}
                              {(entry.usdcBets || 0) > 0 && (
                                <div>
                                  <span className="text-gray-500 block mb-0.5">USDC Bets</span>
                                  <span className="text-white font-medium">{entry.usdcBets || 0}</span>
                                </div>
                              )}
                              {(entry.lbtcBets || 0) > 0 && (
                                <div>
                                  <span className="text-gray-500 block mb-0.5">LBTC Bets</span>
                                  <span className="text-white font-medium">{entry.lbtcBets || 0}</span>
                                </div>
                              )}
                              <div>
                                <span className="text-gray-500 block mb-0.5">Win Rate</span>
                                <span className={`font-medium ${entry.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>{entry.winRate.toFixed(1)}%</span>
                              </div>
                              <div>
                                <span className="text-gray-500 block mb-0.5">Est. USD Value</span>
                                <span className="text-gray-300 font-medium">${entry.totalProfitUsd >= 0 ? '+' : ''}{entry.totalProfitUsd.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-20 bg-white/[0.02] rounded-2xl border border-dashed border-white/10">
                <div className="relative inline-block mb-6">
                  <Trophy className="h-16 w-16 text-gray-800" />
                  <div className="absolute inset-0 bg-yellow-500/10 blur-xl rounded-full" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">No winners yet</h3>
                <p className="text-gray-400 max-w-xs mx-auto">The arena is empty. Place a bet to claim your spot!</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
