#!/usr/bin/env tsx
/**
 * test-warp-onchain.ts
 *
 * Live on-chain test of the WARP Engine.
 *
 * Run:
 *   cd artifacts/api-server
 *   pnpm tsx src/scripts/test-warp-onchain.ts
 *
 * Tests (in order):
 *   1. Health  — read WarpStats object from Sui mainnet
 *   2. Balance — check admin wallet SUI balance
 *   3. Escrow  — create_warp_escrow  (owned, fastpath tx)
 *   4. Deposit — deposit_to_escrow   (0.05 SUI)
 *   5. Withdraw— withdraw_from_escrow (0.02 SUI)
 *   6. Marker  — warp_batch_marker   (records batch stats)
 *   7. Objects — resolve onchain_match_id → P2PMatchedBet object IDs
 *   8. Batch   — warp batch settle of 2 active matches via WARP
 */

import { Transaction }        from '@mysten/sui/transactions';
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';

// ── Constants ─────────────────────────────────────────────────────────────────

const WARP_PACKAGE_ID = process.env.WARP_PACKAGE_ID  || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747';
const WARP_STATS_ID   = process.env.WARP_STATS_ID    || '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367';

const P2P_PACKAGE_ID  = process.env.P2P_PACKAGE_ID   || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const P2P_CONFIG_ID   = process.env.P2P_CONFIG_ID    || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const P2P_REGISTRY_ID = process.env.P2P_REGISTRY_ID  || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const P2P_ORACLE_CAP  = process.env.P2P_ORACLE_CAP_ID || '';
const ADMIN_KEY       = process.env.ADMIN_PRIVATE_KEY  || '';

const SUI_CLOCK       = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_COIN_TYPE   = '0x2::sui::SUI';
const MIST_PER_SUI    = 1_000_000_000n;

