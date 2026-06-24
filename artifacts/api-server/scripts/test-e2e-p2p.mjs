/**
 * E2E P2P Offer Test
 * ------------------
 * 1. Posts a real on-chain offer using the admin keypair (0.01 SUI stake)
 * 2. Registers it in the DB via POST /api/p2p/offers
 * 3. Accepts it via POST /api/p2p/offers/:id/accept (test-taker wallet, no on-chain fill needed for DB record)
 * 4. Verifies both DB records are correct
 * 5. Voids the on-chain offer to reclaim SUI
 *
 * Usage: node artifacts/api-server/scripts/test-e2e-p2p.mjs
 */

import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { Transaction }         from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { bcs }                 from '@mysten/sui/bcs';
import { SuiClient }           from '@mysten/sui/client';

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE       = process.env.API_BASE || 'http://localhost:8080';
const ADMIN_KEY      = process.env.ADMIN_PRIVATE_KEY || '';
const ADMIN_WALLET   = (process.env.ADMIN_WALLET_ADDRESS || '').toLowerCase();
const PACKAGE_ID     = process.env.P2P_PACKAGE_ID  || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG_ID      = process.env.P2P_CONFIG_ID   || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const REGISTRY_ID    = process.env.P2P_REGISTRY_ID || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP_ID  = process.env.P2P_ORACLE_CAP_ID || '';
const SUI_CLOCK_ID   = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_COIN_TYPE  = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const SUI_RPC        = 'https://fullnode.mainnet.sui.io:443';

const STAKE_SUI      = 0.01; // minimum real test
const ODDS           = 2.0;

// ── Helpers ───────────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const toBytes = s => Array.from(enc.encode(s));
const sleep   = ms => new Promise(r => setTimeout(r, ms));

function PASS(msg) { console.log(`  ✅ ${msg}`); }
function FAIL(msg) { console.error(`  ❌ ${msg}`); process.exit(1); }
function INFO(msg) { console.log(`  ℹ️  ${msg}`); }

