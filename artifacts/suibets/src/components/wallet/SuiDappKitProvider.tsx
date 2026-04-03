import { ReactNode, useEffect } from 'react';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from '@/lib/dapp-kit';

interface SuiDappKitProviderProps {
  children: ReactNode;
}

export const SuiDappKitProvider = ({ children }: SuiDappKitProviderProps) => {
  useEffect(() => {
    try {
      localStorage.removeItem('sui-dapp-kit:wallet-connection-info');
      localStorage.removeItem('@mysten/wallet-kit:lastWallet');
      localStorage.removeItem('suiWallet');
    } catch (e) {
      console.log('Could not clear wallet cache');
    }
  }, []);

  return (
    <DAppKitProvider dAppKit={dAppKit}>
      {children}
    </DAppKitProvider>
  );
};
