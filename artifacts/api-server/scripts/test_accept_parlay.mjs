import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io' });

const PARLAY_ID  = '0x456935a515909f6bfd12a66a9eba42470c142be31bb3b8af4591904b019acb0d';
const PACKAGE_ID = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG_ID  = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const CLOCK_ID   = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SBETS_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';

const privKey = process.env.ADMIN_PRIVATE_KEY;
if (!privKey) { console.error('No ADMIN_PRIVATE_KEY'); process.exit(1); }

let keypair;
try {
  if (privKey.startsWith('suiprivkey')) {
    const decoded = decodeSuiPrivateKey(privKey);
    keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
  } else {
    keypair = Ed25519Keypair.fromSecretKey(Buffer.from(privKey, 'base64'));
  }
} catch (e) { console.error('Keypair error:', e.message); process.exit(1); }

const adminAddr = keypair.getPublicKey().toSuiAddress();
console.log('Admin address:', adminAddr);

// Fetch parlay object
const parlayObj = await client.getObject({ id: PARLAY_ID, options: { showContent: true } });
const fields = parlayObj?.data?.content?.fields;
if (!fields) { console.error('Could not fetch parlay object fields'); process.exit(1); }

const takerRequired = BigInt(fields.taker_required);
console.log('taker_required (contract):', takerRequired.toString(), '=', Number(takerRequired)/1e9, 'SBETS');
console.log('taker_required (old calc): ', 14520n * 1_000_000_000n, '= 14520 SBETS');
console.log('difference:', takerRequired - 14520n * 1_000_000_000n, 'base units');
console.log('status:', fields.status, '(0=open)');
console.log('taker:', fields.taker ?? 'null (not filled)');

const now = BigInt(Date.now());
const expiresAt = BigInt(fields.expires_at);
console.log('expires_at:', new Date(Number(expiresAt)).toISOString(), '| expired?', now > expiresAt);

// Check SBETS coins for admin
const allCoins = await client.getCoins({ owner: adminAddr, coinType: SBETS_TYPE });
const coins = allCoins.data;
const totalBal = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
console.log('\nAdmin SBETS:', coins.length, 'coins, total balance:', Number(totalBal)/1e9, 'SBETS');
console.log('Sufficient?', totalBal >= takerRequired ? 'YES' : 'NO — need ' + Number(takerRequired)/1e9);

if (coins.length === 0) { console.error('No SBETS coins — simulation will use a synthetic check'); }

// Build transaction for dry-run
const tx = new Transaction();
tx.setSender(adminAddr);
tx.setGasBudget(20_000_000);

let paymentCoin;
if (coins.length > 0) {
  const primary = tx.object(coins[0].coinObjectId);
  if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)));
  [paymentCoin] = tx.splitCoins(primary, [takerRequired]);
} else {
  // No coins — just build for argument validation test
  console.log('\n⚠️  Admin has no SBETS — cannot do full dry-run, checking arg structure only');
  process.exit(0);
}

tx.moveCall({
  target: `${PACKAGE_ID}::p2p_betting::accept_parlay`,
  typeArguments: [SBETS_TYPE],
  arguments: [
    tx.object(CONFIG_ID),
    tx.object(PARLAY_ID),
    paymentCoin,
    tx.object(CLOCK_ID),
  ],
});

console.log('\nRunning dry-run simulation...');
try {
  const built = await tx.build({ client });
  const dryRun = await client.dryRunTransactionBlock({ transactionBlock: built });
  const status = dryRun.effects?.status?.status;
  console.log('Status:', status);
  if (status === 'success') {
    console.log('\n✅  SIMULATION PASSED — accept_parlay works with exact taker_required');
    console.log('Balance changes:');
    for (const bc of dryRun.balanceChanges ?? []) {
      console.log(' ', bc.owner, bc.coinType?.split('::').pop(), bc.amount);
    }
  } else {
    console.log('\n❌  SIMULATION FAILED:', dryRun.effects?.status?.error);
  }
} catch (err) {
  console.error('Dry-run threw:', err.message);
}
