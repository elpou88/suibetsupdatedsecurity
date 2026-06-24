/**
 * settle-all-railway.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Batch settlement script for all active Railway P2P bets.
 *
 * For each active bet it:
 *  1. Checks on-chain status (only settles status=1 ACTIVE bets via instant_settle_bet)
 *  2. Fetches match result from ESPN (or TSDB fallback)
 *  3. Determines makerWins from offer.prediction vs actual winner
 *  4. Calls instant_settle_bet via oracle
 *  5. Updates Railway DB on success
 *
 * Bets in status 4/5 (QUEUED) are skipped — they need claim_settlement from
 * the maker/taker wallet (0x798e8bb6... or 0x809b2e3e...).
 *
 * Run:
 *   DATABASE_URL=<railway_url> pnpm --filter @workspace/api-server tsx src/scripts/settle-all-railway.ts
 */

import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { Transaction }         from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient }        from '../lib/suiRpcConfig';
import postgres                from 'postgres';

// ── Config ────────────────────────────────────────────────────────────────────
const PACKAGE_ID    = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG_ID     = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const REGISTRY_ID   = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP_ID = (process.env.P2P_ORACLE_CAP_ID || '').trim();
const ADMIN_KEY     = (process.env.ADMIN_PRIVATE_KEY  || '').trim();
const RAILWAY_URL   = process.env.DATABASE_URL || '';
const DRY_RUN       = process.argv.includes('--dry-run');

const SUI_COIN   = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const SBETS_COIN = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const SUI_CLOCK  = '0x0000000000000000000000000000000000000000000000000000000000000006';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m', B = '\x1b[1m';
const OK   = (s: string) => console.log(`${G}✅  ${s}${X}`);
const FAIL = (s: string) => console.log(`${R}❌  ${s}${X}`);
const INFO = (s: string) => console.log(`${C}ℹ️   ${s}${X}`);
const WARN = (s: string) => console.log(`${Y}⚠️   ${s}${X}`);
const HEAD = (s: string) => console.log(`${B}${s}${X}`);

if (!ADMIN_KEY)    { FAIL('ADMIN_PRIVATE_KEY not set'); process.exit(1); }
if (!ORACLE_CAP_ID) { FAIL('P2P_ORACLE_CAP_ID not set'); process.exit(1); }
if (!RAILWAY_URL)   { FAIL('DATABASE_URL not set'); process.exit(1); }

function loadKeypair(): Ed25519Keypair {
  try {
    const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    return Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_KEY, 'base64'));
  }
}

// ── ESPN / TSDB result lookup ─────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return r.json();
  } catch { clearTimeout(timer); return null; }
}

interface MatchResult {
  homeScore: number;
  awayScore: number;
  winner: 'home' | 'away' | 'draw';
  completed: boolean;
  status: string;
}

// Build ESPN sport endpoint from eventId pattern
function espnEndpointsForId(eventId: string): string[] {
  const id = eventId.replace(/^tsdb:/, '');
  return [
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${id}`,
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`,
    `https://site.api.espn.com/apis/site/v2/sports/boxing/summary?event=${id}`,
    `https://site.api.espn.com/apis/site/v2/sports/soccer/summary?event=${id}`,
  ];
}

