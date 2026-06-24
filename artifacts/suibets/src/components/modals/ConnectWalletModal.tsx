import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, WalletIcon, RefreshCw, Fingerprint, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  useCurrentAccount, 
  useConnectWallet,
  useWallets,
} from '@/lib/dapp-kit-compat';
import { getWallets } from '@wallet-standard/app';
import { usePasskey } from '@/context/PasskeyContext';

interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface WalletInfo {
  name: string;
  icon?: string;
  wallet: any;
  source: 'standard' | 'dappkit' | 'direct';
}

export function ConnectWalletModal({ isOpen, onClose }: ConnectWalletModalProps) {
  const { toast } = useToast();
  const { isSupported: passkeySupported, hasPasskey, createPasskey, isCreating: passkeyCreating } = usePasskey();
  const [connecting, setConnecting] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allWallets, setAllWallets] = useState<WalletInfo[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  
  // Single ref to track connection completion - prevents duplicate processing
  const connectionHandledRef = useRef(false);
  const lastProcessedAddressRef = useRef<string | null>(null);

  const currentAccount = useCurrentAccount();
  const dappkitWallets = useWallets();
  const dappkitWalletsRef = useRef(dappkitWallets);
  useEffect(() => { dappkitWalletsRef.current = dappkitWallets; }, [dappkitWallets]);
  const { mutate: connectDappKit } = useConnectWallet();

  // Unified connection finalization - ONLY place that shows toast and closes modal
  const handleConnectionSuccess = useCallback(async (address: string, walletName: string) => {
    // Prevent duplicate handling
    if (connectionHandledRef.current || lastProcessedAddressRef.current === address) {
      console.log('Connection already handled for:', address);
      return;
    }
    
    connectionHandledRef.current = true;
    lastProcessedAddressRef.current = address;
    
    console.log('=== CONNECTION SUCCESS ===');
    console.log('Address:', address);
    console.log('Wallet:', walletName);

    // Notify AuthContext about this connection — critical for wallets connected
    // via window globals (e.g. Nightly direct) that bypass dapp-kit's Wallet Standard.
    // dapp-kit connections will also fire this; AuthContext deduplicates safely.
    window.dispatchEvent(
      new CustomEvent('suibets:direct-wallet-connected', { detail: { address } })
    );
    
    // Show single success toast
    toast({
      title: "Wallet Connected",
      description: `Connected: ${address.substring(0, 8)}...${address.slice(-6)}`,
    });
    
    // Clean up UI state
    setConnecting(false);
    setConnectingWallet(null);
    setError(null);
    
    // Close modal
    onClose();
  }, [toast, onClose]);

  // Detect all available wallets
  // NOTE: Uses dappkitWalletsRef (not dappkitWallets directly) so this callback is
  // stable across renders and won't cause an infinite re-detection loop.
  const detectAllWallets = useCallback(() => {
    const walletMap = new Map<string, WalletInfo>();
    
    // 1. Check dapp-kit wallets first (most reliable)
    dappkitWalletsRef.current.forEach((wallet) => {
      console.log('Dapp-kit wallet found:', wallet.name);
      walletMap.set(wallet.name, {
        name: wallet.name,
        icon: wallet.icon,
        wallet: wallet,
        source: 'dappkit'
      });
    });
    
    // 2. Check wallet-standard API — only include wallets with Sui-specific features
    // or that are on a Sui chain.  Do NOT include 'standard:connect' alone because
    // Ethereum wallets (e.g. MetaMask) implement it without supporting Sui.
    try {
      const walletsApi = getWallets();
      const registeredWallets = walletsApi.get();
      
      registeredWallets.forEach((wallet: any) => {
        if (walletMap.has(wallet.name)) return; // Skip if already added via dapp-kit
        
        const hasSuiFeature = wallet.features?.['sui:signAndExecuteTransactionBlock'] ||
                              wallet.features?.['sui:signTransactionBlock'] ||
                              wallet.features?.['sui:signAndExecuteTransaction'] ||
                              wallet.features?.['sui:signTransaction'] ||
                              wallet.chains?.some((c: string) => c.includes('sui'));
        
        const isKnownWallet = ['slush', 'nightly', 'suiet', 'ethos', 'martian', 'solflare'].some(n => 
          wallet.name?.toLowerCase().includes(n));
        
        if (hasSuiFeature || isKnownWallet) {
          console.log('Wallet-standard wallet found:', wallet.name);
          walletMap.set(wallet.name, {
            name: wallet.name,
            icon: wallet.icon,
            wallet: wallet,
            source: 'standard'
          });
        }
      });
    } catch (e) {
      console.log('Wallet-standard API not available');
    }
    
    // 3. Check window globals as fallback - comprehensive Nightly detection
    const win = window as any;
    const directWallets = [
      { check: () => win.slush, name: 'Slush' },
      { check: () => win.suiWallet, name: 'Sui Wallet' },
      { check: () => win.nightly?.sui || win.nightly?.wallets?.sui || win.nightly?.wallets?.SUI || win.nightly, name: 'Nightly' },
      { check: () => win.suiet, name: 'Suiet' },
      { check: () => win.ethos, name: 'Ethos Wallet' },
      { check: () => win.martian?.sui || win.martian, name: 'Martian Sui Wallet' },
      { check: () => win.solflare?.sui || win.solflare, name: 'Solflare' },
    ];
    
    directWallets.forEach(({ check, name }) => {
      try {
        const walletObj = check();
        if (walletObj && !walletMap.has(name)) {
          console.log('Window wallet found:', name);
          walletMap.set(name, {
            name: name,
            wallet: walletObj,
            source: 'direct'
          });
        }
      } catch {}
    });
    
    const walletList = Array.from(walletMap.values());
    console.log('Total wallets detected:', walletList.length, walletList.map(w => w.name));
    setAllWallets(walletList);
    setHasScanned(true);
    return walletList;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — reads dappkitWallets via ref to avoid infinite re-detection loop

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setHasScanned(false);
      return;
    }
    if (isOpen) {
      // Reset refs when modal opens to allow new connections
      connectionHandledRef.current = false;
      lastProcessedAddressRef.current = null;
      setError(null);
      setConnecting(false);
      setConnectingWallet(null);
      setHasScanned(false);
      
      // Detect wallets
      detectAllWallets();
      
      // Re-detect after delays to catch late-loading extensions (up to 5 s)
      const timers = [200, 800, 1500, 3000, 5000].map(delay => 
        setTimeout(detectAllWallets, delay)
      );
      
      // Listen for new wallet registrations
      try {
        const walletsApi = getWallets();
        const unsubscribe = walletsApi.on('register', detectAllWallets);
        return () => {
          timers.forEach(clearTimeout);
          unsubscribe();
        };
      } catch {
        return () => timers.forEach(clearTimeout);
      }
    }
  }, [isOpen, detectAllWallets]);

  // Watch for dapp-kit connection changes - only fires when we initiated a connection.
  // Guarding on `connecting` prevents the auto-connect (autoConnect: true) from
  // closing the modal the moment it opens if the user had a previous session.
  useEffect(() => {
    if (!isOpen) return;
    if (!connecting) return; // Only handle account changes we triggered ourselves

    const address = currentAccount?.address;
    if (!address) return;

    if (connectionHandledRef.current || lastProcessedAddressRef.current === address) {
      return;
    }

    console.log('Dapp-kit currentAccount changed while connecting:', address);
    handleConnectionSuccess(address, connectingWallet || 'sui');
  }, [currentAccount?.address, isOpen, connecting, connectingWallet, handleConnectionSuccess]);

  // Main connection function
  const connectToWallet = async (walletInfo: WalletInfo) => {
    if (connecting) return;
    
    setConnecting(true);
    setConnectingWallet(walletInfo.name);
    setError(null);
    
    console.log('Attempting to connect:', walletInfo.name, 'source:', walletInfo.source);
    
    try {
      // METHOD 1: Use dapp-kit if wallet is available there
      const dappkitWallet = dappkitWalletsRef.current.find(w => 
        w.name === walletInfo.name || 
        w.name.toLowerCase().includes(walletInfo.name.toLowerCase())
      );
      
      if (dappkitWallet) {
        console.log('Connecting via dapp-kit...');
        connectDappKit({ wallet: dappkitWallet }, {
          onSuccess: (result: any) => {
            console.log('Dapp-kit connect mutation succeeded', result);
            // Try to extract address from result directly (belt-and-suspenders for wallets
            // where React state updates after the promise resolves).
            const directAddress =
              result?.accounts?.[0]?.address ||
              result?.account?.address ||
              currentAccount?.address;
            if (directAddress && !connectionHandledRef.current) {
              handleConnectionSuccess(directAddress, walletInfo.name);
            }
            // The useEffect watching currentAccount (with connecting guard) also handles this.
          },
          onError: (err: any) => {
            console.error('Dapp-kit connect failed:', err);
            tryDirectConnection(walletInfo);
          }
        });
        return;
      }
      
      // METHOD 2: Use wallet-standard connect
      if (walletInfo.source === 'standard' && walletInfo.wallet?.features?.['standard:connect']) {
        console.log('Connecting via wallet-standard...');
        try {
          const result = await walletInfo.wallet.features['standard:connect'].connect();
          const address = result?.accounts?.[0]?.address;
          if (address) {
            await handleConnectionSuccess(address, walletInfo.name);
            return;
          }
        } catch (e) {
          console.error('Wallet-standard connect failed:', e);
        }
      }
      
      // METHOD 3: Direct window connection
      await tryDirectConnection(walletInfo);
      
    } catch (err: any) {
      console.error('Connection error:', err);
      setError(err?.message || "Connection failed. Please try again.");
      setConnecting(false);
      setConnectingWallet(null);
    }
  };
  
  // Direct connection via window globals
  const tryDirectConnection = async (walletInfo: WalletInfo) => {
    const win = window as any;
    const name = walletInfo.name.toLowerCase();
    
    console.log('Trying direct connection for:', name);
    
    try {
      let address: string | null = null;
      
      // Slush / Sui Wallet
      if (name.includes('slush') || name.includes('sui wallet')) {
        const wallet = win.slush || win.suiWallet;
        if (wallet) {
          try { await wallet.requestPermissions?.(); } catch {}
          const accounts = await wallet.getAccounts?.() || [];
          if (accounts.length > 0) {
            address = accounts[0];
          } else {
            const result = await wallet.connect?.();
            address = result?.accounts?.[0]?.address;
          }
        }
      }
      // Nightly - comprehensive detection
      else if (name.includes('nightly')) {
        const nightly = win.nightly;
        if (nightly) {
          // Try multiple Nightly connection methods
          const suiWallet = nightly.sui || nightly.wallets?.sui || nightly.wallets?.SUI;
          if (suiWallet) {
            try {
              const result = await suiWallet.connect();
              address = result?.accounts?.[0]?.address || result?.publicKey;
            } catch (e) {
              console.log('Nightly sui.connect failed, trying alternatives');
            }
          }
          // Fallback to generic nightly.connect
          if (!address && nightly.connect) {
            try {
              const result = await nightly.connect({ network: 'sui' });
              address = result?.accounts?.[0]?.address || result?.publicKey || result?.address;
            } catch (e) {
              console.log('Nightly generic connect failed:', e);
            }
          }
        }
      }
      // Suiet
      else if (name.includes('suiet')) {
        const wallet = win.suiet;
        if (wallet) {
          try { await wallet.requestPermissions?.(); } catch {}
          const result = await wallet.connect?.();
          address = result?.accounts?.[0]?.address || (await wallet.getAccounts?.())?.[0];
        }
      }
      // Ethos
      else if (name.includes('ethos')) {
        const wallet = win.ethos;
        if (wallet) {
          const result = await wallet.connect?.();
          address = result?.accounts?.[0]?.address || result?.address;
        }
      }
      // Martian
      else if (name.includes('martian')) {
        const wallet = win.martian?.sui || win.martian;
        if (wallet) {
          const result = await wallet.connect?.();
          address = result?.accounts?.[0]?.address || result?.address;
        }
      }
      // Solflare
      else if (name.includes('solflare')) {
        const wallet = win.solflare;
        if (wallet?.sui) {
          const result = await wallet.sui.connect?.();
          address = result?.accounts?.[0]?.address;
        } else if (wallet) {
          await wallet.connect?.();
          address = wallet.publicKey?.toString?.();
        }
      }
      
      if (address) {
        await handleConnectionSuccess(address, walletInfo.name);
      } else {
        throw new Error(`Could not get address from ${walletInfo.name}`);
      }
    } catch (err: any) {
      console.error('Direct connection failed:', err);
      setError(err?.message || `Failed to connect to ${walletInfo.name}`);
      setConnecting(false);
      setConnectingWallet(null);
    }
  };

  // Passkey / biometric connect
  const handlePasskeyConnect = async () => {
    if (!passkeySupported) {
      setError('Your browser or device does not support passkeys (WebAuthn). Try Chrome, Safari, or Edge on a device with biometrics.');
      return;
    }
    setConnecting(true);
    setConnectingWallet('passkey');
    setError(null);
    try {
      const address = await createPasskey();
      if (address) {
        await handleConnectionSuccess(address, 'Face ID / Touch ID');
      } else {
        setConnecting(false);
        setConnectingWallet(null);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Passkey setup failed');
      setConnecting(false);
      setConnectingWallet(null);
    }
  };

  // Quick connect - auto-select best wallet
  const handleQuickConnect = async () => {
    const wallets = detectAllWallets();
    
    if (wallets.length === 0) {
      setError("No wallet found. Please install Slush, Nightly, or Suiet wallet extension.");
      return;
    }
    
    // Priority order
    const priority = ['slush', 'sui wallet', 'nightly', 'suiet'];
    const bestWallet = wallets.find(w => 
      priority.some(p => w.name.toLowerCase().includes(p))
    ) || wallets[0];
    
    await connectToWallet(bestWallet);
  };

  const displayWallets = allWallets.filter(w => 
    w.name !== 'Stashed' && !w.name.toLowerCase().includes('stashed')
  );

  const noWalletDetected = hasScanned && displayWallets.length === 0;

  const SUI_WALLETS = [
    { name: 'Slush', url: 'https://slush.app', desc: 'Official Sui wallet by Mysten Labs' },
    { name: 'Nightly', url: 'https://nightly.app', desc: 'Multi-chain, works on all browsers' },
    { name: 'Suiet', url: 'https://suiet.app', desc: 'Open-source Sui wallet' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Sign In to SuiBets</DialogTitle>
          <DialogDescription>
            Connect your Sui wallet to start betting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">

          {/* ── No extension detected banner ── */}
          {noWalletDetected && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-900/20 p-4">
              <p className="text-amber-300 font-semibold text-sm mb-3 flex items-center gap-2">
                <Download className="h-4 w-4 flex-shrink-0" />
                No Sui wallet extension detected in this browser
              </p>
              <div className="space-y-2">
                {SUI_WALLETS.map(({ name, url, desc }) => (
                  <a
                    key={name}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between w-full px-3 py-2 bg-[#112225] hover:bg-cyan-900/30 border border-cyan-800/30 hover:border-cyan-500/50 rounded-lg transition-all"
                  >
                    <div>
                      <span className="text-white text-sm font-medium">{name}</span>
                      <span className="block text-xs text-gray-400">{desc}</span>
                    </div>
                    <span className="text-xs text-cyan-400">Install →</span>
                  </a>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3 text-center">
                After installing, refresh this page and click Connect Wallet again.
              </p>
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={detectAllWallets}
                  className="text-cyan-400 border-cyan-500/50"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Scan Again
                </Button>
              </div>
            </div>
          )}

          {/* ── Detected wallet list ── */}
          {displayWallets.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 text-center">
                Detected wallets ({displayWallets.length}):
              </p>
              {displayWallets.map((walletInfo) => (
                <Button
                  key={walletInfo.name}
                  variant="outline"
                  className="w-full justify-start py-3 hover:bg-cyan-900/20 hover:border-cyan-500/50"
                  onClick={() => connectToWallet(walletInfo)}
                  disabled={connecting}
                  data-testid={`wallet-${walletInfo.name.toLowerCase().replace(/\s/g, '-')}`}
                >
                  {connectingWallet === walletInfo.name ? (
                    <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                  ) : walletInfo.icon ? (
                    <img
                      src={walletInfo.icon}
                      alt={walletInfo.name}
                      className="w-6 h-6 mr-3 rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <WalletIcon className="w-6 h-6 mr-3" />
                  )}
                  <span className="text-white">{walletInfo.name}</span>
                  <span className="ml-auto text-xs text-green-400">Detected</span>
                </Button>
              ))}
            </div>
          )}

          {/* ── Quick Connect (only shown when wallets exist) ── */}
          {displayWallets.length > 0 && (
            <div className="w-full p-4 bg-gradient-to-r from-cyan-900/30 to-blue-900/30 rounded-lg border border-cyan-500/30">
              <Button
                onClick={handleQuickConnect}
                disabled={connecting}
                className="w-full bg-[#00FFFF] hover:bg-[#00DDDD] text-black font-bold py-4 text-lg"
                data-testid="button-quick-connect"
              >
                {connecting && !connectingWallet ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <WalletIcon className="mr-2 h-5 w-5" />
                    Quick Connect
                  </>
                )}
              </Button>
            </div>
          )}

          {/* ── Scanning spinner (shown before first detection completes) ── */}
          {!hasScanned && (
            <div className="flex items-center justify-center gap-2 py-2 text-gray-400 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning for wallets…
            </div>
          )}

          {/* ── Passkey alternative ── */}
          {passkeySupported && (
            <Button
              variant="outline"
              className="w-full py-3 hover:bg-purple-900/20 hover:border-purple-500/50 border-gray-700"
              onClick={handlePasskeyConnect}
              disabled={connecting || passkeyCreating}
              data-testid="button-passkey"
            >
              {connectingWallet === 'passkey' ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Setting up biometrics…
                </>
              ) : (
                <>
                  <Fingerprint className="mr-2 h-5 w-5 text-purple-400" />
                  <span className="text-white">Face ID / Touch ID</span>
                  <span className="ml-auto text-xs text-purple-400">Passkey</span>
                </>
              )}
            </Button>
          )}

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg">
              <p className="text-red-400 text-sm flex items-center">
                <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                {error}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
