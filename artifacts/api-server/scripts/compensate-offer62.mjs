/**
 * One-time compensation script for Villarreal vs Atlético Madrid (offer #62, match #25)
 *
 * What happened:
 *   Offer #62: creator predicted "draw" at odds 3.33 (stake 250,000 SBETS).
 *   Taker (match #25) staked 582,500 SBETS on the opposite side.
 *   The actual result was Villarreal 5-1 Atlético Madrid → HOME win.
 *   Creator's "draw" prediction LOST. Taker should have won.
 *
 *   Root cause: fetchEventResultFromESPN matched a DIFFERENT completed ESPN event
 *   with the same numeric ID (748515) in another competition, which showed
 *   STATUS_FINAL as "draw". This bypassed the 110-minute time guard (which only
 *   fires when ESPN returns null) and incorrectly settled the offer as creator_won.
 *
 *   The original payout TX (HgceHjAKw2RArEM6LLW6XugWouBjAUzk5oJ1EkEdzN39) sent
 *   830,835 SBETS to the CREATOR wallet instead of the taker.
 *
 * This script:
 *   1. Sends 830,835 SBETS to the taker wallet as compensation.
 *   2. Corrects the DB records: offer #62 winner → 'taker', match #25 winner → taker wallet.
 *   3. Upserts the correct match result (home win) into settled_events.
 *
 * Run: DATABASE_URL=<railway_url> node scripts/compensate-offer62.mjs
 * Requires: RAILWAY_DATABASE_URL (or DATABASE_URL), ADMIN_PRIVATE_KEY in environment.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import pkg from 'pg';
const { Pool } = pkg;

const SBETS_TOKEN_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';

const OFFER_ID     = 62;
const MATCH_ID     = 25;
const TAKER_WALLET = '0x75eca2d6724c8075dd7d207fab6b20e8afb7e76e74d25c176ba21e2bd76d957b';
const AMOUNT_SBETS = 830_835;
const EVENT_ID     = '748515';

function getKeypair() {
  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk) throw new Error('ADMIN_PRIVATE_KEY not set');
  const { secretKey } = decodeSuiPrivateKey(pk);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

async function getAllSbetsCoins(ownerAddress) {
  const allCoins = [];
  let cursor = null;
  do {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getCoins',
      params: [ownerAddress, SBETS_TOKEN_TYPE, cursor, 50],
    };
    const resp = await fetch(SUI_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    const result = json.result;
    allCoins.push(...result.data);
    cursor = result.hasNextPage ? result.nextCursor : null;
  } while (cursor);
  return allCoins;
}

async function sendSbets(client, keypair, recipient, amount) {
  const amountInSmallest = BigInt(Math.floor(amount * 1_000_000_000));
  const ownerAddress = keypair.toSuiAddress();
  const coins = await getAllSbetsCoins(ownerAddress);

  if (!coins || coins.length === 0) {
    throw new Error('No SBETS coins in admin wallet');
  }

  const totalBalance = coins.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
  console.log(`  Admin SBETS balance: ${(Number(totalBalance) / 1e9).toLocaleString()} SBETS across ${coins.length} coin(s) (need ${amount.toLocaleString()})`);

  if (totalBalance < amountInSmallest) {
    throw new Error(`Insufficient SBETS: have ${Number(totalBalance) / 1e9}, need ${amount}`);
  }

  const tx = new Transaction();
  const coinIds = coins.map(c => c.coinObjectId);

  if (coinIds.length > 1) {
    tx.mergeCoins(tx.object(coinIds[0]), coinIds.slice(1).map(id => tx.object(id)));
  }

  const [paymentCoin] = tx.splitCoins(tx.object(coinIds[0]), [amountInSmallest]);
  tx.transferObjects([paymentCoin], recipient);

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  const status = result.effects?.status?.status;
  if (status !== 'success') {
    throw new Error(`TX failed: ${JSON.stringify(result.effects?.status)}`);
  }

  return result.digest;
}

async function run() {
  const dbUrl = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('No RAILWAY_DATABASE_URL or DATABASE_URL set');

  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const client = new SuiJsonRpcClient({ url: SUI_RPC, network: 'mainnet' });
  const keypair = getKeypair();
  const adminAddress = keypair.toSuiAddress();

  console.log('\n=== Offer #62 Compensation Script (Villarreal vs Atlético Madrid) ===');
  console.log(`Admin wallet : ${adminAddress}`);
  console.log(`Taker wallet : ${TAKER_WALLET}`);
  console.log(`Amount       : ${AMOUNT_SBETS.toLocaleString()} SBETS`);
  console.log(`SBETS type   : ${SBETS_TOKEN_TYPE}\n`);

  // 1. Verify current DB state
  const offerRes = await pool.query('SELECT id, event_name, winner, status FROM p2p_bet_offers WHERE id = $1', [OFFER_ID]);
  const matchRes = await pool.query('SELECT id, offer_id, taker_wallet, winner, status FROM p2p_bet_matches WHERE id = $1', [MATCH_ID]);
  if (!offerRes.rows[0]) throw new Error(`Offer ${OFFER_ID} not found`);
  if (!matchRes.rows[0]) throw new Error(`Match ${MATCH_ID} not found`);
  console.log('Current offer state:', offerRes.rows[0]);
  console.log('Current match state:', matchRes.rows[0]);
  console.log('');

  // 2. Send SBETS compensation to taker
  let txHash;
  try {
    console.log(`Sending ${AMOUNT_SBETS.toLocaleString()} SBETS to taker...`);
    txHash = await sendSbets(client, keypair, TAKER_WALLET, AMOUNT_SBETS);
    console.log(`✅ Compensation TX: ${txHash}\n`);
  } catch (err) {
    console.error(`❌ SBETS send failed: ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  // 3. Update match #25: taker won
  await pool.query(`
    UPDATE p2p_bet_matches
    SET status             = 'taker_won',
        winner             = $1,
        settlement_tx_hash = $2,
        payout_tx_hash     = $2,
        settled_at         = NOW()
    WHERE id = $3
  `, [TAKER_WALLET, txHash, MATCH_ID]);
  console.log(`✅ Match ${MATCH_ID} updated: status=taker_won, winner=${TAKER_WALLET.slice(0,14)}...`);

  // 4. Update offer #62: winner = taker
  await pool.query(`
    UPDATE p2p_bet_offers
    SET winner             = 'taker',
        settlement_tx_hash = $1,
        settled_at         = NOW()
    WHERE id = $2
  `, [txHash, OFFER_ID]);
  console.log(`✅ Offer ${OFFER_ID} updated: winner=taker`);

  // 5. Upsert correct result into settled_events (home win: 5-1)
  try {
    await pool.query(`
      INSERT INTO settled_events (external_event_id, home_team, away_team, home_score, away_score, winner, settled_at, bets_settled)
      VALUES ($1, 'Villarreal', 'Atlético Madrid', 5, 1, 'home', NOW(), 1)
      ON CONFLICT (external_event_id)
      DO UPDATE SET home_score = 5, away_score = 1, winner = 'home', settled_at = NOW()
    `, [EVENT_ID]);
    console.log(`✅ settled_events upserted: ${EVENT_ID} → home (5-1)`);
  } catch (e) {
    console.log(`⚠️  settled_events upsert skipped (${e.message.split('\n')[0]}) — not critical`);
  }

  // 6. Final verification
  const finalOffer = await pool.query('SELECT id, winner, status, settled_at FROM p2p_bet_offers WHERE id = $1', [OFFER_ID]);
  const finalMatch = await pool.query('SELECT id, status, winner, settlement_tx_hash FROM p2p_bet_matches WHERE id = $1', [MATCH_ID]);
  console.log('\n=== Final DB state ===');
  console.log('Offer:', finalOffer.rows[0]);
  console.log('Match:', finalMatch.rows[0]);
  console.log(`\n✅ Compensation complete — ${AMOUNT_SBETS.toLocaleString()} SBETS sent to taker`);
  console.log(`   TX: ${txHash}`);

  await pool.end();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