// Active on-chain match IDs from dev DB (onchain_match_id column)
// These will be resolved to actual object IDs on-chain.
const ACTIVE_MATCH_TX_OR_OBJ: Array<{ dbId: number; matchId: string; event: string; makerWins: boolean }> = [
  { dbId: 94, matchId: '0xbdde8f1fd98013569f8e716556c472524723e9876527c52b5c0a5be9e1385e8c', event: 'Las Vegas Aces vs Seattle Storm', makerWins: true  },
  { dbId: 93, matchId: '0x445a4974cae392bbd490109e4f8914b2555681db45a1c620a2a3d0bc16b39223', event: 'Portland Fire vs Dallas Wings',     makerWins: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sep(title: string) {
  console.log('\n' + '─'.repeat(70));
  console.log(`  ${title}`);
  console.log('─'.repeat(70));
}

function ok(msg: string)   { console.log(`  ✅  ${msg}`); }
function fail(msg: string) { console.log(`  ❌  ${msg}`); }
function info(msg: string) { console.log(`  ℹ   ${msg}`); }

function buildKeypair(): Ed25519Keypair {
  if (!ADMIN_KEY) throw new Error('ADMIN_PRIVATE_KEY not set');
  if (ADMIN_KEY.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  let bytes: Uint8Array;
  if (ADMIN_KEY.startsWith('0x')) {
    bytes = new Uint8Array(Buffer.from(ADMIN_KEY.slice(2), 'hex'));
  } else {
    bytes = new Uint8Array(Buffer.from(ADMIN_KEY, 'base64'));
  }
  if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(bytes);
}

async function execTx(client: SuiClient, kp: Ed25519Keypair, tx: Transaction, label: string) {
  const t0 = Date.now();
  tx.setSender(kp.getPublicKey().toSuiAddress());
  const result = await client.signAndExecuteTransaction({
    transaction: tx as any,
    signer: kp,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });
  const ms     = Date.now() - t0;
  const status = result?.effects?.status?.status;
  const gas    = Number(result?.effects?.gasUsed?.computationCost ?? 0) +
                 Number(result?.effects?.gasUsed?.storageCost ?? 0);
  if (status === 'success') {
    ok(`${label}  |  digest: ${result.digest}  |  gas: ${gas} MIST  |  ${ms}ms`);
  } else {
    fail(`${label} FAILED — ${result?.effects?.status?.error ?? 'unknown'}`);
    console.log('     Digest:', result.digest);
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n');
  console.log('██╗    ██╗ █████╗ ██████╗ ██████╗      ████████╗███████╗███████╗████████╗');
  console.log('██║    ██║██╔══██╗██╔══██╗██╔══██╗        ██╔══╝██╔════╝██╔════╝╚══██╔══╝');
  console.log('██║ █╗ ██║███████║██████╔╝██████╔╝        ██║   █████╗  ███████╗   ██║   ');
  console.log('██║███╗██║██╔══██║██╔══██╗██╔═══╝         ██║   ██╔══╝  ╚════██║   ██║   ');
  console.log('╚███╔███╔╝██║  ██║██║  ██║██║              ██║   ███████╗███████║   ██║   ');
  console.log(' ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝              ╚═╝   ╚══════╝╚══════╝   ╚═╝  ');
  console.log('\n  WARP Engine — Live On-Chain Integration Test  |  Sui Mainnet');
  console.log('  SuiBets P2P Betting Platform\n');

  const rpcUrl = process.env.SUI_RPC_URL || getFullnodeUrl('mainnet');
  const client = new SuiClient({ url: rpcUrl });

  // ── Check prerequisites ────────────────────────────────────────────────────
  if (!ADMIN_KEY) {
    fail('ADMIN_PRIVATE_KEY not set — cannot sign transactions');
    process.exit(1);
  }
  if (!P2P_ORACLE_CAP) {
    fail('P2P_ORACLE_CAP_ID not set — batch marker and settlement tests will be skipped');
  }

  const kp      = buildKeypair();
  const adminAddr = kp.getPublicKey().toSuiAddress();
  info(`Admin wallet: ${adminAddr}`);
  info(`WARP package: ${WARP_PACKAGE_ID}`);
  info(`WarpStats   : ${WARP_STATS_ID}`);
  info(`P2P package : ${P2P_PACKAGE_ID}`);
  info(`OracleCap   : ${P2P_ORACLE_CAP || '(not set)'}`);

  let passCount = 0, failCount = 0;

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1 — WarpStats Health Check
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 1 — WarpStats Health Check (read on-chain object)');
  try {
    const obj = await client.getObject({ id: WARP_STATS_ID, options: { showContent: true } });
    if (!obj?.data) throw new Error('Object not found');
    const f = (obj.data.content as any)?.fields ?? {};
    ok(`WarpStats object found on mainnet`);
    info(`  total_batches  : ${f.total_batches ?? 0}`);
    info(`  total_settled  : ${f.total_settled ?? 0}`);
    info(`  total_voided   : ${f.total_voided  ?? 0}`);
    info(`  max_batch_size : ${f.max_batch_size ?? 0}`);
    info(`  last_batch_ts  : ${f.last_batch_ts  ?? 0}`);
    passCount++;
  } catch (e: any) {
    fail(`WarpStats fetch failed: ${e.message}`);
    failCount++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2 — Admin Wallet Balance
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 2 — Admin Wallet SUI Balance');
  let adminBalance = 0n;
  try {
    const balance = await client.getBalance({ owner: adminAddr });
    adminBalance = BigInt(balance.totalBalance);
    const sui    = (adminBalance / MIST_PER_SUI).toString() + '.' +
                   (adminBalance % MIST_PER_SUI).toString().padStart(9, '0').slice(0, 4) + ' SUI';
    ok(`Admin balance: ${sui}  (${adminBalance} MIST)`);
    if (adminBalance < 100_000_000n) {
      fail('Balance < 0.1 SUI — some tests may fail due to insufficient gas');
      failCount++;
    } else {
      passCount++;
    }
  } catch (e: any) {
    fail(`Balance fetch failed: ${e.message}`);
    failCount++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3 — create_warp_escrow  (owned-object fastpath)
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 3 — create_warp_escrow (owned, zero-consensus fastpath)');
  let escrowObjectId: string | null = null;
  try {
    const tx = new Transaction();
    tx.moveCall({
      target:    `${WARP_PACKAGE_ID}::warp_engine::create_warp_escrow`,
      arguments: [tx.object(SUI_CLOCK)],
    });
    tx.setGasBudget(10_000_000);

    const result = await execTx(client, kp, tx, 'create_warp_escrow');
    const status = result?.effects?.status?.status;
    if (status === 'success') {
      // Extract the created WarpEscrow object
      const created = result.objectChanges?.find(
        (c: any) => c.type === 'created' && c.objectType?.includes('WarpEscrow')
      ) as any;
      if (created) {
        escrowObjectId = created.objectId;
        info(`WarpEscrow object ID: ${escrowObjectId}`);
      }

      // Check for WarpEscrowCreated event
      const ev = result.events?.find((e: any) => e.type?.includes('WarpEscrowCreated'));
      if (ev) {
        info(`WarpEscrowCreated event: owner=${(ev.parsedJson as any)?.owner}`);
      }
      passCount++;
    } else {
      failCount++;
    }
  } catch (e: any) {
    fail(`create_warp_escrow failed: ${e.message}`);
    failCount++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4 — deposit_to_escrow  (0.05 SUI)
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 4 — deposit_to_escrow (0.05 SUI into WarpEscrow)');
  const DEPOSIT_AMOUNT = 50_000_000n; // 0.05 SUI in MIST
  if (!escrowObjectId) {
    fail('Skipped — no WarpEscrow from TEST 3');
    failCount++;
  } else {
    try {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(DEPOSIT_AMOUNT)]);
      tx.moveCall({
        target:        `${WARP_PACKAGE_ID}::warp_engine::deposit_to_escrow`,
        typeArguments: [SUI_COIN_TYPE],
        arguments:     [tx.object(escrowObjectId), coin, tx.object(SUI_CLOCK)],
      });
      tx.setGasBudget(15_000_000);

      const result = await execTx(client, kp, tx, `deposit_to_escrow 0.05 SUI`);
      const status = result?.effects?.status?.status;
      if (status === 'success') {
        const ev = result.events?.find((e: any) => e.type?.includes('WarpEscrowDeposit'));
        if (ev) {
          const pj = ev.parsedJson as any;
          info(`WarpEscrowDeposit event: amount=${pj?.amount} MIST`);
        }
        passCount++;
      } else {
        failCount++;
      }
    } catch (e: any) {
      fail(`deposit_to_escrow failed: ${e.message}`);
      failCount++;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 5 — withdraw_from_escrow  (0.02 SUI back to wallet)
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 5 — withdraw_from_escrow (0.02 SUI back to wallet)');
  const WITHDRAW_AMOUNT = 20_000_000n; // 0.02 SUI
  if (!escrowObjectId) {
    fail('Skipped — no WarpEscrow from TEST 3');
    failCount++;
  } else {
    try {
      const tx = new Transaction();
      tx.moveCall({
        target:        `${WARP_PACKAGE_ID}::warp_engine::withdraw_from_escrow`,
        typeArguments: [SUI_COIN_TYPE],
        arguments:     [
          tx.object(escrowObjectId),
          tx.pure.u64(WITHDRAW_AMOUNT),
          tx.object(SUI_CLOCK),
        ],
      });
      tx.setGasBudget(15_000_000);

      const result = await execTx(client, kp, tx, `withdraw_from_escrow 0.02 SUI`);
      const status = result?.effects?.status?.status;
      if (status === 'success') {
        const ev = result.events?.find((e: any) => e.type?.includes('WarpEscrowWithdraw'));
        if (ev) {
          const pj = ev.parsedJson as any;
          info(`WarpEscrowWithdraw event: amount=${pj?.amount} MIST`);
        }
        passCount++;
      } else {
        failCount++;
      }
    } catch (e: any) {
      fail(`withdraw_from_escrow failed: ${e.message}`);
      failCount++;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 6 — warp_batch_marker  (OracleCap-gated batch stats)
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 6 — warp_batch_marker (oracle batch stats update)');
  if (!P2P_ORACLE_CAP) {
    fail('Skipped — P2P_ORACLE_CAP_ID not set');
    failCount++;
  } else {
    try {
      const tx = new Transaction();
      tx.moveCall({
        target:    `${WARP_PACKAGE_ID}::warp_engine::warp_batch_marker`,
        arguments: [
          tx.object(P2P_ORACLE_CAP),
          tx.object(WARP_STATS_ID),
          tx.pure.u64(5),   // count = 5 bets (test batch)
          tx.pure.u64(0),   // voided = 0
          tx.object(SUI_CLOCK),
        ],
      });
      tx.setGasBudget(10_000_000);

      const result = await execTx(client, kp, tx, 'warp_batch_marker(count=5, voided=0)');
      const status = result?.effects?.status?.status;
      if (status === 'success') {
        const ev = result.events?.find((e: any) => e.type?.includes('WarpBatchSettled'));
        if (ev) {
          const pj = ev.parsedJson as any;
          info(`WarpBatchSettled event: batch_id=${pj?.batch_id}, count=${pj?.count}, voided=${pj?.voided}`);
        }
        // Re-read WarpStats to confirm update
        const statsObj = await client.getObject({ id: WARP_STATS_ID, options: { showContent: true } });
        const f = (statsObj?.data?.content as any)?.fields ?? {};
        info(`WarpStats after: batches=${f.total_batches}, settled=${f.total_settled}, max_batch=${f.max_batch_size}`);
        passCount++;
      } else {
        failCount++;
      }
    } catch (e: any) {
      fail(`warp_batch_marker failed: ${e.message}`);
      failCount++;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 7 — Resolve onchain_match_id → P2PMatchedBet object
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 7 — Resolve on-chain match IDs to P2PMatchedBet objects');
  const resolvedBets: Array<{ dbId: number; objectId: string; event: string; makerWins: boolean }> = [];

  for (const spec of ACTIVE_MATCH_TX_OR_OBJ) {
    try {
      // First try treating it as an object ID
      const obj = await client.getObject({
        id: spec.matchId,
        options: { showType: true, showContent: true },
      });

      if (obj?.data?.type?.includes('P2PMatchedBet')) {
        info(`Match DB#${spec.dbId}: object exists  |  type: ${obj.data.type}`);
        resolvedBets.push({ dbId: spec.dbId, objectId: spec.matchId, event: spec.event, makerWins: spec.makerWins });
        ok(`Resolved DB#${spec.dbId} → object ${spec.matchId.slice(0, 16)}...`);
      } else if (obj?.data) {
        // It's an object but not a P2PMatchedBet — try as tx digest
        info(`Match DB#${spec.dbId}: ID is an object of type ${obj.data.type ?? 'unknown'} — trying as tx digest`);
        // Get created objects from the transaction
        const tx = await client.getTransactionBlock({
          digest: spec.matchId,
          options: { showObjectChanges: true },
        });
        const betObj = tx?.objectChanges?.find(
          (c: any) => c.type === 'created' && c.objectType?.includes('P2PMatchedBet')
        ) as any;
        if (betObj) {
          resolvedBets.push({ dbId: spec.dbId, objectId: betObj.objectId, event: spec.event, makerWins: spec.makerWins });
          ok(`Resolved DB#${spec.dbId} via tx → object ${betObj.objectId.slice(0, 16)}...`);
        } else {
          fail(`DB#${spec.dbId}: no P2PMatchedBet found in tx ${spec.matchId.slice(0, 16)}...`);
        }
      } else {
        // Object not found — try as tx digest
        const tx = await client.getTransactionBlock({
          digest: spec.matchId,
          options: { showObjectChanges: true },
        });
        const betObj = tx?.objectChanges?.find(
          (c: any) => c.type === 'created' && c.objectType?.includes('P2PMatchedBet')
        ) as any;
        if (betObj) {
          resolvedBets.push({ dbId: spec.dbId, objectId: betObj.objectId, event: spec.event, makerWins: spec.makerWins });
          ok(`Resolved DB#${spec.dbId} via tx → object ${betObj.objectId.slice(0, 16)}...`);
        } else {
          fail(`DB#${spec.dbId}: could not resolve ${spec.matchId.slice(0, 16)}... as object or tx`);
        }
      }
    } catch (e: any) {
      fail(`DB#${spec.dbId}: resolution error — ${e.message}`);
    }
  }

  if (resolvedBets.length > 0) passCount++;
  else failCount++;

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 8 — WARP Batch Settlement of M-bets
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 8 — WARP Batch Settle (instant_settle_bet via warp_batch_marker PTB)');

  if (!P2P_ORACLE_CAP) {
    fail('Skipped — P2P_ORACLE_CAP_ID not set');
    failCount++;
  } else if (resolvedBets.length === 0) {
    fail('Skipped — no resolved P2PMatchedBet objects from TEST 7');
    failCount++;
  } else {
    for (const spec of resolvedBets) {
      try {
        info(`Settling DB#${spec.dbId} "${spec.event}"  makerWins=${spec.makerWins}`);
        const tx = new Transaction();

        // Batch marker — records this 1-bet batch in WarpStats
        tx.moveCall({
          target:    `${WARP_PACKAGE_ID}::warp_engine::warp_batch_marker`,
          arguments: [
            tx.object(P2P_ORACLE_CAP),
            tx.object(WARP_STATS_ID),
            tx.pure.u64(1),
            tx.pure.u64(0),
            tx.object(SUI_CLOCK),
          ],
        });

        // Instant settle the matched bet
        tx.moveCall({
          target:        `${P2P_PACKAGE_ID}::p2p_betting::instant_settle_bet`,
          typeArguments: [SUI_COIN_TYPE],
          arguments: [
            tx.object(P2P_ORACLE_CAP),
            tx.object(P2P_CONFIG_ID),
            tx.object(P2P_REGISTRY_ID),
            tx.object(spec.objectId),
            tx.pure.bool(spec.makerWins),
            tx.object(SUI_CLOCK),
          ],
        });

        tx.setGasBudget(200_000_000);

        const result = await execTx(client, kp, tx, `WARP settle DB#${spec.dbId} — ${spec.event}`);
        const status = result?.effects?.status?.status;
        if (status === 'success') {
          // Check for WARP batch event
          const batchEv = result.events?.find((e: any) => e.type?.includes('WarpBatchSettled'));
          if (batchEv) {
            const pj = batchEv.parsedJson as any;
            info(`  WarpBatchSettled: batch_id=${pj?.batch_id}`);
          }
          // Check for bet settled event
          const settleEv = result.events?.find((e: any) => e.type?.includes('BetSettled') || e.type?.includes('MatchedBetSettled'));
          if (settleEv) {
            info(`  Settle event: ${JSON.stringify(settleEv.parsedJson)}`);
          }
          passCount++;
        } else {
          const errMsg = result?.effects?.status?.error ?? 'unknown error';
          fail(`Settlement failed: ${errMsg}`);
          // If object not found or wrong state, it may already be settled on-chain
          if (errMsg.includes('not found') || errMsg.includes('deleted') || errMsg.includes('already')) {
            info(`  → Object may already be settled/deleted on-chain (safe to ignore)`);
          }
          failCount++;
        }
      } catch (e: any) {
        fail(`WARP settle DB#${spec.dbId} error: ${e.message}`);
        failCount++;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 9 — Verify WarpStats after all settlements
  // ══════════════════════════════════════════════════════════════════════════
  sep('TEST 9 — Final WarpStats state verification');
  try {
    const obj = await client.getObject({ id: WARP_STATS_ID, options: { showContent: true } });
    const f   = (obj?.data?.content as any)?.fields ?? {};
    ok(`WarpStats final state:`);
    info(`  total_batches  : ${f.total_batches}`);
    info(`  total_settled  : ${f.total_settled}`);
    info(`  total_voided   : ${f.total_voided}`);
    info(`  max_batch_size : ${f.max_batch_size}`);
    info(`  last_batch_ts  : ${f.last_batch_ts}`);
    passCount++;
  } catch (e: any) {
    fail(`WarpStats final read failed: ${e.message}`);
    failCount++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log(`  WARP ON-CHAIN TEST COMPLETE`);
  console.log('═'.repeat(70));
  console.log(`\n  ✅  PASSED : ${passCount}`);
  console.log(`  ❌  FAILED : ${failCount}`);
  console.log(`  TOTAL     : ${passCount + failCount}\n`);

  if (failCount === 0) {
    console.log('  🚀  ALL TESTS PASSED — WARP Engine is fully operational on Sui mainnet!\n');
  } else {
    console.log('  ⚠️   Some tests failed — check output above for details.\n');
  }
}

main().catch(err => {
  console.error('\n[WARP Test] Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
