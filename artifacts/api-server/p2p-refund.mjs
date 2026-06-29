/**
 * P2P Refund Script — sends back funds to creators of expired/cancelled offers
 * that have a verified deposit (creator_tx_hash) but no completed refund yet.
 *
 * Usage: ADMIN_PRIVATE_KEY=suiprivkey... RAILWAY_DB=postgresql://... node scripts/p2p-refund.mjs
 */
import pg from 'pg';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const { Client } = pg;

const RAILWAY_DB = process.env.RAILWAY_DB || process.env.DATABASE_URL;
if (!RAILWAY_DB) { console.error('❌ RAILWAY_DB or DATABASE_URL env var required'); process.exit(1); }
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const SUI_NETWORK = process.env.SUI_NETWORK || 'mainnet';
const SBETS_TOKEN_ADDRESS = process.env.SBETS_TOKEN_ADDRESS || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502';
const SBETS_COIN_TYPE = `${SBETS_TOKEN_ADDRESS}::sbets::SBETS`;

if (!ADMIN_PRIVATE_KEY) {
  console.error('❌ ADMIN_PRIVATE_KEY is required');
  process.exit(1);
}

// ── Keypair ──────────────────────────────────────────────────────────────────

function getKeypair() {
  if (ADMIN_PRIVATE_KEY.startsWith('suiprivkey')) {
    const decoded = decodeSuiPrivateKey(ADMIN_PRIVATE_KEY);
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  } else if (ADMIN_PRIVATE_KEY.startsWith('0x')) {
    const keyBytes = new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY.slice(2), 'hex'));
    return Ed25519Keypair.fromSecretKey(keyBytes);
  } else {
    let keyBytes = new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));
    if (keyBytes.length === 33 && keyBytes[0] === 0) keyBytes = keyBytes.slice(1);
    else if (keyBytes.length === 65 && keyBytes[0] === 0) keyBytes = keyBytes.slice(1, 33);
    else if (keyBytes.length === 64) keyBytes = keyBytes.slice(0, 32);
    return Ed25519Keypair.fromSecretKey(keyBytes);
  }
}

// ── Sui client ───────────────────────────────────────────────────────────────

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK) });
const keypair = getKeypair();
const adminAddress = keypair.toSuiAddress();
console.log(`✅ Admin wallet: ${adminAddress}`);

// ── Send SUI ─────────────────────────────────────────────────────────────────

async function sendSui(recipientAddress, amount) {
  const amountMist = BigInt(Math.floor(amount * 1e9));
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [amountMist]);
  tx.transferObjects([coin], recipientAddress);
  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  if (result.effects?.status?.status === 'success') {
    return { success: true, txHash: result.digest };
  }
  return { success: false, error: result.effects?.status?.error || 'TX failed' };
}

// ── Send SBETS (with stale-coin retry) ───────────────────────────────────────

