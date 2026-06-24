import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ExternalLink, TrendingUp, Zap, Info } from 'lucide-react';

const CURRENCIES = ['SUI', 'SBETS', 'USDSUI', 'USDC'] as const;

type ClobEvent = {
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  sportName?: string;
  leagueName?: string;
  matchDate?: string;
};

type Level = {
  price: number;
  quantity: number;
  count: number;
  odds: number;
};

type ClobBook = {
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  currency: string;
  bids: Level[];
  asks: Level[];
  draw: Level[];
  bestBid: number | null;
  bestAsk: number | null;
  overround: number | null;
  totalBidDepth: number;
  totalAskDepth: number;
  offerCount: number;
  timestamp: string;
};

function fmtQty(n: number, currency: string) {
  if (currency === 'USDSUI' || currency === 'USDC') {
    return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
  }
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(1);
}

function pct(p: number) {
  return `${(p * 100).toFixed(1)}%`;
}

function oddsLabel(p: number) {
  const o = 1 / p;
  return o.toFixed(2) + 'x';
}

function DepthBar({ ratio, side }: { ratio: number; side: 'bid' | 'ask' | 'draw' }) {
  const color =
    side === 'bid'  ? 'rgba(74,222,128,0.25)' :
    side === 'ask'  ? 'rgba(249,115,22,0.22)' :
                     'rgba(96,165,250,0.2)';
  return (
    <div className="absolute inset-y-0 right-0 pointer-events-none rounded-sm"
      style={{ width: `${Math.min(ratio * 100, 100)}%`, background: color }} />
  );
}

