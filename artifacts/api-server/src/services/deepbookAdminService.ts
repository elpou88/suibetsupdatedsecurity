/**
 * deepbookAdminService.ts
 *
 * Server-side DeepBook transaction executor using DEEPBOOK_ADMIN_PRIVATE_KEY.
 *
 * Core purpose: every P2P bet offer → real DeepBook limit order on SBETS/SUI pool
 *   price    = 1 / odds  (implied probability)
 *   quantity = stake in SBETS
 *   side     = SELL / ASK  (creator posts offer; taker fills by BUYing)
 *
 * Flow:
 *   1. runFullSetup()        — one-time: create pool + BM + deposit SBETS
 *   2. postBetAsLimitOrder() — called automatically after every P2P offer creation
 *   3. Anyone on Sui/DeepBook sees and can fill the live order book
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import {
  DeepBookClient,
  mainnetPackageIds,
  mainnetPools,
  mainnetCoins,
  OrderType,
  SelfMatchingOptions,
} from '@mysten/deepbook-v3';
import { getSuiClient } from '../lib/suiRpcConfig';
import { SBETS_COIN_TYPE, getSbetsSuiPoolId } from './deepbookService';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

// ── Persistent config (survives server restarts) ──────────────────────────────

const CONFIG_FILE = path.resolve(__dirname, '../../data/deepbook-config.json');

interface AdminConfig {
  poolId: string | null;
  adminBmId: string | null;
  poolCreatedAt: string | null;
  bmCreatedAt: string | null;
  totalOrdersPosted: number;
}

function loadConfig(): AdminConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return { poolId: null, adminBmId: null, poolCreatedAt: null, bmCreatedAt: null, totalOrdersPosted: 0 };
}

function saveConfig(cfg: AdminConfig): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    // Immediately apply to in-memory env so other modules see the update
    if (cfg.poolId)   process.env.DEEPBOOK_SBETS_SUI_POOL_ID = cfg.poolId;
    if (cfg.adminBmId) process.env.DEEPBOOK_ADMIN_BM_ID      = cfg.adminBmId;
  } catch (e: any) {
    console.warn('[DeepBookAdmin] Failed to persist config:', e?.message);
  }
}

// Apply saved config to process.env on module load
const _cfg = loadConfig();
if (_cfg.poolId && !process.env.DEEPBOOK_SBETS_SUI_POOL_ID) {
  process.env.DEEPBOOK_SBETS_SUI_POOL_ID = _cfg.poolId;
  console.log(`[DeepBookAdmin] ♻️  Pool ID restored: ${_cfg.poolId.slice(0, 18)}…`);
}
if (_cfg.adminBmId && !process.env.DEEPBOOK_ADMIN_BM_ID) {
  process.env.DEEPBOOK_ADMIN_BM_ID = _cfg.adminBmId;
  console.log(`[DeepBookAdmin] ♻️  Admin BM  restored: ${_cfg.adminBmId.slice(0, 18)}…`);
}

// ── Keypair loading ───────────────────────────────────────────────────────────

function loadKeypair(): Ed25519Keypair {
  const raw = process.env.DEEPBOOK_ADMIN_PRIVATE_KEY;
  if (!raw || !raw.trim()) throw new Error('DEEPBOOK_ADMIN_PRIVATE_KEY is not set');

  // ── Never let raw key material appear in error messages ──────────────────────
  // All errors thrown here use only fixed strings or byte-lengths (not key values).
  try {
    const s = raw.trim();

    // Bech32 Sui format: suiprivkey1…
    if (s.startsWith('suiprivkey')) {
      const decoded = decodeSuiPrivateKey(s);
      return Ed25519Keypair.fromSecretKey(decoded.secretKey);
    }

    // Hex: 0x + 64 hex chars (32 bytes)  OR  0x + 66 hex chars (33 bytes with scheme prefix)
    if (s.startsWith('0x') || s.startsWith('0X')) {
      const hex = s.slice(2);
      const bytes = Buffer.from(hex, 'hex');
      if (bytes.length === 32) return Ed25519Keypair.fromSecretKey(bytes);
      if (bytes.length === 33) return Ed25519Keypair.fromSecretKey(bytes.slice(1));
      if (bytes.length === 64) return Ed25519Keypair.fromSecretKey(bytes.slice(0, 32));
    }

    // Base64
    const bytes = Buffer.from(s, 'base64');
    if (bytes.length === 32) return Ed25519Keypair.fromSecretKey(bytes);
    if (bytes.length === 33) return Ed25519Keypair.fromSecretKey(bytes.slice(1));
    if (bytes.length === 64) return Ed25519Keypair.fromSecretKey(bytes.slice(0, 32));

    // Unrecognised length — report only byte count, never key value
    throw new Error(`DEEPBOOK_ADMIN_PRIVATE_KEY: unrecognised format (decoded byte length: ${bytes.length})`);
  } catch (err: any) {
    // Sanitize: only propagate fixed-text messages, never raw crypto error details
    // that could theoretically contain key material
    const msg: string = err?.message ?? '';
    const isSafeMsg = msg.startsWith('DEEPBOOK_ADMIN_PRIVATE_KEY');
    throw new Error(isSafeMsg ? msg : 'DEEPBOOK_ADMIN_PRIVATE_KEY: failed to parse key (invalid format or encoding)');
  }
}

export function getAdminAddress(): string {
  return loadKeypair().toSuiAddress();
}

// ── DeepBook client factory ───────────────────────────────────────────────────

function getRpcClient(): any {
  const hybrid = getSuiClient() as any;
  return typeof hybrid.getRpcClient === 'function' ? hybrid.getRpcClient() : hybrid;
}

function getActivePools(): Record<string, any> {
  const pools: Record<string, any> = { ...mainnetPools };
  const poolId = getSbetsSuiPoolId();
  if (poolId) pools['SBETS_SUI'] = { address: poolId, baseCoin: 'SBETS', quoteCoin: 'SUI' };
  return pools;
}

function makeClient(address: string, bmId?: string | null): DeepBookClient {
  const bms = bmId ? { ADMIN_BM: { address: bmId } } : {};
  return new DeepBookClient({
    client:     getRpcClient(),
    address,
    network:    'mainnet',
    coins:      { ...mainnetCoins, SBETS: { address: SBETS_COIN_TYPE, type: SBETS_COIN_TYPE, scalar: 1_000_000_000 } },
    pools:      getActivePools(),
    packageIds: mainnetPackageIds,
    ...(bmId ? { balanceManagers: bms } : {}),
  });
}

// ── Transaction executor ──────────────────────────────────────────────────────

async function execute(tx: Transaction, keypair: Ed25519Keypair): Promise<any> {
  const client = getSuiClient() as any;
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  });
  if (result?.effects?.status?.status === 'failure') {
    throw new Error(`On-chain execution failed: ${result.effects.status.error ?? 'unknown'}`);
  }
  return result;
}

function extractCreatedObject(result: any, typeSnippet: string): string | null {
  for (const c of result?.objectChanges ?? []) {
    if (c.type === 'created' && (c.objectType ?? '').includes(typeSnippet)) {
      return c.objectId;
    }
  }
  return null;
}

// ── Wallet balances ───────────────────────────────────────────────────────────

export interface AdminBalances {
  address: string;
  SUI: number;
  SBETS: number;
  DEEP: number;
}

export async function getAdminBalances(): Promise<AdminBalances> {
  const client = getSuiClient() as any;
  const kp     = loadKeypair();
  const addr   = kp.toSuiAddress();

  const [suiBal, sbesBal, deepBal] = await Promise.allSettled([
    client.getBalance({ owner: addr, coinType: '0x2::sui::SUI' }),
    client.getBalance({ owner: addr, coinType: SBETS_COIN_TYPE }),
    client.getBalance({ owner: addr, coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP' }),
  ]);

  return {
    address: addr,
    SUI:   suiBal.status  === 'fulfilled' ? Number((suiBal.value  as any).totalBalance) / 1e9  : 0,
    SBETS: sbesBal.status === 'fulfilled' ? Number((sbesBal.value as any).totalBalance) / 1e9  : 0,
    DEEP:  deepBal.status === 'fulfilled' ? Number((deepBal.value as any).totalBalance) / 1e6  : 0,
  };
}

// ── Step 1: Create SBETS/SUI permissionless pool ──────────────────────────────
// Costs 500 DEEP from the admin wallet.

export async function createSbetsSuiPool(): Promise<{ digest: string; poolId: string }> {
  const existing = getSbetsSuiPoolId() ?? loadConfig().poolId;
  if (existing) throw new Error(`SBETS/SUI pool already exists: ${existing}`);

  const kp   = loadKeypair();
  const addr = kp.toSuiAddress();

  const tx = new Transaction();
  makeClient(addr).deepBook.createPermissionlessPool({
    baseCoinKey:  'SBETS',
    quoteCoinKey: 'SUI',
    tickSize:  0.0001,
    lotSize:   1000,
    minSize:   1000,
  })(tx);

  console.log(`[DeepBookAdmin] Creating SBETS/SUI pool from ${addr.slice(0, 16)}…`);
  const result = await execute(tx, kp);

  const poolId = extractCreatedObject(result, 'Pool<');
  if (!poolId) throw new Error('Pool created but could not find Pool object ID in tx effects');

  const cfg = loadConfig();
  cfg.poolId = poolId;
  cfg.poolCreatedAt = new Date().toISOString();
  saveConfig(cfg);

  console.log(`[DeepBookAdmin] ✅ Pool created: ${poolId}  tx: ${result.digest}`);
  return { digest: result.digest, poolId };
}

// ── Step 2: Create admin balance manager ─────────────────────────────────────

export async function createAdminBM(): Promise<{ digest: string; bmId: string }> {
  const existing = process.env.DEEPBOOK_ADMIN_BM_ID ?? loadConfig().adminBmId;
  if (existing) throw new Error(`Admin BM already exists: ${existing}`);

  const kp   = loadKeypair();
  const addr = kp.toSuiAddress();

  const tx = new Transaction();
  makeClient(addr).balanceManager.createAndShareBalanceManager()(tx);

  console.log(`[DeepBookAdmin] Creating balance manager for ${addr.slice(0, 16)}…`);
  const result = await execute(tx, kp);

  const bmId = extractCreatedObject(result, 'BalanceManager');
  if (!bmId) throw new Error('BM created but could not find BalanceManager ID in tx effects');

  const cfg = loadConfig();
  cfg.adminBmId = bmId;
  cfg.bmCreatedAt = new Date().toISOString();
  saveConfig(cfg);

  console.log(`[DeepBookAdmin] ✅ Balance Manager created: ${bmId}  tx: ${result.digest}`);
  return { digest: result.digest, bmId };
}

// ── Step 3: Deposit coins into BM ────────────────────────────────────────────
// coinKey: 'SUI' | 'SBETS' | 'DEEP'
// amount: human-readable (e.g. 1000 = 1000 SBETS)

export async function depositToBM(coinKey: string, amount: number): Promise<{ digest: string }> {
  const bmId = process.env.DEEPBOOK_ADMIN_BM_ID ?? loadConfig().adminBmId;
  if (!bmId) throw new Error('Admin BM not created. Run setup first.');

  const kp   = loadKeypair();
  const addr = kp.toSuiAddress();
  const ck   = coinKey.toUpperCase();

  const tx = new Transaction();
  makeClient(addr, bmId).balanceManager.depositIntoManager('ADMIN_BM', ck, amount)(tx);

  console.log(`[DeepBookAdmin] Depositing ${amount} ${ck} to BM ${bmId.slice(0, 16)}…`);
  const result = await execute(tx, kp);
  console.log(`[DeepBookAdmin] ✅ Deposited ${amount} ${ck}  tx: ${result.digest}`);
  return { digest: result.digest };
}

// ── Step 4: Post P2P bet offer as live DeepBook limit order ──────────────────
//
// Semantics:
//   SBETS/SUI pool, price = 1/odds (implied probability 0–1)
//   SELL (ASK) side — admin posts on behalf of bet creator
//   Taker BUYs SBETS at that price = accepts the bet at those odds
//
// The order is LIVE and visible to every wallet/bot/aggregator on Sui.

export interface BetOrderInput {
  offerId?:    string | number;
  odds:        number;   // e.g. 1.47
  stakeAmount: number;   // human-readable SBETS (e.g. 1000 = 1000 SBETS)
  currency?:   string;
  eventName?:  string;
  prediction?: string;
}

export interface PostedOrder {
  digest:            string;
  clientOrderId:     string;  // numeric string sent to SDK as u64
  onchainOrderId:    string | null;  // u64 on-chain order ID extracted from OrderPlaced event
  poolId:            string;
  price:             number;  // = 1/odds
  quantity:          number;  // SBETS
  side:              'SELL';
  odds:              number;
  impliedProbability:number;
  suiScanUrl:        string;
}

export async function postBetAsLimitOrder(bet: BetOrderInput): Promise<PostedOrder> {
  const poolId = getSbetsSuiPoolId() ?? loadConfig().poolId;
  if (!poolId) throw new Error('SBETS/SUI pool not created. Run POST /api/p2p/deepbook/admin/setup first.');

  const bmId = process.env.DEEPBOOK_ADMIN_BM_ID ?? loadConfig().adminBmId;
  if (!bmId) throw new Error('Admin BM not created. Run POST /api/p2p/deepbook/admin/setup first.');

  if (bet.odds <= 1) throw new Error('odds must be > 1.0');
  if (bet.stakeAmount <= 0) throw new Error('stakeAmount must be > 0');

  const impliedProb = 1 / bet.odds;
  const kp   = loadKeypair();
  const addr = kp.toSuiAddress();

  // Use a numeric clientOrderId (DeepBook stores this as u64).
  // We use the offerId directly so it's stable and predictable.
  // Fallback to a timestamp-based number if no offerId is supplied.
  const clientOrderId = bet.offerId != null
    ? String(Number(bet.offerId))
    : String(Date.now());

  const tx = new Transaction();
  makeClient(addr, bmId).deepBook.placeLimitOrder({
    poolKey:            'SBETS_SUI',
    balanceManagerKey:  'ADMIN_BM',
    clientOrderId,
    price:              impliedProb,
    quantity:           bet.stakeAmount,
    isBid:              false,   // SELL / ASK side
    orderType:          OrderType.NO_RESTRICTION,
    selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
    payWithDeep:        true,
  })(tx);

  const label = bet.eventName ? ` [${bet.eventName}${bet.prediction ? ' → ' + bet.prediction : ''}]` : '';
  console.log(
    `[DeepBookAdmin] Posting limit order${label}: clientOrderId=${clientOrderId} SELL ${bet.stakeAmount} SBETS @ ${impliedProb.toFixed(6)} (${bet.odds}x odds)`
  );

  const result = await execute(tx, kp);

  // Update order counter
  const cfg = loadConfig();
  cfg.totalOrdersPosted = (cfg.totalOrdersPosted ?? 0) + 1;
  saveConfig(cfg);

  // Extract the on-chain order_id from the OrderPlaced event.
  // DeepBook emits an event with parsedJson.order_id (u64 as string).
  // This is the ID required for cancellation via cancelOrder().
  let onchainOrderId: string | null = null;
  try {
    const orderPlacedEvent = (result?.events ?? []).find(
      (e: any) => typeof e?.type === 'string' && e.type.includes('OrderPlaced')
    );
    onchainOrderId = orderPlacedEvent?.parsedJson?.order_id
      ? String(orderPlacedEvent.parsedJson.order_id)
      : null;
  } catch {}

  console.log(
    `[DeepBookAdmin] ✅ Limit order live on DeepBook  clientOrderId=${clientOrderId}  onchainOrderId=${onchainOrderId}  tx: ${result.digest}`
  );

  return {
    digest: result.digest,
    clientOrderId,
    onchainOrderId,
    poolId,
    price:             impliedProb,
    quantity:          bet.stakeAmount,
    side:              'SELL',
    odds:              bet.odds,
    impliedProbability: impliedProb,
    suiScanUrl:        `https://suiscan.xyz/mainnet/tx/${result.digest}`,
  };
}

// ── Cancel a DeepBook mirror order by offer ID ────────────────────────────────
//
// Called automatically when a P2P offer is matched or cancelled.
// Looks up the on-chain order ID stored in DB at offer creation time,
// then submits a cancel transaction using the admin's Balance Manager.
//
// Fails gracefully — if no order ID was stored (DeepBook not configured
// at creation time, or order already filled/cancelled) it no-ops cleanly.
//
export async function cancelBetOrderByOfferId(offerId: number | string): Promise<{ digest: string } | null> {
  // Look up the on-chain order ID stored when the order was placed
  let onchainOrderId: string | null = null;
  try {
    const dbResult = await db.execute(sql`
      SELECT deepbook_order_id FROM p2p_bet_offers WHERE id = ${Number(offerId)}
    `);
    const row = ((dbResult as any).rows ?? (dbResult as any))[0];
    onchainOrderId = row?.deepbook_order_id ?? null;
  } catch (err: any) {
    console.warn(`[DeepBookAdmin] DB lookup failed for offer #${offerId}: ${err?.message}`);
  }

  if (!onchainOrderId) {
    console.log(`[DeepBookAdmin] No DeepBook order ID stored for offer #${offerId} — skipping cancel`);
    return null;
  }

  const bmId = process.env.DEEPBOOK_ADMIN_BM_ID ?? loadConfig().adminBmId;
  if (!bmId) {
    console.log('[DeepBookAdmin] No BM configured — skipping DeepBook cancel');
    return null;
  }

  const kp   = loadKeypair();
  const addr = kp.toSuiAddress();

  try {
    const tx = new Transaction();
    // cancelOrder uses positional args: (poolKey, balanceManagerKey, orderId)
    makeClient(addr, bmId).deepBook.cancelOrder('SBETS_SUI', 'ADMIN_BM', onchainOrderId)(tx);

    const result = await execute(tx, kp);
    console.log(`[DeepBookAdmin] ✅ Cancelled DeepBook order  offer=#${offerId}  onchainOrderId=${onchainOrderId}  tx: ${result.digest}`);
    return { digest: result.digest };
  } catch (err: any) {
    // Order may already be filled or cancelled on-chain — not an error for our purposes
    console.warn(`[DeepBookAdmin] Cancel skipped/failed for offer #${offerId} (onchainOrderId=${onchainOrderId}): ${err?.message}`);
    return null;
  }
}

// ── Buy DEEP with SUI (auto-triggered by setup when DEEP balance < threshold) ─
//
// Uses admin's SUI to buy DEEP on the DEEP/SUI DeepBook pool.
// DEEP is needed to create the SBETS/SUI permissionless pool (500 DEEP fee).
//
// Flow: create BM → deposit SUI → IOC limit BUY order → withdraw DEEP to wallet

const DEEP_COIN   = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP';
const DEEP_SCALAR = 1_000_000;   // DEEP has 6 decimals
const POOL_CREATION_DEEP = 500;  // DeepBook fee for creating a permissionless pool
const GAS_RESERVE_SUI    = 0.3;  // always keep this much SUI for gas

async function getDeepBalanceWallet(addr: string): Promise<number> {
  try {
    const bal = await (getSuiClient() as any).getBalance({ owner: addr, coinType: DEEP_COIN });
    return Number(bal.totalBalance) / DEEP_SCALAR;
  } catch { return 0; }
}

export interface BuyDeepResult {
  purchased:      boolean;
  deepAcquired:   number;
  deepInWallet:   number;
  digest?:        string;
  note:           string;
}

export async function buyDeepWithSui(minDeepNeeded = POOL_CREATION_DEEP + 100): Promise<BuyDeepResult> {
  const client = getSuiClient() as any;
  const kp     = loadKeypair();
  const addr   = kp.toSuiAddress();

  // ── 1. Check current DEEP balance ────────────────────────────────────────────
  const currentDeep = await getDeepBalanceWallet(addr);
  if (currentDeep >= minDeepNeeded) {
    return { purchased: false, deepAcquired: 0, deepInWallet: currentDeep,
             note: `Already have ${currentDeep.toFixed(2)} DEEP — no purchase needed.` };
  }
  const deficit = minDeepNeeded - currentDeep;

  // ── 2. Get live DEEP/SUI ask price ───────────────────────────────────────────
  let askPriceSuiPerDeep = 0.035; // conservative fallback
  try {
    const { getPoolDepth } = await import('./deepbookService');
    const depth = await getPoolDepth('DEEP_SUI', 3);
    if (depth.asks?.[0]?.price) askPriceSuiPerDeep = depth.asks[0].price;
  } catch {}
  const buyPrice = askPriceSuiPerDeep * 1.15; // 15 % slippage guard

  // ── 3. Check SUI available ────────────────────────────────────────────────────
  const suiBal    = await client.getBalance({ owner: addr, coinType: '0x2::sui::SUI' });
  const suiTotal  = Number(suiBal.totalBalance) / 1e9;
  const suiAvail  = Math.max(0, suiTotal - GAS_RESERVE_SUI);
  const suiNeeded = deficit * buyPrice;

  if (suiAvail < 0.02) {
    return {
      purchased: false, deepAcquired: 0, deepInWallet: currentDeep,
      note: `Not enough SUI to buy DEEP. Admin wallet (${addr}) has ${suiTotal.toFixed(4)} SUI. ` +
            `Need ~${(suiNeeded + GAS_RESERVE_SUI).toFixed(2)} SUI total to buy ${deficit.toFixed(0)} DEEP ` +
            `@ ${askPriceSuiPerDeep.toFixed(4)} SUI/DEEP. Please send SUI or DEEP to this address.`,
    };
  }

  // How much DEEP we can actually afford
  const suiToSpend    = Math.min(suiAvail, suiNeeded * 1.05);
  const affordableDeep = Math.floor(suiToSpend / buyPrice);

  console.log(
    `[DeepBookAdmin] 💱 Buying DEEP: spending ${suiToSpend.toFixed(4)} SUI for ~${affordableDeep} DEEP ` +
    `(price ${askPriceSuiPerDeep.toFixed(4)} SUI/DEEP). Want ${deficit.toFixed(0)} DEEP.`
  );

  if (affordableDeep + currentDeep < minDeepNeeded) {
    console.warn(
      `[DeepBookAdmin] ⚠️ Can only afford ${affordableDeep + currentDeep} / ${minDeepNeeded} DEEP. ` +
      `Will proceed; pool creation will fail if still insufficient.`
    );
  }

  // ── 4. Ensure admin BM exists ─────────────────────────────────────────────────
  let bmId = process.env.DEEPBOOK_ADMIN_BM_ID ?? loadConfig().adminBmId;
  if (!bmId) {
    const r = await createAdminBM();
    bmId = r.bmId;
  }

  // ── 5. Deposit SUI into BM ────────────────────────────────────────────────────
  const depTx = new Transaction();
  makeClient(addr, bmId).balanceManager.depositIntoManager('ADMIN_BM', 'SUI', suiToSpend)(depTx);
  await execute(depTx, kp);
  console.log(`[DeepBookAdmin] Deposited ${suiToSpend.toFixed(4)} SUI to admin BM`);

  // ── 6. Place IOC limit BUY order on DEEP_SUI pool ─────────────────────────────
  const buyTx = new Transaction();
  makeClient(addr, bmId).deepBook.placeLimitOrder({
    poolKey:            'DEEP_SUI',
    balanceManagerKey:  'ADMIN_BM',
    clientOrderId:      String(Date.now()),
    price:              buyPrice,
    quantity:           affordableDeep,
    isBid:              true,  // BUY — paying SUI to get DEEP
    orderType:          OrderType.IMMEDIATE_OR_CANCEL,
    selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
    payWithDeep:        false, // no DEEP yet — fees come from SUI
  })(buyTx);

  const buyResult = await execute(buyTx, kp);
  console.log(`[DeepBookAdmin] DEEP buy order placed  tx: ${buyResult.digest}`);

  // ── 7. Withdraw DEEP from BM to admin wallet ──────────────────────────────────
  // Wait for RPC finalisation, then withdraw
  await new Promise(r => setTimeout(r, 4000));

  const estimatedDeep = Math.max(0, affordableDeep * 0.90); // conservative (10 % fee buffer)
  if (estimatedDeep >= 1) {
    try {
      const withdrawTx = new Transaction();
      makeClient(addr, bmId).balanceManager.withdrawFromManager(
        'ADMIN_BM', 'DEEP', estimatedDeep, addr
      )(withdrawTx);
      await execute(withdrawTx, kp);
      console.log(`[DeepBookAdmin] Withdrew ~${estimatedDeep.toFixed(0)} DEEP from BM to wallet`);
    } catch (e: any) {
      console.warn(`[DeepBookAdmin] DEEP withdrawal skipped: ${e?.message}. DEEP remains in BM.`);
    }
  }

  // ── 8. Final balance ──────────────────────────────────────────────────────────
  await new Promise(r => setTimeout(r, 2000));
  const finalDeep  = await getDeepBalanceWallet(addr);
  const deepBought = Math.max(0, finalDeep - currentDeep);

  return {
    purchased:    true,
    deepAcquired: deepBought,
    deepInWallet: finalDeep,
    digest:       buyResult.digest,
    note: finalDeep >= POOL_CREATION_DEEP
      ? `✅ Purchased ${deepBought.toFixed(2)} DEEP. Wallet now has ${finalDeep.toFixed(2)} DEEP — ready for pool creation.`
      : `⚠️ Purchased ${deepBought.toFixed(2)} DEEP. Wallet has ${finalDeep.toFixed(2)} DEEP — ` +
        `still need ${(POOL_CREATION_DEEP - finalDeep).toFixed(0)} more DEEP. ` +
        `Send DEEP or more SUI to ${addr}`,
  };
}

// ── Full one-click setup ──────────────────────────────────────────────────────

export interface SetupResult {
  address:       string;
  deepPurchase?: BuyDeepResult;
  poolCreation?: { digest: string; poolId: string };
  bmCreation?:   { digest: string; bmId: string };
  suiDeposit?:   { digest: string };
  errors:        string[];
  poolId:        string | null;
  adminBmId:     string | null;
}

// Admin setup: creates the SBETS/SUI pool + BM for protocol admin duties.
// Admin never holds or deposits SBETS — limit orders are signed by users directly.
export async function runFullSetup(
  depositSui = 50,
): Promise<SetupResult> {
  const kp    = loadKeypair();
  const addr  = kp.toSuiAddress();
  const errors: string[] = [];

  let deepPurchase: BuyDeepResult | undefined;
  let poolCreation, bmCreation, suiDeposit;

  // 0. Auto-buy DEEP if needed for pool creation
  const needPool = !(getSbetsSuiPoolId() ?? loadConfig().poolId);
  if (needPool) {
    const deepBal = await getDeepBalanceWallet(addr);
    if (deepBal < POOL_CREATION_DEEP) {
      console.log(`[DeepBookAdmin] DEEP balance ${deepBal.toFixed(2)} < ${POOL_CREATION_DEEP} needed. Buying DEEP with SUI…`);
      try {
        deepPurchase = await buyDeepWithSui();
        if (!deepPurchase.purchased && deepPurchase.deepInWallet < POOL_CREATION_DEEP) {
          errors.push(`DEEP purchase: ${deepPurchase.note}`);
        }
      } catch (e: any) {
        errors.push(`DEEP purchase: ${e?.message}`);
      }
    }
  }

  // 1. Pool (only attempt if we now have enough DEEP)
  if (needPool) {
    const deepNow = await getDeepBalanceWallet(addr);
    if (deepNow >= POOL_CREATION_DEEP) {
      try { poolCreation = await createSbetsSuiPool(); }
      catch (e: any) { errors.push(`Pool: ${e?.message}`); }
    } else {
      errors.push(
        `Pool creation skipped — wallet has ${deepNow.toFixed(2)} DEEP but needs ${POOL_CREATION_DEEP}. ` +
        `Send at least ${(POOL_CREATION_DEEP - deepNow).toFixed(0)} DEEP (or ~${((POOL_CREATION_DEEP - deepNow) * 0.035).toFixed(2)} SUI worth) to ${addr}`
      );
    }
  } else {
    console.log('[DeepBookAdmin] Pool already configured — skipping creation');
  }

  // 2. Balance Manager
  if (!(process.env.DEEPBOOK_ADMIN_BM_ID ?? loadConfig().adminBmId)) {
    try { bmCreation = await createAdminBM(); }
    catch (e: any) { errors.push(`BM: ${e?.message}`); }
  } else {
    console.log('[DeepBookAdmin] BM already configured — skipping creation');
  }

  const bmId = process.env.DEEPBOOK_ADMIN_BM_ID ?? loadConfig().adminBmId;

  // 3. Deposit SUI for gas/protocol fees — admin never deposits SBETS
  if (bmId && depositSui > 0) {
    try { suiDeposit = await depositToBM('SUI', depositSui); }
    catch (e: any) { errors.push(`SUI deposit: ${e?.message}`); }
  }

  const final = loadConfig();
  return {
    address: addr,
    deepPurchase, poolCreation, bmCreation, suiDeposit, errors,
    poolId:    final.poolId   ?? getSbetsSuiPoolId() ?? null,
    adminBmId: final.adminBmId ?? process.env.DEEPBOOK_ADMIN_BM_ID ?? null,
  };
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getAdminStatus() {
  const cfg = loadConfig();
  let address = '';
  let keyOk   = false;
  try { address = loadKeypair().toSuiAddress(); keyOk = true; } catch {}

  return {
    address,
    keyConfigured:  keyOk,
    poolId:         cfg.poolId   ?? getSbetsSuiPoolId() ?? null,
    adminBmId:      cfg.adminBmId ?? process.env.DEEPBOOK_ADMIN_BM_ID ?? null,
    poolConfigured: !!(cfg.poolId ?? getSbetsSuiPoolId()),
    bmConfigured:   !!(cfg.adminBmId ?? process.env.DEEPBOOK_ADMIN_BM_ID),
    totalOrdersPosted: cfg.totalOrdersPosted ?? 0,
    poolCreatedAt:  cfg.poolCreatedAt,
    bmCreatedAt:    cfg.bmCreatedAt,
  };
}
