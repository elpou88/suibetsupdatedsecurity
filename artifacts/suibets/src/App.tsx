import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { useBetting } from "@/context/BettingContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useSettlementNotifications } from "@/hooks/useSettlementNotifications";
import { useP2PMatchNotifications } from "@/hooks/useP2PMatchNotifications";
import { useCurrentAccount } from "@/lib/dapp-kit-compat";
import { useZkLogin } from "@/context/ZkLoginContext";
import { useTelegramWebApp } from "@/hooks/useTelegramWebApp";

// Main pages - unified SuiBets design
import CleanHome from "@/pages/clean-home";
import Match from "@/pages/match";
import MatchDetail from "@/pages/match-detail";
import Notifications from "@/pages/notifications";
import Settings from "@/pages/settings";
import WalletDashboard from "@/pages/wallet-dashboard";
import NotFound from "@/pages/not-found";
import VideoPage from "@/pages/video";
import Info from "@/pages/info";
import Community from "@/pages/community";
import Contact from "@/pages/contact";
import LiveEventPage from "@/pages/live/[id]";
import EventPage from "@/pages/event/[id]";

// Context providers and shared components
import { AuthProvider } from "@/context/AuthContext";
import { BlockchainAuthProvider } from "@/hooks/useBlockchainAuth";
import { ZkLoginProvider } from "@/context/ZkLoginContext";
import { PasskeyProvider } from "@/context/PasskeyContext";
import { BettingProvider } from "@/context/BettingContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { WalProvider } from "@/components/ui/wal-components";
import { WalrusProtocolProvider } from "@/context/WalrusProtocolContext";
import { SpecialLinks } from "@/components/ui/SpecialLinks";
import { UniversalClickHandler } from "@/components/betting/UniversalClickHandler";
import { SportBettingWrapper } from "@/components/betting/SportBettingWrapper";
import { SuiDappKitProvider } from "@/components/wallet/SuiDappKitProvider";
import { BetSlip } from "@/components/betting/BetSlip";

// Core functionality pages
import SportsLive from "@/pages/sports-live";
import WalletDashboardPage from "@/pages/wallet-dashboard";
import RevenuePage from "@/pages/revenue";
import SportPage from "@/pages/sports-live/[sport]";
import StoragePage from "@/pages/storage";
import LiveScoresPage from "@/pages/live-scores";
import ParlayPageNew from "@/pages/parlay";
import Layout from "@/components/layout/Layout";
import JoinPage from "@/pages/join";
import LiveEventsPage from "@/pages/live-events";
import UpcomingEventsPage from "@/pages/upcoming-events";
import ResultsPage from "@/pages/results";
import ActivityPage from "@/pages/activity";
import WhitepaperPage from "@/pages/whitepaper";
import AdminPanel from "@/pages/admin-panel";
import SharedBetPage from "@/pages/shared-bet";
import SharedP2POfferPage from "@/pages/shared-p2p-offer";
import WalrusReceiptPage from "@/pages/walrus-receipt";
import AuthCallback from "@/pages/auth-callback";
import P2PChallengeAcceptPage from "@/pages/p2p-challenge";
import P2PPage from "@/pages/p2p";
import WarpShowcasePage from "@/pages/warp-showcase";

// Informational Pages
import PrivacyPolicy from "@/pages/privacy";
import FAQPage from "@/pages/faq";
import LeaderboardPage from "@/pages/leaderboard";
import ResponsibleGambling from "@/pages/responsible";
import RulesPage from "@/pages/rules";
import IntegrityPage from "@/pages/integrity";
import SettlementTransparencyPage from "@/pages/settlement-transparency";
import MessagingPage from "@/pages/messaging";
import CryptoMarketsPage from "@/pages/crypto-markets";
import BlogPage from "@/pages/blog";
import { SessionTimer } from "@/components/ResponsibleGaming";
import { GlobalBetsPanel } from "@/components/p2p/GlobalBetsPanel";

function GlobalWalletModal() {
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
    };
    window.addEventListener('suibets:connect-wallet-required', handler);
    return () => window.removeEventListener('suibets:connect-wallet-required', handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = () => setIsOpen(false);
    window.addEventListener('suibets:wallet-connected', handler);
    return () => window.removeEventListener('suibets:wallet-connected', handler);
  }, [isOpen]);
  
  return <ConnectWalletModal isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}

