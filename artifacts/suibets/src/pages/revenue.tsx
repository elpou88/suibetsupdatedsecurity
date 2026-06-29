import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader } from "@/components/ui/loader";
import {
  BarChart3,
  CircleDollarSign,
  Layers,
  TrendingUp,
  ShieldCheck,
  Zap,
  BookOpen,
  Gift,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Wallet,
  Lock,
  Flame,
  ArrowRight,
  Globe,
  Code2,
  Users,
  PieChart,
} from "lucide-react";
import { useCurrentAccount, useSignPersonalMessage } from "@/lib/dapp-kit-compat";
import { useToast } from "@/hooks/use-toast";
import SuiNSName from "@/components/SuiNSName";

interface P2PRevenueStats {
  totalSettledBets: number;
  totalPlatformFeeSui: number;
  totalVolumeSui: number;
  openOffersCount: number;
  openParlaysCount: number;
  weeklyHistory: Array<{ week: string; fees: number; volume: number; count: number }>;
  currencyBreakdown: Array<{ currency: string; fees: number; volume: number; count: number }>;
  contractEnabled: boolean;
  network: string;
}

interface ClaimableInfo {
  success: boolean;
  sbetsBalance: number;
  sharePercentage: string;
  claimableSui: number;
  claimableSbets: number;
  claimableUsdsui: number;
  claimableUsdc: number;
  claimableLbtc: number;
  vaultSui: number;
  vaultSbets: number;
  vaultUsdsui: number;
  vaultUsdc: number;
  vaultLbtc: number;
  alreadyClaimed: boolean;
  lastClaimTxHash: string | null;
  claimHistory: Array<{ amountSui: number; amountSbets: number; timestamp: number; txHash: string }>;
  weeklyRevenuePoolSui: number;
  weeklyRevenuePoolSbets: number;
  weeklyRevenuePoolUsdsui: number;
  weeklyRevenuePoolUsdc: number;
  weeklyRevenuePoolLbtc: number;
}

const CURRENCY_COLORS: Record<string, string> = {
  SUI:    '#06b6d4',
  SBETS:  '#a855f7',
  USDSUI: '#14b8a6',
  USDC:   '#10b981',
  LBTC:   '#f97316',
};