async function getMatchResult(eventId: string, homeTeam: string, awayTeam: string): Promise<MatchResult | null> {
  const rawId = eventId.replace(/^tsdb:/, '');

  // ESPN summary approach
  const endpoints = espnEndpointsForId(eventId);
  for (const url of endpoints) {
    const d = await fetchJson(url);
    if (!d) continue;

    // Try boxscore → teams
    const teams = d?.boxscore?.teams ?? d?.header?.competitions?.[0]?.competitors;
    if (teams?.length >= 2) {
      // ESPN summary format
      const status = d?.header?.competitions?.[0]?.status?.type;
      const completed = status?.completed === true;
      const statusName: string = status?.name ?? status?.description ?? '';
      if (!completed) return { homeScore: 0, awayScore: 0, winner: 'draw', completed: false, status: statusName };

      // Find home/away scores
      const byHomeAway = (t: any) => t.homeAway ?? t.team?.homeAway;
      const home = teams.find((t: any) => byHomeAway(t) === 'home');
      const away = teams.find((t: any) => byHomeAway(t) === 'away');
      if (home && away) {
        const hs = Number(home.score ?? home.score ?? 0);
        const as_ = Number(away.score ?? away.score ?? 0);
        const winner = hs > as_ ? 'home' : as_ > hs ? 'away' : 'draw';
        return { homeScore: hs, awayScore: as_, winner, completed: true, status: statusName };
      }
    }

    // Try header competitors
    const comps = d?.header?.competitions;
    if (comps?.length > 0) {
      const comp = comps[0];
      const completed = comp?.status?.type?.completed === true;
      const statusName: string = comp?.status?.type?.name ?? '';
      if (!completed) return { homeScore: 0, awayScore: 0, winner: 'draw', completed: false, status: statusName };
      const competitors: any[] = comp?.competitors ?? [];
      const home = competitors.find((c: any) => c.homeAway === 'home');
      const away = competitors.find((c: any) => c.homeAway === 'away');
      if (home && away) {
        const hs = Number(home.score ?? 0);
        const as_ = Number(away.score ?? 0);
        const winner = hs > as_ ? 'home' : as_ > hs ? 'away' : 'draw';
        return { homeScore: hs, awayScore: as_, winner, completed: true, status: statusName };
      }
    }
  }
  return null;
}

// ── On-chain status check ─────────────────────────────────────────────────────

interface OnchainBetState {
  status: number; // 1=active, 4=queued_maker, 5=queued_taker, 6=void, 7=cancelled, etc.
  makerBalance: number;
  takerBalance: number;
  pendingMakerWins: boolean | null;
}

async function getOnchainBetState(betId: string, suiClient: any): Promise<OnchainBetState | null> {
  try {
    const obj = await suiClient.getObject({ id: betId, options: { showContent: true } });
    const fields = obj?.data?.content?.fields;
    if (!fields) return null;
    const status = Number(fields.status ?? 0);
    const makerBalance = Number(
      fields.maker_balance?.fields?.value ?? fields.maker_balance ?? 0
    );
    const takerBalance = Number(
      fields.taker_balance?.fields?.value ?? fields.taker_balance ?? 0
    );
    // pending_maker_wins is set after queue_settle_bet
    const pmw = fields.pending_maker_wins;
    const pendingMakerWins = pmw === true || pmw === 'true' ? true :
                             pmw === false || pmw === 'false' ? false : null;
    return { status, makerBalance, takerBalance, pendingMakerWins };
  } catch { return null; }
}

// ── On-chain settlement ───────────────────────────────────────────────────────

