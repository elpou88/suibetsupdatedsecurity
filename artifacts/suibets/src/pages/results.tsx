import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'wouter';
import {
  Trophy, Calendar, Search, CheckCircle, XCircle,
  BarChart3, Target, TrendingUp, TrendingDown, Clock, Zap,
  Award, Percent, DollarSign, Shield, ExternalLink,
  RefreshCw, ArrowDownLeft, ArrowUpRight, Filter
} from 'lucide-react';

type ResultsTab = 'matches' | 'mybets' | 'p2p';

interface ActivityItem {
  id: string;
  type: 'bet_placed' | 'bet_won' | 'bet_lost' | 'deposit' | 'withdrawal' | 'stake' | 'unstake';
  title: string;
  description: string;
  amount: number;
  currency: string;
  timestamp: string;
  status: 'completed' | 'pending' | 'failed';
  txHash?: string;
  odds?: number;
}

export default function ResultsPage() {
  const { toast } = useToast();
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;
  const [activeTab, setActiveTab] = useState<ResultsTab>('matches');
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('month');
  const [betFilter, setBetFilter] = useState<string>('all');
  const [betTimeRange, setBetTimeRange] = useState<'today' | 'week' | 'month' | 'all'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleConnectWallet = () => {
    window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  };

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ['/api/events/results', selectedSport, dateFilter],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', `/api/events/results?period=${dateFilter}`);
        if (!response.ok) throw new Error('Failed to fetch results');
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
    refetchInterval: 300000,
  });

  const { data: rawBets, refetch: refetchBets } = useQuery({
    queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: rawActivities, refetch: refetchActivity } = useQuery({
    queryKey: [`/api/activity?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: p2pActivity, isLoading: isP2PLoading } = useQuery<{
    myOffers?: any[]; myMatches?: any[]; myParlayOffers?: any[];
  }>({
    queryKey: ['/api/p2p/my', walletAddress],
    enabled: !!walletAddress,
    queryFn: () =>
      fetch(`/api/p2p/my?wallet=${walletAddress}`)
        .then(r => r.ok ? r.json() : {})
        .catch(() => ({})),
    refetchInterval: 30000,
  });

  const bets = Array.isArray(rawBets) ? rawBets : [];
  const activities: ActivityItem[] = Array.isArray(rawActivities) ? rawActivities : [];

  const isParlay = (bet: any): boolean => {
    const pred = bet.prediction || bet.selection || '';
    if (typeof pred === 'string' && pred.includes(' | ')) return true;
    if (typeof pred === 'string' && pred.startsWith('[')) {
      try { return Array.isArray(JSON.parse(pred)); } catch { return false; }
    }
    return bet.externalEventId?.startsWith('parlay_') || bet.eventName === 'Parlay Bet';
  };

  const getBetDescription = (bet: any): string => {
    const prediction = bet.prediction || bet.selection || '';
    const eventName = bet.eventName || '';
    if (typeof prediction === 'string' && prediction.includes(' | ')) {
      const legs = prediction.split(' | ');
      if (legs.length > 1) return `${legs.length}-Leg Parlay: ${legs[0].split(':')[0] || legs[0]}...`;
    }
    if (typeof prediction === 'string' && prediction.startsWith('[')) {
      try {
        const parsed = JSON.parse(prediction);
        if (Array.isArray(parsed) && parsed.length > 0) return `${parsed.length}-Leg Parlay: ${parsed[0].eventName || parsed[0].eventId || 'Multi'}...`;
      } catch { }
    }
    if (eventName && eventName !== 'Unknown Event' && eventName !== 'Parlay Bet') return `${eventName} — ${prediction}`;
    if (prediction.includes(':')) {
      const [match, pick] = prediction.split(':');
      if (match && pick) return `${match.trim()} — ${pick.trim()}`;
    }
    return prediction || 'Bet placed';
  };

  const betActivities: ActivityItem[] = bets
    .filter((bet: any) => bet.placedAt || bet.createdAt)
    .map((bet: any) => {
      const isParlayBet = isParlay(bet);
      const statusType = bet.status === 'won' || bet.status === 'paid_out' ? 'bet_won' : bet.status === 'lost' ? 'bet_lost' : 'bet_placed';
      const statusTitle = bet.status === 'won' || bet.status === 'paid_out' ? 'Bet won' : bet.status === 'lost' ? 'Bet lost' : isParlayBet ? 'Parlay placed' : 'Bet placed';
      return {
        id: `bet-${bet.id}`,
        type: statusType,
        title: statusTitle,
        description: getBetDescription(bet),
        amount: (bet.status === 'won' || bet.status === 'paid_out') ? (bet.potentialWin || bet.potentialPayout) : (bet.stake || bet.betAmount),
        currency: bet.currency || 'SUI',
        timestamp: bet.placedAt || bet.createdAt,
        status: 'completed' as const,
        txHash: bet.txHash,
        odds: bet.odds,
      };
    });

  const allBetActivities = [...activities, ...betActivities].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const now = new Date();
  const timeFiltered = allBetActivities.filter(a => {
    if (betTimeRange === 'all') return true;
    const ts = new Date(a.timestamp);
    if (betTimeRange === 'today') return ts.toDateString() === now.toDateString();
    if (betTimeRange === 'week') return now.getTime() - ts.getTime() < 7 * 86400000;
    if (betTimeRange === 'month') return now.getTime() - ts.getTime() < 30 * 86400000;
    return true;
  });
  const filteredBetActivities = betFilter === 'all' ? timeFiltered : timeFiltered.filter(a => a.type.includes(betFilter));

  const totalWon = bets.filter((b: any) => b.status === 'won' || b.status === 'paid_out').length;
  const totalLost = bets.filter((b: any) => b.status === 'lost').length;
  const totalPending = bets.filter((b: any) => b.status === 'pending' || b.status === 'confirmed').length;
  const winRate = (totalWon + totalLost) > 0 ? Math.round((totalWon / (totalWon + totalLost)) * 100) : 0;
  const totalProfit = bets.reduce((sum: number, b: any) => {
    if (b.status === 'won' || b.status === 'paid_out') return sum + ((b.potentialWin || b.potentialPayout || 0) - (b.stake || b.betAmount || 0));
    if (b.status === 'lost') return sum - (b.stake || b.betAmount || 0);
    return sum;
  }, 0);
  const totalWagered = bets.reduce((sum: number, b: any) => sum + (b.stake || b.betAmount || 0), 0);

  function getSportName(sportId: number): string {
    const sportNames: Record<number, string> = { 1: 'Football', 2: 'Basketball', 3: 'Tennis', 4: 'American Football', 5: 'Baseball', 6: 'Ice Hockey', 7: 'MMA', 8: 'Boxing', 9: 'Cricket', 10: 'AFL', 11: 'Esports', 12: 'Handball', 13: 'Formula 1', 14: 'Cycling', 15: 'Rugby', 16: 'Volleyball', 17: 'Horse Racing', 18: 'Cricket', 20: 'WWE', 26: 'Soccer' };
    return sportNames[sportId] || `Sport ${sportId}`;
  }

  function getWinner(event: any): string {
    const homeScore = parseInt(event.homeScore || event.homeTeamScore || event.score?.home || '0') || 0;
    const awayScore = parseInt(event.awayScore || event.awayTeamScore || event.score?.away || '0') || 0;
    if (homeScore === 0 && awayScore === 0) return 'TBD';
    if (homeScore > awayScore) return event.homeTeam;
    if (awayScore > homeScore) return event.awayTeam;
    return 'Draw';
  }

  function getSportEmoji(sportId: number): string {
    const emojis: Record<number, string> = { 1: '⚽', 2: '🏀', 3: '🎾', 4: '🏈', 5: '⚾', 6: '🏒', 7: '🥊', 8: '🥊', 9: '🏏', 10: '🏉', 11: '🎮', 12: '🤾', 13: '🏎️', 14: '🚴', 15: '🏉', 16: '🏐', 17: '🏇', 18: '🏏', 26: '⚽' };
    return emojis[sportId] || '🏆';
  }

  const availableSports = [
    { id: 'all', name: 'All', emoji: '🏆' },
    ...Array.from(new Set(results.map((event: any) => event.sportId))).map(sportId => ({
      id: (sportId as number).toString(),
      name: getSportName(sportId as number),
      emoji: getSportEmoji(sportId as number),
    }))
  ];

  const filteredResults = results.filter((event: any) => {
    const matchesSport = selectedSport === 'all' || event.sportId.toString() === selectedSport;
    const matchesSearch = searchTerm === '' ||
      event.homeTeam?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.awayTeam?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (event.league && event.league.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSport && matchesSearch;
  });

  const fmtAmount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(2);
  };

  const getRelativeTime = (timestamp: string) => {
    const diff = now.getTime() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes('/api/activity') }),
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes('/api/bets') }),
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes('/api/events/results') }),
      refetchBets(), refetchActivity(),
    ]);
    toast({ title: 'Refreshed', description: 'Results updated' });
    setIsRefreshing(false);
  };

  const TABS: { key: ResultsTab; label: string; count?: number }[] = [
    { key: 'matches', label: 'Match results', count: filteredResults.length || undefined },
    { key: 'mybets', label: 'My bets', count: bets.length || undefined },
    { key: 'p2p', label: 'P2P results', count: ((p2pActivity?.myMatches?.length ?? 0) + (p2pActivity?.myParlayOffers?.length ?? 0)) || undefined },
  ];

  return (
    <div className="min-h-screen bg-[#080a0f] text-white">

      {/* ── Nav ── */}
      <nav className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 z-50 bg-[#080a0f]/95 backdrop-blur-md">
        <Link href="/">
          <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-8 w-auto" />
        </Link>
        <div className="flex items-center gap-3">
          {walletAddress ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-cyan-400 font-bold">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span>
            </div>
          ) : (
            <button onClick={handleConnectWallet}
              className="text-sm font-bold px-4 py-2 rounded-xl text-black transition-all hover:opacity-90"
              style={{ background: '#00ffff' }}>
              Connect wallet
            </button>
          )}
          <Link href="/"
            className="text-sm font-medium px-4 py-2 rounded-xl transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: '#9ca3af' }}>
            ← Home
          </Link>
        </div>
      </nav>

      <div className="px-5 py-10" style={{ maxWidth: 800, margin: '0 auto' }}>

        {/* ── Heading ── */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-5xl font-black mb-2">
              Re<em className="not-italic text-cyan-400" style={{ fontStyle: 'italic' }}>sults</em>
            </h1>
            <p className="text-sm" style={{ color: '#6b7280' }}>Match outcomes and your betting performance.</p>
          </div>
          <button onClick={handleRefresh}
            className="p-2.5 rounded-xl transition-all mt-1"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#4b5563' }}>
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-cyan-400' : ''} />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-2 mb-7 overflow-x-auto pb-1">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all"
              style={{
                background: activeTab === tab.key ? '#00ffff' : 'rgba(255,255,255,0.04)',
                color: activeTab === tab.key ? '#000' : '#6b7280',
                border: `1px solid ${activeTab === tab.key ? '#00ffff' : 'rgba(255,255,255,0.07)'}`,
              }}>
              {tab.label}
              {tab.count !== undefined && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                  style={{
                    background: activeTab === tab.key ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.08)',
                    color: activeTab === tab.key ? '#000' : '#9ca3af',
                  }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ══════════ MATCHES TAB ══════════ */}
        {activeTab === 'matches' && (
          <div className="space-y-5">
            {/* Sport pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-5 px-5">
              {availableSports.map(sport => (
                <button key={sport.id} onClick={() => setSelectedSport(sport.id)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all"
                  style={{
                    background: selectedSport === sport.id ? '#00ffff' : 'rgba(255,255,255,0.05)',
                    color: selectedSport === sport.id ? '#000' : '#6b7280',
                    border: `1px solid ${selectedSport === sport.id ? '#00ffff' : 'rgba(255,255,255,0.07)'}`,
                  }}>
                  <span>{sport.emoji}</span>
                  {sport.name}
                </button>
              ))}
              <div className="ml-auto flex-shrink-0 flex items-center gap-2">
                {[{ id: 'today', label: 'Today' }, { id: 'week', label: '7D' }, { id: 'month', label: '30D' }].map(f => (
                  <button key={f.id} onClick={() => setDateFilter(f.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: dateFilter === f.id ? 'rgba(0,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                      color: dateFilter === f.id ? '#00ffff' : '#4b5563',
                      border: `1px solid ${dateFilter === f.id ? 'rgba(0,255,255,0.25)' : 'rgba(255,255,255,0.06)'}`,
                    }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: '#374151' }} />
              <input
                type="text"
                placeholder="Search teams or leagues…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full rounded-xl pl-10 pr-4 py-3 text-sm outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: '#e5e7eb',
                }}
              />
            </div>

            {/* Count */}
            {!resultsLoading && filteredResults.length > 0 && (
              <div className="flex items-center gap-3 px-1">
                <span className="text-xs" style={{ color: '#374151' }}>{filteredResults.length} completed {filteredResults.length === 1 ? 'match' : 'matches'}</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.04)' }} />
              </div>
            )}

            {/* Skeleton */}
            {resultsLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="rounded-2xl p-5 animate-pulse" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', height: 130 }} />
                ))}
              </div>
            )}

            {/* Result cards */}
            {!resultsLoading && filteredResults.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredResults.map((result: any) => {
                  const winner = getWinner(result);
                  const homeScore = result.homeScore || result.homeTeamScore || 0;
                  const awayScore = result.awayScore || result.awayTeamScore || 0;
                  const sportEmoji = getSportEmoji(result.sportId);
                  return (
                    <div key={result.id} className="rounded-2xl overflow-hidden transition-all hover:scale-[1.01]"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      {/* Card header */}
                      <div className="flex items-center justify-between px-4 py-2.5 border-b"
                        style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full flex items-center gap-1"
                          style={{
                            background: winner === 'Draw' ? 'rgba(251,191,36,0.1)' : 'rgba(74,222,128,0.08)',
                            color: winner === 'Draw' ? '#fbbf24' : '#4ade80',
                            border: `1px solid ${winner === 'Draw' ? 'rgba(251,191,36,0.2)' : 'rgba(74,222,128,0.15)'}`,
                          }}>
                          <CheckCircle size={10} />
                          FINAL
                        </span>
                        <span className="text-xs" style={{ color: '#4b5563' }}>
                          {sportEmoji} {getSportName(result.sportId)}
                        </span>
                      </div>

                      {/* Scores */}
                      <div className="px-4 py-4">
                        <p className="text-xs font-medium mb-3 truncate" style={{ color: '#9ca3af' }}>
                          {result.homeTeam} vs {result.awayTeam}
                          {result.league && result.league !== getSportName(result.sportId) && (
                            <span style={{ color: '#374151' }}> · {result.league}</span>
                          )}
                        </p>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-2xl font-black" style={{ color: winner === result.homeTeam ? '#4ade80' : '#374151' }}>{homeScore}</p>
                            <p className="text-[10px] mt-1 truncate" style={{ color: '#4b5563' }}>{result.homeTeam?.split(' ').slice(-1)[0]}</p>
                            {winner === result.homeTeam && <Trophy size={12} className="text-yellow-400 mx-auto mt-1" />}
                          </div>
                          <div className="flex flex-col items-center justify-center">
                            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151' }}>
                              {winner === 'Draw' ? 'Draw' : winner === 'TBD' ? 'TBD' : 'Result'}
                            </span>
                          </div>
                          <div>
                            <p className="text-2xl font-black" style={{ color: winner === result.awayTeam ? '#4ade80' : '#374151' }}>{awayScore}</p>
                            <p className="text-[10px] mt-1 truncate" style={{ color: '#4b5563' }}>{result.awayTeam?.split(' ').slice(-1)[0]}</p>
                            {winner === result.awayTeam && <Trophy size={12} className="text-yellow-400 mx-auto mt-1" />}
                          </div>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="px-4 pb-3 flex items-center justify-between">
                        {winner !== 'TBD' && winner !== 'Draw' ? (
                          <span className="text-[10px] flex items-center gap-1 font-bold" style={{ color: '#4ade80' }}>
                            <Trophy size={10} /> {winner}
                          </span>
                        ) : winner === 'Draw' ? (
                          <span className="text-[10px] font-bold" style={{ color: '#fbbf24' }}>Draw</span>
                        ) : <span />}
                        <span className="text-[11px] flex items-center gap-1" style={{ color: '#374151' }}>
                          <Calendar size={10} />
                          {new Date(result.startTime || result.endTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty */}
            {!resultsLoading && filteredResults.length === 0 && (
              <div className="text-center py-16">
                <Trophy size={32} className="mx-auto mb-4 opacity-20" />
                <p className="font-bold text-white mb-1">No results found</p>
                <p className="text-sm mb-5" style={{ color: '#4b5563' }}>
                  {searchTerm ? `No results matching "${searchTerm}"` : 'No completed matches for the selected filters'}
                </p>
                <button onClick={() => { setSelectedSport('all'); setSearchTerm(''); setDateFilter('week'); }}
                  className="text-sm font-bold" style={{ color: '#00ffff' }}>
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════ MY BETS TAB ══════════ */}
        {activeTab === 'mybets' && (
          <div className="space-y-5">
            {!walletAddress ? (
              <div className="rounded-2xl p-10 text-center"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <BarChart3 size={32} className="mx-auto mb-4 opacity-20" />
                <p className="font-bold text-white mb-1">Connect your wallet</p>
                <p className="text-sm mb-5" style={{ color: '#4b5563' }}>Connect your Sui wallet to see your betting results</p>
                <button onClick={handleConnectWallet}
                  className="px-6 py-2.5 rounded-xl font-black text-black text-sm"
                  style={{ background: '#00ffff' }}>
                  Connect wallet
                </button>
              </div>
            ) : (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { label: 'Total bets', value: bets.length, color: '#00ffff', icon: <Target size={14} /> },
                    { label: 'Won', value: totalWon, color: '#4ade80', icon: <Trophy size={14} /> },
                    { label: 'Lost', value: totalLost, color: '#f87171', icon: <XCircle size={14} /> },
                    { label: 'Pending', value: totalPending, color: '#fbbf24', icon: <Clock size={14} /> },
                    { label: 'Win rate', value: `${winRate}%`, color: '#c084fc', icon: <Percent size={14} /> },
                  ].map(({ label, value, color, icon }) => (
                    <div key={label} className="rounded-2xl p-4"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center gap-1.5 mb-2" style={{ color }}>
                        {icon}
                        <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#4b5563' }}>{label}</span>
                      </div>
                      <p className="text-2xl font-black" style={{ color }}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Profit + wagered */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-2xl p-5 flex items-center gap-4"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: totalProfit >= 0 ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${totalProfit >= 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'}` }}>
                      {totalProfit >= 0 ? <TrendingUp size={20} color="#4ade80" /> : <TrendingDown size={20} color="#f87171" />}
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: '#4b5563' }}>Net profit / loss</p>
                      <p className="text-xl font-black" style={{ color: totalProfit >= 0 ? '#4ade80' : '#f87171' }}>
                        {totalProfit >= 0 ? '+' : ''}{fmtAmount(totalProfit)} <span className="text-sm font-medium" style={{ color: '#4b5563' }}>SUI</span>
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl p-5 flex items-center gap-4"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(0,255,255,0.06)', border: '1px solid rgba(0,255,255,0.12)' }}>
                      <DollarSign size={20} color="#00ffff" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: '#4b5563' }}>Total wagered</p>
                      <p className="text-xl font-black text-white">
                        {fmtAmount(totalWagered)} <span className="text-sm font-medium" style={{ color: '#4b5563' }}>SUI</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Win/loss bar */}
                {(totalWon + totalLost) > 0 && (
                  <div className="rounded-2xl p-5"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold flex items-center gap-2" style={{ color: '#9ca3af' }}>
                        <Award size={14} className="text-cyan-400" /> Win / Loss ratio
                      </span>
                      <span className="text-sm font-black text-white">{totalWon}W – {totalLost}L</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-l-full transition-all" style={{ width: `${winRate}%`, background: 'linear-gradient(90deg,#4ade80,#22c55e)' }} />
                      <div className="h-full rounded-r-full transition-all" style={{ width: `${100 - winRate}%`, background: 'linear-gradient(90deg,#f87171,#ef4444)' }} />
                    </div>
                    <div className="flex justify-between mt-2">
                      <span className="text-[11px] font-bold" style={{ color: '#4ade80' }}>{winRate}% won</span>
                      <span className="text-[11px] font-bold" style={{ color: '#f87171' }}>{100 - winRate}% lost</span>
                    </div>
                  </div>
                )}

                {/* Filters */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {(['today', 'week', 'month', 'all'] as const).map(t => (
                      <button key={t} onClick={() => setBetTimeRange(t)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                        style={{
                          background: betTimeRange === t ? 'rgba(0,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                          color: betTimeRange === t ? '#00ffff' : '#4b5563',
                          border: `1px solid ${betTimeRange === t ? 'rgba(0,255,255,0.25)' : 'rgba(255,255,255,0.06)'}`,
                        }}>
                        {t === 'today' ? 'Today' : t === 'week' ? '7D' : t === 'month' ? '30D' : 'All'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Filter size={12} style={{ color: '#374151' }} />
                    <select value={betFilter} onChange={e => setBetFilter(e.target.value)}
                      className="rounded-xl px-3 py-1.5 text-xs outline-none cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#9ca3af' }}>
                      <option value="all">All results</option>
                      <option value="won">Wins only</option>
                      <option value="lost">Losses only</option>
                      <option value="bet_placed">Pending</option>
                    </select>
                  </div>
                </div>

                {/* Bet history */}
                <div className="rounded-2xl overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="px-5 py-3.5 border-b flex items-center gap-2"
                    style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    <span className="text-sm font-bold text-white">Bet history</span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(0,255,255,0.08)', color: '#00ffff' }}>
                      {filteredBetActivities.length}
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    {filteredBetActivities.length === 0 ? (
                      <div className="text-center py-12">
                        <BarChart3 size={28} className="mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-bold text-white mb-1">No bet results yet</p>
                        <p className="text-xs" style={{ color: '#374151' }}>Place bets and results will appear here as they settle</p>
                      </div>
                    ) : filteredBetActivities.map(activity => (
                      <div key={activity.id}
                        className="flex items-center justify-between p-4 rounded-xl transition-all"
                        style={{
                          background: activity.type === 'bet_won' ? 'rgba(74,222,128,0.04)' : activity.type === 'bet_lost' ? 'rgba(248,113,113,0.04)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${activity.type === 'bet_won' ? 'rgba(74,222,128,0.12)' : activity.type === 'bet_lost' ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.05)'}`,
                        }}>
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{
                              background: activity.type === 'bet_won' ? 'rgba(74,222,128,0.1)' : activity.type === 'bet_lost' ? 'rgba(248,113,113,0.1)' : 'rgba(0,255,255,0.08)',
                            }}>
                            {activity.type === 'bet_won' ? <Trophy size={14} color="#4ade80" /> :
                             activity.type === 'bet_lost' ? <XCircle size={14} color="#f87171" /> :
                             activity.type === 'deposit' ? <ArrowDownLeft size={14} color="#4ade80" /> :
                             activity.type === 'withdrawal' ? <ArrowUpRight size={14} color="#f97316" /> :
                             <Target size={14} color="#00ffff" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <p className="text-sm font-bold text-white">{activity.title}</p>
                              {activity.type === 'bet_won' && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>WIN</span>}
                              {activity.type === 'bet_lost' && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>LOSS</span>}
                              {activity.type === 'bet_placed' && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}><Clock size={8} />PENDING</span>}
                            </div>
                            <p className="text-xs truncate" style={{ color: '#4b5563' }}>{activity.description}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[10px] flex items-center gap-1" style={{ color: '#374151' }}>
                                <Calendar size={9} />{getRelativeTime(activity.timestamp)}
                              </span>
                              {activity.odds && <span className="text-[10px] flex items-center gap-1" style={{ color: '#374151' }}><Zap size={9} />{activity.odds.toFixed(2)}x</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="font-black text-base" style={{ color: activity.type.includes('won') ? '#4ade80' : activity.type.includes('lost') ? '#f87171' : '#e5e7eb' }}>
                            {activity.type.includes('won') ? '+' : ''}{fmtAmount(activity.amount)}
                            <span className="text-xs font-medium ml-1" style={{ color: '#374151' }}>{activity.currency}</span>
                          </p>
                          {activity.txHash && (
                            <a href={`https://suiscan.xyz/mainnet/tx/${activity.txHash}`} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] mt-1 transition-colors"
                              style={{ color: '#4b5563' }}
                              onMouseEnter={e => (e.currentTarget.style.color = '#00ffff')}
                              onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}>
                              <Shield size={9} />Verify<ExternalLink size={9} />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════ P2P TAB ══════════ */}
        {activeTab === 'p2p' && (
          <div className="space-y-5">
            {!walletAddress ? (
              <div className="rounded-2xl p-10 text-center"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <Zap size={32} className="mx-auto mb-4 opacity-20" />
                <p className="font-bold text-white mb-1">Connect your wallet</p>
                <p className="text-sm mb-5" style={{ color: '#4b5563' }}>See your P2P betting history</p>
                <button onClick={handleConnectWallet}
                  className="px-6 py-2.5 rounded-xl font-black text-black text-sm"
                  style={{ background: '#00ffff' }}>
                  Connect wallet
                </button>
              </div>
            ) : isP2PLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(168,85,247,0.4)', borderTopColor: 'transparent' }} />
              </div>
            ) : (
              <>
                {/* P2P stat cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Offers posted', value: p2pActivity?.myOffers?.length ?? 0 },
                    { label: 'Bets matched', value: p2pActivity?.myMatches?.length ?? 0 },
                    { label: 'P2P parlays', value: p2pActivity?.myParlayOffers?.length ?? 0 },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-2xl p-4 text-center"
                      style={{ background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.12)' }}>
                      <p className="text-2xl font-black" style={{ color: '#c084fc' }}>{value}</p>
                      <p className="text-[10px] uppercase tracking-wider mt-1" style={{ color: '#4b5563' }}>{label}</p>
                    </div>
                  ))}
                </div>

                {/* Matched bets */}
                {(p2pActivity?.myMatches?.length ?? 0) > 0 && (
                  <div className="rounded-2xl overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="px-5 py-3.5 border-b flex items-center gap-2"
                      style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      <Zap size={14} style={{ color: '#c084fc' }} />
                      <span className="text-sm font-bold text-white">Matched P2P bets</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {p2pActivity!.myMatches!.map((match: any) => {
                        const offer = match.offer || {};
                        const isWon = match.winnerWallet === walletAddress;
                        const isLost = match.winnerWallet && match.winnerWallet !== walletAddress;
                        const isPending = !match.winnerWallet;
                        return (
                          <div key={match.id}
                            className="flex items-center justify-between p-4 rounded-xl"
                            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <p className="text-sm font-bold text-white truncate">{offer.eventName || 'P2P Bet'}</p>
                                {isWon && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>WIN</span>}
                                {isLost && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>LOSS</span>}
                                {isPending && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}><Clock size={8} />PENDING</span>}
                              </div>
                              <p className="text-xs" style={{ color: '#374151' }}>
                                {match.takerPrediction || offer.creatorPrediction || '—'} · {match.takerStake || offer.takerStake} {offer.currency || 'SUI'}
                              </p>
                            </div>
                            <a href="/p2p" className="text-xs flex items-center gap-1 flex-shrink-0 ml-3 transition-colors"
                              style={{ color: '#c084fc' }}>
                              <ExternalLink size={11} /> View
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Open offers */}
                {(p2pActivity?.myOffers?.filter((o: any) => o.status === 'open').length ?? 0) > 0 && (
                  <div className="rounded-2xl overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="px-5 py-3.5 border-b flex items-center gap-2"
                      style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      <Clock size={14} style={{ color: '#fbbf24' }} />
                      <span className="text-sm font-bold text-white">Open offers</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {p2pActivity!.myOffers!.filter((o: any) => o.status === 'open').map((offer: any) => (
                        <div key={offer.id}
                          className="flex items-center justify-between p-4 rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-white truncate">{offer.eventName || 'P2P Offer'}</p>
                            <p className="text-xs mt-0.5" style={{ color: '#374151' }}>
                              {offer.creatorPrediction} · {offer.creatorStake} {offer.currency || 'SUI'} · {offer.creatorOdds?.toFixed(2)}x
                            </p>
                          </div>
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ml-3"
                            style={{ background: 'rgba(0,255,255,0.1)', color: '#00ffff' }}>OPEN</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(p2pActivity?.myOffers?.length ?? 0) === 0 && (p2pActivity?.myMatches?.length ?? 0) === 0 && (
                  <div className="text-center py-12">
                    <Zap size={28} className="mx-auto mb-3 opacity-20" />
                    <p className="font-bold text-white mb-1">No P2P activity yet</p>
                    <p className="text-sm mb-5" style={{ color: '#4b5563' }}>Head to the P2P Market to post or take a bet</p>
                    <Link href="/p2p"
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-black text-black text-sm"
                      style={{ background: '#00ffff' }}>
                      Go to P2P Market
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
