import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import Layout from "@/components/layout/Layout";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp,
  Wallet,
  Users,
  CheckCircle2,
  ChartLine,
  Coins,
  Gift,
  Droplets,
  ArrowRight,
  ExternalLink,
  Shield,
  Zap,
  CircleDollarSign,
  BarChart3,
  Clock
} from "lucide-react";

interface RevenueStats {
  success: boolean;
  weekStart: string;
  weekEnd: string;
  totalRevenue: number;
  allTimeRevenue: number;
  totalRevenueSui?: number;
  totalRevenueSbets?: number;
  allTimeRevenueSui?: number;
  allTimeRevenueSbets?: number;
  distribution: {
    holders: { percentage: number; amount: number; sui?: number; sbets?: number };
    treasury: { percentage: number; amount: number; sui?: number; sbets?: number };
    profit?: { percentage: number; amount: number; sui?: number; sbets?: number };
    lp?: { percentage: number; amount: number; sui?: number; sbets?: number };
  };
  onChainData: {
    treasuryBalance: number;
    treasuryBalanceSbets: number;
    totalBets: number;
    totalVolume: number;
    accruedFees: number;
  };
  historicalRevenue: Array<{ week: string; revenue: number }>;
  lastUpdated: number;
}

interface ClaimableData {
  success: boolean;
  walletAddress: string;
  sbetsBalance: number;
  sharePercentage: string;
  weeklyRevenuePool: number;
  claimableAmount: number;
  weeklyRevenuePoolSui?: number;
  weeklyRevenuePoolSbets?: number;
  claimableSui?: number;
  claimableSbets?: number;
  alreadyClaimed: boolean;
  lastClaimTxHash: string | null;
  claimHistory: Array<{ amountSui: number; amountSbets: number; timestamp: number; txHash: string; txHashSbets?: string }>;
  lastUpdated: number;
}

interface LpClaimableData {
  success: boolean;
  walletAddress: string;
  hasPosition: boolean;
  lpSharePercentage: string;
  userLiquidity: number;
  totalLiquidity: number;
  positions: Array<{ positionId: string; liquidity: number; sharePercentage: number; isBurned: boolean }>;
  weeklyRevenuePoolSui?: number;
  weeklyRevenuePoolSbets?: number;
  claimableSui?: number;
  claimableSbets?: number;
  alreadyClaimed: boolean;
  lastClaimTxHash: string | null;
  claimHistory: Array<{ amountSui: number; amountSbets: number; timestamp: number; txHash: string; txHashSbets?: string }>;
  lastUpdated: number;
}

const DONUT_SEGMENTS = [
  { label: "SBETS Holders", color: "#f59e0b", icon: Users },
  { label: "LP Providers", color: "#06b6d4", icon: Droplets },
  { label: "Treasury", color: "#3b82f6", icon: Shield },
  { label: "Platform", color: "#10b981", icon: TrendingUp },
];

