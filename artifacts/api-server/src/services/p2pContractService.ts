/**
 * p2pContractService.ts  v2
 *
 * Backend driver for the on-chain P2P betting contract (p2p_betting::p2p_betting v2).
 *
 * What's new vs v1:
 *   • Generic <T> coin type — SUI default, USDC or any Sui coin via SUI_COIN_TYPE /
 *     USDC_COIN_TYPE env vars.
 *   • Partial fills: each fill produces an independent P2PMatchedBet object.
 *     The service tracks bet IDs separately from offer IDs.
 *   • Two-step settlement: oracle queues → 2-hour dispute window → claim.
 *   • Dispute / resolve-dispute flow.
 *   • P2PRegistry shared object: exposes on-chain order-book counts.
 *
 * Environment variables required:
 *   P2P_PACKAGE_ID    – published package ID
 *   P2P_CONFIG_ID     – shared P2PConfig object ID
 *   P2P_REGISTRY_ID   – shared P2PRegistry object ID
 *   P2P_ORACLE_CAP_ID – OracleCap object held by admin wallet
 *   P2P_ADMIN_CAP_ID  – AdminCap object (fee withdrawal)
 *   ADMIN_PRIVATE_KEY – admin keypair (bech32 / base64 / hex)
 *   ADMIN_WALLET_ADDRESS – admin wallet address
 *
 * Optional:
 *   SUI_COIN_TYPE     – defaults to  "0x2::sui::SUI"
 *   USDC_COIN_TYPE    – e.g. "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
 */

import { Ed25519Keypair }       from '@mysten/sui/keypairs/ed25519';
import { Transaction }           from '@mysten/sui/transactions';
import { decodeSuiPrivateKey }   from '@mysten/sui/cryptography';
import { getSuiClient }          from '../lib/suiRpcConfig';

// ── Env ───────────────────────────────────────────────────────────────────────

// Hardcoded deployment IDs as fallbacks — these never change unless the contract
// is redeployed.  Env vars can still override them.
const DEPLOY_PACKAGE_ID  = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const DEPLOY_CONFIG_ID   = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const DEPLOY_REGISTRY_ID = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';

const P2P_PACKAGE_ID    = (process.env.P2P_PACKAGE_ID    || DEPLOY_PACKAGE_ID).trim();
const P2P_CONFIG_ID     = (process.env.P2P_CONFIG_ID     || DEPLOY_CONFIG_ID).trim();
const P2P_REGISTRY_ID   = (process.env.P2P_REGISTRY_ID   || DEPLOY_REGISTRY_ID).trim();
const P2P_ORACLE_CAP_ID = (process.env.P2P_ORACLE_CAP_ID || '').trim();
const ADMIN_PRIVATE_KEY = (process.env.ADMIN_PRIVATE_KEY  || '').trim();

/** Default coin type for SUI — fully-qualified for Move type arguments */
export const SUI_COIN_TYPE  =
  (process.env.SUI_COIN_TYPE  || '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI').trim();

/** Circle USDC on Sui mainnet */
export const USDC_COIN_TYPE =
  (process.env.USDC_COIN_TYPE || '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC').trim();

/** SuiBets native token — 9 decimals */
export const SBETS_COIN_TYPE =
  (process.env.SBETS_COIN_TYPE ||
    '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS').trim();

/** USDSui stablecoin on Sui mainnet — 6 decimals */
export const USDSUI_COIN_TYPE =
  (process.env.USDSUI_COIN_TYPE ||
    '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI').trim();

/** Lombard LBTC on Sui mainnet — 8 decimals (Bitcoin-standard) */
export const LBTC_COIN_TYPE =
  (process.env.LBTC_COIN_TYPE ||
    '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC').trim();

// Well-known shared clock on Sui mainnet
const SUI_CLOCK_ID = '0x0000000000000000000000000000000000000000000000000000000000000006';

// ── On-chain status codes (mirrors p2p_betting.move constants) ───────────────

export const ONCHAIN_STATUS = {
  OPEN:        0,
  FILLED:      1,
  MATCHED:     2,
  SETTLING:    3,
  MAKER_WON:   4,
  TAKER_WON:   5,
  VOID:        6,
  CANCELLED:   7,
  EXPIRED:     8,
  DISPUTED:    9,
} as const;

const ONCHAIN_STATUS_LABELS: Record<number, string> = {
  0: 'open', 1: 'filled', 2: 'matched', 3: 'settling',
  4: 'maker_won', 5: 'taker_won', 6: 'void', 7: 'cancelled', 8: 'expired', 9: 'disputed',
};

export type OnchainOfferState = {
  objectId:        string;
  makerStakeTotal: number; // base units (MIST / SBETS / USDSUI smallest)
  makerRemaining:  number; // base units — unfilled portion
  filledAmount:    number; // base units — makerStakeTotal − makerRemaining
  filledTaker:     number; // base units — taker-side matched so far
  matchCount:      number;
  status:          number;
  statusLabel:     string;
  oddsBps:         number;
  expiresAt:       number; // Unix ms
  isOpen:          boolean;
};

export type OnchainParlayState = {
  objectId:      string;
  makerStake:    number; // current escrowed maker balance (0 if taken)
  takerRequired: number; // how much taker must deposit
  takerBalance:  number; // current escrowed taker balance
  hasBeenTaken:  boolean;
  takerAddress?: string; // address of the taker if already taken
  status:        number;
  statusLabel:   string;
  legsSettled:   number;
  legStatuses:   number[];
  expiresAt:     number;
};

// ── Readiness ────────────────────────────────────────────────────────────────

// Full settlement (oracle settle/void) requires OracleCap
const isConfigured = Boolean(
  P2P_PACKAGE_ID && P2P_CONFIG_ID && P2P_REGISTRY_ID && P2P_ORACLE_CAP_ID && ADMIN_PRIVATE_KEY
);

