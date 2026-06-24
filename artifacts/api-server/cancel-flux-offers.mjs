/**
 * cancel-flux-offers.mjs — Cancel all 18 wrong FLUX offers (odds_bps swapped)
 */
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction }         from '@mysten/sui/transactions';
import { SuiJsonRpcClient }    from '@mysten/sui/jsonRpc';

const RPC      = 'https://fullnode.mainnet.sui.io:443';
const FLUX_PKG = '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018';
const CLOCK    = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_T    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

// All 18 bad offer IDs (odds_bps=10_000_000, swapped args)
const BAD_OFFERS = [
  '0x5d10991a76dbb6a566a203152d35cdd08d1a9d060f0ab89b44d0b04d6ba485b6', // 760436 Colombia
  '0x3c2dc3605943d866d34bcef2b64619c5d0509f6bec88a48efbd103232a0f5b61', // 760436 Uzbekistan
  '0xa382f07b56007b009f2f27765764336a50bbd686b588b37742144a2d61016251', // 760434 Panama
  '0x08596890d21a57ad238689395f898c307e66cf763ad14eb7d45ceaf127a0885e', // 760434 Ghana
  '0xa070300fc3bd9e9fd8ea638da1c2943284cac5454d779b10e140cfc03c465dc6', // 760437 Croatia
  '0x36adefe5eb527c2a65f86b2af225b4c4f92dbd1cdd67d6b7bef855568a807200', // 760437 England
  '0x00656c18edff9f22b34ff2759f5d8983ee7218e14ba81e2442c8957a85ee8425', // 760435 Congo DR
  '0x3d9de76d5208241a96c63081b1a68f4576594aadb232b941964efde925ace9f0', // 760435 Portugal
  '0x8de145b0d098d14fcd19e9240886ee5234160979631daac227ce507602459a03', // 760431 Jordan
  '0x902bc1d8bb8834e7ab05a62986547a247c930c69a028eed2e75f85235b7777a3', // 760431 Austria
  '0x273619ee065d142e06516060ee2c87bfeb798c92e58d8e1de27c57cf7a9cabe1', // 760433 Algeria
  '0x91031c81629bd66e07f8d87436a59132a7501b1e32b4bc2e5d79d7c45a049cae', // 760433 Argentina
  '0x9469f4a417f06cab21f5fb326f4ae1cff642e2b224484a63457491e3371e539c', // 760430 Norway
  '0x975cf27055cf8a4251b9a7819110c656f19af569dabf134dfec508411da83c82', // 760430 Iraq
  '0x2e192662c868927c239a5efc723d70f6a06061e6e10c03974539ab4642a76190', // 760432 Senegal
  '0xc7312642aad7e44351c400fab1995fbc97f462ccbdaa1494028402f15183099d', // 760432 France
  '0x6c09afc2094f273a4dd51697a7754210e881be5370d70b0a433fd15e5c29b9cd', // 760427 New Zealand
  '0x43e0b9e89170280613b1bc2c2c8ba562627bafc5ef380b34c28908d2e1297b1b', // 760427 Iran
];

if (!process.env.ADMIN_PRIVATE_KEY) { console.error('ADMIN_PRIVATE_KEY not set'); process.exit(1); }
const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
const kp     = Ed25519Keypair.fromSecretKey(secretKey);
const client = new SuiJsonRpcClient({ url: RPC });

async function cancelBatch(offerIds) {
  const tx = new Transaction();
  for (const id of offerIds) {
    tx.moveCall({
      target:        `${FLUX_PKG}::flux_engine::flux_cancel_offer`,
      typeArguments: [SUI_T],
      arguments: [
        tx.object(id),
        tx.object(CLOCK),
      ],
    });
  }
  tx.setGasBudget(100_000_000);
  const r = await client.signAndExecuteTransaction({
    transaction: tx, signer: kp,
    options: { showEffects: true },
  });
  return {
    ok:     r?.effects?.status?.status === 'success',
    digest: r?.digest ?? '',
    error:  r?.effects?.status?.error,
  };
}

console.log('\n' + '═'.repeat(62));
console.log('  Cancelling 18 wrong FLUX offers (swapped args)');
console.log('═'.repeat(62));

// Cancel in 2 batches of 9 to keep PTB size manageable
const batch1 = BAD_OFFERS.slice(0, 9);
const batch2 = BAD_OFFERS.slice(9);

console.log('\nBatch 1 (9 offers)…');
const t0 = Date.now();
try {
  const r = await cancelBatch(batch1);
  if (r.ok) console.log(`  ✅ Batch 1 cancelled  ${r.digest}  (${Date.now()-t0}ms)`);
  else       console.error(`  ❌ Batch 1 failed: ${r.error}`);
} catch (e) { console.error('  ❌ Batch 1 error:', e.message); }

await new Promise(r => setTimeout(r, 2000));

console.log('Batch 2 (9 offers)…');
const t1 = Date.now();
try {
  const r = await cancelBatch(batch2);
  if (r.ok) console.log(`  ✅ Batch 2 cancelled  ${r.digest}  (${Date.now()-t1}ms)`);
  else       console.error(`  ❌ Batch 2 failed: ${r.error}`);
} catch (e) { console.error('  ❌ Batch 2 error:', e.message); }

console.log('\n' + '═'.repeat(62) + '\n');
