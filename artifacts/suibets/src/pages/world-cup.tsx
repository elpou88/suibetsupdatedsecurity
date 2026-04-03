import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ArrowLeft, Search, Clock, Globe, Star, Target, Users, Shield, Zap, TrendingUp, Award, BarChart3, XCircle, Play, Radio, Newspaper, Table2, ExternalLink, RefreshCw } from "lucide-react";
import { useBetting } from "@/context/BettingContext";
import { useToast } from "@/hooks/use-toast";
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import { useZkLogin } from "@/context/ZkLoginContext";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import Footer from "@/components/layout/Footer";

const FLAG_CODE_MAP: Record<string, string> = {
  'ES': 'es', 'GB-ENG': 'gb-eng', 'GB-SCT': 'gb-sct', 'FR': 'fr', 'BR': 'br', 'AR': 'ar',
  'PT': 'pt', 'DE': 'de', 'NL': 'nl', 'NO': 'no', 'IT': 'it', 'BE': 'be',
  'CO': 'co', 'MA': 'ma', 'US': 'us', 'MX': 'mx', 'UY': 'uy', 'EC': 'ec',
  'HR': 'hr', 'CM': 'cm', 'SN': 'sn', 'CH': 'ch', 'DK': 'dk', 'AT': 'at',
  'PY': 'py', 'JP': 'jp', 'KR': 'kr', 'AU': 'au', 'NG': 'ng', 'RS': 'rs',
  'TR': 'tr', 'CA': 'ca', 'PL': 'pl', 'UA': 'ua', 'UZ': 'uz', 'PE': 'pe',
  'CN': 'cn', 'NZ': 'nz', 'PA': 'pa', 'SA': 'sa', 'HN': 'hn', 'EG': 'eg',
  'CR': 'cr', 'ID': 'id', 'JM': 'jm', 'DZ': 'dz', 'BO': 'bo', 'SI': 'si',
  'TT': 'tt', 'BH': 'bh',
};

const FLAG_EMOJI: Record<string, string> = {
  'ES': '\u{1F1EA}\u{1F1F8}', 'GB-ENG': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  'FR': '\u{1F1EB}\u{1F1F7}', 'BR': '\u{1F1E7}\u{1F1F7}', 'AR': '\u{1F1E6}\u{1F1F7}',
  'PT': '\u{1F1F5}\u{1F1F9}', 'DE': '\u{1F1E9}\u{1F1EA}', 'NL': '\u{1F1F3}\u{1F1F1}',
  'NO': '\u{1F1F3}\u{1F1F4}', 'IT': '\u{1F1EE}\u{1F1F9}', 'BE': '\u{1F1E7}\u{1F1EA}',
  'CO': '\u{1F1E8}\u{1F1F4}', 'MA': '\u{1F1F2}\u{1F1E6}', 'US': '\u{1F1FA}\u{1F1F8}',
  'MX': '\u{1F1F2}\u{1F1FD}', 'UY': '\u{1F1FA}\u{1F1FE}', 'EC': '\u{1F1EA}\u{1F1E8}',
  'HR': '\u{1F1ED}\u{1F1F7}', 'CM': '\u{1F1E8}\u{1F1F2}', 'SN': '\u{1F1F8}\u{1F1F3}',
  'CH': '\u{1F1E8}\u{1F1ED}', 'DK': '\u{1F1E9}\u{1F1F0}', 'AT': '\u{1F1E6}\u{1F1F9}',
  'PY': '\u{1F1F5}\u{1F1FE}', 'JP': '\u{1F1EF}\u{1F1F5}', 'KR': '\u{1F1F0}\u{1F1F7}',
  'AU': '\u{1F1E6}\u{1F1FA}', 'NG': '\u{1F1F3}\u{1F1EC}', 'RS': '\u{1F1F7}\u{1F1F8}',
  'TR': '\u{1F1F9}\u{1F1F7}', 'CA': '\u{1F1E8}\u{1F1E6}', 'PL': '\u{1F1F5}\u{1F1F1}',
  'EU': '\u{1F1EA}\u{1F1FA}', 'SA': '\u{1F30E}', 'AF': '\u{1F30D}', 'AS': '\u{1F30F}', 'NA': '\u{1F30E}',
};

const COUNTRY_NAMES: Record<string, string> = {
  'ES': 'Spain', 'GB-ENG': 'England', 'FR': 'France', 'BR': 'Brazil', 'AR': 'Argentina',
  'PT': 'Portugal', 'DE': 'Germany', 'NL': 'Netherlands', 'NO': 'Norway', 'IT': 'Italy',
  'BE': 'Belgium', 'CO': 'Colombia', 'MA': 'Morocco', 'US': 'USA', 'MX': 'Mexico',
  'UY': 'Uruguay', 'EC': 'Ecuador', 'HR': 'Croatia', 'CM': 'Cameroon', 'SN': 'Senegal',
  'CH': 'Switzerland', 'DK': 'Denmark', 'AT': 'Austria', 'PY': 'Paraguay', 'JP': 'Japan',
  'KR': 'South Korea', 'AU': 'Australia', 'NG': 'Nigeria', 'RS': 'Serbia', 'TR': 'Turkey',
  'CA': 'Canada', 'PL': 'Poland',
};

