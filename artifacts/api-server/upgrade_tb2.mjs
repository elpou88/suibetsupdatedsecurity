import { readFileSync } from 'fs';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { bcs } from '@mysten/sui/bcs';

const rpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('mainnet') });
const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);

const TB2_PKG = '0xc6ea3100c63cd2e27f9a75b9a6ea2db33f58be4b39a07bb11bf5f424b212aa76';
const TB2_UPGRADE_CAP = '0x41f8388e071a4ad1ea90a062ca8288108674af7c4b0a543f090cefc16c0b3020';

const moduleBytes = readFileSync('/home/runner/workspace/contracts/tb2/build/suibets_tb2/bytecode_modules/betting_tb2.mv');

const dependencies = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0xd7ca095524ec25cd3a276506d8045ef4992c82381145dec375a9ede9b34b5b02',
];

// Digest the chain computed from previous attempt (DigestDoesNotMatch error told us this):
const digest = [74, 193, 169, 203, 203, 138, 106, 103, 190, 222, 39, 135, 144, 172, 171, 215,
                124, 69, 153, 166, 19, 81, 11, 4, 113, 162, 132, 157, 75, 168, 96, 26];
console.log('Using exact on-chain digest:', Buffer.from(digest).toString('hex'));

const tx = new Transaction();
tx.setGasBudget(300_000_000);
tx.setSender(keypair.toSuiAddress());

const [upgradeTicket] = tx.moveCall({
  target: '0x2::package::authorize_upgrade',
  arguments: [
    tx.object(TB2_UPGRADE_CAP),
    tx.pure.u8(0),
    tx.pure(bcs.vector(bcs.u8()).serialize(digest).toBytes()),
  ],
});

const [upgradeReceipt] = tx.upgrade({
  modules: [Uint8Array.from(moduleBytes)],
  dependencies,
  package: TB2_PKG,
  ticket: upgradeTicket,
});

tx.moveCall({
  target: '0x2::package::commit_upgrade',
  arguments: [
    tx.object(TB2_UPGRADE_CAP),
    upgradeReceipt,
  ],
});

const result = await rpc.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showEffects: true, showObjectChanges: true },
});

console.log('Status:', result.effects?.status?.status);
if (result.effects?.status?.status !== 'success') {
  console.error('Error:', JSON.stringify(result.effects?.status));
}
console.log('Digest:', result.digest);
const published = (result.objectChanges || []).filter(c => c.type === 'published');
published.forEach(c => console.log('New PackageID:', c.packageId, 'v', c.version));
