import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ExternalLink, RefreshCw } from 'lucide-react';

type Offer = {
  id: number;
  odds: number;
  creatorStake: number;
  takerStake: number;
  filledStake: number;
  currency: string;
  status: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  onchainOfferId?: string;
  expiresAt: string;
  createdAt: string;
};

type BookLevel = {
  odds: number;
  amount: number;
  total: number;
  depth: number;
  count: number;
  markets: Array<{ homeTeam: string; awayTeam: string; prediction: string; eventName: string }>;
};

const CURRENCIES = ['SUI', 'SBETS', 'USDSUI', 'USDC', 'LBTC'] as const;

function fmt(n: number, curr: string) {
  if (curr === 'USDSUI' || curr === 'USDC') return n.toFixed(2);
  if (curr === 'LBTC') return n.toFixed(8);
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(2);
}

type Props = {
  compact?: boolean;
  offers?: Offer[];
  onAccept?: () => void;
};

export function P2POrderBook({ compact = false, offers: passedOffers, onAccept }: Props) {
  const [, setLocation] = useLocation();
  const [currency, setCurrency] = useState<string>('SUI');
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [optimisticOffers, setOptimisticOffers] = useState<Offer[]>([]);

  const { data: fetchedOffers = [], isLoading, refetch } = useQuery<Offer[]>({
    queryKey: ['/api/p2p/offers', 'orderbook-widget', lastRefresh],
    queryFn: () =>
      fetch('/api/p2p/offers?status=open')
        .then(r => r.ok ? r.json() : [])
        .then(d => Array.isArray(d) ? d : [])
        .catch(() => []),
    enabled: !passedOffers,
    refetchInterval: 15000,
    staleTime: 0,
  });

  // Drop optimistic entries that have now landed in the real fetch
  useEffect(() => {
    if (optimisticOffers.length === 0) return;
    const fetchedIds = new Set(fetchedOffers.map(o => o.id));
    setOptimisticOffers(prev => prev.filter(o => !fetchedIds.has(o.id)));
  }, [fetchedOffers]);

  const handleOfferCreated = useCallback((e: Event) => {
    const offer = (e as CustomEvent).detail as Offer | undefined;
    if (offer?.id) {
      // Inject instantly — no network wait
      setOptimisticOffers(prev => {
        if (prev.some(o => o.id === offer.id)) return prev;
        return [offer, ...prev];
      });
    }
    // Background sync to confirm
    setLastRefresh(Date.now());
    refetch();
  }, [refetch]);

  useEffect(() => {
    window.addEventListener('p2p-offer-created', handleOfferCreated);
    return () => window.removeEventListener('p2p-offer-created', handleOfferCreated);
  }, [handleOfferCreated]);

  // Merge: optimistic first, then real (deduplicated)
  const fetchedIds = new Set(fetchedOffers.map(o => o.id));
  const allOffers: Offer[] = passedOffers ?? [
    ...optimisticOffers.filter(o => !fetchedIds.has(o.id)),
    ...fetchedOffers,
  ];
  const now = Date.now();

  const filtered = useMemo(() =>
    allOffers.filter(o =>
      o.currency === currency &&
      (o.status === 'open' || o.status === 'partial') &&
      new Date(o.expiresAt).getTime() > now
    ),
    [allOffers, currency, now]
  );

  const grouped = useMemo(() => {
    const map = new Map<number, { amount: number; count: number; markets: Array<{ homeTeam: string; awayTeam: string; prediction: string; eventName: string }> }>();
    for (const o of filtered) {
      const key = Math.round(o.odds * 100) / 100;
      const remaining = Math.max(0, (o.takerStake ?? 0) - (o.filledStake ?? 0));
      const ex = map.get(key) ?? { amount: 0, count: 0, markets: [] };
      const already = ex.markets.some(m => m.eventName === o.eventName && m.prediction === o.prediction);
      if (!already && ex.markets.length < 3) {
        ex.markets.push({ homeTeam: o.homeTeam, awayTeam: o.awayTeam, prediction: o.prediction, eventName: o.eventName });
      }
      map.set(key, { amount: ex.amount + remaining, count: ex.count + 1, markets: ex.markets });
    }
    return map;
  }, [filtered]);

  const sortedLevels = useMemo(() =>
    Array.from(grouped.entries())
      .map(([odds, d]) => ({ odds, ...d }))
      .sort((a, b) => a.odds - b.odds),
    [grouped]
  );

  const midIdx = Math.floor(sortedLevels.length / 2);
  const midLevel = sortedLevels[midIdx];

  const maxAmount = Math.max(...sortedLevels.map(l => l.amount), 0.01);

  const asksRaw = sortedLevels.slice(midIdx + (sortedLevels.length > 1 ? 1 : 0));
  const bidsRaw = sortedLevels.slice(0, midIdx);

  const ROWS = compact ? 6 : 8;

  const asksLevels: BookLevel[] = (() => {
    let cum = 0;
    return [...asksRaw].reverse().slice(0, ROWS).map(l => {
      cum += l.amount;
      return { odds: l.odds, amount: l.amount, total: cum, depth: Math.min(100, (l.amount / maxAmount) * 100), count: l.count, markets: l.markets };
    });
  })();

  const bidsLevels: BookLevel[] = (() => {
    let cum = 0;
    return [...bidsRaw].reverse().slice(0, ROWS).map(l => {
      cum += l.amount;
      return { odds: l.odds, amount: l.amount, total: cum, depth: Math.min(100, (l.amount / maxAmount) * 100), count: l.count, markets: l.markets };
    });
  })();

  const totalBid = bidsRaw.reduce((s, l) => s + l.amount, 0);
  const totalAsk = asksRaw.reduce((s, l) => s + l.amount, 0);
  const totalAll = totalBid + totalAsk + (midLevel?.amount ?? 0);
  const bidPct = totalAll > 0 ? (totalBid / totalAll) * 100 : 50;
  const askPct = 100 - bidPct;

  const loading = isLoading && !passedOffers;

  const goToP2P = () => setLocation('/p2p');

  const colHdr = 'text-[10px] font-semibold text-gray-500 uppercase tracking-wider';

  return (
    <div
      className="flex flex-col select-none"
      style={{
        background: '#070c16',
        border: '1px solid rgba(0,255,255,0.12)',
        borderRadius: 14,
        overflow: 'hidden',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,255,255,0.03)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-black tracking-tight"
            style={{ color: '#00ffff', textShadow: '0 0 8px rgba(0,255,255,0.4)' }}
          >
            P2P Order Book
          </span>
          {loading && (
            <RefreshCw size={10} className="animate-spin text-cyan-500/60" />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Currency tabs */}
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {CURRENCIES.map(c => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className="text-[10px] font-bold px-2 py-1 transition-all"
                style={{
                  background: currency === c
                    ? 'linear-gradient(135deg, rgba(0,255,255,0.18), rgba(0,180,220,0.12))'
                    : 'transparent',
                  color: currency === c ? '#00ffff' : 'rgba(156,163,175,0.7)',
                  borderRight: c !== 'LBTC' ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}
              >
                {c}
              </button>
            ))}
          </div>
          {!passedOffers && (
            <button
              onClick={() => { setLastRefresh(Date.now()); refetch(); }}
              className="p-1 rounded-md transition-all text-gray-600 hover:text-cyan-400"
              style={{ background: 'rgba(255,255,255,0.04)' }}
              title="Refresh"
            >
              <RefreshCw size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid px-3 py-1.5"
        style={{ gridTemplateColumns: '1fr 1.6fr 1fr 1fr', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <span className={colHdr}>Odds</span>
        <span className={colHdr}>Market</span>
        <span className={`${colHdr} text-right`}>Avail.</span>
        <span className={`${colHdr} text-right`}>Cumul.</span>
      </div>

      {/* Ask rows — higher odds (red, top) */}
      <div className="flex flex-col-reverse">
        {loading ? (
          Array.from({ length: ROWS }).map((_, i) => (
            <div key={i} className="grid px-3 py-[5px] animate-pulse"
              style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="h-3 w-12 rounded bg-red-900/20" />
              <div className="h-3 w-10 rounded bg-gray-800 ml-auto" />
              <div className="h-3 w-10 rounded bg-gray-800 ml-auto" />
            </div>
          ))
        ) : asksLevels.length === 0 ? (
          <div className="text-center py-4 text-gray-700 text-[10px]">— no asks —</div>
        ) : (
          asksLevels.map(row => {
            const topMkt = row.markets[0];
            const mktLabel = topMkt
              ? `${topMkt.homeTeam} vs ${topMkt.awayTeam}`
              : '';
            const extraMkts = row.markets.length - 1;
            return (
              <button
                key={row.odds}
                className="relative grid px-3 py-[5px] transition-all w-full text-left group"
                style={{ gridTemplateColumns: '1fr 1.6fr 1fr 1fr' }}
                onClick={onAccept ? onAccept : goToP2P}
                title={`${row.count} offer${row.count !== 1 ? 's' : ''} at ${row.odds.toFixed(2)}x${mktLabel ? ` · ${mktLabel}` : ''}`}
              >
                <div
                  className="absolute inset-y-0 right-0 pointer-events-none"
                  style={{ width: `${row.depth}%`, background: 'rgba(239,68,68,0.07)', transition: 'width 0.4s ease' }}
                />
                <span className="relative font-bold text-xs group-hover:brightness-125" style={{ color: '#f87171' }}>
                  {row.odds.toFixed(2)}x
                </span>
                <span className="relative text-[10px] text-gray-500 truncate pr-1">
                  {mktLabel
                    ? <>{mktLabel}{extraMkts > 0 && <span className="text-gray-700"> +{extraMkts}</span>}</>
                    : <span className="text-gray-700">—</span>
                  }
                </span>
                <span className="relative text-xs text-right text-gray-300">{fmt(row.amount, currency)}</span>
                <span className="relative text-xs text-right text-gray-500">{fmt(row.total, currency)}</span>
              </button>
            );
          })
        )}
      </div>

      {/* Mid price */}
      {!loading && (
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{
            borderTop: '1px solid rgba(239,68,68,0.15)',
            borderBottom: '1px solid rgba(74,222,128,0.15)',
            background: 'rgba(0,255,255,0.04)',
          }}
        >
          {sortedLevels.length === 0 ? (
            <span className="text-gray-600 text-xs w-full text-center">No open offers for {currency}</span>
          ) : (
            <>
              <span
                className="text-sm font-black"
                style={{ color: '#00ffff', textShadow: '0 0 10px rgba(0,255,255,0.5)' }}
              >
                {midLevel ? `${midLevel.odds.toFixed(2)}x` : '—'}
              </span>
              <span className="text-[10px] text-gray-600">
                {sortedLevels.length} level{sortedLevels.length !== 1 ? 's' : ''}
                {' · '}
                {filtered.length} offer{filtered.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={goToP2P}
                className="flex items-center gap-1 text-[10px] font-semibold transition-all text-cyan-600 hover:text-cyan-400"
              >
                View all <ExternalLink size={9} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Bid rows — lower odds (green, bottom) */}
      <div className="flex flex-col">
        {loading ? (
          Array.from({ length: ROWS }).map((_, i) => (
            <div key={i} className="grid px-3 py-[5px] animate-pulse"
              style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="h-3 w-12 rounded bg-green-900/20" />
              <div className="h-3 w-10 rounded bg-gray-800 ml-auto" />
              <div className="h-3 w-10 rounded bg-gray-800 ml-auto" />
            </div>
          ))
        ) : bidsLevels.length === 0 && sortedLevels.length > 0 ? (
          <div className="text-center py-4 text-gray-700 text-[10px]">— no bids —</div>
        ) : (
          bidsLevels.map(row => {
            const topMkt = row.markets[0];
            const mktLabel = topMkt ? `${topMkt.homeTeam} vs ${topMkt.awayTeam}` : '';
            const extraMkts = row.markets.length - 1;
            return (
              <button
                key={row.odds}
                className="relative grid px-3 py-[5px] transition-all w-full text-left group"
                style={{ gridTemplateColumns: '1fr 1.6fr 1fr 1fr' }}
                onClick={onAccept ? onAccept : goToP2P}
                title={`${row.count} offer${row.count !== 1 ? 's' : ''} at ${row.odds.toFixed(2)}x${mktLabel ? ` · ${mktLabel}` : ''}`}
              >
                <div
                  className="absolute inset-y-0 right-0 pointer-events-none"
                  style={{ width: `${row.depth}%`, background: 'rgba(74,222,128,0.07)', transition: 'width 0.4s ease' }}
                />
                <span className="relative font-bold text-xs group-hover:brightness-125" style={{ color: '#4ade80' }}>
                  {row.odds.toFixed(2)}x
                </span>
                <span className="relative text-[10px] text-gray-500 truncate pr-1">
                  {mktLabel
                    ? <>{mktLabel}{extraMkts > 0 && <span className="text-gray-700"> +{extraMkts}</span>}</>
                    : <span className="text-gray-700">—</span>
                  }
                </span>
                <span className="relative text-xs text-right text-gray-300">{fmt(row.amount, currency)}</span>
                <span className="relative text-xs text-right text-gray-500">{fmt(row.total, currency)}</span>
              </button>
            );
          })
        )}
      </div>

      {/* Back / Lay ratio bar */}
      {!loading && totalAll > 0 && (
        <div
          className="flex overflow-hidden text-[10px] font-bold"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.05)',
            height: 22,
          }}
        >
          <div
            className="flex items-center justify-start pl-2 transition-all duration-700 text-green-900"
            style={{
              width: `${bidPct}%`,
              background: 'linear-gradient(90deg, rgba(74,222,128,0.18), rgba(74,222,128,0.10))',
              color: '#4ade80',
              minWidth: bidPct > 8 ? undefined : 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {bidPct >= 12 && `L ${bidPct.toFixed(0)}%`}
          </div>
          <div
            className="flex items-center justify-end pr-2 transition-all duration-700"
            style={{
              width: `${askPct}%`,
              background: 'linear-gradient(90deg, rgba(239,68,68,0.10), rgba(239,68,68,0.18))',
              color: '#f87171',
              minWidth: askPct > 8 ? undefined : 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {askPct >= 12 && `H ${askPct.toFixed(0)}%`}
          </div>
        </div>
      )}

      {/* Empty state CTA */}
      {!loading && sortedLevels.length === 0 && (
        <div className="px-4 py-5 text-center">
          <div className="text-2xl mb-2">📭</div>
          <div className="text-gray-500 text-xs font-semibold mb-0.5">No open {currency} offers</div>
          <div className="text-gray-700 text-[10px] mb-3">Be the first to post a bet</div>
          <button
            onClick={goToP2P}
            className="text-xs font-bold px-4 py-1.5 rounded-lg transition-all text-black"
            style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)', boxShadow: '0 0 12px rgba(0,255,255,0.3)' }}
          >
            Go to P2P Hub
          </button>
        </div>
      )}
    </div>
  );
}
