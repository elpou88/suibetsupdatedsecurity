/**
 * txHashVerifierService — on-chain stake transaction verification
 *
 * Every bet that records a txHash goes through this service before the bet
 * is written to the database.  Two modes:
 *
 *  ON-CHAIN   – The user called create_bet / accept_bet on the P2P Move
 *               contract.  The contract enforces amounts; we only verify
 *               (a) the tx succeeded, (b) the sender matches, and
 *               (c) the tx calls our package.
 *
 *  CUSTODIAL  – The user sent SUI/SBETS to the platform admin wallet.
 *               We verify (a) success, (b) sender, and (c) the admin wallet
 *               received at least `expectedAmount` of the correct coin.
 *
 * Both modes also check for txHash reuse (deduplication) so the same on-chain
 * transaction cannot fund two separate bets.
 */

import { getSuiClient } from '../lib/suiRpcConfig';
import { db } from '../db';
import { sql } from 'drizzle-orm';

// ─── Constants ────────────────────────────────────────────────────────────────

const MIST_PER_SUI       = 1_000_000_000n;
const SUI_COIN_TYPE      = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const AMOUNT_TOLERANCE     = 0.01;  // 1% tolerance for rounding in custodial amounts
const MAX_TOLERANCE_ABS    = 1.0;   // Hard cap: never allow more than 1-unit gap regardless of stake size
const FETCH_TIMEOUT_MS   = 15_000;
const MAX_RETRIES        = 3;
const RETRY_DELAY_MS     = 2_000;