export function P2PClobBook({ onNavigateToOffers }: { onNavigateToOffers?: (eventId: string) => void }) {
  const [currency, setCurrency]     = useState<string>('SUI');
  const [selectedEvent, setSelectedEvent] = useState<string>('');
  const [tick, setTick] = useState(0);

  const { data: events = [], isLoading: eventsLoading } = useQuery<ClobEvent[]>({
    queryKey: ['/api/p2p/clob', currency, tick],
    queryFn: () =>
      fetch(`/api/p2p/clob?currency=${currency}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!selectedEvent && events.length > 0) setSelectedEvent(events[0].eventId);
  }, [events, selectedEvent]);

  const { data: book, isLoading: bookLoading, dataUpdatedAt } = useQuery<ClobBook>({
    queryKey: ['/api/p2p/clob', selectedEvent, currency, tick],
    queryFn: () =>
      fetch(`/api/p2p/clob/${encodeURIComponent(selectedEvent)}?currency=${currency}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    enabled: !!selectedEvent,
    refetchInterval: 8000,
  });

  const maxBidQty = book?.bids.length ? Math.max(...book.bids.map(l => l.quantity)) : 1;
  const maxAskQty = book?.asks.length ? Math.max(...book.asks.map(l => l.quantity)) : 1;
  const maxDrawQty = book?.draw.length ? Math.max(...book.draw.map(l => l.quantity)) : 1;

  const selectedEventInfo = events.find(e => e.eventId === selectedEvent);
  const updatedAgo = dataUpdatedAt ? Math.round((Date.now() - dataUpdatedAt) / 1000) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(0,200,150,0.06) 0%, rgba(0,120,255,0.05) 100%)', border: '1px solid rgba(0,200,150,0.15)' }}>
        <div className="px-4 py-3 flex items-center justify-between border-b"
          style={{ borderColor: 'rgba(0,200,150,0.12)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base"
              style={{ background: 'rgba(0,200,150,0.12)', border: '1px solid rgba(0,200,150,0.2)' }}>📊</div>
            <div>
              <div className="text-white font-black text-sm tracking-wide">P2P Outcome Book</div>
              <div className="text-[10px] font-bold" style={{ color: 'rgba(0,200,150,0.7)' }}>Price = Implied Probability · DeepBook-compatible format</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setTick(t => t + 1)}
              className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-white"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <RefreshCw size={11} className={bookLoading ? 'animate-spin' : ''} />
            </button>
            {updatedAgo !== null && (
              <span className="text-[10px] text-gray-600">{updatedAgo}s ago</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="px-4 py-2.5 flex flex-wrap gap-2 items-center border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {/* Event selector */}
          <div className="flex-1 min-w-[180px]">
            {eventsLoading ? (
              <div className="h-8 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
            ) : events.length === 0 ? (
              <div className="text-xs text-gray-500 italic py-1.5">No open offers in {currency}</div>
            ) : (
              <select
                value={selectedEvent}
                onChange={e => setSelectedEvent(e.target.value)}
                className="w-full text-xs font-bold rounded-lg px-2.5 py-1.5 outline-none transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
              >
                {events.map(ev => (
                  <option key={ev.eventId} value={ev.eventId} style={{ background: '#1a2030' }}>
                    {ev.homeTeam} vs {ev.awayTeam}
                    {ev.leagueName ? ` · ${ev.leagueName}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Currency */}
          <div className="flex gap-1">
            {CURRENCIES.map(c => (
              <button key={c} onClick={() => { setCurrency(c); setSelectedEvent(''); }}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all"
                style={currency === c
                  ? { background: 'rgba(0,200,150,0.2)', border: '1px solid rgba(0,200,150,0.4)', color: 'rgb(0,200,150)' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#6b7280' }
                }>{c}</button>
            ))}
          </div>
        </div>

        {/* Stats bar */}
        {book && (
          <div className="px-4 py-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
            <span className="text-gray-500">Event: <span className="text-gray-300 font-bold">{book.offerCount} open offers</span></span>
            <span className="text-gray-500">Bid depth: <span className="text-green-400 font-bold">{fmtQty(book.totalBidDepth, currency)} {currency}</span></span>
            <span className="text-gray-500">Ask depth: <span className="text-orange-400 font-bold">{fmtQty(book.totalAskDepth, currency)} {currency}</span></span>
            {book.overround !== null && (
              <span className="text-gray-500">Market efficiency:
                <span className={`font-bold ml-1 ${Math.abs(book.overround) < 5 ? 'text-green-400' : Math.abs(book.overround) < 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {book.overround > 0 ? '+' : ''}{book.overround.toFixed(1)}%
                </span>
                <span className="text-gray-600 ml-1">{Math.abs(book.overround) < 3 ? '(efficient)' : Math.abs(book.overround) < 10 ? '(slight overround)' : '(wide spread)'}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Order Book */}
      {!selectedEvent || eventsLoading ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          {eventsLoading ? 'Loading markets…' : 'Select a currency to see open markets'}
        </div>
      ) : bookLoading && !book ? (
        <div className="rounded-xl p-8 text-center text-gray-600 text-sm animate-pulse"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          Loading order book…
        </div>
      ) : !book || book.offerCount === 0 ? (
        <div className="rounded-xl p-8 text-center text-gray-600 text-sm"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          No open offers for this event in {currency}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden"
          style={{ background: '#0a0f1a', border: '1px solid rgba(255,255,255,0.07)' }}>
          {/* Match header */}
          <div className="px-4 py-2.5 flex items-center justify-between"
            style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2">
              <span className="text-white font-black text-sm">{book.homeTeam}</span>
              <span className="text-gray-600 text-xs font-bold">vs</span>
              <span className="text-white font-black text-sm">{book.awayTeam}</span>
            </div>
            {selectedEventInfo?.leagueName && (
              <span className="text-[10px] text-gray-500 font-bold">{selectedEventInfo.leagueName}</span>
            )}
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-2 text-[10px] font-black tracking-wider"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-3 py-2 flex justify-between items-center"
              style={{ background: 'rgba(74,222,128,0.04)', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-green-400">🔵 {book.homeTeam.split(' ').slice(-1)[0].toUpperCase()} BIDS</span>
              <span className="text-gray-600">PROB · STAKE</span>
            </div>
            <div className="px-3 py-2 flex justify-between items-center"
              style={{ background: 'rgba(249,115,22,0.04)' }}>
              <span className="text-gray-600">STAKE · PROB</span>
              <span className="text-orange-400">{book.awayTeam.split(' ').slice(-1)[0].toUpperCase()} ASKS 🔴</span>
            </div>
          </div>

          {/* Levels */}
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {Array.from({ length: Math.max(book.bids.length, book.asks.length, 1) }).map((_, i) => {
              const bid = book.bids[i];
              const ask = book.asks[i];
              return (
                <div key={i} className="grid grid-cols-2 h-8 text-xs">
                  {/* Bid side (home) */}
                  <div className="relative flex items-center px-3 justify-between"
                    style={{ borderRight: '1px solid rgba(255,255,255,0.04)' }}>
                    {bid ? (
                      <>
                        <DepthBar ratio={bid.quantity / maxBidQty} side="bid" />
                        <span className="relative font-black tabular-nums" style={{ color: 'rgb(74,222,128)' }}>
                          {pct(bid.price)}
                        </span>
                        <div className="relative flex items-center gap-2">
                          <span className="text-gray-400 tabular-nums">{fmtQty(bid.quantity, currency)}</span>
                          <span className="text-[9px] text-gray-600">{oddsLabel(bid.price)}</span>
                          <span className="text-[9px] text-gray-700 hidden sm:inline">×{bid.count}</span>
                        </div>
                      </>
                    ) : (
                      <span className="text-gray-800 text-[10px] w-full text-center">—</span>
                    )}
                  </div>

                  {/* Ask side (away) */}
                  <div className="relative flex items-center px-3 justify-between">
                    {ask ? (
                      <>
                        <DepthBar ratio={ask.quantity / maxAskQty} side="ask" />
                        <div className="relative flex items-center gap-2">
                          <span className="text-[9px] text-gray-700 hidden sm:inline">×{ask.count}</span>
                          <span className="text-[9px] text-gray-600">{oddsLabel(ask.price)}</span>
                          <span className="text-gray-400 tabular-nums">{fmtQty(ask.quantity, currency)}</span>
                        </div>
                        <span className="relative font-black tabular-nums" style={{ color: 'rgb(249,115,22)' }}>
                          {pct(ask.price)}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-800 text-[10px] w-full text-center">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Draw levels */}
          {book.draw.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-black text-blue-400 tracking-wider"
                style={{ background: 'rgba(96,165,250,0.04)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                DRAW
              </div>
              {book.draw.map((lvl, i) => (
                <div key={i} className="relative flex items-center px-3 h-7 justify-between text-xs"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <DepthBar ratio={lvl.quantity / maxDrawQty} side="draw" />
                  <span className="relative font-black tabular-nums text-blue-400">{pct(lvl.price)}</span>
                  <div className="relative flex items-center gap-2">
                    <span className="text-gray-400 tabular-nums">{fmtQty(lvl.quantity, currency)}</span>
                    <span className="text-[9px] text-gray-600">{oddsLabel(lvl.price)}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Spread / mid row */}
          {(book.bestBid !== null || book.bestAsk !== null) && (
            <div className="px-3 py-2 flex items-center justify-center gap-4 text-[10px] font-bold"
              style={{ background: 'rgba(255,255,255,0.025)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {book.bestBid !== null && (
                <span className="text-gray-500">Best bid: <span className="text-green-400">{pct(book.bestBid)}</span> ({oddsLabel(book.bestBid)})</span>
              )}
              <span className="text-gray-700">·</span>
              {book.bestAsk !== null && (
                <span className="text-gray-500">Best ask: <span className="text-orange-400">{pct(book.bestAsk)}</span> ({oddsLabel(book.bestAsk)})</span>
              )}
            </div>
          )}

          {/* Accept CTA */}
          <div className="px-3 py-3 flex items-center justify-between"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
            <div className="text-[10px] text-gray-600">
              <span className="text-green-400 font-bold">Bid</span> = back home ·{' '}
              <span className="text-orange-400 font-bold">Ask</span> = back away ·{' '}
              Price = implied win probability
            </div>
            <button
              onClick={() => onNavigateToOffers?.(book.eventId)}
              className="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg transition-all text-black"
              style={{ background: 'linear-gradient(135deg,#00c896,#00a07a)', boxShadow: '0 0 10px rgba(0,200,150,0.3)' }}
            >
              <Zap size={11} /> Take a Position
            </button>
          </div>
        </div>
      )}

      {/* DeepBook bridge info */}
      <div className="rounded-xl p-3 flex gap-3"
        style={{ background: 'rgba(29,78,216,0.06)', border: '1px solid rgba(29,78,216,0.2)' }}>
        <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-[11px] text-gray-400 leading-relaxed">
          <span className="text-blue-300 font-bold">DeepBook bridge: </span>
          This order book uses the same data format as DeepBook v3 (price, quantity, depth levels).
          When SBETS lists on DeepBook mainnet, P2P offers will port directly as on-chain limit orders —
          visible to every wallet, bot, and DeFi protocol on Sui. No migration needed.
          <a href="https://deepbook.sui.io" target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 ml-1 inline-flex items-center gap-0.5 transition-colors">
            DeepBook docs <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </div>
  );
}
