import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import Layout from '@/components/layout/Layout';
import { 
  Trophy, Calendar, Search, Filter, CheckCircle, XCircle,
  BarChart3, Target, TrendingUp, TrendingDown, Clock, Zap,
  Award, Percent, DollarSign, Flame, Shield, ExternalLink,
  RefreshCw, ArrowDownLeft, ArrowUpRight
} from 'lucide-react';

type ResultsTab = 'matches' | 'mybets';

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

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ['/api/events/results', selectedSport, dateFilter],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', `/api/events/results?period=${dateFilter}`);
        if (!response.ok) throw new Error('Failed to fetch results');
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (err) {
        console.error('Error fetching results:', err);
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
    if (eventName && eventName !== 'Unknown Event' && eventName !== 'Parlay Bet') return `${eventName} - ${prediction}`;
    if (prediction.includes(':')) {
      const [match, pick] = prediction.split(':');
      if (match && pick) return `${match.trim()} - ${pick.trim()}`;
    }
    return prediction || 'Bet Placed';
  };

  const betActivities: ActivityItem[] = bets
    .filter((bet: any) => bet.placedAt || bet.createdAt)
    .map((bet: any) => {
      const isParlayBet = isParlay(bet);
      const statusType = bet.status === 'won' || bet.status === 'paid_out' ? 'bet_won' : bet.status === 'lost' ? 'bet_lost' : 'bet_placed';
      const statusTitle = bet.status === 'won' || bet.status === 'paid_out' ? 'Bet Won!' : bet.status === 'lost' ? 'Bet Lost' : isParlayBet ? 'Parlay Placed' : 'Bet Placed';
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
        odds: bet.odds
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
    const emojis: Record<number, string> = { 1: '\u26BD', 2: '\uD83C\uDFC0', 3: '\uD83C\uDFBE', 4: '\uD83C\uDFC8', 5: '\u26BE', 6: '\uD83C\uDFD2', 7: '\uD83E\uDD4B', 8: '\uD83E\uDD4A', 9: '\uD83C\uDFCF', 10: '\uD83C\uDFC9', 11: '\uD83C\uDFAE', 12: '\uD83E\uDD3E', 13: '\uD83C\uDFCE\uFE0F', 14: '\uD83D\uDEB4', 15: '\uD83C\uDFC9', 16: '\uD83C\uDFD0', 17: '\uD83C\uDFC7', 18: '\uD83C\uDFCF', 26: '\u26BD' };
    return emojis[sportId] || '\uD83C\uDFC6';
  }

  function getSportColor(sportId: number): { bg: string; border: string; text: string } {
    const colors: Record<number, { bg: string; border: string; text: string }> = {
      1: { bg: 'from-green-500/10 to-green-500/5', border: 'border-green-500/20', text: 'text-green-400' },
      2: { bg: 'from-orange-500/10 to-orange-500/5', border: 'border-orange-500/20', text: 'text-orange-400' },
      3: { bg: 'from-yellow-500/10 to-yellow-500/5', border: 'border-yellow-500/20', text: 'text-yellow-400' },
      4: { bg: 'from-amber-500/10 to-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-400' },
      5: { bg: 'from-red-500/10 to-red-500/5', border: 'border-red-500/20', text: 'text-red-400' },
      6: { bg: 'from-cyan-500/10 to-cyan-500/5', border: 'border-cyan-500/20', text: 'text-cyan-400' },
      7: { bg: 'from-rose-500/10 to-rose-500/5', border: 'border-rose-500/20', text: 'text-rose-400' },
      8: { bg: 'from-pink-500/10 to-pink-500/5', border: 'border-pink-500/20', text: 'text-pink-400' },
      9: { bg: 'from-lime-500/10 to-lime-500/5', border: 'border-lime-500/20', text: 'text-lime-400' },
      10: { bg: 'from-teal-500/10 to-teal-500/5', border: 'border-teal-500/20', text: 'text-teal-400' },
      11: { bg: 'from-purple-500/10 to-purple-500/5', border: 'border-purple-500/20', text: 'text-purple-400' },
      12: { bg: 'from-indigo-500/10 to-indigo-500/5', border: 'border-indigo-500/20', text: 'text-indigo-400' },
      13: { bg: 'from-sky-500/10 to-sky-500/5', border: 'border-sky-500/20', text: 'text-sky-400' },
      14: { bg: 'from-fuchsia-500/10 to-fuchsia-500/5', border: 'border-fuchsia-500/20', text: 'text-fuchsia-400' },
      15: { bg: 'from-emerald-500/10 to-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-400' },
      16: { bg: 'from-violet-500/10 to-violet-500/5', border: 'border-violet-500/20', text: 'text-violet-400' },
      17: { bg: 'from-stone-500/10 to-stone-500/5', border: 'border-stone-500/20', text: 'text-stone-400' },
      18: { bg: 'from-lime-500/10 to-lime-500/5', border: 'border-lime-500/20', text: 'text-lime-400' },
    };
    return colors[sportId] || { bg: 'from-[#4da2ff]/10 to-[#4da2ff]/5', border: 'border-[#4da2ff]/20', text: 'text-[#4da2ff]' };
  }

  const availableSports = [
    { id: 'all', name: 'All Sports', emoji: '\uD83C\uDFC6' },
    ...Array.from(new Set(results.map((event: any) => event.sportId))).map(sportId => ({ id: (sportId as number).toString(), name: getSportName(sportId as number), emoji: getSportEmoji(sportId as number) }))
  ];

  const filteredResults = results.filter((event: any) => {
    const matchesSport = selectedSport === 'all' || event.sportId.toString() === selectedSport;
    const matchesSearch = searchTerm === '' || event.homeTeam.toLowerCase().includes(searchTerm.toLowerCase()) || event.awayTeam.toLowerCase().includes(searchTerm.toLowerCase()) || (event.league && event.league.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSport && matchesSearch;
  });

  const fmtAmount = (n: number) => { if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`; if (n >= 1000) return `${(n / 1000).toFixed(1)}K`; return n.toFixed(0); };
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
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/activity') }),
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/bets') }),
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/events/results') }),
      refetchBets(), refetchActivity()
    ]);
    toast({ title: 'Refreshed', description: 'Results updated' });
    setIsRefreshing(false);
  };

  const getResultIcon = (type: string) => {
    switch (type) {
      case 'bet_won': return <Trophy className="h-5 w-5 text-green-400" />;
      case 'bet_lost': return <XCircle className="h-5 w-5 text-red-400" />;
      case 'bet_placed': return <Target className="h-5 w-5 text-[#4da2ff]" />;
      case 'deposit': return <ArrowDownLeft className="h-5 w-5 text-green-400" />;
      case 'withdrawal': return <ArrowUpRight className="h-5 w-5 text-orange-400" />;
      default: return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  return (
    <Layout title="Results">
      <div className="min-h-screen bg-[#080c14] text-white" data-testid="results-page">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-6 gap-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 bg-gradient-to-br from-[#4da2ff] to-[#7c3aed] rounded-xl flex items-center justify-center shadow-lg shadow-[#4da2ff]/20">
                <BarChart3 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight" data-testid="page-title">Results</h1>
                <p className="text-gray-500 text-sm">Match outcomes and your betting performance</p>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              className="p-2.5 text-gray-400 hover:text-[#4da2ff] hover:bg-[#4da2ff]/10 rounded-xl transition-all self-start sm:self-auto"
              data-testid="btn-refresh"
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex gap-1 p-1 bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl mb-6" data-testid="results-tabs">
            <button
              onClick={() => setActiveTab('matches')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'matches'
                  ? 'bg-gradient-to-r from-[#4da2ff] to-[#3d8ce6] text-white shadow-lg shadow-[#4da2ff]/20'
                  : 'text-gray-400 hover:text-white hover:bg-[#141c2e]'
              }`}
              data-testid="tab-matches"
            >
              <Trophy className="h-4 w-4" />
              Match Results
              {filteredResults.length > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${activeTab === 'matches' ? 'bg-white/20' : 'bg-[#4da2ff]/15 text-[#4da2ff]'}`}>
                  {filteredResults.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('mybets')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'mybets'
                  ? 'bg-gradient-to-r from-[#4da2ff] to-[#3d8ce6] text-white shadow-lg shadow-[#4da2ff]/20'
                  : 'text-gray-400 hover:text-white hover:bg-[#141c2e]'
              }`}
              data-testid="tab-mybets"
            >
              <Flame className="h-4 w-4" />
              My Bet Results
              {bets.length > 0 && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${activeTab === 'mybets' ? 'bg-white/20' : 'bg-[#4da2ff]/15 text-[#4da2ff]'}`}>
                  {bets.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'matches' && (
            <div className="space-y-6" data-testid="matches-section">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {availableSports.map((sport: any) => (
                    <button
                      key={sport.id}
                      onClick={() => setSelectedSport(sport.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                        selectedSport === sport.id
                          ? 'bg-[#4da2ff] text-white shadow-lg shadow-[#4da2ff]/20'
                          : 'bg-[#0d1117] text-gray-400 hover:text-white border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30'
                      }`}
                      data-testid={`sport-${sport.id}`}
                    >
                      <span>{sport.emoji}</span>
                      {sport.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {[
                    { id: 'today', label: 'Today' },
                    { id: 'week', label: '7D' },
                    { id: 'month', label: '30D' }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setDateFilter(f.id)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                        dateFilter === f.id
                          ? 'bg-[#4da2ff] text-white shadow-lg shadow-[#4da2ff]/20'
                          : 'bg-[#0d1117] text-gray-400 hover:text-white border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30'
                      }`}
                      data-testid={`date-${f.id}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search teams or leagues..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-[#0d1117] text-white rounded-xl pl-11 pr-4 py-3 border border-[#1e3a5f]/20 focus:border-[#4da2ff]/50 focus:ring-1 focus:ring-[#4da2ff]/20 focus:outline-none placeholder-gray-600 text-sm transition-all"
                  data-testid="input-search-matches"
                />
              </div>

              {resultsLoading && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-6 animate-pulse">
                      <div className="h-4 bg-[#1e3a5f]/40 rounded mb-4 w-1/3" />
                      <div className="h-6 bg-[#1e3a5f]/40 rounded mb-3" />
                      <div className="h-16 bg-[#1e3a5f]/40 rounded" />
                    </div>
                  ))}
                </div>
              )}

              {!resultsLoading && filteredResults.length > 0 && (
                <>
                  <div className="flex items-center gap-3 px-1 mb-2">
                    <span className="text-gray-500 text-xs font-medium">{filteredResults.length} completed {filteredResults.length === 1 ? 'match' : 'matches'}</span>
                    <div className="flex-1 h-px bg-[#1e3a5f]/20" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredResults.map((result: any) => {
                      const winner = getWinner(result);
                      const homeScore = result.homeScore || result.homeTeamScore || 0;
                      const awayScore = result.awayScore || result.awayTeamScore || 0;
                      const sportColor = getSportColor(result.sportId);
                      const sportEmoji = getSportEmoji(result.sportId);
                      return (
                        <div key={result.id} className={`bg-gradient-to-br ${sportColor.bg} border ${sportColor.border} rounded-2xl overflow-hidden hover:scale-[1.01] transition-all group`} data-testid={`match-${result.id}`}>
                          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                              winner === 'Draw' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30' : 'bg-green-500/15 text-green-400 border border-green-500/30'
                            }`}>
                              <CheckCircle className="h-3 w-3 inline mr-1" />
                              Final
                            </span>
                            <span className={`text-xs font-medium flex items-center gap-1.5 ${sportColor.text}`}>
                              <span className="text-sm">{sportEmoji}</span>
                              {getSportName(result.sportId)}
                            </span>
                          </div>
                          <div className="px-4 py-3">
                            <h3 className="text-white font-semibold text-sm mb-1 group-hover:text-[#4da2ff] transition-colors">{result.homeTeam} vs {result.awayTeam}</h3>
                            {result.league && result.league !== getSportName(result.sportId) && (
                              <p className="text-gray-500 text-xs">{result.league}</p>
                            )}
                          </div>
                          <div className="mx-4 mb-4 bg-[#080c14]/60 rounded-xl border border-white/5 p-4">
                            <div className="grid grid-cols-3 gap-2 text-center">
                              <div>
                                <p className={`text-2xl font-bold ${winner === result.homeTeam ? 'text-green-400' : 'text-gray-400'}`}>{homeScore}</p>
                                <p className="text-gray-500 text-xs mt-1 truncate">{result.homeTeam}</p>
                                {winner === result.homeTeam && <Trophy className="h-4 w-4 text-yellow-500 mx-auto mt-1" />}
                              </div>
                              <div className="flex flex-col items-center justify-center">
                                <span className={`font-bold text-sm ${sportColor.text}`}>FINAL</span>
                                <span className="text-gray-600 text-[10px]">{winner === 'Draw' ? 'Draw' : 'Result'}</span>
                              </div>
                              <div>
                                <p className={`text-2xl font-bold ${winner === result.awayTeam ? 'text-green-400' : 'text-gray-400'}`}>{awayScore}</p>
                                <p className="text-gray-500 text-xs mt-1 truncate">{result.awayTeam}</p>
                                {winner === result.awayTeam && <Trophy className="h-4 w-4 text-yellow-500 mx-auto mt-1" />}
                              </div>
                            </div>
                          </div>
                          <div className="px-4 pb-3 flex items-center justify-between">
                            {winner !== 'TBD' && winner !== 'Draw' ? (
                              <span className="inline-flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-3 py-1.5 rounded-full font-medium">
                                <Trophy className="h-3 w-3" /> {winner}
                              </span>
                            ) : winner === 'Draw' ? (
                              <span className="inline-flex items-center gap-1.5 text-xs bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-full font-medium">Draw</span>
                            ) : (
                              <span />
                            )}
                            <span className="text-gray-600 text-[11px] flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(result.startTime || result.endTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          {result.betsSettled > 0 && (
                            <div className="px-4 pb-3">
                              <span className="text-[10px] text-gray-600 flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                {result.betsSettled} bet{result.betsSettled > 1 ? 's' : ''} settled on-chain
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {!resultsLoading && filteredResults.length === 0 && (
                <div className="text-center py-16">
                  <div className="h-16 w-16 bg-[#4da2ff]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Trophy className="h-8 w-8 text-[#4da2ff]/40" />
                  </div>
                  <p className="text-gray-300 font-medium mb-1">No Match Results Found</p>
                  <p className="text-gray-600 text-sm mb-5">
                    {searchTerm ? `No results for "${searchTerm}"` : 'No completed matches for the selected filters'}
                  </p>
                  <button
                    onClick={() => { setSelectedSport('all'); setSearchTerm(''); setDateFilter('week'); }}
                    className="text-[#4da2ff] text-sm hover:underline font-medium"
                    data-testid="btn-clear-filters"
                  >
                    Clear Filters
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'mybets' && (
            <div className="space-y-6" data-testid="mybets-section">
              {!walletAddress ? (
                <div className="text-center py-16">
                  <div className="h-16 w-16 bg-[#4da2ff]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <BarChart3 className="h-8 w-8 text-[#4da2ff]/40" />
                  </div>
                  <p className="text-gray-300 font-medium mb-1">Connect Your Wallet</p>
                  <p className="text-gray-600 text-sm mb-5">Connect your Sui wallet to see your betting results</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="bg-gradient-to-br from-[#4da2ff]/10 to-[#4da2ff]/5 border border-[#4da2ff]/20 rounded-2xl p-4" data-testid="stat-total">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-[#4da2ff]" />
                        <span className="text-gray-400 text-xs font-medium">Total Bets</span>
                      </div>
                      <p className="text-2xl font-bold text-white">{bets.length}</p>
                    </div>
                    <div className="bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20 rounded-2xl p-4" data-testid="stat-won">
                      <div className="flex items-center gap-2 mb-2">
                        <Trophy className="h-4 w-4 text-green-400" />
                        <span className="text-gray-400 text-xs font-medium">Won</span>
                      </div>
                      <p className="text-2xl font-bold text-green-400">{totalWon}</p>
                    </div>
                    <div className="bg-gradient-to-br from-red-500/10 to-red-500/5 border border-red-500/20 rounded-2xl p-4" data-testid="stat-lost">
                      <div className="flex items-center gap-2 mb-2">
                        <XCircle className="h-4 w-4 text-red-400" />
                        <span className="text-gray-400 text-xs font-medium">Lost</span>
                      </div>
                      <p className="text-2xl font-bold text-red-400">{totalLost}</p>
                    </div>
                    <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border border-yellow-500/20 rounded-2xl p-4" data-testid="stat-pending">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-yellow-400" />
                        <span className="text-gray-400 text-xs font-medium">Pending</span>
                      </div>
                      <p className="text-2xl font-bold text-yellow-400">{totalPending}</p>
                    </div>
                    <div className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20 rounded-2xl p-4 col-span-2 lg:col-span-1" data-testid="stat-winrate">
                      <div className="flex items-center gap-2 mb-2">
                        <Percent className="h-4 w-4 text-purple-400" />
                        <span className="text-gray-400 text-xs font-medium">Win Rate</span>
                      </div>
                      <p className="text-2xl font-bold text-purple-400">{winRate}%</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-5 flex items-center gap-4" data-testid="stat-profit">
                      <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${totalProfit >= 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                        {totalProfit >= 0 ? <TrendingUp className="h-6 w-6 text-green-400" /> : <TrendingDown className="h-6 w-6 text-red-400" />}
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs font-medium mb-0.5">Net Profit/Loss</p>
                        <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {totalProfit >= 0 ? '+' : ''}{fmtAmount(totalProfit)} <span className="text-sm font-medium text-gray-500">SBETS</span>
                        </p>
                      </div>
                    </div>
                    <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-5 flex items-center gap-4" data-testid="stat-wagered">
                      <div className="h-12 w-12 bg-[#4da2ff]/10 border border-[#4da2ff]/20 rounded-xl flex items-center justify-center shrink-0">
                        <DollarSign className="h-6 w-6 text-[#4da2ff]" />
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs font-medium mb-0.5">Total Wagered</p>
                        <p className="text-xl font-bold text-white">
                          {fmtAmount(totalWagered)} <span className="text-sm font-medium text-gray-500">SBETS</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {(totalWon + totalLost) > 0 && (
                    <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-5" data-testid="win-loss-bar">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-gray-400 text-sm font-medium flex items-center gap-2">
                          <Award className="h-4 w-4 text-[#4da2ff]" />
                          Win/Loss Ratio
                        </span>
                        <span className="text-white text-sm font-semibold">{totalWon}W - {totalLost}L</span>
                      </div>
                      <div className="h-3 bg-gray-800/80 rounded-full overflow-hidden flex">
                        <div className="bg-gradient-to-r from-green-500 to-green-400 rounded-l-full transition-all duration-700" style={{ width: `${(totalWon / (totalWon + totalLost)) * 100}%` }} />
                        <div className="bg-gradient-to-r from-red-500 to-red-400 rounded-r-full transition-all duration-700" style={{ width: `${(totalLost / (totalWon + totalLost)) * 100}%` }} />
                      </div>
                      <div className="flex justify-between mt-2">
                        <span className="text-green-400 text-xs font-medium">{winRate}% Won</span>
                        <span className="text-red-400 text-xs font-medium">{100 - winRate}% Lost</span>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {(['today', 'week', 'month', 'all'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setBetTimeRange(t)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
                            betTimeRange === t
                              ? 'bg-[#4da2ff] text-white shadow-lg shadow-[#4da2ff]/20'
                              : 'bg-[#0d1117] text-gray-400 hover:text-white border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30'
                          }`}
                          data-testid={`bet-time-${t}`}
                        >
                          {t === 'today' ? 'Today' : t === 'week' ? '7D' : t === 'month' ? '30D' : 'All'}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-gray-500" />
                      <select
                        value={betFilter}
                        onChange={(e) => setBetFilter(e.target.value)}
                        className="bg-[#0d1117] border border-[#1e3a5f]/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#4da2ff]/50 cursor-pointer"
                        data-testid="select-bet-filter"
                      >
                        <option value="all">All Results</option>
                        <option value="won">Wins Only</option>
                        <option value="lost">Losses Only</option>
                        <option value="bet_placed">Pending</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-[#1e3a5f]/15">
                      <h3 className="text-white font-bold text-base flex items-center gap-2">
                        <Flame className="h-5 w-5 text-orange-400" />
                        Bet History
                        <span className="text-xs bg-[#4da2ff]/15 text-[#4da2ff] px-2.5 py-0.5 rounded-full font-medium">{filteredBetActivities.length}</span>
                      </h3>
                    </div>
                    <div className="p-3">
                      {filteredBetActivities.length === 0 ? (
                        <div className="text-center py-12">
                          <div className="h-14 w-14 bg-[#4da2ff]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                            <BarChart3 className="h-7 w-7 text-[#4da2ff]/40" />
                          </div>
                          <p className="text-gray-400 font-medium mb-1 text-sm">No bet results yet</p>
                          <p className="text-gray-600 text-xs">Place bets and results will appear here as they settle</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {filteredBetActivities.map((activity) => (
                            <div
                              key={activity.id}
                              className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                                activity.type === 'bet_won' ? 'bg-gradient-to-r from-green-500/5 to-transparent border-green-500/20 hover:border-green-500/40' :
                                activity.type === 'bet_lost' ? 'bg-gradient-to-r from-red-500/5 to-transparent border-red-500/20 hover:border-red-500/40' :
                                'bg-gradient-to-r from-[#4da2ff]/5 to-transparent border-[#4da2ff]/20 hover:border-[#4da2ff]/40'
                              }`}
                              data-testid={`activity-${activity.id}`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                                  activity.type === 'bet_won' ? 'bg-green-500/15 border border-green-500/30' :
                                  activity.type === 'bet_lost' ? 'bg-red-500/15 border border-red-500/30' :
                                  'bg-[#4da2ff]/15 border border-[#4da2ff]/30'
                                }`}>
                                  {getResultIcon(activity.type)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-white font-semibold text-sm">{activity.title}</p>
                                    {activity.type === 'bet_won' && <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold">WIN</span>}
                                    {activity.type === 'bet_lost' && <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold">LOSS</span>}
                                    {activity.type === 'bet_placed' && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />PENDING</span>}
                                  </div>
                                  <p className="text-gray-400 text-xs mt-0.5 truncate">{activity.description}</p>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-gray-600 text-[11px] flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />{getRelativeTime(activity.timestamp)}
                                    </span>
                                    {activity.odds && <span className="text-gray-600 text-[11px] flex items-center gap-1"><Zap className="h-3 w-3" />{activity.odds.toFixed(2)}x</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right shrink-0 ml-3">
                                <p className={`font-bold text-base ${
                                  activity.type.includes('won') ? 'text-green-400' : activity.type.includes('lost') ? 'text-red-400' : 'text-white'
                                }`}>
                                  {activity.type.includes('won') ? '+' : ''}{fmtAmount(activity.amount)}
                                  <span className="text-xs font-medium text-gray-500 ml-1">{activity.currency}</span>
                                </p>
                                {activity.txHash && (
                                  <a
                                    href={`https://suiscan.xyz/mainnet/tx/${activity.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[#4da2ff] hover:text-[#5db0ff] text-[11px] mt-1 transition-colors"
                                    data-testid={`link-tx-${activity.id}`}
                                  >
                                    <Shield className="h-3 w-3" />Verify<ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
