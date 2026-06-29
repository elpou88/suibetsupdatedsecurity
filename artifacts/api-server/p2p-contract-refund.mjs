/**
 * P2P On-Chain Refund Script
 * Calls expire_offer / expire_parlay on the P2P smart contract.
 * The contract sends funds directly back to the maker — admin wallet only pays gas.
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import pg from 'pg';

const { Client } = pg;

const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const RAILWAY_DB        = process.env.RAILWAY_DB || process.env.DATABASE_URL;
if (!RAILWAY_DB) { console.error('❌ RAILWAY_DB or DATABASE_URL env var required'); process.exit(1); }
const SUI_NETWORK       = process.env.SUI_NETWORK || 'mainnet';

const P2P_PACKAGE_ID  = process.env.P2P_PACKAGE_ID  || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const P2P_REGISTRY_ID = process.env.P2P_REGISTRY_ID || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const SBETS_COIN_TYPE  = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const SUI_COIN_TYPE    = '0x2::sui::SUI';
const CLOCK_ID         = '0x6';

if (!ADMIN_PRIVATE_KEY) { console.error('❌ ADMIN_PRIVATE_KEY required'); process.exit(1); }

// ── Keypair + client ──────────────────────────────────────────────────────────
function getKeypair() {
  const decoded = decodeSuiPrivateKey(ADMIN_PRIVATE_KEY);
  return Ed25519Keypair.fromSecretKey(decoded.secretKey);
}
const client   = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK) });
const keypair  = getKeypair();
const adminAddr = keypair.toSuiAddress();
console.log(`✅ Admin (gas payer): ${adminAddr}\n`);

// ── Wait for tx finality then pause so registry version propagates ────────────
async function waitAndSettle(digest) {
  await client.waitForTransaction({ digest, options: { showEffects: true } });
  await new Promise(r => setTimeout(r, 3000)); // 3s for nodes to sync
}

// ── Call a contract entry function with stale-object retry ───────────────────
async function callContract(fnName, typeArg, objectId, label, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const tx = new Transaction();
    tx.moveCall({
      target: `${P2P_PACKAGE_ID}::p2p_betting::${fnName}`,
      typeArguments: [typeArg],
      arguments: [
        tx.object(objectId),
        tx.object(P2P_REGISTRY_ID),
        tx.object(CLOCK_ID),
      ],
    });
    try {
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      if (result.effects?.status?.status === 'success') {
        console.log(`  ✅ ${label} TX: ${result.digest}`);
        await waitAndSettle(result.digest);
        return { success: true, txHash: result.digest };
      }
      const err = result.effects?.status?.error || 'TX failed';
      console.error(`  ❌ ${label} failed: ${err}`);
      return { success: false, error: err };
    } catch (e) {
      const isStale = e?.message?.includes('unavailable for consumption') || e?.message?.includes('version');
      if (isStale && attempt < retries) {
        console.log(`  ⚠️  Stale object attempt ${attempt}/${retries}, waiting 4s...`);
        await new Promise(r => setTimeout(r, 4000));
        continue;
      }
      // EOfferNotExpired — not expired on-chain yet
      if (e?.message?.includes('abort code: 10') || e?.message?.includes('abort_code: 10')) {
        return { success: false, error: 'NOT_YET_EXPIRED', raw: e.message };
      }
      console.error(`  ❌ ${label} exception: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Retries exhausted' };
}

async function expireOffer(objectId, coinType, label) {
  return callContract('expire_offer', coinType, objectId, label);
}

async function expireParlay(objectId, coinType, label) {
  return callContract('expire_parlay', coinType, objectId, label);
}

// ── Fetch on-chain expiry timestamp for an object ────────────────────────────
async function getOnChainExpiry(objectId) {
  try {
    const obj = await client.getObject({ id: objectId, options: { showContent: true } });
    const expiresAt = obj.data?.content?.fields?.expires_at;
    return expiresAt ? Number(expiresAt) : null;
  } catch { return null; }
}

// ── Sleep until a timestamp (ms) then return ─────────────────────────────────
async function sleepUntil(tsMs, label) {
  const now  = Date.now();
  const wait = tsMs - now + 5000; // 5s buffer after expiry
  if (wait <= 0) return;
  console.log(`  ⏳ ${label}: waiting ${Math.round(wait/1000)}s until on-chain expiry at ${new Date(tsMs).toISOString()} ...`);
  await new Promise(r => setTimeout(r, wait));
}

// ── Process one item (offer or parlay), waiting for on-chain expiry if needed ─
async function processItem(objectId, coinType, fnExpire, label, db, table, idField, txField, id) {
  console.log(`\n▶ ${label}`);
  let result = await fnExpire(objectId, coinType, label);

  if (result.error === 'NOT_YET_EXPIRED') {
    const expiresAt = await getOnChainExpiry(objectId);
    if (!expiresAt) {
      console.error(`  ❌ Could not fetch on-chain expiry — skipping.`);
      return;
    }
    await sleepUntil(expiresAt, label);
    result = await fnExpire(objectId, coinType, label);
  }

  if (result.success) {
    await db.query(
      `UPDATE ${table} SET ${txField} = $1 WHERE ${idField} = $2`,
      [result.txHash, id]
    );
    console.log(`  ✅ DB updated: refund_tx_hash = ${result.txHash}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const db = new Client({ connectionString: RAILWAY_DB });
  await db.connect();
  console.log('✅ Connected to Railway DB\n');

  // ── 1. Expired/cancelled bet offers with on-chain escrow, no refund yet ────
  const { rows: offers } = await db.query(`
    SELECT id, creator_wallet, creator_stake, currency, status,
           onchain_offer_id, onchain_config_id
    FROM p2p_bet_offers
    WHERE status IN ('expired', 'cancelled')
      AND onchain_offer_id IS NOT NULL AND onchain_offer_id != ''
      AND (refund_tx_hash IS NULL OR refund_tx_hash = '' OR refund_tx_hash = 'PENDING')
    ORDER BY id
  `);

  console.log(`Found ${offers.length} on-chain bet offer(s) to expire/refund:`);
  for (const row of offers) {
    const coinType = (row.currency || 'SUI').toUpperCase() === 'SBETS' ? SBETS_COIN_TYPE : SUI_COIN_TYPE;
    const label    = `Offer #${row.id} (${row.creator_stake} ${row.currency} → ${row.creator_wallet.slice(0,14)}...)`;
    await processItem(
      row.onchain_offer_id, coinType, expireOffer, label,
      db, 'p2p_bet_offers', 'id', 'refund_tx_hash', row.id
    );
  }

  // ── 2. Expired/cancelled parlay offers with on-chain escrow, no refund yet ─
  const { rows: parlays } = await db.query(`
    SELECT id, creator_wallet, creator_stake, currency, status,
           onchain_parlay_id, onchain_config_id
    FROM p2p_parlay_offers
    WHERE status IN ('expired', 'cancelled')
      AND onchain_parlay_id IS NOT NULL AND onchain_parlay_id != ''
      AND (refund_tx_hash IS NULL OR refund_tx_hash = '' OR refund_tx_hash = 'PENDING')
    ORDER BY id
  `);

  console.log(`\nFound ${parlays.length} on-chain parlay offer(s) to expire/refund:`);
  for (const row of parlays) {
    const coinType = (row.currency || 'SUI').toUpperCase() === 'SBETS' ? SBETS_COIN_TYPE : SUI_COIN_TYPE;
    const label    = `Parlay #${row.id} (${row.creator_stake} ${row.currency} → ${row.creator_wallet.slice(0,14)}...)`;
    await processItem(
      row.onchain_parlay_id, coinType, expireParlay, label,
      db, 'p2p_parlay_offers', 'id', 'refund_tx_hash', row.id
    );
  }

  await db.end();
  console.log('\n✅ All done. Contract refunds triggered — funds sent directly by the smart contract to each maker.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
