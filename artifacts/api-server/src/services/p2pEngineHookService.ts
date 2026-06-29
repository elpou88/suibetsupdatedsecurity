/**
 * p2pEngineHookService.ts
 *
 * Bridges P2P bet events into FLUX and PULSE engine packages so that
 * every P2P user action generates activity on ALL three engine packages.
 *
 * PULSE hook — fires on P2P offer creation:
 *   Admin calls pulse_create_pool for the same event_id as the P2P offer.
 *   The engineAutoSettleService then auto-settles the pool when the event resolves,
 *   generating lock + settle txs on the PULSE package tied to real P2P bets.
 *
 * FLUX hook — fires on P2P batch settlement:
 *   Admin calls flux_batch_close on the FLUX package, synchronised with each
 *   WARP settlement batch.  This records settled bet counts in FluxStats and
 *   generates txs on the FLUX package every time P2P bets are settled.
 *
 * All calls are fire-and-forget — failures are logged but never block P2P flow.
 * If ADMIN_PRIVATE_KEY is not set the hooks silently no-op.
 */

import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient } from '../lib/suiRpcConfig';

const PULSE_PACKAGE_ID = (process.env.PULSE_PACKAGE_ID || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();
const PULSE_STATS_ID   = (process.env.PULSE_STATS_ID   || '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff').trim();

const FLUX_PACKAGE_ID  = (process.env.FLUX_PACKAGE_ID  || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018').trim();
const FLUX_STATS_ID    = (process.env.FLUX_STATS_ID    || '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320').trim();

const P2P_ORACLE_CAP    = (process.env.P2P_ORACLE_CAP_ID  || '').trim();
// Accept both PRIVATE_KEY (Railway default) and ADMIN_PRIVATE_KEY (legacy name)
const ADMIN_PRIVATE_KEY = (process.env.ADMIN_PRIVATE_KEY   || process.env.PRIVATE_KEY || '').trim();

const SUI_CLOCK_ID  = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

// 0.01 SUI seed per pool side — minimum required by pulse_create_pool contract
const POOL_SEED_MIST = 10_000_000n;

// In-memory dedup: one PULSE pool per event_id per server lifecycle
const pulsedEventIds = new Set<string>();

// ── Keypair helper ─────────────────────────────────────────────────────────────

function buildKeypair(): Ed25519Keypair | null {
  const raw = ADMIN_PRIVATE_KEY;
  if (!raw) return null;
  try {
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
  } catch {
    return null;
  }
}

async function execTx(
  tx: Transaction,
  kp: Ed25519Keypair,
): Promise<{ ok: boolean; digest?: string; error?: string }> {
  try {
    const client = getSuiClient() as any;
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: kp,
      options: { showEffects: true },
      requestType: 'WaitForLocalExecution',
    });
    const ok = result?.effects?.status?.status === 'success';
    return {
      ok,
      digest: result?.digest,
      error: ok ? undefined : (result?.effects?.status?.error ?? 'unknown error'),
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── PULSE: create pool when P2P offer is posted ────────────────────────────────

/**
 * Called fire-and-forget when a P2P offer is saved to DB.
 * Creates a matching PulsePool on the PULSE package so that:
 *  1. PULSE package gets a creation tx tied to this real P2P bet.
 *  2. engineAutoSettleService detects the PulsePoolCreated event and
 *     auto-settles (lock + settle) the pool after the event ends —
 *     generating 2 more PULSE txs per event.
 */
export async function createPulsePoolForP2POffer(params: {
  eventId:  string;
  homeTeam: string;
  awayTeam: string;
}): Promise<void> {
  const { eventId, homeTeam, awayTeam } = params;

  if (!ADMIN_PRIVATE_KEY || !PULSE_PACKAGE_ID || !PULSE_STATS_ID) return;
  if (!eventId) return;

  // One pool per event per server run
  if (pulsedEventIds.has(eventId)) return;
  pulsedEventIds.add(eventId);

  const kp = buildKeypair();
  if (!kp) { pulsedEventIds.delete(eventId); return; }

  const sideA = (homeTeam || 'Home').slice(0, 64);
  const sideB = (awayTeam || 'Away').slice(0, 64);

  try {
    const tx = new Transaction();
    const [coinA, coinB] = tx.splitCoins(tx.gas, [POOL_SEED_MIST, POOL_SEED_MIST]);

    tx.moveCall({
      target:        `${PULSE_PACKAGE_ID}::pulse_engine::pulse_create_pool`,
      typeArguments: [SUI_COIN_TYPE],
      arguments: [
        coinA,
        coinB,
        tx.pure.vector('u8', Array.from(Buffer.from(eventId))),
        tx.pure.vector('u8', Array.from(Buffer.from(sideA))),
        tx.pure.vector('u8', Array.from(Buffer.from(sideB))),
        tx.object(PULSE_STATS_ID),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    tx.setGasBudget(20_000_000);

    const result = await execTx(tx, kp);
    if (result.ok) {
      console.log(`[P2PEngineHook] ✅ PULSE pool created for P2P event "${eventId}" | tx: ${result.digest}`);
    } else {
      console.warn(`[P2PEngineHook] ⚠️ PULSE pool creation failed for "${eventId}": ${result.error}`);
      pulsedEventIds.delete(eventId);
    }
  } catch (err: any) {
    console.warn(`[P2PEngineHook] PULSE pool error for "${eventId}":`, err.message);
    pulsedEventIds.delete(eventId);
  }
}

// ── FLUX: emit batch marker when P2P bets are settled ─────────────────────────

/**
 * Called fire-and-forget after each WARP settlement batch completes.
 * Calls flux_batch_close on the FLUX package to record settled bet
 * counts in FluxStats, generating a FLUX package tx for every
 * P2P settlement cycle.
 *
 * Requires P2P_ORACLE_CAP_ID + ADMIN_PRIVATE_KEY.
 */
export async function fireFluxMarkerForP2PSettlement(params: {
  betCount: number;
  voided?:  number;
}): Promise<void> {
  const { betCount, voided = 0 } = params;

  if (!ADMIN_PRIVATE_KEY || !FLUX_PACKAGE_ID || !FLUX_STATS_ID || !P2P_ORACLE_CAP) return;
  if (betCount <= 0) return;

  const kp = buildKeypair();
  if (!kp) return;

  try {
    const tx = new Transaction();
    tx.moveCall({
      target:    `${FLUX_PACKAGE_ID}::flux_engine::flux_batch_close`,
      arguments: [
        tx.object(P2P_ORACLE_CAP),
        tx.object(FLUX_STATS_ID),
        tx.pure.u64(betCount),
        tx.pure.u64(voided),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    tx.setGasBudget(10_000_000);

    const result = await execTx(tx, kp);
    if (result.ok) {
      console.log(`[P2PEngineHook] ✅ FLUX marker: ${betCount} P2P bets settled | tx: ${result.digest}`);
    } else {
      console.warn(`[P2PEngineHook] ⚠️ FLUX marker failed: ${result.error}`);
    }
  } catch (err: any) {
    console.warn('[P2PEngineHook] FLUX marker error:', err.message);
  }
}

export const p2pEngineHookService = {
  createPulsePoolForP2POffer,
  fireFluxMarkerForP2PSettlement,
  isConfigured(): boolean {
    return Boolean(ADMIN_PRIVATE_KEY && PULSE_PACKAGE_ID && PULSE_STATS_ID);
  },
  hasFluxMarker(): boolean {
    return Boolean(ADMIN_PRIVATE_KEY && FLUX_PACKAGE_ID && FLUX_STATS_ID && P2P_ORACLE_CAP);
  },
};
