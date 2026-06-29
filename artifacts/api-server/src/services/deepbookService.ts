/**
 * deepbookService.ts
 *
 * Full @mysten/deepbook-v3 wrapper with SBETS/SUI pool support:
 *   • SBETS coin config + permissionless pool creation
 *   • Balance manager deposit / withdraw for SUI & SBETS
 *   • Bet-as-limit-order: odds → implied probability → DeepBook price
 *   • Read-only depth feeds: Level2TicksFromMid, Level2Range, mid-price, vault balances
 *   • Transaction builders: limit/market order, cancel, create balance manager
 *
 * All depth/price data cached 10 s. TX builders return base64 BCS bytes for wallet signing.
 */

import {
  DeepBookClient,
  mainnetPools,
  mainnetCoins,
  mainnetPackageIds,
  OrderType,
  SelfMatchingOptions,
  POOL_CREATION_FEE_DEEP,
} from '@mysten/deepbook-v3';
import { Transaction } from '@mysten/sui/transactions';
import { getSuiClient } from '../lib/suiRpcConfig';

// ── SBETS coin config ──────────────────────────────────────────────────────────

const SBETS_PKG = (process.env.SBETS_TOKEN_ADDRESS ?? '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502').split('::')[0];
export const SBETS_COIN_TYPE = `${SBETS_PKG}::sbets::SBETS`;
const SBETS_SCALAR = 1_000_000_000; // 9 decimals — standard Sui token

/** Returns the on-chain SBETS/SUI pool object ID (set after pool creation). */
export function getSbetsSuiPoolId(): string | null {
  return process.env.DEEPBOOK_SBETS_SUI_POOL_ID ?? null;
}

/** Returns coins config including SBETS. */
function getCoinsConfig(): Record<string, any> {
  return {
    ...mainnetCoins,
    SBETS: {
      address: SBETS_COIN_TYPE,
      type:    SBETS_COIN_TYPE,
      scalar:  SBETS_SCALAR,
    },
  };
}

/** Returns pools config — adds SBETS_SUI when env var is set. */
function getPoolsConfig(): Record<string, any> {
  const pools: Record<string, any> = { ...mainnetPools };
  const id = getSbetsSuiPoolId();
  if (id) {
    pools['SBETS_SUI'] = { address: id, baseCoin: 'SBETS', quoteCoin: 'SUI' };
  }
  return pools;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, CacheEntry<any>>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);
  return fn().then(data => {
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  });
}

// ── Client factory ─────────────────────────────────────────────────────────────

function getDeepBookSuiClient(): any {
  const hybrid = getSuiClient() as any;
  if (typeof hybrid.getRpcClient === 'function') return hybrid.getRpcClient();
  return hybrid;
}

function makeClient(address?: string, balanceManagers?: Record<string, { address: string }>): DeepBookClient {
  return new DeepBookClient({
    client: getDeepBookSuiClient(),
    address: address ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
    network: 'mainnet',
    coins: getCoinsConfig(),
    pools: getPoolsConfig(),
    packageIds: mainnetPackageIds,
    ...(balanceManagers ? { balanceManagers } : {}),
  });
}

function getReadClient(): DeepBookClient {
  return makeClient();
}

function makeUserClient(sender: string, balanceManagerAddress: string): DeepBookClient {
  return makeClient(sender, { USER_BM: { address: balanceManagerAddress } });
}

// ── Pool list ─────────────────────────────────────────────────────────────────

const BASE_FEATURED_POOLS = ['SUI_USDC', 'DEEP_SUI', 'DEEP_USDC', 'WAL_SUI', 'WAL_USDC'] as const;

function getFeaturedPoolKeys(): string[] {
  const keys: string[] = [...BASE_FEATURED_POOLS];
  if (getSbetsSuiPoolId()) keys.unshift('SBETS_SUI');
  return keys;
}

export type PoolInfo = {
  key: string;
  address: string;
  baseCoin: string;
  quoteCoin: string;
  label: string;
};

