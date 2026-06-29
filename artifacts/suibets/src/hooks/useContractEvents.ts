import { useQuery } from '@tanstack/react-query';
import { useSuiClient, useCurrentAccount } from '@/lib/dapp-kit-compat';

const BETTING_PACKAGE_ID = (import.meta.env.VITE_BETTING_PACKAGE_ID || '').trim();

function decodeVectorU8(raw: any): string {
  if (!raw) return '';
  try {
    if (Array.isArray(raw)) return new TextDecoder().decode(new Uint8Array(raw));
    if (typeof raw === 'string') return raw;
  } catch { }
  return String(raw);
}

export interface ChainBetPlacedEvent {
  kind: 'BetPlaced';
  betId: string;
  bettor: string;
  eventId: string;
  prediction: string;
  odds: number;
  stake: number;
  potentialPayout: number;
  coinType: number;
  coinTypeLabel: 'SUI' | 'SBETS' | 'USDSUI';
  timestamp: number;
  txDigest: string;
}

export interface ChainBetSettledEvent {
  kind: 'BetSettled';
  betId: string;
  bettor: string;
  status: number;
  statusLabel: 'Won' | 'Lost' | 'Void';
  payout: number;
  coinType: number;
  coinTypeLabel: 'SUI' | 'SBETS' | 'USDSUI';
  timestamp: number;
  txDigest: string;
}

export type ChainEvent = ChainBetPlacedEvent | ChainBetSettledEvent;

function coinLabel(c: number): 'SUI' | 'SBETS' | 'USDSUI' {
  if (c === 1) return 'SBETS';
  if (c === 2) return 'USDSUI';
  return 'SUI';
}

function coinDecimals(c: number) {
  if (c === 2) return 6;
  return 9;
}

function statusLabel(s: number): 'Won' | 'Lost' | 'Void' {
  if (s === 1) return 'Won';
  if (s === 2) return 'Lost';
  return 'Void';
}

function parseBetPlaced(e: any): ChainBetPlacedEvent | null {
  try {
    const f = e.parsedJson;
    const coinType = Number(f.coin_type ?? 0);
    const dec = coinDecimals(coinType);
    return {
      kind: 'BetPlaced',
      betId: f.bet_id,
      bettor: f.bettor,
      eventId: decodeVectorU8(f.event_id),
      prediction: decodeVectorU8(f.prediction),
      odds: Number(f.odds ?? 0),
      stake: Number(f.stake ?? 0) / Math.pow(10, dec),
      potentialPayout: Number(f.potential_payout ?? 0) / Math.pow(10, dec),
      coinType,
      coinTypeLabel: coinLabel(coinType),
      timestamp: Number(f.timestamp ?? 0),
      txDigest: e.id?.txDigest ?? '',
    };
  } catch { return null; }
}

function parseBetSettled(e: any): ChainBetSettledEvent | null {
  try {
    const f = e.parsedJson;
    const coinType = Number(f.coin_type ?? 0);
    const dec = coinDecimals(coinType);
    const status = Number(f.status ?? 0);
    return {
      kind: 'BetSettled',
      betId: f.bet_id,
      bettor: f.bettor,
      status,
      statusLabel: statusLabel(status),
      payout: Number(f.payout ?? 0) / Math.pow(10, dec),
      coinType,
      coinTypeLabel: coinLabel(coinType),
      timestamp: Number(f.timestamp ?? 0),
      txDigest: e.id?.txDigest ?? '',
    };
  } catch { return null; }
}

export function useContractEvents(limit = 50) {
  const suiClient = useSuiClient();

  const { data: placedRaw, isLoading: placedLoading, refetch: refetchPlaced } = useQuery({
    queryKey: ['chain-events-placed', BETTING_PACKAGE_ID, limit],
    queryFn: async () => {
      if (!suiClient?.queryEvents) return { data: [] };
      return suiClient.queryEvents({
        query: { MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced` },
        limit,
        order: 'descending',
      });
    },
    enabled: !!suiClient,
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const { data: settledRaw, isLoading: settledLoading, refetch: refetchSettled } = useQuery({
    queryKey: ['chain-events-settled', BETTING_PACKAGE_ID, limit],
    queryFn: async () => {
      if (!suiClient?.queryEvents) return { data: [] };
      return suiClient.queryEvents({
        query: { MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetSettled` },
        limit,
        order: 'descending',
      });
    },
    enabled: !!suiClient,
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const placed: ChainBetPlacedEvent[] = ((placedRaw as any)?.data ?? [])
    .map(parseBetPlaced)
    .filter(Boolean) as ChainBetPlacedEvent[];

  const settled: ChainBetSettledEvent[] = ((settledRaw as any)?.data ?? [])
    .map(parseBetSettled)
    .filter(Boolean) as ChainBetSettledEvent[];

  const all: ChainEvent[] = [...placed, ...settled].sort(
    (a, b) => b.timestamp - a.timestamp
  );

  const isLoading = placedLoading || settledLoading;

  const refetch = () => { refetchPlaced(); refetchSettled(); };

  return { all, placed, settled, isLoading, refetch };
}

export function useUserContractEvents(limit = 30) {
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;
  const suiClient = useSuiClient();

  const { data: placedRaw, isLoading: placedLoading, refetch: refetchPlaced } = useQuery({
    queryKey: ['chain-events-placed-user', walletAddress, limit],
    queryFn: async () => {
      if (!suiClient?.queryEvents || !walletAddress) return { data: [] };
      return suiClient.queryEvents({
        query: {
          MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced`,
        },
        limit,
        order: 'descending',
      });
    },
    enabled: !!suiClient && !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: settledRaw, isLoading: settledLoading, refetch: refetchSettled } = useQuery({
    queryKey: ['chain-events-settled-user', walletAddress, limit],
    queryFn: async () => {
      if (!suiClient?.queryEvents || !walletAddress) return { data: [] };
      return suiClient.queryEvents({
        query: {
          MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetSettled`,
        },
        limit,
        order: 'descending',
      });
    },
    enabled: !!suiClient && !!walletAddress,
    refetchInterval: 30000,
  });

  const placed: ChainBetPlacedEvent[] = ((placedRaw as any)?.data ?? [])
    .map(parseBetPlaced)
    .filter(Boolean)
    .filter((e: ChainBetPlacedEvent) => e.bettor === walletAddress) as ChainBetPlacedEvent[];

  const settled: ChainBetSettledEvent[] = ((settledRaw as any)?.data ?? [])
    .map(parseBetSettled)
    .filter(Boolean)
    .filter((e: ChainBetSettledEvent) => e.bettor === walletAddress) as ChainBetSettledEvent[];

  const all: ChainEvent[] = [...placed, ...settled].sort((a, b) => b.timestamp - a.timestamp);

  return { all, placed, settled, isLoading: placedLoading || settledLoading, walletAddress,
    refetch: () => { refetchPlaced(); refetchSettled(); } };
}

export function deriveOnChainLeaderboard(settled: ChainBetSettledEvent[]) {
  const map = new Map<string, {
    wallet: string; wins: number; losses: number; voids: number;
    totalPayout: number; totalStakes: number;
  }>();

  for (const e of settled) {
    const existing = map.get(e.bettor) ?? {
      wallet: e.bettor, wins: 0, losses: 0, voids: 0, totalPayout: 0, totalStakes: 0,
    };
    if (e.status === 1) { existing.wins++; existing.totalPayout += e.payout; }
    else if (e.status === 2) existing.losses++;
    else existing.voids++;
    map.set(e.bettor, existing);
  }

  return Array.from(map.values())
    .sort((a, b) => b.wins - a.wins)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}