function DonutChart() {
  const size = 200;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = 4;
  const segmentLength = (circumference - gap * 4) / 4;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
        {DONUT_SEGMENTS.map((seg, i) => {
          const offset = i * (segmentLength + gap);
          return (
            <circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 6px ${seg.color}50)` }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">25%</span>
        <span className="text-xs text-blue-300">Each Pool</span>
      </div>
    </div>
  );
}

export default function RevenuePage() {
  const { user, walletAddress } = useAuth();
  const { toast } = useToast();
  const [isClaimingHolder, setIsClaimingHolder] = useState(false);
  const [isClaimingLp, setIsClaimingLp] = useState(false);

  const { data: revenueStats, isLoading: statsLoading } = useQuery<RevenueStats>({
    queryKey: ['/api/revenue/stats'],
    refetchInterval: 30000,
  });

  const { data: claimableData, isLoading: claimableLoading, refetch: refetchClaimable } = useQuery<ClaimableData>({
    queryKey: ['/api/revenue/claimable', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return null;
      const res = await fetch(`/api/revenue/claimable/${walletAddress}`);
      if (!res.ok) throw new Error('Failed to fetch claimable');
      return res.json();
    },
    enabled: !!walletAddress,
    refetchInterval: 15000,
  });

  const { data: lpClaimableData, isLoading: lpClaimableLoading, refetch: refetchLpClaimable } = useQuery<LpClaimableData>({
    queryKey: ['/api/revenue/lp-claimable', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return null;
      const res = await fetch(`/api/revenue/lp-claimable/${walletAddress}`);
      if (!res.ok) throw new Error('Failed to fetch LP claimable');
      return res.json();
    },
    enabled: !!walletAddress,
    refetchInterval: 15000,
  });

  const holderClaimMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/revenue/claim", { walletAddress });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to claim rewards');
      }
      return response.json();
    },
    onSuccess: (data) => {
      const suiAmount = data.claimedSui || data.claimedAmount || 0;
      const sbetsAmount = data.claimedSbets || 0;
      const suiTx = data.suiTxHash || data.txHash;
      let rewardText = '';
      if (suiAmount > 0) rewardText += `${suiAmount.toFixed(4)} SUI`;
      if (sbetsAmount > 0) rewardText += `${suiAmount > 0 ? ' + ' : ''}${formatCurrency(sbetsAmount, 'SBETS')}`;
      toast({
        title: "Rewards Claimed Successfully!",
        description: `${rewardText} has been sent to your wallet. Thanks for holding SBETS!${suiTx ? ` TX: ${suiTx.slice(0, 12)}...` : ''}`,
      });
      refetchClaimable();
      refetchLpClaimable();
      queryClient.invalidateQueries({ queryKey: ['/api/revenue/stats'] });
    },
    onError: (error: any) => {
      toast({ title: "Claim Failed", description: error.message || "Failed to claim rewards", variant: "destructive" });
    },
  });

  const lpClaimMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/revenue/lp-claim", { walletAddress });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to claim LP rewards');
      }
      return response.json();
    },
    onSuccess: (data) => {
      const suiAmount = data.claimedSui || 0;
      const sbetsAmount = data.claimedSbets || 0;
      const suiTx = data.suiTxHash;
      let rewardText = '';
      if (suiAmount > 0) rewardText += `${suiAmount.toFixed(4)} SUI`;
      if (sbetsAmount > 0) rewardText += `${suiAmount > 0 ? ' + ' : ''}${formatCurrency(sbetsAmount, 'SBETS')}`;
      toast({
        title: "LP Rewards Claimed Successfully!",
        description: `${rewardText} has been sent to your wallet. Thanks for providing liquidity!${suiTx ? ` TX: ${suiTx.slice(0, 12)}...` : ''}`,
      });
      refetchClaimable();
      refetchLpClaimable();
      queryClient.invalidateQueries({ queryKey: ['/api/revenue/stats'] });
    },
    onError: (error: any) => {
      toast({ title: "LP Claim Failed", description: error.message || "Failed to claim LP rewards", variant: "destructive" });
    },
  });

  const handleHolderClaim = async () => {
    if (!walletAddress) {
      toast({ title: "Wallet Not Connected", description: "Please connect your wallet first", variant: "destructive" });
      return;
    }
    const hasClaimable = (claimableData?.claimableSui || 0) > 0 || (claimableData?.claimableSbets || 0) > 0;
    if (!hasClaimable) {
      toast({ title: "Nothing to Claim", description: "No accumulated holder rewards available to claim", variant: "destructive" });
      return;
    }
    setIsClaimingHolder(true);
    try { await holderClaimMutation.mutateAsync(); } finally { setIsClaimingHolder(false); }
  };

  const handleLpClaim = async () => {
    if (!walletAddress) {
      toast({ title: "Wallet Not Connected", description: "Please connect your wallet first", variant: "destructive" });
      return;
    }
    const hasClaimable = (lpClaimableData?.claimableSui || 0) > 0 || (lpClaimableData?.claimableSbets || 0) > 0;
    if (!hasClaimable) {
      toast({ title: "Nothing to Claim", description: "No accumulated LP rewards available to claim", variant: "destructive" });
      return;
    }
    setIsClaimingLp(true);
    try { await lpClaimMutation.mutateAsync(); } finally { setIsClaimingLp(false); }
  };

  const formatCurrency = (amount: number, currency: string = 'SUI') => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M ${currency}`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(2)}K ${currency}`;
    return `${amount.toFixed(4)} ${currency}`;
  };

  const SUI_PRICE_USD = 1.50;
  const SBETS_PRICE_USD = 0.000001;
  const formatUSD = (usdValue: number) => `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  const toUSD = (suiAmount: number, sbetsAmount: number = 0) => (suiAmount * SUI_PRICE_USD) + (sbetsAmount * SBETS_PRICE_USD);

  if (statsLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-[50vh]">
          <Loader size="lg" />
        </div>
      </Layout>
    );
  }

  const holderHasClaimable = (claimableData?.claimableSui || 0) > 0 || (claimableData?.claimableSbets || 0) > 0;
  const lpHasClaimable = (lpClaimableData?.claimableSui || 0) > 0 || (lpClaimableData?.claimableSbets || 0) > 0;

  return (
    <Layout>
      <div
        className="min-h-screen relative"
        style={{ background: 'linear-gradient(180deg, #060e1f 0%, #0a1a35 40%, #0d1f3c 70%, #060e1f 100%)' }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px]" style={{ background: 'radial-gradient(ellipse at center, rgba(59, 130, 246, 0.08) 0%, transparent 70%)' }} />
          <div className="absolute bottom-0 left-0 right-0 h-1/3" style={{ background: 'radial-gradient(ellipse at center bottom, rgba(6, 182, 212, 0.06) 0%, transparent 70%)' }} />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-4 py-8 space-y-8">

          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium text-cyan-300 border border-cyan-500/30" style={{ background: 'rgba(6, 182, 212, 0.1)' }}>
              <Zap className="w-3 h-3" />
              On-Chain Revenue Distribution
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
              Revenue <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Sharing</span>
            </h1>
            <p className="text-blue-300/70 max-w-lg mx-auto text-sm">
              100% of platform revenue is distributed transparently on the Sui blockchain. Hold SBETS or provide liquidity to earn your share.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="relative rounded-xl p-4 border border-white/[0.06] overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)' }}>
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="text-xs text-gray-400 font-medium" data-testid="text-weekly-revenue-title">This Week</span>
              </div>
              <div className="text-lg font-bold text-white" data-testid="text-weekly-revenue-sui">
                {(revenueStats?.totalRevenueSui || 0).toFixed(4)} <span className="text-sm text-gray-400">SUI</span>
              </div>
              <div className="text-sm font-semibold text-cyan-300" data-testid="text-weekly-revenue-sbets">
                {formatCurrency(revenueStats?.totalRevenueSbets || 0, 'SBETS')}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {formatUSD(toUSD(revenueStats?.totalRevenueSui || 0, revenueStats?.totalRevenueSbets || 0))}
              </div>
            </div>

            <div className="relative rounded-xl p-4 border border-white/[0.06] overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)' }}>
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-green-400/30 to-transparent" />
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-green-400" />
                <span className="text-xs text-gray-400 font-medium">All-Time</span>
              </div>
              <div className="text-lg font-bold text-white">
                {(revenueStats?.allTimeRevenueSui || 0).toFixed(4)} <span className="text-sm text-gray-400">SUI</span>
              </div>
              <div className="text-sm font-semibold text-cyan-300">
                {formatCurrency(revenueStats?.allTimeRevenueSbets || 0, 'SBETS')}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {formatUSD(toUSD(revenueStats?.allTimeRevenueSui || 0, revenueStats?.allTimeRevenueSbets || 0))}
              </div>
            </div>

            <div className="relative rounded-xl p-4 border border-white/[0.06] overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)' }}>
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400/30 to-transparent" />
              <div className="flex items-center gap-2 mb-2">
                <CircleDollarSign className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-gray-400 font-medium">Total Bets</span>
              </div>
              <div className="text-xl font-bold text-white" data-testid="text-total-bets">
                {(revenueStats?.onChainData?.totalBets || 0).toLocaleString()}
              </div>
            </div>

            <div className="relative rounded-xl p-4 border border-white/[0.06] overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)' }}>
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-violet-400/30 to-transparent" />
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-violet-400" />
                <span className="text-xs text-gray-400 font-medium">SBETS Treasury</span>
              </div>
              <div className="text-lg font-bold text-white" data-testid="text-treasury-sbets">
                {formatCurrency(revenueStats?.onChainData?.treasuryBalanceSbets || 0, 'SBETS')}
              </div>
            </div>
          </div>

          <div
            className="rounded-2xl border border-white/[0.06] overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)' }}
          >
            <div className="p-6">
              <h3 className="text-center text-sm font-medium text-gray-400 uppercase tracking-wider mb-6">Revenue Distribution Model</h3>

              <div className="flex flex-col md:flex-row items-center gap-8">
                <div className="flex-shrink-0">
                  <DonutChart />
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                  {DONUT_SEGMENTS.map((seg) => {
                    const Icon = seg.icon;
                    return (
                      <div
                        key={seg.label}
                        className="flex items-center gap-3 rounded-xl p-3 border border-white/[0.06] transition-all hover:border-white/[0.12]"
                        style={{ background: `linear-gradient(135deg, ${seg.color}08 0%, transparent 100%)` }}
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${seg.color}18`, border: `1px solid ${seg.color}30` }}
                        >
                          <Icon className="w-5 h-5" style={{ color: seg.color }} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">{seg.label}</div>
                          <div className="text-xs text-gray-400">25% of revenue</div>
                        </div>
                        <div className="ml-auto text-lg font-bold" style={{ color: seg.color }}>25%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {walletAddress ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              <div
                className="rounded-2xl border overflow-hidden relative"
                style={{
                  borderColor: holderHasClaimable ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255,255,255,0.06)',
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, rgba(15, 23, 42, 0.6) 100%)',
                  boxShadow: holderHasClaimable ? '0 0 30px rgba(245, 158, 11, 0.08)' : 'none'
                }}
              >
                {holderHasClaimable && (
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
                )}

                <div className="p-6 space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                      <Users className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">SBETS Holder Rewards</h3>
                      <p className="text-xs text-gray-400">Earn by holding SBETS tokens</p>
                    </div>
                  </div>

                  {claimableLoading ? (
                    <div className="flex justify-center py-8"><Loader size="md" /></div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl p-3 border border-amber-500/10" style={{ background: 'rgba(245, 158, 11, 0.05)' }}>
                          <div className="text-xs text-gray-400 mb-1">Your SBETS</div>
                          <div className="text-lg font-bold text-white truncate" data-testid="text-user-sbets-balance">
                            {(claimableData?.sbetsBalance || 0).toLocaleString()}
                          </div>
                        </div>
                        <div className="rounded-xl p-3 border border-amber-500/10" style={{ background: 'rgba(245, 158, 11, 0.05)' }}>
                          <div className="text-xs text-gray-400 mb-1">Your Share</div>
                          <div className="text-lg font-bold text-white" data-testid="text-user-holder-share">
                            {claimableData?.sharePercentage || '0'}%
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl p-5 text-center border border-amber-500/15" style={{ background: 'linear-gradient(180deg, rgba(245, 158, 11, 0.06) 0%, rgba(245, 158, 11, 0.02) 100%)' }}>
                        <div className="text-xs text-amber-300/80 mb-2 flex items-center justify-center gap-1.5">
                          <Gift className="w-3.5 h-3.5" />
                          Claimable Rewards
                        </div>
                        <div className="text-2xl font-bold text-white mb-0.5" data-testid="text-holder-claimable-sui">
                          {(claimableData?.claimableSui || 0).toFixed(4)} SUI
                        </div>
                        <div className="text-lg font-semibold text-cyan-300 mb-0.5" data-testid="text-holder-claimable-sbets">
                          {formatCurrency(claimableData?.claimableSbets || 0, 'SBETS')}
                        </div>
                        <div className="text-xs text-gray-500 mb-4">
                          {formatUSD(toUSD(claimableData?.claimableSui || 0, claimableData?.claimableSbets || 0))}
                        </div>

                        {claimableData?.alreadyClaimed ? (
                          <div className="rounded-lg p-3 border border-green-500/20" style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                            <div className="flex items-center justify-center gap-2 text-green-400 text-sm font-medium">
                              <CheckCircle2 className="w-4 h-4" />
                              Recently Claimed
                            </div>
                            {claimableData.lastClaimTxHash && (
                              <a
                                href={`https://suivision.xyz/txblock/${claimableData.lastClaimTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-flex items-center gap-1"
                                data-testid="link-holder-claim-tx"
                              >
                                View TX <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <Button
                            onClick={handleHolderClaim}
                            disabled={isClaimingHolder || !holderHasClaimable}
                            className="w-full py-3 text-sm font-bold rounded-xl border-0 transition-all"
                            style={{
                              background: holderHasClaimable
                                ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                : 'rgba(245, 158, 11, 0.15)',
                              color: holderHasClaimable ? '#fff' : 'rgba(245, 158, 11, 0.5)',
                              boxShadow: holderHasClaimable ? '0 4px 20px rgba(245, 158, 11, 0.3)' : 'none'
                            }}
                            data-testid="button-claim-holder-rewards"
                          >
                            {isClaimingHolder ? (
                              <div className="flex items-center gap-2"><Loader size="sm" />Claiming...</div>
                            ) : (
                              <span className="flex items-center justify-center gap-2">CLAIM REWARDS <ArrowRight className="w-4 h-4" /></span>
                            )}
                          </Button>
                        )}
                      </div>

                      {claimableData?.claimHistory && claimableData.claimHistory.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-2">Recent Claims</div>
                          <div className="space-y-1.5 max-h-32 overflow-y-auto">
                            {claimableData.claimHistory.slice(0, 5).map((claim, i) => (
                              <div key={i} className="flex items-center justify-between text-xs rounded-lg px-3 py-2 border border-white/[0.04]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <span className="text-gray-400">{new Date(claim.timestamp).toLocaleDateString()}</span>
                                <span className="text-white font-medium">
                                  {claim.amountSui > 0 ? `${claim.amountSui.toFixed(4)} SUI` : ''}
                                  {claim.amountSui > 0 && claim.amountSbets > 0 ? ' + ' : ''}
                                  {claim.amountSbets > 0 ? formatCurrency(claim.amountSbets, 'SBETS') : ''}
                                </span>
                                {claim.txHash && (
                                  <a href={`https://suivision.xyz/txblock/${claim.txHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div
                className="rounded-2xl border overflow-hidden relative"
                style={{
                  borderColor: lpHasClaimable ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255,255,255,0.06)',
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.04) 0%, rgba(15, 23, 42, 0.6) 100%)',
                  boxShadow: lpHasClaimable ? '0 0 30px rgba(6, 182, 212, 0.08)' : 'none'
                }}
              >
                {lpHasClaimable && (
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
                )}

                <div className="p-6 space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(6, 182, 212, 0.15)', border: '1px solid rgba(6, 182, 212, 0.25)' }}>
                      <Droplets className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">Cetus LP Rewards</h3>
                      <p className="text-xs text-gray-400">Earn by providing liquidity</p>
                    </div>
                  </div>

                  {lpClaimableLoading ? (
                    <div className="flex justify-center py-8"><Loader size="md" /></div>
                  ) : !lpClaimableData?.hasPosition ? (
                    <div className="text-center space-y-4 py-4">
                      <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center" style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.15)' }}>
                        <Droplets className="w-8 h-8 text-cyan-400/50" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-300 mb-1">No liquidity position found</p>
                        <p className="text-xs text-gray-500">Provide SBETS-SUI liquidity on Cetus to earn 25% of revenue</p>
                      </div>
                      <a
                        href="https://app.cetus.zone/clmm?tab=deposit&poolAddress=0xa809b51ec650e4ae45224107e62787be5e58f9caf8d3f74542f8edd73dc37a50"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all hover:scale-[1.02]"
                        style={{ background: 'linear-gradient(135deg, #06b6d4, #0891b2)', boxShadow: '0 4px 15px rgba(6, 182, 212, 0.25)' }}
                        data-testid="link-add-liquidity-cetus"
                      >
                        <Droplets className="w-4 h-4" />
                        Add Liquidity on Cetus
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl p-3 border border-cyan-500/10" style={{ background: 'rgba(6, 182, 212, 0.05)' }}>
                          <div className="text-xs text-gray-400 mb-1">LP Share</div>
                          <div className="text-lg font-bold text-white" data-testid="text-user-lp-share">
                            {lpClaimableData?.lpSharePercentage || '0'}%
                          </div>
                        </div>
                        <div className="rounded-xl p-3 border border-cyan-500/10" style={{ background: 'rgba(6, 182, 212, 0.05)' }}>
                          <div className="text-xs text-gray-400 mb-1">Positions</div>
                          <div className="text-lg font-bold text-white" data-testid="text-user-lp-positions">
                            {lpClaimableData?.positions?.length || 0}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl p-5 text-center border border-cyan-500/15" style={{ background: 'linear-gradient(180deg, rgba(6, 182, 212, 0.06) 0%, rgba(6, 182, 212, 0.02) 100%)' }}>
                        <div className="text-xs text-cyan-300/80 mb-2 flex items-center justify-center gap-1.5">
                          <Gift className="w-3.5 h-3.5" />
                          Claimable Rewards
                        </div>
                        <div className="text-2xl font-bold text-white mb-0.5" data-testid="text-lp-claimable-sui">
                          {(lpClaimableData?.claimableSui || 0).toFixed(4)} SUI
                        </div>
                        <div className="text-lg font-semibold text-cyan-300 mb-0.5" data-testid="text-lp-claimable-sbets">
                          {formatCurrency(lpClaimableData?.claimableSbets || 0, 'SBETS')}
                        </div>
                        <div className="text-xs text-gray-500 mb-4">
                          {formatUSD(toUSD(lpClaimableData?.claimableSui || 0, lpClaimableData?.claimableSbets || 0))}
                        </div>

                        {lpClaimableData?.alreadyClaimed ? (
                          <div className="rounded-lg p-3 border border-green-500/20" style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                            <div className="flex items-center justify-center gap-2 text-green-400 text-sm font-medium">
                              <CheckCircle2 className="w-4 h-4" />
                              Recently Claimed
                            </div>
                            {lpClaimableData.lastClaimTxHash && (
                              <a
                                href={`https://suivision.xyz/txblock/${lpClaimableData.lastClaimTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-flex items-center gap-1"
                                data-testid="link-lp-claim-tx"
                              >
                                View TX <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <Button
                            onClick={handleLpClaim}
                            disabled={isClaimingLp || !lpHasClaimable}
                            className="w-full py-3 text-sm font-bold rounded-xl border-0 transition-all"
                            style={{
                              background: lpHasClaimable
                                ? 'linear-gradient(135deg, #06b6d4, #0891b2)'
                                : 'rgba(6, 182, 212, 0.15)',
                              color: lpHasClaimable ? '#fff' : 'rgba(6, 182, 212, 0.5)',
                              boxShadow: lpHasClaimable ? '0 4px 20px rgba(6, 182, 212, 0.3)' : 'none'
                            }}
                            data-testid="button-claim-lp-rewards"
                          >
                            {isClaimingLp ? (
                              <div className="flex items-center gap-2"><Loader size="sm" />Claiming...</div>
                            ) : (
                              <span className="flex items-center justify-center gap-2">CLAIM LP REWARDS <ArrowRight className="w-4 h-4" /></span>
                            )}
                          </Button>
                        )}
                      </div>

                      <a
                        href="https://app.cetus.zone/clmm?tab=deposit&poolAddress=0xa809b51ec650e4ae45224107e62787be5e58f9caf8d3f74542f8edd73dc37a50"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors py-1"
                        data-testid="link-add-more-liquidity-cetus"
                      >
                        <Droplets className="w-3 h-3" />
                        Add More Liquidity on Cetus
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      {lpClaimableData?.claimHistory && lpClaimableData.claimHistory.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-2">Recent Claims</div>
                          <div className="space-y-1.5 max-h-32 overflow-y-auto">
                            {lpClaimableData.claimHistory.slice(0, 5).map((claim, i) => (
                              <div key={i} className="flex items-center justify-between text-xs rounded-lg px-3 py-2 border border-white/[0.04]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <span className="text-gray-400">{new Date(claim.timestamp).toLocaleDateString()}</span>
                                <span className="text-white font-medium">
                                  {claim.amountSui > 0 ? `${claim.amountSui.toFixed(4)} SUI` : ''}
                                  {claim.amountSui > 0 && claim.amountSbets > 0 ? ' + ' : ''}
                                  {claim.amountSbets > 0 ? formatCurrency(claim.amountSbets, 'SBETS') : ''}
                                </span>
                                {claim.txHash && (
                                  <a href={`https://suivision.xyz/txblock/${claim.txHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              className="rounded-2xl border border-white/[0.06] overflow-hidden text-center p-10"
              style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.04) 0%, rgba(15, 23, 42, 0.6) 100%)' }}
            >
              <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4" style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <Wallet className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto">
                Connect your Sui wallet to view your SBETS holder rewards and LP provider earnings. Claim weekly revenue directly to your wallet.
              </p>
            </div>
          )}

          <div
            className="rounded-2xl border border-white/[0.06] overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)' }}
          >
            <div className="p-6">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-6">How Revenue Sharing Works</h3>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  { step: 1, title: "Platform Earns", desc: "Revenue from settled bets and platform fees", icon: CircleDollarSign, color: "#f59e0b" },
                  { step: 2, title: "Revenue Split", desc: "Automatically distributed 25% to each pool", icon: Zap, color: "#3b82f6" },
                  { step: 3, title: "Shares Calculated", desc: "Your share based on SBETS holdings or LP position", icon: BarChart3, color: "#06b6d4" },
                  { step: 4, title: "Claim Rewards", desc: "Claim SUI and SBETS directly to your wallet weekly", icon: Gift, color: "#10b981" },
                ].map((item, i) => (
                  <div key={item.step} className="relative">
                    {i < 3 && (
                      <div className="hidden md:block absolute top-6 right-0 translate-x-1/2 z-10">
                        <ArrowRight className="w-4 h-4 text-gray-600" />
                      </div>
                    )}
                    <div className="flex flex-col items-center text-center space-y-3 p-4">
                      <div className="relative">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}>
                          <item.icon className="w-6 h-6" style={{ color: item.color }} />
                        </div>
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: item.color }}>
                          {item.step}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white mb-1">{item.title}</div>
                        <div className="text-xs text-gray-400 leading-relaxed">{item.desc}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {revenueStats?.historicalRevenue && revenueStats.historicalRevenue.length > 0 && (() => {
            const weeks = revenueStats.historicalRevenue.slice(0, 7).reverse();
            const maxRevenue = Math.max(...weeks.map(w => w.revenue), 0.001);
            const chartHeight = 200;
            return (
              <div
                className="rounded-2xl border border-white/[0.06] overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)' }}
              >
                <div className="p-6">
                  <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-6">
                    <ChartLine className="w-4 h-4 text-blue-400" />
                    Weekly Revenue History
                  </h3>

                  <div className="flex items-end gap-3" style={{ height: `${chartHeight}px` }}>
                    {weeks.map((week, index) => {
                      const barHeight = Math.max((week.revenue / maxRevenue) * (chartHeight - 30), 8);
                      const weekLabel = week.week ? week.week.slice(5) : '';
                      const isLatest = index === weeks.length - 1;
                      return (
                        <div key={week.week} className="flex-1 flex flex-col items-center justify-end h-full group" style={{ minWidth: '40px', maxWidth: '120px' }}>
                          <div className="text-xs text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            {formatCurrency(week.revenue)}
                          </div>
                          <div
                            className="w-full rounded-t-lg transition-all duration-300 cursor-pointer"
                            style={{
                              height: `${barHeight}px`,
                              background: isLatest
                                ? 'linear-gradient(180deg, #06b6d4, #0891b2)'
                                : 'linear-gradient(180deg, rgba(59, 130, 246, 0.7), rgba(59, 130, 246, 0.3))',
                              boxShadow: isLatest ? '0 0 15px rgba(6, 182, 212, 0.3)' : 'none'
                            }}
                          />
                          <div className={`text-xs mt-2 ${isLatest ? 'text-cyan-400 font-medium' : 'text-gray-500'}`}>{weekLabel}</div>
                        </div>
                      );
                    })}
                  </div>

                  {weeks.length < 3 && (
                    <div className="text-xs text-gray-500 text-center mt-4">
                      More data will appear as weekly revenue accumulates
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div
            className="rounded-2xl border border-white/[0.06] overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)' }}
          >
            <div className="p-6">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" />
                On-Chain Treasury
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "SUI Balance", value: `${(revenueStats?.onChainData?.treasuryBalance || 0).toFixed(2)} SUI`, testId: "text-treasury-sui" },
                  { label: "SBETS Balance", value: formatCurrency(revenueStats?.onChainData?.treasuryBalanceSbets || 0, 'SBETS'), testId: "text-treasury-sbets" },
                  { label: "Total Bets", value: (revenueStats?.onChainData?.totalBets || 0).toLocaleString(), testId: "text-total-bets" },
                  { label: "Total Volume", value: `${(revenueStats?.onChainData?.totalVolume || 0).toFixed(2)} SUI`, testId: "text-total-volume" },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl p-3 text-center border border-white/[0.04]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                    <div className="text-base font-bold text-white truncate" data-testid={item.testId}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  );
}
