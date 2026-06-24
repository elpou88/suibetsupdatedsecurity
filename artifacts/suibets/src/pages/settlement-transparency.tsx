import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowLeft,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  TrendingUp,
  Users,
  Zap,
  Trophy,
  BarChart3,
  Eye,
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Layers,
  Target,
  Lock,
  Swords,
} from 'lucide-react';
import { DisputeCountdown } from '@/components/p2p/DisputeCountdown';
import { P2PContractModal } from '@/components/p2p/P2PContractModal';
import { SuiParallelSettlement } from '@/components/settlement/SuiParallelSettlement';
const suibetsLogo = "/images/suibets-logo.png";

const SBETS_BLUE = 'text-[#4da2ff]';
const SBETS_BLUE_BG = 'bg-[#4da2ff]';
const SBETS_BORDER = 'border-[#4da2ff]/30';
const SBETS_GLOW = 'shadow-[0_0_20px_rgba(77,162,255,0.15)]';

function StatCard({ icon: Icon, label, value, subValue, color, highlight }: {
  icon: any; label: string; value: string | number; subValue?: string; color: string; highlight?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl p-4 transition-all duration-300 hover:scale-[1.02] ${
      highlight 
        ? `bg-gradient-to-br from-[#0a1628] to-[#0d1f3c] border ${SBETS_BORDER} ${SBETS_GLOW}` 
        : 'bg-[#0d0d0d] border border-gray-800/50'
    }`} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      {highlight && <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#4da2ff]/60 to-transparent" />}
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {subValue && <div className="text-[11px] text-gray-500 mt-1">{subValue}</div>}
    </div>
  );
}

function SettlementRow({ bet }: { bet: any }) {
  const isWon = bet.status === 'won';
  const StatusIcon = isWon ? CheckCircle : XCircle;
  const statusColor = isWon ? 'text-green-400' : 'text-red-400';
  const statusBg = isWon ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <div className="bg-[#0a0a0a] border border-gray-800/40 rounded-xl p-4 hover:border-[#4da2ff]/30 transition-all duration-200 group" data-testid={`settlement-row-${bet.id}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg border ${statusBg}`}>
            <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
          </div>
          <div>
            <span className="text-sm font-semibold text-white truncate block max-w-[240px]">{bet.eventName || 'Match'}</span>
            <span className="text-[10px] text-gray-600">{bet.prediction}</span>
          </div>
          {bet.betType === 'parlay' && (
            <span className="text-[9px] bg-[#4da2ff]/15 text-[#4da2ff] px-2 py-0.5 rounded-full font-semibold tracking-wider">PARLAY</span>
          )}
        </div>
        <span className="text-[10px] text-gray-600">{bet.settledAt ? new Date(bet.settledAt).toLocaleString() : '-'}</span>
      </div>
      <div className="grid grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-gray-600 text-[10px] uppercase tracking-wider">Bettor</span>
          <div className={`${SBETS_BLUE} font-mono text-xs mt-0.5`}>{bet.wallet}</div>
        </div>
        <div>
          <span className="text-gray-600 text-[10px] uppercase tracking-wider">Stake</span>
          <div className="text-white mt-0.5">{Number(bet.betAmount).toLocaleString()} <span className="text-gray-500">{bet.currency}</span></div>
        </div>
        <div>
          <span className="text-gray-600 text-[10px] uppercase tracking-wider">Odds</span>
          <div className="text-white mt-0.5">{Number(bet.odds).toFixed(2)}x</div>
        </div>
        <div>
          <span className="text-gray-600 text-[10px] uppercase tracking-wider">Payout</span>
          <div className={`mt-0.5 font-semibold ${isWon ? 'text-green-400' : 'text-red-400/60'}`}>
            {isWon ? `+${Number(bet.payout).toLocaleString()} ${bet.currency}` : '0'}
          </div>
        </div>
      </div>
      {bet.suiscanUrl && (
        <div className="mt-3 pt-2.5 border-t border-gray-800/30">
          <a
            href={bet.suiscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 text-[11px] ${SBETS_BLUE} hover:text-white transition-colors font-medium`}
            data-testid={`link-suiscan-${bet.id}`}
          >
            <ExternalLink className="h-3 w-3" />
            Verify settlement on Suiscan
          </a>
        </div>
      )}
    </div>
  );
}