function TeamFlag({ code, size = 32, className = '' }: { code: string; size?: number; className?: string }) {
  const [imgError, setImgError] = useState(false);
  const flagCode = FLAG_CODE_MAP[code];
  if (flagCode && !imgError) {
    return (
      <img
        src={`https://flagcdn.com/w80/${flagCode}.png`}
        srcSet={`https://flagcdn.com/w160/${flagCode}.png 2x`}
        alt={COUNTRY_NAMES[code] || code}
        width={size}
        height={Math.round(size * 0.75)}
        className={`rounded-sm object-cover shadow-sm ${className}`}
        style={{ width: size, height: Math.round(size * 0.75) }}
        loading="lazy"
        onError={() => setImgError(true)}
      />
    );
  }
  const emoji = FLAG_EMOJI[code] || '\u{1F3F3}\u{FE0F}';
  return <span className={className} style={{ fontSize: size * 0.7 }}>{emoji}</span>;
}

function getOddsColor(odds: number): string {
  if (odds <= 6) return 'text-cyan-400';
  if (odds <= 15) return 'text-teal-400';
  if (odds <= 50) return 'text-emerald-400';
  if (odds <= 100) return 'text-amber-400';
  return 'text-orange-400';
}

function getOddsTier(odds: number): { label: string; color: string; bg: string } {
  if (odds <= 6) return { label: 'FAVOURITE', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/30' };
  if (odds <= 15) return { label: 'CONTENDER', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/30' };
  if (odds <= 50) return { label: 'DARK HORSE', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' };
  if (odds <= 100) return { label: 'LONGSHOT', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' };
  return { label: 'OUTSIDER', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' };
}

function WorldCupTrophy({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="trophyGold" x1="16" y1="4" x2="48" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFD700" />
          <stop offset="40%" stopColor="#F5C518" />
          <stop offset="70%" stopColor="#DAA520" />
          <stop offset="100%" stopColor="#B8860B" />
        </linearGradient>
        <linearGradient id="trophyShine" x1="24" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF8DC" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#FFD700" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="baseGrad" x1="20" y1="50" x2="44" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <path d="M20 8h24v4c0 12-4 22-12 26-8-4-12-14-12-26V8z" fill="url(#trophyGold)" stroke="#B8860B" strokeWidth="1.5"/>
      <path d="M22 10h10v2c0 10-3 18-5 20-3-3-5-10-5-20V10z" fill="url(#trophyShine)" />
      <path d="M20 10C16 10 10 14 10 22c0 6 4 10 8 12l2-2c-4-2-7-5-7-10 0-6 3-10 7-12z" fill="url(#trophyGold)" stroke="#B8860B" strokeWidth="1"/>
      <path d="M44 10c4 0 10 4 10 12 0 6-4 10-8 12l-2-2c4-2 7-5 7-10 0-6-3-10-7-12z" fill="url(#trophyGold)" stroke="#B8860B" strokeWidth="1"/>
      <rect x="29" y="36" width="6" height="10" rx="1" fill="url(#trophyGold)" stroke="#B8860B" strokeWidth="1"/>
      <path d="M22 48h20c1 0 2 1 2 2v4H20v-4c0-1 1-2 2-2z" fill="url(#baseGrad)" stroke="#0E7490" strokeWidth="1"/>
      <circle cx="32" cy="20" r="5" fill="none" stroke="#B8860B" strokeWidth="1.5" opacity="0.4"/>
      <path d="M30 18l2 2 4-4" stroke="#B8860B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
      <rect x="18" y="56" width="28" height="4" rx="2" fill="url(#baseGrad)" stroke="#0E7490" strokeWidth="1"/>
    </svg>
  );
}

interface FuturesSelection {
  id: string;
  name: string;
  odds: number;
  flag: string;
}

interface FuturesMarket {
  id: string;
  name: string;
  selections: FuturesSelection[];
}

interface FuturesData {
  id: string;
  name: string;
  type: string;
  description: string;
  closingDate: string;
  settlementDate: string;
  status: string;
  timeUntilClose: number;
  markets: FuturesMarket[];
}

const MARKET_ICONS: Record<string, typeof Star> = {
  'wc2026_outright': Shield,
  'wc2026_reach_final': Star,
  'wc2026_top_scorer_team': Target,
  'wc2026_continent': Globe,
  'wc2026_total_goals': BarChart3,
  'wc2026_golden_boot': Award,
  'wc2026_group_stage_exit': XCircle,
};

export default function WorldCupPage() {
  const [activeMarket, setActiveMarket] = useState('wc2026_outright');
  const [searchQuery, setSearchQuery] = useState('');
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [pageTab, setPageTab] = useState<'futures' | 'matches' | 'groups' | 'news'>('futures');
  const { selectedBets, addBet, removeBet, clearBets } = useBetting();
  const { toast } = useToast();
  const currentAccount = useCurrentAccount();
  const { zkLoginAddress, isZkLoginActive } = useZkLogin();
  const activeWallet = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);

  const { data: futuresData, isLoading } = useQuery<FuturesData>({
    queryKey: ['/api/futures/world-cup-2026'],
  });

  const { data: stakeLimits } = useQuery<{ maxStakeSbets: number; maxStakeSui: number; maxPayoutSbets: number; maxPayoutSui: number }>({
    queryKey: ['/api/futures/stake-limits'],
  });

  const { data: streamingMatches } = useQuery<any[]>({
    queryKey: ['/api/streaming/football'],
    refetchInterval: 60000,
  });

  const { data: newsData, isLoading: newsLoading, refetch: refetchNews } = useQuery<{ articles: any[] }>({
    queryKey: ['/api/world-cup/news'],
    enabled: pageTab === 'news',
  });

  const { data: groupsData } = useQuery<{ groups: any[]; drawDate: string; tournamentStart: string; tournamentEnd: string }>({
    queryKey: ['/api/world-cup/groups'],
    enabled: pageTab === 'groups',
  });

  const WC_START = new Date('2026-06-11T00:00:00Z').getTime();
  const [countdown, setCountdown] = useState(() => {
    const diff = WC_START - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, started: true };
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
      started: false,
    };
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = WC_START - Date.now();
      if (diff <= 0) {
        setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0, started: true });
        clearInterval(timer);
        return;
      }
      setCountdown({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
        started: false,
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const wcMatches = useMemo(() => {
    if (!streamingMatches) return [];
    return streamingMatches.filter((m: any) => {
      const title = (m.title || m.name || '').toLowerCase();
      const cat = (m.category || m.league || '').toLowerCase();
      return cat.includes('world cup') || cat.includes('fifa') || title.includes('world cup') || title.includes('wc 2026');
    });
  }, [streamingMatches]);

  const currentMarket = useMemo(() => {
    if (!futuresData || !futuresData.markets) return null;
    return futuresData.markets.find(m => m.id === activeMarket) || futuresData.markets[0] || null;
  }, [futuresData, activeMarket]);

  const filteredSelections = useMemo(() => {
    if (!currentMarket) return [];
    if (!searchQuery) return currentMarket.selections;
    return currentMarket.selections.filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [currentMarket, searchQuery]);

  const handleSelectTeam = (selection: FuturesSelection) => {
    if (!activeWallet) {
      setIsWalletModalOpen(true);
      return;
    }

    const isAlreadySelected = selectedBets.some(
      b => b.eventId === selection.id
    );

    if (isAlreadySelected) {
      removeBet(selection.id);
      return;
    }

    addBet({
      id: selection.id,
      eventId: selection.id,
      eventName: `World Cup 2026 - ${currentMarket?.name || 'Outright Winner'}`,
      selectionName: selection.name,
      odds: selection.odds,
      stake: 0,
      market: currentMarket?.name || 'Outright Winner',
      marketId: 1,
      outcomeId: selection.id,
      homeTeam: selection.name,
      awayTeam: 'World Cup 2026',
      uniqueId: `wc2026_${selection.id}_${Date.now()}`,
    });

    toast({
      title: `${selection.name} added to bet slip`,
      description: `${currentMarket?.name} @ ${selection.odds.toFixed(2)}x`,
    });
  };

  const timeUntilClose = futuresData?.timeUntilClose || 0;
  const daysLeft = Math.floor(timeUntilClose / (1000 * 60 * 60 * 24));
  const marketTabs = futuresData?.markets || [];

  return (
    <div className="min-h-screen bg-[#060a10] text-white">
      <div className="sticky top-0 z-40 bg-[#060a10]/95 backdrop-blur-xl border-b border-cyan-500/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <button className="text-gray-400 hover:text-cyan-400 p-1.5 rounded-lg hover:bg-cyan-500/10 transition-all" data-testid="btn-back-home">
                <ArrowLeft size={20} />
              </button>
            </Link>
            <div className="flex items-center gap-2.5">
              <WorldCupTrophy size={32} />
              <div>
                <h1 className="text-base md:text-lg font-bold leading-tight">
                  <span className="bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent">FIFA</span>
                  <span className="text-white ml-1.5">World Cup 2026</span>
                </h1>
                <p className="text-[10px] text-gray-500 tracking-wider">POWERED BY SUIBETS</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {futuresData?.status === 'open' && (
              <div className="flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 rounded-full" data-testid="status-open">
                <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
                <span className="text-cyan-400 text-xs font-semibold tracking-wider">LIVE</span>
              </div>
            )}
            {daysLeft > 0 && (
              <div className="hidden md:flex items-center gap-1.5 text-gray-400 text-xs bg-white/5 px-3 py-1.5 rounded-full" data-testid="text-days-left">
                <Clock size={12} />
                <span>{daysLeft}d remaining</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="relative rounded-2xl overflow-hidden mb-8">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/80 via-[#0a1628] to-teal-950/60"></div>
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: `radial-gradient(circle at 20% 50%, rgba(6, 182, 212, 0.3) 0%, transparent 50%),
                             radial-gradient(circle at 80% 30%, rgba(20, 184, 166, 0.2) 0%, transparent 50%),
                             radial-gradient(circle at 50% 80%, rgba(6, 182, 212, 0.15) 0%, transparent 50%)`
          }}></div>
          <div className="absolute top-0 right-0 w-64 h-64 opacity-[0.03]">
            <WorldCupTrophy size={256} />
          </div>
          <div className="relative border border-cyan-500/15 rounded-2xl">
            <div className="px-6 py-8 md:px-10 md:py-10">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="relative">
                      <div className="absolute inset-0 bg-cyan-400/20 rounded-xl blur-xl"></div>
                      <div className="relative bg-gradient-to-br from-[#0d1b2a] to-[#0a1628] p-3 rounded-xl border border-cyan-500/20">
                        <WorldCupTrophy size={40} />
                      </div>
                    </div>
                    <div>
                      <h2 className="text-2xl md:text-3xl font-black">
                        <span className="bg-gradient-to-r from-white via-cyan-100 to-white bg-clip-text text-transparent">World Cup 2026</span>
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-1.5">
                          <TeamFlag code="US" size={18} className="rounded-[2px]" />
                          <span className="text-cyan-400/60 text-xs font-medium">USA</span>
                        </div>
                        <span className="text-cyan-500/30 text-xs">·</span>
                        <div className="flex items-center gap-1.5">
                          <TeamFlag code="MX" size={18} className="rounded-[2px]" />
                          <span className="text-cyan-400/60 text-xs font-medium">Mexico</span>
                        </div>
                        <span className="text-cyan-500/30 text-xs">·</span>
                        <div className="flex items-center gap-1.5">
                          <TeamFlag code="CA" size={18} className="rounded-[2px]" />
                          <span className="text-cyan-400/60 text-xs font-medium">Canada</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-400 text-sm leading-relaxed max-w-xl">
                    Place your prediction on the biggest sporting event in the world.
                    Settled on-chain after the final on July 19, 2026.
                  </p>
                  <div className="flex flex-wrap gap-3 mt-5">
                    <div className="flex items-center gap-1.5 bg-cyan-500/10 px-3 py-1.5 rounded-lg border border-cyan-500/15">
                      <Globe size={13} className="text-cyan-400" />
                      <span className="text-cyan-300 text-xs font-medium">48 Teams</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-cyan-500/10 px-3 py-1.5 rounded-lg border border-cyan-500/15">
                      <Zap size={13} className="text-cyan-400" />
                      <span className="text-cyan-300 text-xs font-medium">104 Matches</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-cyan-500/10 px-3 py-1.5 rounded-lg border border-cyan-500/15">
                      <TrendingUp size={13} className="text-cyan-400" />
                      <span className="text-cyan-300 text-xs font-medium">Up to 251x Odds</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-gradient-to-br from-cyan-950/80 to-[#0a1628] rounded-2xl border border-cyan-500/20 text-center min-w-[200px] overflow-hidden" data-testid="countdown-timer">
                    <div className="px-4 py-2 border-b border-cyan-500/10">
                      <p className="text-cyan-500/70 text-[10px] uppercase tracking-[0.2em] font-semibold">
                        {countdown.started ? 'Tournament Live' : 'Kicks Off In'}
                      </p>
                    </div>
                    {countdown.started ? (
                      <div className="px-4 py-3">
                        <p className="text-cyan-400 font-black text-lg animate-pulse">LIVE NOW</p>
                      </div>
                    ) : (
                      <div className="px-3 py-3 flex gap-1.5 justify-center">
                        {[
                          { val: countdown.days, label: 'D' },
                          { val: countdown.hours, label: 'H' },
                          { val: countdown.minutes, label: 'M' },
                          { val: countdown.seconds, label: 'S' },
                        ].map((unit) => (
                          <div key={unit.label} className="flex flex-col items-center">
                            <div className="bg-[#060a10] border border-cyan-500/15 rounded-lg w-11 h-11 flex items-center justify-center">
                              <span className="text-white font-black text-lg tabular-nums">{String(unit.val).padStart(2, '0')}</span>
                            </div>
                            <span className="text-cyan-500/50 text-[8px] font-bold mt-1 tracking-wider">{unit.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {stakeLimits && (
                    <div className="text-[10px] text-gray-500 text-center leading-relaxed">
                      <p>Max stake: {stakeLimits.maxStakeSbets.toLocaleString()} SBETS / {stakeLimits.maxStakeSui} SUI</p>
                      <p>Max payout: {stakeLimits.maxPayoutSbets.toLocaleString()} SBETS</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setPageTab('futures')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
              pageTab === 'futures'
                ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg shadow-cyan-500/20'
                : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-300'
            }`}
            data-testid="page-tab-futures"
          >
            <TrendingUp size={16} />
            Futures Betting
          </button>
          <button
            onClick={() => setPageTab('groups')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
              pageTab === 'groups'
                ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg shadow-cyan-500/20'
                : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-300'
            }`}
            data-testid="page-tab-groups"
          >
            <Table2 size={16} />
            Groups
          </button>
          <button
            onClick={() => setPageTab('news')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
              pageTab === 'news'
                ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg shadow-cyan-500/20'
                : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-300'
            }`}
            data-testid="page-tab-news"
          >
            <Newspaper size={16} />
            News
          </button>
          <button
            onClick={() => setPageTab('matches')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
              pageTab === 'matches'
                ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg shadow-cyan-500/20'
                : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-300'
            }`}
            data-testid="page-tab-matches"
          >
            <Radio size={16} />
            Live & Upcoming
            {wcMatches.length > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{wcMatches.length}</span>
            )}
          </button>
        </div>

        {pageTab === 'matches' && (
          <WCMatchesSection matches={wcMatches} allMatches={streamingMatches || []} />
        )}

        {pageTab === 'groups' && (
          <WCGroupsSection groups={groupsData?.groups || []} isLoaded={!!groupsData} />
        )}

        {pageTab === 'news' && (
          <WCNewsSection articles={newsData?.articles || []} isLoading={newsLoading} onRefresh={() => refetchNews()} />
        )}

        {pageTab === 'futures' && <>
        <div className="mb-6 flex flex-col md:flex-row gap-3">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {marketTabs.map(market => {
              const IconComponent = MARKET_ICONS[market.id] || Shield;
              const isActive = activeMarket === market.id;
              return (
                <button
                  key={market.id}
                  onClick={() => { setActiveMarket(market.id); setSearchQuery(''); }}
                  className={`group px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200 flex items-center gap-2 ${
                    isActive
                      ? 'bg-gradient-to-r from-cyan-500/20 to-teal-500/15 text-cyan-400 border border-cyan-500/30 shadow-lg shadow-cyan-500/5'
                      : 'bg-white/[0.02] text-gray-500 border border-white/5 hover:text-gray-300 hover:bg-white/[0.04] hover:border-white/10'
                  }`}
                  data-testid={`tab-market-${market.id}`}
                >
                  <IconComponent size={14} className={isActive ? 'text-cyan-400' : 'text-gray-600 group-hover:text-gray-400'} />
                  {market.name}
                </button>
              );
            })}
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={16} />
            <input
              type="text"
              placeholder="Search teams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-cyan-500/40 focus:bg-white/[0.05] transition-all"
              data-testid="input-search-futures"
            />
          </div>
        </div>

        {currentMarket && (
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(() => { const Icon = MARKET_ICONS[currentMarket.id] || Shield; return <Icon size={20} className="text-cyan-400" />; })()}
              <h3 className="text-xl font-black bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent" data-testid="text-market-name">
                {currentMarket.name}
              </h3>
            </div>
            <span className="text-xs text-gray-500 bg-white/[0.03] px-3.5 py-1.5 rounded-full border border-white/[0.06] font-medium">
              {filteredSelections.length} selections
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-20">
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 border-2 border-cyan-500/20 rounded-full"></div>
              <div className="absolute inset-0 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-2 flex items-center justify-center">
                <WorldCupTrophy size={28} />
              </div>
            </div>
            <p className="text-gray-500 text-sm">Loading World Cup futures...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-32">
            {filteredSelections.map((selection, index) => {
              const isSelected = selectedBets.some(b => b.eventId === selection.id);
              const tier = getOddsTier(selection.odds);
              const oddsColor = getOddsColor(selection.odds);
              const isTopThree = index < 3 && activeMarket === 'wc2026_outright';
              const isPlayerMarket = activeMarket === 'wc2026_golden_boot';
              const hasFlag = FLAG_CODE_MAP[selection.flag];

              return (
                <button
                  key={selection.id}
                  onClick={() => handleSelectTeam(selection)}
                  className={`group relative rounded-2xl transition-all duration-300 text-left overflow-hidden ${
                    isSelected
                      ? 'bg-gradient-to-br from-cyan-500/15 to-teal-500/10 border-2 border-cyan-500/50 shadow-xl shadow-cyan-500/15 scale-[1.02]'
                      : 'bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.06] hover:border-cyan-500/30 hover:bg-gradient-to-br hover:from-cyan-500/[0.06] hover:to-teal-500/[0.03] hover:shadow-lg hover:shadow-cyan-500/5 hover:scale-[1.01]'
                  }`}
                  data-testid={`btn-select-${selection.id}`}
                >
                  {isTopThree && (
                    <div className={`absolute top-0 left-0 right-0 h-1 ${
                      index === 0 ? 'bg-gradient-to-r from-cyan-400 via-teal-400 to-cyan-400' :
                      index === 1 ? 'bg-gradient-to-r from-gray-300 via-gray-200 to-gray-300' :
                      'bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600'
                    }`}></div>
                  )}

                  {hasFlag && (
                    <div className="absolute top-0 right-0 w-24 h-16 overflow-hidden opacity-[0.06] pointer-events-none">
                      <TeamFlag code={selection.flag} size={96} className="absolute -top-2 -right-4 rotate-6" />
                    </div>
                  )}

                  <div className="p-4 relative">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`relative flex-shrink-0 ${isTopThree ? '' : ''}`}>
                        <div className={`rounded-xl overflow-hidden flex items-center justify-center transition-all ${
                          isSelected
                            ? 'ring-2 ring-cyan-400/40 shadow-lg shadow-cyan-400/10'
                            : 'ring-1 ring-white/10 group-hover:ring-cyan-500/20'
                        } ${hasFlag ? 'bg-[#0a1628] p-1.5' : 'bg-white/[0.03] p-2'}`}>
                          <TeamFlag code={selection.flag} size={isTopThree ? 36 : 30} />
                        </div>
                        {isTopThree && (
                          <div className={`absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shadow-md ${
                            index === 0 ? 'bg-gradient-to-br from-cyan-400 to-teal-400 text-black' :
                            index === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-black' :
                            'bg-gradient-to-br from-amber-500 to-amber-700 text-white'
                          }`}>
                            {index + 1}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-sm transition-colors truncate ${isSelected ? 'text-cyan-300' : 'text-white group-hover:text-cyan-200'}`}>
                          {selection.name}
                        </p>
                        {isPlayerMarket && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <TeamFlag code={selection.flag} size={12} className="opacity-60" />
                            <span className="text-gray-500 text-[10px]">{COUNTRY_NAMES[selection.flag] || selection.flag}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-end justify-between">
                      <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${tier.bg} ${tier.color}`}>
                        {tier.label}
                      </span>
                      <div className={`text-right rounded-xl px-3.5 py-2 transition-all ${
                        isSelected
                          ? 'bg-cyan-500/20 border border-cyan-400/40'
                          : 'bg-white/[0.04] border border-white/[0.06] group-hover:bg-cyan-500/10 group-hover:border-cyan-500/25'
                      }`}>
                        <p className={`font-black text-xl tabular-nums leading-none ${isSelected ? 'text-cyan-400' : oddsColor}`}>
                          {selection.odds.toFixed(2)}
                        </p>
                        <p className="text-[7px] text-gray-600 uppercase tracking-widest font-bold mt-0.5">odds</p>
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="bg-gradient-to-r from-cyan-500/15 to-teal-500/10 border-t border-cyan-500/20 px-4 py-2 text-center">
                      <span className="text-cyan-400 text-xs font-bold flex items-center justify-center gap-1.5">
                        <Zap size={11} />
                        Added to Bet Slip
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {filteredSelections.length === 0 && !isLoading && (
          <div className="text-center py-16 bg-white/[0.02] rounded-2xl border border-white/5">
            <Search size={32} className="mx-auto text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No teams match your search.</p>
            <button onClick={() => setSearchQuery('')} className="text-cyan-500 text-sm mt-2 hover:text-cyan-400">Clear search</button>
          </div>
        )}
        </>}
      </div>

      {selectedBets.length > 0 && (
        <FuturesBetBar
          bets={selectedBets}
          onClear={clearBets}
          onRemove={removeBet}
        />
      )}

      <ConnectWalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />

      <Footer />
    </div>
  );
}

function WCGroupsSection({ groups, isLoaded }: { groups: any[]; isLoaded: boolean }) {
  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-16">
        <Table2 size={40} className="text-gray-700 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">Group data unavailable</p>
        <p className="text-gray-600 text-xs mt-1">Please try again later</p>
      </div>
    );
  }

  const getGroupDifficulty = (teams: any[]) => {
    const avgRank = teams.reduce((s: number, t: any) => s + t.fifaRank, 0) / teams.length;
    if (avgRank <= 20) return { label: 'Group of Death', color: 'text-red-400 bg-red-500/10 border-red-500/20' };
    if (avgRank <= 35) return { label: 'Strong Group', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' };
    if (avgRank <= 50) return { label: 'Balanced', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' };
    return { label: 'Open Group', color: 'text-green-400 bg-green-500/10 border-green-500/20' };
  };

  return (
    <div className="mb-8">
      <div className="mb-6 bg-gradient-to-r from-cyan-500/10 to-teal-500/5 border border-cyan-500/20 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-2">
          <Table2 size={20} className="text-cyan-400" />
          <h3 className="text-lg font-bold text-white">2026 World Cup Groups</h3>
        </div>
        <p className="text-sm text-gray-400">48 teams across 12 groups. Top 2 from each group plus 8 best third-placed teams advance to the Round of 32.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((g: any) => {
          const difficulty = getGroupDifficulty(g.teams);
          return (
            <div key={g.group} className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden hover:border-cyan-500/20 transition-all" data-testid={`group-card-${g.group}`}>
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-cyan-400">Group {g.group}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${difficulty.color}`}>{difficulty.label}</span>
              </div>
              <div className="divide-y divide-white/5">
                {g.teams.map((team: any, idx: number) => {
                  const flagCode = FLAG_CODE_MAP[team.code] || team.code.toLowerCase();
                  return (
                    <div key={team.code} className="px-4 py-3 flex items-center justify-between group hover:bg-white/[0.02] transition-colors" data-testid={`group-team-${team.code}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-600 text-xs w-4 text-center font-mono">{idx + 1}</span>
                        <img
                          src={`https://flagcdn.com/24x18/${flagCode}.png`}
                          alt={team.name}
                          className="w-6 h-4 rounded-sm object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-white font-medium text-sm">{team.name}</span>
                      </div>
                      <span className="text-gray-500 text-xs font-mono">#{team.fifaRank}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 text-center">
          <div className="text-2xl font-black text-cyan-400 mb-1">48</div>
          <div className="text-xs text-gray-500">Qualified Teams</div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 text-center">
          <div className="text-2xl font-black text-cyan-400 mb-1">16</div>
          <div className="text-xs text-gray-500">Host Venues</div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 text-center">
          <div className="text-2xl font-black text-cyan-400 mb-1">104</div>
          <div className="text-xs text-gray-500">Total Matches</div>
        </div>
      </div>
    </div>
  );
}

function getNewsCategory(title: string): { label: string; color: string; bgColor: string } {
  const t = title.toLowerCase();
  if (t.includes('qualif') || t.includes('playoff') || t.includes('eliminat')) return { label: 'QUALIFYING', color: 'text-amber-400', bgColor: 'bg-amber-500/15 border-amber-500/25' };
  if (t.includes('draw') || t.includes('group stage') || t.includes('groups')) return { label: 'DRAW', color: 'text-violet-400', bgColor: 'bg-violet-500/15 border-violet-500/25' };
  if (t.includes('injur') || t.includes('ruled out') || t.includes('miss')) return { label: 'INJURY', color: 'text-red-400', bgColor: 'bg-red-500/15 border-red-500/25' };
  if (t.includes('transfer') || t.includes('sign') || t.includes('move')) return { label: 'TRANSFER', color: 'text-blue-400', bgColor: 'bg-blue-500/15 border-blue-500/25' };
  if (t.includes('stadium') || t.includes('venue') || t.includes('host cit') || t.includes('ticket')) return { label: 'VENUE', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15 border-emerald-500/25' };
  if (t.includes('score') || t.includes('win') || t.includes('beat') || t.includes('defeat') || t.includes('advance') || t.includes('recap')) return { label: 'RESULTS', color: 'text-green-400', bgColor: 'bg-green-500/15 border-green-500/25' };
  if (t.includes('schedule') || t.includes('fixture') || t.includes('date')) return { label: 'SCHEDULE', color: 'text-sky-400', bgColor: 'bg-sky-500/15 border-sky-500/25' };
  if (t.includes('predict') || t.includes('odds') || t.includes('favorit') || t.includes('favourite')) return { label: 'ODDS', color: 'text-cyan-400', bgColor: 'bg-cyan-500/15 border-cyan-500/25' };
  return { label: 'NEWS', color: 'text-gray-400', bgColor: 'bg-white/5 border-white/10' };
}

function WCNewsSection({ articles, isLoading, onRefresh }: { articles: any[]; isLoading: boolean; onRefresh: () => void }) {
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());
  const handleImageError = (idx: number) => setFailedImages(prev => new Set(prev).add(idx));

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 animate-pulse">
            <div className="h-3 bg-white/5 rounded w-16 mb-4"></div>
            <div className="h-5 bg-white/5 rounded w-full mb-2"></div>
            <div className="h-5 bg-white/5 rounded w-3/4 mb-4"></div>
            <div className="h-3 bg-white/5 rounded w-1/3"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="mb-6 bg-gradient-to-r from-cyan-500/10 to-teal-500/5 border border-cyan-500/20 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Newspaper size={20} className="text-cyan-400" />
          <div>
            <h3 className="text-lg font-bold text-white">World Cup 2026 News</h3>
            <p className="text-sm text-gray-400">Latest headlines from around the world</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] text-gray-400 hover:text-cyan-400 transition-all"
          data-testid="btn-refresh-news"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {articles.length === 0 ? (
        <div className="text-center py-16">
          <Newspaper size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No news articles available right now</p>
          <p className="text-gray-600 text-xs mt-1">Check back soon for the latest World Cup updates</p>
        </div>
      ) : (
        <div className="space-y-4">
          {articles[0] && (() => {
            const showImage = articles[0].image && !failedImages.has(-1);
            const cat = getNewsCategory(articles[0].title);
            return (
              <a
                href={articles[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className="block relative bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/[0.08] rounded-2xl overflow-hidden hover:border-cyan-500/30 transition-all"
                data-testid="news-featured"
              >
                {showImage && (
                  <div className="relative w-full h-48 sm:h-56 overflow-hidden">
                    <img
                      src={articles[0].image}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={() => handleImageError(-1)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#060a10] via-[#060a10]/70 to-transparent"></div>
                  </div>
                )}
                <div className={`${showImage ? 'absolute bottom-0 left-0 right-0' : ''} p-5`}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className={`${cat.bgColor} ${cat.color} text-[10px] font-bold px-2.5 py-0.5 rounded-full border`}>{cat.label}</span>
                    <span className="text-gray-400 text-xs font-medium">{articles[0].source}</span>
                    <span className="text-gray-600 text-[10px]">{articles[0].timeAgo}</span>
                  </div>
                  <h3 className="text-white font-bold text-lg sm:text-xl leading-tight mb-1">{articles[0].title}</h3>
                  {articles[0].description && (
                    <p className="text-gray-400 text-sm leading-relaxed line-clamp-2 mt-2">{articles[0].description}</p>
                  )}
                </div>
              </a>
            );
          })()}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {articles.slice(1).map((article: any, idx: number) => {
              const cat = getNewsCategory(article.title);
              const showImg = article.image && !failedImages.has(idx);
              return (
                <a
                  key={idx}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden hover:bg-white/[0.04] hover:border-white/10 transition-all block"
                  data-testid={`news-article-${idx}`}
                >
                  <div className="flex h-full">
                    {showImg ? (
                      <div className="w-24 sm:w-32 flex-shrink-0 relative overflow-hidden bg-white/[0.03]">
                        <img
                          src={article.image}
                          alt=""
                          className="w-full h-full object-cover min-h-[110px]"
                          onError={() => handleImageError(idx)}
                        />
                      </div>
                    ) : (
                      <div className={`w-1.5 flex-shrink-0 ${cat.color === 'text-gray-400' ? 'bg-cyan-500/20' : cat.bgColor.split(' ')[0].replace('/15', '/30')}`}></div>
                    )}
                    <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`${cat.bgColor} ${cat.color} text-[9px] font-bold px-2 py-px rounded-full border`}>{cat.label}</span>
                        </div>
                        <h4 className="text-white font-semibold text-[13px] leading-snug mb-1.5 line-clamp-3 group-hover:text-gray-100">
                          {article.title}
                        </h4>
                        {article.description && (
                          <p className="text-gray-500 text-xs leading-relaxed line-clamp-2 mb-1.5">{article.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] mt-1">
                        <span className="text-cyan-400/60 font-medium truncate max-w-[140px]">{article.source}</span>
                        <span className="text-gray-700">·</span>
                        <span className="text-gray-600">{article.timeAgo}</span>
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function WCMatchesSection({ matches, allMatches }: { matches: any[]; allMatches: any[] }) {
  const [selectedStream, setSelectedStream] = useState<string | null>(null);

  if (matches.length === 0) {
    return (
      <div className="text-center py-16 bg-white/[0.02] rounded-2xl border border-white/5 mb-8">
        <Radio size={40} className="mx-auto text-gray-700 mb-4" />
        <h3 className="text-white font-semibold text-lg mb-2">No World Cup Matches Right Now</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto mb-4">
          The tournament kicks off June 11, 2026. Check back during the tournament for live match streams and real-time betting.
        </p>
        <div className="flex items-center justify-center gap-2 text-cyan-400/60 text-xs">
          <Clock size={12} />
          <span>Matches auto-update every 60 seconds</span>
        </div>
        {allMatches.length > 0 && (
          <div className="mt-6 pt-6 border-t border-white/5">
            <p className="text-gray-600 text-xs mb-3">Other live football available now:</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
              {allMatches.slice(0, 6).map((m: any, i: number) => (
                <span key={i} className="bg-white/[0.03] text-gray-500 text-xs px-3 py-1 rounded-full border border-white/5">
                  {m.title || m.name || 'Match'}
                </span>
              ))}
              {allMatches.length > 6 && (
                <Link href="/">
                  <span className="text-cyan-500 text-xs hover:text-cyan-400">+{allMatches.length - 6} more on SuiBets</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-8 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Radio size={18} className="text-red-500 animate-pulse" />
          World Cup Matches
        </h3>
        <span className="text-xs text-gray-600 bg-white/[0.03] px-3 py-1 rounded-full border border-white/5">
          {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {matches.map((match: any, index: number) => {
          const isLive = match.status === 'live' || match.isLive;
          const streamUrl = match.streamUrl || match.embed;
          return (
            <div
              key={match.id || index}
              className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] rounded-xl border border-white/5 overflow-hidden hover:border-cyan-500/20 transition-all"
              data-testid={`wc-match-card-${index}`}
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {isLive && (
                      <span className="flex items-center gap-1 bg-red-500/15 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-red-500/20">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                        LIVE
                      </span>
                    )}
                    <span className="text-gray-600 text-xs">{match.category || match.league || 'World Cup 2026'}</span>
                  </div>
                  {match.time && <span className="text-cyan-400 text-xs font-mono">{match.time}</span>}
                </div>
                <h4 className="text-white font-semibold text-sm mb-2">{match.title || match.name}</h4>
                {streamUrl && (
                  <button
                    onClick={() => setSelectedStream(selectedStream === streamUrl ? null : streamUrl)}
                    className="flex items-center gap-1.5 text-cyan-400 text-xs hover:text-cyan-300 transition-colors mt-1"
                    data-testid={`btn-watch-stream-${index}`}
                  >
                    <Play size={12} />
                    {selectedStream === streamUrl ? 'Hide Stream' : 'Watch Stream'}
                  </button>
                )}
              </div>
              {selectedStream === streamUrl && streamUrl && (
                <div className="border-t border-white/5">
                  <div className="aspect-video bg-black">
                    <iframe
                      src={streamUrl}
                      className="w-full h-full"
                      allowFullScreen
                      allow="autoplay; encrypted-media"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FuturesBetBar({ bets, onClear, onRemove }: { bets: any[]; onClear: () => void; onRemove: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const combinedOdds = bets.reduce((acc, b) => acc * (b.odds || 1), 1);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#060a10]/98 backdrop-blur-xl border-t border-cyan-500/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold px-4 py-3 flex items-center justify-between hover:from-cyan-500 hover:to-teal-500 transition-all"
        data-testid="btn-futures-betslip-toggle"
      >
        <div className="flex items-center gap-3">
          <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-sm font-black">{bets.length}</span>
          <span className="text-sm">World Cup Bet Slip</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono bg-white/10 px-2 py-0.5 rounded">{combinedOdds.toFixed(2)}x</span>
          {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </div>
      </button>

      {expanded && (
        <div className="bg-[#0a0e14] border-t border-cyan-500/10">
          <div className="max-h-48 overflow-y-auto p-4 space-y-2">
            {bets.map((bet, i) => (
              <div key={bet.id || i} className="bg-white/[0.03] rounded-lg p-3 flex items-center justify-between border border-white/5">
                <div>
                  <p className="text-white text-sm font-medium">{bet.selectionName}</p>
                  <p className="text-cyan-400/70 text-xs">{bet.market} @ {bet.odds?.toFixed(2)}x</p>
                </div>
                <button onClick={() => onRemove(bet.id)} className="text-red-400/70 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-all" data-testid={`btn-remove-futures-bet-${i}`}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-cyan-500/10 flex justify-between items-center">
            <button onClick={onClear} className="text-gray-500 hover:text-red-400 text-sm transition-colors" data-testid="btn-clear-futures">Clear All</button>
            <Link href="/">
              <button className="bg-gradient-to-r from-cyan-500 to-teal-500 text-white font-bold px-6 py-2.5 rounded-xl hover:from-cyan-400 hover:to-teal-400 transition-all shadow-lg shadow-cyan-500/20" data-testid="btn-place-futures-bet">
                Place Bet
              </button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
