/**
 * seed-flux-offers.mjs — Create FLUX market-maker offers for World Cup 2026 matches
 *
 * flux_create_offer(
 *   maker_coin: Coin<T>,
 *   event_id: vector<u8>,
 *   prediction: vector<u8>,
 *   min_shard_taker: u64,   // minimum fill per shard (10_000_000 MIST = 0.01 SUI)
 *   odds_bps: u64,           // odds in basis points (10000 = even, 20000 = 2:1)
 *   &mut FluxStats,
 *   &Clock,
 *   ctx: &mut TxContext
 * )
 */
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction }         from '@mysten/sui/transactions';
import { SuiJsonRpcClient }    from '@mysten/sui/jsonRpc';

const RPC        = 'https://fullnode.mainnet.sui.io:443';
const FLUX_PKG   = '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018';
const FLUX_STATS = '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320';
const CLOCK      = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_T      = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const OFFER_SIZE     = 50_000_000n;  // 0.05 SUI per offer
const MIN_FILL       = 10_000_000n;  // 0.01 SUI min fill per shard
const ODDS_BPS_EVEN  = 20000n;       // even odds (matching existing offers)

const MATCHES = [
  { espnId: '760427', home: 'Iran',       away: 'New Zealand' },
  { espnId: '760432', home: 'France',     away: 'Senegal'     },
  { espnId: '760430', home: 'Iraq',       away: 'Norway'      },
  { espnId: '760433', home: 'Argentina',  away: 'Algeria'     },
  { espnId: '760431', home: 'Austria',    away: 'Jordan'      },
  { espnId: '760435', home: 'Portugal',   away: 'Congo DR'    },
  { espnId: '760437', home: 'England',    away: 'Croatia'     },
  { espnId: '760434', home: 'Ghana',      away: 'Panama'      },
  { espnId: '760436', home: 'Uzbekistan', away: 'Colombia'    },
];

if (!process.env.ADMIN_PRIVATE_KEY) { console.error('ADMIN_PRIVATE_KEY not set'); process.exit(1); }

const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
const kp     = Ed25519Keypair.fromSecretKey(secretKey);
const admin  = kp.toSuiAddress();
const client = new SuiJsonRpcClient({ url: RPC });

function toBytes(str) { return Array.from(Buffer.from(str, 'utf8')); }

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

async function checkBalance() {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'suix_getBalance', params:[admin,'0x2::sui::SUI'] }),
  });
  return BigInt((await r.json()).result?.totalBalance ?? 0);
}

let ok = 0, fail = 0;

async function createOffer(espnId, prediction) {
  const label = `${espnId} [${prediction}]`;
  try {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [OFFER_SIZE]);
    tx.moveCall({
      target: `${FLUX_PKG}::flux_engine::flux_create_offer`,
      typeArguments: [SUI_T],
      arguments: [
        coin,
        tx.pure.vector('u8', toBytes(espnId)),
        tx.pure.vector('u8', toBytes(prediction)),
        tx.pure.u64(ODDS_BPS_EVEN),
        tx.pure.u64(MIN_FILL),
        tx.object(FLUX_STATS),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(25_000_000);

    const t0 = Date.now();
    const r  = await execTx(tx);
    if (!r.ok) throw new Error(r.error ?? 'tx failed');

    const offerObj = r.changes.find(x => x.type === 'created' && (x.objectType ?? '').includes('FluxOffer'));
    ok++;
    console.log(`  ✅ ${label}  →  ${offerObj?.objectId?.slice(0,24)}…  (${Date.now()-t0}ms)`);
    console.log(`     ${r.digest}`);
    return offerObj?.objectId ?? '';
  } catch (e) {
    fail++;
    console.error(`  ❌ ${label}  →  ${String(e.message).slice(0,120)}`);
    return '';
  }
}

console.log('\n' + '═'.repeat(62));
console.log('  SuiBets FLUX Offer Seeder — World Cup 2026');
console.log('═'.repeat(62));
const bal = await checkBalance();
console.log('  Admin  :', admin);
console.log('  Balance:', (Number(bal) / 1e9).toFixed(4), 'SUI');
console.log('  Each offer:', Number(OFFER_SIZE) / 1e9, 'SUI  ×', MATCHES.length * 2, '=', Number(OFFER_SIZE) * MATCHES.length * 2 / 1e9, 'SUI total');
console.log('═'.repeat(62) + '\n');

for (const m of MATCHES) {
  // Home-win offer
  await createOffer(m.espnId, m.home);
  await new Promise(r => setTimeout(r, 1000));
  // Away-win offer
  await createOffer(m.espnId, m.away);
  await new Promise(r => setTimeout(r, 1000));
}

const balAfter = await checkBalance();
console.log('\n' + '═'.repeat(62));
console.log(`  OK: ${ok}  |  Failed: ${fail}`);
console.log(`  Spent : ${(Number(bal - balAfter) / 1e9).toFixed(4)} SUI`);
console.log(`  Remaining: ${(Number(balAfter) / 1e9).toFixed(4)} SUI`);
console.log('═'.repeat(62) + '\n');
if (fail > 0) process.exit(1);
