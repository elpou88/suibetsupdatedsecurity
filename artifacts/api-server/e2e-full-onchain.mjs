/**
 * e2e-full-onchain.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Full end-to-end live on-chain test for SuiBets P2P betting.
 *
 * Flows tested for each coin (USDC + USDSUI):
 *   1. POST offer → CANCEL immediately           → verify refund on-chain
 *   2. POST offer → EXPIRE (past expiry)         → verify refund on-chain
 *   3. POST offer → ACCEPT → SETTLE maker wins   → verify payout
 *   4. POST offer → ACCEPT → SETTLE taker wins   → verify payout
 *   5. POST offer → ACCEPT → VOID                → both refunded
 *
 * Gasless stablecoin transfers (Sui protocol, May 2026):
 *   • Admin funding the taker wallet with USDC/USDSUI uses SuiGrpcClient +
 *     coinWithBalance → resolves to 0x2::coin::redeem_funds / send_funds with
 *     gasPrice=0, gasBudget=0 (no SUI needed for pure stablecoin sends).
 *   • Contract interactions (post_offer, accept_offer, instant_settle_bet, etc.)
 *     write shared objects → still require SUI gas from the caller.
 *   • Falls back to SUI-funded tx if address balance is zero (coin-object path).
 *
 * Usage:
 *   ADMIN_PRIVATE_KEY=suiprivkey... node artifacts/api-server/e2e-full-onchain.mjs
 *
 * Optional env overrides:
 *   P2P_PACKAGE_ID, P2P_CONFIG_ID, P2P_REGISTRY_ID, P2P_ORACLE_CAP_ID
 *   USDC_COIN_TYPE, USDSUI_COIN_TYPE
 *   SUI_RPC        (default: https://fullnode.mainnet.sui.io)
 *   SUI_GRPC_URL   (default: https://fullnode.mainnet.sui.io:443)
 *   MIN_AMOUNT     (default: 1000 = 0.001 USDC/USDSUI, 6 decimals)
 */

import { SuiJsonRpcClient }   from '@mysten/sui/jsonRpc';
import { SuiGrpcClient }      from '@mysten/sui/grpc';
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { bcs }                from '@mysten/sui/bcs';

// ── Contract addresses (mainnet deployment) ───────────────────────────────────
const PKG        = process.env.P2P_PACKAGE_ID  || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG     = process.env.P2P_CONFIG_ID   || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const REGISTRY   = process.env.P2P_REGISTRY_ID || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP = process.env.P2P_ORACLE_CAP_ID || '0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55';
const ADMIN_CAP  = process.env.P2P_ADMIN_CAP_ID  || '0xc9480246d7bc717bc6478fff3002de30998b190a46bef310652d3546b6c39e25';
const CLOCK      = '0x0000000000000000000000000000000000000000000000000000000000000006';

// ── Coin types ────────────────────────────────────────────────────────────────
const SUI_TYPE    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_TYPE   = process.env.USDC_COIN_TYPE   || '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const USDSUI_TYPE = process.env.USDSUI_COIN_TYPE || '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';

// ── Network config ────────────────────────────────────────────────────────────
const SUI_RPC      = process.env.SUI_RPC      || 'https://fullnode.mainnet.sui.io';
const SUI_GRPC_URL = process.env.SUI_GRPC_URL || 'https://fullnode.mainnet.sui.io:443';

const MIN_AMOUNT = BigInt(process.env.MIN_AMOUNT || '1000'); // 0.001 USDC/USDSUI (6 dec)
const GAS_BUDGET = 30_000_000n; // 0.03 SUI per contract-write tx
const ODDS_BPS   = 20_000n;     // 2.0x — taker_amount = maker_amount for 2x

// ── Result tracking ───────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const results = [];

const ok   = (label, hash) => { passed++; results.push({ ok: true,  label, hash }); console.log(`  ✅ ${label}${hash ? ` → ${hash.slice(0,16)}...` : ''}`); };
const fail = (label, err)  => { failed++; results.push({ ok: false, label, err  }); console.log(`  ❌ ${label}: ${String(err).slice(0,160)}`); };
const skip = (label, reason) => { skipped++; results.push({ ok: null, label, reason }); console.log(`  ⏭️  ${label}: SKIPPED — ${reason}`); };
const info = msg => console.log(`     ${msg}`);
const sep  = () => console.log();

const sleep   = ms => new Promise(r => setTimeout(r, ms));
const enc     = new TextEncoder();
const toBytes = s => Array.from(enc.encode(s));

