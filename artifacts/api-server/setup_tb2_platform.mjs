import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { bcs } from '@mysten/sui/bcs';

const rpc = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('mainnet') });
const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
const adminKeypair = Ed25519Keypair.fromSecretKey(secretKey);

const oracleKeyEnv = process.env.ORACLE_SIGNING_KEY;
let oracleKeypair;
if (oracleKeyEnv) {
  if (oracleKeyEnv.startsWith('suiprivkey')) {
    const { secretKey: sk } = decodeSuiPrivateKey(oracleKeyEnv);
    oracleKeypair = Ed25519Keypair.fromSecretKey(sk);
  } else {
    oracleKeypair = Ed25519Keypair.fromSecretKey(Buffer.from(oracleKeyEnv, 'hex'));
  }
} else {
  oracleKeypair = adminKeypair;
  console.log('Using admin key as oracle (ORACLE_SIGNING_KEY not set)');
}

const oraclePubKey = Array.from(oracleKeypair.getPublicKey().toRawBytes());
console.log('Oracle pub key (hex):', Buffer.from(oraclePubKey).toString('hex'));

const TB2_PKG = '0x2bc303df97ddd98f1271c0a42e6e00e9bcd0e6d0caa4b385f9a2cff8f2107223';
const TB2_PLATFORM = '0x0b1beb33fdbd405acab159711e033cc59d3d1e2f5d1ab75ecc6f3b740414cb24';
const TB2_ADMIN_CAP = '0x3810dcb72b88db48eb99e222de8a605ecfd39ee5a0a9f052cccfb73ff6320650';
const CLOCK = '0x6';

const tx = new Transaction();
tx.setGasBudget(50_000_000);
tx.setSender(adminKeypair.toSuiAddress());

// 1. Set oracle public key (admin_cap, platform, new_public_key, clock)
tx.moveCall({
  target: `${TB2_PKG}::betting_tb2::set_oracle_public_key`,
  arguments: [
    tx.object(TB2_ADMIN_CAP),
    tx.object(TB2_PLATFORM),
    tx.pure(bcs.vector(bcs.u8()).serialize(oraclePubKey).toBytes()),
    tx.object(CLOCK),
  ],
});

// 2. Unpause (_admin_cap, platform, paused, clock)
tx.moveCall({
  target: `${TB2_PKG}::betting_tb2::set_pause`,
  arguments: [
    tx.object(TB2_ADMIN_CAP),
    tx.object(TB2_PLATFORM),
    tx.pure.bool(false),
    tx.object(CLOCK),
  ],
});

const result = await rpc.signAndExecuteTransaction({
  signer: adminKeypair,
  transaction: tx,
  options: { showEffects: true },
});

console.log('Status:', result.effects?.status?.status);
if (result.effects?.status?.status !== 'success') {
  console.error('Error:', JSON.stringify(result.effects?.status));
} else {
  console.log('✅ TB2 oracle key set & platform unpaused | TX:', result.digest);
}