// expire_offer / expire_parlay are permissionless (no OracleCap) — only need
// the package, registry, admin key (to pay gas), and the offer object ID.
const isExpireEnabled = Boolean(P2P_PACKAGE_ID && P2P_REGISTRY_ID && ADMIN_PRIVATE_KEY);

if (isConfigured) {
  console.log(`📦 P2P Contract Package  : ${P2P_PACKAGE_ID.slice(0, 14)}...`);
  console.log(`🏛️  P2P Config Object    : ${P2P_CONFIG_ID.slice(0, 14)}...`);
  console.log(`📖 P2P Registry Object   : ${P2P_REGISTRY_ID.slice(0, 14)}...`);
  console.log(`🔮 P2P Oracle Cap        : ${P2P_ORACLE_CAP_ID.slice(0, 14)}...`);
  console.log('✅ P2P on-chain settlement v2: ENABLED (generics + dispute window)');
} else if (isExpireEnabled) {
  console.log(`📦 P2P Contract Package  : ${P2P_PACKAGE_ID.slice(0, 14)}...`);
  console.log(`📖 P2P Registry Object   : ${P2P_REGISTRY_ID.slice(0, 14)}...`);
  console.log('⚠️  P2P oracle settlement disabled (no ORACLE_CAP_ID). expire_offer/expire_parlay: ENABLED.');
} else {
  console.warn('⚠️  P2P contract env vars not fully set — on-chain P2P settlement disabled. Set P2P_PACKAGE_ID, P2P_REGISTRY_ID, ADMIN_PRIVATE_KEY at minimum.');
}

// ── Keypair helper ───────────────────────────────────────────────────────────

function buildAdminKeypair(): Ed25519Keypair {
  const raw = ADMIN_PRIVATE_KEY;
  if (raw.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(raw);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  let bytes: Uint8Array;
  if (raw.startsWith('0x')) {
    bytes = new Uint8Array(Buffer.from(raw.slice(2), 'hex'));
  } else {
    bytes = new Uint8Array(Buffer.from(raw, 'base64'));
  }
  if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
  if (bytes.length === 65 && bytes[0] === 0) bytes = bytes.slice(1, 33);
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(bytes);
}

// ── Internal: sign + execute ─────────────────────────────────────────────────

type TxResult = { txHash: string; success: boolean; error?: string };

async function signAndExecute(tx: Transaction): Promise<TxResult> {
  try {
    const suiClient = getSuiClient();
    const keypair   = buildAdminKeypair();
    tx.setGasBudget(50_000_000); // 0.05 SUI ceiling

    const result = await (suiClient as any).signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
    });

    const status = result?.effects?.status?.status;
    if (status !== 'success') {
      const errMsg = result?.effects?.status?.error ?? 'unknown on-chain error';
      console.error('[P2PContract] TX failed:', errMsg);
      return { txHash: result?.digest ?? '', success: false, error: errMsg };
    }
    console.log(`[P2PContract] ✅ TX: ${result.digest}`);
    return { txHash: result.digest, success: true };
  } catch (err: any) {
    console.error('[P2PContract] signAndExecute error:', err.message);
    return { txHash: '', success: false, error: err.message };
  }
}

// ── Helper to extract the new object ID from a publishedmoveCall ─────────────