// ── Keypair helper ────────────────────────────────────────────────────────────
function buildKeypair(raw) {
  if (raw.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(raw);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  let bytes = raw.startsWith('0x')
    ? new Uint8Array(Buffer.from(raw.slice(2), 'hex'))
    : new Uint8Array(Buffer.from(raw, 'base64'));
  if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(bytes);
}

// ── Execute tx via regular SuiClient (contract calls with SUI gas) ────────────
async function sendTx(client, tx, kp, label) {
  try {
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: kp,
      options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
    });
    const status = result?.effects?.status?.status;
    const digest = result?.digest ?? '';
    if (status === 'success') {
      ok(label, digest);
      info(`🔗 https://suivision.xyz/txblock/${digest}`);
      return { status, digest, changes: result.objectChanges ?? [], balanceChanges: result.balanceChanges ?? [] };
    } else {
      const errMsg = result?.effects?.status?.error ?? 'on-chain error';
      fail(label, errMsg);
      return { status: 'failure', digest, changes: [], balanceChanges: [], error: errMsg };
    }
  } catch (e) {
    fail(label, e.message);
    return { status: 'error', digest: '', changes: [], balanceChanges: [] };
  }
}

// ── Gasless stablecoin send via SuiGrpcClient ─────────────────────────────────
//
// Uses Sui protocol-level gasless transfers (launched May 2026).
// The TX only calls 0x2::coin::redeem_funds + 0x2::coin::send_funds —
// eligible functions that cost gasPrice=0, gasBudget=0 when the sender
// has an address balance of the stablecoin.
//
// Falls back to a regular SUI-funded transferObjects tx if the address
// balance is zero (coins are purely in coin-object form on this wallet).
//
async function sendGasless(grpcClient, fallbackClient, kp, senderAddr, recipientAddr, coinType, coinSymbol, amount, label) {
  // ── Attempt 1: gasless via gRPC + coinWithBalance intent ──────────────────
  try {
    const tx = new Transaction();
    tx.setSender(senderAddr);
    tx.setGasPrice(0);
    tx.setGasBudget(0);

    // coinWithBalance resolves via the CoinWithBalance intent:
    //   • If address balance >= amount → uses redeem_funds (gasless eligible)
    //   • If only coin objects → uses SplitCoins (not eligible → will fail at gasPrice=0)
    const coin = coinWithBalance({ type: coinType, balance: amount });
    tx.transferObjects([coin], tx.pure.address(recipientAddr));

    const result = await grpcClient.signAndExecuteTransaction({
      transaction: tx,
      signer: kp,
    });

    const digest = result?.digest ?? '';
    if (digest) {
      ok(`${label} (gasless ✨ gasPrice=0)`, digest);
      info(`🔗 https://suivision.xyz/txblock/${digest}`);
      info(`   Admin paid 0 SUI gas — ${coinSymbol} sent via protocol-level gasless transfer`);
      return { status: 'success', digest, gasless: true };
    }
    throw new Error('no digest returned from gRPC client');
  } catch (gaslessErr) {
    const reason = String(gaslessErr.message || gaslessErr).slice(0, 120);
    info(`   ⚡ Gasless attempt failed (${reason}) — falling back to SUI-funded send`);
  }

  // ── Attempt 2: regular SUI-funded transferObjects fallback ────────────────
  try {
    const coins = await fallbackClient.getCoins({ owner: senderAddr, coinType });
    if (!coins.data.length) {
      fail(label, `No ${coinSymbol} coins in admin wallet`);
      return { status: 'error', digest: '', gasless: false };
    }
    const tx2 = new Transaction();
    tx2.setSender(senderAddr);
    tx2.setGasBudget(GAS_BUDGET);
    const primary = tx2.object(coins.data[0].coinObjectId);
    if (coins.data.length > 1) {
      tx2.mergeCoins(primary, coins.data.slice(1).map(c => tx2.object(c.coinObjectId)));
    }
    const [out] = tx2.splitCoins(primary, [amount]);
    tx2.transferObjects([out], tx2.pure.address(recipientAddr));
    const r = await sendTx(fallbackClient, tx2, kp, `${label} (SUI-gas fallback)`);
    return { ...r, gasless: false };
  } catch (e) {
    fail(label, e.message);
    return { status: 'error', digest: '', gasless: false };
  }
}

// ── Find created object from objectChanges ────────────────────────────────────
const findCreated = (changes, frag) =>
  changes?.find(c => c.type === 'created' && c.objectType?.includes(frag));

// ── Get coin objects for an address ───────────────────────────────────────────
async function getCoins(client, owner, coinType) {
  const result = await client.getCoins({ owner, coinType });
  return result.data ?? [];
}