function buildKeypair() {
  if (!ADMIN_KEY) FAIL('ADMIN_PRIVATE_KEY env var not set');
  if (ADMIN_KEY.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  let bytes = ADMIN_KEY.startsWith('0x')
    ? new Uint8Array(Buffer.from(ADMIN_KEY.slice(2), 'hex'))
    : new Uint8Array(Buffer.from(ADMIN_KEY, 'base64'));
  if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(bytes);
}

async function apiPost(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  return r.json().catch(() => ({}));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log(' SuiBets P2P — End-to-End Offer/Accept Test');
  console.log('══════════════════════════════════════════\n');

  const client  = new SuiClient({ url: SUI_RPC });
  const keypair = buildKeypair();
  const adminAddr = keypair.getPublicKey().toSuiAddress();

  // Generate a random test-taker keypair (no real SUI needed — just for DB record)
  const takerKeypair = Ed25519Keypair.generate();
  const TAKER_WALLET = takerKeypair.getPublicKey().toSuiAddress();

  INFO(`Admin wallet : ${adminAddr}`);
  INFO(`Test taker   : ${TAKER_WALLET}`);
  INFO(`API base     : ${API_BASE}`);

  // ── Step 0: Check admin SUI balance ─────────────────────────────────────────
  console.log('\n[Step 0] Checking admin SUI balance...');
  const balance = await client.getBalance({ owner: adminAddr, coinType: SUI_COIN_TYPE });
  const suiBalance = Number(balance.totalBalance) / 1e9;
  INFO(`Admin SUI balance: ${suiBalance.toFixed(4)} SUI`);
  if (suiBalance < STAKE_SUI + 0.05) {
    FAIL(`Insufficient SUI. Need at least ${(STAKE_SUI + 0.05).toFixed(3)} SUI (stake + gas). Have ${suiBalance.toFixed(4)}.`);
  }
  PASS(`Balance OK (${suiBalance.toFixed(4)} SUI)`);

  // ── Step 1: Contract-wallet endpoint ────────────────────────────────────────
  console.log('\n[Step 1] Verifying /api/p2p/contract-wallet...');
  const cw = await apiGet('/api/p2p/contract-wallet');
  if (!cw.packageId || !cw.configId || !cw.registryId) {
    FAIL(`contract-wallet missing IDs: ${JSON.stringify(cw)}`);
  }
  PASS(`packageId  : ${cw.packageId.slice(0, 20)}...`);
  PASS(`configId   : ${cw.configId.slice(0, 20)}...`);
  PASS(`registryId : ${cw.registryId.slice(0, 20)}...`);

  // ── Step 2: Post offer on-chain ──────────────────────────────────────────────
  console.log('\n[Step 2] Posting offer on-chain (0.01 SUI @ 2.0x)...');

  const amountMist   = BigInt(Math.floor(STAKE_SUI * 1_000_000_000));
  const oddsBps      = BigInt(Math.round(ODDS * 10_000));
  const expiresAtMs  = BigInt(Date.now() + 48 * 3600 * 1000); // 48 h from now
  const EVENT_ID     = 'TEST_EVENT_E2E_001';
  const EVENT_NAME   = 'E2E Test Match (Auto-cleanup)';

  const tx = new Transaction();
  tx.setGasBudget(50_000_000);
  const [coin] = tx.splitCoins(tx.gas, [amountMist]);

  tx.moveCall({
    target:        `${PACKAGE_ID}::p2p_betting::post_offer`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(CONFIG_ID),
      tx.object(REGISTRY_ID),
      coin,
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(EVENT_ID))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(EVENT_NAME))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      tx.pure.u64(oddsBps),
      tx.pure.u64(expiresAtMs),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  let txResult;
  try {
    txResult = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true },
    });
  } catch (err) {
    FAIL(`Transaction submission failed: ${err.message}`);
  }

  if (txResult.effects?.status?.status !== 'success') {
    FAIL(`On-chain tx failed: ${txResult.effects?.status?.error}`);
  }
  const txHash = txResult.digest;
  PASS(`On-chain tx: ${txHash}`);
  INFO(`Suiscan: https://suiscan.xyz/mainnet/tx/${txHash}`);

  // Extract the created P2POffer object ID
  const createdObj = txResult.objectChanges?.find(
    c => c.type === 'created' && c.objectType?.includes('P2POffer')
  );
  if (!createdObj?.objectId) {
    FAIL('Could not extract P2POffer object ID from tx objectChanges');
  }
  const onchainOfferId = createdObj.objectId;
  PASS(`P2POffer object : ${onchainOfferId}`);

  // ── Step 3: Wait for RPC to confirm ─────────────────────────────────────────
  console.log('\n[Step 3] Waiting for on-chain confirmation (3s)...');
  await sleep(3000);

  // ── Step 4: Register offer in DB via API ─────────────────────────────────────
  console.log('\n[Step 4] Registering offer in DB via API...');
  const takerStake = parseFloat((STAKE_SUI * (ODDS - 1)).toFixed(4));
  const offerPayload = {
    creatorWallet:  adminAddr,
    eventId:        EVENT_ID,
    eventName:      EVENT_NAME,
    homeTeam:       'Test Home FC',
    awayTeam:       'Test Away FC',
    leagueName:     'E2E Test League',
    sportName:      'Soccer',
    matchDate:      new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    prediction:     'home',
    marketType:     'match_winner',
    odds:           ODDS,
    creatorStake:   STAKE_SUI,
    currency:       'SUI',
    creatorTxHash:  txHash,
    expiresAt:      new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    onchainOfferId,
    onchainConfigId: CONFIG_ID,
  };

  const createResp = await apiPost('/api/p2p/offers', offerPayload);
  if (createResp.status !== 201) {
    FAIL(`POST /api/p2p/offers returned ${createResp.status}: ${JSON.stringify(createResp.json)}`);
  }
  const offerId = createResp.json.id;
  PASS(`Offer created in DB — id=${offerId}, status=${createResp.json.status}`);

  // ── Step 5: Verify offer appears in list ──────────────────────────────────────
  console.log('\n[Step 5] Verifying offer appears in GET /api/p2p/offers...');
  const offerList = await apiGet('/api/p2p/offers');
  const offerArr  = Array.isArray(offerList) ? offerList : Object.values(offerList);
  const found     = offerArr.find(o => o.id === offerId);
  if (!found) FAIL(`Offer id=${offerId} not found in GET /api/p2p/offers`);
  PASS(`Offer id=${offerId} is listed (status=${found.status}, onchainOfferId=${found.onchainOfferId?.slice(0,16)}...)`);

  // ── Step 6: Accept the offer via API ─────────────────────────────────────────
  console.log('\n[Step 6] Accepting offer via API (test-taker wallet)...');
  const acceptPayload = {
    takerWallet: TAKER_WALLET,
    stake:       takerStake,
    // No takerTxHash — allowed for on-chain offers (taker fills on-chain separately)
  };

  const acceptResp = await apiPost(`/api/p2p/offers/${offerId}/accept`, acceptPayload);
  if (acceptResp.status !== 201) {
    FAIL(`POST /api/p2p/offers/${offerId}/accept returned ${acceptResp.status}: ${JSON.stringify(acceptResp.json)}`);
  }
  const matchId = acceptResp.json.id;
  PASS(`Offer accepted — match id=${matchId}, status=${acceptResp.json.status}`);
  PASS(`Taker stake=${acceptResp.json.stake} ${found.currency}`);

  // ── Step 7: Verify /api/p2p/my returns both sides ────────────────────────────
  console.log('\n[Step 7] Verifying /api/p2p/my for creator and taker...');
  const creatorMy = await apiGet(`/api/p2p/my?wallet=${adminAddr}`);
  const takerMy   = await apiGet(`/api/p2p/my?wallet=${TAKER_WALLET}`);

  const creatorOffer = (creatorMy.offers || []).find(o => o.id === offerId);
  if (!creatorOffer) FAIL(`Offer id=${offerId} missing from creator's /api/p2p/my`);
  PASS(`Creator's offer found in /api/p2p/my (status=${creatorOffer.status})`);

  const takerMatch = (takerMy.matches || []).find(m => m.id === matchId);
  if (!takerMatch) FAIL(`Match id=${matchId} missing from taker's /api/p2p/my`);
  PASS(`Taker's match found in /api/p2p/my (status=${takerMatch.status})`);

  // ── Step 8: Void the on-chain offer to reclaim SUI ────────────────────────────
  if (ORACLE_CAP_ID) {
    console.log('\n[Step 8] Voiding on-chain offer to reclaim SUI...');
    const voidTx = new Transaction();
    voidTx.setGasBudget(50_000_000);
    voidTx.moveCall({
      target:        `${PACKAGE_ID}::p2p_betting::void_bet`,
      typeArguments: [SUI_COIN_TYPE],
      arguments: [
        voidTx.object(ORACLE_CAP_ID),
        voidTx.object(CONFIG_ID),
        voidTx.object(REGISTRY_ID),
        voidTx.object(onchainOfferId),
        voidTx.object(SUI_CLOCK_ID),
      ],
    });
    try {
      const voidResult = await client.signAndExecuteTransaction({
        transaction: voidTx,
        signer: keypair,
        options: { showEffects: true },
      });
      if (voidResult.effects?.status?.status === 'success') {
        PASS(`On-chain offer voided — SUI reclaimed. TX: ${voidResult.digest}`);
      } else {
        INFO(`Void tx status: ${voidResult.effects?.status?.error} (may be unfilled offers are auto-refunded by expiry)`);
      }
    } catch (err) {
      INFO(`Void attempt: ${err.message} (non-fatal — offer expires in 48h anyway)`);
    }
  } else {
    INFO('ORACLE_CAP_ID not set — skipping on-chain void. Offer will expire in 48h.');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(' ALL TESTS PASSED ✅');
  console.log('══════════════════════════════════════════');
  console.log(`\n  Offer ID    : ${offerId}`);
  console.log(`  Match ID    : ${matchId}`);
  console.log(`  On-chain TX : https://suiscan.xyz/mainnet/tx/${txHash}`);
  console.log(`  P2POffer    : https://suiscan.xyz/mainnet/object/${onchainOfferId}\n`);
}

run().catch(err => {
  console.error('\n❌ Test crashed:', err.message);
  process.exit(1);
});