async function extractCreatedObjectId(txResult: TxResult, objectType: string): Promise<string | null> {
  if (!txResult.success) return null;
  try {
    const suiClient = getSuiClient();
    const res = await (suiClient as any).getTransactionBlock({
      digest: txResult.txHash,
      options: { showObjectChanges: true },
    });
    const created = res?.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes(objectType)
    );
    return created?.objectId ?? null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

export const p2pContractService = {

  isEnabled(): boolean { return isConfigured; },

  getSuiCoinType():    string { return SUI_COIN_TYPE; },
  getUsdcCoinType():   string { return USDC_COIN_TYPE; },
  getSbetsCoinType():  string { return SBETS_COIN_TYPE; },
  getUsdsuiCoinType(): string { return USDSUI_COIN_TYPE; },

  /** Resolve a short symbol (SUI/SBETS/USDSUI/USDC/LBTC) to its full coin type string */
  resolveCoinType(symbol: string): string {
    switch ((symbol || '').toUpperCase()) {
      case 'SUI':    return SUI_COIN_TYPE;
      case 'SBETS':  return SBETS_COIN_TYPE;
      case 'USDSUI': return USDSUI_COIN_TYPE;
      case 'USDC':   return USDC_COIN_TYPE || SUI_COIN_TYPE;
      case 'LBTC':   return LBTC_COIN_TYPE;
      default:       return symbol.includes('::') ? symbol : SUI_COIN_TYPE;
    }
  },

  /** Alias for resolveCoinType — used by admin routes */
  currencyToCoinType(symbol: string): string {
    return this.resolveCoinType(symbol);
  },

  // ── Registry queries ──────────────────────────────────────────────────────

  /**
   * Query on-chain registry counters and open IDs from Sui RPC.
   * Returns the counts of open offers, live bets, and open parlays.
   */
  async getRegistryStats(): Promise<{
    openOffers: number;
    liveBets: number;
    openParlays: number;
    packageId: string | null;
    configId: string | null;
    registryId: string | null;
  }> {
    const base = {
      openOffers: 0,
      liveBets: 0,
      openParlays: 0,
      packageId:   P2P_PACKAGE_ID   || null,
      configId:    P2P_CONFIG_ID    || null,
      registryId:  P2P_REGISTRY_ID  || null,
    };
    if (!isConfigured) return base;
    try {
      const suiClient = getSuiClient();
      const obj = await (suiClient as any).getObject({
        id: P2P_REGISTRY_ID,
        options: { showContent: true },
      });
      const fields = obj?.data?.content?.fields;
      if (!fields) return base;
      return {
        ...base,
        openOffers:  Number(fields.open_offers?.fields?.size  ?? 0),
        liveBets:    Number(fields.live_bets?.fields?.size    ?? 0),
        openParlays: Number(fields.open_parlays?.fields?.size ?? 0),
      };
    } catch (err: any) {
      console.error('[P2PContract] getRegistryStats error:', err.message);
      return base;
    }
  },

  /**
   * Fetch on-chain offer IDs from the open_offers Table in the registry.
   * Returns at most `limit` IDs (newest first from dynamic fields).
   */
  async getOpenOfferIds(limit = 50): Promise<string[]> {
    if (!isConfigured) return [];
    try {
      const suiClient = getSuiClient();
      const dfs = await (suiClient as any).getDynamicFields({ parentId: P2P_REGISTRY_ID });
      return (dfs?.data ?? [])
        .slice(0, limit)
        .map((f: any) => f.name?.value ?? '')
        .filter(Boolean);
    } catch { return []; }
  },

  // ── Live on-chain state queries ───────────────────────────────────────────

  /**
   * Fetch the live state of a single P2POffer object from Sui RPC.
   * Returns null if the object is not found or not a P2POffer.
   */
  async getOnchainOfferState(objectId: string): Promise<OnchainOfferState | null> {
    try {
      const suiClient = getSuiClient();
      const obj = await (suiClient as any).getObject({
        id: objectId,
        options: { showContent: true },
      });
      const fields = obj?.data?.content?.fields;
      if (!fields) return null;
      const makerStakeTotal = Number(fields.maker_stake_total ?? 0);
      // maker_remaining is serialized as plain u64 string on-chain (not a nested Balance struct)
      const makerRemaining  = Number(fields.maker_remaining?.fields?.value ?? fields.maker_remaining ?? 0);
      const filledAmount    = makerStakeTotal - makerRemaining;
      const filledTaker     = Number(fields.filled_taker ?? 0);
      const matchCount      = Number(fields.match_count  ?? 0);
      const status          = Number(fields.status       ?? 0);
      const oddsBps         = Number(fields.odds_bps     ?? 0);
      const expiresAt       = Number(fields.expires_at   ?? 0);
      return {
        objectId, makerStakeTotal, makerRemaining, filledAmount,
        filledTaker, matchCount, status,
        statusLabel: ONCHAIN_STATUS_LABELS[status] ?? 'unknown',
        oddsBps, expiresAt, isOpen: status === ONCHAIN_STATUS.OPEN,
      };
    } catch (err: any) {
      console.warn(`[P2PContract] getOnchainOfferState(${objectId}) failed:`, err.message);
      return null;
    }
  },

  /**
   * Fetch the live state of a single P2PParlay object from Sui RPC.
   */
  async getOnchainParlayState(objectId: string): Promise<OnchainParlayState | null> {
    try {
      const suiClient = getSuiClient();
      const obj = await (suiClient as any).getObject({
        id: objectId,
        options: { showContent: true },
      });
      const fields = obj?.data?.content?.fields;
      if (!fields) return null;
      // maker_stake and taker_balance are plain u64 strings on-chain (not nested Balance structs)
      const makerStake    = Number(fields.maker_stake?.fields?.value   ?? fields.maker_stake    ?? 0);
      const takerRequired = Number(fields.taker_required ?? 0);
      const takerBalance  = Number(fields.taker_balance?.fields?.value ?? fields.taker_balance  ?? 0);
      const status        = Number(fields.status      ?? 0);
      const legsSettled   = Number(fields.legs_settled ?? 0);
      const expiresAt     = Number(fields.expires_at  ?? 0);
      const legStatuses   = Array.isArray(fields.leg_statuses)
        ? (fields.leg_statuses as any[]).map(Number) : [];
      // taker is null when not taken; plain address string or Option vec when taken
      const takerOption = fields.taker;
      const hasBeenTaken = !!(takerOption !== null && takerOption !== undefined &&
        (typeof takerOption === 'string' ||
         (typeof takerOption === 'object' &&
          (takerOption.fields?.vec?.length > 0 || takerOption.vec?.length > 0))));
      let takerAddress: string | undefined;
      if (hasBeenTaken) {
        if (typeof takerOption === 'string') {
          takerAddress = takerOption;
        } else if (takerOption && typeof takerOption === 'object') {
          takerAddress = takerOption.fields?.vec?.[0] ?? takerOption.vec?.[0] ?? undefined;
        }
      }
      return {
        objectId, makerStake, takerRequired, takerBalance, hasBeenTaken, takerAddress,
        status, statusLabel: ONCHAIN_STATUS_LABELS[status] ?? 'unknown',
        legsSettled, legStatuses, expiresAt,
      };
    } catch (err: any) {
      console.warn(`[P2PContract] getOnchainParlayState(${objectId}) failed:`, err.message);
      return null;
    }
  },

  /**
   * Batch-fetch on-chain offer states for up to 50 P2POffer objects at once.
   * Returns a Map<objectId, OnchainOfferState>.
   */
  async batchGetOnchainOfferStates(objectIds: string[]): Promise<Map<string, OnchainOfferState>> {
    const result = new Map<string, OnchainOfferState>();
    if (!objectIds.length) return result;
    try {
      const suiClient = getSuiClient();
      const CHUNK = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < objectIds.length; i += CHUNK) chunks.push(objectIds.slice(i, i + CHUNK));
      const allFetched: any[] = [];
      for (const chunk of chunks) {
        const fetched = await (suiClient as any).multiGetObjects({ ids: chunk, options: { showContent: true } });
        allFetched.push(...(fetched ?? []));
      }
      const objects: any[] = allFetched;
      for (const obj of objects ?? []) {
        const fields = obj?.data?.content?.fields;
        const id     = obj?.data?.objectId;
        if (!fields || !id) continue;
        const makerStakeTotal = Number(fields.maker_stake_total ?? 0);
        // maker_remaining is serialized as plain u64 string on-chain (not a nested Balance struct)
        const makerRemaining  = Number(fields.maker_remaining?.fields?.value ?? fields.maker_remaining ?? 0);
        const filledAmount    = makerStakeTotal - makerRemaining;
        const filledTaker     = Number(fields.filled_taker ?? 0);
        const matchCount      = Number(fields.match_count  ?? 0);
        const status          = Number(fields.status       ?? 0);
        const oddsBps         = Number(fields.odds_bps     ?? 0);
        const expiresAt       = Number(fields.expires_at   ?? 0);
        result.set(id, {
          objectId: id, makerStakeTotal, makerRemaining, filledAmount,
          filledTaker, matchCount, status,
          statusLabel: ONCHAIN_STATUS_LABELS[status] ?? 'unknown',
          oddsBps, expiresAt, isOpen: status === ONCHAIN_STATUS.OPEN,
        });
      }
    } catch (err: any) {
      console.warn('[P2PContract] batchGetOnchainOfferStates failed:', err.message);
    }
    return result;
  },

  /**
   * Batch-fetch on-chain parlay states for multiple P2PParlay objects.
   * Returns a Map<objectId, OnchainParlayState>.
   */
  async batchGetOnchainParlayStates(objectIds: string[]): Promise<Map<string, OnchainParlayState>> {
    const result = new Map<string, OnchainParlayState>();
    if (!objectIds.length) return result;
    try {
      const suiClient = getSuiClient();
      const CHUNK = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < objectIds.length; i += CHUNK) chunks.push(objectIds.slice(i, i + CHUNK));
      const allFetched: any[] = [];
      for (const chunk of chunks) {
        const fetched = await (suiClient as any).multiGetObjects({ ids: chunk, options: { showContent: true } });
        allFetched.push(...(fetched ?? []));
      }
      const objects: any[] = allFetched;
      for (const obj of objects ?? []) {
        const fields = obj?.data?.content?.fields;
        const id     = obj?.data?.objectId;
        if (!fields || !id) continue;
        // maker_stake and taker_balance are plain u64 strings on-chain (not nested Balance structs)
        const makerStake    = Number(fields.maker_stake?.fields?.value   ?? fields.maker_stake    ?? 0);
        const takerRequired = Number(fields.taker_required ?? 0);
        const takerBalance  = Number(fields.taker_balance?.fields?.value ?? fields.taker_balance  ?? 0);
        const status        = Number(fields.status      ?? 0);
        const legsSettled   = Number(fields.legs_settled ?? 0);
        const expiresAt     = Number(fields.expires_at  ?? 0);
        const legStatuses   = Array.isArray(fields.leg_statuses)
          ? (fields.leg_statuses as any[]).map(Number) : [];
        const takerOption = fields.taker;
        const hasBeenTaken = !!(takerOption !== null && takerOption !== undefined &&
          (typeof takerOption === 'string' ||
           (typeof takerOption === 'object' &&
            (takerOption.fields?.vec?.length > 0 || takerOption.vec?.length > 0))));
        result.set(id, {
          objectId: id, makerStake, takerRequired, takerBalance, hasBeenTaken,
          status, statusLabel: ONCHAIN_STATUS_LABELS[status] ?? 'unknown',
          legsSettled, legStatuses, expiresAt,
        });
      }
    } catch (err: any) {
      console.warn('[P2PContract] batchGetOnchainParlayStates failed:', err.message);
    }
    return result;
  },

  // ── Single offer lifecycle ────────────────────────────────────────────────

  /**
   * Queue settlement for a P2PMatchedBet (starts the 2-hour dispute window).
   * betId is the on-chain P2PMatchedBet object ID.
   * makerWins = true → maker predicted correctly.
   */
  async queueSettleBet(betId: string, makerWins: boolean, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::queue_settle_bet`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(P2P_CONFIG_ID),
        tx.object(betId),
        tx.pure.bool(makerWins),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /**
   * Claim the settlement after the dispute window has elapsed (no active dispute).
   * Anyone can call this — the payout flows directly to the winner from the contract.
   */
  async claimSettlement(betId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::claim_settlement`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_CONFIG_ID),
        tx.object(P2P_REGISTRY_ID),
        tx.object(betId),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /**
   * Settle a matched bet via OracleCap.
   * SERVER-SIDE DISPUTE WINDOW GUARD: if matchedAtMs is provided, this function
   * enforces a 2-hour minimum before calling instant_settle_bet, mitigating the
   * risk of a compromised oracle key being used to settle bets prematurely.
   * The window may be reduced via DISPUTE_WINDOW_OVERRIDE_MS env var (emergency only).
   */
  async settleOffer(
    betId: string,
    makerWins: boolean,
    coinType = SUI_COIN_TYPE,
    matchedAtMs?: number,
  ): Promise<TxResult> {
    const DISPUTE_WINDOW_MS = Number(process.env.DISPUTE_WINDOW_OVERRIDE_MS) || 2 * 60 * 60 * 1000;
    if (matchedAtMs !== undefined) {
      const elapsed = Date.now() - matchedAtMs;
      if (elapsed < DISPUTE_WINDOW_MS) {
        const remainingSec = Math.ceil((DISPUTE_WINDOW_MS - elapsed) / 1000);
        console.warn(`[P2PContract] ⛔ settleOffer blocked — dispute window still open for ${betId.slice(0, 16)}... (${remainingSec}s remaining)`);
        return {
          txHash: '',
          success: false,
          error: `DISPUTE_WINDOW_ACTIVE:${remainingSec}s — settlement blocked until dispute window closes`,
        };
      }
    }
    return this.instantSettleBet(betId, makerWins, coinType);
  },

  /**
   * Resolve a disputed bet as oracle (overrides the challenger's flag).
   */
  async resolveDispute(betId: string, makerWins: boolean, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::resolve_dispute`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(P2P_CONFIG_ID),
        tx.object(betId),
        tx.pure.bool(makerWins),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /** Void a matched bet — full refunds to both parties. */
  async voidBet(betId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };

    // Pre-check on-chain state before submitting TX.
    // Prevents EAlreadySettled (abort 11), TypeMismatch (object consumed/deleted),
    // and wastes no gas on bets already in a terminal state.
    // Terminal statuses: MAKER_WON=4, TAKER_WON=5, VOID=6, CANCELLED=7, EXPIRED=8
    try {
      const suiClient = getSuiClient();
      const obj = await (suiClient as any).getObject({ id: betId, options: { showContent: true } });
      const fields = obj?.data?.content?.fields;
      if (!fields) {
        // Object not found or already consumed — bet already finalized on-chain
        return { txHash: '', success: false, error: 'ALREADY_TERMINAL:object_not_found' };
      }
      const status = Number(fields.status ?? 0);
      if (status >= 4) {
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:status=${status}` };
      }
    } catch (checkErr: any) {
      console.warn(`[P2PContract] voidBet state-check failed for ${betId.slice(0, 16)}...: ${checkErr.message} — attempting void anyway`);
    }

    // Retry up to 3 times for stale object version errors.
    // Shared objects (P2PRegistry, P2PConfig) get version-bumped by concurrent TXs;
    // rebuilding the Transaction fetches the latest version from the RPC.
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1500 * attempt));
      const tx = new Transaction();
      tx.moveCall({
        target:        `${P2P_PACKAGE_ID}::p2p_betting::void_bet`,
        typeArguments: [coinType],
        arguments: [
          tx.object(P2P_ORACLE_CAP_ID),
          tx.object(P2P_CONFIG_ID),
          tx.object(P2P_REGISTRY_ID),
          tx.object(betId),
          tx.object(SUI_CLOCK_ID),
        ],
      });
      const result = await signAndExecute(tx);
      if (result.success) return result;
      // Abort 11 = EAlreadySettled — bet already in terminal state; surface as ALREADY_TERMINAL
      const errStr = result.error ?? '';
      if (/},\s*11\)/.test(errStr)) {
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:abort_in_voidBet(11)` };
      }
      // TypeMismatch on betId = object is from an old package version and is incompatible.
      // These bets can never be voided via the current package — treat as terminal.
      if (errStr.includes('TypeMismatch')) {
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:type_mismatch_old_package` };
      }
      const isVersionMismatch = errStr.includes('unavailable for consumption') ||
                                errStr.includes('needs to be rebuilt');
      if (!isVersionMismatch || attempt === 3) return result;
      console.log(`[P2PContract] voidBet stale-version retry ${attempt}/3 for ${betId.slice(0, 16)}...`);
    }
    return { txHash: '', success: false, error: 'voidBet: max retries exceeded' };
  },

  /** Legacy alias used by existing p2pBettingService settlement path */
  async voidOffer(betId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    return this.voidBet(betId, coinType);
  },

  // ── Permissionless expiry (no OracleCap required) ─────────────────────────

  /**
   * Expire an open/unfilled offer whose expiry timestamp has passed.
   * Permissionless — anyone can call this; admin signs only to pay gas.
   * The contract returns the maker's escrowed SUI directly to their wallet.
   *
   * Signature: expire_offer<T>(offer: &mut P2POffer<T>, registry: &mut P2PRegistry,
   *                             clock: &Clock, ctx: &mut TxContext)
   */
  async expireOffer(offerId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isExpireEnabled) {
      return { txHash: '', success: false, error: 'expire_offer not available — set ADMIN_PRIVATE_KEY' };
    }

    // Pre-check on-chain offer state.
    // If the offer is not STATUS_OPEN (0), expire_offer will abort with EOfferNotOpen (5).
    // This happens when an offer was already filled, cancelled, or expired on a prior attempt.
    // Catch it here to avoid wasting gas and logging noisy errors.
    // STATUS_OPEN=0, STATUS_FILLED=1, STATUS_EXPIRED=8, STATUS_CANCELLED=7, etc.
    try {
      const suiClient = getSuiClient();
      const obj = await (suiClient as any).getObject({ id: offerId, options: { showContent: true } });
      const fields = obj?.data?.content?.fields;
      if (!fields) {
        return { txHash: '', success: false, error: 'ALREADY_TERMINAL:object_not_found' };
      }
      const status = Number(fields.status ?? 0);
      if (status !== 0) {
        // Not OPEN — already filled, expired, cancelled etc. Funds already handled.
        console.log(`[P2PContract] expireOffer pre-check: offer ${offerId.slice(0, 16)}... not OPEN (status=${status}) — skipping TX`);
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:status=${status}` };
      }
    } catch (checkErr: any) {
      console.warn(`[P2PContract] expireOffer state-check failed for ${offerId.slice(0, 16)}...: ${checkErr.message} — attempting expire anyway`);
    }

    // Retry up to 3 times when Sui reports a stale object version ("unavailable for consumption").
    // Each attempt rebuilds a fresh Transaction so the SDK re-fetches the latest object version.
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1500 * attempt));
      const tx = new Transaction();
      tx.setGasBudget(30_000_000);
      tx.moveCall({
        target:        `${P2P_PACKAGE_ID}::p2p_betting::expire_offer`,
        typeArguments: [coinType],
        arguments: [
          tx.object(offerId),
          tx.object(P2P_REGISTRY_ID),
          tx.object(SUI_CLOCK_ID),
        ],
      });
      const result = await signAndExecute(tx);
      if (result.success) return result;
      // Abort 5 = EOfferNotOpen (offer already filled/cancelled/expired on-chain)
      // Abort 11 = EAlreadySettled — surface both as ALREADY_TERMINAL so callers skip retry
      const errStr = result.error ?? '';
      if (/},\s*5\)/.test(errStr) || /},\s*11\)/.test(errStr)) {
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:abort_in_expireOffer(${errStr.match(/},\s*(\d+)\)/)?.[1] ?? '?'})` };
      }
      const isVersionMismatch = errStr.includes('unavailable for consumption') ||
                                errStr.includes('needs to be rebuilt');
      if (!isVersionMismatch || attempt === 3) return result;
      console.log(`[P2PContract] expireOffer stale-version retry ${attempt}/3 for ${offerId}`);
    }
    return { txHash: '', success: false, error: 'expireOffer: max retries exceeded' };
  },

  /**
   * Expire an open/unfilled parlay whose expiry timestamp has passed.
   * Permissionless — same model as expireOffer.
   *
   * Signature: expire_parlay<T>(parlay: &mut P2PParlay<T>, registry: &mut P2PRegistry,
   *                              clock: &Clock, ctx: &mut TxContext)
   */
  async expireParlay(parlayId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isExpireEnabled) {
      return { txHash: '', success: false, error: 'expire_parlay not available — set ADMIN_PRIVATE_KEY' };
    }

    // expireParlay pre-check: read on-chain parlay status before submitting TX.
    // expire_parlay aborts with EOfferNotOpen (5) when the parlay is already filled,
    // cancelled, or expired — same as expireOffer. Catch it here to avoid wasting gas.
    try {
      const suiClient = getSuiClient();
      const obj = await (suiClient as any).getObject({ id: parlayId, options: { showContent: true } });
      const fields = obj?.data?.content?.fields;
      if (!fields) {
        return { txHash: '', success: false, error: 'ALREADY_TERMINAL:object_not_found' };
      }
      const status = Number(fields.status ?? 0);
      if (status !== 0) {
        console.log(`[P2PContract] expireParlay pre-check: parlay ${parlayId.slice(0, 16)}... not OPEN (status=${status}) — skipping TX`);
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:status=${status}` };
      }
    } catch (checkErr: any) {
      console.warn(`[P2PContract] expireParlay state-check failed for ${parlayId.slice(0, 16)}...: ${checkErr.message} — attempting expire anyway`);
    }

    // Retry up to 3 times when Sui reports a stale object version ("unavailable for consumption").
    // Each attempt rebuilds a fresh Transaction so the SDK re-fetches the latest object version.
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1500 * attempt));
      const tx = new Transaction();
      tx.setGasBudget(30_000_000);
      tx.moveCall({
        target:        `${P2P_PACKAGE_ID}::p2p_betting::expire_parlay`,
        typeArguments: [coinType],
        arguments: [
          tx.object(parlayId),
          tx.object(P2P_REGISTRY_ID),
          tx.object(SUI_CLOCK_ID),
        ],
      });
      const result = await signAndExecute(tx);
      if (result.success) return result;
      // Abort 5 = EOfferNotOpen (parlay already filled/cancelled/expired on-chain)
      // Abort 11 = EAlreadySettled — surface both as ALREADY_TERMINAL so callers skip retry
      const errStr = result.error ?? '';
      if (/},\s*5\)/.test(errStr) || /},\s*11\)/.test(errStr)) {
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:abort_in_expireParlay(${errStr.match(/},\s*(\d+)\)/)?.[1] ?? '?'})` };
      }
      const isVersionMismatch = errStr.includes('unavailable for consumption') ||
                                errStr.includes('needs to be rebuilt');
      if (!isVersionMismatch || attempt === 3) return result;
      console.log(`[P2PContract] expireParlay stale-version retry ${attempt}/3 for ${parlayId}`);
    }
    return { txHash: '', success: false, error: 'expireParlay: max retries exceeded' };
  },

  // ── Instant settle (no dispute window) ───────────────────────────────────

  /**
   * Oracle instantly settles a matched bet — winner paid immediately.
   * No 2-hour wait. Use when oracle result is authoritative.
   * Retries up to 3× on stale shared-object version errors.
   */
  async instantSettleBet(betId: string, makerWins: boolean, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };

    // Pre-check on-chain state before submitting TX.
    // Prevents EAlreadySettled (abort 11) when a bet was already settled on a
    // previous attempt whose TX result was lost (e.g. network timeout after success).
    // Terminal statuses: MAKER_WON=4, TAKER_WON=5, VOID=6, CANCELLED=7, EXPIRED=8
    try {
      const suiClient = getSuiClient();
      const obj = await (suiClient as any).getObject({ id: betId, options: { showContent: true } });
      const fields = obj?.data?.content?.fields;
      if (!fields) {
        return { txHash: '', success: false, error: 'ALREADY_TERMINAL:object_not_found' };
      }
      const status = Number(fields.status ?? 0);
      if (status >= 4) {
        console.log(`[P2PContract] instantSettleBet pre-check: bet ${betId.slice(0, 16)}... already terminal (status=${status}) — skipping TX`);
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:status=${status}` };
      }
    } catch (checkErr: any) {
      console.warn(`[P2PContract] instantSettleBet state-check failed for ${betId.slice(0, 16)}...: ${checkErr.message} — attempting settle anyway`);
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1500 * attempt));
      const tx = new Transaction();
      tx.moveCall({
        target:        `${P2P_PACKAGE_ID}::p2p_betting::instant_settle_bet`,
        typeArguments: [coinType],
        arguments: [
          tx.object(P2P_ORACLE_CAP_ID),
          tx.object(P2P_CONFIG_ID),
          tx.object(P2P_REGISTRY_ID),
          tx.object(betId),
          tx.pure.bool(makerWins),
          tx.object(SUI_CLOCK_ID),
        ],
      });
      const result = await signAndExecute(tx);
      if (result.success) return result;
      // Abort 11 = EAlreadySettled — bet already in terminal state; surface as ALREADY_TERMINAL
      const errStr = result.error ?? '';
      if (/},\s*11\)/.test(errStr)) {
        return { txHash: '', success: false, error: `ALREADY_TERMINAL:abort_in_instantSettleBet(11)` };
      }
      const isVersionMismatch = errStr.includes('unavailable for consumption') ||
                                errStr.includes('needs to be rebuilt');
      if (!isVersionMismatch || attempt === 3) return result;
      console.log(`[P2PContract] instantSettleBet stale-version retry ${attempt}/3 for ${betId.slice(0, 16)}...`);
    }
    return { txHash: '', success: false, error: 'instantSettleBet: max retries exceeded' };
  },

  /**
   * Oracle instantly voids a matched bet — full refunds, no dispute window.
   */
  async instantVoidBet(betId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::instant_void_bet`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(P2P_CONFIG_ID),
        tx.object(P2P_REGISTRY_ID),
        tx.object(betId),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /**
   * Oracle instantly finalizes a parlay — winner paid immediately.
   * makerWins = true if ALL legs won.
   */
  async instantSettleParlay(parlayId: string, makerWins: boolean, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1500 * attempt));
      const tx = new Transaction();
      tx.moveCall({
        target:        `${P2P_PACKAGE_ID}::p2p_betting::instant_settle_parlay`,
        typeArguments: [coinType],
        arguments: [
          tx.object(P2P_ORACLE_CAP_ID),
          tx.object(P2P_CONFIG_ID),
          tx.object(P2P_REGISTRY_ID),
          tx.object(parlayId),
          tx.pure.bool(makerWins),
          tx.object(SUI_CLOCK_ID),
        ],
      });
      const result = await signAndExecute(tx);
      if (result.success) return result;
      const isVersionMismatch = result.error?.includes('unavailable for consumption') ||
                                result.error?.includes('needs to be rebuilt');
      if (!isVersionMismatch || attempt === 3) return result;
      console.log(`[P2PContract] instantSettleParlay stale-version retry ${attempt}/3 for parlay ${parlayId.slice(0, 16)}...`);
    }
    return { txHash: '', success: false, error: 'instantSettleParlay: max retries exceeded' };
  },

  // ── Multi-sig fee withdrawal ───────────────────────────────────────────────

  /**
   * Step 1 of multi-sig withdrawal: AdminCap proposes a fee withdrawal.
   * Creates a shared WithdrawalProposal object on-chain.
   * The OracleCap holder must countersign via executeWithdrawal.
   */
  async proposeWithdrawal(amountMist: number, recipient: string, coinType = SUI_COIN_TYPE): Promise<TxResult & { proposalId?: string }> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const adminCapId = process.env.P2P_ADMIN_CAP_ID || '';
    if (!adminCapId) return { txHash: '', success: false, error: 'P2P_ADMIN_CAP_ID not set' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::propose_withdrawal`,
      typeArguments: [coinType],
      arguments: [
        tx.object(adminCapId),
        tx.object(P2P_CONFIG_ID),
        tx.pure.u64(amountMist),
        tx.pure.address(recipient),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    const result = await signAndExecute(tx);
    if (!result.success) return result;
    const proposalId = await extractCreatedObjectId(result, 'WithdrawalProposal');
    return { ...result, proposalId: proposalId ?? undefined };
  },

  /**
   * Step 2 of multi-sig withdrawal: OracleCap countersigns and releases funds.
   * proposalId = the shared WithdrawalProposal object ID from step 1.
   */
  async executeWithdrawal(proposalId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::execute_withdrawal`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(P2P_CONFIG_ID),
        tx.object(proposalId),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  // ── Parlay lifecycle ──────────────────────────────────────────────────────

  /**
   * Settle one leg of a matched on-chain parlay.
   * legIndex is 0-based.
   */
  async settleParlayLeg(
    parlayId:  string,
    legIndex:  number,
    legWon:    boolean,
    coinType = SUI_COIN_TYPE,
  ): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1500 * attempt));
      const tx = new Transaction();
      tx.moveCall({
        target:        `${P2P_PACKAGE_ID}::p2p_betting::settle_parlay_leg`,
        typeArguments: [coinType],
        arguments: [
          tx.object(P2P_ORACLE_CAP_ID),
          tx.object(parlayId),
          tx.pure.u64(legIndex),
          tx.pure.bool(legWon),
          tx.object(SUI_CLOCK_ID),
        ],
      });
      const result = await signAndExecute(tx);
      if (result.success) return result;
      const isVersionMismatch = result.error?.includes('unavailable for consumption') ||
                                result.error?.includes('needs to be rebuilt');
      if (!isVersionMismatch || attempt === 3) return result;
      console.log(`[P2PContract] settleParlayLeg stale-version retry ${attempt}/3 for parlay ${parlayId.slice(0, 16)}... leg ${legIndex}`);
    }
    return { txHash: '', success: false, error: 'settleParlayLeg: max retries exceeded' };
  },

  /** Void one leg (match postponed / cancelled). */
  async voidParlayLeg(parlayId: string, legIndex: number, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::void_parlay_leg`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(parlayId),
        tx.pure.u64(legIndex),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /**
   * Queue finalization of a parlay after all legs are settled/voided.
   * Starts the dispute window. After the window, call claimParlay.
   */
  async queueFinalizeParlay(parlayId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::queue_finalize_parlay`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(P2P_CONFIG_ID),
        tx.object(parlayId),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /** Claim parlay payout after the dispute window passes. */
  async claimParlay(parlayId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::claim_parlay`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_CONFIG_ID),
        tx.object(P2P_REGISTRY_ID),
        tx.object(parlayId),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /**
   * Finalize a parlay immediately via OracleCap (instant_settle_parlay).
   * Bypasses the 2-hour dispute window — winner paid on the same tx.
   */
  async finalizeParlay(parlayId: string, makerWins = true, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    return this.instantSettleParlay(parlayId, makerWins, coinType);
  },

  /** Resolve a disputed parlay. */
  async resolveParlayDispute(parlayId: string, makerWins: boolean, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::resolve_parlay_dispute`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(P2P_CONFIG_ID),
        tx.object(parlayId),
        tx.pure.bool(makerWins),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  /** Void an entire parlay (full refunds). */
  async voidParlay(parlayId: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::void_parlay`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP_ID),
        tx.object(P2P_CONFIG_ID),
        tx.object(P2P_REGISTRY_ID),
        tx.object(parlayId),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  // ── Admin helpers ─────────────────────────────────────────────────────────

  /** Withdraw accrued platform fees for a given coin type. */
  async withdrawFees(amountMist: number, recipient: string, coinType = SUI_COIN_TYPE): Promise<TxResult> {
    if (!isConfigured) return { txHash: '', success: false, error: 'P2P contract not configured' };
    const adminCapId = process.env.P2P_ADMIN_CAP_ID || '';
    if (!adminCapId) return { txHash: '', success: false, error: 'P2P_ADMIN_CAP_ID not set' };
    const tx = new Transaction();
    tx.moveCall({
      target:        `${P2P_PACKAGE_ID}::p2p_betting::withdraw_fees`,
      typeArguments: [coinType],
      arguments: [
        tx.object(adminCapId),
        tx.object(P2P_CONFIG_ID),
        tx.pure.u64(amountMist),
        tx.pure.address(recipient),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    return signAndExecute(tx);
  },

  // ── Gas Sponsorship (gasless stablecoin transactions) ────────────────────

  /**
   * Sign fully-built transaction bytes as the gas sponsor (admin).
   *
   * Sponsored transaction flow:
   *   1. Frontend builds the full Transaction with setSponsor(adminAddr).
   *      tx.build({ client }) resolves gas from adminAddr automatically.
   *   2. Frontend POSTs the built bytes here for admin to co-sign as gas owner.
   *   3. Frontend wallet also signs the SAME bytes as the sender.
   *   4. Frontend submits with signature array [userSig, sponsorSig].
   *
   * Because gasPayment is already embedded in the bytes (resolved in step 1),
   * both parties sign the exact same byte sequence → no mismatch.
   */
  async sponsorTransaction(txBytesBase64: string): Promise<{
    sponsorSig: string;
    sponsorAddress: string;
  }> {
    if (!ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY not set — gas sponsorship unavailable');
    const keypair = buildAdminKeypair();
    const txBytes = new Uint8Array(Buffer.from(txBytesBase64, 'base64'));
    const { signature } = await keypair.signTransaction(txBytes);
    return {
      sponsorSig:     signature,
      sponsorAddress: keypair.getPublicKey().toSuiAddress(),
    };
  },

  /** Return the admin wallet address (used as sponsor address by the frontend) */
  getAdminAddress(): string {
    if (!ADMIN_PRIVATE_KEY) return process.env.ADMIN_WALLET_ADDRESS || '';
    try {
      return buildAdminKeypair().getPublicKey().toSuiAddress();
    } catch { return process.env.ADMIN_WALLET_ADDRESS || ''; }
  },

  // ── Contract info (for /api/p2p/contract-info endpoint) ──────────────────

  getContractInfo() {
    return {
      configured:        isConfigured,
      packageId:         P2P_PACKAGE_ID   || null,
      configId:          P2P_CONFIG_ID    || null,
      registryId:        P2P_REGISTRY_ID  || null,
      adminCapId:        process.env.P2P_ADMIN_CAP_ID   || null,
      oracleCapId:       process.env.P2P_ORACLE_CAP_ID  || null,
      upgradeCapId:      process.env.P2P_UPGRADE_CAP_ID || null,
      network:           'mainnet',
      version:           'v2',
      features: [
        'generic-coin-type',           // SUI + USDC via <T>
        'partial-fills',               // multiple takers per offer
        'on-chain-order-book',         // P2PRegistry shared object
        'dispute-window',              // 2-hour challenge period
        'instant-settle',              // oracle bypasses dispute window
        'multisig-fee-withdrawal',     // propose (AdminCap) + execute (OracleCap)
        'upgrade-cap',                 // UpgradeCap captured post-deploy
        'hip4-maker-rebates',          // up to −0.5% net fee at Elite
        'on-chain-settlement-proof',   // winner paid from contract escrow
        'on-chain-event-history',      // full lifecycle events
        'multi-token-fee-vault',       // Bag-based fee accumulation
      ],
      supportedCoins: [
        { symbol: 'SUI',    type: SUI_COIN_TYPE,    default: true,  decimals: 9 },
        { symbol: 'SBETS',  type: SBETS_COIN_TYPE,  default: false, decimals: 9 },
        { symbol: 'USDSUI', type: USDSUI_COIN_TYPE, default: false, decimals: 6 },
        ...(USDC_COIN_TYPE ? [{ symbol: 'USDC', type: USDC_COIN_TYPE, default: false, decimals: 6 }] : []),
      ],
      suiscanUrls: {
        package:  P2P_PACKAGE_ID  ? `https://suiscan.xyz/mainnet/object/${P2P_PACKAGE_ID}`  : null,
        config:   P2P_CONFIG_ID   ? `https://suiscan.xyz/mainnet/object/${P2P_CONFIG_ID}`   : null,
        registry: P2P_REGISTRY_ID ? `https://suiscan.xyz/mainnet/object/${P2P_REGISTRY_ID}` : null,
      },
      disputeWindowMs:   7_200_000, // 2 hours (default; admin-configurable on-chain)
      description: [
        'Fully on-chain P2P escrow. Maker and taker stakes locked in individual P2PMatchedBet objects.',
        'Oracle queues settlement; 2-hour dispute window; anyone can challenge an incorrect result.',
        'Winner paid directly from contract escrow — no admin-wallet custody required.',
        'Maker rebates up to −0.5% at Elite tier (HIP-4 volume tiers).',
      ].join(' '),
      hipFourTiers: [
        { name: 'Bronze',  minVolumeSUI:      0, takerFeeBps: 200, makerRebateBps:  0, netFeeBps: 200 },
        { name: 'Silver',  minVolumeSUI:    100, takerFeeBps: 150, makerRebateBps:  0, netFeeBps: 150 },
        { name: 'Gold',    minVolumeSUI:   1000, takerFeeBps: 100, makerRebateBps: 10, netFeeBps:  90 },
        { name: 'Diamond', minVolumeSUI:  10000, takerFeeBps:  75, makerRebateBps: 20, netFeeBps:  55 },
        { name: 'Elite',   minVolumeSUI: 100000, takerFeeBps:  50, makerRebateBps: 30, netFeeBps:  20 },
      ],
    };
  },
};

export default p2pContractService;
