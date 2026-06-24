import React, { ReactNode, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@/lib/dapp-kit-compat';
import { useTelegramWebApp } from '@/hooks/useTelegramWebApp';
import { 
  Home, TrendingUp, Megaphone, Bell, Settings, 
  Clock, Wallet, ChevronLeft, Landmark, 
  TrendingDown, Trophy, MenuIcon, MessageCircle, Target,
  MoreHorizontal, FileText, Activity, ArrowUpDown, Zap
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConnectWalletModal } from '@/components/modals/ConnectWalletModal';
const suibetsBackground = `${import.meta.env.VITE_API_BASE_URL || ''}/images/suibets-background.png`;
const suibetsLogo = "/images/suibets-logo.jpg";

export interface LayoutProps {
  children: ReactNode;
  title?: string;
  showBackButton?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  title, 
  showBackButton = false
}) => {
  const [location, setLocation] = useLocation();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const currentAccount = useCurrentAccount();
  const { isInTelegram } = useTelegramWebApp();
  
  // Fetch upcoming events for the ticker
  const { data: upcomingEvents = [] } = useQuery<any[]>({
    queryKey: ['/api/events', 'upcoming'],
    refetchInterval: 120000 // Refresh every 2 minutes (reduced from 30s to conserve API)
  });
  
  // Format upcoming events for ticker display
  const getTickerText = () => {
    if (!upcomingEvents || upcomingEvents.length === 0) {
      return '🏆 Loading latest matches... | ⚽ Check back soon for upcoming games! | 🎾 Live betting on all major sports | 🏀 Real-time odds updates | 🏒 Join SuiBets for 0% fees!';
    }
    
    const events = (Array.isArray(upcomingEvents) ? upcomingEvents : []).slice(0, 5).map((event: any) => {
      const time = new Date(event.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const sportEmoji = getSportEmoji(event.sport);
      return `${sportEmoji} ${event.homeTeam} vs ${event.awayTeam} - ${time}`;
    }).join(' | ');
    
    return events + ' | 🔥 Join SuiBets for 0% fees!';
  };
  
  const getSportEmoji = (sport: string): string => {
    const emojiMap: Record<string, string> = {
      'football': '⚽',
      'basketball': '🏀',
      'tennis': '🎾',
      'baseball': '⚾',
      'hockey': '🏒',
      'boxing': '🥊',
      'rugby': '🏉',
      'golf': '⛳'
    };
    return emojiMap[sport?.toLowerCase()] || '🏆';
  };
  
  const topNavItems = [
    { label: 'Home', href: '/' },
    { label: '⚔️ P2P Markets', href: '/p2p' },
  ];

  const moreMenuItems = [
    { label: 'Leaderboard', href: '/leaderboard', icon: <Target className="h-4 w-4 mr-2" /> },
    { label: 'Results', href: '/results', icon: <Activity className="h-4 w-4 mr-2" /> },
    { label: 'Parlays', href: '/parlay', icon: <Target className="h-4 w-4 mr-2" /> },
    { label: 'Revenue', href: '/tokenomics', icon: <TrendingUp className="h-4 w-4 mr-2" /> },
    { label: 'Whitepaper', href: '/whitepaper', icon: <FileText className="h-4 w-4 mr-2" /> },
  ];

  const bottomNavItems = [
    { label: 'Home', i18nKey: 'home', icon: <Home />, href: '/' },
    { label: 'Live', i18nKey: 'live', icon: <TrendingUp />, href: '/live-events' },
    { label: 'Results', i18nKey: 'results', icon: <Activity />, href: '/results' },
  ];

  const handleBack = () => {
    window.history.back();
  };
  
  return (
    <div 
      className="min-h-screen text-white pb-16 lg:pb-0"
      style={{ backgroundColor: '#080a0f' }}
    >
      <div className="min-h-screen">
      {/* Top Header */}
      <header style={{ background: '#080a0f', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Upper section with logo and login */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#080a0f' }}>
          <div className="flex items-center space-x-2">
            {showBackButton ? (
              <Button
                variant="ghost"
                size="sm"
                className="mr-2 text-cyan-400 hover:text-cyan-300 hover:bg-[#1e3a3f]"
                onClick={handleBack}
              >
                <ChevronLeft className="h-5 w-5" />
                Back
              </Button>
            ) : (
              <div className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLocation('/')}>
                <img 
                  src={suibetsLogo} 
                  alt="SuiBets Logo" 
                  className="h-10 w-auto object-contain drop-shadow-[0_0_10px_rgba(0,255,255,0.4)]"
                  data-testid="logo-image"
                />
              </div>
            )}
            {showBackButton && title && (
              <h1 className="text-xl font-semibold text-cyan-200">{title}</h1>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            {!isInTelegram && (
              <Button 
                variant="default" 
                size="sm"
                className="bg-[#0088cc] hover:bg-[#0077bb] text-white text-xs shadow-[0_0_10px_rgba(0,136,204,0.3)] transition-all hover:shadow-[0_0_15px_rgba(0,136,204,0.5)] flex items-center gap-1"
                onClick={() => window.open('https://t.me/Sui_Bets', '_blank')}
                data-testid="button-join-now"
              >
                <MessageCircle className="h-4 w-4" />
                JOIN NOW
              </Button>
            )}
            {currentAccount?.address ? (
              <Button
                variant="outline"
                size="sm"
                className="border-cyan-500/50 bg-cyan-900/20 text-cyan-300 hover:bg-cyan-900/40 text-xs"
                onClick={() => setLocation('/wallet-dashboard')}
                data-testid="button-wallet-connected"
              >
                <Wallet className="h-3.5 w-3.5 mr-1" />
                {currentAccount.address.slice(0, 6)}…{currentAccount.address.slice(-4)}
              </Button>
            ) : (
              <Button 
                variant="default" 
                size="sm"
                className="bg-[#00ffff] hover:bg-[#00d8d8] text-black text-xs shadow-[0_0_10px_rgba(0,255,255,0.3)] transition-all hover:shadow-[0_0_15px_rgba(0,255,255,0.5)]"
                onClick={() => setIsWalletModalOpen(true)}
                data-testid="button-connect-wallet"
              >
                Connect Wallet
              </Button>
            )}
          </div>
        </div>

      </header>
      
      
      {/* Display title if provided and not showing back button */}
      {title && !showBackButton && (
        <div className="container mx-auto px-4 pt-4">
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
      )}
      
      {/* Main content */}
      <div className="container mx-auto p-4">
        {children}
      </div>
      
      {/* Mobile bottom navigation (visible on small screens) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 rounded-t-2xl z-50" style={{ background: '#0e1117', borderTop: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 -4px 24px rgba(0,0,0,0.5)' }}>
        <div className="flex justify-around p-1">
          {bottomNavItems.map((item, index) => (
            <Button
              key={index}
              variant="ghost"
              className={`flex flex-col items-center justify-center py-1 h-14 w-full transition-all ${
                location === item.href 
                  ? 'text-cyan-400 border-t-2 border-cyan-400 bg-white/5' 
                  : 'text-gray-400 hover:text-cyan-400'
              }`}
              onClick={() => setLocation(item.href)}
            >
              {item.icon}
              <span className="text-xs mt-1">{item.label}</span>
            </Button>
          ))}
        </div>
      </div>
      
      {/* Wallet Connection Modal */}
      <ConnectWalletModal 
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />
    </div></div>
  );
};

export default Layout;