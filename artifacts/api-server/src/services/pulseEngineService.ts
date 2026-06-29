/**
 * pulseEngineService.ts
 *
 * PULSE Engine — Pari-mutuel Under-Liquidity Shifting Engine
 *
 * TypeScript counterpart to pulse_engine.move.  Provides:
 *
 *   buildLockPoolPTB       — oracle locks a pool before event starts
 *   buildSettlePoolPTB     — oracle announces winner and opens claims
 *   buildVoidPoolPTB       — oracle voids a pool (event cancelled)
 *   buildBatchSettlePoolsPTB — settle N pools in one atomic PTB
 *   executePoolAction      — sign + submit + await confirmation
 *   simulateBatchSettle    — dry-run to estimate gas
 *
 * All oracle functions use the same p2p_betting::OracleCap as WARP + FLUX.
 *
 * PULSE pool lifecycle:
 *   OPEN → (pulse_lock_pool) → LOCKED → (pulse_settle_pool) → SETTLED
 *                                      → (pulse_void_pool)   → VOIDED
 */

import { Transaction }        from '@mysten/sui/transactions';
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient }        from '../lib/suiRpcConfig';

// ── Env / deployed IDs ────────────────────────────────────────────────────────

const PULSE_PACKAGE_ID = (process.env.PULSE_PACKAGE_ID || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();
const PULSE_STATS_ID   = (process.env.PULSE_STATS_ID   || '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff').trim();
const P2P_ORACLE_CAP   = (process.env.P2P_ORACLE_CAP_ID || '').trim();
// Accept both PRIVATE_KEY (Railway default) and ADMIN_PRIVATE_KEY (legacy name)
const ADMIN_PRIVATE_KEY= (process.env.ADMIN_PRIVATE_KEY  || process.env.PRIVATE_KEY || '').trim();

const SUI_CLOCK_ID  = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const MAX_BATCH_SIZE = 512;

// PULSE side constants (mirror Move constants)
export const SIDE_A = 0;
export const SIDE_B = 1;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PoolLockSpec {
  poolObjectId: string;
  coinType?:    string;
}

export interface PoolSettleSpec {
  poolObjectId: string;
  winner:       0 | 1;  // SIDE_A = 0, SIDE_B = 1
  coinType?:    string;
}

export interface PoolVoidSpec {
  poolObjectId: string;
  coinType?:    string;
}

export interface PulseBatchResult {
  txDigest:   string;
  batchId:    number;
  count:      number;
  voided:     number;
  success:    boolean;
  gasUsed:    number;
  gasPerPool: number;
  durationMs: number;
  error?:     string;
}

export interface PulseSimResult {
  success:          boolean;
  estimatedGas:     number;
  estimatedGasMist: number;
  gasPerPool:       number;
  commandCount:     number;
  error?:           string;
}

// ── Keypair helper ────────────────────────────────────────────────────────────

function buildAdminKeypair(): Ed25519Keypair {
  const raw = ADMIN_PRIVATE_KEY;
  if (!raw) throw new Error('No private key set — configure ADMIN_PRIVATE_KEY or PRIVATE_KEY on Railway');
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
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(bytes);
}

// ── PTB builders ──────────────────────────────────────────────────────────────

/**
 * Build a PTB that locks a single PulsePool (call before match starts).
 */
export function buildLockPoolPTB(spec: PoolLockSpec): Transaction {
  const tx       = new Transaction();
  const coinType = spec.coinType ?? SUI_COIN_TYPE;

  tx.moveCall({
    target:        `${PULSE_PACKAGE_ID}::pulse_engine::pulse_lock_pool`,
    typeArguments: [coinType],
    arguments: [
      tx.object(P2P_ORACLE_CAP),
      tx.object(spec.poolObjectId),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  tx.setGasBudget(20_000_000);
  return tx;
}

/**
 * Build a PTB that settles a single PulsePool and announces the winner.
 *
 * winner: 0 = SIDE_A wins, 1 = SIDE_B wins
 * Fee (2%) is paid to oracle wallet; winners claim proportional share afterwards.
 */
export function buildSettlePoolPTB(spec: PoolSettleSpec): Transaction {
  const tx       = new Transaction();
  const coinType = spec.coinType ?? SUI_COIN_TYPE;

  tx.moveCall({
    target:        `${PULSE_PACKAGE_ID}::pulse_engine::pulse_settle_pool`,
    typeArguments: [coinType],
    arguments: [
      tx.object(P2P_ORACLE_CAP),
      tx.object(spec.poolObjectId),
      tx.pure.u8(spec.winner),
      tx.object(PULSE_STATS_ID),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  tx.setGasBudget(50_000_000);
  return tx;
}

/**
 * Build a PTB that voids a single PulsePool (event cancelled/postponed).
 * Positions holders can then call pulse_claim_void_refund to reclaim stake.
 */
export function buildVoidPoolPTB(spec: PoolVoidSpec): Transaction {
  const tx       = new Transaction();
  const coinType = spec.coinType ?? SUI_COIN_TYPE;

  tx.moveCall({
    target:        `${PULSE_PACKAGE_ID}::pulse_engine::pulse_void_pool`,
    typeArguments: [coinType],
    arguments: [
      tx.object(P2P_ORACLE_CAP),
      tx.object(spec.poolObjectId),
      tx.object(PULSE_STATS_ID),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  tx.setGasBudget(20_000_000);
  return tx;
}

/**
 * Build a PTB that settles N PulsePools atomically + emits PulseBatchSettled.
 *
 * Structure:
 *   [0..N-1]  pulse_settle_pool(oracle_cap, pool[i], winner[i], stats, clock)
 *   [N]       pulse_batch_close(oracle_cap, stats, count=N, voided=0, clock)
 */
export function buildBatchSettlePoolsPTB(specs: PoolSettleSpec[]): Transaction {
  if (specs.length === 0) throw new Error('Batch must contain at least one pool');
  if (specs.length > MAX_BATCH_SIZE) throw new Error(`Batch size ${specs.length} exceeds MAX_BATCH_SIZE ${MAX_BATCH_SIZE}`);

  const tx = new Transaction();

  for (const spec of specs) {
    const coinType = spec.coinType ?? SUI_COIN_TYPE;
    tx.moveCall({
      target:        `${PULSE_PACKAGE_ID}::pulse_engine::pulse_settle_pool`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP),
        tx.object(spec.poolObjectId),
        tx.pure.u8(spec.winner),
        tx.object(PULSE_STATS_ID),
        tx.object(SUI_CLOCK_ID),
      ],
    });
  }

  tx.moveCall({
    target:    `${PULSE_PACKAGE_ID}::pulse_engine::pulse_batch_close`,
    arguments: [
      tx.object(P2P_ORACLE_CAP),
      tx.object(PULSE_STATS_ID),
      tx.pure.u64(specs.length),
      tx.pure.u64(0),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  tx.setGasBudget(200_000_000);
  return tx;
}

/**
 * Build a PTB that voids N PulsePools atomically.
 *
 * Structure:
 *   [0..N-1]  pulse_void_pool(oracle_cap, pool[i], stats, clock)
 *
 * NOTE: pulse_batch_close is NOT called here because it requires count > 0
 * (asserts at least one settlement). Pure void batches skip the batch marker —
 * the individual pulse_void_pool calls are atomic on their own within one PTB.
 */
export function buildBatchVoidPoolsPTB(specs: PoolVoidSpec[]): Transaction {
  if (specs.length === 0) throw new Error('Batch must contain at least one pool');
  if (specs.length > MAX_BATCH_SIZE) throw new Error(`Batch size ${specs.length} exceeds MAX_BATCH_SIZE ${MAX_BATCH_SIZE}`);

  const tx = new Transaction();

  for (const spec of specs) {
    const coinType = spec.coinType ?? SUI_COIN_TYPE;
    tx.moveCall({
      target:        `${PULSE_PACKAGE_ID}::pulse_engine::pulse_void_pool`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP),
        tx.object(spec.poolObjectId),
        tx.object(PULSE_STATS_ID),
        tx.object(SUI_CLOCK_ID),
      ],
    });
  }

  tx.setGasBudget(200_000_000);
  return tx;
}

// ── Execution ─────────────────────────────────────────────────────────────────

/**
 * Execute any single-pool action PTB (lock / settle / void).
 */
export async function executePoolAction(
  tx:     Transaction,
  label:  string,
): Promise<PulseBatchResult> {
  const t0 = Date.now();

  if (!P2P_ORACLE_CAP) {
    return { txDigest: '', batchId: 0, count: 0, voided: 0, success: false,
             gasUsed: 0, gasPerPool: 0, durationMs: 0, error: 'P2P_ORACLE_CAP_ID not set' };
  }

  try {
    const client  = getSuiClient() as any;
    const keypair = buildAdminKeypair();

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer:      keypair,
      options:     { showEffects: true, showEvents: true },
    });

    const status   = result?.effects?.status?.status;
    const gasUsed  = Number(result?.effects?.gasUsed?.computationCost ?? 0) +
                     Number(result?.effects?.gasUsed?.storageCost      ?? 0);
    const duration = Date.now() - t0;

    if (status !== 'success') {
      return { txDigest: result.digest, batchId: 0, count: 0, voided: 0,
               success: false, gasUsed, gasPerPool: 0, durationMs: duration,
               error: result?.effects?.status?.error };
    }

    console.log(`[PULSE] ✅ ${label} | gas: ${gasUsed} | ${duration}ms | tx: ${result.digest}`);

    return {
      txDigest:   result.digest,
      batchId:    0,
      count:      1,
      voided:     0,
      success:    true,
      gasUsed,
      gasPerPool: gasUsed,
      durationMs: duration,
    };
  } catch (err: any) {
    return { txDigest: '', batchId: 0, count: 0, voided: 0, success: false,
             gasUsed: 0, gasPerPool: 0, durationMs: Date.now() - t0, error: err.message };
  }
}

/**
 * Execute a batch of pool settlements.
 */
export async function executePulseBatch(
  specs:  PoolSettleSpec[],
  isVoid: boolean = false,
): Promise<PulseBatchResult> {
  const t0 = Date.now();

  if (!P2P_ORACLE_CAP) {
    return { txDigest: '', batchId: 0, count: specs.length, voided: 0, success: false,
             gasUsed: 0, gasPerPool: 0, durationMs: 0, error: 'P2P_ORACLE_CAP_ID not set' };
  }

  try {
    const tx      = isVoid
      ? buildBatchVoidPoolsPTB(specs as unknown as PoolVoidSpec[])
      : buildBatchSettlePoolsPTB(specs);
    const client  = getSuiClient() as any;
    const keypair = buildAdminKeypair();

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer:      keypair,
      options:     { showEffects: true, showEvents: true },
    });

    const status   = result?.effects?.status?.status;
    const gasUsed  = Number(result?.effects?.gasUsed?.computationCost ?? 0) +
                     Number(result?.effects?.gasUsed?.storageCost      ?? 0);
    const duration = Date.now() - t0;

    if (status !== 'success') {
      return { txDigest: result.digest, batchId: 0, count: specs.length, voided: isVoid ? specs.length : 0,
               success: false, gasUsed, gasPerPool: 0, durationMs: duration,
               error: result?.effects?.status?.error };
    }

    const batchEvent = result?.events?.find((e: any) => e.type?.includes('PulseBatchSettled'));
    const batchId    = Number(batchEvent?.parsedJson?.batch_id ?? 0);

    console.log(`[PULSE] ✅ Batch #${batchId}: ${specs.length} pools ${isVoid ? 'voided' : 'settled'} | gas: ${gasUsed} | ${duration}ms | tx: ${result.digest}`);

    return {
      txDigest:    result.digest,
      batchId,
      count:       isVoid ? 0 : specs.length,
      voided:      isVoid ? specs.length : 0,
      success:     true,
      gasUsed,
      gasPerPool:  specs.length > 0 ? Math.round(gasUsed / specs.length) : 0,
      durationMs:  duration,
    };
  } catch (err: any) {
    return { txDigest: '', batchId: 0, count: specs.length, voided: 0, success: false,
             gasUsed: 0, gasPerPool: 0, durationMs: Date.now() - t0, error: err.message };
  }
}

export async function simulatePulseBatch(specs: PoolSettleSpec[]): Promise<PulseSimResult> {
  try {
    const tx      = buildBatchSettlePoolsPTB(specs);
    const client  = getSuiClient() as any;
    const keypair = ADMIN_PRIVATE_KEY ? buildAdminKeypair() : Ed25519Keypair.generate();
    const sender  = keypair.getPublicKey().toSuiAddress();
    tx.setSender(sender);

    const bytes = await tx.build({ client });
    const sim   = await client.devInspectTransactionBlock({ transactionBlock: bytes, sender });

    const gasTotal = Number(sim?.effects?.gasUsed?.computationCost ?? 0) +
                     Number(sim?.effects?.gasUsed?.storageCost      ?? 0);

    return {
      success:          sim?.effects?.status?.status === 'success',
      estimatedGas:     gasTotal,
      estimatedGasMist: gasTotal,
      gasPerPool:       specs.length > 0 ? Math.round(gasTotal / specs.length) : 0,
      commandCount:     specs.length + 1,
      error:            sim?.effects?.status?.error,
    };
  } catch (err: any) {
    return { success: false, estimatedGas: 0, estimatedGasMist: 0,
             gasPerPool: 0, commandCount: 0, error: err.message };
  }
}

// ── Service export ────────────────────────────────────────────────────────────

export const pulseEngineService = {
  isConfigured(): boolean {
    return Boolean(PULSE_PACKAGE_ID && PULSE_STATS_ID && P2P_ORACLE_CAP && ADMIN_PRIVATE_KEY);
  },

  getPackageId(): string { return PULSE_PACKAGE_ID; },
  getStatsId():   string { return PULSE_STATS_ID; },

  buildLockPoolPTB,
  buildSettlePoolPTB,
  buildVoidPoolPTB,
  buildBatchSettlePoolsPTB,
  buildBatchVoidPoolsPTB,
  executePoolAction,
  executePulseBatch,
  simulatePulseBatch,

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!PULSE_PACKAGE_ID) return { ok: false, message: 'PULSE_PACKAGE_ID not set' };
    if (!PULSE_STATS_ID)   return { ok: false, message: 'PULSE_STATS_ID not set' };

    try {
      const client = getSuiClient() as any;
      const obj    = await client.getObject({ id: PULSE_STATS_ID, options: { showContent: true } });
      if (!obj?.data) return { ok: false, message: `PulseStats object ${PULSE_STATS_ID} not found on chain` };

      const fields = obj.data.content?.fields;
      return {
        ok:      true,
        message: `PulseStats live — pools: ${fields?.total_pools ?? 0}, positions: ${fields?.total_positions ?? 0}, settled: ${fields?.total_settled ?? 0}, batches: ${fields?.total_batches ?? 0}`,
      };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  },
};
