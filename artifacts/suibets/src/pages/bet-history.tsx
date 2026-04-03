import { Link, useLocation } from 'wouter';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import SuiNSName from '@/components/SuiNSName';
import { useBetting } from '@/context/BettingContext';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  FileText, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Wallet,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Filter,
  ArrowLeft,
  Share2,
  Gift,
  DollarSign,
  Copy
} from 'lucide-react';
import { ShareableBetCard } from '@/components/betting/ShareableBetCard';

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
}

export default function BetHistoryPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currentAccount = useCurrentAccount();
  const { addBet } = useBetting();
  const [filter, setFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [shareBet, setShareBet] = useState<Bet | null>(null);
  
  // Only fetch data when wallet is connected - prevents mock data
  const walletAddress = currentAccount?.address;
  
  const { data: rawBets, refetch, isLoading } = useQuery({
    queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 15000,
    staleTime: 10000,
  });
  
  const bets: Bet[] = Array.isArray(rawBets) ? rawBets : [];

  const [cashingOut, setCashingOut] = useState<string | null>(null);
  const [cashOutEstimates, setCashOutEstimates] = useState<Record<string, { estimate: number; available: boolean; legs?: any[] }>>({});

  const fetchCashOutEstimate = async (betId: string) => {
    try {
      const res = await fetch(`/api/bets/${betId}/cash-out-estimate?wallet=${walletAddress}`);
      if (res.ok) {
        const data = await res.json();
        setCashOutEstimates(prev => ({ ...prev, [betId]: data }));
        return data;
      }
    } catch {}
    return null;
  };

  const getCashOutEstimate = (bet: Bet) => {
    const cached = cashOutEstimates[bet.id];
    if (cached && cached.available) return cached.estimate;
    const stake = bet.stake || 0;
    return Math.round(stake * 0.85 * 0.99 * 100) / 100;
  };

  const cashOutMutation = useMutation({
    mutationFn: async ({ betId, expectedAmount }: { betId: string; expectedAmount?: number }) => {
      const res = await fetch(`/api/bets/${betId}/cash-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, expectedAmount }),
      });
      const data = await res.json();
      if (res.status === 409 && data.changed) {
        throw { message: data.message, changed: true, newEstimate: data.newEstimate };
      }
      if (!res.ok) {
        throw new Error(data.message || 'Cash-out failed');
      }
      return data;
    },
    onSuccess: (data) => {
      const amount = data.cashOut?.netAmount;
      const currency = data.cashOut?.currency || 'SUI';
      const txHash = data.cashOut?.txHash;
      const desc = txHash 
        ? `${typeof amount === 'number' ? amount.toFixed(2) : amount} ${currency} sent to your wallet`
        : `${typeof amount === 'number' ? amount.toFixed(2) : amount} ${currency} credited to your balance`;
      toast({ title: 'Cash Out Successful', description: desc });
      queryClient.invalidateQueries({ queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress] });
      setCashingOut(null);
    },
    onError: (error: any) => {
      if (error.changed && error.newEstimate) {
        const betId = cashingOut;
        if (betId) {
          setCashOutEstimates(prev => ({ ...prev, [betId]: { estimate: error.newEstimate, available: true } }));
        }
        toast({ title: 'Value Changed', description: `Cash-out value updated to ${error.newEstimate}. Click again to confirm.`, variant: 'destructive' });
      } else {
        toast({ title: 'Cash Out Failed', description: error.message || 'Something went wrong', variant: 'destructive' });
      }
      setCashingOut(null);
    },
  });

  const handleCashOut = async (bet: Bet) => {
    if (cashingOut === bet.id) {
      const estimate = cashOutEstimates[bet.id]?.estimate;
      cashOutMutation.mutate({ betId: bet.id, expectedAmount: estimate });
    } else {
      setCashingOut(bet.id);
      fetchCashOutEstimate(bet.id);
      setTimeout(() => setCashingOut(null), 8000);
    }
  };

  const filteredBets = filter === 'all'
    ? bets
    : filter === 'won'
      ? bets.filter(b => b.status === 'won' || b.status === 'paid_out')
      : bets.filter(b => b.status === filter);

  const stats = {
    total: bets.length,
    won: bets.filter(b => b.status === 'won' || b.status === 'paid_out').length,
    lost: bets.filter(b => b.status === 'lost').length,
    pending: bets.filter(b => b.status === 'pending').length,
    totalStaked: bets.reduce((acc, b) => acc + (b.stake || 0), 0),
    totalWon: bets.filter(b => b.status === 'won' || b.status === 'paid_out').reduce((acc, b) => acc + (b.potentialWin || 0), 0),
  };

  const winRate = stats.won + stats.lost > 0 ? ((stats.won / (stats.won + stats.lost)) * 100).toFixed(0) : 0;

  const [isSyncing, setIsSyncing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    toast({ title: 'Refreshed', description: 'Bet history updated' });
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
          toast({
            title: data.recovered > 0 ? 'Bets Recovered!' : 'All Synced',
            description: data.message,
          });
          await refetch();
        } else {
          toast({ title: 'Sync Failed', description: data.message || 'Could not sync bets', variant: 'destructive' });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      toast({ title: 'Sync Error', description: 'Network error — please try again', variant: 'destructive' });
    }
    setIsSyncing(false);
  };

  const autoSyncDone = useRef(false);
  useEffect(() => {
    if (walletAddress && !isLoading && bets.length === 0 && !isSyncing && !autoSyncDone.current) {
      autoSyncDone.current = true;
      handleSyncFromChain();
    }
  }, [walletAddress, isLoading, bets.length, isSyncing]);

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'won': return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'paid_out': return <CheckCircle className="h-5 w-5 text-emerald-400" />;
      case 'cashed_out': return <DollarSign className="h-5 w-5 text-orange-400" />;
      case 'lost': return <XCircle className="h-5 w-5 text-red-400" />;
      case 'pending': return <Clock className="h-5 w-5 text-yellow-400 animate-pulse" />;
      default: return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'won': return 'Won';
      case 'paid_out': return 'Paid Out';
      case 'cashed_out': return 'Cashed Out';
      case 'lost': return 'Lost';
      case 'pending': return 'Pending';
      default: return status;
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
        return { eventName: part.slice(0, colonIdx).trim(), selection: part.slice(colonIdx + 1).trim(), prediction: part.slice(colonIdx + 1).trim(), odds: 0 };
      }
      return { eventName: part.trim(), selection: part.trim(), prediction: part.trim(), odds: 0 };
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
    if (legs.length === 0 && typeof bet.selection === 'string' && bet.selection.includes(' | ')) {
      legs = parsePipeLegs(bet.selection);
    }
    if (legs.length === 0 && typeof bet.eventName === 'string' && bet.eventName.includes(' | ')) {
      legs = parsePipeLegs(bet.eventName);
    }
    return legs;
  };

  const getParlayLegResults = (bet: Bet): Map<number, boolean> => {
    const results = new Map<number, boolean>();
    if (!bet.result) return results;
    try {
      const parsed = JSON.parse(bet.result);
      if (Array.isArray(parsed)) {
        parsed.forEach((lr: { won: boolean }, idx: number) => {
          results.set(idx, lr.won);
        });
      }
    } catch {}
    return results;
  };

  const getLegResultColor = (bet: Bet, legIndex: number): string => {
    const isSettled = bet.status === 'won' || bet.status === 'lost' || bet.status === 'paid_out';
    if (!isSettled) return 'text-gray-400';
    
    if (bet.status === 'won' || bet.status === 'paid_out') return 'text-green-400';
    
    const legResults = getParlayLegResults(bet);
    if (legResults.size > 0) {
      const won = legResults.get(legIndex);
      if (won === true) return 'text-green-400';
      if (won === false) return 'text-red-400';
    }
    
    return 'text-red-400';
  };

  // Get display name for bet
  const getBetDisplayName = (bet: Bet): string => {
    if (isParlay(bet)) {
      const selections = getParlaySelections(bet);
      return `Parlay (${selections.length} Legs)`;
    }
    return bet.eventName || 'Unknown Event';
  };

  // Get selection display - show team names for parlays
  const getSelectionDisplay = (bet: Bet): string => {
    if (isParlay(bet)) {
      const selections = getParlaySelections(bet);
      // Show the team names selected - check both 'selection' and 'prediction' fields
      return selections.map(s => s.selection || (s as any).prediction || 'Pick').join(', ');
    }
    return bet.selection || 'Unknown';
  };

  return (
    <div className="min-h-screen" data-testid="bet-history-page">
      {/* Navigation */}
      <nav className="bg-black/40 backdrop-blur-md border-b border-cyan-900/30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={handleBack}
              className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
              data-testid="btn-back"
            >
              <ArrowLeft size={20} />
            </button>
            <Link href="/" data-testid="link-logo">
              <img src={suibetsLogo} alt="SuiBets" className="h-10 w-auto cursor-pointer" />
            </Link>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-bets">Bets</Link>
            <Link href="/dashboard" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-dashboard">Dashboard</Link>
            <Link href="/bet-history" className="text-cyan-400 text-sm font-medium" data-testid="nav-my-bets">My Bets</Link>
            <Link href="/activity" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-activity">Activity</Link>
            <Link href="/deposits-withdrawals" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-withdraw">Withdraw</Link>
            <Link href="/parlay" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-parlays">Parlays</Link>
          </div>
          <div className="flex items-center gap-4">
            {walletAddress && (
              <button
                onClick={handleSyncFromChain}
                disabled={isSyncing}
                className="text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 flex items-center gap-1.5"
                data-testid="btn-sync-chain"
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing...' : 'Sync from Chain'}
              </button>
            )}
            <button onClick={handleRefresh} className="text-gray-400 hover:text-white p-2" data-testid="btn-refresh">
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {walletAddress ? (
              <SuiNSName address={walletAddress} className="text-cyan-400 text-sm" />
            ) : (
              <button onClick={handleConnectWallet} className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2" data-testid="btn-connect">
                <Wallet size={16} />
                Connect
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-500/20 rounded-xl">
              <FileText className="h-8 w-8 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Bet History</h1>
              <p className="text-gray-400">Track your betting performance in real-time</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-400" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-[#111111] border border-cyan-900/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
              data-testid="select-filter"
            >
              <option value="all">All Bets</option>
              <option value="pending">Pending</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-cyan-400" />
              <span className="text-gray-400 text-sm">Win Rate</span>
            </div>
            <p className="text-3xl font-bold text-cyan-400">{winRate}%</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span className="text-gray-400 text-sm">Won</span>
            </div>
            <p className="text-3xl font-bold text-green-400">{stats.won}</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="h-5 w-5 text-green-400" />
              <span className="text-gray-400 text-sm">Total Won</span>
            </div>
            <p className="text-3xl font-bold text-green-400">+{stats.totalWon.toFixed(2)}</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-5 w-5 text-yellow-400" />
              <span className="text-gray-400 text-sm">Pending</span>
            </div>
            <p className="text-3xl font-bold text-yellow-400">{stats.pending}</p>
          </div>
        </div>

        {/* Bet List */}
        <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-3 sm:p-6 overflow-hidden">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            Your Bets
            <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded-full">Live Updates</span>
          </h3>
          
          {filteredBets.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="h-16 w-16 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400 text-lg mb-2">{isLoading ? 'Loading your bets...' : 'No bets yet'}</p>
              <p className="text-gray-500 text-sm mb-6">{isLoading ? 'Checking your wallet on the blockchain' : 'Place your first bet to see it here'}</p>
              {!isLoading && walletAddress && (
                <button
                  onClick={handleSyncFromChain}
                  disabled={isSyncing}
                  className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 font-bold px-6 py-3 rounded-xl transition-colors mb-4 flex items-center gap-2 mx-auto"
                  data-testid="btn-sync-empty"
                >
                  <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing from blockchain...' : 'Sync Bets from Blockchain'}
                </button>
              )}
              <Link href="/">
                <button className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-3 rounded-xl transition-colors" data-testid="btn-place-bet">
                  Place a Bet
                </button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredBets.map((bet) => (
                <div 
                  key={bet.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 bg-black/50 rounded-xl border border-cyan-900/20 hover:border-cyan-500/30 transition-colors gap-3"
                  data-testid={`bet-${bet.id}`}
                >
                  <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                    <div className={`p-2 sm:p-3 rounded-xl flex-shrink-0 ${
                      bet.status === 'won' || bet.status === 'paid_out' ? 'bg-green-500/20' :
                      bet.status === 'lost' ? 'bg-red-500/20' :
                      'bg-yellow-500/20'
                    }`}>
                      {getStatusIcon(bet.status)}
                      {bet.status === 'paid_out' && (
                        <span className="text-xs text-emerald-400 ml-1">Paid</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {(bet as any).leagueName && (
                        <p className="text-gray-500 text-[11px] font-medium uppercase tracking-wider mb-0.5" data-testid={`text-league-${bet.id}`}>{(bet as any).leagueName}</p>
                      )}
                      <p className="text-white font-medium">{getBetDisplayName(bet)}</p>
                      {bet.giftedTo && (
                        <span className="inline-flex items-center gap-1 bg-pink-500/20 text-pink-400 text-xs px-2 py-0.5 rounded-full mt-0.5" data-testid={`gift-badge-sent-${bet.id}`}>
                          <Gift className="w-3 h-3" /> Gifted to {bet.giftedTo.slice(0, 6)}...{bet.giftedTo.slice(-4)}
                        </span>
                      )}
                      {bet.giftedFrom && !bet.giftedTo && (
                        <span className="inline-flex items-center gap-1 bg-pink-500/20 text-pink-400 text-xs px-2 py-0.5 rounded-full mt-0.5" data-testid={`gift-badge-received-${bet.id}`}>
                          <Gift className="w-3 h-3" /> Gift from {bet.giftedFrom.slice(0, 6)}...{bet.giftedFrom.slice(-4)}
                        </span>
                      )}
                      <p className="text-cyan-400 text-sm">{getSelectionDisplay(bet)}</p>
                      {isParlay(bet) && (
                        <div className="mt-1 space-y-0.5">
                          {getParlaySelections(bet).slice(0, 5).map((leg, idx) => {
                            const colorClass = getLegResultColor(bet, idx);
                            const isSettled = bet.status === 'won' || bet.status === 'lost' || bet.status === 'paid_out';
                            const legResults = getParlayLegResults(bet);
                            const legWon = legResults.get(idx);
                            return (
                              <div key={idx} className={`flex items-center gap-1.5 text-xs truncate ${colorClass}`}>
                                {isSettled && legResults.size > 0 && (
                                  legWon ? (
                                    <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
                                  ) : (
                                    <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                                  )
                                )}
                                {isSettled && legResults.size === 0 && (
                                  (bet.status === 'won' || bet.status === 'paid_out') ? (
                                    <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
                                  ) : (
                                    <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                                  )
                                )}
                                {!isSettled && (
                                  <Clock className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                                )}
                                <span className="truncate">{leg.eventName}: {leg.selection || (leg as any).prediction || 'Pick'} @ {leg.odds?.toFixed(2)}</span>
                              </div>
                            );
                          })}
                          {getParlaySelections(bet).length > 5 && (
                            <p className="text-gray-500 text-xs">+{getParlaySelections(bet).length - 5} more...</p>
                          )}
                        </div>
                      )}
                      <p className="text-gray-500 text-xs mt-1">{new Date(bet.placedAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <div className="flex items-center gap-3 sm:gap-2 sm:justify-end mb-1 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400 text-sm">Stake:</span>
                        <span className="text-white font-medium">{bet.stake} {bet.currency || 'SUI'}</span>
                      </div>
                      <span className="text-gray-600 hidden sm:inline">·</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400 text-sm">Odds:</span>
                        <span className="text-green-400 font-bold">{bet.odds.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <span className="text-gray-400 text-sm">{bet.status === 'paid_out' ? 'Paid Out:' : 'To Win:'}</span>
                      <span className={`font-bold text-lg ${
                        bet.status === 'won' || bet.status === 'paid_out' ? 'text-green-400' :
                        bet.status === 'lost' ? 'text-red-400' :
                        'text-cyan-400'
                      }`}>
                        {bet.status === 'won' || bet.status === 'paid_out' ? '+' : ''}{bet.potentialWin.toFixed(2)} {bet.currency || 'SUI'}
                      </span>
                    </div>
                    {bet.txHash && (
                      <a 
                        href={`https://suiscan.xyz/mainnet/tx/${bet.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 justify-end mt-1"
                        data-testid={`tx-link-${bet.id}`}
                      >
                        View on Explorer
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {bet.walrusBlobId && (
                      <div className="flex items-center gap-2 mt-1">
                        <Link
                          href={`/walrus-receipt/${bet.walrusBlobId}`}
                          className="text-purple-400 hover:text-purple-300 text-xs flex items-center gap-1"
                          data-testid={`walrus-link-${bet.id}`}
                        >
                          🐋 {bet.walrusBlobId.startsWith('local_') ? 'Receipt on file' : `${bet.walrusBlobId.slice(0, 10)}...`} View Receipt
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        {(bet.status === 'won' || bet.status === 'paid_out') && (
                          <Link
                            href={`/walrus-receipt/${bet.walrusBlobId}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors"
                            style={{
                              background: 'linear-gradient(135deg, rgba(234,179,8,0.15), rgba(16,185,129,0.1))',
                              borderColor: 'rgba(234,179,8,0.3)',
                              color: '#fbbf24',
                            }}
                            data-testid={`nft-trophy-link-${bet.id}`}
                          >
                            🏆 NFT Trophy
                          </Link>
                        )}
                      </div>
                    )}
                    {bet.status === 'pending' && bet.stake > 0 && (
                      <div className="mt-2">
                        <button
                          onClick={() => handleCashOut(bet)}
                          disabled={cashOutMutation.isPending}
                          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all ${
                            cashOutMutation.isPending
                              ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                              : cashingOut === bet.id
                                ? 'bg-orange-500 hover:bg-orange-400 text-black shadow-lg shadow-orange-500/20'
                                : 'bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 border border-yellow-500/30'
                          }`}
                          data-testid={`btn-cashout-${bet.id}`}
                        >
                          <DollarSign className="h-3.5 w-3.5" />
                          {cashOutMutation.isPending 
                            ? 'Processing...' 
                            : cashingOut === bet.id 
                              ? `Confirm: ${getCashOutEstimate(bet).toFixed(2)} ${bet.currency || 'SUI'}` 
                              : `Cash Out ~${getCashOutEstimate(bet).toFixed(2)} ${bet.currency || 'SUI'}`}
                        </button>
                        {cashingOut === bet.id && (
                          <>
                            {cashOutEstimates[bet.id]?.legs && (
                              <p className="text-[10px] text-green-400 mt-1">
                                {cashOutEstimates[bet.id].legs!.filter((l: any) => l.won === true).length}/{cashOutEstimates[bet.id].legs!.length} legs won - value updated
                              </p>
                            )}
                            <p className="text-[10px] text-gray-500 mt-0.5">Server-computed odds. 1% fee. Tap to confirm.</p>
                          </>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={async () => {
                          const b = bet as any;
                          const extId = b.externalEventId || '';
                          const eventId = (extId && !extId.startsWith('parlay_') && !extId.startsWith('sync_'))
                            ? extId
                            : String(b.eventId || b.id || '');
                          if (!eventId) {
                            toast({ title: 'Cannot Copy', description: 'Event info missing.', variant: 'destructive' });
                            return;
                          }
                          try {
                            const resp = await fetch(`/api/events/check/${encodeURIComponent(eventId)}`);
                            const data = resp.ok ? await resp.json() : { available: false };
                            if (!data.available) {
                              const settled = ['won','paid_out','lost','void'].includes(bet.status);
                              toast({
                                title: 'Event No Longer Available',
                                description: settled
                                  ? 'This bet has already settled. The event is no longer open.'
                                  : 'This event has ended or is unavailable.',
                                variant: 'destructive',
                              });
                              return;
                            }
                            addBet({
                              id: `copy-${bet.id}-${Date.now()}`,
                              eventId,
                              eventName: bet.eventName || 'Copied Bet',
                              selectionName: bet.selection || b.prediction || 'Pick',
                              odds: bet.odds || 1,
                              stake: 0,
                              market: b.marketId || 'match-winner',
                              currency: (bet.currency || 'SUI') as 'SUI' | 'SBETS',
                              homeTeam: data.homeTeam || b.homeTeam,
                              awayTeam: data.awayTeam || b.awayTeam,
                            });
                            toast({ title: 'Bet Copied!', description: 'Added to your bet slip. Set your stake and place it!' });
                          } catch {
                            toast({ title: 'Copy failed', variant: 'destructive' });
                          }
                        }}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-cyan-400 transition-colors"
                        data-testid={`button-copy-bet-${bet.id}`}
                      >
                        <Copy className="h-4 w-4" />
                        Copy Bet
                      </button>
                      <button
                        onClick={() => setShareBet(bet)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-cyan-400 transition-colors"
                        data-testid={`button-share-${bet.id}`}
                      >
                        <Share2 className="h-4 w-4" />
                        Share
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Shareable Bet Card Modal */}
      {shareBet && (
        <ShareableBetCard
          bet={{
            id: shareBet.id,
            numericId: shareBet.numericId,
            eventName: getBetDisplayName(shareBet),
            prediction: getSelectionDisplay(shareBet),
            odds: shareBet.odds || 1,
            betAmount: shareBet.stake || 0,
            potentialPayout: shareBet.potentialWin || (shareBet.stake * shareBet.odds),
            currency: shareBet.currency || 'SUI',
            status: shareBet.status,
            createdAt: shareBet.placedAt,
            txHash: shareBet.txHash,
          }}
          isParlay={isParlay(shareBet)}
          parlayLegs={isParlay(shareBet) ? getParlaySelections(shareBet).map(leg => ({
            eventName: leg.eventName,
            selection: leg.selection || (leg as any).prediction || 'Pick',
            odds: leg.odds
          })) : []}
          isOpen={!!shareBet}
          onClose={() => setShareBet(null)}
        />
      )}
    </div>
  );
}
