import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';

export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

export class SuiHybridClient {
  private rpc: SuiJsonRpcClient;
  private gql: SuiGraphQLClient | null;
  private graphqlAvailable: boolean | null = null;
  private network: SuiNetwork;

  constructor(opts: {
    rpcUrl: string;
    graphqlUrl?: string;
    grpcUrl?: string;   // kept for API compat — gRPC removed, JSON-RPC used instead
    network: SuiNetwork;
  }) {
    this.network = opts.network;
    this.rpc = new SuiJsonRpcClient({ url: opts.rpcUrl, network: opts.network });
    this.gql = opts.graphqlUrl
      ? new SuiGraphQLClient({ url: opts.graphqlUrl, network: opts.network })
      : null;
  }

  private async probeGraphQL(): Promise<boolean> {
    if (!this.gql) return false;
    if (this.graphqlAvailable !== null) return this.graphqlAvailable;
    try {
      await this.gql.getReferenceGasPrice();
      this.graphqlAvailable = true;
      console.log('[SuiHybrid] GraphQL transport active');
      return true;
    } catch {
      this.graphqlAvailable = false;
      console.log('[SuiHybrid] GraphQL unavailable — using JSON-RPC');
      return false;
    }
  }

  getTransport(): string {
    if (this.graphqlAvailable === true) return 'graphql';
    return 'json-rpc';
  }

  getRpcClient(): SuiJsonRpcClient {
    return this.rpc;
  }

  getGraphQLClient(): SuiGraphQLClient | null {
    return this.gql;
  }

  async getObject(params: { id: string; options?: any }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        const include: any = {};
        if (params.options?.showContent) include.content = true;
        if (params.options?.showOwner) include.owner = true;
        if (params.options?.showPreviousTransaction) include.previousTransaction = true;
        if (params.options?.showBcs) include.objectBcs = true;
        if (params.options?.showDisplay) include.display = true;
        const result = await this.gql!.getObject({ objectId: params.id, include });
        return this.normalizeObjectResponse(result, params.id);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getObject failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getObject(params);
  }

  async getBalance(params: { owner: string; coinType?: string }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        return await this.gql!.getBalance(params);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getBalance failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getBalance(params);
  }

  async getCoins(params: { owner: string; coinType?: string; cursor?: string; limit?: number }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        const result = await this.gql!.listCoins({
          owner: params.owner,
          coinType: params.coinType,
          cursor: params.cursor,
          limit: params.limit,
        });
        return this.normalizeCoinsResponse(result);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getCoins failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getCoins(params);
  }

  async getOwnedObjects(params: { owner: string; filter?: any; options?: any; cursor?: string; limit?: number }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        const include: any = {};
        if (params.options?.showContent) include.content = true;
        if (params.options?.showOwner) include.owner = true;
        if (params.options?.showType) include.content = true;
        const result = await this.gql!.listOwnedObjects({
          owner: params.owner,
          filter: params.filter,
          include,
          cursor: params.cursor,
          limit: params.limit,
        });
        return this.normalizeOwnedObjectsResponse(result);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getOwnedObjects failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getOwnedObjects(params);
  }

  async getTransactionBlock(params: { digest: string; options?: any }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        const include: any = {};
        if (params.options?.showInput) include.input = true;
        if (params.options?.showEffects) include.effects = true;
        if (params.options?.showEvents) include.events = true;
        if (params.options?.showObjectChanges) include.objectChanges = true;
        if (params.options?.showBalanceChanges) include.balanceChanges = true;
        const result = await this.gql!.getTransaction({ digest: params.digest, include });
        return this.normalizeTransactionResponse(result);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getTransactionBlock failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getTransactionBlock(params);
  }

  async executeTransactionBlock(params: {
    transactionBlock: string | Uint8Array;
    signature: string | string[];
    options?: any;
    requestType?: string;
  }): Promise<any> {
    return this.rpc.executeTransactionBlock(params);
  }

  async queryEvents(params: { query: any; cursor?: any; limit?: number; order?: string }): Promise<any> {
    return this.rpc.queryEvents(params);
  }

  async getAllCoins(params: { owner: string; cursor?: string; limit?: number }): Promise<any> {
    return this.rpc.getAllCoins(params);
  }

  async getTotalSupply(params: { coinType: string }): Promise<any> {
    return this.rpc.getTotalSupply(params);
  }

  async getDynamicFields(params: { parentId: string; cursor?: string; limit?: number }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        const result = await this.gql!.listDynamicFields({
          parentId: params.parentId,
          cursor: params.cursor,
          limit: params.limit,
        });
        return this.normalizeDynamicFieldsResponse(result);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getDynamicFields failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getDynamicFields(params);
  }

