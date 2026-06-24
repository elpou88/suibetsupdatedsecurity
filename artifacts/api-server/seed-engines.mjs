/**
 * seed-engines.mjs — SuiBets Engine Seeder
 *
 * Creates PULSE pools + FLUX market-maker offers for real World Cup 2026 matches.
 * Run: ADMIN_PRIVATE_KEY=... node seed-engines.mjs
 */
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction }         from '@mysten/sui/transactions';
import { SuiJsonRpcClient }    from '@mysten/sui/jsonRpc';

// ── Deployed addresses ────────────────────────────────────────────────────────
const RPC         = 'https://fullnode.mainnet.sui.io:443';
const FLUX_PKG    = '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018';
const FLUX_STATS  = '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320';
const PULSE_PKG   = '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238';
const PULSE_STATS = '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff';
const ORACLE_CAP  = '0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55';
const CLOCK       = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_T       = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

// PULSE minimum stake per side (0.01 SUI)
const STAKE_PER_SIDE = 10_000_000n;
// FLUX offer size (0.05 SUI)
const FLUX_OFFER_SIZE = 50_000_000n;

// ── Upcoming World Cup 2026 matches to seed ───────────────────────────────────
const MATCHES = [
  { espnId: '760427', home: 'Iran',       away: 'New Zealand', date: '2026-06-16T01:00Z' },
  { espnId: '760432', home: 'France',     away: 'Senegal',     date: '2026-06-16T19:00Z' },
  { espnId: '760430', home: 'Iraq',       away: 'Norway',      date: '2026-06-16T22:00Z' },
  { espnId: '760433', home: 'Argentina',  away: 'Algeria',     date: '2026-06-17T01:00Z' },
  { espnId: '760431', home: 'Austria',    away: 'Jordan',      date: '2026-06-17T04:00Z' },
  { espnId: '760435', home: 'Portugal',   away: 'Congo DR',    date: '2026-06-17T17:00Z' },
  { espnId: '760437', home: 'England',    away: 'Croatia',     date: '2026-06-17T20:00Z' },
  { espnId: '760434', home: 'Ghana',      away: 'Panama',      date: '2026-06-17T23:00Z' },
  { espnId: '760436', home: 'Uzbekistan', away: 'Colombia',    date: '2026-06-18T02:00Z' },
];

if (!process.env.ADMIN_PRIVATE_KEY) {
  console.error('ADMIN_PRIVATE_KEY not set'); process.exit(1);
}

const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
const kp     = Ed25519Keypair.fromSecretKey(secretKey);
const admin  = kp.toSuiAddress();
const client = new SuiJsonRpcClient({ url: RPC });

let created = 0, failed = 0;
const poolIds = [];

async function execTx(tx) {
  const r = await client.signAndExecuteTransaction({
    transaction: tx, signer: kp,
    options: { showEffects: true, showObjectChanges: true },
  });
  return {
    ok:      r?.effects?.status?.status === 'success',
    digest:  r?.digest ?? '',
    error:   r?.effects?.status?.error,
    changes: r?.objectChanges ?? [],
  };
}

function toBytes(str) { return Array.from(Buffer.from(str, 'utf8')); }

async function checkBalance() {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getBalance', params: [admin, '0x2::sui::SUI'] }),
  });
  const d = await r.json();
  return BigInt(d.result?.totalBalance ?? 0);
}

// ── Create a single PULSE pool ────────────────────────────────────────────────
async function createPulsePool(match) {
  const { espnId, home, away } = match;
  const label = `${home} vs ${away}`;

  try {
    const tx = new Transaction();

    // split two equal stakes from gas coin
    const [cA, cB] = tx.splitCoins(tx.gas, [STAKE_PER_SIDE, STAKE_PER_SIDE]);

    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_create_pool`,
      typeArguments: [SUI_T],
      arguments: [
        cA,
        cB,
        tx.pure.vector('u8', toBytes(espnId)),
        tx.pure.vector('u8', toBytes(home)),
        tx.pure.vector('u8', toBytes(away)),
        tx.object(PULSE_STATS),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(25_000_000);

    const t0 = Date.now();
    const r  = await execTx(tx);

    if (!r.ok) throw new Error(r.error ?? 'tx failed');

    const poolObj = r.changes.find(x =>
      x.type === 'created' && (x.objectType ?? '').includes('PulsePool')
    );
    const poolId  = poolObj?.objectId ?? '';
    poolIds.push({ poolId, match });
    created++;
    const ms = Date.now() - t0;
    console.log(`  ✅ PULSE pool  ${label}`);
    console.log(`     pool_id : ${poolId}`);
    console.log(`     digest  : ${r.digest}  (${ms}ms)`);
    console.log(`     suiscan : https://suiscan.xyz/mainnet/object/${poolId}`);
    return poolId;
  } catch (e) {
    failed++;
    console.error(`  ❌ PULSE pool  ${label}  →  ${String(e.message).slice(0, 140)}`);
    return '';
  }
}