function WebSocketConnector() {
  const { status } = useWebSocket();
  useEffect(() => {
    if (status === 'connected') {
      console.log('[WS] Real-time feed active — polling reduced');
    }
  }, [status]);
  return null;
}

function SettlementNotifier() {
  const currentAccount = useCurrentAccount();
  const { isZkLoginActive, zkLoginAddress } = useZkLogin();
  const wallet = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);
  useSettlementNotifications(wallet);
  return null;
}

function P2PMatchNotifier() {
  const currentAccount = useCurrentAccount();
  const { isZkLoginActive, zkLoginAddress } = useZkLogin();
  const wallet = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);
  useP2PMatchNotifications(wallet);
  return null;
}

function FloatingBetSlipPortal() {
  const { selectedBets } = useBetting();
  const [mobileOpen, setMobileOpen] = useState(false);
  const hasSelections = selectedBets.length > 0;

  // Auto-open mobile sheet when a bet is added
  useEffect(() => {
    if (hasSelections) setMobileOpen(true);
  }, [hasSelections]);

  // Also respond to the P2P betslip event
  useEffect(() => {
    const handler = () => setMobileOpen(true);
    window.addEventListener('open-betslip-p2p', handler);
    return () => window.removeEventListener('open-betslip-p2p', handler);
  }, []);

  // Close when all bets are cleared
  useEffect(() => {
    if (!hasSelections) setMobileOpen(false);
  }, [hasSelections]);

  return (
    <>
      {/* Desktop: floating bottom-right panel */}
      <div className="hidden sm:block fixed bottom-4 right-4 w-80 z-30 max-h-[70vh] overflow-auto" data-testid="floating-betslip">
        <BetSlip />
      </div>

      {/* Mobile: bottom sheet */}
      <div className="sm:hidden">
        {/* Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-[58] bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Collapsed tab — only show when there are selections and sheet is closed */}
        {hasSelections && !mobileOpen && (
          <button
            onClick={() => setMobileOpen(true)}
            className="fixed bottom-16 right-0 z-[60] flex items-center gap-1.5 bg-cyan-600 text-black rounded-l-xl px-2 py-3 shadow-xl font-black text-[10px]"
            style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex flex-col items-center gap-1">
              <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                BET SLIP
              </span>
              <span className="bg-black text-cyan-400 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black">
                {selectedBets.length}
              </span>
            </div>
          </button>
        )}

        {/* Expanded bottom sheet */}
        {mobileOpen && (
          <div
            className="fixed bottom-0 left-0 right-0 z-[60] bg-[#0d1117] border-t border-[#1e2a3a] rounded-t-2xl shadow-2xl"
            style={{ maxHeight: '85vh', overflowY: 'auto', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            {/* Drag handle + close */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 sticky top-0 bg-[#0d1117] border-b border-[#1e2a3a] z-10">
              <div className="w-10 h-1 bg-[#2a3a50] rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-2" />
              <span className="text-white font-black text-sm">Bet Slip</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="text-gray-500 hover:text-white transition-colors p-1 ml-auto"
              >
                ✕
              </button>
            </div>
            <div className="px-1">
              <BetSlip />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function TelegramAppInit() {
  const { isInTelegram, twa, colorScheme, user } = useTelegramWebApp();

  useEffect(() => {
    if (!isInTelegram || !twa) return;

    const theme = twa.themeParams;

    if (theme.bg_color) {
      document.documentElement.style.setProperty('--tg-bg-color', theme.bg_color);
      document.body.style.backgroundColor = theme.bg_color;
    }
    if (theme.text_color) {
      document.documentElement.style.setProperty('--tg-text-color', theme.text_color);
    }
    if (theme.button_color) {
      document.documentElement.style.setProperty('--tg-button-color', theme.button_color);
    }
    if (theme.button_text_color) {
      document.documentElement.style.setProperty('--tg-button-text-color', theme.button_text_color);
    }
    if (theme.secondary_bg_color) {
      document.documentElement.style.setProperty('--tg-secondary-bg-color', theme.secondary_bg_color);
    }

    document.documentElement.setAttribute('data-tma', 'true');
    document.documentElement.setAttribute('data-tma-scheme', colorScheme);

    if (user) {
      console.log('[TMA] Running as Telegram user:', user.username ?? user.first_name, `(id=${user.id})`);
    }

    const startParam = twa.initDataUnsafe?.start_param;
    if (startParam?.startsWith('offer_')) {
      const offerId = startParam.replace('offer_', '');
      window.location.href = `/p2p/offer/${offerId}`;
    }
  }, [isInTelegram, twa, colorScheme, user]);

  return null;
}

function App() {
  console.log("Starting React application");
  
  // Capture referral code from URL on app load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    
    if (refCode) {
      // Store referral code in localStorage for later use when user connects wallet
      localStorage.setItem('suibets_referral_code', refCode.toUpperCase());
      console.log(`[REFERRAL] Captured referral code from URL: ${refCode.toUpperCase()}`);
    }
  }, []);
  
  // Log wallet detection on app start (with delay for extension injection)
  useEffect(() => {
    const checkWallets = () => {
      console.log("Checking for installed wallets...");
      const win = window as any;
      
      const hasSlush = typeof win.slush !== 'undefined' || typeof win.suiWallet !== 'undefined';
      // Comprehensive Nightly detection - check multiple injection points
      const hasNightly = typeof win.nightly !== 'undefined' || 
                         typeof win.nightly?.sui !== 'undefined' ||
                         typeof win.nightly?.wallets !== 'undefined' ||
                         (win.navigator?.wallets && Array.from(win.navigator.wallets || []).some((w: any) => 
                           w?.name?.toLowerCase().includes('nightly')));
      const hasSuietWallet = typeof win.suiet !== 'undefined';
      const hasEthosWallet = typeof win.ethos !== 'undefined';
      const hasMartianWallet = typeof win.martian !== 'undefined';
      const hasWalletStandard = typeof win.walletStandard !== 'undefined';
      
      // Also check Wallet Standard registry for all Sui wallets
      const walletStandardWallets: string[] = [];
      if (win.navigator?.wallets) {
        try {
          for (const wallet of win.navigator.wallets) {
            if (wallet?.name) walletStandardWallets.push(wallet.name);
          }
        } catch (e) { /* ignore */ }
      }
      
      console.log("Wallet detection:", {
        slush: hasSlush,
        nightly: hasNightly,
        suiet: hasSuietWallet,
        ethos: hasEthosWallet,
        martian: hasMartianWallet,
        walletStandard: hasWalletStandard,
        walletStandardWallets
      });
      
      // Log raw window.nightly object for debugging
      if (win.nightly) {
        console.log("Nightly wallet object found:", Object.keys(win.nightly));
      }
    };
    
    // Delay to allow extensions time to inject their APIs
    // Poll at 1.5s, 3s, and 5s to catch slow-loading extensions
    const t1 = setTimeout(checkWallets, 1500);
    const t2 = setTimeout(checkWallets, 3000);
    const t3 = setTimeout(checkWallets, 5000);

    // Also react immediately whenever a wallet registers itself via wallet-standard.
    // Use .then() so the effect stays synchronous and returns its cleanup fn correctly.
    let unsubRegister: (() => void) | undefined;
    import('@wallet-standard/app').then(({ getWallets }) => {
      try {
        const walletsApi = getWallets();
        unsubRegister = walletsApi.on('register', checkWallets);
      } catch { /* ignore */ }
    }).catch(() => { /* ignore — polled fallback above is sufficient */ });

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      unsubRegister?.();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        {/* SuiDappKitProvider - single source of truth for Sui wallet connection */}
        <SuiDappKitProvider>
          <WalProvider>
            <LanguageProvider>
              <WalrusProtocolProvider>
                <BlockchainAuthProvider>
                  <ZkLoginProvider>
                  <PasskeyProvider>
                  <AuthProvider>
                    <SettingsProvider>
                      <BettingProvider>
                        <div className="root-container">
                          <TelegramAppInit />
                          <UniversalClickHandler />
                          <Switch>
                          {/* Main Routes - Unified SuiBets design */}
                          <Route path="/" component={CleanHome} />
                          <Route path="/sports" component={CleanHome} />
                          <Route path="/sport/:slug*" component={SportsLive} />
                          <Route path="/match/:id" component={Match} />
                          <Route path="/match-detail/:id" component={MatchDetail} />
                          <Route path="/event/:id" component={EventPage} />
                          <Route path="/live" component={LiveEventsPage} />
                          <Route path="/live/:id" component={LiveEventPage} />
                          <Route path="/live-events" component={LiveEventsPage} />
                          <Route path="/upcoming-events" component={UpcomingEventsPage} />
                          
                          {/* Core Pages */}
                          <Route path="/results" component={ResultsPage} />
                          <Route path="/notifications" component={Notifications} />
                          <Route path="/tokenomics" component={RevenuePage} />
                          <Route path="/revenue" component={RevenuePage} />
                          <Route path="/bet-history" component={WalletDashboardPage} />
                          <Route path="/leaderboard" component={LeaderboardPage} />
                          <Route path="/storage" component={StoragePage} />
                          <Route path="/live-scores" component={LiveScoresPage} />
                          
                          {/* Wallet & User Pages */}
                          <Route path="/wallet-dashboard" component={WalletDashboard} />
                          <Route path="/dashboard" component={WalletDashboard} />
                          <Route path="/activity" component={ActivityPage} />
                          <Route path="/whitepaper" component={WhitepaperPage} />
                          <Route path="/warp" component={WarpShowcasePage} />
                          <Route path="/join" component={JoinPage} />
                          
                          {/* Info Pages */}
                          <Route path="/info" component={Info} />
                          <Route path="/community" component={Community} />
                          <Route path="/contact" component={Contact} />
                          <Route path="/privacy" component={PrivacyPolicy} />
                          <Route path="/faq" component={FAQPage} />
                          <Route path="/responsible" component={ResponsibleGambling} />
                          <Route path="/rules" component={RulesPage} />
                          <Route path="/integrity" component={IntegrityPage} />
                          <Route path="/settlement" component={SettlementTransparencyPage} />
                          <Route path="/chat" component={MessagingPage} />
                          <Route path="/crypto-markets" component={CryptoMarketsPage} />
                          <Route path="/blog" component={BlogPage} />
                          
                          {/* Sports Pages */}
                          <Route path="/sports-live" component={SportsLive} />
                          <Route path="/sports-live/:sport" component={SportPage} />
                          <Route path="/parlay" component={ParlayPageNew} />
                          <Route path="/video" component={VideoPage} />
                          <Route path="/p2p" component={P2PPage} />
                          <Route path="/p2p/c/:token" component={P2PChallengeAcceptPage} />
                          
                          
                          {/* Shared P2P Offer/Parlay Pages */}
                          <Route path="/p2p/offer/:id" component={SharedP2POfferPage} />
                          <Route path="/p2p/parlay/:id" component={SharedP2POfferPage} />

                          {/* Shared Bet Page */}
                          <Route path="/bet/:id" component={SharedBetPage} />
                          
                          {/* Walrus Receipt Page */}
                          <Route path="/walrus-receipt/:blobId" component={WalrusReceiptPage} />
                          
                          
                          {/* zkLogin OAuth Callback */}
                          <Route path="/auth/callback" component={AuthCallback} />
                          
                          {/* Admin Panel - Password Protected */}
                          <Route path="/admin" component={AdminPanel} />
                          
                          <Route component={NotFound} />
                        </Switch>
                        
                        {/* Universal betting handlers to enable betting across all pages */}
                        <SportBettingWrapper />
                        
                        <FloatingBetSlipPortal />
                      </div>
                      <GlobalBetsPanel />
                      <GlobalWalletModal />
                      <SpecialLinks />
                      <SessionTimer />
                      <Toaster />
                      <WebSocketConnector />
                      <SettlementNotifier />
                      <P2PMatchNotifier />
                    </BettingProvider>
                    </SettingsProvider>
                  </AuthProvider>
                  </PasskeyProvider>
                </ZkLoginProvider>
                </BlockchainAuthProvider>
              </WalrusProtocolProvider>
            </LanguageProvider>
          </WalProvider>
        </SuiDappKitProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;