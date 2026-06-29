/**
 * Fantasy WC 2026 server-side scoring worker.
 * Runs every 10 minutes during the tournament window; reads settled_events,
 * recomputes total_points for every locked team, and writes the result to DB.
 * This is the authoritative point source — the client value is just a preview.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';

// ── Player pool (mirrors WorldCupFantasy.tsx PLAYERS — keep in sync) ───────────
type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
interface Player { id: string; country: string; position: Position; }

const PLAYERS: Player[] = [
  { id: 'gk-eng-1', country: 'GB-ENG', position: 'GK' },
  { id: 'gk-fra-1', country: 'FR',     position: 'GK' },
  { id: 'gk-esp-1', country: 'ES',     position: 'GK' },
  { id: 'gk-bra-1', country: 'BR',     position: 'GK' },
  { id: 'gk-arg-1', country: 'AR',     position: 'GK' },
  { id: 'gk-ger-1', country: 'DE',     position: 'GK' },
  { id: 'gk-por-1', country: 'PT',     position: 'GK' },
  { id: 'gk-ned-1', country: 'NL',     position: 'GK' },
  { id: 'gk-mor-1', country: 'MA',     position: 'GK' },
  { id: 'gk-usa-1', country: 'US',     position: 'GK' },
  { id: 'gk-jpn-1', country: 'JP',     position: 'GK' },
  { id: 'gk-hrv-1', country: 'HR',     position: 'GK' },
  { id: 'gk-bel-1', country: 'BE',     position: 'GK' },
  { id: 'gk-col-1', country: 'CO',     position: 'GK' },
  { id: 'gk-ury-1', country: 'UY',     position: 'GK' },
  { id: 'gk-nor-1', country: 'NO',     position: 'GK' },
  { id: 'gk-egy-1', country: 'EG',     position: 'GK' },
  { id: 'gk-mex-1', country: 'MX',     position: 'GK' },
  { id: 'gk-kor-1', country: 'KR',     position: 'GK' },
  { id: 'gk-sui-1', country: 'CH',     position: 'GK' },
  { id: 'gk-sen-1', country: 'SN',     position: 'GK' },
  { id: 'gk-mex-2', country: 'MX',     position: 'GK' },
  { id: 'def-eng-1', country: 'GB-ENG', position: 'DEF' },
  { id: 'def-eng-2', country: 'GB-ENG', position: 'DEF' },
  { id: 'def-eng-3', country: 'GB-ENG', position: 'DEF' },
  { id: 'def-fra-1', country: 'FR',     position: 'DEF' },
  { id: 'def-fra-2', country: 'FR',     position: 'DEF' },
  { id: 'def-fra-3', country: 'FR',     position: 'DEF' },
  { id: 'def-esp-1', country: 'ES',     position: 'DEF' },
  { id: 'def-esp-2', country: 'ES',     position: 'DEF' },
  { id: 'def-esp-3', country: 'ES',     position: 'DEF' },
  { id: 'def-bra-1', country: 'BR',     position: 'DEF' },
  { id: 'def-bra-2', country: 'BR',     position: 'DEF' },
  { id: 'def-arg-1', country: 'AR',     position: 'DEF' },
  { id: 'def-arg-2', country: 'AR',     position: 'DEF' },
  { id: 'def-ger-1', country: 'DE',     position: 'DEF' },
  { id: 'def-ger-2', country: 'DE',     position: 'DEF' },
  { id: 'def-por-1', country: 'PT',     position: 'DEF' },
  { id: 'def-por-2', country: 'PT',     position: 'DEF' },
  { id: 'def-ned-1', country: 'NL',     position: 'DEF' },
  { id: 'def-ned-2', country: 'NL',     position: 'DEF' },
  { id: 'def-mor-1', country: 'MA',     position: 'DEF' },
  { id: 'def-hrv-1', country: 'HR',     position: 'DEF' },
  { id: 'def-bel-1', country: 'BE',     position: 'DEF' },
  { id: 'def-bel-2', country: 'BE',     position: 'DEF' },
  { id: 'def-col-1', country: 'CO',     position: 'DEF' },
  { id: 'def-ury-1', country: 'UY',     position: 'DEF' },
  { id: 'def-nor-1', country: 'NO',     position: 'DEF' },
  { id: 'def-sco-1', country: 'GB-SCT', position: 'DEF' },
  { id: 'def-sui-1', country: 'CH',     position: 'DEF' },
  { id: 'def-jpn-1', country: 'JP',     position: 'DEF' },
  { id: 'def-kor-1', country: 'KR',     position: 'DEF' },
  { id: 'def-tur-1', country: 'TR',     position: 'DEF' },
  { id: 'def-mex-1', country: 'MX',     position: 'DEF' },
  { id: 'def-sen-1', country: 'SN',     position: 'DEF' },
  { id: 'def-aus-1', country: 'AU',     position: 'DEF' },
  { id: 'def-par-1', country: 'PY',     position: 'DEF' },
  { id: 'def-alg-1', country: 'DZ',     position: 'DEF' },
  { id: 'def-aut-1', country: 'AT',     position: 'DEF' },
  { id: 'mid-eng-1', country: 'GB-ENG', position: 'MID' },
  { id: 'mid-eng-2', country: 'GB-ENG', position: 'MID' },
  { id: 'mid-eng-3', country: 'GB-ENG', position: 'MID' },
  { id: 'mid-fra-1', country: 'FR',     position: 'MID' },
  { id: 'mid-fra-2', country: 'FR',     position: 'MID' },
  { id: 'mid-esp-1', country: 'ES',     position: 'MID' },
  { id: 'mid-esp-2', country: 'ES',     position: 'MID' },
  { id: 'mid-esp-3', country: 'ES',     position: 'MID' },
  { id: 'mid-bra-1', country: 'BR',     position: 'MID' },
  { id: 'mid-bra-2', country: 'BR',     position: 'MID' },
  { id: 'mid-arg-1', country: 'AR',     position: 'MID' },
  { id: 'mid-arg-2', country: 'AR',     position: 'MID' },
  { id: 'mid-arg-3', country: 'AR',     position: 'MID' },
  { id: 'mid-ger-1', country: 'DE',     position: 'MID' },
  { id: 'mid-ger-2', country: 'DE',     position: 'MID' },
  { id: 'mid-por-1', country: 'PT',     position: 'MID' },
  { id: 'mid-por-2', country: 'PT',     position: 'MID' },
  { id: 'mid-ned-1', country: 'NL',     position: 'MID' },
  { id: 'mid-ned-2', country: 'NL',     position: 'MID' },
  { id: 'mid-ned-3', country: 'NL',     position: 'MID' },
  { id: 'mid-mor-1', country: 'MA',     position: 'MID' },
  { id: 'mid-mor-2', country: 'MA',     position: 'MID' },
  { id: 'mid-usa-1', country: 'US',     position: 'MID' },
  { id: 'mid-usa-2', country: 'US',     position: 'MID' },
  { id: 'mid-jpn-1', country: 'JP',     position: 'MID' },
  { id: 'mid-jpn-2', country: 'JP',     position: 'MID' },
  { id: 'mid-hrv-1', country: 'HR',     position: 'MID' },
  { id: 'mid-hrv-2', country: 'HR',     position: 'MID' },
  { id: 'mid-bel-1', country: 'BE',     position: 'MID' },
  { id: 'mid-bel-2', country: 'BE',     position: 'MID' },
  { id: 'mid-col-1', country: 'CO',     position: 'MID' },
  { id: 'mid-col-2', country: 'CO',     position: 'MID' },
  { id: 'mid-ury-1', country: 'UY',     position: 'MID' },
  { id: 'mid-nor-1', country: 'NO',     position: 'MID' },
  { id: 'mid-sco-1', country: 'GB-SCT', position: 'MID' },
  { id: 'mid-sui-1', country: 'CH',     position: 'MID' },
  { id: 'mid-kor-1', country: 'KR',     position: 'MID' },
  { id: 'mid-tur-1', country: 'TR',     position: 'MID' },
  { id: 'mid-tur-2', country: 'TR',     position: 'MID' },
  { id: 'mid-mex-1', country: 'MX',     position: 'MID' },
  { id: 'mid-mex-2', country: 'MX',     position: 'MID' },
  { id: 'mid-sen-1', country: 'SN',     position: 'MID' },
  { id: 'mid-sen-2', country: 'SN',     position: 'MID' },
  { id: 'mid-alg-1', country: 'DZ',     position: 'MID' },
  { id: 'mid-aut-1', country: 'AT',     position: 'MID' },
  { id: 'mid-gha-1', country: 'GH',     position: 'MID' },
  { id: 'mid-sau-1', country: 'SA',     position: 'MID' },
  { id: 'mid-aus-1', country: 'AU',     position: 'MID' },
  { id: 'mid-civ-1', country: 'CI',     position: 'MID' },
  { id: 'mid-ecu-1', country: 'EC',     position: 'MID' },
  { id: 'mid-mar-1', country: 'MA',     position: 'MID' },
  { id: 'mid-irq-1', country: 'IQ',     position: 'MID' },
  { id: 'mid-pan-1', country: 'PA',     position: 'MID' },
  { id: 'fwd-eng-1', country: 'GB-ENG', position: 'FWD' },
  { id: 'fwd-eng-2', country: 'GB-ENG', position: 'FWD' },
  { id: 'fwd-fra-1', country: 'FR',     position: 'FWD' },
  { id: 'fwd-fra-2', country: 'FR',     position: 'FWD' },
  { id: 'fwd-fra-3', country: 'FR',     position: 'FWD' },
  { id: 'fwd-esp-1', country: 'ES',     position: 'FWD' },
  { id: 'fwd-esp-2', country: 'ES',     position: 'FWD' },
  { id: 'fwd-esp-3', country: 'ES',     position: 'FWD' },
  { id: 'fwd-bra-1', country: 'BR',     position: 'FWD' },
  { id: 'fwd-bra-2', country: 'BR',     position: 'FWD' },
  { id: 'fwd-bra-3', country: 'BR',     position: 'FWD' },
  { id: 'fwd-bra-4', country: 'BR',     position: 'FWD' },
  { id: 'fwd-arg-1', country: 'AR',     position: 'FWD' },
  { id: 'fwd-arg-2', country: 'AR',     position: 'FWD' },
  { id: 'fwd-ger-1', country: 'DE',     position: 'FWD' },
  { id: 'fwd-ger-2', country: 'DE',     position: 'FWD' },
  { id: 'fwd-por-1', country: 'PT',     position: 'FWD' },
  { id: 'fwd-por-2', country: 'PT',     position: 'FWD' },
  { id: 'fwd-ned-1', country: 'NL',     position: 'FWD' },
  { id: 'fwd-ned-2', country: 'NL',     position: 'FWD' },
  { id: 'fwd-mor-1', country: 'MA',     position: 'FWD' },
  { id: 'fwd-usa-1', country: 'US',     position: 'FWD' },
  { id: 'fwd-jpn-1', country: 'JP',     position: 'FWD' },
  { id: 'fwd-hrv-1', country: 'HR',     position: 'FWD' },
  { id: 'fwd-bel-1', country: 'BE',     position: 'FWD' },
  { id: 'fwd-bel-2', country: 'BE',     position: 'FWD' },
  { id: 'fwd-col-1', country: 'CO',     position: 'FWD' },
  { id: 'fwd-col-2', country: 'CO',     position: 'FWD' },
  { id: 'fwd-ury-1', country: 'UY',     position: 'FWD' },
  { id: 'fwd-nor-1', country: 'NO',     position: 'FWD' },
  { id: 'fwd-sco-1', country: 'GB-SCT', position: 'FWD' },
  { id: 'fwd-sui-1', country: 'CH',     position: 'FWD' },
  { id: 'fwd-kor-1', country: 'KR',     position: 'FWD' },
  { id: 'fwd-tur-1', country: 'TR',     position: 'FWD' },
  { id: 'fwd-tur-2', country: 'TR',     position: 'FWD' },
  { id: 'fwd-mex-1', country: 'MX',     position: 'FWD' },
  { id: 'fwd-sen-1', country: 'SN',     position: 'FWD' },
  { id: 'fwd-egy-1', country: 'EG',     position: 'FWD' },
  { id: 'fwd-alg-1', country: 'DZ',     position: 'FWD' },
  { id: 'fwd-alg-2', country: 'DZ',     position: 'FWD' },
  { id: 'fwd-aut-1', country: 'AT',     position: 'FWD' },
  { id: 'fwd-gha-1', country: 'GH',     position: 'FWD' },
  { id: 'fwd-sau-1', country: 'SA',     position: 'FWD' },
  { id: 'fwd-aus-1', country: 'AU',     position: 'FWD' },
  { id: 'fwd-civ-1', country: 'CI',     position: 'FWD' },
  { id: 'fwd-ecu-1', country: 'EC',     position: 'FWD' },
  { id: 'fwd-ira-1', country: 'IR',     position: 'FWD' },
  { id: 'fwd-par-1', country: 'PY',     position: 'FWD' },
  { id: 'fwd-uzb-1', country: 'UZ',     position: 'FWD' },
  { id: 'fwd-pan-1', country: 'PA',     position: 'FWD' },
  { id: 'fwd-jor-1', country: 'JO',     position: 'FWD' },
  { id: 'fwd-swe-1', country: 'SE',     position: 'FWD' },
  { id: 'fwd-swe-2', country: 'SE',     position: 'FWD' },
  { id: 'fwd-tun-1', country: 'TN',     position: 'FWD' },
];

const PLAYER_MAP = new Map<string, Player>(PLAYERS.map(p => [p.id, p]));

// ── Team name → ISO country code (mirrors WC_TEAM_CODE in routes-simple.ts) ───
const WC_TEAM_CODE: Record<string, string> = {
  'Mexico': 'MX', 'South Africa': 'ZA', 'South Korea': 'KR', 'Korea Republic': 'KR',
  'Czechia': 'CZ', 'Czech Republic': 'CZ',
  'Canada': 'CA', 'Bosnia': 'BA', 'Bosnia and Herzegovina': 'BA', 'Bosnia & Herz.': 'BA',
  'Qatar': 'QA', 'Switzerland': 'CH',
  'Brazil': 'BR', 'Morocco': 'MA', 'Haiti': 'HT', 'Scotland': 'GB-SCT',
  'United States': 'US', 'USA': 'US', 'Paraguay': 'PY', 'Australia': 'AU',
  'Turkey': 'TR', 'Türkiye': 'TR',
  'Germany': 'DE', 'Ivory Coast': 'CI', "Côte d'Ivoire": 'CI', 'Ecuador': 'EC',
  'Curaçao': 'CW', 'Curacao': 'CW',
  'Netherlands': 'NL', 'Holland': 'NL', 'Sweden': 'SE', 'Tunisia': 'TN', 'Japan': 'JP',
  'Belgium': 'BE', 'Egypt': 'EG', 'Iran': 'IR', 'New Zealand': 'NZ',
  'Spain': 'ES', 'Cape Verde': 'CV', 'Saudi Arabia': 'SA', 'Uruguay': 'UY',
  'France': 'FR', 'Senegal': 'SN', 'Iraq': 'IQ', 'Norway': 'NO',
  'Argentina': 'AR', 'Algeria': 'DZ', 'Austria': 'AT', 'Jordan': 'JO',
  'Portugal': 'PT', 'DR Congo': 'CD', 'Congo DR': 'CD', 'Uzbekistan': 'UZ', 'Colombia': 'CO',
  'England': 'GB-ENG', 'Croatia': 'HR', 'Ghana': 'GH', 'Panama': 'PA',
  'Costa Rica': 'CR', 'Serbia': 'RS', 'Ukraine': 'UA', 'Poland': 'PL',
  'Denmark': 'DK', 'Finland': 'FI',
};

// ── Scoring formula (mirrors calcPlayerPoints in WorldCupFantasy.tsx) ──────────
type MatchResult = { win: boolean; draw: boolean; loss: boolean; goalsFor: number; goalsAgainst: number };

function calcPlayerPoints(player: Player, r: MatchResult): number {
  let pts = 0;
  if (r.win)       pts += 3;
  else if (r.draw) pts += 1;
  if (player.position === 'FWD')      pts += r.goalsFor * 4;
  else if (player.position === 'MID') pts += r.goalsFor * 3;
  else if (player.position === 'DEF') pts += r.goalsFor * 1;
  else if (player.position === 'GK')  pts += r.goalsFor * 1;
  if (r.goalsAgainst === 0) {
    if (player.position === 'GK')       pts += 6;
    else if (player.position === 'DEF') pts += 4;
    else if (player.position === 'MID') pts += 1;
  }
  return pts;
}

type Round = { teams: { country: string } & MatchResult };

function computeTeamPoints(starterIds: string[], captainId: string, rounds: Round[]): number {
  let total = 0;
  for (const id of starterIds) {
    if (!id) continue;
    const player = PLAYER_MAP.get(id);
    if (!player) continue;
    let pts = 0;
    for (const round of rounds) {
      const r = round.teams.find(t => t.country === player.country);
      if (r) pts += calcPlayerPoints(player, r);
    }
    total += id === captainId ? pts * 2 : pts;
  }
  return total;
}

// ── Main export: recompute all locked teams from real settled_events ─────────
export async function updateAllFantasyTeamPoints(): Promise<void> {
  const now = Date.now();
  const WC_START = new Date('2026-06-11T00:00:00Z').getTime();
  const WC_END   = new Date('2026-07-20T00:00:00Z').getTime();

  if (now < WC_START || now > WC_END + 7 * 24 * 3600 * 1000) return;

  try {
    const rows = await db.execute(sql`
      SELECT external_event_id, home_team, away_team,
             home_score, away_score, winner, settled_at
      FROM settled_events
      WHERE settled_at >= '2026-06-11'::timestamptz
        AND settled_at  < '2026-07-20'::timestamptz
      ORDER BY settled_at ASC
    `);

    const wcRows = (rows as any[]).filter((r: any) => {
      return !!(WC_TEAM_CODE[r.home_team ?? ''] && WC_TEAM_CODE[r.away_team ?? '']);
    });

    if (wcRows.length === 0) return;

    const rounds: Round[] = wcRows.map((ev: any) => {
      const h = WC_TEAM_CODE[ev.home_team];
      const a = WC_TEAM_CODE[ev.away_team];
      const hg = Number(ev.home_score ?? 0);
      const ag = Number(ev.away_score ?? 0);
      const homeWin = ev.winner === 'home';
      const awayWin = ev.winner === 'away';
      const draw    = ev.winner === 'draw';
      return {
        teams: [
          { country: h, win: homeWin, draw, loss: awayWin, goalsFor: hg, goalsAgainst: ag },
          { country: a, win: awayWin, draw, loss: homeWin, goalsFor: ag, goalsAgainst: hg },
        ],
      };
    });

    const teams = await db.execute(sql`
      SELECT wallet_address, starter_ids, captain_id FROM fantasy_teams WHERE locked = true
    `);

    let updated = 0;
    for (const team of teams as any[]) {
      const starters  = (team.starter_ids  as string[]) || [];
      const captainId = (team.captain_id   as string)   || '';
      const pts = computeTeamPoints(starters, captainId, rounds);
      await db.execute(sql`
        UPDATE fantasy_teams SET total_points = ${pts}, updated_at = NOW()
        WHERE wallet_address = ${team.wallet_address} AND locked = true
          AND total_points != ${pts}
      `);
      updated++;
    }

    if (updated > 0) {
      console.log(`[FantasyScoring] Updated ${updated} teams from ${wcRows.length} WC matches.`);
    }
  } catch (err: any) {
    console.error('[FantasyScoring] Error updating team points:', err.message);
  }
}

// ── Market-specific H2H scoring — used by settlement worker ─────────────────
// Fetches settled WC events from DB and computes the correct market score for
// a given player roster.  For over_under it returns raw total goals; the
// settlement caller must compare against the goalsLine separately.
export async function computeFantasyH2HMarketPoints(
  market: string,
  starterIds: string[],
  captainId: string,
  pickedPlayerId?: string,
): Promise<number> {
  try {
    const rows = await db.execute(sql`
      SELECT home_team, away_team, home_score, away_score, winner
      FROM settled_events
      WHERE settled_at >= '2026-06-11'::timestamptz
        AND settled_at  < '2026-07-20'::timestamptz
      ORDER BY settled_at ASC
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

    const wcRows = (rows as any[]).filter((r: any) =>
      !!(WC_TEAM_CODE[r.home_team ?? ''] && WC_TEAM_CODE[r.away_team ?? ''])
    );

    if (wcRows.length === 0) return 0;

    const rounds: Round[] = wcRows.map((ev: any) => {
      const h  = WC_TEAM_CODE[ev.home_team];
      const a  = WC_TEAM_CODE[ev.away_team];
      const hg = Number(ev.home_score ?? 0);
      const ag = Number(ev.away_score ?? 0);
      const homeWin = ev.winner === 'home';
      const awayWin = ev.winner === 'away';
      const draw    = ev.winner === 'draw';
      return {
        teams: [
          { country: h, win: homeWin, draw, loss: awayWin, goalsFor: hg, goalsAgainst: ag },
          { country: a, win: awayWin, draw, loss: homeWin, goalsFor: ag, goalsAgainst: hg },
        ],
      };
    });

    switch (market) {
      case 'squad_points':
        return computeTeamPoints(starterIds, captainId, rounds);

      case 'captain_duel': {
        const captain = PLAYER_MAP.get(captainId);
        if (!captain) return 0;
        let pts = 0;
        for (const round of rounds) {
          const r = (round.teams as any[]).find((t: any) => t.country === captain.country);
          if (r) pts += calcPlayerPoints(captain, r);
        }
        return pts * 2;
      }

      case 'top_scorer': {
        const player = PLAYER_MAP.get(pickedPlayerId ?? '');
        if (!player) return 0;
        let goals = 0;
        for (const round of rounds) {
          const r = (round.teams as any[]).find((t: any) => t.country === player.country);
          if (r) goals += (r as any).goalsFor;
        }
        return goals;
      }

      case 'clean_sheet_race': {
        let pts = 0;
        for (const id of starterIds) {
          if (!id) continue;
          const player = PLAYER_MAP.get(id);
          if (!player || (player.position !== 'GK' && player.position !== 'DEF')) continue;
          for (const round of rounds) {
            const r = (round.teams as any[]).find((t: any) => t.country === player.country);
            if (r && (r as any).goalsAgainst === 0) {
              pts += player.position === 'GK' ? 6 : 4;
            }
          }
        }
        return pts;
      }

      case 'over_under': {
        const countries = new Set<string>();
        for (const id of starterIds) {
          const player = PLAYER_MAP.get(id);
          if (player) countries.add(player.country);
        }
        let goals = 0;
        for (const round of rounds) {
          for (const t of round.teams as any[]) {
            if (countries.has(t.country)) goals += (t as any).goalsFor;
          }
        }
        return goals;
      }

      case 'fwd_firepower': {
        let pts = 0;
        for (const id of starterIds) {
          const player = PLAYER_MAP.get(id);
          if (!player || player.position !== 'FWD') continue;
          for (const round of rounds) {
            const r = (round.teams as any[]).find((t: any) => t.country === player.country);
            if (r) pts += calcPlayerPoints(player, r);
          }
        }
        return pts;
      }

      case 'engine_room': {
        let pts = 0;
        for (const id of starterIds) {
          const player = PLAYER_MAP.get(id);
          if (!player || player.position !== 'MID') continue;
          for (const round of rounds) {
            const r = (round.teams as any[]).find((t: any) => t.country === player.country);
            if (r) pts += calcPlayerPoints(player, r);
          }
        }
        return pts;
      }

      case 'fortress': {
        let pts = 0;
        for (const id of starterIds) {
          const player = PLAYER_MAP.get(id);
          if (!player || (player.position !== 'GK' && player.position !== 'DEF')) continue;
          for (const round of rounds) {
            const r = (round.teams as any[]).find((t: any) => t.country === player.country);
            if (r) pts += calcPlayerPoints(player, r);
          }
        }
        return pts;
      }

      default:
        return computeTeamPoints(starterIds, captainId, rounds);
    }
  } catch (err: any) {
    console.error(`[FantasyScoring] computeFantasyH2HMarketPoints error (${market}):`, err.message);
    return 0;
  }
}

// ── Scheduler: run every 10 minutes ─────────────────────────────────────────
let _scoringTimer: ReturnType<typeof setInterval> | null = null;

export function startFantasyScoringWorker(): void {
  if (_scoringTimer) return;
  updateAllFantasyTeamPoints().catch(() => {});
  _scoringTimer = setInterval(() => {
    updateAllFantasyTeamPoints().catch(() => {});
  }, 10 * 60 * 1000);
  console.log('[FantasyScoring] Worker started — runs every 10 min during WC 2026 window.');
}