export function listPools(): PoolInfo[] {
  const pools = getPoolsConfig();
  return getFeaturedPoolKeys()
    .filter(key => pools[key])
    .map(key => ({
      key,
      address:   pools[key].address,
      baseCoin:  pools[key].baseCoin,
      quoteCoin: pools[key].quoteCoin,
      label:     `${pools[key].baseCoin}/${pools[key].quoteCoin}`,
    }));
}

export function allPools(): PoolInfo[] {
  return Object.entries(getPoolsConfig()).map(([key, pool]: [string, any]) => ({
    key,
    address:   pool.address,
    baseCoin:  pool.baseCoin,
    quoteCoin: pool.quoteCoin,
    label:     `${pool.baseCoin}/${pool.quoteCoin}`,
  }));
}

// ── SBETS/SUI pool status ─────────────────────────────────────────────────────

export type SbetsPoolStatus = {
  poolId: string | null;
  configured: boolean;
  coinType: string;
  tickSize: number;
  lotSize: number;
  minSize: number;
  creationFeeDEEP: number;
};

export function getSbetsPoolStatus(): SbetsPoolStatus {
  return {
    poolId:         getSbetsSuiPoolId(),
    configured:     !!getSbetsSuiPoolId(),
    coinType:       SBETS_COIN_TYPE,
    tickSize:       0.0001,
    lotSize:        1000,
    minSize:        1000,
    creationFeeDEEP: Number(POOL_CREATION_FEE_DEEP) / 1_000_000,
  };
}

// ── Pool depth — ticks from mid ────────────────────────────────────────────────

export type DepthLevel = { price: number; quantity: number };

export type PoolDepth = {
  poolKey: string;
  label: string;
  midPrice: number | null;
  bids: DepthLevel[];
  asks: DepthLevel[];
  lotSize: number | null;
  minSize: number | null;
  takerFee: number | null;
  makerFee: number | null;
  fetchedAt: string;
};

export async function getPoolDepth(poolKey: string, ticks = 10): Promise<PoolDepth> {
  return cached(`depth:${poolKey}:${ticks}`, async () => {
    const client = getReadClient();
    const pools  = getPoolsConfig();
    const pool   = pools[poolKey];
    if (!pool) throw new Error(`Unknown pool: ${poolKey}`);

    const label = `${pool.baseCoin}/${pool.quoteCoin}`;

    let midPrice: number | null = null;
    let bids: DepthLevel[] = [];
    let asks: DepthLevel[] = [];
    let lotSize: number | null = null;
    let minSize: number | null = null;
    let takerFee: number | null = null;
    let makerFee: number | null = null;

    try { midPrice = await client.midPrice(poolKey).catch(() => null); } catch {}

    try {
      const depth = await client.getLevel2TicksFromMid(poolKey, ticks);
      const parseLevel = (prices: any[], quantities: any[]): DepthLevel[] =>
        (prices ?? []).map((p: any, i: number) => ({
          price:    Number(p),
          quantity: Number(quantities?.[i] ?? 0),
        }));
      bids = parseLevel(depth.bid_prices, depth.bid_quantities);
      asks = parseLevel(depth.ask_prices, depth.ask_quantities);
    } catch {}

    try {
      const params = await client.poolBookParams(poolKey);
      lotSize = (params as any).lotSize ?? null;
      minSize = (params as any).minSize ?? null;
    } catch (e: any) {
      console.warn('[DeepBook] poolBookParams failed:', e?.message);
    }

    try {
      const tradeParams = await client.poolTradeParams(poolKey);
      takerFee = (tradeParams as any).takerFee != null ? Number((tradeParams as any).takerFee) : null;
      makerFee = (tradeParams as any).makerFee != null ? Number((tradeParams as any).makerFee) : null;
    } catch (e: any) {
      console.warn('[DeepBook] poolTradeParams failed:', e?.message);
    }

    return { poolKey, label, midPrice, bids, asks, lotSize, minSize, takerFee, makerFee, fetchedAt: new Date().toISOString() };
  });
}

// ── Pool depth — Level2Range ───────────────────────────────────────────────────

