/**
 * fluxEngineService.ts
 *
 * FLUX Engine — Fractional Liquidity Utilization eXchange
 *
 * TypeScript counterpart to flux_engine.move.  Provides:
 *
 *   buildShardSettlePTB   — oracle builds one PTB that settles N shards atomically
 *   buildShardVoidPTB     — oracle builds one PTB that voids N shards atomically
 *   executeFluxBatch      — sign + submit + await confirmation
 *   simulateFluxBatch     — dry-run to estimate gas without spending SUI
 *
 * FLUX shards use the same OracleCap as WARP and P2P — no extra key management.
 *
 * PTB batch pattern (settle):
 *   [0..N-1]  flux_settle_shard(oracle_cap, shard[i], taker_won[i], stats, clock)
 *   [N]       flux_batch_close(oracle_cap, stats, count, voided, clock)
 *
 * Up to 512 shards per PTB — same limit as WARP engine.
 */

import { Transaction }        from '@mysten/sui/transactions';
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient }        from '../lib/suiRpcConfig';

// ── Env / deployed IDs ────────────────────────────────────────────────────────

const FLUX_PACKAGE_ID  = (process.env.FLUX_PACKAGE_ID  || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018').trim();
const FLUX_STATS_ID    = (process.env.FLUX_STATS_ID    || '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320').trim();
const P2P_ORACLE_CAP   = (process.env.P2P_ORACLE_CAP_ID || '').trim();
// Accept both PRIVATE_KEY (Railway default) and ADMIN_PRIVATE_KEY (legacy name)
const ADMIN_PRIVATE_KEY= (process.env.ADMIN_PRIVATE_KEY  || process.env.PRIVATE_KEY || '').trim();

const SUI_CLOCK_ID     = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_COIN_TYPE    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const MAX_BATCH_SIZE   = 512;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShardSettleSpec {
  shardObjectId: string;  // on-chain FluxShard<T> object ID
  takerWon:      boolean; // oracle's determination — true = taker wins
  coinType?:     string;  // defaults to SUI
}

export interface ShardVoidSpec {
  shardObjectId: string;
  coinType?:     string;
}

export interface FluxBatchResult {
  txDigest:   string;
  batchId:    number;
  count:      number;
  voided:     number;
  success:    boolean;
  gasUsed:    number;
  gasPerShard: number;
  durationMs: number;
  error?:     string;
}

export interface FluxSimResult {
  success:          boolean;
  estimatedGas:     number;
  estimatedGasMist: number;
  gasPerShard:      number;
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
 * Build a PTB that settles N FluxShards atomically.
 *
 * Structure:
 *   [0..N-1]  flux_settle_shard(oracle_cap, shard[i], taker_won[i], stats, clock)
 *   [N]       flux_batch_close(oracle_cap, stats, count=N, voided=0, clock)
 */
export function buildShardSettlePTB(specs: ShardSettleSpec[]): Transaction {
  if (specs.length === 0) throw new Error('Batch must contain at least one shard');
  if (specs.length > MAX_BATCH_SIZE) throw new Error(`Batch size ${specs.length} exceeds MAX_BATCH_SIZE ${MAX_BATCH_SIZE}`);

  const tx = new Transaction();

  for (const spec of specs) {
    const coinType = spec.coinType ?? SUI_COIN_TYPE;
    tx.moveCall({
      target:        `${FLUX_PACKAGE_ID}::flux_engine::flux_settle_shard`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP),
        tx.object(spec.shardObjectId),
        tx.pure.bool(spec.takerWon),
        tx.object(FLUX_STATS_ID),
        tx.object(SUI_CLOCK_ID),
      ],
    });
  }

  // Batch close marker — emits FluxBatchSettled event + updates FluxStats
  tx.moveCall({
    target:    `${FLUX_PACKAGE_ID}::flux_engine::flux_batch_close`,
    arguments: [
      tx.object(P2P_ORACLE_CAP),
      tx.object(FLUX_STATS_ID),
      tx.pure.u64(specs.length),
      tx.pure.u64(0),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  tx.setGasBudget(200_000_000);
  return tx;
}

/**
 * Build a PTB that voids N FluxShards atomically (event cancelled/postponed).
 *
 * Structure:
 *   [0..N-1]  flux_void_shard(oracle_cap, shard[i], stats, clock)
 *
 * NOTE: flux_batch_close is NOT called here because it requires count > 0
 * (asserts at least one settlement). Pure void batches skip the batch marker —
 * the individual flux_void_shard calls are atomic on their own within one PTB.
 */
export function buildShardVoidPTB(specs: ShardVoidSpec[]): Transaction {
  if (specs.length === 0) throw new Error('Batch must contain at least one shard');
  if (specs.length > MAX_BATCH_SIZE) throw new Error(`Batch size ${specs.length} exceeds MAX_BATCH_SIZE ${MAX_BATCH_SIZE}`);

  const tx = new Transaction();

  for (const spec of specs) {
    const coinType = spec.coinType ?? SUI_COIN_TYPE;
    tx.moveCall({
      target:        `${FLUX_PACKAGE_ID}::flux_engine::flux_void_shard`,
      typeArguments: [coinType],
      arguments: [
        tx.object(P2P_ORACLE_CAP),
        tx.object(spec.shardObjectId),
        tx.object(FLUX_STATS_ID),
        tx.object(SUI_CLOCK_ID),
      ],
    });
  }

  tx.setGasBudget(200_000_000);
  return tx;
}

// ── Execution ─────────────────────────────────────────────────────────────────

export async function executeFluxBatch(
  specs:     ShardSettleSpec[],
  isVoid:    boolean = false,
): Promise<FluxBatchResult> {
  const t0 = Date.now();

  if (!P2P_ORACLE_CAP) {
    return { txDigest: '', batchId: 0, count: specs.length, voided: 0, success: false,
             gasUsed: 0, gasPerShard: 0, durationMs: 0, error: 'P2P_ORACLE_CAP_ID not set' };
  }

  try {
    const tx      = isVoid
      ? buildShardVoidPTB(specs as unknown as ShardVoidSpec[])
      : buildShardSettlePTB(specs);
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
               success: false, gasUsed, gasPerShard: 0, durationMs: duration,
               error: result?.effects?.status?.error };
    }

    const batchEvent = result?.events?.find((e: any) => e.type?.includes('FluxBatchSettled'));
    const batchId    = Number(batchEvent?.parsedJson?.batch_id ?? 0);

    console.log(`[FLUX] ✅ Batch #${batchId}: ${specs.length} shards ${isVoid ? 'voided' : 'settled'} | gas: ${gasUsed} | ${duration}ms | tx: ${result.digest}`);

    return {
      txDigest:    result.digest,
      batchId,
      count:       isVoid ? 0 : specs.length,
      voided:      isVoid ? specs.length : 0,
      success:     true,
      gasUsed,
      gasPerShard: specs.length > 0 ? Math.round(gasUsed / specs.length) : 0,
      durationMs:  duration,
    };
  } catch (err: any) {
    return { txDigest: '', batchId: 0, count: specs.length, voided: 0, success: false,
             gasUsed: 0, gasPerShard: 0, durationMs: Date.now() - t0, error: err.message };
  }
}

export async function simulateFluxBatch(specs: ShardSettleSpec[]): Promise<FluxSimResult> {
  try {
    const tx      = buildShardSettlePTB(specs);
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
      gasPerShard:      specs.length > 0 ? Math.round(gasTotal / specs.length) : 0,
      commandCount:     specs.length + 1, // N settle calls + 1 batch_close
      error:            sim?.effects?.status?.error,
    };
  } catch (err: any) {
    return { success: false, estimatedGas: 0, estimatedGasMist: 0,
             gasPerShard: 0, commandCount: 0, error: err.message };
  }
}

