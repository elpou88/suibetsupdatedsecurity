/**
 * suiRandomService.ts
 *
 * Wraps the sui::random shared object (0x8) for two purposes:
 *
 *  1. INFO — exposes the current randomness epoch / round so the frontend can
 *     display that on-chain VRF is available.
 *
 *  2. DRAW TIEBREAKER — given a settled match that ended in a draw where
 *     neither player bet on 'draw', produces a provably-fair winner selection:
 *
 *       seed   = sha256( randomnessRound ‖ offerId ‖ matchId )
 *       winner = seed[0] & 1 → 0 = creator wins, 1 = taker wins
 *
 *     The randomnessRound comes from Sui validators' BLS threshold signatures
 *     (drand-like).  Anyone can replay the hash to verify the result.
 *     No Move contract change needed — this is a pure-compute service.
 *
 * Nothing is written on-chain here.  Read-only.
 */

import { getSuiClient } from '../lib/suiRpcConfig';
import crypto from 'node:crypto';

export const SUI_RANDOM_OBJECT_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000008';

export type RandomInfo = {
  randomObjectId: string;
  epoch: number | null;
  randomnessRound: number | null;
  version: string;
  dataType: string;
  description: string;
  useCases: string[];
};

// 30-second cache — the random beacon updates each epoch (~24 h on mainnet)
let _cache: { data: RandomInfo; expiresAt: number } | null = null;

export async function getSuiRandomInfo(): Promise<RandomInfo> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.data;

  const client = getSuiClient() as any;

  let epoch: number | null = null;
  let randomnessRound: number | null = null;
  let version = 'unknown';
  let dataType = '0x2::random::Random';

  try {
    const obj = await client.getObject({
      id: SUI_RANDOM_OBJECT_ID,
      options: { showContent: true, showType: true },
    });

    version  = String(obj?.data?.version ?? 'unknown');
    dataType = (obj?.data?.content as any)?.type ?? dataType;

    const inner = (obj?.data?.content as any)?.fields?.inner?.fields;
    if (inner) {
      epoch           = inner.epoch           != null ? Number(inner.epoch)           : null;
      randomnessRound = inner.randomness_round != null ? Number(inner.randomness_round) : null;
    }
  } catch (e: any) {
    console.warn('[SuiRandom] Failed to read random object:', e?.message);
  }

  const info: RandomInfo = {
    randomObjectId: SUI_RANDOM_OBJECT_ID,
    epoch,
    randomnessRound,
    version,
    dataType,
    description:
      'sui::random is Sui\'s native on-chain VRF powered by validators\' BLS threshold ' +
      'signatures. Each epoch the randomness_round advances and validators collectively ' +
      'produce an unpredictable, unbiasable random seed that anyone can verify.',
    useCases: [
      'Draw tiebreakers — coin-flip when no side bet on \'draw\'',
      'Featured offer ordering — verifiably unbiased homepage curation',
      'Future: bonus jackpot draws tied to weekly volume',
    ],
  };

  _cache = { data: info, expiresAt: Date.now() + 30_000 };
  return info;
}

// ── Draw tiebreaker ───────────────────────────────────────────────────────────

export type DrawResolution = {
  winner: 'creator' | 'taker';
  seed: string;
  randomnessRound: number | null;
  offerId: number;
  matchId: number | null;
  explanation: string;
};

/**
 * Provably-fair draw tiebreaker.
 *
 * We hash( randomnessRound ‖ offerId ‖ matchId ) with SHA-256.
 * The lowest bit of the first byte determines the winner:
 *   0 → creator wins  |  1 → taker wins
 *
 * Anyone can reproduce this by:
 *   echo -n "<round>:<offerId>:<matchId>" | sha256sum
 */
export async function resolveDrawFair(
  offerId: number,
  matchId: number | null,
): Promise<DrawResolution> {
  const randomInfo = await getSuiRandomInfo();
  const round = randomInfo.randomnessRound ?? 0;

  const preimage = `${round}:${offerId}:${matchId ?? 0}`;
  const seed     = crypto.createHash('sha256').update(preimage).digest('hex');
  const winner   = parseInt(seed[0], 16) % 2 === 0 ? 'creator' : 'taker';

  return {
    winner,
    seed,
    randomnessRound: randomInfo.randomnessRound,
    offerId,
    matchId,
    explanation:
      `SHA-256("${preimage}") = 0x${seed.slice(0, 16)}… ` +
      `→ first nibble = ${parseInt(seed[0], 16)} (${parseInt(seed[0], 16) % 2 === 0 ? 'even → creator' : 'odd → taker'})`,
  };
}

// ── Provably-fair offer ordering ──────────────────────────────────────────────

/**
 * Returns a stable, verifiable shuffle index for a list of offer IDs.
 * seed = SHA-256(randomnessRound ‖ "offers")
 * Each offer gets score = SHA-256(seed ‖ offerId) → sorted ascending.
 * The admin cannot influence the order without controlling Sui validators.
 */
export async function getVerifiableOfferOrder(offerIds: number[]): Promise<{
  orderedIds: number[];
  randomnessRound: number | null;
  seed: string;
}> {
  const randomInfo = await getSuiRandomInfo();
  const round = randomInfo.randomnessRound ?? 0;

  const rootSeed = crypto
    .createHash('sha256')
    .update(`${round}:offers`)
    .digest('hex');

  const scored = offerIds.map(id => ({
    id,
    score: crypto.createHash('sha256').update(`${rootSeed}:${id}`).digest('hex'),
  }));

  scored.sort((a, b) => a.score.localeCompare(b.score));

  return {
    orderedIds: scored.map(s => s.id),
    randomnessRound: randomInfo.randomnessRound,
    seed: rootSeed,
  };
}