async function sendSbets(recipientAddress, amount, retries = 3) {
  const amountSmallest = BigInt(Math.floor(amount * 1_000_000_000));

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Re-fetch fresh coin objects on every attempt to avoid stale-object errors
    const coins = await suiClient.getCoins({ owner: adminAddress, coinType: SBETS_COIN_TYPE });
    if (!coins.data?.length) return { success: false, error: 'No SBETS in admin wallet' };

    const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
    if (totalBalance < amountSmallest) {
      return { success: false, error: `Insufficient SBETS: have ${Number(totalBalance) / 1e9}, need ${amount}` };
    }

    const tx = new Transaction();
    const coinIds = coins.data.map(c => c.coinObjectId);
    if (coinIds.length > 1) tx.mergeCoins(coinIds[0], coinIds.slice(1));
    const [paymentCoin] = tx.splitCoins(coinIds[0], [amountSmallest]);
    tx.transferObjects([paymentCoin], recipientAddress);

    try {
      const result = await suiClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      if (result.effects?.status?.status === 'success') {
        return { success: true, txHash: result.digest };
      }
      return { success: false, error: result.effects?.status?.error || 'TX failed' };
    } catch (err) {
      const isStale = err?.message?.includes('unavailable for consumption') || err?.message?.includes('version');
      if (isStale && attempt < retries) {
        console.log(`  ⚠️  Stale coin on attempt ${attempt}, retrying with fresh objects...`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'All retries exhausted (stale coin)' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Client({ connectionString: RAILWAY_DB });
  await db.connect();
  console.log('✅ Connected to Railway DB\n');

  // ── 1. Bet offers: expired/cancelled with deposit but no valid refund ──────
  const { rows: betOffers } = await db.query(`
    SELECT id, creator_wallet, creator_stake, currency, status, creator_tx_hash, refund_tx_hash
    FROM p2p_bet_offers
    WHERE status IN ('expired', 'cancelled')
      AND creator_tx_hash IS NOT NULL AND creator_tx_hash != ''
      AND (refund_tx_hash IS NULL OR refund_tx_hash = '' OR refund_tx_hash = 'PENDING')
    ORDER BY id
  `);

  console.log(`Found ${betOffers.length} bet offer(s) needing refund:`);
  for (const row of betOffers) {
    const amount = Number(row.creator_stake);
    const currency = (row.currency || 'SUI').toUpperCase();
    console.log(`\n  Offer #${row.id} | ${amount} ${currency} → ${row.creator_wallet.slice(0, 14)}... [${row.status}]`);

    // Clear PENDING placeholder so we can write real hash (or NULL on failure)
    if (row.refund_tx_hash === 'PENDING') {
      await db.query(`UPDATE p2p_bet_offers SET refund_tx_hash = NULL WHERE id = $1`, [row.id]);
    }

    let result;
    if (currency === 'SBETS') {
      result = await sendSbets(row.creator_wallet, amount);
    } else {
      result = await sendSui(row.creator_wallet, amount);
    }

    if (result.success) {
      await db.query(`UPDATE p2p_bet_offers SET refund_tx_hash = $1 WHERE id = $2`, [result.txHash, row.id]);
      console.log(`  ✅ Refunded! TX: ${result.txHash}`);
    } else {
      console.error(`  ❌ Failed: ${result.error}`);
    }
  }

  // ── 2. Parlay offers: expired/cancelled with deposit but no valid refund ───
  const { rows: parlayOffers } = await db.query(`
    SELECT id, creator_wallet, creator_stake, currency, status, creator_tx_hash, refund_tx_hash
    FROM p2p_parlay_offers
    WHERE status IN ('expired', 'cancelled')
      AND creator_tx_hash IS NOT NULL AND creator_tx_hash != ''
      AND (refund_tx_hash IS NULL OR refund_tx_hash = '' OR refund_tx_hash = 'PENDING')
    ORDER BY id
  `);

  console.log(`\nFound ${parlayOffers.length} parlay offer(s) needing refund:`);
  for (const row of parlayOffers) {
    const amount = Number(row.creator_stake);
    const currency = (row.currency || 'SUI').toUpperCase();
    console.log(`\n  Parlay #${row.id} | ${amount} ${currency} → ${row.creator_wallet.slice(0, 14)}... [${row.status}]`);

    if (row.refund_tx_hash === 'PENDING') {
      await db.query(`UPDATE p2p_parlay_offers SET refund_tx_hash = NULL WHERE id = $1`, [row.id]);
    }

    let result;
    if (currency === 'SBETS') {
      result = await sendSbets(row.creator_wallet, amount);
    } else {
      result = await sendSui(row.creator_wallet, amount);
    }

    if (result.success) {
      await db.query(`UPDATE p2p_parlay_offers SET refund_tx_hash = $1 WHERE id = $2`, [result.txHash, row.id]);
      console.log(`  ✅ Refunded! TX: ${result.txHash}`);
    } else {
      console.error(`  ❌ Failed: ${result.error}`);
    }
  }

  await db.end();
  console.log('\n✅ Refund run complete.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