export type Level2RangeResult = {
  poolKey: string;
  priceLow: number;
  priceHigh: number;
  isBid: boolean;
  levels: DepthLevel[];
  fetchedAt: string;
};

export async function getLevel2Range(
  poolKey: string,
  priceLow: number,
  priceHigh: number,
  isBid: boolean,
): Promise<Level2RangeResult> {
  return cached(`range:${poolKey}:${priceLow}:${priceHigh}:${isBid}`, async () => {
    const client = getReadClient();
    const pools  = getPoolsConfig();
    if (!pools[poolKey]) throw new Error(`Unknown pool: ${poolKey}`);

    const raw = await client.getLevel2Range(poolKey, priceLow, priceHigh, isBid);

    const prices     = (raw as any).prices     ?? (raw as any).bid_prices ?? (raw as any).ask_prices ?? [];
    const quantities = (raw as any).quantities ?? (raw as any).bid_quantities ?? (raw as any).ask_quantities ?? [];

    const levels: DepthLevel[] = prices.map((p: any, i: number) => ({
      price:    Number(p),
      quantity: Number(quantities[i] ?? 0),
    }));

    return { poolKey, priceLow, priceHigh, isBid, levels, fetchedAt: new Date().toISOString() };
  });
}

// ── Mid-price ─────────────────────────────────────────────────────────────────

export async function getMidPrice(poolKey: string): Promise<number | null> {
  return cached(`mid:${poolKey}`, () =>
    getReadClient().midPrice(poolKey).catch(() => null)
  );
}

// ── Multi-pool summary ────────────────────────────────────────────────────────

export type PoolSummary = { key: string; label: string; midPrice: number | null };

export async function getPoolSummaries(): Promise<PoolSummary[]> {
  const featuredKeys = getFeaturedPoolKeys();
  return cached(`summaries:${featuredKeys.join(',')}`, async () => {
    const client = getReadClient();
    const pools  = getPoolsConfig();
    return Promise.all(
      featuredKeys
        .filter(key => pools[key])
        .map(async (key) => {
          const pool = pools[key];
          const label = `${pool.baseCoin}/${pool.quoteCoin}`;
          const midPrice = await client.midPrice(key).catch(() => null);
          return { key, label, midPrice };
        })
    );
  });
}

// ── Vault balances ─────────────────────────────────────────────────────────────

export type VaultBalancesResult = {
  poolKey: string;
  label: string;
  baseAvailable: number;
  baseLocked: number;
  quoteAvailable: number;
  quoteLocked: number;
  deepAvailable: number;
  deepLocked: number;
  fetchedAt: string;
};

export async function getVaultBalances(poolKey: string): Promise<VaultBalancesResult> {
  return cached(`vault:${poolKey}`, async () => {
    const client = getReadClient();
    const pools  = getPoolsConfig();
    const pool   = pools[poolKey];
    if (!pool) throw new Error(`Unknown pool: ${poolKey}`);
    const label = `${pool.baseCoin}/${pool.quoteCoin}`;

    const v: any = await client.vaultBalances(poolKey);

    return {
      poolKey,
      label,
      baseAvailable:  Number(v.base  ?? 0),
      baseLocked:     0,
      quoteAvailable: Number(v.quote ?? 0),
      quoteLocked:    0,
      deepAvailable:  Number(v.deep  ?? 0),
      deepLocked:     0,
      fetchedAt: new Date().toISOString(),
    };
  });
}

// ── TX helpers ────────────────────────────────────────────────────────────────

async function finalizeTx(tx: Transaction, sender: string): Promise<string> {
  const suiClient = getDeepBookSuiClient();
  tx.setSender(sender);
  const bytes = await tx.build({ client: suiClient });
  return Buffer.from(bytes).toString('base64');
}

// ── Create SBETS/SUI permissionless pool ──────────────────────────────────────
// Costs 500 DEEP from the sender's wallet.
// After signing + executing, look up the new Pool object ID in the tx effects
// and set DEEPBOOK_SBETS_SUI_POOL_ID env var.

