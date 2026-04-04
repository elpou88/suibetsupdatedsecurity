import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Search, Clock, TrendingUp, TrendingDown, Wallet, LogOut, RefreshCw, Menu, X, Star, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trash2, Info, MoreHorizontal, FileText, Activity, ArrowUpDown, Target, Trophy, Brain, Zap, Users, BarChart3, Shield, Bell, Globe, DollarSign, CheckCircle, XCircle, MessageCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuiNSName from '@/components/SuiNSName';
import sportMarketsAdapter from "@/lib/sportMarketsAdapter";
import { useBetting } from "@/context/BettingContext";
import { useToast } from "@/hooks/use-toast";
import { useCurrentAccount, useDisconnectWallet, useSuiClientQuery } from '@/lib/dapp-kit-compat';
import { useZkLogin } from "@/context/ZkLoginContext";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import Footer from "@/components/layout/Footer";
import LiveBetFeed from "@/components/betting/LiveBetFeed";
import { PremiumBadge } from "@/components/ui/PremiumBadge";
import { useLiveEvents, useUpcomingEvents } from "@/hooks/useEvents";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage, LANGUAGES, type Language } from "@/context/LanguageContext";
const suibetsHeroImage = "/images/hero-banner-original.png";

function FadeInSection({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function AnimatedCounter({ end, duration = 2000, suffix = "" }: { end: number; duration?: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);
  useEffect(() => {
    if (!started) return;
    let startTime: number;
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [started, end, duration]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// Favorites management using localStorage
const FAVORITES_KEY = 'suibets_favorites';

function getFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

const suibetsLogo = "/images/suibets-logo.png";
const suibetsHeroBg = "/images/hero-bg.png";

// Sport IDs match DB: 1=Soccer,2=Basketball,3=Tennis,4=AmericanFootball,5=Baseball,6=IceHockey,
// 7=MMA,8=Boxing,9=Esports,10=AFL,11=Formula1,12=Handball,13=NBA,14=NFL,15=Rugby,16=Volleyball,17=HorseRacing
const SPORTS_LIST = [
  { id: 1, name: "Football", icon: "⚽" },
  { id: 2, name: "Basketball", icon: "🏀" },
  { id: 6, name: "Hockey", icon: "🏒" },
  { id: 5, name: "Baseball", icon: "⚾" },
  { id: 16, name: "Volleyball", icon: "🏐" },
  { id: 12, name: "Handball", icon: "🤾" },
  { id: 15, name: "Rugby", icon: "🏉" },
  { id: 9, name: "Esports", icon: "🎮" },
  { id: 7, name: "MMA", icon: "🥊" },
  { id: 17, name: "Horse Racing", icon: "🏇" },
  { id: 8, name: "Boxing", icon: "🥊" },
  { id: 11, name: "Formula 1", icon: "🏎️" },
  { id: 19, name: "MotoGP", icon: "🏍️" },
  { id: 18, name: "Cricket", icon: "🏏" },
  { id: 3, name: "Tennis", icon: "🎾" },
  { id: 20, name: "WWE", icon: "🎭" },
  { id: 21, name: "Darts", icon: "🎯" },
  { id: 22, name: "Snooker", icon: "🎱" },
  { id: 23, name: "Table Tennis", icon: "🏓" },
  { id: 24, name: "Water Polo", icon: "🤽" },
  { id: 25, name: "Badminton", icon: "🏸" },
];

interface Outcome {
  id: string;
  name: string;
  odds: number;
  probability?: number;
}

interface Market {
  id: string;
  name: string;
  outcomes: Outcome[];
}

interface Event {
  id: string | number;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueName?: string;
  league?: string;
  startTime: string;
  isLive: boolean;
  score?: string;
  homeScore?: number;
  awayScore?: number;
  minute?: string;
  status?: string;
  markets?: Market[];
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  sportId: number;
}

interface BetNotification {
  id: string;
  type: 'won' | 'lost' | 'settled';
  message: string;
  amount?: string;
  timestamp: number;
  read: boolean;
}

function useNotifications(walletAddress?: string) {
  const [notifications, setNotifications] = useState<BetNotification[]>(() => {
    try {
      const saved = localStorage.getItem('suibets-notifications');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [lastChecked, setLastChecked] = useState<number>(() => {
    return parseInt(localStorage.getItem('suibets-notif-last') || '0');
  });

  useEffect(() => {
    if (!walletAddress) return;
    const checkBets = async () => {
      try {
        const res = await fetch(`/api/bets?wallet=${walletAddress}&limit=20`);
        if (!res.ok) return;
        const data = await res.json();
        const bets = Array.isArray(data) ? data : data.bets || [];
        const newNotifs: BetNotification[] = [];
        for (const bet of bets) {
          const settledAt = new Date(bet.settledAt || bet.updatedAt || 0).getTime();
          if (settledAt <= lastChecked) continue;
          if (bet.status === 'won' || bet.status === 'lost') {
            const exists = notifications.some(n => n.id === `bet-${bet.id}`);
            if (!exists) {
              newNotifs.push({
                id: `bet-${bet.id}`,
                type: bet.status as 'won' | 'lost',
                message: bet.status === 'won'
                  ? `${bet.homeTeam || 'Bet'} vs ${bet.awayTeam || ''} - You won!`
                  : `${bet.homeTeam || 'Bet'} vs ${bet.awayTeam || ''} - Better luck next time`,
                amount: bet.status === 'won' ? `+${(bet.potentialPayout || bet.potentialWin || 0).toFixed(2)} ${bet.currency || 'SBETS'}` : undefined,
                timestamp: settledAt,
                read: false,
              });
            }
          }
        }
        if (newNotifs.length > 0) {
          setNotifications(prev => {
            const updated = [...newNotifs, ...prev].slice(0, 50);
            localStorage.setItem('suibets-notifications', JSON.stringify(updated));
            return updated;
          });
          setLastChecked(Date.now());
          localStorage.setItem('suibets-notif-last', Date.now().toString());
        }
      } catch {}
    };
    checkBets();
    const interval = setInterval(checkBets, 30000);
    return () => clearInterval(interval);
  }, [walletAddress, lastChecked]);

  const markAllRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      localStorage.setItem('suibets-notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    localStorage.setItem('suibets-notifications', '[]');
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, markAllRead, clearNotifications };
}

export default function CleanHome() {
  const [, setLocation] = useLocation();
  const [selectedSport, setSelectedSport] = useState<number | null>(1);
  const [activeTab, setActiveTab] = useState<"live" | "upcoming">("live");
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isBetSlipOpen, setIsBetSlipOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => getFavorites());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showOddsOnly, setShowOddsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const matchesSectionRef = useRef<HTMLDivElement>(null);
  
  const { language, setLanguage, t } = useLanguage();
  
  // Betting context for bet slip
  const { selectedBets, removeBet, clearBets } = useBetting();
  
  // Toggle favorite team
  const toggleFavorite = (teamName: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(teamName)) {
        newFavorites.delete(teamName);
      } else {
        newFavorites.add(teamName);
      }
      saveFavorites(newFavorites);
      return newFavorites;
    });
  };

  const scrollToMatches = () => {
    matchesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleTabClick = (tab: "live" | "upcoming") => {
    setActiveTab(tab);
    setTimeout(() => scrollToMatches(), 100);
  };
  
  const currentAccount = useCurrentAccount();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const { isZkLoginActive, zkLoginAddress, logout: zkLogout } = useZkLogin();
  const walletAddress = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);
  const isConnected = !!walletAddress;
  
  const { notifications, unreadCount, markAllRead, clearNotifications } = useNotifications(walletAddress || undefined);
  
  // Fetch on-chain wallet SUI balance
  const { data: onChainBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '' },
    { enabled: !!walletAddress }
  );
  
  // Fetch on-chain SBETS token balance
  const SBETS_COIN_TYPE = import.meta.env.VITE_SBETS_TOKEN_TYPE || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
  const { data: onChainSbetsBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '', coinType: SBETS_COIN_TYPE },
    { enabled: !!walletAddress }
  );

  const USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
  const { data: onChainUsdsuiBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '', coinType: USDSUI_COIN_TYPE },
    { enabled: !!walletAddress }
  );
  
  // Convert from MIST to SUI (1 SUI = 1,000,000,000 MIST)
  const walletSuiBalance = onChainBalance?.totalBalance 
    ? Number(onChainBalance.totalBalance) / 1_000_000_000 
    : 0;
  
  // SBETS token balance (assuming 9 decimals like SUI)
  const walletSbetsBalance = onChainSbetsBalance?.totalBalance 
    ? Number(onChainSbetsBalance.totalBalance) / 1_000_000_000 
    : 0;

  const walletUsdsuiBalance = onChainUsdsuiBalance?.totalBalance 
    ? Number(onChainUsdsuiBalance.totalBalance) / 1_000_000 
    : 0;
  

  // Fetch promotion status
  const { data: platformStats } = useQuery<{ betsSettled: number; totalBets: number; sbetsVolume: number; suiVolume: number }>({
    queryKey: ['/api/platform/stats'],
    staleTime: 5 * 60 * 1000,
  });

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${Math.round(vol / 1_000)}K`;
    return vol.toString();
  };

  const { data: promotionData } = useQuery<{
    success: boolean;
    promotion: {
      isActive: boolean;
      totalBetUsd: number;
      bonusBalance: number;
      nextBonusAt: number;
      progressPercent: number;
      thresholdUsd: number;
      bonusUsd: number;
      promotionEnd: string;
    };
  }>({
    queryKey: [`/api/promotion/status?wallet=${walletAddress}`],
    enabled: !!walletAddress,
    refetchInterval: 60000,
  });

  const promotion = promotionData?.promotion;
  const disconnect = () => {
    if (isZkLoginActive) {
      zkLogout();
    }
    disconnectWallet();
  };

  const { data: liveEvents = [], isLoading: liveLoading, refetch: refetchLive } = useLiveEvents(selectedSport);
  const { data: upcomingEvents = [], isLoading: upcomingLoading, refetch: refetchUpcoming } = useUpcomingEvents(selectedSport);

  const { data: sportEventCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ['events', 'counts'],
    queryFn: async () => {
      const response = await fetch('/api/events/counts', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch counts');
      return await response.json();
    },
    staleTime: 30000,
    gcTime: 120000,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const rawEvents = activeTab === "live" ? liveEvents : upcomingEvents;
  const isLoading = activeTab === "live" ? liveLoading : upcomingLoading;
  
  // Filter events based on search query, favorites, and odds availability
  const events = useMemo(() => {
    let filtered = rawEvents;
    
    // Odds filter - only show matches with real bookmaker odds
    if (showOddsOnly) {
      filtered = filtered.filter((e: Event) => 
        e.homeOdds && e.awayOdds && e.homeOdds > 0 && e.awayOdds > 0
      );
    }
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((e: Event) => 
        e.homeTeam.toLowerCase().includes(query) ||
        e.awayTeam.toLowerCase().includes(query) ||
        (e.leagueName || '').toLowerCase().includes(query)
      );
    }
    
    // Favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter((e: Event) => 
        favorites.has(e.homeTeam) || favorites.has(e.awayTeam)
      );
    }
    
    return filtered;
  }, [rawEvents, searchQuery, showFavoritesOnly, showOddsOnly, favorites]);

  const LIVE_SPORT_IDS = new Set([1, 2, 4, 5, 6, 7, 10, 12, 15, 16]);

  const handleSportClick = (sportId: number) => {
    setSelectedSport(sportId);
    if (!LIVE_SPORT_IDS.has(sportId)) {
      setActiveTab("upcoming");
    }
  };

  const handleConnectWallet = () => {
    // Open the wallet connection modal
    setIsWalletModalOpen(true);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <div className="min-h-screen overflow-x-hidden" data-testid="clean-home">
      {/* Top Navigation Bar */}
      <nav className="bg-black/40 backdrop-blur-md border-b border-cyan-900/30 px-4 py-3 relative z-50">
        <div className="flex items-center justify-between">
          {/* Logo - Left Corner */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-gray-400 hover:text-cyan-400 transition-colors"
              data-testid="btn-mobile-menu"
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-nav-menu"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <Link href="/" data-testid="nav-logo">
              <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-8 w-auto" />
            </Link>
          </div>

          {/* Center Navigation - Desktop Only */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-cyan-400 hover:text-cyan-300 transition-colors text-sm font-medium" data-testid="nav-bets">{t('bets')}</Link>
            <Link href="/network" className="text-yellow-400 hover:text-yellow-300 transition-colors text-sm font-bold flex items-center gap-1" data-testid="nav-predict">{t('predict')}<span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" /></Link>
            <Link href="/ai-betting" className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 transition-colors text-sm font-bold" data-testid="nav-ai-betting">
              {t('aiBetting')}
              <span className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold px-1.5 py-0.5 rounded">AI</span>
            </Link>
            <Link href="/bet-history" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-my-bets">{t('myBets')}</Link>
            <Link href="/world-cup" className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 transition-colors text-sm font-bold" data-testid="nav-world-cup">
              <svg width="16" height="16" viewBox="0 0 64 64" fill="none" className="inline-block"><path d="M20 8h24v4c0 12-4 22-12 26-8-4-12-14-12-26V8z" fill="#FFD700" stroke="#B8860B" strokeWidth="2"/><path d="M20 10C16 10 10 14 10 22c0 6 4 10 8 12l2-2c-4-2-7-5-7-10 0-6 3-10 7-12z" fill="#FFD700"/><path d="M44 10c4 0 10 4 10 12 0 6-4 10-8 12l-2-2c4-2 7-5 7-10 0-6-3-10-7-12z" fill="#FFD700"/><rect x="29" y="36" width="6" height="10" rx="1" fill="#FFD700"/><path d="M22 48h20c1 0 2 1 2 2v4H20v-4c0-1 1-2 2-2z" fill="#06B6D4"/></svg>
              World Cup
              <span className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[9px] font-bold px-1 py-0.5 rounded animate-pulse">NEW</span>
            </Link>
            <Link href="/revenue" className="text-yellow-400 hover:text-yellow-300 transition-colors text-sm font-bold" data-testid="nav-revenue">{t('revenue')}</Link>
            <Link href="/chat" className="flex items-center gap-1.5 text-[#4da2ff] hover:text-[#6bb5ff] transition-colors text-sm font-bold" data-testid="nav-chat">
              <MessageCircle className="h-4 w-4" />
              Chat
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium flex items-center gap-1 outline-none" data-testid="nav-more">
                {t('more')}
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#0b1618] border border-cyan-900/30 min-w-[180px] z-[9999]">
                <DropdownMenuItem className="cursor-pointer text-orange-400 hover:text-orange-300 flex items-center px-4 py-3 text-sm font-bold" onClick={() => setLocation('/hot-potato')} data-testid="nav-more-hot-potato">
                  <Zap className="h-4 w-4 mr-2" />
                  Hot Potato Bets
                  <span className="bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[9px] font-bold px-1 py-0.5 rounded ml-1.5 animate-pulse">NEW</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-cyan-300 hover:text-cyan-200 flex items-center px-4 py-3 text-sm font-medium" onClick={() => setLocation('/trading')} data-testid="nav-more-trade">
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  {t('trade')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/wallet-dashboard')} data-testid="nav-more-dashboard">
                  <Wallet className="h-4 w-4 mr-2" />
                  {t('dashboard')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/promotions')} data-testid="nav-more-promotions">
                  <Target className="h-4 w-4 mr-2" />
                  {t('promotions')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/streaming')} data-testid="nav-more-streaming">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  {t('streaming')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/leaderboard')} data-testid="nav-more-leaderboard">
                  <Trophy className="h-4 w-4 mr-2" />
                  {t('leaderboard')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/results')} data-testid="nav-more-results">
                  <Activity className="h-4 w-4 mr-2" />
                  Results
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/parlay')} data-testid="nav-more-parlays">
                  <Target className="h-4 w-4 mr-2" />
                  {t('parlays')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/deposits-withdrawals')} data-testid="nav-more-withdraw">
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  {t('withdraw')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/whitepaper')} data-testid="nav-more-whitepaper">
                  <FileText className="h-4 w-4 mr-2" />
                  {t('whitepaper')}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-[#4da2ff] hover:text-[#6bb5ff] flex items-center px-4 py-3 text-sm font-medium" onClick={() => setLocation('/settlement')} data-testid="nav-more-settlement">
                  <Shield className="h-4 w-4 mr-2" />
                  Settlement Transparency
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right Side - Wallet */}
          <div className="flex items-center gap-1 sm:gap-2 md:gap-4">
            <a 
              href="https://app.cetus.zone/swap/0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS/0x2::sui::SUI"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm transition-colors whitespace-nowrap"
              data-testid="btn-buy-now"
            >
              {t('buyNow')}
            </a>
            
            {/* Language Switcher */}
            <div className="relative">
              <button
                onClick={() => { setIsLanguageOpen(!isLanguageOpen); setIsNotificationsOpen(false); }}
                className="p-2 text-gray-400 hover:text-cyan-400 transition-colors"
                data-testid="btn-language"
                aria-label={t('language')}
                aria-expanded={isLanguageOpen}
                aria-controls="language-panel"
              >
                <Globe size={18} />
              </button>
              {isLanguageOpen && (
                <div id="language-panel" role="listbox" aria-label={t('language')} className="absolute right-0 top-full mt-2 w-56 max-h-80 overflow-y-auto bg-[#0b1618] border border-cyan-900/30 rounded-xl shadow-2xl z-[9999]" data-testid="language-panel">
                  <div className="p-3 border-b border-cyan-900/20">
                    <span className="text-cyan-400 text-sm font-semibold">{t('language')}</span>
                  </div>
                  <div className="py-1">
                    {LANGUAGES.map(lang => (
                      <button
                        key={lang.code}
                        onClick={() => { setLanguage(lang.code); setIsLanguageOpen(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${
                          language === lang.code ? 'bg-cyan-500/10 text-cyan-400' : 'text-gray-300 hover:bg-white/5'
                        }`}
                        data-testid={`lang-${lang.code}`}
                      >
                        <span className="text-lg" aria-hidden="true">{lang.flag}</span>
                        <span>{lang.nativeName}</span>
                        {language === lang.code && <CheckCircle size={14} className="ml-auto text-cyan-400" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Notification Bell */}
            {isConnected && (
              <div className="relative">
                <button
                  onClick={() => { setIsNotificationsOpen(!isNotificationsOpen); setIsLanguageOpen(false); if (!isNotificationsOpen) markAllRead(); }}
                  className="p-2 text-gray-400 hover:text-cyan-400 transition-colors relative"
                  data-testid="btn-notifications"
                  aria-label={t('notifications')}
                  aria-expanded={isNotificationsOpen}
                  aria-controls="notifications-panel"
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center" data-testid="notification-badge">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
                {isNotificationsOpen && (
                  <div id="notifications-panel" role="log" aria-label={t('notifications')} className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-[#0b1618] border border-cyan-900/30 rounded-xl shadow-2xl z-[9999]" data-testid="notifications-panel">
                    <div className="p-3 border-b border-cyan-900/20 flex items-center justify-between">
                      <span className="text-cyan-400 text-sm font-semibold">{t('notifications')}</span>
                      {notifications.length > 0 && (
                        <button onClick={clearNotifications} className="text-gray-500 hover:text-red-400 text-xs" data-testid="btn-clear-notifications">
                          {t('clearAll')}
                        </button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-gray-500 text-sm">{t('noNotifications')}</div>
                    ) : (
                      <div className="divide-y divide-cyan-900/10">
                        {notifications.slice(0, 20).map(notif => (
                          <div key={notif.id} className={`p-3 flex items-start gap-3 ${!notif.read ? 'bg-cyan-500/5' : ''}`} data-testid={`notification-${notif.id}`}>
                            {notif.type === 'won' ? (
                              <CheckCircle size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <XCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm ${notif.type === 'won' ? 'text-green-400' : 'text-red-400'} font-medium`}>
                                {notif.type === 'won' ? t('betWon') : t('betLost')}
                              </p>
                              <p className="text-gray-400 text-xs truncate">{notif.message}</p>
                              {notif.amount && (
                                <p className="text-green-400 text-xs font-semibold mt-1">{notif.amount}</p>
                              )}
                              <p className="text-gray-600 text-[10px] mt-1">
                                {new Date(notif.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {isConnected && walletAddress ? (
              <>
                <div className="text-right">
                  <div className="text-cyan-400 text-xs flex items-center gap-1.5 justify-end" title="Wallet balance (on-chain)">
                    {walletSuiBalance.toFixed(4)} SUI | {walletSbetsBalance.toFixed(2)} SBETS{walletUsdsuiBalance > 0 ? ` | ${walletUsdsuiBalance.toFixed(2)} USDsui` : ''}
                    <PremiumBadge compact />
                  </div>
                  <div className="text-gray-500 text-xs"><SuiNSName address={walletAddress} className="text-gray-500 text-xs" /></div>
                </div>
                <button 
                  onClick={() => window.location.reload()} 
                  className="text-gray-400 hover:text-white p-2"
                  data-testid="btn-refresh"
                >
                  <RefreshCw size={18} />
                </button>
                <button 
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm"
                  data-testid="btn-disconnect"
                >
                  <LogOut size={16} />
                  {t('disconnect')}
                </button>
              </>
            ) : (
              <button 
                onClick={handleConnectWallet}
                className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm whitespace-nowrap"
                data-testid="btn-connect-wallet"
              >
                <Wallet size={14} className="flex-shrink-0" />
                <span className="hidden sm:inline">{t('connectWallet')}</span>
                <span className="sm:hidden">Connect</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <div id="mobile-nav-menu" role="navigation" aria-label="Mobile navigation" className="md:hidden absolute top-full left-0 right-0 bg-black/95 backdrop-blur-md border-b border-cyan-900/30 py-4 px-4 z-50" data-testid="mobile-menu">
            <div className="flex flex-col gap-3">
              <Link href="/" onClick={() => setIsMobileMenuOpen(false)} className="text-cyan-400 hover:text-cyan-300 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-bets">{t('bets')}</Link>
              <Link href="/network" onClick={() => setIsMobileMenuOpen(false)} className="text-yellow-400 hover:text-yellow-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-predict">{t('predict')}</Link>
              <Link href="/ai-betting" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-ai-betting-main">
                {t('aiBetting')} <span className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold px-1.5 py-0.5 rounded">AI</span>
              </Link>
              <Link href="/bet-history" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-my-bets">{t('myBets')}</Link>
              <Link href="/revenue" onClick={() => setIsMobileMenuOpen(false)} className="text-yellow-400 hover:text-yellow-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-revenue">{t('revenue')}</Link>
              <Link href="/wallet-dashboard" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-dashboard">{t('dashboard')}</Link>
              <Link href="/promotions" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-promotions">{t('promotions')}</Link>
              <Link href="/trading" onClick={() => setIsMobileMenuOpen(false)} className="text-cyan-400 hover:text-cyan-300 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-trade">{t('trade')}</Link>
              <Link href="/world-cup" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-world-cup">
                <svg width="18" height="18" viewBox="0 0 64 64" fill="none"><path d="M20 8h24v4c0 12-4 22-12 26-8-4-12-14-12-26V8z" fill="#FFD700" stroke="#B8860B" strokeWidth="2"/><path d="M20 10C16 10 10 14 10 22c0 6 4 10 8 12l2-2c-4-2-7-5-7-10 0-6 3-10 7-12z" fill="#FFD700"/><path d="M44 10c4 0 10 4 10 12 0 6-4 10-8 12l-2-2c4-2 7-5 7-10 0-6-3-10-7-12z" fill="#FFD700"/><rect x="29" y="36" width="6" height="10" rx="1" fill="#FFD700"/><path d="M22 48h20c1 0 2 1 2 2v4H20v-4c0-1 1-2 2-2z" fill="#06B6D4"/></svg>
                World Cup 2026 <span className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold px-1.5 py-0.5 rounded animate-pulse">NEW</span>
              </Link>
              <Link href="/hot-potato" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-2 text-orange-400 hover:text-orange-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-hot-potato">
                Hot Potato Bets <span className="bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[10px] font-bold px-1.5 py-0.5 rounded animate-pulse">NEW</span>
              </Link>
              <Link href="/streaming" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-streaming">{t('streaming')}</Link>
              <Link href="/leaderboard" onClick={() => setIsMobileMenuOpen(false)} className="text-yellow-400 hover:text-yellow-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-leaderboard">{t('leaderboard')}</Link>
              <Link href="/results" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-results">Results</Link>
              <Link href="/parlay" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-parlays">{t('parlays')}</Link>
              <Link href="/deposits-withdrawals" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-withdraw">{t('withdraw')}</Link>
              <Link href="/whitepaper" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2" data-testid="mobile-nav-whitepaper">{t('whitepaper')}</Link>
              <Link href="/settlement" onClick={() => setIsMobileMenuOpen(false)} className="text-[#4da2ff] hover:text-[#6bb5ff] transition-colors text-base font-medium py-2 flex items-center gap-2" data-testid="mobile-nav-settlement">
                <Shield className="h-4 w-4" />
                Settlement Transparency
              </Link>
              <Link href="/chat" onClick={() => setIsMobileMenuOpen(false)} className="text-[#4da2ff] hover:text-[#6bb5ff] transition-colors text-base font-medium py-2 flex items-center gap-2" data-testid="mobile-nav-chat">
                <MessageCircle className="h-4 w-4" />
                Chat
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Promotion Banner */}
      {promotion?.isActive && (
        <div className="bg-gradient-to-r from-yellow-600 via-orange-500 to-yellow-600 text-black py-2 px-4" data-testid="promo-banner">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-2 text-sm md:text-base font-bold">
            <span>🎁 LIMITED PROMO:</span>
            <span>Bet ${promotion.thresholdUsd} → Get ${promotion.bonusUsd} FREE!</span>
            <span className="text-xs md:text-sm opacity-80">
              Progress: ${(promotion.totalBetUsd % promotion.thresholdUsd).toFixed(2)}/${promotion.thresholdUsd}
            </span>
            <div className="w-20 h-2 bg-black/30 rounded-full overflow-hidden">
              <div 
                className="h-full bg-white transition-all" 
                style={{ width: `${promotion.progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Hero Banner */}
      <div className="relative w-full h-[250px] md:h-[350px] overflow-hidden" data-testid="hero-banner">
        <img
          src={suibetsHeroImage}
          alt="SuiBets - Sports Betting on Sui Blockchain"
          draggable={false}
          className="w-full h-full object-cover object-[center_20%]"
          style={{ display: 'block' }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e1a] via-[#0a0e1a]/40 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center pb-5 md:pb-8 px-4">
          <h1 className="text-white text-xl md:text-3xl font-extrabold text-center mb-1 drop-shadow-lg" data-testid="hero-title">
            {t('heroTitle')} <span className="text-[#00FFFF]">{t('heroSui')}</span>
          </h1>
          <p className="text-gray-300 text-xs md:text-sm text-center max-w-xl drop-shadow" data-testid="hero-subtitle">
            {t('heroSubtitle')}
          </p>
        </div>
      </div>

      {/* Stats Bar */}
      <FadeInSection>
        <div className="w-full glass-card-strong border-y border-cyan-900/20">
          <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="flex items-center gap-3 justify-center" data-testid="stat-markets">
              <div className="w-11 h-11 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                <BarChart3 size={22} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-cyan-300 font-black text-3xl leading-tight stat-glow"><AnimatedCounter end={2100} suffix="+" /></div>
                <div className="text-gray-400 text-[11px] font-medium tracking-widest uppercase">{t('liveMarkets')}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 justify-center" data-testid="stat-sports">
              <div className="w-11 h-11 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                <Trophy size={22} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-cyan-300 font-black text-3xl leading-tight stat-glow"><AnimatedCounter end={20} /></div>
                <div className="text-gray-400 text-[11px] font-medium tracking-widest uppercase">{t('sports')}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 justify-center" data-testid="stat-settlement">
              <div className="w-11 h-11 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                <Zap size={22} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-cyan-300 font-black text-3xl leading-tight stat-glow">&lt;1s</div>
                <div className="text-gray-400 text-[11px] font-medium tracking-widest uppercase">{t('settlement')}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 justify-center" data-testid="stat-onchain">
              <div className="w-11 h-11 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                <Shield size={22} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-cyan-300 font-black text-3xl leading-tight stat-glow">100%</div>
                <div className="text-gray-400 text-[11px] font-medium tracking-widest uppercase">{t('onChain')}</div>
              </div>
            </div>
          </div>
        </div>
      </FadeInSection>

      {/* Platform Trust Stats */}
      <FadeInSection delay={50}>
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-3 md:gap-5 flex-wrap text-xs">
            <a
              href="https://suiscan.xyz/mainnet/object/0x2e354642a3c00571832c03c42575587a0ca38cfe02e4f84cb3404cc9eab403d3/contracts"
              target="_blank"
              rel="noopener noreferrer"
              className="trust-badge rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-all hover:bg-green-500/10 cursor-pointer"
              data-testid="link-verified-suiscan"
            >
              <Shield size={12} className="text-green-400" />
              <span className="text-green-300 font-medium">{t('verifiedOnSui')}</span>
            </a>
            <a
              href="https://suivision.xyz/package/0x2e354642a3c00571832c03c42575587a0ca38cfe02e4f84cb3404cc9eab403d3"
              target="_blank"
              rel="noopener noreferrer"
              className="trust-badge rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-all hover:bg-blue-500/10 cursor-pointer"
              data-testid="link-verified-suivision"
            >
              <Shield size={12} className="text-blue-400" />
              <span className="text-blue-300 font-medium">SuiVision</span>
            </a>
            <a
              href="https://walruscan.com/mainnet/directory/projects/SuiBets"
              target="_blank"
              rel="noopener noreferrer"
              className="trust-badge rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-all hover:bg-cyan-500/10 cursor-pointer"
              data-testid="link-verified-walrus"
            >
              <Shield size={12} className="text-cyan-400" />
              <span className="text-cyan-300 font-medium">Walrus</span>
            </a>
            <a
              href="https://www.moveregistry.com/package/@suibets/betting?tab=readme"
              target="_blank"
              rel="noopener noreferrer"
              className="trust-badge rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-all hover:bg-purple-500/10 cursor-pointer"
              data-testid="link-verified-mve"
            >
              <Shield size={12} className="text-purple-400" />
              <span className="text-purple-300 font-medium">MVE Registry</span>
            </a>
            <a
              href="/audit-report.html"
              target="_blank"
              rel="noopener noreferrer"
              className="trust-badge rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-all hover:bg-yellow-500/10 cursor-pointer"
              data-testid="link-audit-report"
            >
              <FileText size={12} className="text-yellow-400" />
              <span className="text-yellow-300 font-medium">Audit Report</span>
            </a>
            <a
              href="/formal-verification.html"
              target="_blank"
              rel="noopener noreferrer"
              className="trust-badge rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-all hover:bg-emerald-500/10 cursor-pointer"
              data-testid="link-formal-verification"
            >
              <CheckCircle size={12} className="text-emerald-400" />
              <span className="text-emerald-300 font-medium">Proven Audit</span>
            </a>
            <div className="flex items-center gap-1.5 text-gray-400" data-testid="text-bets-settled">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
              <span>{platformStats ? `${Math.max(platformStats.betsSettled, 183).toLocaleString()}+` : '...'} {t('betsSettled')}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-400" data-testid="text-sbets-volume">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
              <span>{platformStats ? `${formatVolume(Math.max(platformStats.sbetsVolume, 152000))}+` : '...'} {t('sbetsVolume')}</span>
            </div>
          </div>
        </div>
      </FadeInSection>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Search Bar with Favorites Toggle */}
        <div className="mb-4 flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              placeholder={t('searchTeams')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0a0f19]/60 backdrop-blur-md border border-cyan-900/25 rounded-lg py-3 pl-12 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              data-testid="input-search"
            />
          </div>
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all ${
              showFavoritesOnly 
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500' 
                : 'bg-[#111111] text-gray-400 border border-cyan-900/30 hover:text-yellow-400'
            }`}
            data-testid="btn-favorites-filter"
          >
            <Star size={16} fill={showFavoritesOnly ? "currentColor" : "none"} />
            <span className="hidden md:inline">{t('favorites')}</span>
            {favorites.size > 0 && (
              <span className="bg-yellow-500/30 text-yellow-400 text-xs px-1.5 py-0.5 rounded-full">
                {favorites.size}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowOddsOnly(!showOddsOnly)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all ${
              showOddsOnly 
                ? 'bg-green-500/20 text-green-400 border border-green-500' 
                : 'bg-[#111111] text-gray-400 border border-cyan-900/30 hover:text-green-400'
            }`}
            data-testid="btn-odds-filter"
          >
            <TrendingUp size={16} />
            <span className="hidden md:inline">{t('withOdds')}</span>
          </button>
        </div>

        {/* Sports - Horizontal scrollable row with arrow buttons */}
        <div className="mb-4 relative">
          <button
            onClick={() => {
              const el = document.getElementById('sport-tabs-row');
              if (el) el.scrollBy({ left: -200, behavior: 'smooth' });
            }}
            className="absolute left-0 top-0 bottom-0 z-10 w-8 flex items-center justify-center bg-gradient-to-r from-[#0a0e1a] to-transparent hover:from-[#0a0e1a]/90"
            data-testid="btn-scroll-sports-left"
          >
            <ChevronLeft size={18} className="text-gray-400" />
          </button>
          <div
            id="sport-tabs-row"
            className="flex gap-2 overflow-x-auto px-9 pb-1 sport-tabs-scroll scroll-fade-container"
          >
            {SPORTS_LIST.map((sport) => {
              const count = sportEventCounts[sport.id] || 0;
              return (
                <button
                  key={sport.id}
                  onClick={() => handleSportClick(sport.id)}
                  className={`py-2 px-3 md:py-2.5 md:px-4 rounded-lg whitespace-nowrap text-sm transition-all flex-shrink-0 ${
                    selectedSport === sport.id
                      ? "bg-cyan-500 text-black font-bold shadow-lg shadow-cyan-500/25"
                      : count > 0
                        ? "bg-[#0a0f19]/60 border border-cyan-900/25 text-gray-300 hover:text-white hover:border-cyan-700/50"
                        : "bg-[#0a0a0a]/60 text-gray-500 hover:text-gray-300 border border-gray-800/20"
                  }`}
                  data-testid={`sport-btn-${sport.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <span className="mr-1.5">{sport.icon}</span>
                  {sport.name}
                  {count > 0 && (
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                      selectedSport === sport.id ? "bg-black/20 text-black" : "bg-cyan-900/40 text-cyan-400"
                    }`} data-testid={`sport-count-${sport.id}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              const el = document.getElementById('sport-tabs-row');
              if (el) el.scrollBy({ left: 200, behavior: 'smooth' });
            }}
            className="absolute right-0 top-0 bottom-0 z-10 w-8 flex items-center justify-center bg-gradient-to-l from-[#0a0e1a] to-transparent hover:from-[#0a0e1a]/90"
            data-testid="btn-scroll-sports-right"
          >
            <ChevronRight size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Live / Upcoming Tabs */}
        <div ref={matchesSectionRef} className="flex gap-2 mb-4 scroll-mt-4">
          {selectedSport !== null && LIVE_SPORT_IDS.has(selectedSport) && (
            <button
              onClick={() => handleTabClick("live")}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
                activeTab === "live"
                  ? "bg-[#111111] text-cyan-400 border border-cyan-500"
                  : "bg-transparent text-gray-400 hover:text-white"
              }`}
              data-testid="tab-live"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              {t('live')} ({liveEvents.length})
            </button>
          )}
          <button
            onClick={() => handleTabClick("upcoming")}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === "upcoming"
                ? "bg-[#111111] text-cyan-400 border border-cyan-500"
                : "bg-transparent text-gray-400 hover:text-white"
            }`}
            data-testid="tab-upcoming"
          >
            <TrendingUp size={16} />
            {t('upcoming')} ({upcomingEvents.length})
          </button>
        </div>

        {selectedSport !== 17 && selectedSport !== 11 && selectedSport !== 19 && events.length > 0 && (() => {
          const NO_DRAW_IDS = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
          const sportHasDraws = selectedSport !== null && !NO_DRAW_IDS.has(selectedSport);
          return (
            <div className="bg-[#0d1117] rounded-xl border border-cyan-900/20 px-4 py-3 mb-4" data-testid="betting-explainer">
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">💡</span>
                <div className="text-xs text-gray-400 leading-relaxed">
                  <span className="text-white font-semibold">How to read odds: </span>
                  <span className="text-cyan-400 font-semibold">H</span> = Home Win
                  {sportHasDraws && (<>
                    <span className="text-gray-600 mx-1.5">|</span>
                    <span className="text-yellow-400 font-semibold">X</span> = Draw
                  </>)}
                  <span className="text-gray-600 mx-1.5">|</span>
                  <span className="text-white font-semibold">A</span> = Away Win
                  <span className="text-gray-600 mx-1.5">|</span>
                  <span className="text-gray-500">The number is the multiplier — bet 10 SBETS at 3.00 odds = 30 SBETS payout if you win.</span>
                </div>
              </div>
            </div>
          );
        })()}

        {selectedSport === 17 && events.length > 0 && (
          <div className="bg-[#0d1117] rounded-xl border border-cyan-900/20 px-4 py-3 mb-4" data-testid="horse-racing-explainer">
            <div className="flex items-start gap-3">
              <span className="text-lg mt-0.5">🏇</span>
              <div className="text-xs text-gray-400 leading-relaxed">
                <span className="text-white font-semibold">How to bet: </span>
                <span className="text-cyan-400 font-semibold">Win</span> = horse finishes 1st
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-emerald-400 font-semibold">Place</span> = horse finishes top 2
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-amber-400 font-semibold">Show</span> = horse finishes top 3
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-gray-500">Easier bets pay less, riskier bets pay more.</span>
              </div>
            </div>
          </div>
        )}

        {(selectedSport === 11 || selectedSport === 19) && events.length > 0 && (
          <div className="bg-[#0d1117] rounded-xl border border-cyan-900/20 px-4 py-3 mb-4" data-testid="motorsport-explainer">
            <div className="flex items-start gap-3">
              <span className="text-lg mt-0.5">{selectedSport === 11 ? '🏎️' : '🏍️'}</span>
              <div className="text-xs text-gray-400 leading-relaxed">
                <span className="text-white font-semibold">How to bet: </span>
                <span className="text-cyan-400 font-semibold">Win</span> = finishes 1st
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-emerald-400 font-semibold">Top 2</span> = finishes 1st or 2nd
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-amber-400 font-semibold">Podium</span> = finishes top 3
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-gray-500">Safer bets pay less, riskier bets pay more.</span>
              </div>
            </div>
          </div>
        )}

        {/* Events List - Grouped by League */}
        <div className="space-y-4 pb-24">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-400">{t('loading')}</p>
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 bg-[#111111] rounded-xl border border-cyan-900/30">
              <p className="text-gray-400 mb-2">{t('noEventsTab').replace('{tab}', activeTab)}</p>
              <p className="text-gray-500 text-sm">
                {showFavoritesOnly ? t('starTeams') : 
                  selectedSport === 11 ? t('formulaNote') :
                  selectedSport === 8 ? t('checkBackLater') :
                  selectedSport === 9 ? t('checkBackLater') :
                  selectedSport === 3 ? t('checkBackLater') :
                  selectedSport === 7 ? t('mmaNote') :
                  selectedSport === 17 ? t('checkBackLater') :
                  t('checkBackLater')}
              </p>
            </div>
          ) : (
            <LeagueGroupedEvents 
              events={events} 
              favorites={favorites} 
              toggleFavorite={toggleFavorite} 
            />
          )}
        </div>
      </div>
      
      {/* Floating Bet Slip Drawer */}
      <FloatingBetSlip 
        isOpen={isBetSlipOpen}
        onToggle={() => setIsBetSlipOpen(!isBetSlipOpen)}
        bets={selectedBets}
        onRemoveBet={removeBet}
        onClearAll={clearBets}
      />
      
      {/* Wallet Connection Modal */}
      <ConnectWalletModal 
        isOpen={isWalletModalOpen} 
        onClose={() => setIsWalletModalOpen(false)} 
      />
      
      {/* Live Bet Feed */}
      <LiveBetFeed />

      {/* Footer */}
      <Footer />
    </div>
  );
}

// League priority for sorting (major leagues first)
const LEAGUE_PRIORITY: Record<string, number> = {
  'Premier League': 1,
  'La Liga': 2,
  'Serie A': 3,
  'Bundesliga': 4,
  'Ligue 1': 5,
  'Champions League': 6,
  'UEFA Champions League': 6,
  'Europa League': 7,
  'UEFA Europa League': 7,
  'FA Cup': 8,
  'Copa del Rey': 9,
  'DFB Pokal': 10,
  'Eredivisie': 11,
  'Liga Portugal': 12,
  'MLS': 13,
};

// Floating Bet Slip Drawer Component
interface FloatingBetSlipProps {
  isOpen: boolean;
  onToggle: () => void;
  bets: any[];
  onRemoveBet: (id: string) => void;
  onClearAll: () => void;
}

function FloatingBetSlip({ isOpen, onToggle, bets, onRemoveBet, onClearAll }: FloatingBetSlipProps) {
  const [stake, setStake] = useState<string>('');
  const [, setLocation] = useLocation();
  
  // Calculate combined parlay odds (multiply all individual odds)
  const combinedOdds = useMemo(() => {
    if (bets.length === 0) return 0;
    if (bets.length === 1) return bets[0].odds || 1;
    return bets.reduce((acc, bet) => acc * (bet.odds || 1), 1);
  }, [bets]);
  
  // Calculate potential winnings based on stake
  const stakeNum = parseFloat(stake) || 0;
  const potentialWin = stakeNum * combinedOdds;
  
  // Handle place bet - navigates to parlay page with stake pre-filled
  const handlePlaceBet = () => {
    if (bets.length === 0) return;
    // Store stake in session storage for parlay page to pick up
    if (stake) {
      sessionStorage.setItem('parlayStake', stake);
    }
    setLocation('/parlay');
  };
  
  const isParlay = bets.length > 1;
  
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      <button
        onClick={onToggle}
        className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 text-black font-bold px-3 md:px-4 py-2.5 md:py-3 flex items-center justify-between"
        data-testid="btn-betslip-toggle"
      >
        <div className="flex items-center gap-2 md:gap-3">
          <span className="bg-black/20 px-2 py-0.5 rounded-full text-xs md:text-sm">
            {bets.length}
          </span>
          <span className="text-sm md:text-base">{isParlay ? 'Parlay' : 'Bet Slip'}</span>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          {bets.length > 0 && (
            <span className="text-xs md:text-sm font-medium">
              {combinedOdds.toFixed(2)}x
            </span>
          )}
          {isOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </div>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="glass-card-strong border-t border-cyan-900/30 overflow-hidden"
          >
            <div className="max-h-40 md:max-h-48 overflow-y-auto p-3 md:p-4">
              {bets.length === 0 ? (
                <p className="text-gray-500 text-center py-3 text-sm">
                  Tap on odds to add selections
                </p>
              ) : (
                <div className="space-y-1.5 md:space-y-2">
                  {bets.map((bet, index) => (
                    <div 
                      key={bet.id || index}
                      className="bg-[#111111] rounded-lg p-2.5 md:p-3 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs md:text-sm truncate">{bet.eventName}</p>
                        <p className="text-cyan-400 text-[11px] md:text-xs">{bet.selectionName} @ {bet.odds?.toFixed(2)}</p>
                      </div>
                      <button
                        onClick={() => onRemoveBet(bet.id)}
                        className="text-red-400 hover:text-red-300 p-1 flex-shrink-0"
                        data-testid={`btn-remove-bet-${index}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {bets.length > 0 && (
              <div className="p-3 md:p-4 border-t border-cyan-900/30 space-y-2.5 md:space-y-3">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="flex-1">
                    <label className="text-gray-400 text-[10px] md:text-xs mb-0.5 md:mb-1 block">Stake (SUI)</label>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Amount..."
                      className="w-full bg-[#111111] border border-cyan-900/30 rounded-lg px-2.5 md:px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      data-testid="input-stake"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-gray-400 text-[10px] md:text-xs mb-0.5 md:mb-1 block">Potential Win</label>
                    <div className="bg-[#111111] border border-cyan-900/30 rounded-lg px-2.5 md:px-3 py-2 text-green-400 text-sm font-bold truncate">
                      {potentialWin > 0 ? `${potentialWin.toFixed(2)} SUI` : '-'}
                    </div>
                  </div>
                </div>
                
                {isParlay && (
                  <div className="flex items-center justify-between text-xs md:text-sm bg-[#111111] rounded-lg p-2">
                    <span className="text-gray-400">Combined ({bets.length} legs)</span>
                    <span className="text-cyan-400 font-bold">{combinedOdds.toFixed(2)}x</span>
                  </div>
                )}
                
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={onClearAll}
                    className="text-red-400 hover:text-red-300 text-xs md:text-sm py-2 px-3"
                    data-testid="btn-clear-bets"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handlePlaceBet}
                    disabled={bets.length === 0}
                    className="bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-bold px-4 md:px-6 py-2 rounded-lg text-sm flex-1 max-w-[200px]"
                    data-testid="btn-place-bet"
                  >
                    {isParlay ? `Place Parlay` : 'Place Bet'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RaceEventCard({ event }: { event: Event }) {
  const { addBet } = useBetting();
  const { toast } = useToast();
  const allMarkets = (event as any).markets || [];
  const winMarket = allMarkets.find((m: any) => m.id === 'race_winner') || allMarkets[0];
  const placeMarket = allMarkets.find((m: any) => m.id === 'race_place');
  const showMarket = allMarkets.find((m: any) => m.id === 'race_show');
  const runners = winMarket?.outcomes || [];
  const runnersInfo = (event as any).runnersInfo || [];
  const raceDetails = (event as any).raceDetails;
  const isHorseRacing = event.sportId === 17;
  const isMotorsport = event.sportId === 11 || event.sportId === 19;
  const hasWPS = (isHorseRacing || isMotorsport) && placeMarket && showMarket;

  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return timeStr;
      if (isTomorrow) return `Tomorrow\n${timeStr}`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + '\n' + timeStr;
    } catch { return ''; }
  };

  const handleRunnerBet = (runner: any, idx: number, marketType: string, marketId: string, odds: number) => {
    addBet({
      id: `${event.id}-${marketId}-${runner.id || idx}`,
      eventId: String(event.id),
      eventName: `${event.homeTeam}`,
      marketId,
      market: marketType,
      outcomeId: runner.id || `runner_${idx}`,
      selectionId: runner.id || `runner_${idx}`,
      selectionName: runner.name || `Runner ${idx + 1}`,
      odds,
      homeTeam: event.homeTeam,
      awayTeam: runner.name,
      isLive: false,
    });
    toast({ title: "Added to bet slip", description: `${runner.name} ${marketType} @ ${odds.toFixed(2)}` });
  };

  return (
    <div className="px-4 py-3" data-testid={`horse-race-${event.id}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-16 md:w-20 flex-shrink-0 text-gray-500 text-xs whitespace-pre-line">
          {formatTime(event.startTime)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-semibold truncate">{event.homeTeam}</div>
          <div className="text-gray-500 text-xs">{event.awayTeam}</div>
          {raceDetails && (
            <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-600 flex-wrap">
              {raceDetails.surface && <span>{raceDetails.surface}</span>}
              {raceDetails.distance && <><span>•</span><span>{raceDetails.distance}</span></>}
              {raceDetails.going && <><span>•</span><span>{raceDetails.going}</span></>}
              {raceDetails.prize && <><span>•</span><span>{raceDetails.prize}</span></>}
              <span>•</span>
              <span>{raceDetails.fieldSize || runners.length} {(event.sportId === 11 || event.sportId === 19) ? 'riders' : 'runners'}</span>
            </div>
          )}
        </div>
      </div>

      {hasWPS && (
        <div className="flex items-center justify-end gap-1 mb-1 ml-0 md:ml-[80px] pr-3">
          <div className="flex-1" />
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">Win</span>
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">{isMotorsport ? 'Top 2' : 'Place'}</span>
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">{isMotorsport ? 'Podium' : 'Show'}</span>
        </div>
      )}

      <div className="space-y-1 ml-0 md:ml-[80px]">
        {runners.map((runner: any, idx: number) => {
          const info = runnersInfo[idx];
          const placeOdds = placeMarket?.outcomes?.[idx]?.odds;
          const showOdds = showMarket?.outcomes?.[idx]?.odds;
          return (
            <div
              key={runner.id || idx}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111111] border border-cyan-900/10 hover:border-cyan-500/30 hover:bg-[#151515] transition-all group/runner"
              data-testid={`runner-row-${event.id}-${idx}`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-cyan-400 font-bold text-xs w-5 text-center">{info?.number || idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-white text-sm font-medium">{runner.name}</span>
                  {info && (
                    <span className="text-gray-500 text-[10px] ml-2">
                      {(event.sportId === 11 || event.sportId === 19) ? (info.jockey || '') : `J: ${info.jockey || 'TBA'}${info.trainer ? ` / ${info.trainer}` : ''}`}
                    </span>
                  )}
                </div>
                {info?.form && event.sportId !== 11 && event.sportId !== 19 && (
                  <span className="text-yellow-400/60 text-[10px] font-mono bg-yellow-400/5 px-1.5 py-0.5 rounded hidden md:inline">
                    {info.form}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => handleRunnerBet(runner, idx, 'Win', 'race_winner', runner.odds)}
                  className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-cyan-400 hover:bg-cyan-500 hover:text-black transition-all min-w-[48px] text-center"
                  data-testid={`odds-win-${event.id}-${idx}`}
                >
                  {runner.odds?.toFixed(2) || 'N/A'}
                </button>
                {hasWPS && (
                  <>
                    <button
                      onClick={() => placeOdds && handleRunnerBet(runner, idx, isMotorsport ? 'Top 2' : 'Place', 'race_place', placeOdds)}
                      className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all min-w-[48px] text-center"
                      data-testid={`odds-place-${event.id}-${idx}`}
                      disabled={!placeOdds}
                    >
                      {placeOdds?.toFixed(2) || 'N/A'}
                    </button>
                    <button
                      onClick={() => showOdds && handleRunnerBet(runner, idx, isMotorsport ? 'Podium' : 'Show', 'race_show', showOdds)}
                      className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-amber-400 hover:bg-amber-500 hover:text-black transition-all min-w-[48px] text-center"
                      data-testid={`odds-show-${event.id}-${idx}`}
                      disabled={!showOdds}
                    >
                      {showOdds?.toFixed(2) || 'N/A'}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LeagueGroupProps {
  leagueName: string;
  events: Event[];
  defaultExpanded?: boolean;
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
}

function LeagueGroup({ leagueName, events, defaultExpanded = false, favorites, toggleFavorite }: LeagueGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const leagueId = leagueName.replace(/\s+/g, '-').toLowerCase();
  const NO_DRAW_SPORTS_SET = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
  const RACE_SPORTS_SET = new Set([17, 11, 19]);
  const isRaceLeague = events.length > 0 && RACE_SPORTS_SET.has(events[0].sportId);
  const hasDraws = events.length > 0 && !NO_DRAW_SPORTS_SET.has(events[0].sportId);
  
  return (
    <div className="glass-card rounded-xl overflow-hidden transition-all duration-300">
      {/* League Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); }}}
        className="w-full px-4 py-3 flex items-center justify-between bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
        data-testid={`league-header-${leagueId}`}
        aria-expanded={isExpanded}
        aria-controls={`league-events-${leagueId}`}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-semibold">{leagueName}</span>
          <span className="bg-cyan-500/20 text-cyan-400 text-xs px-2 py-0.5 rounded-full">
            {events.length} {events.length === 1 ? 'match' : 'matches'}
          </span>
        </div>
        <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true">
          ▼
        </span>
      </button>
      
      {/* Events List */}
      {isExpanded && (
        <div id={`league-events-${leagueId}`} className="divide-y divide-cyan-900/20" role="list">
          {!isRaceLeague && (
            <div className="px-4 py-1.5 flex items-center gap-2 md:gap-4 bg-white/[0.02] border-b border-cyan-900/30" data-testid={`column-headers-${leagueId}`}>
              <div className="w-12 md:w-20 flex-shrink-0 text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Time</div>
              <div className="flex-1 min-w-0 flex items-center gap-2 md:gap-4">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Teams</span>
                <span className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold ml-auto hidden md:block">Score</span>
              </div>
              <div className="hidden md:flex items-center gap-1">
                <span className="text-[10px] text-cyan-600 uppercase tracking-wider font-semibold w-[52px] text-center" title="Home Win">H</span>
                {hasDraws && <span className="text-[10px] text-yellow-600 uppercase tracking-wider font-semibold w-[52px] text-center" title="Draw">X</span>}
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold w-[52px] text-center" title="Away Win">A</span>
              </div>
              <div className="md:hidden flex items-center gap-2 ml-auto">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Odds:</span>
                <span className="text-[10px] text-cyan-600 font-semibold">H</span>
                {hasDraws && (<><span className="text-[10px] text-gray-600">·</span><span className="text-[10px] text-yellow-600 font-semibold">X</span></>)}
                <span className="text-[10px] text-gray-600">·</span>
                <span className="text-[10px] text-gray-400 font-semibold">A</span>
              </div>
              <div className="w-6 flex-shrink-0 hidden md:block"></div>
            </div>
          )}
          {events.map((event, index) => (
            (event.sportId === 17 || event.sportId === 11 || event.sportId === 19) ? (
              <RaceEventCard
                key={`${event.sportId}-${event.id}-${index}`}
                event={event}
              />
            ) : (
              <CompactEventCard 
                key={`${event.sportId}-${event.id}-${index}`} 
                event={event}
                favorites={favorites}
                toggleFavorite={toggleFavorite}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

interface LeagueGroupedEventsProps {
  events: Event[];
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
}

function LeagueGroupedEvents({ events, favorites, toggleFavorite }: LeagueGroupedEventsProps) {
  // Group events by league
  const groupedByLeague = events.reduce((acc, event) => {
    const league = event.leagueName || event.league || 'Other';
    if (!acc[league]) {
      acc[league] = [];
    }
    acc[league].push(event);
    return acc;
  }, {} as Record<string, Event[]>);
  
  // Sort leagues by priority (major leagues first)
  const sortedLeagues = Object.keys(groupedByLeague).sort((a, b) => {
    const priorityA = LEAGUE_PRIORITY[a] || 100;
    const priorityB = LEAGUE_PRIORITY[b] || 100;
    if (priorityA !== priorityB) return priorityA - priorityB;
    // If same priority, sort by number of matches (more matches first)
    return groupedByLeague[b].length - groupedByLeague[a].length;
  });
  
  return (
    <div className="space-y-3">
      {sortedLeagues.map((league, index) => (
        <LeagueGroup
          key={league}
          leagueName={league}
          events={groupedByLeague[league]}
          defaultExpanded={index < 3}
          favorites={favorites}
          toggleFavorite={toggleFavorite}
        />
      ))}
    </div>
  );
}

// Odds Movement Indicator Component
function OddsMovement({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'stable') return null;
  return direction === 'up' ? (
    <TrendingUp size={10} className="text-green-400" />
  ) : (
    <TrendingDown size={10} className="text-red-400" />
  );
}

// Props interface for CompactEventCard
interface CompactEventCardProps {
  event: Event;
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
}

// Compact event card for league-grouped view
function CompactEventCard({ event, favorites, toggleFavorite }: CompactEventCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);

  const [showMoreMarkets, setShowMoreMarkets] = useState(false);

  const { addBet } = useBetting();
  const { toast } = useToast();
  
  // Calculate these values FIRST so they are available for helpers and memo
  const minuteNum = useMemo(() => {
    if (!event || !event.minute) return 0;
    try {
      const minStr = String(event.minute).replace(/[^0-9]/g, '');
      return minStr ? parseInt(minStr, 10) : 0;
    } catch (e) {
      console.error("Error parsing minute:", e);
      return 0;
    }
  }, [event?.minute]);

  const isBettingClosed = useMemo(() => {
    return !!(event?.isLive && minuteNum >= 85);
  }, [event?.isLive, minuteNum]);

  // Helper to check if a market is closed based on match minute
  const isMarketClosed = useCallback((marketId: any) => {
    if (!event?.isLive || !marketId) return false;
    try {
      const marketStr = String(marketId).toLowerCase();
      const isFirstHalf = marketStr.includes('1st_half') || 
                         marketStr.includes('1st-half') ||
                         marketStr.includes('first_half') ||
                         marketStr.includes('first-half') ||
                         marketStr.includes('half_time_result') ||
                         marketStr.includes('half-time-result') ||
                         marketStr === '4';
      
      if (isFirstHalf && minuteNum >= 45) return true;
      
      const isMatchWinner = marketStr.includes('match_winner') || marketStr.includes('match-winner') ||
                            marketStr.includes('match_result') || marketStr.includes('match-result') ||
                            marketStr === 'match winner' || marketStr === 'match result';
      if (!isMatchWinner) return true;
      
      if (minuteNum >= 85) return true;
    } catch (e) {
      console.error("Error in isMarketClosed:", e);
    }
    return false;
  }, [event?.isLive, minuteNum]);

  // Get secondary markets for this event (BTTS, Double Chance, etc.) - NOT available for live matches
  const secondaryMarkets = useMemo(() => {
    if (!event) return [];
    if (event.isLive) return [];
    try {
      const apiMarkets = (event.markets || [])
        .filter((m: any) => {
          const name = (m.name || '').toLowerCase();
          return !name.includes('match winner') && !name.includes('match result') && !name.includes('home/away') && !name.includes('1x2');
        })
        .filter((m: any) => m.outcomes && m.outcomes.length >= 2)
        .filter((m: any) => !isMarketClosed(m.id));

      if (apiMarkets.length > 0) return apiMarkets;

      if (event.sportId === 1) {
        return sportMarketsAdapter.getDefaultMarkets(1, event.homeTeam, event.awayTeam, { home: event.homeOdds, draw: event.drawOdds, away: event.awayOdds })
          .slice(1)
          .filter(m => !isMarketClosed(m.id));
      }

      return [];
    } catch (e) {
      console.error("Error generating secondary markets:", e);
      return [];
    }
  }, [event?.id, event?.homeTeam, event?.awayTeam, event?.sportId, event?.homeScore, event?.awayScore, event?.score, event?.isLive, minuteNum, isMarketClosed]);
  
  const NO_DRAW_SPORTS = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
  const hasRealOdds = !!(event?.homeOdds !== null && event?.homeOdds !== undefined && event?.homeOdds > 0)
    || ((event as any).oddsSource === 'live-fallback');
  const odds = {
    home: event?.homeOdds || null,
    draw: NO_DRAW_SPORTS.has(event?.sportId) ? null : (event?.drawOdds || null),
    away: event?.awayOdds || null
  };
  
  const getOddsMovement = (_oddsValue: number): 'up' | 'down' | 'stable' => {
    return 'stable';
  };
  
  const score = {
    home: event.homeScore ?? (event.score?.split('-')[0]?.trim() || '0'),
    away: event.awayScore ?? (event.score?.split('-')[1]?.trim() || '0')
  };
  
  const isHomeFavorite = favorites.has(event.homeTeam);
  const isAwayFavorite = favorites.has(event.awayTeam);
  
  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today ${timeStr}`;
      if (isTomorrow) return `Tomorrow ${timeStr}`;
      return date.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) + ' ' + timeStr;
    } catch {
      return '';
    }
  };

  const handleOutcomeClick = (outcome: string) => {
    setSelectedOutcome(selectedOutcome === outcome ? null : outcome);
  };

  const handleQuickBet = () => {
    if (!selectedOutcome) {
      toast({ title: "Select an outcome", description: "Click Home, Draw, or Away to select" });
      return;
    }
    
    const selectedOdds = selectedOutcome === 'home' ? odds.home : selectedOutcome === 'draw' ? odds.draw : odds.away;
    const outcomeName = selectedOutcome === 'home' ? event.homeTeam : selectedOutcome === 'draw' ? 'Draw' : event.awayTeam;
    
    addBet({
      id: `${event.id}-match-winner-${selectedOutcome}`,
      eventId: String(event.id),
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      marketId: "match-winner",
      market: "Match Winner",
      outcomeId: selectedOutcome,
      selectionId: selectedOutcome,
      selectionName: outcomeName,
      odds: selectedOdds,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      isLive: event.isLive || false,
    });
    
    toast({ title: "Added to bet slip", description: `${outcomeName} @ ${selectedOdds.toFixed(2)}` });
    setSelectedOutcome(null);
  };
  
  return (
    <div 
      className="px-4 py-3 hover:bg-white/[0.04] hover:backdrop-blur-sm transition-all duration-200 relative group" 
      data-testid={`compact-event-${event.id}`}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Time / Live indicator */}
          <div className="w-12 md:w-20 flex-shrink-0">
            {event.isLive ? (
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                <span className="text-red-400 text-xs font-medium">{(event as any).displayMinute || (event.minute ? `${event.minute}'` : 'LIVE')}</span>
              </div>
            ) : (
              <span className="text-gray-500 text-xs">{formatTime(event.startTime)}</span>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-600 font-medium uppercase w-3 flex-shrink-0">H</span>
              {event.homeLogo && (
                <img src={event.homeLogo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />
              )}
              <span className="text-white text-sm truncate flex-1">{event.homeTeam}</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(event.homeTeam); }}
                className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ visibility: 'visible' }}
                data-testid={`btn-favorite-home-${event.id}`}
              >
                <Star 
                  size={14} 
                  className={isHomeFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} 
                />
              </button>
              {event.isLive && <span className="text-cyan-400 font-bold text-sm score-pulse" aria-live="polite" aria-atomic="true">{score.home}</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] text-gray-600 font-medium uppercase w-3 flex-shrink-0">A</span>
              {event.awayLogo && (
                <img src={event.awayLogo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />
              )}
              <span className="text-gray-400 text-sm truncate flex-1">{event.awayTeam}</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(event.awayTeam); }}
                className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ visibility: 'visible' }}
                data-testid={`btn-favorite-away-${event.id}`}
              >
                <Star 
                  size={14} 
                  className={isAwayFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} 
                />
              </button>
              {event.isLive && <span className="text-cyan-400 font-bold text-sm score-pulse" aria-live="polite" aria-atomic="true">{score.away}</span>}
            </div>
          </div>

          {/* Desktop: Odds inline */}
          <div className="hidden md:flex items-center gap-1">
            {isBettingClosed ? (
              <div className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 border border-red-800/50 rounded">
                <Clock size={12} className="text-red-400" />
                <span className="text-red-400 text-xs font-medium">Betting closed</span>
              </div>
            ) : hasRealOdds ? (
              <div className="flex gap-1">
                {odds.home && (
                  <button
                    onClick={() => handleOutcomeClick('home')}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                      selectedOutcome === 'home' 
                        ? 'bg-cyan-500 text-black' 
                        : 'bg-[#1a1a1a] text-cyan-400 hover:bg-[#222]'
                    }`}
                    data-testid={`compact-odds-home-${event.id}`}
                  >
                    <OddsMovement direction={getOddsMovement(odds.home)} />
                    {odds.home.toFixed(2)}
                  </button>
                )}
                {odds.draw && (
                  <button
                    onClick={() => handleOutcomeClick('draw')}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                      selectedOutcome === 'draw' 
                        ? 'bg-yellow-500 text-black' 
                        : 'bg-[#1a1a1a] text-yellow-400 hover:bg-[#222]'
                    }`}
                    data-testid={`compact-odds-draw-${event.id}`}
                  >
                    <OddsMovement direction={getOddsMovement(odds.draw)} />
                    {odds.draw.toFixed(2)}
                  </button>
                )}
                {odds.away && (
                  <button
                    onClick={() => handleOutcomeClick('away')}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                      selectedOutcome === 'away' 
                        ? 'bg-cyan-500 text-black' 
                        : 'bg-[#1a1a1a] text-white hover:bg-[#222]'
                    }`}
                    data-testid={`compact-odds-away-${event.id}`}
                  >
                    <OddsMovement direction={getOddsMovement(odds.away)} />
                    {odds.away.toFixed(2)}
                  </button>
                )}
                {selectedOutcome && (
                  <button
                    onClick={handleQuickBet}
                    className="px-2 py-1.5 bg-green-500 hover:bg-green-600 text-black rounded text-xs font-bold transition-all"
                    data-testid={`compact-bet-${event.id}`}
                  >
                    +
                  </button>
                )}
              </div>
            ) : (
              <span className="text-gray-600 text-xs">No odds</span>
            )}
          </div>
          
          {/* Match Info Tooltip */}
          <button 
            className="p-1 text-gray-600 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title={`${event.leagueName || ''} - Click for match details`}
            data-testid={`btn-info-${event.id}`}
          >
            <Info size={14} />
          </button>
        </div>

        {/* Mobile: Odds row below teams */}
        <div className="flex md:hidden items-center gap-1 pl-12">
          {isBettingClosed ? (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 border border-red-800/50 rounded">
              <Clock size={12} className="text-red-400" />
              <span className="text-red-400 text-xs font-medium">Betting closed</span>
            </div>
          ) : hasRealOdds ? (
            <div className="flex gap-1.5 flex-1">
              {odds.home && (
                <button
                  onClick={() => handleOutcomeClick('home')}
                  className={`flex-1 px-2 py-2 rounded text-xs font-medium transition-all flex items-center justify-center gap-0.5 ${
                    selectedOutcome === 'home' 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-[#1a1a1a] text-cyan-400 hover:bg-[#222]'
                  }`}
                  data-testid={`compact-odds-home-mobile-${event.id}`}
                >
                  <OddsMovement direction={getOddsMovement(odds.home)} />
                  {odds.home.toFixed(2)}
                </button>
              )}
              {odds.draw && (
                <button
                  onClick={() => handleOutcomeClick('draw')}
                  className={`flex-1 px-2 py-2 rounded text-xs font-medium transition-all flex items-center justify-center gap-0.5 ${
                    selectedOutcome === 'draw' 
                      ? 'bg-yellow-500 text-black' 
                      : 'bg-[#1a1a1a] text-yellow-400 hover:bg-[#222]'
                  }`}
                  data-testid={`compact-odds-draw-mobile-${event.id}`}
                >
                  <OddsMovement direction={getOddsMovement(odds.draw)} />
                  {odds.draw.toFixed(2)}
                </button>
              )}
              {odds.away && (
                <button
                  onClick={() => handleOutcomeClick('away')}
                  className={`flex-1 px-2 py-2 rounded text-xs font-medium transition-all flex items-center justify-center gap-0.5 ${
                    selectedOutcome === 'away' 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-[#1a1a1a] text-white hover:bg-[#222]'
                  }`}
                  data-testid={`compact-odds-away-mobile-${event.id}`}
                >
                  <OddsMovement direction={getOddsMovement(odds.away)} />
                  {odds.away.toFixed(2)}
                </button>
              )}
              {selectedOutcome && (
                <button
                  onClick={handleQuickBet}
                  className="px-3 py-2 bg-green-500 hover:bg-green-600 text-black rounded text-xs font-bold transition-all"
                  data-testid={`compact-bet-mobile-${event.id}`}
                >
                  +
                </button>
              )}
            </div>
          ) : (
            <span className="text-gray-600 text-xs">No odds</span>
          )}
        </div>
      </div>
      
      
      {/* More Markets Button and Expandable Section */}
      {secondaryMarkets.length > 0 && hasRealOdds && (
        <>
          <button
            onClick={() => setShowMoreMarkets(!showMoreMarkets)}
            className="w-full mt-2 py-1.5 flex items-center justify-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors border-t border-cyan-900/20"
            data-testid={`btn-more-markets-${event.id}`}
          >
            <MoreHorizontal size={14} />
            <span>{showMoreMarkets ? 'Hide Markets' : `+${secondaryMarkets.length} More Markets`}</span>
            {showMoreMarkets ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          
          <AnimatePresence>
            {showMoreMarkets && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 py-3 bg-[#0a0a0a] space-y-3">
                  {secondaryMarkets.map((market) => (
                    <div key={market.id} className="space-y-2">
                      <div className="text-xs text-gray-400 font-medium">{market.name}</div>
                      <div className="flex flex-wrap gap-1">
                        {market.outcomes.map((outcome) => (
                          <button
                            key={outcome.id}
                            onClick={() => {
                              addBet({
                                id: `${event.id}-${market.id}-${outcome.id}`,
                                eventId: String(event.id),
                                eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                                marketId: String(market.id),
                                market: market.name,
                                outcomeId: String(outcome.id),
                                selectionId: String(outcome.id),
                                selectionName: outcome.name,
                                odds: outcome.odds,
                                homeTeam: event.homeTeam,
                                awayTeam: event.awayTeam,
                                isLive: event.isLive || false,
                              });
                              toast({ 
                                title: "Added to bet slip", 
                                description: `${market.name}: ${outcome.name} @ ${outcome.odds.toFixed(2)}` 
                              });
                            }}
                            className="px-2 py-1 bg-[#1a1a1a] hover:bg-[#222] text-xs rounded transition-colors"
                            data-testid={`btn-market-${market.id}-${outcome.id}-${event.id}`}
                          >
                            <span className="text-gray-400">{outcome.name}</span>
                            <span className="ml-1 text-cyan-400 font-medium">{outcome.odds.toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

interface EventCardProps {
  event: Event;
}

function EventCard({ event }: EventCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [stake, setStake] = useState<string>("10");
  const [isExpanded, setIsExpanded] = useState(false);
  const { addBet } = useBetting();
  const { toast } = useToast();
  
  // Check if this event has real odds from API or live fallback odds (betting enabled)
  const hasRealOdds = (event as any).oddsSource === 'api-sports' || (event as any).oddsSource === 'live-fallback';
  
  // Check if live match is past 45 minutes (betting closed)
  const getMatchMinute = (): number | null => {
    const eventAny = event as any;
    if (eventAny.minute !== undefined && eventAny.minute !== null) {
      const min = parseInt(String(eventAny.minute));
      if (!isNaN(min)) return min;
    }
    if (eventAny.matchMinute !== undefined && eventAny.matchMinute !== null) {
      const min = parseInt(String(eventAny.matchMinute));
      if (!isNaN(min)) return min;
    }
    // Try to extract from status string like "75'" or "HT"
    if (typeof eventAny.status === 'string') {
      const match = eventAny.status.match(/(\d+)/);
      if (match) return parseInt(match[1]);
      if (eventAny.status === 'HT') return 45;
      if (eventAny.status.includes('2H')) return 46;
    }
    return null;
  };
  
  const matchMinute = getMatchMinute();
  const isLiveMatch = event.isLive || event.status?.toLowerCase().includes('live') || 
                      event.status?.includes('H') || event.status?.includes("'");
  const isBettingClosed = isLiveMatch && matchMinute !== null && matchMinute >= 85;

  const getOddsFromMarkets = () => {
    const NO_DRAW_SPORTS = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
    const sportHasDraws = !NO_DRAW_SPORTS.has(event.sportId);
    const defaultOdds = { home: 2.05, draw: sportHasDraws ? 3.40 : null, away: 3.00 };
    
    if (!event.markets || event.markets.length === 0) {
      return { 
        home: event.homeOdds || defaultOdds.home, 
        draw: sportHasDraws ? (event.drawOdds || defaultOdds.draw) : null, 
        away: event.awayOdds || defaultOdds.away 
      };
    }
    
    const matchWinner = event.markets.find(m => m.name === "Match Result" || m.name === "Match Winner");
    if (matchWinner && matchWinner.outcomes && matchWinner.outcomes.length > 0) {
      const homeOutcome = matchWinner.outcomes.find(o => o.name === event.homeTeam);
      const drawOutcome = sportHasDraws ? matchWinner.outcomes.find(o => o.name === "Draw") : null;
      const awayOutcome = matchWinner.outcomes.find(o => o.name === event.awayTeam);
      return {
        home: (homeOutcome?.odds && !isNaN(homeOutcome.odds)) ? homeOutcome.odds : defaultOdds.home,
        draw: sportHasDraws && drawOutcome?.odds && !isNaN(drawOutcome.odds) ? drawOutcome.odds : defaultOdds.draw,
        away: (awayOutcome?.odds && !isNaN(awayOutcome.odds)) ? awayOutcome.odds : defaultOdds.away
      };
    }
    return defaultOdds;
  };

  const odds = getOddsFromMarkets();

  const getOdds = (outcome: string): number => {
    switch (outcome) {
      case "home": return odds.home;
      case "draw": return odds.draw;
      case "away": return odds.away;
      default: return 2.0;
    }
  };

  const handleOutcomeClick = (outcome: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBettingClosed) {
      toast({
        title: "Betting Closed",
        description: "Betting closed — final minutes of the match",
        variant: "destructive",
      });
      return;
    }
    setSelectedOutcome(outcome === selectedOutcome ? null : outcome);
  };

  const handleBetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedOutcome) {
      const selectedOdds = getOdds(selectedOutcome);
      const selectionName = selectedOutcome === "home" 
        ? event.homeTeam 
        : selectedOutcome === "away" 
          ? event.awayTeam 
          : "Draw";
      
      const betId = `${event.id}-${selectedOutcome}-${Date.now()}`;
      
      addBet({
        id: betId,
        eventId: String(event.id),
        eventName: `${event.homeTeam} vs ${event.awayTeam}`,
        marketId: "match-result",
        market: "Match Result",
        outcomeId: selectedOutcome,
        selectionName,
        odds: selectedOdds,
        stake: parseFloat(stake) || 10,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        isLive: event.isLive || false,
      });
      
      setSelectedOutcome(null);
    }
  };

  const parseScore = () => {
    if (event.score) {
      const parts = event.score.split(" - ");
      return { home: parseInt(parts[0]) || 0, away: parseInt(parts[1]) || 0 };
    }
    return { home: event.homeScore || 0, away: event.awayScore || 0 };
  };

  const score = parseScore();
  const leagueName = event.leagueName || event.league || "League";

  const potentialWin = selectedOutcome 
    ? (parseFloat(stake) * getOdds(selectedOutcome)).toFixed(2) 
    : "0";

  const formatDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      if (isToday) {
        return `Today ${timeStr}`;
      } else if (isTomorrow) {
        return `Tomorrow ${timeStr}`;
      } else {
        const dayStr = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        return `${dayStr} ${timeStr}`;
      }
    } catch {
      return '';
    }
  };

  return (
    <div 
      className="bg-[#111111] rounded-xl border border-cyan-900/30 overflow-hidden hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/5 transition-all duration-300"
      data-testid={`event-card-${event.id}`}
    >
      {/* League Header with Date/Time */}
      <div 
        className="px-4 py-2 border-b border-cyan-900/30 flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {event.isLive && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
          <span className="text-cyan-400 text-sm">{leagueName}</span>
        </div>
        <div className="flex items-center gap-3">
          {event.isLive ? (
            <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded font-medium">
              {(event as any).displayMinute || (event.minute ? `${event.minute}'` : 'LIVE')}
            </span>
          ) : (
            <span className="text-yellow-400 text-xs font-medium bg-yellow-500/10 px-2 py-1 rounded">
              {formatDateTime(event.startTime)}
            </span>
          )}
          <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </div>

      {/* Match Info */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            {event.isLive ? (
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block bg-red-500 text-white text-xs px-2 py-1 rounded font-bold">
                  LIVE {(event as any).displayMinute || (event.minute ? `${event.minute}'` : '')}
                </span>
                <span className="text-cyan-400 text-2xl font-bold">
                  {score.home} - {score.away}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <Clock size={14} className="text-yellow-400" />
                <span className="text-yellow-400 text-sm font-medium">
                  {formatDateTime(event.startTime)}
                </span>
              </div>
            )}
            <h3 className="text-white font-semibold text-lg mb-1">
              {event.homeTeam} vs {event.awayTeam}
            </h3>
            <p className="text-gray-500 text-sm">{leagueName}</p>
          </div>

          {/* Odds Cards */}
          <div className="flex gap-2">
            {hasRealOdds ? (
              <>
                {odds.home && (
                  <div 
                    className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                      selectedOutcome === "home" ? "ring-2 ring-cyan-500" : "hover:bg-[#222222]"
                    }`}
                    onClick={(e) => handleOutcomeClick("home", e)}
                    data-testid={`odds-home-${event.id}`}
                  >
                    <div className="text-cyan-400 text-xs mb-1">Home</div>
                    <div className="text-cyan-400 text-xl font-bold">{odds.home.toFixed(2)}</div>
                    <div className="text-gray-500 text-xs">{event.homeTeam?.split(' ')[0]}</div>
                  </div>
                )}
                {odds.draw && (
                  <div 
                    className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                      selectedOutcome === "draw" ? "ring-2 ring-yellow-500" : "hover:bg-[#222222]"
                    }`}
                    onClick={(e) => handleOutcomeClick("draw", e)}
                    data-testid={`odds-draw-${event.id}`}
                  >
                    <div className="text-yellow-400 text-xs mb-1">Draw</div>
                    <div className="text-yellow-400 text-xl font-bold">{odds.draw.toFixed(2)}</div>
                  </div>
                )}
                {odds.away && (
                  <div 
                    className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                      selectedOutcome === "away" ? "ring-2 ring-cyan-500" : "hover:bg-[#222222]"
                    }`}
                    onClick={(e) => handleOutcomeClick("away", e)}
                    data-testid={`odds-away-${event.id}`}
                  >
                    <div className="text-white text-xs mb-1">Away</div>
                    <div className="text-white text-xl font-bold">{odds.away.toFixed(2)}</div>
                    <div className="text-gray-500 text-xs">{event.awayTeam?.split(' ')[0]}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-[#1a1a1a] rounded-lg p-3 text-center">
                <div className="text-gray-500 text-xs mb-1">Odds</div>
                <div className="text-gray-400 text-sm font-medium">Not Available</div>
              </div>
            )}
          </div>
        </div>

        {/* Bet Button */}
        <div className="flex justify-center mb-4">
          {isBettingClosed ? (
            <div className="bg-red-900/30 border border-red-500/40 rounded-lg px-4 py-2 text-center">
              <span className="text-red-400 font-bold text-sm">Betting Closed</span>
              <span className="text-red-400/70 text-xs block">Betting closed</span>
            </div>
          ) : hasRealOdds ? (
            <>
              <button 
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-2 rounded-lg flex items-center gap-2 transition-all"
                onClick={handleBetClick}
                data-testid={`btn-bet-${event.id}`}
              >
                ✓ Bet
              </button>
              <button 
                className={`text-sm ml-4 transition-all ${selectedOutcome ? 'text-cyan-400' : 'text-gray-500 hover:text-cyan-400'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!selectedOutcome) {
                    toast({
                      title: "Select a team first",
                      description: "Click on Home, Draw, or Away odds above to select your pick",
                    });
                  } else {
                    handleBetClick(e);
                  }
                }}
                data-testid={`btn-select-team-${event.id}`}
              >
                {selectedOutcome ? '+ Add to slip' : '+ Select team'}
              </button>
            </>
          ) : (
            <div className="text-gray-500 text-sm py-2">
              Betting unavailable - no bookmaker coverage
            </div>
          )}
        </div>

        {/* Betting Panel (shown when outcome selected) */}
        {selectedOutcome && (
          <div className="border-t border-cyan-900/30 pt-4 mt-4">
            <div className="bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded inline-block mb-4 text-sm font-medium">
              Match Winner
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Pick Options */}
              <div>
                <div className="text-gray-400 text-sm mb-2">Pick</div>
                <div className="space-y-2">
                  {["home", "draw", "away"].map((outcome) => (
                    <button
                      key={outcome}
                      onClick={(e) => handleOutcomeClick(outcome, e)}
                      className={`w-full py-2 px-4 rounded-lg text-center transition-all ${
                        selectedOutcome === outcome
                          ? "bg-cyan-500 text-black font-bold"
                          : "bg-[#1a1a1a] text-gray-300 hover:bg-[#222222]"
                      }`}
                      data-testid={`pick-${outcome}-${event.id}`}
                    >
                      {outcome === "home" ? event.homeTeam : outcome === "away" ? event.awayTeam : "Draw"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stake & Potential Win */}
              <div>
                <div className="text-gray-400 text-sm mb-2">Stake (SUI)</div>
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-cyan-900/30 rounded-lg py-2 px-4 text-white mb-4"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`input-stake-${event.id}`}
                />
                
                <div className="text-gray-400 text-sm mb-2">Odds</div>
                <div className="bg-[#1a1a1a] rounded-lg py-2 px-4 text-cyan-400 mb-4">
                  {getOdds(selectedOutcome).toFixed(2)}
                </div>
                
                <div className="text-gray-400 text-sm mb-2">To Win</div>
                <div className="bg-cyan-500 rounded-lg py-3 px-4 text-black font-bold text-center">
                  {potentialWin} SUI
                </div>
              </div>
            </div>

            {/* Place Bet Button */}
            <button 
              className="w-full mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-3 rounded-lg transition-all"
              onClick={handleBetClick}
              data-testid={`btn-place-bet-${event.id}`}
            >
              Place Bet
            </button>
          </div>
        )}

        {/* Expanded Markets Section */}
        {isExpanded && (
          <div className="border-t border-cyan-900/30 pt-4 mt-4">
            <h4 className="text-cyan-400 font-semibold mb-3">All Markets</h4>
            
            {/* Over/Under Markets */}
            {odds.home && odds.away && (
              <div className="mb-4">
                <div className="text-gray-400 text-sm mb-2">Over/Under 2.5 Goals</div>
                <div className="flex gap-2">
                  <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                    <span className="text-xs text-gray-400">Over 2.5</span>
                    <div className="text-cyan-400 font-bold">{(odds.home * 0.9).toFixed(2)}</div>
                  </button>
                  <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                    <span className="text-xs text-gray-400">Under 2.5</span>
                    <div className="text-cyan-400 font-bold">{(odds.away * 1.1).toFixed(2)}</div>
                  </button>
                </div>
              </div>
            )}

            {/* Both Teams to Score */}
            <div className="mb-4">
              <div className="text-gray-400 text-sm mb-2">Both Teams to Score</div>
              <div className="flex gap-2">
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">Yes</span>
                  <div className="text-cyan-400 font-bold">{(1.85).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">No</span>
                  <div className="text-cyan-400 font-bold">{(1.95).toFixed(2)}</div>
                </button>
              </div>
            </div>

            {/* Double Chance */}
            <div className="mb-4">
              <div className="text-gray-400 text-sm mb-2">Double Chance</div>
              <div className="flex gap-2">
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">1X</span>
                  <div className="text-cyan-400 font-bold">{(1.35).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">12</span>
                  <div className="text-cyan-400 font-bold">{(1.25).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">X2</span>
                  <div className="text-cyan-400 font-bold">{(1.45).toFixed(2)}</div>
                </button>
              </div>
            </div>

            {/* Match Info */}
            <div className="bg-[#0a0a0a] rounded-lg p-3 mt-4">
              <div className="text-gray-400 text-xs mb-1">Match ID</div>
              <div className="text-white text-sm font-mono">{event.id}</div>
              <div className="text-gray-400 text-xs mt-2 mb-1">Start Time</div>
              <div className="text-white text-sm">{new Date(event.startTime).toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}