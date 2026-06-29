/**
 * watch-and-settle.ts
 * Polls ESPN for the US vs Australia match (event 760442) and settles
 * bet match 174 on-chain as soon as it finishes.
 *
 * Run:
 *   DATABASE_URL=<railway_url> pnpm --filter @workspace/api-server tsx src/scripts/watch-and-settle.ts
 */

import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { Transaction }         from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient }        from '../lib/suiRpcConfig';
import postgres                from 'postgres';

const PACKAGE_ID    = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG_ID     = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const REGISTRY_ID   = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP_ID = (process.env.P2P_ORACLE_CAP_ID || '').trim();
const ADMIN_KEY     = (process.env.ADMIN_PRIVATE_KEY  || '').trim();
const RAILWAY_URL   = process.env.DATABASE_URL || '';
const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_COIN      = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m';
const OK   = (s: string) => console.log(`${G}✅  ${s}${X}`);
const FAIL = (s: string) => console.log(`${R}❌  ${s}${X}`);
const INFO = (s: string) => console.log(`${C}ℹ️   ${s}${X}`);
const WARN = (s: string) => console.log(`${Y}⚠️   ${s}${X}`);

if (!ADMIN_KEY) { FAIL('ADMIN_PRIVATE_KEY not set'); process.exit(1); }

// Target bets to watch — can add more here
const WATCH = [
  { matchId: 174, offerId: 297, betId: '0xf65004c5e1467915839899147e493f537512844ca112bd1a6b01ff85250d1926',
    eventId: '760442', sport: 'soccer/fifa.world', prediction: 'home',
    homeTeam: 'United States', awayTeam: 'Australia', currency: 'SUI' },
];

function loadKeypair(): Ed25519Keypair {
  try {
    const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    return Ed25519Keypair.fromSecretKey(Buffer.from(ADMIN_KEY, 'base64'));
  }
}

async function checkESPN(sport: string, eventId: string) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/summary?event=${eventId}`);
  const d: any = await r.json();
  const comp = (d?.header?.competitions || [{}])[0];
  const status = comp?.status?.type || {};
  const comps: any[] = comp?.competitors || [];
  const home = comps.find((c: any) => c.homeAway === 'home');
  const away = comps.find((c: any) => c.homeAway === 'away');
  return {
    completed: !!status.completed,
    statusName: String(status.name || ''),
    homeScore: Number(home?.score ?? 0),
    awayScore: Number(away?.score ?? 0),
    winner: Number(home?.score ?? 0) > Number(away?.score ?? 0) ? 'home' as const
           : Number(away?.score ?? 0) > Number(home?.score ?? 0) ? 'away' as const
           : 'draw' as const,
  };
}

async function settleBet(
  suiClient: any, keypair: Ed25519Keypair,
  betId: string, makerWins: boolean, coinType: string,
) {
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
    signer: keypair, transaction: tx, options: { showEffects: true },
  });
  if (result.effects?.status?.status === 'success') return { success: true, txHash: result.digest as string };
  return { success: false, error: result.effects?.status?.error ?? 'TX failed' };
}

async function main() {
  const suiClient = getSuiClient();
  const keypair   = loadKeypair();
  const db        = RAILWAY_URL ? postgres(RAILWAY_URL, { ssl: { rejectUnauthorized: false }, max: 1 }) : null;

  INFO(`Watching ${WATCH.length} match(es) — polling every 60 seconds`);
  INFO(`Will settle immediately when ESPN marks match as completed\n`);

  const pending = new Set(WATCH.map(w => w.matchId));

  const poll = async () => {
    for (const w of WATCH) {
      if (!pending.has(w.matchId)) continue;
      const espn = await checkESPN(w.sport, w.eventId).catch(() => null);
      if (!espn) { WARN(`[${w.homeTeam} vs ${w.awayTeam}] ESPN fetch failed`); continue; }

      const ts = new Date().toLocaleTimeString();
      if (!espn.completed) {
        INFO(`[${ts}] ${w.homeTeam} ${espn.homeScore}-${espn.awayScore} ${w.awayTeam} — ${espn.statusName}`);
        continue;
      }

      INFO(`[${ts}] MATCH FINISHED: ${w.homeTeam} ${espn.homeScore}-${espn.awayScore} ${w.awayTeam} → ${espn.winner.toUpperCase()} wins!`);
      const makerWins = w.prediction === espn.winner;
      INFO(`Maker prediction=${w.prediction} → makerWins=${makerWins}`);

      const coinType = w.currency === 'SBETS'
        ? '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS'
        : SUI_COIN;

      const result = await settleBet(suiClient, keypair, w.betId, makerWins, coinType);
      if (result.success) {
        OK(`On-chain settled! TX: ${result.txHash}`);
        OK(`SuiScan: https://suiscan.xyz/mainnet/tx/${result.txHash}`);
        if (db) {
          const matchStatus = makerWins ? 'lost' : 'won';
          await db`UPDATE p2p_bet_matches SET status=${matchStatus}, settlement_tx_hash=${result.txHash!}, settled_at=NOW() WHERE id=${w.matchId}`;
          OK(`DB updated — match ${w.matchId} → ${matchStatus}`);
        }
        pending.delete(w.matchId);
      } else {
        FAIL(`Settle failed: ${result.error?.slice(0, 100)}`);
      }
    }

    if (pending.size > 0) {
      setTimeout(poll, 60_000);
    } else {
      OK('All watched matches settled!');
      if (db) await db.end();
      process.exit(0);
    }
  };

  await poll();
}

main().catch(e => { FAIL(String(e)); process.exit(1); });
