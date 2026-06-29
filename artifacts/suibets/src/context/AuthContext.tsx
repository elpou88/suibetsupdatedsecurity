import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types';
import { apiRequest } from '@/lib/queryClient';
import { useCurrentAccount, useDisconnectWallet } from '@/lib/dapp-kit-compat';
import { useZkLogin } from '@/context/ZkLoginContext';
import { usePasskey } from '@/context/PasskeyContext';

type WalletType = string;

const AuthContext = createContext<{
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  walletAddress: string | null;
  authSource: 'wallet' | 'zklogin' | 'passkey' | null;
  disconnectWallet: () => void;
  login: (userData: User) => void;
  updateWalletBalance: (amount: number, currency: string) => void;
}>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  walletAddress: null,
  authSource: null,
  disconnectWallet: () => {},
  login: () => {},
  updateWalletBalance: () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // Holds address from wallets connected via window globals (e.g. Nightly direct)
  // when dapp-kit's Wallet Standard registration hasn't fired.
  const [directWalletAddress, setDirectWalletAddress] = useState<string | null>(null);
  
  const currentAccount = useCurrentAccount();
  const { mutate: disconnectDappKit } = useDisconnectWallet();
  
  const { zkLoginAddress, isZkLoginActive, logout: zkLogout } = useZkLogin();
  const { passkeyAddress, hasPasskey, clearPasskey } = usePasskey();

  // Listen for direct wallet connections (Nightly / window globals) that bypass dapp-kit
  useEffect(() => {
    const handler = (e: Event) => {
      const address = (e as CustomEvent<{ address: string }>).detail?.address;
      if (address) {
        console.log('[AuthContext] Direct wallet connected via event:', address);
        setDirectWalletAddress(address);
      }
    };
    window.addEventListener('suibets:direct-wallet-connected', handler);
    return () => window.removeEventListener('suibets:direct-wallet-connected', handler);
  }, []);

  // Clear direct address once dapp-kit picks up the connection (avoids double-count)
  useEffect(() => {
    if (currentAccount?.address && directWalletAddress) {
      setDirectWalletAddress(null);
    }
  }, [currentAccount?.address, directWalletAddress]);

  // Derive the active address and its source — passkey < direct < zklogin < dapp-kit wallet
  // (dapp-kit takes priority so a user who also has a browser wallet can still switch)
  const walletAddress: string | null =
    currentAccount?.address ??
    (isZkLoginActive ? zkLoginAddress : null) ??
    (hasPasskey ? passkeyAddress : null) ??
    directWalletAddress ??
    null;

  const authSource: 'wallet' | 'zklogin' | 'passkey' | null =
    currentAccount?.address
      ? 'wallet'
      : isZkLoginActive
      ? 'zklogin'
      : hasPasskey && passkeyAddress
      ? 'passkey'
      : directWalletAddress
      ? 'wallet'
      : null;

  const isAuthenticated = !!walletAddress;

  useEffect(() => {
    localStorage.removeItem('wallet_address');
    localStorage.removeItem('wallet_type');
    localStorage.removeItem('sui-dapp-kit:wallet-connection-info');
    localStorage.removeItem('@mysten/wallet-kit:lastWallet');
  }, []);

  useEffect(() => {
    const activeAddress =
      currentAccount?.address ??
      (isZkLoginActive ? zkLoginAddress : null) ??
      (hasPasskey ? passkeyAddress : null) ??
      directWalletAddress ??
      null;

    if (activeAddress) {
      const source = currentAccount?.address
        ? 'wallet'
        : isZkLoginActive
        ? 'zklogin'
        : directWalletAddress
        ? 'wallet'
        : 'passkey';
      console.log(`[AuthContext] Connected via ${source}:`, activeAddress);

      const minimalUser: User = {
        id: 0,
        username: activeAddress.substring(0, 8),
        walletAddress: activeAddress,
        walletType: source === 'zklogin' ? 'zklogin' : source === 'passkey' ? 'passkey' : 'sui',
        createdAt: new Date().toISOString(),
        balance: { SUI: 0, SBETS: 0 }
      };
      setUser(minimalUser);

      apiRequest('POST', '/api/wallet/connect', {
        address: activeAddress,
        walletType: source === 'zklogin' ? 'zklogin' : source === 'passkey' ? 'passkey' : 'sui'
      })
        .then(res => res.json())
        .then(userData => {
          console.log('[AuthContext] Server sync complete:', userData);
          if (userData && userData.walletAddress) {
            setUser(userData);
          }

          const storedRefCode = localStorage.getItem('suibets_referral_code');
          if (storedRefCode && activeAddress) {
            console.log('[AuthContext] Tracking referral from code:', storedRefCode);
            fetch('/api/referral/track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                referralCode: storedRefCode,
                referredWallet: activeAddress
              })
            })
              .then(r => r.json())
              .then(result => {
                if (result.success) {
                  console.log('[AuthContext] Referral tracked successfully');
                  localStorage.removeItem('suibets_referral_code');
                } else {
                  console.log('[AuthContext] Referral already tracked or invalid');
                }
              })
              .catch(e => console.warn('[AuthContext] Referral tracking error:', e));
          }
        })
        .catch(err => {
          console.error('[AuthContext] Server sync error (keeping minimal user):', err);
        });
    } else {
      console.log('[AuthContext] No active connection');
      setUser(null);
    }
  }, [currentAccount?.address, zkLoginAddress, isZkLoginActive, passkeyAddress, hasPasskey, directWalletAddress]);

  const disconnectWallet = () => {
    console.log('[AuthContext] Disconnecting');
    setUser(null);
    setDirectWalletAddress(null);
    if (currentAccount?.address) {
      disconnectDappKit();
    }
    if (isZkLoginActive) {
      zkLogout();
    }
    if (hasPasskey) {
      clearPasskey();
    }
  };
  
  const login = (userData: User) => {
    setUser(userData);
  };
  
  const updateWalletBalance = (amount: number, currency: string) => {
    if (!user) return;
    
    setUser(prevUser => {
      if (!prevUser) return null;
      
      const currentBalance = prevUser.balance && typeof prevUser.balance === 'object' 
        ? prevUser.balance 
        : { SUI: 0, SBETS: 0 };
      
      const newBalance = { ...currentBalance };
      
      if (currency === 'SUI') {
        newBalance.SUI = (newBalance.SUI || 0) + amount;
      } else if (currency === 'SBETS') {
        newBalance.SBETS = (newBalance.SBETS || 0) + amount;
      }
      
      return {
        ...prevUser,
        balance: newBalance
      };
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        walletAddress,
        authSource,
        disconnectWallet,
        login,
        updateWalletBalance,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
