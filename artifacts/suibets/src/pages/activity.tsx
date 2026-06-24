import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import SuiNSName from '@/components/SuiNSName';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  Trophy, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle,
  ArrowUpRight, ArrowDownLeft, Wallet, RefreshCw, Filter, ArrowLeft,
  ExternalLink, BarChart3, Flame, Target, Zap, Award, Percent,
  DollarSign, Calendar, ChevronRight, Shield
} from 'lucide-react';

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

export default function ActivityPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currentAccount = useCurrentAccount();
  const [filter, setFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'all'>('all');
  
  const walletAddress = currentAccount?.address;
  
  const { data: rawActivities, refetch } = useQuery({
    queryKey: [`/api/activity?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: rawBets } = useQuery({
    queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });
  
  const activities: ActivityItem[] = Array.isArray(rawActivities) ? rawActivities : [];
  const bets = Array.isArray(rawBets) ? rawBets : [];

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
      if (legs.length > 1) {
        return `${legs.length}-Leg Parlay: ${legs[0].split(':')[0] || legs[0]}...`;
      }
    }
    
    if (typeof prediction === 'string' && prediction.startsWith('[')) {
      try {
        const parsed = JSON.parse(prediction);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const first = parsed[0];
          return `${parsed.length}-Leg Parlay: ${first.eventName || first.eventId || 'Multi'}...`;
        }
      } catch { }
    }
    
    if (eventName && eventName !== 'Unknown Event' && eventName !== 'Parlay Bet') {
      return `${eventName} - ${prediction}`;
    }
    
    if (prediction.includes(':')) {
      const [match, pick] = prediction.split(':');
      if (match && pick) {
        return `${match.trim()} - ${pick.trim()}`;
      }
    }
    
    return prediction || 'Bet Placed';
  };

  const betActivities: ActivityItem[] = bets
    .filter((bet: any) => bet.placedAt || bet.createdAt)
    .map((bet: any) => {
      const isParlayBet = isParlay(bet);
      const statusType = bet.status === 'won' || bet.status === 'paid_out' ? 'bet_won' 
        : bet.status === 'lost' ? 'bet_lost' 
        : 'bet_placed';
      const statusTitle = bet.status === 'won' || bet.status === 'paid_out' ? 'Bet Won!' 
        : bet.status === 'lost' ? 'Bet Lost' 
        : isParlayBet ? 'Parlay Placed' : 'Bet Placed';
      
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

  const allActivities = [...activities, ...betActivities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const now = new Date();
  const timeFiltered = allActivities.filter(a => {
    if (timeRange === 'all') return true;
    const ts = new Date(a.timestamp);
    if (timeRange === 'today') return ts.toDateString() === now.toDateString();
    if (timeRange === 'week') return now.getTime() - ts.getTime() < 7 * 86400000;
    if (timeRange === 'month') return now.getTime() - ts.getTime() < 30 * 86400000;
    return true;
  });
  
  const filteredActivities = filter === 'all' 
    ? timeFiltered 
    : timeFiltered.filter(a => a.type.includes(filter));

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

  const getResultIcon = (type: string) => {
    switch (type) {
      case 'bet_won': return <Trophy className="h-5 w-5 text-green-400" />;
      case 'bet_lost': return <XCircle className="h-5 w-5 text-red-400" />;
      case 'bet_placed': return <Target className="h-5 w-5 text-[#4da2ff]" />;
      case 'deposit': return <ArrowDownLeft className="h-5 w-5 text-green-400" />;
      case 'withdrawal': return <ArrowUpRight className="h-5 w-5 text-orange-400" />;
      case 'stake': return <TrendingUp className="h-5 w-5 text-purple-400" />;
      case 'unstake': return <TrendingDown className="h-5 w-5 text-yellow-400" />;
      default: return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getResultBorder = (type: string) => {
    switch (type) {
      case 'bet_won': return 'border-green-500/30 hover:border-green-500/50';
      case 'bet_lost': return 'border-red-500/20 hover:border-red-500/40';
      case 'bet_placed': return 'border-[#4da2ff]/20 hover:border-[#4da2ff]/40';
      default: return 'border-gray-800/50 hover:border-gray-700/50';
    }
  };

  const getResultGlow = (type: string) => {
    switch (type) {
      case 'bet_won': return 'from-green-500/5 to-transparent';
      case 'bet_lost': return 'from-red-500/5 to-transparent';
      case 'bet_placed': return 'from-[#4da2ff]/5 to-transparent';
      default: return 'from-gray-500/5 to-transparent';
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/activity') }),
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/bets') }),
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/transactions') }),
      refetch()
    ]);
    toast({ title: 'Refreshed', description: 'Results updated' });
    setIsRefreshing(false);
  };

  const handleConnectWallet = () => {
    window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation('/');
    }
  };

  const fmtAmount = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(0);
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
  
  return (
    <div className="min-h-screen bg-[#080c14]" data-testid="activity-page">
      <nav className="bg-[#0d1117]/90 backdrop-blur-xl border-b border-[#1e3a5f]/20 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={handleBack}
              className="p-2 text-gray-400 hover:text-[#4da2ff] hover:bg-[#4da2ff]/10 rounded-xl transition-colors"
              data-testid="btn-back"
            >
              <ArrowLeft size={20} />
            </button>
            <Link href="/" data-testid="link-logo">
              <img src={suibetsLogo} alt="SuiBets" className="h-10 w-auto cursor-pointer" />
            </Link>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-bets">Bets</Link>
            <Link href="/dashboard" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-dashboard">Dashboard</Link>
            <Link href="/wallet-dashboard" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-dashboard">Dashboard</Link>
            <span className="text-[#4da2ff] text-sm font-medium border-b-2 border-[#4da2ff] pb-0.5" data-testid="nav-results">Results</span>
            <Link href="/deposits-withdrawals" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-withdraw">Withdraw</Link>
            <Link href="/parlay" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-parlays">Parlays</Link>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleRefresh} 
              className="p-2 text-gray-400 hover:text-[#4da2ff] hover:bg-[#4da2ff]/10 rounded-xl transition-colors" 
              data-testid="btn-refresh"
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {walletAddress ? (
              <SuiNSName address={walletAddress} className="text-[#4da2ff] text-sm font-medium" />
            ) : (
              <button 
                onClick={handleConnectWallet} 
                className="bg-gradient-to-r from-[#4da2ff] to-[#3d8ce6] hover:from-[#5db0ff] hover:to-[#4d9cf6] text-white font-semibold px-5 py-2 rounded-xl text-sm flex items-center gap-2 shadow-lg shadow-[#4da2ff]/20 transition-all" 
                data-testid="btn-connect"
              >
                <Wallet size={16} />
                Connect
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 bg-gradient-to-br from-[#4da2ff] to-[#7c3aed] rounded-xl flex items-center justify-center shadow-lg shadow-[#4da2ff]/20">
                <BarChart3 className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-3xl font-extrabold text-white tracking-tight" data-testid="page-title">Results</h1>
            </div>
            <p className="text-gray-500 text-sm ml-[52px]">Your complete betting performance and settlement history</p>
          </div>
          <div className="flex items-center gap-2 ml-[52px] sm:ml-0">
            {(['today', 'week', 'month', 'all'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTimeRange(t)}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
                  timeRange === t 
                    ? 'bg-[#4da2ff] text-white shadow-lg shadow-[#4da2ff]/20' 
                    : 'bg-[#0d1117] text-gray-400 hover:text-white border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30'
                }`}
                data-testid={`time-${t}`}
              >
                {t === 'today' ? 'Today' : t === 'week' ? '7D' : t === 'month' ? '30D' : 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
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
          <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-5 mb-8" data-testid="win-loss-bar">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-400 text-sm font-medium flex items-center gap-2">
                <Award className="h-4 w-4 text-[#4da2ff]" />
                Win/Loss Ratio
              </span>
              <span className="text-white text-sm font-semibold">{totalWon}W - {totalLost}L</span>
            </div>
            <div className="h-3 bg-gray-800/80 rounded-full overflow-hidden flex">
              <div 
                className="bg-gradient-to-r from-green-500 to-green-400 rounded-l-full transition-all duration-700"
                style={{ width: `${(totalWon / (totalWon + totalLost)) * 100}%` }}
              />
              <div 
                className="bg-gradient-to-r from-red-500 to-red-400 rounded-r-full transition-all duration-700"
                style={{ width: `${(totalLost / (totalWon + totalLost)) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-green-400 text-xs font-medium">{winRate}% Won</span>
              <span className="text-red-400 text-xs font-medium">{100 - winRate}% Lost</span>
            </div>
          </div>
        )}

        <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f]/15">
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-400" />
              Recent Results
              <span className="text-xs bg-[#4da2ff]/15 text-[#4da2ff] px-2.5 py-0.5 rounded-full font-medium">{filteredActivities.length}</span>
            </h3>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="bg-[#161b22] border border-[#1e3a5f]/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#4da2ff]/50 cursor-pointer"
                data-testid="select-filter"
              >
                <option value="all">All Results</option>
                <option value="won">Wins Only</option>
                <option value="lost">Losses Only</option>
                <option value="bet_placed">Pending</option>
              </select>
            </div>
          </div>
          
          <div className="px-3 py-3">
            {filteredActivities.length === 0 ? (
              <div className="text-center py-16">
                <div className="h-16 w-16 bg-[#4da2ff]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="h-8 w-8 text-[#4da2ff]/40" />
                </div>
                <p className="text-gray-300 font-medium mb-1">No results yet</p>
                <p className="text-gray-600 text-sm mb-5">Place bets and your results will appear here as they settle</p>
                <Link href="/">
                  <button className="bg-gradient-to-r from-[#4da2ff] to-[#3d8ce6] hover:from-[#5db0ff] hover:to-[#4d9cf6] text-white font-semibold px-6 py-2.5 rounded-xl shadow-lg shadow-[#4da2ff]/20 transition-all" data-testid="btn-place-bet">
                    Place Your First Bet
                  </button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredActivities.map((activity) => (
                  <div 
                    key={activity.id}
                    className={`flex items-center justify-between p-4 bg-gradient-to-r ${getResultGlow(activity.type)} rounded-xl border ${getResultBorder(activity.type)} transition-all group`}
                    data-testid={`activity-${activity.id}`}
                  >
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${
                        activity.type === 'bet_won' ? 'bg-green-500/15 border border-green-500/30' :
                        activity.type === 'bet_lost' ? 'bg-red-500/15 border border-red-500/30' :
                        activity.type === 'bet_placed' ? 'bg-[#4da2ff]/15 border border-[#4da2ff]/30' :
                        'bg-gray-800/50 border border-gray-700/30'
                      }`}>
                        {getResultIcon(activity.type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-semibold text-sm">{activity.title}</p>
                          {activity.type === 'bet_won' && (
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Win</span>
                          )}
                          {activity.type === 'bet_lost' && (
                            <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Loss</span>
                          )}
                          {activity.type === 'bet_placed' && (
                            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" /> Pending
                            </span>
                          )}
                        </div>
                        <p className="text-gray-400 text-xs mt-0.5 truncate">{activity.description}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-gray-600 text-[11px] flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {getRelativeTime(activity.timestamp)}
                          </span>
                          {activity.odds && (
                            <span className="text-gray-600 text-[11px] flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              {activity.odds.toFixed(2)}x
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className={`font-bold text-base ${
                        activity.type.includes('won') || activity.type === 'deposit' 
                          ? 'text-green-400' 
                          : activity.type.includes('lost') || activity.type === 'withdrawal' 
                            ? 'text-red-400' 
                            : 'text-white'
                      }`}>
                        {activity.type === 'deposit' || activity.type.includes('won') ? '+' : ''}{fmtAmount(activity.amount)}
                        <span className="text-xs font-medium text-gray-500 ml-1">{activity.currency}</span>
                      </p>
                      {activity.txHash && (
                        <a 
                          href={`https://suiscan.xyz/mainnet/tx/${activity.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#4da2ff] hover:text-[#5db0ff] text-[11px] mt-1 transition-colors"
                          title="View on Explorer"
                          data-testid={`link-tx-${activity.id}`}
                        >
                          <Shield className="h-3 w-3" />
                          Verify
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