export async function buildCreateSbetsSuiPoolTx(sender: string): Promise<string> {
  const client = new DeepBookClient({
    client:     getDeepBookSuiClient(),
    address:    sender,
    network:    'mainnet',
    coins:      getCoinsConfig(),
    pools:      mainnetPools,
    packageIds: mainnetPackageIds,
  });

  const tx = new Transaction();
  client.deepBook.createPermissionlessPool({
    baseCoinKey: 'SBETS',
    quoteCoinKey: 'SUI',
    tickSize:    0.0001, // 0.0001 SUI per SBETS — fine granularity for implied-prob prices
    lotSize:     1000,   // minimum 1000 SBETS per lot
    minSize:     1000,   // minimum 1000 SBETS order
  })(tx);

  return finalizeTx(tx, sender);
}

// ── Balance manager deposit / withdraw ────────────────────────────────────────
// Supported coinKeys: 'SUI', 'SBETS', 'DEEP', 'USDC', etc.

export type BuildDepositParams = {
  sender: string;
  balanceManagerAddress: string;
  coinKey: string;
  amount: number;
};

export type BuildWithdrawParams = {
  sender: string;
  balanceManagerAddress: string;
  coinKey: string;
  amount: number;
  recipient?: string;
};

/** Deposit SUI or SBETS (or any supported coin) into a balance manager. */
export async function buildDepositToManagerTx(params: BuildDepositParams): Promise<string> {
  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx = new Transaction();
  client.balanceManager.depositIntoManager(
    'USER_BM',
    params.coinKey.toUpperCase(),
    params.amount,
  )(tx);
  return finalizeTx(tx, params.sender);
}

/** Withdraw SUI or SBETS from a balance manager back to a wallet. */
export async function buildWithdrawFromManagerTx(params: BuildWithdrawParams): Promise<string> {
  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx = new Transaction();
  const recipient = params.recipient ?? params.sender;
  client.balanceManager.withdrawFromManager(
    'USER_BM',
    params.coinKey.toUpperCase(),
    params.amount,
    recipient,
  )(tx);
  return finalizeTx(tx, params.sender);
}

// ── Limit / market / cancel orders (existing, now with SBETS support) ─────────

export type BuildLimitOrderParams = {
  sender: string;
  balanceManagerAddress: string;
  poolKey: string;
  price: number;
  quantity: number;
  isBid: boolean;
  expiration?: number;
  payWithDeep?: boolean;
};

export type BuildMarketOrderParams = {
  sender: string;
  balanceManagerAddress: string;
  poolKey: string;
  quantity: number;
  isBid: boolean;
  payWithDeep?: boolean;
};

export type BuildCancelOrderParams = {
  sender: string;
  balanceManagerAddress: string;
  poolKey: string;
  orderId: string;
};

export type BuildCancelAllParams = {
  sender: string;
  balanceManagerAddress: string;
  poolKey: string;
};

export type BuildCreateBalanceManagerParams = {
  sender: string;
};

export async function buildLimitOrderTx(params: BuildLimitOrderParams): Promise<string> {
  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx = new Transaction();

  client.deepBook.placeLimitOrder({
    poolKey:             params.poolKey,
    balanceManagerKey:   'USER_BM',
    clientOrderId:       String(Date.now()),
    price:               params.price,
    quantity:            params.quantity,
    isBid:               params.isBid,
    expiration:          params.expiration ? BigInt(params.expiration) : undefined,
    orderType:           OrderType.NO_RESTRICTION,
    selfMatchingOption:  SelfMatchingOptions.SELF_MATCHING_ALLOWED,
    payWithDeep:         params.payWithDeep ?? true,
  })(tx);

  return finalizeTx(tx, params.sender);
}

export async function buildMarketOrderTx(params: BuildMarketOrderParams): Promise<string> {
  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx = new Transaction();

  client.deepBook.placeMarketOrder({
    poolKey:            params.poolKey,
    balanceManagerKey:  'USER_BM',
    clientOrderId:      String(Date.now()),
    quantity:           params.quantity,
    isBid:              params.isBid,
    selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
    payWithDeep:        params.payWithDeep ?? true,
  })(tx);

  return finalizeTx(tx, params.sender);
}

