/**
 * settle-railway-stuck.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot script: finalize 3 stuck Railway P2P matches on Sui mainnet.
 *
 * Background: Railway's settlement loop called queue_settle_bet on these bets,
 * draining their escrow balances (maker_balance=0, taker_balance=0) and setting
 * them into status 4 (QUEUED_MAKER_WINS) or 5 (QUEUED_TAKER_WINS), but never
 * called claim_settlement to complete the payout.
 *
 * Match 94  – Las Vegas Aces 101-91 Seattle Storm
 *   → queued with pending_maker_wins=true (CORRECT) → call claim_settlement
 *
 * Match 95  – Portland Fire 84-83 Dallas Wings
 *   → queued with pending_maker_wins=false (WRONG, maker actually won)
 *   → dispute window expired → call instant_void_bet to refund both parties
 *
 * Match 98  – Aalborg 32-37 FC Barcelona Handbol
 *   → queued with pending_maker_wins=false (WRONG, maker actually won)
 *   → dispute window expired → call instant_void_bet to refund both parties
 *
 * Run:
 *   DATABASE_URL=<railway_url> pnpm --filter @workspace/api-server tsx src/scripts/settle-railway-stuck.ts
 */

import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { Transaction }         from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient }        from '../lib/suiRpcConfig';
import postgres                from 'postgres';

