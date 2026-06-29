import { useSuiClientQuery, useCurrentAccount } from '@/lib/dapp-kit-compat';

const BETTING_PACKAGE_ID = (import.meta.env.VITE_BETTING_PACKAGE_ID || '').trim();

export interface OnChainBetObject {
  objectId: string;
  bettor: string;
  eventId: string;
  marketId: string;
  prediction: string;
  odds: number;
  oddsDisplay: string;
  stake: number;
  stakeDisplay: string;
  potentialPayout: number;
  potentialPayoutDisplay: string;
  status: number;
  statusLabel: 'Pending' | 'Won' | 'Lost' | 'Void';
  statusColor: string;
  coinType: number;
  coinTypeLabel: 'SUI' | 'SBETS' | 'USDSUI';
  placedAt: number;
  deadline: number;
  walrusBlobId?: string;
}

function decodeVectorU8(v: number[]): string {
  try {
    return new TextDecoder().decode(new Uint8Array(v));
  } catch {
    return '';
  }
}

function statusLabel(s: number): 'Pending' | 'Won' | 'Lost' | 'Void' {
  if (s === 1) return 'Won';
  if (s === 2) return 'Lost';
  if (s === 3) return 'Void';
  return 'Pending';
}

function statusColor(s: number): string {
  if (s === 1) return 'text-emerald-400';
  if (s === 2) return 'text-red-400';
  if (s === 3) return 'text-gray-400';
  return 'text-cyan-400';
}

function coinTypeLabel(c: number): 'SUI' | 'SBETS' | 'USDSUI' {
  if (c === 1) return 'SBETS';
  if (c === 2) return 'USDSUI';
  return 'SUI';
}

function coinDecimals(c: number): number {
  if (c === 2) return 6;
  return 9;
}

export function parseBetObject(objectId: string, fields: any): OnChainBetObject | null {
  try {
    const coinTypeNum = Number(fields.coin_type ?? 0);
    const dec = coinDecimals(coinTypeNum);
    const divisor = Math.pow(10, dec);
    const stake = Number(fields.stake ?? 0) / divisor;
    const payout = Number(fields.potential_payout ?? 0) / divisor;
    const odds = Number(fields.odds ?? 0);
    const statusNum = Number(fields.status ?? 0);

    const eventIdRaw = fields.event_id;
    const predictionRaw = fields.prediction;

    const eventId = Array.isArray(eventIdRaw) ? decodeVectorU8(eventIdRaw) : String(eventIdRaw ?? '');
    const prediction = Array.isArray(predictionRaw) ? decodeVectorU8(predictionRaw) : String(predictionRaw ?? '');

    return {
      objectId,
      bettor: fields.bettor ?? '',
      eventId,
      marketId: Array.isArray(fields.market_id) ? decodeVectorU8(fields.market_id) : String(fields.market_id ?? ''),
      prediction,
      odds,
      oddsDisplay: `${(odds / 100).toFixed(2)}x`,
      stake,
      stakeDisplay: `${stake.toFixed(4)} ${coinTypeLabel(coinTypeNum)}`,
      potentialPayout: payout,
      potentialPayoutDisplay: `${payout.toFixed(4)} ${coinTypeLabel(coinTypeNum)}`,
      status: statusNum,
      statusLabel: statusLabel(statusNum),
      statusColor: statusColor(statusNum),
      coinType: coinTypeNum,
      coinTypeLabel: coinTypeLabel(coinTypeNum),
      placedAt: Number(fields.placed_at ?? 0),
      deadline: Number(fields.deadline ?? 0),
      walrusBlobId: Array.isArray(fields.walrus_blob_id)
        ? decodeVectorU8(fields.walrus_blob_id)
        : undefined,
    };
  } catch {
    return null;
  }
}

export function useBetObjects() {
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;

  const { data, isLoading, error, refetch } = useSuiClientQuery(
    'getOwnedObjects',
    {
      owner: walletAddress ?? '',
      filter: {
        StructType: `${BETTING_PACKAGE_ID}::betting::Bet`,
      },
      options: {
        showContent: true,
        showDisplay: true,
      },
    },
    {
      enabled: !!walletAddress,
      refetchInterval: 30000,
    }
  );

  const bets: OnChainBetObject[] = [];
  if (data?.data) {
    for (const item of data.data) {
      const objectId = item.data?.objectId;
      const fields = (item.data?.content as any)?.fields;
      if (objectId && fields) {
        const parsed = parseBetObject(objectId, fields);
        if (parsed) bets.push(parsed);
      }
    }
  }

  bets.sort((a, b) => b.placedAt - a.placedAt);

  return { bets, isLoading, error, refetch, walletAddress };
}