export async function buildCancelOrderTx(params: BuildCancelOrderParams): Promise<string> {
  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx = new Transaction();
  client.deepBook.cancelOrder(params.poolKey, 'USER_BM', params.orderId)(tx);
  return finalizeTx(tx, params.sender);
}

export async function buildCancelAllOrdersTx(params: BuildCancelAllParams): Promise<string> {
  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx = new Transaction();
  client.deepBook.cancelAllOrders(params.poolKey, 'USER_BM')(tx);
  return finalizeTx(tx, params.sender);
}

export async function buildCreateBalanceManagerTx(params: BuildCreateBalanceManagerParams): Promise<string> {
  const client = makeClient(params.sender);
  const tx = new Transaction();
  client.balanceManager.createAndShareBalanceManager()(tx);
  return finalizeTx(tx, params.sender);
}

// ── Bet-as-limit-order (SBETS/SUI pool) ──────────────────────────────────────
//
// Converts a sports bet into a real DeepBook limit order on the SBETS/SUI pool.
//
// Both SBETS and SUI bets post on the single SBETS/SUI pool — no second pool needed.
//
// SBETS bet (currency = 'SBETS'):
//   price    = implied probability = 1/odds  (SUI per SBETS)
//   quantity = stake in SBETS
//   creator  → ASK (SELL SBETS, lock SBETS in BM, receive SUI when filled)
//   taker    → BID (BUY  SBETS, lock SUI  in BM, receive SBETS when filled)
//
// SUI bet (currency = 'SUI'):
//   price    = implied probability = 1/odds  (SUI per SBETS)
//   quantity = stake_sui / implied_prob  (SBETS equivalent at this price)
//   creator  → BID (BUY  SBETS, lock SUI  in BM; SUI locked = quantity × price = stake_sui)
//   taker    → ASK (SELL SBETS, lock SBETS in BM)
//
// Example SBETS: "Inter Miami wins @ 1.47 odds, stake 2M SBETS"
//   → SELL 2_000_000 SBETS @ 0.6803 SUI  (ASK on SBETS/SUI)
//
// Example SUI: "Inter Miami wins @ 1.47 odds, stake 2 SUI"
//   implied_prob = 0.6803
//   quantity = 2 / 0.6803 ≈ 2.94 SBETS
//   → BUY 2.94 SBETS @ 0.6803 SUI each  (BID on SBETS/SUI, locks exactly 2 SUI in BM)
//
// Both order types are visible in the live SBETS/SUI order book on DeepBook.

export type BuildBetLimitOrderParams = {
  sender: string;
  balanceManagerAddress: string;
  odds: number;               // e.g. 1.47  — must be > 1.0
  stakeAmount: number;        // stake in SBETS (currency='SBETS') or SUI (currency='SUI')
  isCreator: boolean;         // true = posting bet, false = taking bet
  currency?: 'SBETS' | 'SUI'; // defaults to 'SBETS'
  expiration?: number;        // Unix ms; defaults to MAX (no expiry)
  payWithDeep?: boolean;
};

export async function buildBetLimitOrderTx(params: BuildBetLimitOrderParams): Promise<string> {
  const poolId = getSbetsSuiPoolId();
  if (!poolId) {
    throw new Error(
      'SBETS/SUI DeepBook pool not yet created. ' +
      'Call POST /api/p2p/deepbook/pool/create-sbets first and set DEEPBOOK_SBETS_SUI_POOL_ID env var.'
    );
  }

  if (params.odds <= 1.0) throw new Error('Odds must be greater than 1.0');

  const currency = params.currency ?? 'SBETS';
  const impliedProbability = 1 / params.odds;

  // For SUI bets: derive the SBETS quantity from the SUI stake at this implied prob price.
  // quantity × price = SUI locked in BM = stakeAmount (SUI).
  const quantity = currency === 'SUI'
    ? params.stakeAmount / impliedProbability
    : params.stakeAmount;

  // Side logic (opposite for each currency because creator holds different asset):
  //   SBETS creator = ASK (sell SBETS), SBETS taker = BID (buy SBETS)
  //   SUI  creator = BID (buy SBETS with SUI), SUI  taker = ASK (sell SBETS)
  const isBid = currency === 'SUI' ? params.isCreator : !params.isCreator;

  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx = new Transaction();

  client.deepBook.placeLimitOrder({
    poolKey:            'SBETS_SUI',
    balanceManagerKey:  'USER_BM',
    clientOrderId:      String(Date.now()),
    price:              impliedProbability,
    quantity,
    isBid,
    expiration:         params.expiration ? BigInt(params.expiration) : undefined,
    orderType:          OrderType.NO_RESTRICTION,
    selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
    payWithDeep:        params.payWithDeep ?? true,
  })(tx);

  return finalizeTx(tx, params.sender);
}

