import { ReactNode } from 'react';
import { WalletProvider, SuiClientProvider } from '@mysten/dapp-kit';

const NETWORKS = {
  mainnet: { url: 'https://fullnode.mainnet.sui.io:443' },
} as const;

interface SuiDappKitProviderProps {
  children: ReactNode;
}

export const SuiDappKitProvider = ({ children }: SuiDappKitProviderProps) => {
  return (
    <SuiClientProvider networks={NETWORKS} defaultNetwork="mainnet">
      <WalletProvider autoConnect>
        {children}
      </WalletProvider>
    </SuiClientProvider>
  );
};