function WeeklyBarChart({ weeks }: { weeks: P2PRevenueStats['weeklyHistory'] }) {
  if (!weeks || weeks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32" style={{ color: '#374151' }}>
        <BarChart3 className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">Revenue data will appear once bets are settled</p>
      </div>
    );
  }
  const maxFees = Math.max(...weeks.map(w => w.fees), 0.0001);
  const chartH = 80;
  return (
    <div className="flex items-end gap-1.5" style={{ height: `${chartH + 28}px` }}>
      {weeks.map((w, i) => {
        const barH = Math.max((w.fees / maxFees) * chartH, 4);
        const label = w.week ? w.week.slice(5) : '';
        const isLatest = i === weeks.length - 1;
        return (
          <div key={w.week ?? i} className="flex-1 flex flex-col items-center justify-end group" style={{ minWidth: 32 }}>
            <div className="text-[10px] mb-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap" style={{ color: '#6b7280' }}>
              {w.fees > 0 ? `${w.fees.toFixed(4)} SUI` : '—'}
            </div>
            <div
              className="w-full rounded-t-md transition-all cursor-pointer"
              style={{
                height: `${barH}px`,
                background: isLatest
                  ? 'linear-gradient(180deg, #00ffff, #06b6d4)'
                  : 'linear-gradient(180deg, rgba(0,255,255,0.35), rgba(0,255,255,0.1))',
                boxShadow: isLatest ? '0 0 12px rgba(0,255,255,0.25)' : 'none',
              }}
            />
            <div className={`text-[10px] mt-1.5 ${isLatest ? 'text-cyan-400 font-semibold' : ''}`}
              style={!isLatest ? { color: '#374151' } : {}}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClaimPanel({ walletAddress }: { walletAddress: string }) {
  const { toast } = useToast();
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ txHash: string; suiAmount: number; sbetsAmount: number; usdsuiAmount: number; usdcAmount: number; lbtcAmount: number } | null>(null);
  const [claimStep, setClaimStep] = useState<'idle' | 'challenge' | 'signing' | 'submitting'>('idle');
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const { data: claimable, isLoading, refetch } = useQuery<ClaimableInfo>({
    queryKey: ['/api/revenue/claimable', walletAddress],
    queryFn: () => fetch(`/api/revenue/claimable/${walletAddress}`).then(r => r.json()),
    enabled: !!walletAddress,
    refetchInterval: 60_000,
  });

  const handleClaim = async () => {
    if (isClaiming) return;
    setIsClaiming(true);
    try {
      setClaimStep('challenge');
      const challengeRes = await fetch(`/api/revenue/challenge?wallet=${encodeURIComponent(walletAddress)}`);
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok) {
        toast({ title: 'Claim failed', description: challengeData.message || 'Could not get challenge', variant: 'destructive' });
        return;
      }
      const { challenge } = challengeData;
      setClaimStep('signing');
      let signature: string;
      try {
        const result = await signPersonalMessage({ message: new TextEncoder().encode(challenge) });
        signature = result.signature;
      } catch {
        toast({ title: 'Signature cancelled', description: 'You must sign the challenge to prove wallet ownership.', variant: 'destructive' });
        return;
      }
      setClaimStep('submitting');
      const res = await fetch('/api/revenue/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, signature, challenge }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Claim failed', description: data.message || 'Something went wrong', variant: 'destructive' });
        return;
      }
      setClaimResult({ txHash: data.txHash || data.suiTxHash, suiAmount: data.claimedSui || 0, sbetsAmount: data.claimedSbets || 0, usdsuiAmount: data.claimedUsdsui || 0, usdcAmount: data.claimedUsdc || 0, lbtcAmount: data.claimedLbtc || 0 });
      const parts = [];
      if ((data.claimedSui || 0) > 0) parts.push(`${(data.claimedSui || 0).toFixed(4)} SUI`);
      if ((data.claimedSbets || 0) > 0) parts.push(`${(data.claimedSbets || 0).toFixed(2)} SBETS`);
      if ((data.claimedUsdsui || 0) > 0) parts.push(`${(data.claimedUsdsui || 0).toFixed(4)} USDsui`);
      if ((data.claimedUsdc || 0) > 0) parts.push(`${(data.claimedUsdc || 0).toFixed(4)} USDC`);
      if ((data.claimedLbtc || 0) > 0) parts.push(`${(data.claimedLbtc || 0).toFixed(8)} LBTC`);
      toast({ title: 'Revenue claimed!', description: `${parts.join(' + ')} sent to your wallet` });
      refetch();
    } catch (err: any) {
      toast({ title: 'Claim failed', description: err.message || 'Network error', variant: 'destructive' });
    } finally {
      setIsClaiming(false);
      setClaimStep('idle');
    }
  };

  const hasClaim = (claimable?.claimableSui ?? 0) >= 0.001 || (claimable?.claimableSbets ?? 0) >= 1 || (claimable?.claimableUsdsui ?? 0) >= 0.01 || (claimable?.claimableUsdc ?? 0) >= 0.01 || (claimable?.claimableLbtc ?? 0) >= 0.000001;
  const sharePercent = parseFloat(claimable?.sharePercentage ?? '0');
  const claimButtonParts: string[] = [];
  if ((claimable?.claimableSui ?? 0) >= 0.001) claimButtonParts.push(`${(claimable?.claimableSui ?? 0).toFixed(4)} SUI`);
  if ((claimable?.claimableSbets ?? 0) >= 1) claimButtonParts.push(`${(claimable?.claimableSbets ?? 0).toFixed(2)} SBETS`);
  if ((claimable?.claimableUsdsui ?? 0) >= 0.01) claimButtonParts.push(`${(claimable?.claimableUsdsui ?? 0).toFixed(4)} USDsui`);
  if ((claimable?.claimableUsdc ?? 0) >= 0.01) claimButtonParts.push(`${(claimable?.claimableUsdc ?? 0).toFixed(4)} USDC`);
  if ((claimable?.claimableLbtc ?? 0) >= 0.000001) claimButtonParts.push(`${(claimable?.claimableLbtc ?? 0).toFixed(8)} LBTC`);
  const claimButtonLabel = claimButtonParts.length > 0 ? `Claim ${claimButtonParts.join(' + ')}` : 'Claim rewards';

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(0,255,255,0.03)', border: '1px solid rgba(0,255,255,0.12)' }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,255,255,0.1)' }}>
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white">Your revenue share</span>
        </div>
        <span className="text-[10px] font-mono" style={{ color: '#4b5563' }}>{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader size="md" /></div>
      ) : (
        <div className="p-5 space-y-4">
          {claimResult && (
            <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
              <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-green-400">Claim successful!</p>
                <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>
                {claimResult.suiAmount.toFixed(4)} SUI + {claimResult.sbetsAmount.toFixed(2)} SBETS
                {claimResult.usdsuiAmount > 0 && ` + ${claimResult.usdsuiAmount.toFixed(4)} USDsui`}
                {claimResult.usdcAmount > 0 && ` + ${claimResult.usdcAmount.toFixed(4)} USDC`}
                {claimResult.lbtcAmount > 0 && ` + ${claimResult.lbtcAmount.toFixed(8)} LBTC`}
                {' '}sent to your wallet
              </p>
                {claimResult.txHash && (
                  <a href={`https://suiscan.xyz/mainnet/tx/${claimResult.txHash}`} target="_blank" rel="noreferrer"
                    className="text-xs flex items-center gap-1 mt-1 text-cyan-400 hover:text-cyan-300">
                    View on Suiscan <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: 'SBETS held', value: (claimable?.sbetsBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 }), color: '#a855f7', bg: 'rgba(168,85,247,0.06)' },
              { label: 'Your share', value: `${sharePercent.toFixed(4)}%`, color: '#00ffff', bg: 'rgba(0,255,255,0.06)' },
              { label: 'Claimable SUI', value: (claimable?.claimableSui ?? 0).toFixed(4), color: '#4ade80', bg: 'rgba(74,222,128,0.06)' },
              { label: 'Claimable SBETS', value: (claimable?.claimableSbets ?? 0).toFixed(2), color: '#fbbf24', bg: 'rgba(251,191,36,0.06)' },
              { label: 'Claimable USDsui', value: (claimable?.claimableUsdsui ?? 0).toFixed(4), color: '#14b8a6', bg: 'rgba(20,184,166,0.06)' },
              { label: 'Claimable USDC', value: (claimable?.claimableUsdc ?? 0).toFixed(4), color: '#10b981', bg: 'rgba(16,185,129,0.06)' },
              { label: 'Claimable LBTC', value: (claimable?.claimableLbtc ?? 0).toFixed(8), color: '#f97316', bg: 'rgba(249,115,22,0.06)' },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className="rounded-xl p-3" style={{ background: bg, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#4b5563' }}>{label}</div>
                <div className="text-sm font-black" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: '#4b5563' }}>
            <span>Holder pool:</span>
            {(claimable?.weeklyRevenuePoolSui ?? 0) > 0 && (
              <span className="text-cyan-400 font-semibold">{(claimable?.weeklyRevenuePoolSui ?? 0).toFixed(4)} SUI</span>
            )}
            {(claimable?.weeklyRevenuePoolSbets ?? 0) > 0 && (
              <><span>+</span><span className="text-purple-400 font-semibold">{(claimable?.weeklyRevenuePoolSbets ?? 0).toFixed(2)} SBETS</span></>
            )}
            {(claimable?.weeklyRevenuePoolUsdsui ?? 0) > 0 && (
              <><span>+</span><span className="text-teal-400 font-semibold">{(claimable?.weeklyRevenuePoolUsdsui ?? 0).toFixed(4)} USDsui</span></>
            )}
            {(claimable?.weeklyRevenuePoolUsdc ?? 0) > 0 && (
              <><span>+</span><span className="text-emerald-400 font-semibold">{(claimable?.weeklyRevenuePoolUsdc ?? 0).toFixed(4)} USDC</span></>
            )}
            {(claimable?.weeklyRevenuePoolLbtc ?? 0) > 0 && (
              <><span>+</span><span className="text-orange-400 font-semibold">{(claimable?.weeklyRevenuePoolLbtc ?? 0).toFixed(8)} LBTC</span></>
            )}
            <span style={{ color: '#374151' }}>· 25% of all P2P fees</span>
          </div>

          {(claimable?.sbetsBalance ?? 0) <= 0 ? (
            <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}>
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs" style={{ color: '#6b7280' }}>Hold SBETS tokens to earn a share of P2P platform revenue.</p>
            </div>
          ) : !hasClaim ? (
            <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#374151' }} />
              <p className="text-xs" style={{ color: '#4b5563' }}>Nothing to claim yet — your share accrues as bets settle.</p>
            </div>
          ) : (
            <button
              onClick={handleClaim}
              disabled={isClaiming}
              className="w-full py-3 rounded-xl font-black text-black text-sm transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: '#00ffff', boxShadow: '0 0 20px rgba(0,255,255,0.2)' }}
            >
              {isClaiming
                ? (claimStep === 'signing' ? 'Sign in wallet…' : claimStep === 'submitting' ? 'Submitting…' : 'Preparing…')
                : claimButtonLabel}
            </button>
          )}

          {(claimable?.claimHistory?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-bold mb-2" style={{ color: '#4b5563' }}>Claim history</div>
              <div className="space-y-1">
                {(claimable?.claimHistory ?? []).slice(0, 3).map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5" style={{ color: '#6b7280' }}>
                    <span>{new Date(h.timestamp).toLocaleDateString()}</span>
                    <span className="font-mono">
                      {h.amountSui.toFixed(4)} SUI
                      {h.amountSbets > 0 && <span className="text-purple-400"> + {h.amountSbets.toFixed(2)} SBETS</span>}
                    </span>
                    {h.txHash && h.txHash !== 'no_sui' && (
                      <a href={`https://suiscan.xyz/mainnet/tx/${h.txHash}`} target="_blank" rel="noreferrer" className="text-cyan-600 hover:text-cyan-400">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RevenuePage() {
  const account = useCurrentAccount();
  const walletAddress = account?.address ?? null;
  const shortAddr = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : null;

  const handleConnectWallet = () => {
    window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  };

  const { data: stats, isLoading } = useQuery<P2PRevenueStats>({
    queryKey: ['/api/p2p/revenue-stats'],
    queryFn: () => fetch('/api/p2p/revenue-stats').then(r => r.json()),
    refetchInterval: 30_000,
  });

  const fmtVol = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(2);
  const fmtFee = (v: number) => v >= 0.0001 ? v.toFixed(4) : '0.0000';
  const openTotal = (stats?.openOffersCount ?? 0) + (stats?.openParlaysCount ?? 0);

  const sbetsBreakdown  = stats?.currencyBreakdown?.find(c => c.currency === 'SBETS');
  const usdsuiBreakdown = stats?.currencyBreakdown?.find(c => c.currency === 'USDSUI');
  const usdcBreakdown   = stats?.currencyBreakdown?.find(c => c.currency === 'USDC');
  const lbtcBreakdown   = stats?.currencyBreakdown?.find(c => c.currency === 'LBTC');
  const sbetsFees  = sbetsBreakdown?.fees  ?? 0;
  const usdsuiFees = usdsuiBreakdown?.fees ?? 0;
  const usdcFees   = usdcBreakdown?.fees   ?? 0;
  const lbtcFees   = lbtcBreakdown?.fees   ?? 0;
  const suiFees = stats?.totalPlatformFeeSui ?? 0;
  const anyFees = suiFees > 0 || sbetsFees > 0 || usdsuiFees > 0 || usdcFees > 0 || lbtcFees > 0;
  const feeLabel = sbetsFees > suiFees
    ? `${sbetsFees >= 1000 ? `${(sbetsFees / 1000).toFixed(1)}K` : sbetsFees.toFixed(2)} SBETS`
    : `${fmtFee(suiFees)} SUI`;
  const weeklyHasSbets = (stats?.weeklyHistory ?? []).some(w => w.fees > 1);

  const fmtCurrencyFee = (v: number, currency: string) => {
    if (currency === 'SBETS') return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(2);
    if (currency === 'LBTC') return v.toFixed(8);
    if (currency === 'USDSUI' || currency === 'USDC') return v.toFixed(4);
    return fmtFee(v);
  };

  const feeCurrencies: { currency: string; fees: number; color: string }[] = [
    { currency: 'SUI',    fees: suiFees,   color: '#06b6d4' },
    { currency: 'SBETS',  fees: sbetsFees,  color: '#a855f7' },
    { currency: 'USDSUI', fees: usdsuiFees, color: '#14b8a6' },
    { currency: 'USDC',   fees: usdcFees,   color: '#10b981' },
    { currency: 'LBTC',   fees: lbtcFees,   color: '#f97316' },
  ].filter(c => c.fees > 0);

  const REVENUE_SPLIT = [
    { label: 'Team & Treasury', pct: 25, color: '#00ffff', desc: 'Funds operations, development, and infrastructure upkeep' },
    { label: 'SUI Revenue share', pct: 25, color: '#a855f7', desc: 'Distributed weekly to SBETS holders proportional to balance — paid in SUI, no selling required' },
    { label: 'Buyback & Burn + Liquidity', pct: 25, color: '#f59e0b', desc: 'Used to buy SBETS off the open market: a portion is permanently burned (reducing supply), the rest deepens the DEX liquidity pool' },
    { label: 'Protocol market-making', pct: 25, color: '#4ade80', desc: 'The protocol posts counter-offers on-chain through the same P2P Move contract as any user — no hidden positions, all offers publicly auditable on Suiscan' },
  ];

  return (
    <div className="min-h-screen bg-[#080a0f] text-white">

      {/* ── NAV ── */}
      <nav className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 z-50 bg-[#080a0f]/95 backdrop-blur-md">
        <Link href="/">
          <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-8 w-auto" />
        </Link>
        <div className="flex items-center gap-3">
          {walletAddress ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <SuiNSName address={walletAddress} className="text-cyan-400 font-bold" />
              {' '}<span className="text-gray-600">{shortAddr}</span>
            </div>
          ) : (
            <button
              onClick={handleConnectWallet}
              className="text-sm font-bold px-4 py-2 rounded-xl text-black transition-all hover:opacity-90"
              style={{ background: '#00ffff' }}
            >
              Connect wallet
            </button>
          )}
          <Link href="/"
            className="text-sm font-medium px-4 py-2 rounded-xl transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: '#9ca3af' }}
          >
            ← Home
          </Link>
        </div>
      </nav>

      <div className="px-5 py-10" style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* ── Heading ── */}
        <h1 className="text-5xl font-black mb-3">
          Rev<em className="not-italic text-cyan-400" style={{ fontStyle: 'italic' }}>enue</em>
        </h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: '#6b7280' }}>
          Every settled pot pays a 2% protocol fee, split equally four ways — sustaining the team, rewarding SBETS holders in SUI, creating buy pressure through buybacks, and fuelling platform activity.{' '}
          <em style={{ color: '#4b5563' }}>(Live figures from the P2P contract.)</em>
        </p>

        {/* ── Sui Overflow badge + contract transparency ── */}
        <div className="flex flex-wrap gap-2 mb-8">
          {[
            { icon: <Globe className="w-3 h-3" />, text: 'Mainnet live', color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.2)' },
            { icon: <Code2 className="w-3 h-3" />, text: 'Sui Move contract', color: '#00ffff', bg: 'rgba(0,255,255,0.08)', border: 'rgba(0,255,255,0.2)' },
            { icon: <Lock className="w-3 h-3" />, text: 'Fees accrue on-chain', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
          ].map(({ icon, text, color, bg, border }) => (
            <span key={text} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold"
              style={{ background: bg, border: `1px solid ${border}`, color }}>
              {icon}{text}
            </span>
          ))}
        </div>

        {/* ── Live stat cards ── */}
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader size="lg" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { value: '2%', label: 'Protocol fee per settled pot', color: '#00ffff', bg: 'rgba(0,255,255,0.05)', border: 'rgba(0,255,255,0.12)' },
              { value: (stats?.totalSettledBets ?? 0).toLocaleString(), label: 'Bets settled on-chain', color: '#00ffff', bg: 'rgba(0,255,255,0.05)', border: 'rgba(0,255,255,0.12)' },
            ].map(({ value, label, color, bg, border }) => (
              <div key={label} className="rounded-2xl p-5" style={{ background: bg, border: `1px solid ${border}` }}>
                <div className="text-3xl font-black mb-1" style={{ color }}>{value}</div>
                <div className="text-xs" style={{ color: '#6b7280' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Revenue share ── */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cyan-400 text-base">◈</span>
            <span className="font-bold text-white">Fee distribution — equal 25% slices</span>
          </div>
          <p className="text-xs mb-4" style={{ color: '#4b5563' }}>Every settled pot pays 2%. Here is exactly where it goes:</p>
          <div className="space-y-3.5">
            {REVENUE_SPLIT.map(({ label, pct, color, desc }) => (
              <div key={label}>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm font-bold w-48 flex-shrink-0" style={{ color }}>{label}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color, opacity: 0.7 }} />
                  </div>
                  <span className="text-sm font-black w-10 text-right" style={{ color }}>{pct}%</span>
                </div>
                <p className="text-[11px] pl-0" style={{ color: '#4b5563' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── How the loop works ── */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.15)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-purple-400 text-base">⟳</span>
            <span className="font-bold text-white">How the model works</span>
          </div>
          <div className="space-y-2.5 text-sm" style={{ color: '#9ca3af' }}>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-black mt-0.5">1</span>
              <p><strong className="text-white">25% funds market-making from day one.</strong> The protocol posts counter-offers on-chain through the same P2P Move contract as any user — no separate wallet, no hidden positions. Every offer is publicly visible on Suiscan. Settled bets generate fees, which fund the next round.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-black mt-0.5">2</span>
              <p>As fees accumulate, <strong className="text-white">25% buys SBETS off the open market</strong> and burns it or adds DEX liquidity — reducing circulating supply, raising the floor price of every remaining SBETS.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-black mt-0.5">3</span>
              <p><strong className="text-white">25% is distributed as SUI</strong> to SBETS holders weekly, proportional to balance. Yield arrives in SUI — holders never need to sell their SBETS to realise returns.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-black mt-0.5">4</span>
              <p>SUI yield requires holding SBETS, driving <strong className="text-white">consistent buy demand</strong>. More buyers + shrinking supply = rising price = more attractive yield = more holders = more bets.</p>
            </div>
          </div>
        </div>

        {/* ── On-chain transparency ── */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: 'rgba(74,222,128,0.03)', border: '1px solid rgba(74,222,128,0.12)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-4 h-4 text-green-400" />
            <span className="font-bold text-white">Fully on-chain — trustless by design</span>
          </div>
          <div className="space-y-2 text-xs" style={{ color: '#6b7280' }}>
            {[
              { label: 'Fee accrual', detail: 'Every 2% fee is written directly into the Move contract\'s shared object fields (accrued_fees_sui, accrued_fees_sbets). Verifiable on Suiscan at any time — the team cannot alter the accrued amounts.', color: '#4ade80' },
              { label: 'Revenue distribution', detail: 'Distribution is executed by an on-chain Move transaction. SBETS holder balances are read from chain; payouts are calculated and sent via the contract — no off-chain trust required.', color: '#a855f7' },
              { label: 'Buyback & burn', detail: 'Buyback transactions are signed on-chain and the burn is irreversible — once SBETS is burned, the supply reduction is permanent and publicly auditable.', color: '#f59e0b' },
              { label: 'Market-making pool', detail: 'The protocol posts counter-offers directly on-chain through the same P2P Move contract as any user — no separate wallet, no off-chain positions. Every offer is a real on-chain object, publicly auditable on Suiscan at any time.', color: '#00ffff' },
            ].map(({ label, detail, color }) => (
              <div key={label} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: color }} />
                <div>
                  <span className="font-bold text-white">{label} — </span>{detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── What SBETS is for ── */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-cyan-400 text-base">Ⓢ</span>
            <span className="font-bold text-white">Why hold SBETS?</span>
          </div>
          <div className="space-y-2">
            {[
              { icon: <CircleDollarSign className="w-4 h-4" />, color: '#a855f7', title: 'Earn SUI on-chain', body: '25% of all fees distributed weekly as SUI via Move transaction — proportional to your SBETS balance, with no selling required.' },
              { icon: <Flame className="w-4 h-4" />, color: '#f59e0b', title: 'Permanently deflationary', body: '25% of fees execute an on-chain buyback and burn. Every bet settled makes SBETS scarcer — the burn is irreversible and publicly verifiable.' },
              { icon: <Zap className="w-4 h-4" />, color: '#4ade80', title: 'Bet with it directly', body: 'SBETS is a native Sui coin accepted as stake on every P2P bet. Hold it, earn SUI from it, and use it — all in one asset.' },
            ].map(({ icon, color, title, body }) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="mt-0.5 flex-shrink-0" style={{ color }}>{icon}</div>
                <div>
                  <div className="text-sm font-bold text-white mb-0.5">{title}</div>
                  <div className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Why Sui? ── */}
        <div className="rounded-2xl p-5 mb-6" style={{ background: 'rgba(0,255,255,0.02)', border: '1px solid rgba(0,255,255,0.08)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Code2 className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white">Why this works on Sui</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { title: 'Move contracts', body: 'Bet settlement, fee accrual, and multi-coin payouts are all enforced by a single Move package. No trusted intermediary.', color: '#00ffff' },
              { title: 'Sub-second finality', body: 'Sui\'s consensus confirms bets in under a second — essential for live, in-play sports markets.', color: '#4ade80' },
              { title: 'Parallel execution', body: 'Owned-object bets execute in parallel. High-volume match days don\'t bottleneck each other.', color: '#a855f7' },
              { title: 'Native multi-coin', body: 'SUI, USDC, SBETS, LBTC — all handled in one generic <T> contract with no wrapped-token risk.', color: '#f59e0b' },
              { title: 'zkLogin', body: 'Web2 social logins map to on-chain wallets — zero friction onboarding without sacrificing custody.', color: '#ec4899' },
              { title: 'SuiNS identities', body: 'Human-readable names replace hex addresses everywhere — bets, payouts, and leaderboards.', color: '#14b8a6' },
            ].map(({ title, body, color }) => (
              <div key={title} className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-[11px] font-black mb-1" style={{ color }}>{title}</div>
                <div className="text-[11px] leading-relaxed" style={{ color: '#4b5563' }}>{body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Platform stats (live) ── */}
        {!isLoading && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { icon: <ShieldCheck size={14} />, label: 'Settled bets', value: (stats?.totalSettledBets ?? 0).toLocaleString(), color: '#a855f7' },
                { icon: <Layers size={14} />, label: 'Open offers', value: openTotal.toLocaleString(), color: '#fbbf24' },
                { icon: <CircleDollarSign size={14} />, label: 'Total fees', value: feeLabel, color: '#4ade80' },
              ].map(({ icon, label, value, color }) => (
                <div key={label} className="rounded-2xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex items-center justify-center gap-1 mb-2" style={{ color }}>
                    {icon}
                    <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
                  </div>
                  <div className="font-black text-white">{value}</div>
                </div>
              ))}
            </div>

            {/* ── Live revenue breakdown ── */}
            {anyFees && (
              <div className="rounded-2xl p-5 mb-6" style={{ background: 'rgba(0,255,255,0.03)', border: '1px solid rgba(0,255,255,0.1)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold text-white">Live fee split (total collected)</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Team & Treasury', color: '#00ffff' },
                    { label: 'SUI Revenue share', color: '#a855f7' },
                    { label: 'Buyback & Burn', color: '#f59e0b' },
                    { label: 'Platform supply', color: '#4ade80' },
                  ].map(({ label, color }) => (
                    <div key={label} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#4b5563' }}>{label}</div>
                      <div className="space-y-0.5">
                        {feeCurrencies.map(({ currency, fees, color: cColor }) => (
                          <div key={currency} className="font-black text-sm leading-tight" style={{ color: cColor }}>
                            {fmtCurrencyFee(fees * 0.25, currency)} {currency}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-2" style={{ color: '#374151' }}>
                  {feeCurrencies.map(({ currency, fees }) => `${fmtCurrencyFee(fees, currency)} ${currency}`).join(' + ')} total platform fees collected. Each quarter = 25%.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── Revenue claim panel ── */}
        {walletAddress ? (
          <ClaimPanel walletAddress={walletAddress} />
        ) : (
          <div className="rounded-2xl p-6 text-center mb-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(0,255,255,0.07)', border: '1px solid rgba(0,255,255,0.15)' }}>
              <Wallet className="w-5 h-5 text-cyan-400" />
            </div>
            <p className="text-sm mb-1 font-bold text-white">Claim your revenue share</p>
            <p className="text-xs mb-4" style={{ color: '#4b5563' }}>Connect to see your SBETS share and claim P2P platform fees.</p>
            <button
              onClick={handleConnectWallet}
              className="px-6 py-2.5 rounded-xl font-black text-black text-sm transition-all hover:opacity-90"
              style={{ background: '#00ffff' }}
            >
              Connect wallet
            </button>
          </div>
        )}

        {/* ── Fee tiers ── */}
        <div className="rounded-2xl overflow-hidden mb-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <BookOpen className="w-4 h-4" style={{ color: '#a855f7' }} />
            <span className="text-sm font-bold text-white">Fee structure</span>
          </div>
          <div className="grid grid-cols-3 divide-x" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            {[
              { tier: 'Bronze', fee: '2.00%', rebate: null, vol: '< 100 SUI', color: '#cd7f32' },
              { tier: 'Gold', fee: '1.00%', rebate: '0.2%', vol: '1K–10K SUI', color: '#f59e0b' },
              { tier: 'Elite', fee: '0.30%', rebate: '0.5%', vol: '> 10K SUI', color: '#a855f7' },
            ].map(t => (
              <div key={t.tier} className="px-4 py-4 text-center">
                <div className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: t.color }}>{t.tier}</div>
                <div className="text-xl font-black text-white mb-0.5">{t.fee}</div>
                <div className="text-[10px]" style={{ color: '#4b5563' }}>taker fee</div>
                {t.rebate && <div className="text-[10px] text-green-400 mt-1">+{t.rebate} maker rebate</div>}
                <div className="text-[9px] mt-1" style={{ color: '#374151' }}>{t.vol}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Weekly chart ── */}
        <div className="rounded-2xl overflow-hidden mb-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-bold text-white">Weekly fee revenue {weeklyHasSbets ? '(SBETS)' : '(SUI)'}</span>
            </div>
            {stats?.network && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold text-cyan-400"
                style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.2)' }}>
                {stats.network}
              </span>
            )}
          </div>
          <div className="px-5 py-4">
            <WeeklyBarChart weeks={stats?.weeklyHistory ?? []} />
          </div>
        </div>

        {/* ── Currency breakdown ── */}
        {(() => {
          const STATIC_CURRENCIES = [
            { currency: 'SUI',   desc: 'Native gas coin — zero-wrap, instant finality' },
            { currency: 'SBETS', desc: 'Protocol token — earn fees, bet, burn' },
            { currency: 'USDC',  desc: 'Bridged stablecoin via Circle — gas sponsored' },
            { currency: 'LBTC',  desc: 'Liquid Bitcoin on Sui via Lombard' },
          ];
          const liveRows: Record<string, { fees: number; volume: number; count: number }> = {};
          (stats?.currencyBreakdown ?? []).forEach(r => { liveRows[r.currency] = r; });
          const hasLive = (stats?.currencyBreakdown?.length ?? 0) > 0;
          return (
            <div className="rounded-2xl overflow-hidden mb-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold text-white">Accepted betting currencies</span>
                </div>
                {hasLive && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold text-green-400" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                    ● Live data
                  </span>
                )}
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {STATIC_CURRENCIES.map(({ currency, desc }) => {
                  const color = CURRENCY_COLORS[currency] ?? '#6b7280';
                  const live = liveRows[currency];
                  return (
                    <div key={currency} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <div className="w-14 flex-shrink-0">
                        <div className="text-sm font-black" style={{ color }}>{currency}</div>
                      </div>
                      {hasLive && live ? (
                        <div className="flex-1 grid grid-cols-3 gap-3 text-xs">
                          {[['Fees', fmtFee(live.fees)], ['Volume', fmtVol(live.volume)], ['Bets', live.count.toString()]].map(([lbl, val]) => (
                            <div key={lbl}>
                              <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: '#374151' }}>{lbl}</div>
                              <div className="font-mono font-bold" style={{ color: lbl === 'Fees' ? color : '#9ca3af' }}>{val}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex-1">
                          <p className="text-xs" style={{ color: '#4b5563' }}>{desc}</p>
                        </div>
                      )}
                      <div className="flex-shrink-0">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${color}14`, border: `1px solid ${color}33`, color }}>
                          2% fee
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="h-12" />
      </div>

      {/* ── FOOTER ── */}
      <footer className="border-t px-5 pt-8 pb-10" style={{ borderColor: 'rgba(255,255,255,0.06)', maxWidth: 680, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-5">
          <Link href="/">
            <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-6 w-auto opacity-70" />
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black px-2 py-0.5 rounded border" style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#6b7280' }}>18+</span>
            <span className="text-xs" style={{ color: '#6b7280' }}>Play responsibly</span>
          </div>
        </div>
        <div className="rounded-2xl p-4 mb-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-start gap-3">
            <span className="text-gray-600 mt-0.5 flex-shrink-0 text-sm">ⓘ</span>
            <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
              <strong className="text-gray-400">Betting should be fun, never a way to make money.</strong> Only stake what you can afford to lose. SUI and SBETS are volatile crypto-assets.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 mb-4">
          {['Whitepaper', 'FAQ', 'Privacy', 'Responsible play'].map(label => (
            <Link key={label} href={`/${label.toLowerCase().replace(/\s+/g, '-')}`}
              className="text-xs hover:text-gray-300 transition-colors"
              style={{ color: '#4b5563' }}>
              {label}
            </Link>
          ))}
        </div>
        <p className="text-[11px]" style={{ color: '#374151' }}>
          P2P betting exchange on Sui. SUI · SBETS · zkLogin · Walrus.
        </p>
      </footer>
    </div>
  );
}
