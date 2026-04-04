import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import crypto from 'crypto';

const PACKAGE_ID = '0x2e354642a3c00571832c03c42575587a0ca38cfe02e4f84cb3404cc9eab403d3';
const PLATFORM_ID = '0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9';
const SBETS_COIN_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006';

const EVENT_ID = 'fa_cup_1531572';
const PREDICTION = 'away';
const EVENT_NAME = 'Southampton vs Arsenal - FA Cup QF';
const ODDS = 142;
const BET_AMOUNT = 1_000_000_000_000_000n; // 1M SBETS

async function main() {
  const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });

  const privKey = process.env.ADMIN_PRIVATE_KEY;
  if (!privKey) throw new Error('ADMIN_PRIVATE_KEY not set');

  let keypair;
  if (privKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privKey);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } else if (privKey.startsWith('0x')) {
    keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(Buffer.from(privKey.slice(2), 'hex')));
  } else {
    keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(Buffer.from(privKey, 'base64')));
  }

  const adminAddress = keypair.toSuiAddress();
  console.log('Admin wallet:', adminAddress);

  // Get admin SBETS coins
  const coins = await client.getCoins({ owner: adminAddress, coinType: SBETS_COIN_TYPE });
  const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  console.log('Admin SBETS:', Number(totalBalance) / 1e9);

  if (totalBalance < BET_AMOUNT) {
    console.log('Admin wallet has', Number(totalBalance)/1e9, 'SBETS, need 1,000,000');
    console.log('Not enough — aborting');
    process.exit(1);
  }

  const timestamp = Date.now();
  const oracleKey = process.env.ORACLE_SIGNING_KEY || process.env.ORACLE_PRIVATE_KEY || crypto.randomBytes(32).toString('hex');
  const oracleMsg = `${EVENT_ID}:${PREDICTION}:${ODDS}:${BET_AMOUNT}:${timestamp}`;
  const signature = crypto.createHmac('sha256', oracleKey).update(oracleMsg).digest();

  const tx = new Transaction();
  tx.setSender(adminAddress);

  const primaryCoin = coins.data[0];
  if (coins.data.length > 1) {
    tx.mergeCoins(tx.object(primaryCoin.coinObjectId), coins.data.slice(1).map(c => tx.object(c.coinObjectId)));
  }

  const [betCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [BET_AMOUNT]);
  const enc = (s) => Array.from(new TextEncoder().encode(s));

  tx.moveCall({
    target: `${PACKAGE_ID}::betting::place_bet_sbets`,
    arguments: [
      tx.object(PLATFORM_ID),
      betCoin,
      tx.pure('vector<u8>', enc(EVENT_ID)),
      tx.pure('vector<u8>', enc(PREDICTION)),
      tx.pure('vector<u8>', enc(EVENT_NAME)),
      tx.pure('u64', ODDS),
      tx.pure('u64', timestamp),
      tx.pure('vector<u8>', Array.from(signature)),
      tx.pure('vector<u8>', enc(oracleMsg)),
      tx.object(CLOCK),
    ],
  });

  console.log('Signing and executing transaction...');
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  console.log('TX Digest:', result.digest);
  console.log('Status:', result.effects?.status?.status);
  if (result.effects?.status?.error) console.log('Error:', result.effects.status.error);
  if (result.events) {
    result.events.forEach(e => {
      console.log('Event type:', e.type);
      console.log('Event data:', JSON.stringify(e.parsedJson, null, 2));
    });
  }
  console.log('SuiVision: https://suivision.xyz/txblock/' + result.digest);
}

main().catch(e => console.error('FAILED:', e.message));