  async resolveNameServiceNames(params: { address: string; cursor?: string; limit?: number }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        const name = await this.gql!.defaultNameServiceName({ address: params.address });
        return { data: name ? [name] : [], nextCursor: null, hasNextPage: false };
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL resolveNameServiceNames failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.resolveNameServiceNames(params);
  }

  async resolveNameServiceAddress(params: { name: string }): Promise<any> {
    return this.rpc.resolveNameServiceAddress(params);
  }

  async multiGetObjects(params: { ids: string[]; options?: any }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        const include: any = {};
        if (params.options?.showContent) include.content = true;
        if (params.options?.showOwner) include.owner = true;
        const result = await this.gql!.getObjects({ objectIds: params.ids, include });
        const objects = Array.isArray(result) ? result : (result?.objects || []);
        return objects.map((obj: any) => this.normalizeObjectResponse(obj, obj?.objectId || ''));
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL multiGetObjects failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.multiGetObjects(params);
  }

  async getReferenceGasPrice(): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        return await this.gql!.getReferenceGasPrice();
      } catch {}
    }
    return this.rpc.getReferenceGasPrice();
  }

  async getCoinMetadata(params: { coinType: string }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        return await this.gql!.getCoinMetadata(params);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getCoinMetadata failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getCoinMetadata(params);
  }

  async getAllBalances(params: { owner: string }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        return await this.gql!.listBalances(params);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL getAllBalances failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.getAllBalances(params);
  }

  async devInspectTransactionBlock(params: any): Promise<any> {
    return this.rpc.devInspectTransactionBlock(params);
  }

  async dryRunTransactionBlock(params: any): Promise<any> {
    return this.rpc.dryRunTransactionBlock(params);
  }

  async waitForTransaction(params: { digest: string; timeout?: number; pollInterval?: number }): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        return await this.gql!.waitForTransaction({ digest: params.digest });
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL waitForTransaction failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.waitForTransaction(params);
  }

  async signAndExecuteTransaction(params: any): Promise<any> {
    if (await this.probeGraphQL()) {
      try {
        return await this.gql!.signAndExecuteTransaction(params);
      } catch (e: any) {
        console.warn('[SuiHybrid] GraphQL signAndExecuteTransaction failed:', e.message?.substring(0, 100));
      }
    }
    return this.rpc.signAndExecuteTransaction(params);
  }

  async getLatestCheckpointSequenceNumber(): Promise<any> {
    return this.rpc.getLatestCheckpointSequenceNumber();
  }

  async getChainIdentifier(): Promise<any> {
    return this.rpc.getChainIdentifier();
  }

  async getProtocolConfig(params?: any): Promise<any> {
    return this.rpc.getProtocolConfig(params);
  }

  async getStakes(params: { owner: string }): Promise<any> {
    return this.rpc.getStakes(params);
  }

  async getNormalizedMoveModule(params: { package: string; module: string }): Promise<any> {
    return this.rpc.getNormalizedMoveModule(params);
  }

  async call(method: string, params: any[]): Promise<any> {
    return this.rpc.call(method, params);
  }

  private normalizeObjectResponse(gqlObj: any, objectId: string): any {
    if (!gqlObj) return { data: null, error: { code: 'notExists' } };
    if (gqlObj.data) return gqlObj;
    return { data: gqlObj };
  }

  private normalizeCoinsResponse(gqlResult: any): any {
    if (gqlResult?.data) return gqlResult;
    return {
      data: gqlResult?.coins || gqlResult || [],
      nextCursor: gqlResult?.cursor || null,
      hasNextPage: gqlResult?.hasNextPage || false,
    };
  }

  private normalizeOwnedObjectsResponse(gqlResult: any): any {
    if (gqlResult?.data) return gqlResult;
    return {
      data: gqlResult?.objects || gqlResult || [],
      nextCursor: gqlResult?.cursor || null,
      hasNextPage: gqlResult?.hasNextPage || false,
    };
  }

  private normalizeTransactionResponse(gqlResult: any): any {
    if (!gqlResult) return null;
    return gqlResult;
  }

  private normalizeDynamicFieldsResponse(gqlResult: any): any {
    if (gqlResult?.data) return gqlResult;
    return {
      data: gqlResult?.dynamicFields || gqlResult || [],
      nextCursor: gqlResult?.cursor || null,
      hasNextPage: gqlResult?.hasNextPage || false,
    };
  }
}
