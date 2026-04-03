import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { getJsonRpcUrl, getDefaultNetwork } from './suiRpcConfig';

type DAppKitNetwork = 'mainnet' | 'testnet' | 'devnet';
const SUPPORTED_NETWORKS: DAppKitNetwork[] = ['mainnet', 'testnet', 'devnet'];

function createSuiClient(network: DAppKitNetwork) {
  const rpcUrl = network === 'mainnet'
    ? getJsonRpcUrl('mainnet')
    : getJsonRpcFullnodeUrl(network);
  return new SuiJsonRpcClient({ url: rpcUrl, network });
}

const defaultNet = getDefaultNetwork();
const safeDefault: DAppKitNetwork = SUPPORTED_NETWORKS.includes(defaultNet as DAppKitNetwork)
  ? (defaultNet as DAppKitNetwork)
  : 'mainnet';

export const dAppKit = createDAppKit({
  networks: SUPPORTED_NETWORKS,
  createClient(network) {
    return createSuiClient(network);
  },
  defaultNetwork: safeDefault,
  autoConnect: false,
});

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
