import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { NotificationsModal } from "@/components/modals/NotificationsModal";
import { Bell, Clock } from "lucide-react";
import { FreshConnectButton } from "@/components/wallet/FreshConnectButton";
import { useTelegramWebApp } from "@/hooks/useTelegramWebApp";
import { getUnseenSettlementCount, clearUnseenSettlements } from "@/hooks/useSettlementNotifications";

export default function Navbar() {
  const [location] = useLocation();
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState(false);
  const { isInTelegram } = useTelegramWebApp();
  const [settlementBadge, setSettlementBadge] = useState(() => getUnseenSettlementCount());

  useEffect(() => {
    const handler = (e: Event) => setSettlementBadge((e as CustomEvent).detail as number);
    window.addEventListener('suibets:settlement-badge-update', handler);
    return () => window.removeEventListener('suibets:settlement-badge-update', handler);
  }, []);

  const openNotifications = useCallback(() => {
    setIsNotificationsModalOpen(true);
    setSettlementBadge(0);
    clearUnseenSettlements();
  }, []);

  return (
    <nav className="bg-gradient-to-r from-[#09181B] via-[#0f1f25] to-[#09181B] py-3 px-3 md:py-4 md:px-6 flex items-center" style={{ boxShadow: '0 1px 0 rgba(0,255,255,0.22), 0 2px 16px rgba(0,255,255,0.05), 0 4px 6px rgba(0,0,0,0.4)' }}>
      <div className="flex-1 flex items-center">
        {/* Logo - visible on mobile */}
        <Link href="/" className="md:hidden">
          <img src="/logo/suibets-logo-transparent.png" alt="SuiBets" className="h-7 w-auto" />
        </Link>
        
        {/* Desktop navigation */}
        <div className="hidden lg:flex items-center space-x-4 xl:space-x-8 mx-auto">
          <a 
            href="/" 
            className={`${location === "/" ? "text-[#00FFFF]" : "text-white hover:text-[#00FFFF]"} cursor-pointer text-sm font-semibold whitespace-nowrap`}
          >
            Sports
          </a>
          
          <a 
            href="/live-events" 
            className="text-black bg-gradient-to-r from-[#00FFFF] to-[#00d9ff] px-3 py-1.5 rounded-lg cursor-pointer font-bold text-sm hover:shadow-lg hover:shadow-cyan-400/50 transition-all duration-300 whitespace-nowrap"
          >
            Live<span className="ml-1 inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
          </a>
          
          <a 
            href="https://app.cetus.zone/swap/0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS/0x2::sui::SUI"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-shimmer text-black bg-gradient-to-r from-green-400 to-emerald-500 px-3 py-1.5 rounded-lg cursor-pointer font-bold text-sm hover:shadow-lg hover:shadow-green-500/50 transition-all duration-300 whitespace-nowrap"
            data-testid="link-buy-sbets"
          >
            Buy SBETS
          </a>
          
          <a 
            href="/tokenomics" 
            className={`${location === "/tokenomics" || location === "/revenue" ? "text-[#FFD700]" : "text-white hover:text-[#FFD700]"} cursor-pointer text-sm font-bold whitespace-nowrap`}
            data-testid="link-tokenomics"
          >
            Revenue
          </a>
          
          <a 
            href="/leaderboard" 
            className={`${location === "/leaderboard" ? "text-[#FFD700]" : "text-white hover:text-[#FFD700]"} cursor-pointer text-sm font-bold whitespace-nowrap`}
            data-testid="link-leaderboard"
          >
            Leaderboard
          </a>

          <a 
            href="/settlement" 
            className={`flex items-center gap-1 cursor-pointer text-sm font-bold whitespace-nowrap transition-colors ${location === "/settlement" ? "text-orange-400" : "text-white hover:text-orange-400"}`}
            data-testid="link-settlement"
          >
            <Clock className="h-3.5 w-3.5" /> Dispute
          </a>
        </div>
      </div>
      
      <div className="flex items-center justify-end flex-1 pr-2 gap-1 sm:gap-2">
        {/* FreshConnectButton handles both connected and disconnected states */}
        <FreshConnectButton />
        
        {/* Notification Button */}
        <Button 
          variant="ghost" 
          size="icon"
          className="relative text-white hover:text-[#00FFFF] hover:bg-[#112225] h-8 w-8 sm:h-10 sm:w-10"
          onClick={openNotifications}
          data-testid="button-notifications"
        >
          <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
          {settlementBadge > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none pointer-events-none">
              {settlementBadge > 9 ? '9+' : settlementBadge}
            </span>
          )}
        </Button>
        
        {/* Telegram Join Now Button — hidden inside Telegram mini app */}
        {!isInTelegram && (
          <a href="https://t.me/Sui_Bets" target="_blank" rel="noopener noreferrer" className="hidden xl:block">
            <Button variant="outline" size="sm" className="border-[#00FFFF] text-[#00FFFF] hover:bg-[#00FFFF]/20 font-medium">
              Join Telegram
            </Button>
          </a>
        )}
      </div>
      
      <NotificationsModal 
        isOpen={isNotificationsModalOpen} 
        onClose={() => setIsNotificationsModalOpen(false)} 
      />
    </nav>
  );
}
