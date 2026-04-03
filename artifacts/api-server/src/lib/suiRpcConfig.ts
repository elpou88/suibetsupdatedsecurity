import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { SuiHybridClient, type SuiNetwork } from './suiHybridClient';

export type { SuiNetwork } from './suiHybridClient';

const DEFAULT_NETWORK: SuiNetwork = (process.env.SUI_NETWORK as SuiNetwork) || 'mainnet';

const GRPC_URLS: Record<string, string> = {
  mainnet: process.env.SUI_GRPC_URL || 'https://grpc.mainnet.sui.io:443',
  testnet: process.env.SUI_GRPC_TESTNET_URL || 'https://grpc.testnet.sui.io:443',
};

const JSON_RPC_URLS: Record<SuiNetwork, string> = {
  mainnet: process.env.SUI_RPC_URL || getJsonRpcFullnodeUrl('mainnet'),
  testnet: process.env.SUI_TESTNET_RPC_URL || getJsonRpcFullnodeUrl('testnet'),
  devnet: process.env.SUI_DEVNET_RPC_URL || getJsonRpcFullnodeUrl('devnet'),
  localnet: 'http://127.0.0.1:9000',
};

const GRAPHQL_URLS: Record<string, string> = {
  mainnet: process.env.SUI_GRAPHQL_URL || 'https://sui-mainnet.mystenlabs.com/graphql',
  testnet: process.env.SUI_GRAPHQL_TESTNET_URL || 'https://sui-testnet.mystenlabs.com/graphql',
};

export function getJsonRpcUrl(network?: SuiNetwork): string {
  return JSON_RPC_URLS[network || DEFAULT_NETWORK];
}

export function getGraphQLUrl(network?: SuiNetwork): string {
  const net = network || DEFAULT_NETWORK;
  return GRAPHQL_URLS[net] || GRAPHQL_URLS['mainnet'];
}

export function getGrpcUrl(network?: SuiNetwork): string {
  const net = network || DEFAULT_NETWORK;
  return GRPC_URLS[net] || GRPC_URLS['mainnet'];
}

export function getDefaultNetwork(): SuiNetwork {
  return DEFAULT_NETWORK;
}

export async function suiJsonRpc(method: string, params: any[]): Promise<any> {
  const url = getJsonRpcUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

let _clients: Record<string, SuiHybridClient> = {};
let _graphqlClients: Record<string, SuiGraphQLClient> = {};

export function getSuiClient(network?: SuiNetwork): SuiHybridClient {
  const net = network || DEFAULT_NETWORK;
  if (_clients[net]) return _clients[net];

  const client = new SuiHybridClient({
    rpcUrl: getJsonRpcUrl(net),
    graphqlUrl: GRAPHQL_URLS[net] || undefined,
    grpcUrl: GRPC_URLS[net] || undefined,
    network: net,
  });
  _clients[net] = client;
  return client;
}

export function getSuiGraphQLClient(network?: SuiNetwork): SuiGraphQLClient {
  const net = network || DEFAULT_NETWORK;
  if (_graphqlClients[net]) return _graphqlClients[net];

  const client = new SuiGraphQLClient({ url: getGraphQLUrl(net), network: net });
  _graphqlClients[net] = client;
  return client;
}

console.log(`[SuiRPC] Network: ${DEFAULT_NETWORK}`);
console.log(`[SuiRPC] JSON-RPC: ${getJsonRpcUrl()}`);
console.log(`[SuiRPC] GraphQL:  ${getGraphQLUrl()}`);
console.log(`[SuiRPC] gRPC:     ${getGrpcUrl()}`);
console.log(`[SuiRPC] Transport: GraphQL → gRPC → JSON-RPC (cascade fallback)`);