async function instantSettle(
  suiClient: any,
  keypair: Ed25519Keypair,
  betId: string,
  makerWins: boolean,
  coinType: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (DRY_RUN) {
    return { success: true, txHash: 'DRY_RUN_SKIPPED' };
  }
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::p2p_betting::instant_settle_bet`,
      typeArguments: [coinType],
      arguments: [
        tx.object(ORACLE_CAP_ID),
        tx.object(CONFIG_ID),
        tx.object(REGISTRY_ID),
        tx.object(betId),
        tx.pure.bool(makerWins),
        tx.object(SUI_CLOCK),
      ],
    });
    tx.setGasBudget(200_000_000);
    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    if (result.effects?.status?.status === 'success') {
      return { success: true, txHash: result.digest };
    }
    return { success: false, error: result.effects?.status?.error ?? 'TX failed' };
  } catch (e: any) {
    return { success: false, error: e.message ?? String(e) };
  }
}

async function voidBet(
  suiClient: any,
  keypair: Ed25519Keypair,
  betId: string,
  coinType: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (DRY_RUN) {
    return { success: true, txHash: 'DRY_RUN_SKIPPED' };
  }
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::p2p_betting::instant_void_bet`,
      typeArguments: [coinType],
      arguments: [
        tx.object(ORACLE_CAP_ID),
        tx.object(CONFIG_ID),
        tx.object(REGISTRY_ID),
        tx.object(betId),
        tx.object(SUI_CLOCK),
      ],
    });
    tx.setGasBudget(200_000_000);
    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    if (result.effects?.status?.status === 'success') {
      return { success: true, txHash: result.digest };
    }
    return { success: false, error: result.effects?.status?.error ?? 'TX failed' };
  } catch (e: any) {
    return { success: false, error: e.message ?? String(e) };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const lineWidth = 70;
  console.log(`\n${'─'.repeat(lineWidth)}`);
  HEAD('  SuiBets Railway Batch Settlement Script');
  console.log(`${'─'.repeat(lineWidth)}\n`);
  if (DRY_RUN) WARN('DRY RUN mode — no on-chain TXs will be sent\n');

  const suiClient = getSuiClient();
  const keypair   = loadKeypair();
  const adminAddr = keypair.getPublicKey().toSuiAddress();
  INFO(`Admin wallet : ${adminAddr}`);
  INFO(`Oracle Cap   : ${ORACLE_CAP_ID.slice(0, 20)}...`);
  console.log();

  const db = postgres(RAILWAY_URL, { ssl: { rejectUnauthorized: false }, max: 3 });

  // Fetch all active bets with offer details
  const rows = await db`
    SELECT
      bm.id            AS match_id,
      bm.offer_id,
      bm.onchain_match_id,
      bm.taker_wallet,
      bm.stake,
      bo.event_id,
      bo.event_name,
      bo.home_team,
      bo.away_team,
      bo.prediction,
      bo.currency,
      bo.creator_wallet
    FROM p2p_bet_matches bm
    JOIN p2p_bet_offers  bo ON bm.offer_id = bo.id
    WHERE bm.status IN ('active', 'settling')
      AND bm.onchain_match_id IS NOT NULL
      AND bm.onchain_match_id != ''
    ORDER BY bm.id
  `;

  INFO(`Found ${rows.length} active bets to process\n`);

  const stats = {
    settled: 0,
    voided: 0,
    skippedQueued: 0,
    skippedLive: 0,
    skippedNoResult: 0,
    failed: 0,
    queued: [] as { matchId: number; eventName: string; pendingMakerWins: boolean | null; state: number }[],
  };

  for (const row of rows) {
    const matchId    = Number(row.match_id);
    const offerId    = Number(row.offer_id);
    const betId      = row.onchain_match_id as string;
    const eventId    = (row.event_id ?? '') as string;
    const eventName  = (row.event_name ?? '?') as string;
    const prediction = (row.prediction ?? '') as string; // home | away | draw
    const currency   = ((row.currency ?? 'SUI') as string).toUpperCase();

    HEAD(`\n  [Match ${matchId}] ${eventName}`);
    INFO(`  Prediction: ${prediction} | Event: ${eventId} | Bet: ${betId.slice(0, 18)}...`);

    // 1. Check on-chain state
    const state = await getOnchainBetState(betId, suiClient);
    if (!state) {
      WARN(`  On-chain object not found — skipping`);
      stats.skippedNoResult++;
      continue;
    }

    const statusLabel = ['?','OPEN','TAKEN','?','QUEUED_MAKER','QUEUED_TAKER','VOID','CANCELLED','EXPIRED','DISPUTED'][state.status] ?? `STATUS_${state.status}`;
    INFO(`  On-chain: status=${state.status} (${statusLabel}), maker=${state.makerBalance}, taker=${state.takerBalance}`);

    // 2. Handle queued state (can't use oracle override)
    if (state.status === 4 || state.status === 5) {
      WARN(`  QUEUED state — oracle cannot override. Needs claim_settlement from maker/taker wallet.`);
      WARN(`  pending_maker_wins=${state.pendingMakerWins}`);
      stats.skippedQueued++;
      stats.queued.push({ matchId, eventName, pendingMakerWins: state.pendingMakerWins, state: state.status });
      continue;
    }

    // 3. Handle already terminal states
    if (state.status >= 6) {
      INFO(`  Already terminal on-chain (${statusLabel}) — updating DB`);
      await db`
        UPDATE p2p_bet_matches
        SET status = 'void', settled_at = NOW()
        WHERE id = ${matchId} AND status = 'active'
      `;
      continue;
    }

    // 4. status=1 (open) or status=2 (taken/matched) — these are both settleable via oracle
    // P2PMatchedBet objects use status=2 (TAKEN) when the offer has been accepted and
    // is waiting for oracle settlement. Status=1 would be unusual for a matched bet.
    if (state.status !== 1 && state.status !== 2) {
      WARN(`  Unexpected status ${state.status} — skipping`);
      continue;
    }

    // 5. Fetch match result
    const result = await getMatchResult(eventId, row.home_team as string, row.away_team as string);
    if (!result) {
      WARN(`  Could not fetch result from ESPN — skipping`);
      stats.skippedNoResult++;
      continue;
    }
    if (!result.completed) {
      WARN(`  Match not yet complete (${result.status}) — skipping`);
      stats.skippedLive++;
      continue;
    }

    INFO(`  Result: ${row.home_team} ${result.homeScore}-${result.awayScore} ${row.away_team} → ${result.winner.toUpperCase()} wins`);

    // 6. Determine makerWins
    // prediction = what the maker (platform) bet on
    const makerWins = prediction === result.winner;
    const winnerLabel = makerWins ? 'maker (platform)' : 'taker (user)';
    INFO(`  Maker prediction=${prediction} vs result=${result.winner} → makerWins=${makerWins} → ${winnerLabel} wins`);

    // 7. Lock the row
    const locked = await db`
      UPDATE p2p_bet_matches
      SET status = 'settling'
      WHERE id = ${matchId} AND status IN ('active', 'settling') AND settlement_tx_hash IS NULL
      RETURNING id
    `;
    if (!locked.length) {
      WARN(`  Already locked/settled — skipping`);
      continue;
    }

    // 8. Determine coin type
    const coinType = currency === 'SBETS' ? SBETS_COIN : SUI_COIN;

    // 9. Execute on-chain settlement (or void for draws if prediction was home/away)
    let txResult: { success: boolean; txHash?: string; error?: string };
    if (result.winner === 'draw' && prediction !== 'draw') {
      // Unexpected draw — the offer didn't offer a draw outcome, void it
      WARN(`  Draw result but prediction was ${prediction} — voiding`);
      txResult = await voidBet(suiClient, keypair, betId, coinType);
    } else {
      txResult = await instantSettle(suiClient, keypair, betId, makerWins, coinType);
    }

    if (!txResult.success) {
      const errStr = txResult.error ?? '';
      // Already terminal?
      if (errStr.includes('}, 11)') || errStr.includes('ALREADY_TERMINAL')) {
        WARN(`  On-chain already terminal (abort 11) — updating DB only`);
        const matchStatus = makerWins ? 'lost' : 'won'; // match status from taker perspective
        await db`UPDATE p2p_bet_matches SET status = ${matchStatus}, settled_at = NOW() WHERE id = ${matchId}`;
        stats.settled++;
        continue;
      }
      FAIL(`  On-chain TX failed: ${errStr.slice(0, 120)}`);
      await db`UPDATE p2p_bet_matches SET status = 'active' WHERE id = ${matchId}`;
      stats.failed++;
      continue;
    }

    const txHash = txResult.txHash!;
    OK(`  TX: ${txHash}`);
    if (txHash !== 'DRY_RUN_SKIPPED') {
      INFO(`  SuiScan: https://suiscan.xyz/mainnet/tx/${txHash}`);
    }

    // 10. Update DB
    const isVoid = result.winner === 'draw' && prediction !== 'draw';
    if (isVoid) {
      await db`
        UPDATE p2p_bet_matches
        SET status = 'void',
            settlement_tx_hash = ${txHash},
            settled_at = NOW(),
            winner = 'void'
        WHERE id = ${matchId}
      `;
      await db`
        UPDATE p2p_bet_offers
        SET status = 'void', settlement_tx_hash = ${txHash}, settled_at = NOW()
        WHERE id = ${offerId}
      `;
      stats.voided++;
    } else {
      const matchStatus = makerWins ? 'lost' : 'won'; // taker perspective
      const winnerWallet = makerWins ? (row.creator_wallet as string ?? '') : (row.taker_wallet as string ?? '');
      const offerWinner = makerWins ? 'creator' : 'taker';
      await db`
        UPDATE p2p_bet_matches
        SET status = ${matchStatus},
            settlement_tx_hash = ${txHash},
            settled_at = NOW(),
            winner = ${winnerWallet}
        WHERE id = ${matchId}
      `;
      await db`
        UPDATE p2p_bet_offers
        SET status = 'settled',
            settlement_tx_hash = ${txHash},
            settled_at = NOW(),
            winner = ${offerWinner}
        WHERE id = ${offerId}
      `;
      OK(`  DB updated — match ${matchId} → ${matchStatus}, winner: ${offerWinner}`);
      stats.settled++;
    }
  }

  await db.end();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(lineWidth)}`);
  HEAD('  RESULTS');
  console.log(`${'─'.repeat(lineWidth)}`);
  OK(`Settled:       ${stats.settled}`);
  if (stats.voided)          OK(`Voided:        ${stats.voided}`);
  if (stats.skippedLive)     WARN(`Still live:    ${stats.skippedLive} (run again after matches finish)`);
  if (stats.skippedNoResult) WARN(`No result:     ${stats.skippedNoResult} (ESPN couldn't fetch)`);
  if (stats.failed)          FAIL(`Failed:        ${stats.failed}`);

  if (stats.skippedQueued > 0) {
    console.log();
    FAIL(`QUEUED (need maker/taker key): ${stats.skippedQueued}`);
    console.log(`${Y}  These bets are stuck on-chain in queued state and require`);
    console.log(`  claim_settlement called from the maker or taker wallet:${X}`);
    console.log(`    Maker: 0x798e8bb6db3f9c0233ca3521a7b5431af39350b3092144c74be033b468e48426`);
    console.log(`    Taker: 0x809b2e3e5431ab4253f641a288576a0db66fe702026b5939b3c6afeba79472f5`);
    console.log();
    for (const q of stats.queued) {
      console.log(`    Match ${q.matchId}: ${q.eventName}`);
      console.log(`      on-chain status=${q.state}, pending_maker_wins=${q.pendingMakerWins}`);
    }
    console.log();
    console.log(`${Y}  To fix: provide MAKER_PRIVATE_KEY env var for wallet 0x798e8bb6...${X}`);
    console.log(`${Y}  or TAKER_PRIVATE_KEY for wallet 0x809b2e3e...${X}`);
    console.log(`${Y}  then run: node settle-all-railway.mjs --claim-queued${X}`);
  }

  console.log(`\n  P2P TX history: https://suiscan.xyz/mainnet/object/${PACKAGE_ID}/tx-blocks`);
  console.log(`${'─'.repeat(lineWidth)}\n`);

  if (stats.failed > 0) process.exit(1);
}

main().catch(e => { FAIL(String(e)); process.exit(1); });