// ── User-funded combined: deposit to user's own BM + place limit order ────────
//
// This is the CORRECT unified flow.  The user signs ONE transaction that:
//   1. Deposits their stake into THEIR OWN Balance Manager  (no platform money)
//   2. Places a real limit order on DeepBook from that BM   (no platform money)
//
// The offerId is used as the DeepBook clientOrderId so the fill listener can
// match fills back to the DB record without any off-chain state.
//
// IMPORTANT: this tx spends ADDITIONAL funds beyond the P2P contract escrow.
// For a 100 SUI bet the user locks 100 SUI in the contract AND deposits 100 SUI
// here — the DeepBook deposit is returned when the order is filled or cancelled.

export type BuildDepositAndListBetParams = {
  sender: string;
  balanceManagerAddress: string;
  offerId: number;          // DB offer ID → used as DeepBook clientOrderId (u64)
  odds: number;
  stakeAmount: number;
  currency?: 'SBETS' | 'SUI';
  expiresAtMs?: number;
  payWithDeep?: boolean;
};

export async function buildDepositAndListBetPTB(params: BuildDepositAndListBetParams): Promise<{
  transactionBytes: string;
  clientOrderId: string;
  price: number;
  quantity: number;
  isBid: boolean;
}> {
  const poolId = getSbetsSuiPoolId();
  if (!poolId) {
    throw new Error(
      'SBETS/SUI DeepBook pool not configured. ' +
      'Set DEEPBOOK_SBETS_SUI_POOL_ID env var first.'
    );
  }
  if (params.odds <= 1.0) throw new Error('Odds must be > 1.0');

  const currency         = params.currency ?? 'SUI';
  const impliedProb      = 1 / params.odds;
  // SUI bet: creator is BID side (buying SBETS with SUI), quantity = SUI / impliedProb
  // SBETS bet: creator is ASK side (selling SBETS), quantity = stakeAmount
  const quantity         = currency === 'SUI' ? params.stakeAmount / impliedProb : params.stakeAmount;
  const isBid            = currency === 'SUI';
  const coinKey          = currency;                     // 'SUI' or 'SBETS'
  const clientOrderId    = String(params.offerId);       // u64-safe: DB IDs are ints

  const client = makeUserClient(params.sender, params.balanceManagerAddress);
  const tx     = new Transaction();

  // Step 1: deposit user's own funds into their own Balance Manager
  client.balanceManager.depositIntoManager('USER_BM', coinKey, params.stakeAmount)(tx);

  // Step 2: post the real limit order — this is what appears on the DeepBook order book
  client.deepBook.placeLimitOrder({
    poolKey:            'SBETS_SUI',
    balanceManagerKey:  'USER_BM',
    clientOrderId,
    price:              impliedProb,
    quantity,
    isBid,
    expiration:         params.expiresAtMs ? BigInt(params.expiresAtMs) : undefined,
    orderType:          OrderType.NO_RESTRICTION,
    selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
    payWithDeep:        params.payWithDeep ?? true,
  })(tx);

  const transactionBytes = await finalizeTx(tx, params.sender);
  return {
    transactionBytes,
    clientOrderId,
    price:    Math.round(impliedProb   * 1e8) / 1e8,
    quantity: Math.round(quantity      * 1e6) / 1e6,
    isBid,
  };
}