export default function SettlementTransparencyPage() {
  const [showAllSettlements, setShowAllSettlements] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'won' | 'lost'>('all');
  const [showContractModal, setShowContractModal] = useState(false);
  
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['/api/settlement/transparency'],
    refetchInterval: 60000,
  });

  const isStale = data?.stale === true;
  const overview = data?.overview || {};
  const allSettlements = (data?.recentSettlements || []).filter((b: any) => b.status === 'won' || b.status === 'lost');
  const filteredSettlements = activeFilter === 'all' ? allSettlements : allSettlements.filter((b: any) => b.status === activeFilter);
  const displayedSettlements = showAllSettlements ? filteredSettlements : filteredSettlements.slice(0, 10);
  const sportBreakdown = data?.sportBreakdown || [];
  const biggestWins = data?.biggestWins || [];
  const parlayStats = data?.parlayStats || {};
  const security = data?.security || {};
  const p2pStats = data?.p2pStats || {};
  const p2pCurrencyBreakdown: Array<{ currency: string; totalMatches: number; settledMatches: number; totalVolume: number; settledVolume: number }> = data?.p2pCurrencyBreakdown || [];

  return (
    <div className="min-h-screen bg-black" data-testid="settlement-transparency-page">
      <nav className="bg-[#060606] border-b border-gray-800/50 px-4 py-3 sticky top-0 z-10 backdrop-blur-xl bg-opacity-90">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <button className="p-2 text-gray-500 hover:text-[#4da2ff] hover:bg-[#4da2ff]/10 rounded-lg transition-colors" data-testid="btn-back-transparency">
                <ArrowLeft size={18} />
              </button>
            </Link>
            <Link href="/" data-testid="link-logo-transparency">
              <img src={suibetsLogo} alt="SuiBets" className="h-9 w-auto cursor-pointer" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-600 hidden sm:block">
              {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : ''}
            </span>
            <button
              onClick={() => setShowContractModal(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-xs font-bold"
            >
              <Shield className="h-3.5 w-3.5" />
              P2P Contract
            </button>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-900/50 border border-gray-800/50">
              {isLoading ? (
                <>
                  <div className="h-1.5 w-1.5 bg-blue-400 rounded-full animate-pulse" />
                  <span className="text-[10px] text-blue-400 font-medium">Loading</span>
                </>
              ) : error && !data ? (
                <>
                  <div className="h-1.5 w-1.5 bg-red-400 rounded-full" />
                  <span className="text-[10px] text-red-400 font-medium">Unavailable</span>
                </>
              ) : isStale ? (
                <>
                  <div className="h-1.5 w-1.5 bg-yellow-400 rounded-full" />
                  <span className="text-[10px] text-yellow-400 font-medium">Cached</span>
                </>
              ) : (
                <>
                  <div className="h-1.5 w-1.5 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-[10px] text-green-400 font-medium">Live</span>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-3">
            <div className={`p-3.5 rounded-2xl bg-[#4da2ff]/10 border border-[#4da2ff]/20`}>
              <Eye className={`h-7 w-7 ${SBETS_BLUE}`} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight" data-testid="text-page-title">
                Settlement <span className={SBETS_BLUE}>Transparency</span>
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Provably fair. Fully automated. Verifiable on-chain.</p>
            </div>
          </div>
        </div>

        <SuiParallelSettlement />

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
          <StatCard icon={CheckCircle} label="Bets Settled" value={overview.totalSettled?.toLocaleString() || '0'} subValue={`${overview.settlementRate || 0}% rate`} color="text-green-400" highlight />
          <StatCard icon={Trophy} label="Winners Paid" value={overview.totalWon?.toLocaleString() || '0'} subValue={`${overview.winRate || 0}% win rate`} color="text-yellow-400" />
          <StatCard icon={TrendingUp} label="SUI Paid Out" value={overview.totalSuiPaid?.toLocaleString() || '0'} subValue={`${overview.totalSuiWagered?.toLocaleString() || '0'} wagered`} color="text-blue-400" highlight />
          <StatCard icon={Zap} label="SBETS Paid" value={overview.totalSbetsPaid?.toLocaleString() || '0'} subValue={`${overview.totalSbetsWagered?.toLocaleString() || '0'} wagered`} color={SBETS_BLUE} />
          <StatCard icon={Users} label="Unique Bettors" value={overview.uniqueBettors?.toLocaleString() || '0'} subValue={`${overview.uniqueWinners || 0} winners`} color={SBETS_BLUE} />
          <StatCard icon={Clock} label="Avg Settlement" value={overview.avgSettlementHours > 0 ? (overview.avgSettlementHours < 1 ? `${Math.round(overview.avgSettlementHours * 60)}m` : `${overview.avgSettlementHours}h`) : 'Auto'} subValue="Fully automated" color="text-orange-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          <div className="lg:col-span-2">
            <div className={`bg-[#0d0d0d] border border-gray-800/50 rounded-2xl overflow-hidden`}>
              <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center gap-2" data-testid="text-recent-settlements">
                  <Activity className={`h-5 w-5 ${SBETS_BLUE}`} />
                  Settlement Feed
                </h2>
                <div className="flex items-center gap-1.5">
                  {(['all', 'won', 'lost'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setActiveFilter(f)}
                      className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
                        activeFilter === f 
                          ? f === 'won' ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                            : f === 'lost' ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                            : 'bg-[#4da2ff]/15 text-[#4da2ff] border border-[#4da2ff]/30'
                          : 'text-gray-500 hover:text-gray-300 border border-transparent'
                      }`}
                      data-testid={`filter-${f}`}
                    >
                      {f === 'all' ? 'All' : f === 'won' ? 'Won' : 'Lost'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-5 pb-5 space-y-2 max-h-[650px] overflow-y-auto">
                {displayedSettlements.length > 0 ? (
                  <>
                    {displayedSettlements.map((bet: any) => <SettlementRow key={bet.id} bet={bet} />)}
                    {filteredSettlements.length > 10 && (
                      <button
                        onClick={() => setShowAllSettlements(!showAllSettlements)}
                        className={`w-full py-3 text-sm ${SBETS_BLUE} hover:text-white transition-colors flex items-center justify-center gap-1 font-medium`}
                        data-testid="btn-show-more"
                      >
                        {showAllSettlements ? (
                          <><ChevronUp className="h-4 w-4" /> Show Less</>
                        ) : (
                          <><ChevronDown className="h-4 w-4" /> Show All {filteredSettlements.length} Settlements</>
                        )}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-16 text-gray-600">
                    <Clock className="h-8 w-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No {activeFilter !== 'all' ? activeFilter : ''} settlements yet.</p>
                    <p className="text-xs mt-1">Bets will appear here once matches finish.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className={`bg-[#0d0d0d] border border-gray-800/50 rounded-2xl p-5`}>
              <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4" data-testid="text-sport-breakdown">
                <BarChart3 className={`h-4 w-4 ${SBETS_BLUE}`} />
                By Sport
              </h2>
              <div className="space-y-3">
                {sportBreakdown.length > 0 ? sportBreakdown.map((s: any, i: number) => {
                  const total = parseInt(s.settled || '0');
                  const won = parseInt(s.won || '0');
                  const lost = parseInt(s.lost || '0');
                  const pct = total > 0 ? Math.round((won / total) * 100) : 0;
                  return (
                    <div key={i} data-testid={`sport-row-${s.sport}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-white font-medium">{s.sport}</span>
                        <span className="text-[11px] text-gray-500">{total} settled</span>
                      </div>
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between mt-1 text-[10px]">
                        <span className="text-green-400">{won} won</span>
                        <span className="text-red-400/60">{lost} lost</span>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="text-sm text-gray-600">No data yet</p>
                )}
              </div>
            </div>

            <div className={`bg-[#0d0d0d] border border-gray-800/50 rounded-2xl p-5`}>
              <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4" data-testid="text-parlay-stats">
                <Layers className={`h-4 w-4 ${SBETS_BLUE}`} />
                Parlay Engine
              </h2>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Total Parlays</span>
                  <span className="text-white font-medium">{parlayStats.totalParlays || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Settled</span>
                  <span className="text-white font-medium">{parlayStats.settledParlays || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Won</span>
                  <span className="text-green-400 font-medium">{parlayStats.wonParlays || 0}</span>
                </div>
                <div className="h-px bg-gray-800/50 my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Avg Odds</span>
                  <span className={`${SBETS_BLUE} font-medium`}>{parlayStats.avgOdds || 0}x</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Biggest Win</span>
                  <span className="text-yellow-400 font-medium">{parlayStats.biggestWin?.toLocaleString() || 0}</span>
                </div>
              </div>
            </div>

            <div className={`bg-gradient-to-br from-[#0a1628] to-[#0d0d0d] border ${SBETS_BORDER} rounded-2xl p-5 ${SBETS_GLOW}`}>
              <h2 className="text-base font-bold text-white flex items-center gap-2 mb-3" data-testid="text-events-settled">
                <Target className={`h-4 w-4 ${SBETS_BLUE}`} />
                Events Settled
              </h2>
              <div className={`text-4xl font-bold ${SBETS_BLUE}`}>{overview.totalEventsSettled?.toLocaleString() || '0'}</div>
              <p className="text-[11px] text-gray-500 mt-1">Unique sporting events resolved</p>
            </div>
          </div>
        </div>

        {biggestWins.length > 0 && (
          <div className="bg-[#0d0d0d] border border-gray-800/50 rounded-2xl p-5 mb-10">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-5" data-testid="text-biggest-wins">
              <Trophy className="h-5 w-5 text-yellow-400" />
              Biggest Wins
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {biggestWins.slice(0, 6).map((win: any, i: number) => (
                <div key={win.id} className="bg-[#080808] border border-gray-800/30 rounded-xl p-4 flex items-center gap-3 hover:border-yellow-500/20 transition-colors" data-testid={`biggest-win-${win.id}`}>
                  <div className={`text-2xl font-black w-8 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-700' : 'text-gray-700'}`}>
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{win.eventName || 'Match'}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{win.wallet} &middot; {Number(win.odds).toFixed(2)}x</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-green-400">+{Number(win.payout).toLocaleString()}</div>
                    <div className="text-[10px] text-gray-600">{win.currency}</div>
                  </div>
                  {win.suiscanUrl && (
                    <a href={win.suiscanUrl} target="_blank" rel="noopener noreferrer" className={`${SBETS_BLUE} hover:text-white transition-colors`} data-testid={`link-win-suiscan-${win.id}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-[#0d0d0d] border border-gray-800/50 rounded-2xl p-6 mb-10">
          <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6" data-testid="text-security-architecture">
            <Shield className="h-5 w-5 text-green-400" />
            Security Architecture
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-[#080808] rounded-xl p-5 border border-green-900/15 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-green-500/40 to-transparent" />
              <div className="text-4xl font-black text-green-400 mb-1">{security.payoutCapEnforcementPoints || 19}</div>
              <div className="text-sm text-white font-medium">Payout Cap Checkpoints</div>
              <div className="text-[11px] text-gray-600 mt-1">Every settlement path is protected</div>
            </div>
            <div className="bg-[#080808] rounded-xl p-5 border border-[#4da2ff]/15 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#4da2ff]/40 to-transparent" />
              <div className={`text-2xl font-bold ${SBETS_BLUE} mb-1`}>{security.settlementMode}</div>
              <div className="text-sm text-white font-medium">Settlement Mode</div>
              <div className="text-[11px] text-gray-600 mt-1">No manual intervention required</div>
            </div>
            <div className="bg-[#080808] rounded-xl p-5 border border-purple-900/15 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-purple-500/40 to-transparent" />
              <div className="text-xl font-bold text-purple-400 mb-1">Paid Sports Oracle</div>
              <div className="text-sm text-white font-medium">Data Source</div>
              <div className="text-[11px] text-gray-600 mt-1">Professional-grade sports data</div>
            </div>
            <div className="bg-[#080808] rounded-xl p-5 border border-gray-800/30">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Payout Limits</div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Max SUI payout</span><span className="text-white font-medium">{security.maxPayoutSui} SUI</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Max SBETS payout</span><span className="text-white font-medium">{(security.maxPayoutSbets || 0).toLocaleString()} SBETS</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Max single odds</span><span className="text-white font-medium">{security.maxOdds}x</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Max parlay odds</span><span className="text-white font-medium">{security.maxParlayOdds}x</span></div>
              </div>
            </div>
            <div className="bg-[#080808] rounded-xl p-5 border border-gray-800/30">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Rate Limits</div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Bets per wallet / 24h</span><span className="text-white font-medium">{security.maxBetsPerWallet24h}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Bets per match</span><span className="text-white font-medium">{security.maxBetsPerMatch}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Odds tolerance</span><span className="text-white font-medium">{security.oddsTolerance}</span></div>
              </div>
            </div>
            <div className="bg-[#080808] rounded-xl p-5 border border-gray-800/30">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Anti-Exploit</div>
              <div className="space-y-1.5 text-xs">
                {(security.antiExploitChecks || []).map((check: string, i: number) => (
                  <div key={i} className="flex items-center gap-1.5 text-gray-400">
                    <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <span>{check}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── P2P Volume by Currency ──────────────────────────────────────── */}
        {(p2pCurrencyBreakdown.length > 0 || p2pStats.totalMatches > 0) && (() => {
          const CURRENCY_COLORS: Record<string, string> = {
            SUI:    '#4da2ff',
            SBETS:  '#9b59b6',
            USDSUI: '#a855f7',
            USDC:   '#2775ca',
            LBTC:   '#f7931a',
          };

          // Build display rows — fall back to legacy p2pStats if breakdown is empty
          const rows = p2pCurrencyBreakdown.length > 0
            ? p2pCurrencyBreakdown
            : [
                { currency: 'SUI',   totalVolume: p2pStats.totalVolumeSui   || 0, totalMatches: p2pStats.totalMatches   || 0, settledMatches: p2pStats.settledMatches || 0, settledVolume: 0 },
                { currency: 'SBETS', totalVolume: p2pStats.totalVolumeSbets || 0, totalMatches: 0, settledMatches: 0, settledVolume: 0 },
              ].filter(r => r.totalVolume > 0 || r.totalMatches > 0);

          const maxVol = Math.max(...rows.map(r => r.totalVolume), 1);
          const totalVol = rows.reduce((s, r) => s + r.totalVolume, 0);
          const totalMatches = rows.reduce((s, r) => s + r.totalMatches, 0);

          const fmtVol = (v: number) =>
            v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` :
            v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` :
            v.toFixed(2);

          return (
            <div className="bg-[#0d0d0d] border border-gray-800/50 rounded-2xl p-6 mb-10">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <BarChart3 className={`h-5 w-5 ${SBETS_BLUE}`} />
                  P2P Volume by Currency
                </h2>
                <div className="flex items-center gap-4 text-[11px] text-gray-500">
                  <span>{totalMatches.toLocaleString()} total matches</span>
                  <span className="text-gray-700">|</span>
                  <span>{fmtVol(totalVol)} combined stake</span>
                </div>
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-gray-600 text-center py-6">No P2P matches yet</p>
              ) : (
                <div className="space-y-4">
                  {rows.map((row) => {
                    const color = CURRENCY_COLORS[row.currency] || '#6b7280';
                    const barPct = (row.totalVolume / maxVol) * 100;
                    const sharePct = totalVol > 0 ? (row.totalVolume / totalVol) * 100 : 0;
                    const settledPct = row.totalMatches > 0 ? Math.round((row.settledMatches / row.totalMatches) * 100) : 0;
                    return (
                      <div key={row.currency}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{ background: color + '18', color, border: `1px solid ${color}30` }}
                            >
                              {row.currency}
                            </span>
                            <span className="text-white text-sm font-semibold">{fmtVol(row.totalVolume)}</span>
                            <span className="text-gray-600 text-[10px]">stake · {sharePct.toFixed(1)}% share</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-gray-500">
                            <span>{row.totalMatches} match{row.totalMatches !== 1 ? 'es' : ''}</span>
                            {row.settledMatches > 0 && (
                              <span className="text-green-500/70">{settledPct}% settled</span>
                            )}
                          </div>
                        </div>
                        <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${barPct}%`,
                              background: `linear-gradient(90deg, ${color}cc, ${color}66)`,
                              boxShadow: `0 0 8px ${color}44`,
                            }}
                          />
                          {row.settledVolume > 0 && (
                            <div
                              className="absolute top-0 left-0 h-full rounded-full opacity-30"
                              style={{
                                width: `${(row.settledVolume / maxVol) * 100}%`,
                                background: '#22c55e',
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Donut-style summary row */}
                  <div className="mt-4 pt-4 border-t border-gray-800/40 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {rows.map((row) => {
                      const color = CURRENCY_COLORS[row.currency] || '#6b7280';
                      const sharePct = totalVol > 0 ? (row.totalVolume / totalVol) * 100 : 0;
                      return (
                        <div key={row.currency} className="text-center p-2.5 rounded-xl" style={{ background: color + '0a', border: `1px solid ${color}20` }}>
                          <div className="text-[10px] font-bold mb-1" style={{ color }}>{row.currency}</div>
                          <div className="text-white text-sm font-bold">{fmtVol(row.totalVolume)}</div>
                          <div className="text-gray-600 text-[9px] mt-0.5">{sharePct.toFixed(1)}% of total</div>
                          <div className="text-gray-500 text-[9px]">{row.totalMatches} bets</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Dispute Window Section ─────────────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
                <Swords className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  Dispute <span className="text-orange-400">Window</span>
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Challenge a queued settlement before the 2-hour window closes
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowContractModal(true)}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-xs font-bold"
            >
              <Shield className="h-3.5 w-3.5" />
              How it works
            </button>
          </div>

          <div className="bg-[#0d0d0d] border border-orange-500/20 rounded-2xl p-5">
            <DisputeCountdown />
          </div>
        </div>

        {/* ── Footer note ────────────────────────────────────────────────── */}
        <div className="text-center pb-6">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#4da2ff]/5 border ${SBETS_BORDER}`}>
            <Lock className={`h-3.5 w-3.5 ${SBETS_BLUE}`} />
            <p className="text-[11px] text-gray-400">
              All data sourced from on-chain and off-chain records. Verify settlements on{' '}
              <a href="https://suiscan.xyz" target="_blank" rel="noopener noreferrer" className={`${SBETS_BLUE} hover:underline`}>
                Suiscan
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* ── P2P Contract Modal ──────────────────────────────────────────── */}
      {showContractModal && <P2PContractModal onClose={() => setShowContractModal(false)} />}
    </div>
  );
}