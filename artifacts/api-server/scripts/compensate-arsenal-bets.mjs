/**
 * One-time compensation script for Crystal Palace vs Arsenal (eventId 740968)
 * Arsenal (Away) won 2-1 but bet creators who predicted "away" were wrongly settled as LOST.
 * Takers already received incorrect payouts. This script sends correct payouts to the creators.
 *
 * Run: node scripts/compensate-arsenal-bets.mjs
 * Requires: DATABASE_URL, ADMIN_PRIVATE_KEY, ADMIN_WALLET_ADDRESS in environment
 */

import postgres from 'postgres';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// Always use the full coin type — env var may be set to just the package ID
const SBETS_TOKEN_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';

const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';

// ------- Compensation data (pre-computed, verified against DB) -------
const COMPENSATIONS = [
  {
    offerId: 33,
    matchId: 11,
    creatorWallet: '0x0b3843cc82dc8908cd5363128e37fe58b5d8087101e58cb8d4379e0a6e9a0ff6',
    amountSbets: 93132,
    note: 'Offer #33 — pred=away, odds=1.56, creator_stake=60000',
  },
  {
    offerId: 52,
    matchId: 19,
    creatorWallet: '0x798e8bb6db3f9c0233ca3521a7b5431af39350b3092144c74be033b468e48426',
    amountSbets: 1996000,
    note: 'Offer #52 — pred=away, odds=2.0, creator_stake=1000000',
  },
  {
    offerId: 59,
    matchId: 23,
    creatorWallet: '0x09ee92c61fc50d5af645f3757447b31ab37cd31847103975e5559b6ca0052446',
    amountSbets: 269460,
    note: 'Offer #59 — pred=away, odds=2.7, creator_stake=100000',
  },
];

function getKeypair() {
  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk) throw new Error('ADMIN_PRIVATE_KEY not set');
  const { secretKey } = decodeSuiPrivateKey(pk);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

/** Use raw fetch against the Sui JSON-RPC to list ALL coin objects — bypasses SDK pagination limits */
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

  const coins = await getAllSbetsCoins(keypair.toSuiAddress());

  if (!coins || coins.length === 0) {
    throw new Error('No SBETS coins in admin wallet');
  }

  const totalBalance = coins.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
  console.log(`  Admin SBETS balance: ${Number(totalBalance) / 1e9} SBETS across ${coins.length} coin object(s) (need ${amount})`);

  if (totalBalance < amountInSmallest) {
    throw new Error(`Insufficient SBETS: ${Number(totalBalance) / 1e9} < ${amount}`);
  }

  const tx = new Transaction();
  const coinIds = coins.map(c => c.coinObjectId);

  // Merge if multiple coins, then split exact amount
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
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('No DATABASE_URL');

  const sql = postgres(dbUrl, { max: 1, ssl: 'prefer' });

  const client = new SuiJsonRpcClient({ url: SUI_RPC, network: 'mainnet' });
  const keypair = getKeypair();

  console.log(`\n=== Arsenal Compensation Script ===`);
  console.log(`Admin wallet: ${keypair.toSuiAddress()}`);
  console.log(`SBETS type:   ${SBETS_TOKEN_TYPE}\n`);

  // Upsert correct result in settled_events (best-effort — already done by API endpoint)
  try {
    await sql`
      INSERT INTO settled_events (external_event_id, home_team, away_team, home_score, away_score, winner, settled_at, bets_settled)
      VALUES ('740968', 'Crystal Palace', 'Arsenal', 1, 2, 'away', NOW(), 0)
      ON CONFLICT (external_event_id)
      DO UPDATE SET home_score = 1, away_score = 2, winner = 'away', settled_at = NOW()
    `;
    console.log('✅ settled_events upserted\n');
  } catch (e) {
    console.log(`⚠️  settled_events upsert skipped (${e.message.split('\n')[0]}) — continuing\n`);
  }

  let totalSent = 0;
  const results = [];

  for (const comp of COMPENSATIONS) {
    console.log(`--- Processing ${comp.note} ---`);
    console.log(`  Creator: ${comp.creatorWallet}`);
    console.log(`  Amount:  ${comp.amountSbets.toLocaleString()} SBETS`);

    try {
      const txHash = await sendSbets(client, keypair, comp.creatorWallet, comp.amountSbets);
      console.log(`  ✅ TX: ${txHash}`);

      await sql`
        UPDATE p2p_bet_matches
        SET status = 'creator_won',
            settlement_tx_hash = ${txHash},
            settled_at = NOW()
        WHERE id = ${comp.matchId}
      `;

      await sql`
        UPDATE p2p_bet_offers
        SET winner = 'creator',
            settlement_tx_hash = ${txHash},
            status = 'settled',
            updated_at = NOW()
        WHERE id = ${comp.offerId}
      `;

      totalSent += comp.amountSbets;
      results.push({ ...comp, txHash, success: true });
      console.log(`  ✅ DB updated (offer ${comp.offerId} → creator_won)\n`);
    } catch (err) {
      console.error(`  ❌ FAILED: ${err.message}\n`);
      results.push({ ...comp, error: err.message, success: false });
    }
  }

  console.log('=== Summary ===');
  for (const r of results) {
    if (r.success) {
      console.log(`✅ Offer ${r.offerId}: sent ${r.amountSbets.toLocaleString()} SBETS → TX: ${r.txHash}`);
    } else {
      console.log(`❌ Offer ${r.offerId}: FAILED — ${r.error}`);
    }
  }
  console.log(`\nTotal SBETS compensated: ${totalSent.toLocaleString()} / 2,358,592`);

  await sql.end();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