// ── Service export ────────────────────────────────────────────────────────────

export const fluxEngineService = {
  isConfigured(): boolean {
    return Boolean(FLUX_PACKAGE_ID && FLUX_STATS_ID && P2P_ORACLE_CAP && ADMIN_PRIVATE_KEY);
  },

  getPackageId(): string { return FLUX_PACKAGE_ID; },
  getStatsId():   string { return FLUX_STATS_ID; },

  buildShardSettlePTB,
  buildShardVoidPTB,
  executeFluxBatch,
  simulateFluxBatch,

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!FLUX_PACKAGE_ID) return { ok: false, message: 'FLUX_PACKAGE_ID not set' };
    if (!FLUX_STATS_ID)   return { ok: false, message: 'FLUX_STATS_ID not set' };

    try {
      const client = getSuiClient() as any;
      const obj    = await client.getObject({ id: FLUX_STATS_ID, options: { showContent: true } });
      if (!obj?.data) return { ok: false, message: `FluxStats object ${FLUX_STATS_ID} not found on chain` };

      const fields = obj.data.content?.fields;
      return {
        ok:      true,
        message: `FluxStats live — offers: ${fields?.total_offers ?? 0}, shards: ${fields?.total_shards ?? 0}, settled: ${fields?.total_settled ?? 0}, batches: ${fields?.total_batches ?? 0}`,
      };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  },
};
