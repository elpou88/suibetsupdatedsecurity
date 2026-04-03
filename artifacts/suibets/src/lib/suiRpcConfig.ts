import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

const DEFAULT_NETWORK: SuiNetwork = (import.meta.env.VITE_SUI_NETWORK as SuiNetwork) || 'mainnet';

const GRAPHQL_URLS: Record<string, string> = {
  mainnet: import.meta.env.VITE_SUI_GRAPHQL_URL || 'https://sui-mainnet.mystenlabs.com/graphql',
  testnet: 'https://sui-testnet.mystenlabs.com/graphql',
};

export function getJsonRpcUrl(network?: SuiNetwork): string {
  const net = network || DEFAULT_NETWORK;
  const envUrl = import.meta.env.VITE_SUI_RPC_URL;
  if (envUrl && net === 'mainnet') return envUrl;
  return getJsonRpcFullnodeUrl(net);
}

export function getGraphQLUrl(network?: SuiNetwork): string | undefined {
  const net = network || DEFAULT_NETWORK;
  return GRAPHQL_URLS[net];
}

export function getDefaultNetwork(): SuiNetwork {
  return DEFAULT_NETWORK;
}