// ── Config ────────────────────────────────────────────────────────────────────
const PACKAGE_ID    = (process.env.P2P_PACKAGE_ID    || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59').trim();
const CONFIG_ID     = (process.env.P2P_CONFIG_ID     || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf').trim();
const REGISTRY_ID   = (process.env.P2P_REGISTRY_ID   || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d').trim();
const WARP_PKG_ID   = (process.env.WARP_PACKAGE_ID   || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747').trim();
const WARP_STATS_ID = (process.env.WARP_STATS_ID     || '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367').trim();
const ORACLE_CAP_ID = (process.env.P2P_ORACLE_CAP_ID || '').trim();
const ADMIN_KEY     = (process.env.ADMIN_PRIVATE_KEY  || '').trim();
const RAILWAY_URL   = process.env.DATABASE_URL || '';

const SBETS_COIN = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const SUI_CLOCK  = '0x0000000000000000000000000000000000000000000000000000000000000006';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m';
const OK   = (s: string) => console.log(`${G}✅  ${s}${X}`);
const FAIL = (s: string) => console.log(`${R}❌  ${s}${X}`);
const INFO = (s: string) => console.log(`${C}ℹ️   ${s}${X}`);
const WARN = (s: string) => console.log(`${Y}⚠️   ${s}${X}`);

if (!ADMIN_KEY) { FAIL('ADMIN_PRIVATE_KEY not set'); process.exit(1); }
if (!ORACLE_CAP_ID) { FAIL('P2P_ORACLE_CAP_ID not set'); process.exit(1); }
if (!RAILWAY_URL) { FAIL('DATABASE_URL not set'); process.exit(1); }

function loadKeypair(): Ed25519Keypair {
  try {
    const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    return Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_KEY, 'base64'));
  }
}

interface MatchToSettle {
  matchId: number;
  offerId: number;
  onchainMatchId: string;
  action: 'claim' | 'void';
  correctWinner: 'maker' | 'taker' | 'void';
  homeTeam: string;
  awayTeam: string;
  eventId: string;
  winner: string;          // 'home' | 'away' | 'void'
  homeScore: number;
  awayScore: number;
  note: string;
}

const MATCHES: MatchToSettle[] = [
  {
    matchId: 94,
    offerId: 165,
    onchainMatchId: '0xbdde8f1fd98013569f8e716556c472524723e9876527c52b5c0a5be9e1385e8c',
    action: 'void',
    correctWinner: 'void',
    homeTeam: 'Las Vegas Aces',
    awayTeam: 'Seattle Storm',
    eventId: '401856974',
    winner: 'void',
    homeScore: 101,
    awayScore: 91,
    note: 'Queued (status=4, pending_maker_wins=true) — instant_settle_bet requires status=1, claim_settlement needs caller=maker/taker; voiding to unblock funds',
  },
  {
    matchId: 95,
    offerId: 169,
    onchainMatchId: '0x445a4974cae392bbd490109e4f8914b2555681db45a1c620a2a3d0bc16b39223',
    action: 'void',
    correctWinner: 'void',
    homeTeam: 'Portland Fire',
    awayTeam: 'Dallas Wings',
    eventId: '401856988',
    winner: 'void',
    homeScore: 84,
    awayScore: 83,
    note: 'Queue has pending_maker_wins=false (WRONG, maker won) — dispute window expired, voiding to refund both',
  },
  {
    matchId: 98,
    offerId: 182,
    onchainMatchId: '0x8918815159be5d4408a91e801acd36deab0b9b2a455cb23d89839317be18845f',
    action: 'void',
    correctWinner: 'void',
    homeTeam: 'Aalborg Håndbold',
    awayTeam: 'FC Barcelona Handbol',
    eventId: 'tsdb:2472611',
    winner: 'void',
    homeScore: 32,
    awayScore: 37,
    note: 'Queue has pending_maker_wins=false (WRONG, maker won) — dispute window expired, voiding to refund both',
  },
];

async function voidMatch(
  client: any,
  keypair: Ed25519Keypair,
  db: ReturnType<typeof postgres>,
  m: MatchToSettle,
): Promise<boolean> {
  WARN(`instant_void_bet for match ${m.matchId}: ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`);
  WARN(`  ${m.note}`);

  const lock = await db`
    UPDATE p2p_bet_matches
    SET status = 'settling'
    WHERE id = ${m.matchId} AND settlement_tx_hash IS NULL AND winner IS NULL
    RETURNING id
  `;
  if (!lock.length) {
    FAIL(`Match ${m.matchId} already settled or locked — skipping`);
    return false;
  }

  try {
    const tx = new Transaction();
    // instant_void_bet: oracle_cap, config, registry, bet, clock
    tx.moveCall({
      target: `${PACKAGE_ID}::p2p_betting::instant_void_bet`,
      typeArguments: [SBETS_COIN],
      arguments: [
        tx.object(ORACLE_CAP_ID),
        tx.object(CONFIG_ID),
        tx.object(REGISTRY_ID),
        tx.object(m.onchainMatchId),
        tx.object(SUI_CLOCK),
      ],
    });
    tx.setGasBudget(200_000_000);

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status !== 'success') {
      const err = result.effects?.status?.error ?? 'unknown';
      FAIL(`On-chain instant_void_bet FAILED for match ${m.matchId}: ${err}`);
      await db`UPDATE p2p_bet_matches SET status = 'active' WHERE id = ${m.matchId}`;
      return false;
    }

    const txHash = result.digest;
    OK(`On-chain instant_void_bet TX: ${txHash}`);
    OK(`SuiScan: https://suiscan.xyz/mainnet/tx/${txHash}`);

    await db`
      UPDATE p2p_bet_matches
      SET status = 'void',
          settlement_tx_hash = ${txHash},
          settled_at = NOW(),
          winner = 'void'
      WHERE id = ${m.matchId}
    `;
    await db`
      UPDATE p2p_bet_offers
      SET status = 'void',
          settlement_tx_hash = ${txHash},
          settled_at = NOW()
      WHERE id = ${m.offerId}
    `;
    OK(`DB updated — match ${m.matchId} voided, offer ${m.offerId} → void`);
    return true;
  } catch (err: any) {
    FAIL(`Error voiding match ${m.matchId}: ${err?.message ?? err}`);
    await db`UPDATE p2p_bet_matches SET status = 'active' WHERE id = ${m.matchId}`;
    return false;
  }
}

async function main() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  SuiBets Railway Stuck Match Settlement Script v2');
  console.log(`${'─'.repeat(60)}\n`);

  const client   = getSuiClient();
  const keypair  = loadKeypair();
  const adminAddr = keypair.getPublicKey().toSuiAddress();
  INFO(`Admin wallet: ${adminAddr}`);
  INFO(`Package: ${PACKAGE_ID.slice(0, 20)}...`);
  INFO(`Oracle Cap: ${ORACLE_CAP_ID.slice(0, 20)}...`);

  const db = postgres(RAILWAY_URL, { ssl: { rejectUnauthorized: false }, max: 1 });

  let settled = 0;
  for (const m of MATCHES) {
    const ok = await voidMatch(client, keypair, db, m);
    if (ok) settled++;
    console.log();
  }

  await db.end();
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Result: ${settled}/${MATCHES.length} matches finalized on-chain`);
  console.log(`  WARP package txs: https://suiscan.xyz/mainnet/object/0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747/tx-blocks`);
  console.log(`  P2P package txs:  https://suiscan.xyz/mainnet/object/${PACKAGE_ID}/tx-blocks`);
  console.log(`${'─'.repeat(60)}\n`);
}

main().catch(e => { FAIL(String(e)); process.exit(1); });
