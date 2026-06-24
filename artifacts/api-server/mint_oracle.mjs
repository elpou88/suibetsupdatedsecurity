import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const rpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('mainnet') });
const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);

const TB2_PKG = '0xc6ea3100c63cd2e27f9a75b9a6ea2db33f58be4b39a07bb11bf5f424b212aa76';
const TB2_PLATFORM = '0x0b1beb33fdbd405acab159711e033cc59d3d1e2f5d1ab75ecc6f3b740414cb24';
const TB2_ADMIN_CAP = '0x3810dcb72b88db48eb99e222de8a605ecfd39ee5a0a9f052cccfb73ff6320650';
const ADMIN_ADDR = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';

const tx = new Transaction();
// Set gas budget explicitly to bypass simulation
tx.setGasBudget(20_000_000);
tx.setSender(ADMIN_ADDR);

tx.moveCall({
  target: `${TB2_PKG}::betting_tb2::mint_oracle_cap`,
  arguments: [
    tx.object(TB2_ADMIN_CAP),
    tx.object(TB2_PLATFORM),
    tx.pure.address(ADMIN_ADDR),
  ],
});

const result = await rpc.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showEffects: true, showObjectChanges: true },
});

console.log('Status:', result.effects?.status?.status);
console.log('Digest:', result.digest);
const created = (result.objectChanges || []).filter(c => c.type === 'created');
created.forEach(c => console.log('OracleCapID:', c.objectId, '|', c.objectType));
