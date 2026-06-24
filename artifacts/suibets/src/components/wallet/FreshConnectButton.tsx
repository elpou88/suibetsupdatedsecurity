import { useCurrentAccount, useDisconnectWallet, useWallets } from '@/lib/dapp-kit-compat';
import { Button } from '@/components/ui/button';
import { Wallet, ChevronDown, LogOut, RefreshCw, Gift } from 'lucide-react';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { shortenAddress } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export function FreshConnectButton() {
  const currentAccount = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const wallets = useWallets();
  const { toast } = useToast();

  // Fetch bonus balance
  const { data: promotionData } = useQuery<{
    isActive: boolean;
    bonusBalance: number;
    totalBetUsd: number;
    thresholdUsd: number;
  }>({
    queryKey: ['/api/promotion/status', currentAccount?.address],
    queryFn: async () => {
      const res = await fetch(`/api/promotion/status?wallet=${currentAccount?.address}`);
      if (!res.ok) throw new Error('Failed to fetch promotion status');
      return res.json();
    },
    enabled: !!currentAccount?.address,
    refetchInterval: 30000,
  });

  // Log wallet detection for debugging
  useEffect(() => {
    console.log('[FreshConnectButton] Detected wallets:', wallets.map(w => w.name));
    console.log('[FreshConnectButton] Current account:', currentAccount?.address);
  }, [wallets, currentAccount]);

  // Open the full ConnectWalletModal (3-method detection, wallet-standard, window globals,
  // zkLogin). Always dispatch the global event — works for both Telegram and browser.
  const openWalletSelection = () => {
    console.log('[FreshConnectButton] Opening ConnectWalletModal, currentAccount:', currentAccount?.address);
    if (currentAccount) {
      // Already connected — disconnect first, then open modal for switching
      disconnect(undefined, {
        onSettled: () => {
          window.dispatchEvent(new Event('suibets:connect-wallet-required'));
        }
      });
    } else {
      window.dispatchEvent(new Event('suibets:connect-wallet-required'));
    }
  };

  // Handle disconnect
  const handleDisconnect = () => {
    disconnect(undefined, {
      onSuccess: () => {
        toast({
          title: "Wallet Disconnected",
          description: "Your wallet has been disconnected.",
        });
      }
    });
  };

  // If connected, show wallet dropdown
  if (currentAccount?.address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="border-cyan-500/50 bg-cyan-900/20 text-cyan-300 hover:bg-cyan-900/40 hover:border-cyan-400 hover:shadow-lg hover:shadow-cyan-500/30 font-medium transition-all duration-300"
            data-testid="button-wallet-connected"
          >
            <Wallet className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">{shortenAddress(currentAccount.address)}</span>
            <span className="sm:hidden">Wallet</span>
            <ChevronDown className="w-4 h-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="bg-[#0d1f23] border-cyan-800/50">
          <DropdownMenuLabel className="text-cyan-300">Connected Wallet</DropdownMenuLabel>
          <div className="px-2 py-2 text-xs text-cyan-400 font-mono">
            {shortenAddress(currentAccount.address)}
          </div>
          {promotionData && promotionData.bonusBalance > 0 && (
            <div className="mx-2 mb-2 p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-green-400" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-green-400/70 uppercase">Free Bet Balance</span>
                  <span className="text-green-400 font-bold text-sm">${promotionData.bonusBalance.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
          <DropdownMenuSeparator className="bg-cyan-800/30" />
          <DropdownMenuItem
            className="cursor-pointer text-white hover:bg-cyan-900/50"
            onClick={() => window.location.href = '/wallet-dashboard'}
          >
            <Wallet className="mr-2 h-4 w-4" />
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-cyan-800/30" />
          <DropdownMenuItem
            className="cursor-pointer text-white hover:bg-cyan-900/50"
            onClick={openWalletSelection}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Switch Wallet
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer text-red-400 hover:bg-red-900/30"
            onClick={handleDisconnect}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Not connected — button + Google zkLogin hint
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        onClick={openWalletSelection}
        className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold px-4 py-2 rounded-lg shadow-lg shadow-cyan-500/30 hover:shadow-cyan-400/50 transition-all duration-300"
        data-testid="button-connect-wallet"
      >
        <Wallet className="w-4 h-4 mr-2" />
        Connect Wallet
      </Button>
    </div>
  );
}
