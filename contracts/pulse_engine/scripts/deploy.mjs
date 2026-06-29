/**
 * deploy.mjs — PULSE Engine deployer (Node.js SDK)
 *
 * Compiles with `sui move build --dump-bytecode-as-base64`
 * then publishes via @mysten/sui TypeScript SDK.
 * No keystore file needed — uses ADMIN_PRIVATE_KEY env var directly.
 *
 * Run:
 *   node contracts/pulse_engine/scripts/deploy.mjs
 */

import { execSync }             from 'child_process';
import { writeFileSync }        from 'fs';
import { fileURLToPath }        from 'url';
import { dirname, join }        from 'path';
import { decodeSuiPrivateKey }  from '@mysten/sui/cryptography';
import { Ed25519Keypair }       from '@mysten/sui/keypairs/ed25519';
import { Transaction }          from '@mysten/sui/transactions';
import { SuiClient }            from '@mysten/sui/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_DIR = join(__dirname, '..');
const SUI_BIN = '/tmp/sui';
const RPC_URL = 'https://fullnode.mainnet.sui.io:443';

const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY || process.env.admin_private_key || '';
if (!ADMIN_KEY) { console.error('❌ ADMIN_PRIVATE_KEY not set'); process.exit(1); }

const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const address = keypair.getPublicKey().toSuiAddress();
const client  = new SuiClient({ url: RPC_URL });

console.log('🌊 PULSE Engine Deploy');
console.log(`   Wallet : ${address}`);
console.log(`   Network: Sui Mainnet`);
console.log('');

// 1. Compile and dump bytecode
console.log('🔨 Compiling PULSE Engine...');
const buildOut = execSync(
  `${SUI_BIN} move build --path ${CONTRACT_DIR} --dump-bytecode-as-base64 --with-unpublished-dependencies --allow-dirty`,
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
);

const jsonStart = buildOut.indexOf('{');
if (jsonStart === -1) throw new Error('No JSON in build output:\n' + buildOut);
const compiled = JSON.parse(buildOut.slice(jsonStart));

const modules  = compiled.modules;
const depIds   = compiled.dependencies;

console.log(`✅ Compiled — ${modules.length} module(s), ${depIds.length} dep(s)`);

// 2. Build publish transaction
const tx = new Transaction();
const [upgradeCap] = tx.publish({ modules, dependencies: depIds });
tx.transferObjects([upgradeCap], tx.pure.address(address));
tx.setSender(address);
tx.setGasBudget(500_000_000);

// 3. Sign and execute
console.log('');
console.log('🚀 Publishing to Sui mainnet...');
const bytes  = await tx.build({ client });
const signed = await keypair.signTransaction(bytes);
const result = await client.executeTransactionBlock({
  transactionBlock: bytes,
  signature:        signed.signature,
  options: { showEffects: true, showObjectChanges: true, showEvents: true },
});

const status = result.effects?.status?.status;
const digest = result.digest;

if (status !== 'success') {
  console.error('❌ Publish failed:', result.effects?.status?.error);
  console.error('   Digest:', digest);
  process.exit(1);
}

// 4. Extract IDs
const changes   = result.objectChanges || [];
const pkg       = changes.find(o => o.type === 'published');
const stats     = changes.find(o => o.type === 'created' && o.objectType?.includes('PulseStats'));
const adminCap  = changes.find(o => o.type === 'created' && o.objectType?.includes('PulseAdminCap'));
const upgrade   = changes.find(o => o.type === 'created' && o.objectType?.includes('UpgradeCap'));

const PULSE_PACKAGE_ID    = pkg?.packageId    || '';
const PULSE_STATS_ID      = stats?.objectId   || '';
const PULSE_ADMIN_CAP_ID  = adminCap?.objectId || '';
const PULSE_UPGRADE_CAP_ID = upgrade?.objectId || '';

// 5. Save deployed.env
const env = [
  `PULSE_PACKAGE_ID=${PULSE_PACKAGE_ID}`,
  `PULSE_STATS_ID=${PULSE_STATS_ID}`,
  `PULSE_ADMIN_CAP_ID=${PULSE_ADMIN_CAP_ID}`,
  `PULSE_UPGRADE_CAP_ID=${PULSE_UPGRADE_CAP_ID}`,
  `PULSE_TX_DIGEST=${digest}`,
  `DEPLOY_DATE=${new Date().toISOString()}`,
  `DEPLOYED_BY=${address}`,
].join('\n');
writeFileSync(join(CONTRACT_DIR, 'deployed.env'), env);

// 6. Print summary
console.log('');
console.log('══════════════════════════════════════════════════════════');
console.log('  🌊  PULSE Engine Deployed!');
console.log('══════════════════════════════════════════════════════════');
console.log('');
console.log(`  PULSE_PACKAGE_ID    = ${PULSE_PACKAGE_ID}`);
console.log(`  PULSE_STATS_ID      = ${PULSE_STATS_ID}`);
console.log(`  PULSE_ADMIN_CAP_ID  = ${PULSE_ADMIN_CAP_ID}`);
console.log(`  PULSE_UPGRADE_CAP_ID= ${PULSE_UPGRADE_CAP_ID}`);
console.log(`  TX_DIGEST           = ${digest}`);
console.log('');
console.log(`  SuiScan: https://suiscan.xyz/mainnet/object/${PULSE_PACKAGE_ID}`);
console.log(`  TX:      https://suiscan.xyz/mainnet/tx/${digest}`);
console.log('');
console.log('  Add to Replit secrets:');
console.log(`  PULSE_PACKAGE_ID=${PULSE_PACKAGE_ID}`);
console.log(`  PULSE_STATS_ID=${PULSE_STATS_ID}`);
console.log('══════════════════════════════════════════════════════════');