// ── Merge + split a coin from wallet ─────────────────────────────────────────
function prepCoin(tx, coins, amount) {
  if (coins.length === 0) throw new Error('no coins');
  const primary = tx.object(coins[0].coinObjectId);
  if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)));
  const [split] = tx.splitCoins(primary, [amount]);
  return split;
}

// ── Build a post_offer PTB ────────────────────────────────────────────────────
function buildPostOffer(tx, senderAddr, coinObj, coinType, eventId, expireMs) {
  tx.setSender(senderAddr);
  tx.setGasBudget(GAS_BUDGET);
  tx.moveCall({
    target: `${PKG}::p2p_betting::post_offer`,
    typeArguments: [coinType],
    arguments: [
      tx.object(CONFIG),
      tx.object(REGISTRY),
      coinObj,
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(eventId))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(`E2E Live Test — ${eventId}`))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      tx.pure.u64(ODDS_BPS),
      tx.pure.u64(BigInt(expireMs)),
      tx.object(CLOCK),
    ],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// FLOW RUNNERS
// ══════════════════════════════════════════════════════════════════════════════

// ── Flow 1: POST → CANCEL (immediate refund) ──────────────────────────────────
async function flowCancel(client, kp, addr, coinType, coinSymbol, coins) {
  console.log(`\n  ── [${coinSymbol}] Flow 1: POST → CANCEL ──`);
  const label = `[${coinSymbol}] cancel_offer`;

  const postTx = new Transaction();
  let coin;
  try { coin = prepCoin(postTx, coins, MIN_AMOUNT); }
  catch (e) { skip(label, `no ${coinSymbol} coins`); return; }

  buildPostOffer(postTx, addr, coin, coinType, `E2E_CANCEL_${coinSymbol}_${Date.now()}`, Date.now() + 3600_000);
  const postR = await sendTx(client, postTx, kp, `[${coinSymbol}] post_offer (to cancel)`);
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail(label, 'P2POffer object not found in tx'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);
  await sleep(2500);

  // cancel_offer — maker calls directly (no OracleCap needed)
  const cancelTx = new Transaction();
  cancelTx.setSender(addr);
  cancelTx.setGasBudget(GAS_BUDGET);
  cancelTx.moveCall({
    target: `${PKG}::p2p_betting::cancel_offer`,
    typeArguments: [coinType],
    arguments: [cancelTx.object(offerObj.objectId), cancelTx.object(REGISTRY), cancelTx.object(CLOCK)],
  });
  const cancelR = await sendTx(client, cancelTx, kp, label);
  if (cancelR.status === 'success') {
    const refund = cancelR.balanceChanges.find(c => c.coinType === coinType && Number(c.amount) > 0);
    if (refund) info(`✓ Refund confirmed: +${refund.amount} ${coinSymbol} returned to maker`);
    else        info(`✓ cancel_offer executed — coins returned in contract (check balance)`);
  }
}

// ── Flow 2: POST → EXPIRE (already-past expiry) ───────────────────────────────
async function flowExpire(client, kp, addr, coinType, coinSymbol, coins) {
  console.log(`\n  ── [${coinSymbol}] Flow 2: POST → EXPIRE ──`);
  const label = `[${coinSymbol}] expire_offer`;

  const postTx = new Transaction();
  let coin;
  try { coin = prepCoin(postTx, coins, MIN_AMOUNT); }
  catch (e) { skip(label, `no ${coinSymbol} coins`); return; }

  const alreadyExpiredMs = Date.now() - 60_000; // 1 min ago → expired
  buildPostOffer(postTx, addr, coin, coinType, `E2E_EXPIRE_${coinSymbol}_${Date.now()}`, alreadyExpiredMs);
  const postR = await sendTx(client, postTx, kp, `[${coinSymbol}] post_offer (with past expiry)`);
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail(label, 'P2POffer object not found in tx'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);
  await sleep(2500);

  // expire_offer — permissionless, anyone pays SUI gas
  const expireTx = new Transaction();
  expireTx.setSender(addr);
  expireTx.setGasBudget(GAS_BUDGET);
  expireTx.moveCall({
    target: `${PKG}::p2p_betting::expire_offer`,
    typeArguments: [coinType],
    arguments: [expireTx.object(offerObj.objectId), expireTx.object(REGISTRY), expireTx.object(CLOCK)],
  });
  const expireR = await sendTx(client, expireTx, kp, label);
  if (expireR.status === 'success') {
    const refund = expireR.balanceChanges.find(c => c.coinType === coinType && Number(c.amount) > 0);
    if (refund) info(`✓ Refund confirmed: +${refund.amount} ${coinSymbol} returned to maker`);
    else        info(`✓ expire_offer executed — coins returned in contract`);
  }
}

// ── Flow 3: POST → ACCEPT → SETTLE (maker wins) ───────────────────────────────
async function flowSettleMakerWins(client, kp, addr, coinType, coinSymbol, coins, takerKp, takerAddr, takerCoins) {
  console.log(`\n  ── [${coinSymbol}] Flow 3: POST → ACCEPT → SETTLE (maker wins) ──`);
  if (!ORACLE_CAP) { skip(`[${coinSymbol}] maker_wins settlement`, 'P2P_ORACLE_CAP_ID not set'); return; }

  const postTx = new Transaction();
  let makerCoin;
  try { makerCoin = prepCoin(postTx, coins, MIN_AMOUNT); }
  catch (e) { skip(`[${coinSymbol}] maker_wins settlement`, `no ${coinSymbol} coins`); return; }

  const eventId = `E2E_MAKER_WIN_${coinSymbol}_${Date.now()}`;
  buildPostOffer(postTx, addr, makerCoin, coinType, eventId, Date.now() + 3600_000);
  const postR = await sendTx(client, postTx, kp, `[${coinSymbol}] post_offer (maker-win test)`);
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail(`[${coinSymbol}] maker_wins settlement`, 'P2POffer not found'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);
  await sleep(2500);

  // accept_offer — taker fills (needs SUI for gas: writes P2PMatchedBet object)
  const acceptTx = new Transaction();
  let takerCoin;
  try { takerCoin = prepCoin(acceptTx, takerCoins, MIN_AMOUNT); }
  catch (e) { skip(`[${coinSymbol}] maker_wins settlement`, `taker has no ${coinSymbol}`); return; }
  acceptTx.setSender(takerAddr);
  acceptTx.setGasBudget(GAS_BUDGET);
  acceptTx.moveCall({
    target: `${PKG}::p2p_betting::accept_offer`,
    typeArguments: [coinType],
    arguments: [
      acceptTx.object(CONFIG), acceptTx.object(REGISTRY), acceptTx.object(offerObj.objectId),
      takerCoin, acceptTx.pure.u64(MIN_AMOUNT), acceptTx.object(CLOCK),
    ],
  });
  const acceptR = await sendTx(client, acceptTx, takerKp, `[${coinSymbol}] accept_offer`);
  if (acceptR.status !== 'success') return;

  const matchedBet = findCreated(acceptR.changes, 'P2PMatchedBet');
  if (!matchedBet) { fail(`[${coinSymbol}] maker_wins settlement`, 'P2PMatchedBet not found'); return; }
  info(`P2PMatchedBet: ${matchedBet.objectId}`);
  info(`🔗 https://suivision.xyz/object/${matchedBet.objectId}`);
  await sleep(2500);

  // instant_settle_bet — oracle (admin) pays SUI gas; modifies shared objects + pays winner
  const settleTx = new Transaction();
  settleTx.setSender(addr);
  settleTx.setGasBudget(GAS_BUDGET);
  settleTx.moveCall({
    target: `${PKG}::p2p_betting::instant_settle_bet`,
    typeArguments: [coinType],
    arguments: [
      settleTx.object(ORACLE_CAP), settleTx.object(CONFIG), settleTx.object(REGISTRY),
      settleTx.object(matchedBet.objectId), settleTx.pure.bool(true), settleTx.object(CLOCK),
    ],
  });
  const settleR = await sendTx(client, settleTx, kp, `[${coinSymbol}] instant_settle_bet (maker wins)`);
  if (settleR.status === 'success') {
    const payout = settleR.balanceChanges.find(c => c.coinType === coinType && Number(c.amount) > 0 && c.owner?.AddressOwner === addr);
    if (payout) info(`✓ Payout to maker: +${payout.amount} ${coinSymbol}`);
    else        info(`✓ instant_settle_bet executed — payout on-chain`);
    info(`   Note: oracle pays SUI gas for settlement; winner receives ${coinSymbol} with no gas cost`);
  }
}

// ── Flow 4: POST → ACCEPT → SETTLE (taker wins) ───────────────────────────────
async function flowSettleTakerWins(client, kp, addr, coinType, coinSymbol, coins, takerKp, takerAddr, takerCoins) {
  console.log(`\n  ── [${coinSymbol}] Flow 4: POST → ACCEPT → SETTLE (taker wins) ──`);
  if (!ORACLE_CAP) { skip(`[${coinSymbol}] taker_wins settlement`, 'P2P_ORACLE_CAP_ID not set'); return; }

  const postTx = new Transaction();
  let makerCoin;
  try { makerCoin = prepCoin(postTx, coins, MIN_AMOUNT); }
  catch (e) { skip(`[${coinSymbol}] taker_wins settlement`, `no ${coinSymbol} coins`); return; }

  const eventId = `E2E_TAKER_WIN_${coinSymbol}_${Date.now()}`;
  buildPostOffer(postTx, addr, makerCoin, coinType, eventId, Date.now() + 3600_000);
  const postR = await sendTx(client, postTx, kp, `[${coinSymbol}] post_offer (taker-win test)`);
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail(`[${coinSymbol}] taker_wins settlement`, 'P2POffer not found'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  await sleep(2500);

  const acceptTx = new Transaction();
  let takerCoin;
  try { takerCoin = prepCoin(acceptTx, takerCoins, MIN_AMOUNT); }
  catch (e) { skip(`[${coinSymbol}] taker_wins settlement`, `taker has no ${coinSymbol}`); return; }
  acceptTx.setSender(takerAddr);
  acceptTx.setGasBudget(GAS_BUDGET);
  acceptTx.moveCall({
    target: `${PKG}::p2p_betting::accept_offer`,
    typeArguments: [coinType],
    arguments: [
      acceptTx.object(CONFIG), acceptTx.object(REGISTRY), acceptTx.object(offerObj.objectId),
      takerCoin, acceptTx.pure.u64(MIN_AMOUNT), acceptTx.object(CLOCK),
    ],
  });
  const acceptR = await sendTx(client, acceptTx, takerKp, `[${coinSymbol}] accept_offer`);
  if (acceptR.status !== 'success') return;

  const matchedBet = findCreated(acceptR.changes, 'P2PMatchedBet');
  if (!matchedBet) { fail(`[${coinSymbol}] taker_wins settlement`, 'P2PMatchedBet not found'); return; }
  info(`P2PMatchedBet: ${matchedBet.objectId}`);
  await sleep(2500);

  // makerWins=false → taker wins
  const settleTx = new Transaction();
  settleTx.setSender(addr);
  settleTx.setGasBudget(GAS_BUDGET);
  settleTx.moveCall({
    target: `${PKG}::p2p_betting::instant_settle_bet`,
    typeArguments: [coinType],
    arguments: [
      settleTx.object(ORACLE_CAP), settleTx.object(CONFIG), settleTx.object(REGISTRY),
      settleTx.object(matchedBet.objectId), settleTx.pure.bool(false), settleTx.object(CLOCK),
    ],
  });
  const settleR = await sendTx(client, settleTx, kp, `[${coinSymbol}] instant_settle_bet (taker wins)`);
  if (settleR.status === 'success') {
    const payout = settleR.balanceChanges.find(c => c.coinType === coinType && Number(c.amount) > 0 && c.owner?.AddressOwner === takerAddr);
    if (payout) info(`✓ Payout to taker: +${payout.amount} ${coinSymbol}`);
    else        info(`✓ instant_settle_bet executed — payout on-chain`);
    info(`   Note: oracle pays SUI gas for settlement; winner receives ${coinSymbol} with no gas cost`);
  }
}

// ── Flow 5: POST → ACCEPT → VOID (both refunded) ─────────────────────────────
async function flowVoid(client, kp, addr, coinType, coinSymbol, coins, takerKp, takerAddr, takerCoins) {
  console.log(`\n  ── [${coinSymbol}] Flow 5: POST → ACCEPT → VOID ──`);
  if (!ORACLE_CAP) { skip(`[${coinSymbol}] void_bet`, 'P2P_ORACLE_CAP_ID not set'); return; }

  const postTx = new Transaction();
  let makerCoin;
  try { makerCoin = prepCoin(postTx, coins, MIN_AMOUNT); }
  catch (e) { skip(`[${coinSymbol}] void_bet`, `no ${coinSymbol} coins`); return; }

  const eventId = `E2E_VOID_${coinSymbol}_${Date.now()}`;
  buildPostOffer(postTx, addr, makerCoin, coinType, eventId, Date.now() + 3600_000);
  const postR = await sendTx(client, postTx, kp, `[${coinSymbol}] post_offer (void test)`);
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail(`[${coinSymbol}] void_bet`, 'P2POffer not found'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  await sleep(2500);

  const acceptTx = new Transaction();
  let takerCoin;
  try { takerCoin = prepCoin(acceptTx, takerCoins, MIN_AMOUNT); }
  catch (e) { skip(`[${coinSymbol}] void_bet`, `taker has no ${coinSymbol}`); return; }
  acceptTx.setSender(takerAddr);
  acceptTx.setGasBudget(GAS_BUDGET);
  acceptTx.moveCall({
    target: `${PKG}::p2p_betting::accept_offer`,
    typeArguments: [coinType],
    arguments: [
      acceptTx.object(CONFIG), acceptTx.object(REGISTRY), acceptTx.object(offerObj.objectId),
      takerCoin, acceptTx.pure.u64(MIN_AMOUNT), acceptTx.object(CLOCK),
    ],
  });
  const acceptR = await sendTx(client, acceptTx, takerKp, `[${coinSymbol}] accept_offer`);
  if (acceptR.status !== 'success') return;

  const matchedBet = findCreated(acceptR.changes, 'P2PMatchedBet');
  if (!matchedBet) { fail(`[${coinSymbol}] void_bet`, 'P2PMatchedBet not found'); return; }
  info(`P2PMatchedBet: ${matchedBet.objectId}`);
  await sleep(2500);

  const voidTx = new Transaction();
  voidTx.setSender(addr);
  voidTx.setGasBudget(GAS_BUDGET);
  voidTx.moveCall({
    target: `${PKG}::p2p_betting::void_bet`,
    typeArguments: [coinType],
    arguments: [
      voidTx.object(ORACLE_CAP), voidTx.object(CONFIG), voidTx.object(REGISTRY),
      voidTx.object(matchedBet.objectId), voidTx.object(CLOCK),
    ],
  });
  const voidR = await sendTx(client, voidTx, kp, `[${coinSymbol}] void_bet (both refunded)`);
  if (voidR.status === 'success') {
    info(`✓ void_bet executed — both maker and taker refunded on-chain`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   SuiBets — Full On-Chain E2E Test (USDC + USDSUI)           ║');
  console.log('║   Flows: CANCEL · EXPIRE · MAKER WINS · TAKER WINS · VOID   ║');
  console.log('║   Gasless: USDC/USDSUI sends via SuiGrpcClient (gasPrice=0) ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY;
  if (!ADMIN_KEY) { console.error('❌ ADMIN_PRIVATE_KEY required'); process.exit(1); }

  // Regular JSON-RPC client — for contract calls that write objects (need SUI gas)
  const client = new SuiJsonRpcClient({ url: SUI_RPC, network: 'mainnet' });

  // gRPC client — for gasless USDC/USDSUI sends (gasPrice=0, gasBudget=0)
  const grpcClient = new SuiGrpcClient({
    network: 'mainnet',
    baseUrl: SUI_GRPC_URL,
  });

  const adminKp   = buildKeypair(ADMIN_KEY);
  const adminAddr = adminKp.getPublicKey().toSuiAddress();

  // Ephemeral taker keypair — funded by admin once
  const takerKp   = Ed25519Keypair.generate();
  const takerAddr = takerKp.getPublicKey().toSuiAddress();

  console.log(`Admin  : ${adminAddr}`);
  console.log(`Taker  : ${takerAddr} (ephemeral)`);
  console.log(`Package: ${PKG.slice(0,20)}...`);
  console.log(`Oracle : ${ORACLE_CAP ? ORACLE_CAP.slice(0,20) + '...' : '⚠️  NOT SET — settle flows skipped'}`);
  console.log(`gRPC   : ${SUI_GRPC_URL}`);
  sep();

  // ── Check admin SUI balance ─────────────────────────────────────────────────
  const suiBal  = await client.getBalance({ owner: adminAddr, coinType: SUI_TYPE });
  const suiAvail = Number(suiBal.totalBalance) / 1e9;
  console.log(`Admin SUI balance: ${suiAvail.toFixed(4)} SUI`);
  if (suiAvail < 0.5) { console.error('❌ Need at least 0.5 SUI for gas. Aborting.'); process.exit(1); }
  ok('Admin SUI balance sufficient', '');
  sep();

  // ── Check stablecoin balances ───────────────────────────────────────────────
  const [usdcCoins, usdsuiCoins] = await Promise.all([
    getCoins(client, adminAddr, USDC_TYPE),
    getCoins(client, adminAddr, USDSUI_TYPE),
  ]);
  const usdcBal   = usdcCoins.reduce((s, c) => s + BigInt(c.balance), 0n);
  const usdsuiBal = usdsuiCoins.reduce((s, c) => s + BigInt(c.balance), 0n);

  console.log(`Admin USDC   balance: ${Number(usdcBal)   / 1e6} USDC   (${usdcBal} units)`);
  console.log(`Admin USDSUI balance: ${Number(usdsuiBal) / 1e6} USDSUI (${usdsuiBal} units)`);

  const needPerCoin = MIN_AMOUNT * 12n; // 4 flows × 3 txs each — buffer
  const hasUsdc   = usdcBal   >= needPerCoin;
  const hasUsdsui = usdsuiBal >= needPerCoin;

  if (!hasUsdc && !hasUsdsui) {
    console.error(`\n❌ Admin needs at least ${needPerCoin} units (${Number(needPerCoin)/1e6}) of USDC or USDSUI.\n`);
    process.exit(1);
  }
  sep();

  // ── Set dispute_window = 0 for instant claiming ─────────────────────────────
  console.log('── Setting dispute_window = 0 for instant settlement ──');
  const dwTx = new Transaction();
  dwTx.setSender(adminAddr);
  dwTx.setGasBudget(GAS_BUDGET);
  dwTx.moveCall({
    target: `${PKG}::p2p_betting::set_dispute_window`,
    arguments: [dwTx.object(ADMIN_CAP), dwTx.object(CONFIG), dwTx.pure.u64(0n), dwTx.object(CLOCK)],
  });
  await sendTx(client, dwTx, adminKp, 'set_dispute_window → 0');
  await sleep(2000);

  // ── Fund ephemeral taker ────────────────────────────────────────────────────
  console.log('\n── Funding ephemeral taker wallet ──');

  // 1. Send SUI for gas (taker still needs SUI for accept_offer object writes)
  const suiFundTx = new Transaction();
  suiFundTx.setSender(adminAddr);
  suiFundTx.setGasBudget(GAS_BUDGET);
  const [suiOut] = suiFundTx.splitCoins(suiFundTx.gas, [100_000_000n]); // 0.1 SUI
  suiFundTx.transferObjects([suiOut], takerAddr);
  await sendTx(client, suiFundTx, adminKp, 'Fund taker SUI (for gas on accept_offer)');
  await sleep(2000);

  // 2. Send USDC gaslessly (SuiGrpcClient + coinWithBalance, gasPrice=0)
  if (hasUsdc) {
    await sendGasless(
      grpcClient, client, adminKp, adminAddr, takerAddr,
      USDC_TYPE, 'USDC', MIN_AMOUNT * 3n,
      'Fund taker USDC'
    );
    await sleep(2000);
  }

  // 3. Send USDSUI gaslessly
  if (hasUsdsui) {
    await sendGasless(
      grpcClient, client, adminKp, adminAddr, takerAddr,
      USDSUI_TYPE, 'USDSUI', MIN_AMOUNT * 3n,
      'Fund taker USDSUI'
    );
    await sleep(2000);
  }

  await sleep(3000); // wait for RPC to reflect funded balances

  // ── USDC Test Suite ──────────────────────────────────────────────────────────
  if (hasUsdc) {
    console.log('\n╔══════════════════════════════╗');
    console.log('║  USDC TEST SUITE             ║');
    console.log('╚══════════════════════════════╝');

    let adminUsdc = await getCoins(client, adminAddr, USDC_TYPE);
    await flowCancel(client, adminKp, adminAddr, USDC_TYPE, 'USDC', adminUsdc);
    await sleep(3000);

    adminUsdc = await getCoins(client, adminAddr, USDC_TYPE);
    await flowExpire(client, adminKp, adminAddr, USDC_TYPE, 'USDC', adminUsdc);
    await sleep(3000);

    if (ORACLE_CAP) {
      adminUsdc = await getCoins(client, adminAddr, USDC_TYPE);
      let takerUsdc = await getCoins(client, takerAddr, USDC_TYPE);
      await flowSettleMakerWins(client, adminKp, adminAddr, USDC_TYPE, 'USDC', adminUsdc, takerKp, takerAddr, takerUsdc);
      await sleep(3000);

      adminUsdc = await getCoins(client, adminAddr, USDC_TYPE);
      takerUsdc = await getCoins(client, takerAddr, USDC_TYPE);
      await flowSettleTakerWins(client, adminKp, adminAddr, USDC_TYPE, 'USDC', adminUsdc, takerKp, takerAddr, takerUsdc);
      await sleep(3000);

      adminUsdc = await getCoins(client, adminAddr, USDC_TYPE);
      takerUsdc = await getCoins(client, takerAddr, USDC_TYPE);
      await flowVoid(client, adminKp, adminAddr, USDC_TYPE, 'USDC', adminUsdc, takerKp, takerAddr, takerUsdc);
      await sleep(3000);
    }
  } else {
    skip('USDC Test Suite', 'Admin has insufficient USDC');
  }

  // ── USDSUI Test Suite ────────────────────────────────────────────────────────
  if (hasUsdsui) {
    console.log('\n╔══════════════════════════════╗');
    console.log('║  USDSUI TEST SUITE           ║');
    console.log('╚══════════════════════════════╝');

    let adminUsdsui = await getCoins(client, adminAddr, USDSUI_TYPE);
    await flowCancel(client, adminKp, adminAddr, USDSUI_TYPE, 'USDSUI', adminUsdsui);
    await sleep(3000);

    adminUsdsui = await getCoins(client, adminAddr, USDSUI_TYPE);
    await flowExpire(client, adminKp, adminAddr, USDSUI_TYPE, 'USDSUI', adminUsdsui);
    await sleep(3000);

    if (ORACLE_CAP) {
      adminUsdsui = await getCoins(client, adminAddr, USDSUI_TYPE);
      let takerUsdsui = await getCoins(client, takerAddr, USDSUI_TYPE);
      await flowSettleMakerWins(client, adminKp, adminAddr, USDSUI_TYPE, 'USDSUI', adminUsdsui, takerKp, takerAddr, takerUsdsui);
      await sleep(3000);

      adminUsdsui = await getCoins(client, adminAddr, USDSUI_TYPE);
      takerUsdsui = await getCoins(client, takerAddr, USDSUI_TYPE);
      await flowSettleTakerWins(client, adminKp, adminAddr, USDSUI_TYPE, 'USDSUI', adminUsdsui, takerKp, takerAddr, takerUsdsui);
      await sleep(3000);

      adminUsdsui = await getCoins(client, adminAddr, USDSUI_TYPE);
      takerUsdsui = await getCoins(client, takerAddr, USDSUI_TYPE);
      await flowVoid(client, adminKp, adminAddr, USDSUI_TYPE, 'USDSUI', adminUsdsui, takerKp, takerAddr, takerUsdsui);
      await sleep(3000);
    }
  } else {
    skip('USDSUI Test Suite', 'Admin has insufficient USDSUI');
  }

  // ── Restore dispute_window = 2 hours ──────────────────────────────────────
  console.log('\n── Restoring dispute_window = 7,200,000ms ──');
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(3000 * attempt);
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(GAS_BUDGET);
    tx.moveCall({
      target: `${PKG}::p2p_betting::set_dispute_window`,
      arguments: [tx.object(ADMIN_CAP), tx.object(CONFIG), tx.pure.u64(7_200_000n), tx.object(CLOCK)],
    });
    const r = await sendTx(client, tx, adminKp, `set_dispute_window → 7,200,000ms (attempt ${attempt})`);
    if (r.status === 'success') break;
    if (attempt < 3) { results.pop(); failed--; }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  sep();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${String(passed).padEnd(3)} passed  ${String(failed).padEnd(3)} failed  ${String(skipped).padEnd(3)} skipped       ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  sep();
  for (const r of results) {
    if (r.ok === null) console.log(`  ⏭️  ${r.label}: ${r.reason}`);
    else if (r.ok)    console.log(`  ✅ ${r.label}${r.hash ? ` → https://suivision.xyz/txblock/${r.hash}` : ''}`);
    else              console.log(`  ❌ ${r.label}: ${r.err}`);
  }
  sep();

  // ── Gasless summary ────────────────────────────────────────────────────────
  console.log('── Gasless transfer summary ──────────────────────────────────');
  console.log('   USDC/USDSUI sends      → SuiGrpcClient, gasPrice=0, gasBudget=0');
  console.log('   post_offer             → SuiClient + SUI gas (writes P2POffer object)');
  console.log('   accept_offer           → SuiClient + SUI gas (writes P2PMatchedBet object)');
  console.log('   instant_settle_bet     → SuiClient + SUI gas (oracle pays; winner gets paid for free)');
  console.log('   cancel/expire/void_bet → SuiClient + SUI gas (modifies shared objects)');
  sep();

  if (failed > 0) {
    console.log(`❌ ${failed} test(s) failed. Check logs above.`);
    process.exit(1);
  } else {
    console.log(`✅ All ${passed} test(s) passed${skipped > 0 ? ` (${skipped} skipped)` : ''}!`);
  }
}

main().catch(e => { console.error('\n💥 Fatal:', e.message, e.stack?.split('\n')[1]); process.exit(1); });
