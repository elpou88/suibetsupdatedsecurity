import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient } from '../lib/suiRpcConfig';

const PKG = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG_ID = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const REGISTRY_ID = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP_ID = (process.env.P2P_ORACLE_CAP_ID || '').trim();
const ADMIN_KEY = (process.env.ADMIN_PRIVATE_KEY || '').trim();
const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SBETS = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';

// Match 94: Las Vegas Aces (maker bet HOME=Aces, Aces won — pending_maker_wins=true, status=4)
const BET94 = '0xbdde8f1fd98013569f8e716556c472524723e9876527c52b5c0a5be9e1385e8c';

const G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', X = '\x1b[0m';
const OK = (s: string) => console.log(`${G}✅ ${s}${X}`);
const FAIL = (s: string) => console.log(`${R}❌ ${s}${X}`);
const INFO = (s: string) => console.log(`${C}ℹ️  ${s}${X}`);

const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const client = getSuiClient();

const MODE = process.argv[2] || 'resolve';

async function tryResolveDispute() {
  INFO('Trying resolve_dispute on match 94 (maker wins=true)');
  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::p2p_betting::resolve_dispute`,
    typeArguments: [SBETS],
    arguments: [tx.object(ORACLE_CAP_ID), tx.object(CONFIG_ID), tx.object(BET94), tx.pure.bool(true), tx.object(CLOCK)],
  });
  tx.setGasBudget(200_000_000);
  const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
  const status = r.effects?.status?.status;
  const err = r.effects?.status?.error;
  if (status === 'success') { OK(`resolve_dispute SUCCESS! TX: ${r.digest}`); }
  else { FAIL(`resolve_dispute failed: ${err}`); }
}

async function tryDisputeSettlement() {
  INFO('Trying dispute_settlement on match 94 (public function)');
  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::p2p_betting::dispute_settlement`,
    typeArguments: [SBETS],
    arguments: [tx.object(BET94), tx.object(CLOCK)],
  });
  tx.setGasBudget(200_000_000);
  const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
  const status = r.effects?.status?.status;
  const err = r.effects?.status?.error;
  if (status === 'success') { OK(`dispute_settlement SUCCESS! TX: ${r.digest}`); }
  else { FAIL(`dispute_settlement failed: ${err}`); }
}

async function tryClaimSettlement() {
  INFO('Trying claim_settlement on match 94 (post-dispute-window)');
  const tx = new Transaction();
  tx.moveCall({
    target: `${PKG}::p2p_betting::claim_settlement`,
    typeArguments: [SBETS],
    arguments: [tx.object(CONFIG_ID), tx.object(REGISTRY_ID), tx.object(BET94), tx.object(CLOCK)],
  });
  tx.setGasBudget(200_000_000);
  const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
  const status = r.effects?.status?.status;
  const err = r.effects?.status?.error;
  if (status === 'success') { OK(`claim_settlement SUCCESS! TX: ${r.digest}`); }
  else { FAIL(`claim_settlement failed: ${err}`); }
}

if (MODE === 'resolve') await tryResolveDispute();
else if (MODE === 'dispute') await tryDisputeSettlement();
else if (MODE === 'claim') await tryClaimSettlement();