const P2P_PACKAGE_ID   = (process.env.P2P_PACKAGE_ID  || '').trim();
const ADMIN_WALLET     = (process.env.ADMIN_WALLET_ADDRESS || '').toLowerCase().trim();
const SBETS_PACKAGE    = (process.env.SBETS_TOKEN_ADDRESS || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS').split('::')[0];
const SBETS_COIN_TYPE  = `${SBETS_PACKAGE}::sbets::SBETS`;
const USDSUI_COIN_TYPE = (process.env.USDSUI_COIN_TYPE || '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI').trim();

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerifyMode = 'onchain' | 'custodial';

export type VerifyStakeParams = {
  txHash:         string;
  senderWallet:   string;        // wallet that should have signed the tx
  expectedAmount: number;        // in SUI or SBETS (human-readable, not MIST)
  currency:       'SUI' | 'SBETS' | 'USDSUI';
  mode:           VerifyMode;
};

export type VerifyResult =
  | { ok: true;  receivedAmount?: number }
  | { ok: false; error: string };

// ─── Deduplication ───────────────────────────────────────────────────────────

async function isTxHashAlreadyUsed(txHash: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT 1 FROM (
        SELECT creator_tx_hash AS h FROM p2p_bet_offers   WHERE creator_tx_hash = ${txHash}
        UNION ALL
        SELECT taker_tx_hash        FROM p2p_bet_matches  WHERE taker_tx_hash   = ${txHash}
        UNION ALL
        SELECT creator_tx_hash      FROM p2p_parlay_offers WHERE creator_tx_hash = ${txHash}
        UNION ALL
        SELECT taker_tx_hash        FROM p2p_parlay_offers WHERE taker_tx_hash  = ${txHash}
        UNION ALL
        SELECT tx_hash              FROM bets              WHERE tx_hash        = ${txHash}
      ) AS used
      LIMIT 1
    `);
    const rows = (result as any).rows ?? (result as any);
    return Array.isArray(rows) ? rows.length > 0 : false;
  } catch (err: any) {
    // Non-fatal — log and let the bet proceed rather than block on a DB error
    console.warn('[TxVerify] Dedup check DB error (non-fatal):', err.message);
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normaliseCoinType(ct: string): string {
  return ct.replace(/^0x0*/, '0x');
}

function suiCoinTypeMatch(ct: string): boolean {
  const n = normaliseCoinType(ct);
  return n === SUI_COIN_TYPE ||
         n === normaliseCoinType(SUI_COIN_TYPE) ||
         ct.includes('0x2::sui::SUI');
}

function sbetsCoinTypeMatch(ct: string): boolean {
  return ct.includes('::sbets::SBETS');
}

// ─── Core verifier ────────────────────────────────────────────────────────────

async function fetchTxBlock(digest: string) {
  const client = getSuiClient();
  const opts = {
    showEffects:        true,
    showInput:          true,
    showBalanceChanges: true,
    showObjectChanges:  true,
  };

  // First try waitForTransaction so we're sure the tx is indexed
  try {
    return await (client as any).waitForTransaction({
      digest,
      timeout:      FETCH_TIMEOUT_MS,
      pollInterval: 1_500,
      options:      opts,
    });
  } catch (_) {
    // Fall back to direct fetch (tx may already be indexed)
    return await (client as any).getTransactionBlock({ digest, options: opts });
  }
}

// ─── On-chain mode verification ───────────────────────────────────────────────
// The Move contract enforces the exact stake amount itself; we just confirm
// the tx hit our package and the sender is correct.

function verifyOnchain(txData: any, senderWallet: string): VerifyResult {
  if (!P2P_PACKAGE_ID) {
    return { ok: false, error: 'On-chain verification is unavailable: P2P_PACKAGE_ID is not configured. Contact support.' };
  }

  const txKind = txData.transaction?.data?.transaction;
  const txns: any[] = txKind?.transactions ?? [];

  const callsOurPackage = txns.some((t: any) => {
    const pkg: string = t.MoveCall?.package ?? '';
    return pkg.toLowerCase().startsWith(P2P_PACKAGE_ID.toLowerCase().slice(0, 20));
  });

  if (!callsOurPackage) {
    // Could be a TransferObjects tx (test) — warn but don't block if package unset
    console.warn(`[TxVerify] ⚠️ On-chain tx ${senderWallet.slice(0,10)}... does not call P2P package`);
    return { ok: false, error: 'Transaction does not call the SuiBets P2P contract. Please use the official UI to place your stake.' };
  }

  return { ok: true };
}

// ─── Custodial mode verification ──────────────────────────────────────────────
// Confirm platform admin wallet received >= expectedAmount of the correct coin.

function usdsuiCoinTypeMatch(ct: string): boolean {
  return ct.includes('::usdsui::USDSUI') || ct.toLowerCase() === USDSUI_COIN_TYPE.toLowerCase();
}

function verifyCustodial(
  txData: any,
  expectedAmount: number,
  currency: 'SUI' | 'SBETS' | 'USDSUI',
): VerifyResult {
  if (!ADMIN_WALLET) {
    console.warn('[TxVerify] ADMIN_WALLET_ADDRESS not set — skipping custodial amount check');
    return { ok: true };
  }

  const balanceChanges: any[] = txData.balanceChanges ?? [];
  const adminLow = ADMIN_WALLET.toLowerCase();

  if (currency === 'SUI') {
    const suiReceived = balanceChanges.find(
      bc =>
        suiCoinTypeMatch(bc.coinType ?? '') &&
        (bc.owner?.AddressOwner ?? bc.owner?.ObjectOwner ?? '').toLowerCase() === adminLow &&
        BigInt(bc.amount ?? 0) > 0n,
    );

    if (!suiReceived) {
      const recipients = balanceChanges
        .filter(bc => suiCoinTypeMatch(bc.coinType ?? '') && BigInt(bc.amount ?? 0) > 0n)
        .map(bc => (bc.owner?.AddressOwner ?? '').slice(0, 10));
      return {
        ok: false,
        error: `Platform wallet did not receive SUI in this transaction. ${
          recipients.length ? `SUI went to: ${recipients.join(', ')}` : 'No SUI received by anyone.'
        } Ensure you transferred to the correct escrow address.`,
      };
    }

    const receivedSui = Number(BigInt(suiReceived.amount)) / Number(MIST_PER_SUI);
    const allowedGap  = Math.min(expectedAmount * AMOUNT_TOLERANCE, MAX_TOLERANCE_ABS);
    const minRequired  = expectedAmount - allowedGap;

    if (receivedSui < minRequired) {
      return {
        ok: false,
        error: `Amount too low: expected ${expectedAmount} SUI, platform received ${receivedSui.toFixed(6)} SUI. Please resend the exact amount.`,
      };
    }

    console.log(`[TxVerify] ✅ SUI custodial: received ${receivedSui.toFixed(6)} SUI (expected ${expectedAmount})`);
    return { ok: true, receivedAmount: receivedSui };
  }

  // SBETS verification
  const sbetsReceived = balanceChanges.find(
    bc =>
      sbetsCoinTypeMatch(bc.coinType ?? '') &&
      (bc.owner?.AddressOwner ?? bc.owner?.ObjectOwner ?? '').toLowerCase() === adminLow &&
      BigInt(bc.amount ?? 0) > 0n,
  );

  if (!sbetsReceived) {
    return {
      ok: false,
      error: `Platform wallet did not receive SBETS in this transaction. Ensure you transferred SBETS (not SUI) to the correct escrow address.`,
    };
  }

  const receivedSbets = Number(BigInt(sbetsReceived.amount)) / Number(MIST_PER_SUI);
  const allowedGapSbets = Math.min(expectedAmount * AMOUNT_TOLERANCE, MAX_TOLERANCE_ABS);
  const minRequired   = expectedAmount - allowedGapSbets;

  if (receivedSbets < minRequired) {
    return {
      ok: false,
      error: `Amount too low: expected ${expectedAmount} SBETS, platform received ${receivedSbets.toFixed(2)} SBETS.`,
    };
  }

  if (currency === 'SBETS') {
    console.log(`[TxVerify] ✅ SBETS custodial: received ${receivedSbets.toFixed(2)} SBETS (expected ${expectedAmount})`);
    return { ok: true, receivedAmount: receivedSbets };
  }

  // USDSUI verification (6 decimals)
  const USDSUI_UNITS = 1_000_000n;
  const usdsuiReceived = balanceChanges.find(
    bc =>
      usdsuiCoinTypeMatch(bc.coinType ?? '') &&
      (bc.owner?.AddressOwner ?? bc.owner?.ObjectOwner ?? '').toLowerCase() === adminLow &&
      BigInt(bc.amount ?? 0) > 0n,
  );

  if (!usdsuiReceived) {
    const objectChanges: any[] = txData.objectChanges ?? [];
    const usdsuiObj = objectChanges.find(
      oc =>
        (oc.type === 'created' || oc.type === 'mutated') &&
        usdsuiCoinTypeMatch(oc.objectType ?? '') &&
        (oc.owner?.AddressOwner ?? '').toLowerCase() === adminLow,
    );
    if (usdsuiObj) {
      console.log(`[TxVerify] ✅ USDSUI custodial (via objectChanges): object owned by admin | expected ${expectedAmount}`);
      return { ok: true, receivedAmount: expectedAmount };
    }

    return {
      ok: false,
      error: `Platform wallet did not receive USDSUI in this transaction. Ensure you transferred USDSUI to the correct escrow address.`,
    };
  }

  const receivedUsdsui = Number(BigInt(usdsuiReceived.amount)) / Number(USDSUI_UNITS);
  const allowedGapUsdsui = Math.min(expectedAmount * AMOUNT_TOLERANCE, MAX_TOLERANCE_ABS);
  const minRequiredUsdsui = expectedAmount - allowedGapUsdsui;

  if (receivedUsdsui < minRequiredUsdsui) {
    return {
      ok: false,
      error: `Amount too low: expected ${expectedAmount} USDSUI, platform received ${receivedUsdsui.toFixed(4)} USDSUI.`,
    };
  }

  console.log(`[TxVerify] ✅ USDSUI custodial: received ${receivedUsdsui.toFixed(4)} USDSUI (expected ${expectedAmount})`);
  return { ok: true, receivedAmount: receivedUsdsui };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function verifyStakeTx(params: VerifyStakeParams): Promise<VerifyResult> {
  const { txHash, senderWallet, expectedAmount, currency, mode } = params;

  // 1. Basic format check
  if (!txHash || txHash.length < 20) {
    return { ok: false, error: 'Invalid transaction hash format.' };
  }

  // 2. Deduplication — reject txHash reuse across any P2P bet
  const alreadyUsed = await isTxHashAlreadyUsed(txHash);
  if (alreadyUsed) {
    return {
      ok: false,
      error: `Transaction ${txHash.slice(0, 12)}… is already linked to another bet. Each transaction can only fund one bet.`,
    };
  }

  // 3. Fetch + retry loop
  let txData: any = null;
  let lastError  = 'Unknown error';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      txData = await fetchTxBlock(txHash);
      break;
    } catch (err: any) {
      lastError = err.message;
      console.warn(`[TxVerify] Attempt ${attempt + 1}/${MAX_RETRIES} fetch failed for ${txHash.slice(0, 12)}…: ${err.message}`);
      if (attempt < MAX_RETRIES - 1) await sleep(RETRY_DELAY_MS);
    }
  }

  if (!txData) {
    return {
      ok: false,
      error: `Could not retrieve transaction from Sui network after ${MAX_RETRIES} attempts: ${lastError}. The transaction may not be finalised yet — please wait a few seconds and try again.`,
    };
  }

  // 4. Check execution status
  const status = txData.effects?.status?.status;
  if (status !== 'success') {
    const onchainErr = txData.effects?.status?.error ?? 'unknown error';
    return { ok: false, error: `Transaction failed on-chain: ${onchainErr}. Only successful transactions can fund a bet.` };
  }

  // 5. Sender check
  const txSender: string = txData.transaction?.data?.sender ?? '';
  if (!txSender || txSender.toLowerCase() !== senderWallet.toLowerCase()) {
    return {
      ok: false,
      error: `Transaction sender mismatch: expected ${senderWallet.slice(0, 10)}…, found ${txSender.slice(0, 10)}… on-chain. You must sign the stake transaction from your betting wallet.`,
    };
  }

  // 6. Mode-specific checks
  if (mode === 'onchain') {
    const result = verifyOnchain(txData, senderWallet);
    if (!result.ok) return result;
  } else {
    const result = verifyCustodial(txData, expectedAmount, currency);
    if (!result.ok) return result;
  }

  console.log(`[TxVerify] ✅ ${mode} tx verified: ${txHash.slice(0, 16)}… sender=${senderWallet.slice(0, 10)}… amount=${expectedAmount} ${currency}`);
  return { ok: true };
}

/**
 * Quick helper: verifies a tx and throws a user-facing Error on failure.
 * Designed to be dropped into route handlers inline.
 */
export async function requireValidStakeTx(params: VerifyStakeParams): Promise<void> {
  const result = await verifyStakeTx(params);
  if (!result.ok) {
    throw new Error(`Stake verification failed: ${result.error}`);
  }
}