// ── Create a FLUX market-maker offer ─────────────────────────────────────────
async function createFluxOffer(match, prediction) {
  const { espnId, home, away } = match;
  const label = `${home} vs ${away}  [${prediction}]`;

  try {
    const tx = new Transaction();
    const [makerCoin] = tx.splitCoins(tx.gas, [FLUX_OFFER_SIZE]);

    tx.moveCall({
      target:        `${FLUX_PKG}::flux_engine::flux_create_offer`,
      typeArguments: [SUI_T],
      arguments: [
        makerCoin,
        tx.pure.vector('u8', toBytes(espnId)),
        tx.pure.vector('u8', toBytes(prediction)),
        tx.object(FLUX_STATS),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(25_000_000);

    const t0 = Date.now();
    const r  = await execTx(tx);

    if (!r.ok) throw new Error(r.error ?? 'tx failed');

    const offerObj = r.changes.find(x =>
      x.type === 'created' && (x.objectType ?? '').includes('FluxOffer')
    );
    const offerId  = offerObj?.objectId ?? '';
    created++;
    const ms = Date.now() - t0;
    console.log(`  ✅ FLUX offer   ${label}`);
    console.log(`     offer_id: ${offerId}`);
    console.log(`     digest  : ${r.digest}  (${ms}ms)`);
    return offerId;
  } catch (e) {
    failed++;
    console.error(`  ❌ FLUX offer   ${label}  →  ${String(e.message).slice(0, 140)}`);
    return '';
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(62));
console.log('  SuiBets Engine Seeder — World Cup 2026');
console.log('═'.repeat(62));
console.log('  Admin  :', admin);

const balanceBefore = await checkBalance();
console.log('  Balance:', (Number(balanceBefore) / 1e9).toFixed(4), 'SUI');
console.log('  Matches:', MATCHES.length);
console.log('═'.repeat(62));

// ── Phase 1: PULSE pools ──────────────────────────────────────────────────────
console.log('\n📦  Phase 1 — Creating PULSE pools\n');
for (const match of MATCHES) {
  await createPulsePool(match);
  await new Promise(r => setTimeout(r, 1200)); // brief pause between txs
}

// ── Phase 2: FLUX offers (home-win prediction per match) ──────────────────────
console.log('\n📊  Phase 2 — Creating FLUX market-maker offers\n');
for (const match of MATCHES) {
  await createFluxOffer(match, match.home); // home-win offer
  await new Promise(r => setTimeout(r, 1200));
  await createFluxOffer(match, match.away); // away-win offer
  await new Promise(r => setTimeout(r, 1200));
}

// ── Summary ───────────────────────────────────────────────────────────────────
const balanceAfter = await checkBalance();
const spent = balanceBefore - balanceAfter;

console.log('\n' + '═'.repeat(62));
console.log(`  Created : ${created}  |  Failed: ${failed}`);
console.log(`  Spent   : ${(Number(spent) / 1e9).toFixed(4)} SUI`);
console.log(`  Balance : ${(Number(balanceAfter) / 1e9).toFixed(4)} SUI remaining`);

if (poolIds.length > 0) {
  console.log('\n  Active PULSE pools on-chain:');
  for (const { poolId, match } of poolIds) {
    if (poolId) {
      console.log(`    ${match.home} vs ${match.away}  (${match.date})`);
      console.log(`    https://suiscan.xyz/mainnet/object/${poolId}`);
    }
  }
}

console.log('═'.repeat(62) + '\n');
if (failed > 0) process.exit(1);
