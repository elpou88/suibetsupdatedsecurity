import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWsOn } from '@/hooks/useWebSocket';
import { Zap } from 'lucide-react';

type TickerItem = {
  id: string;
  wallet: string;
  eventName: string;
  prediction: string;
  odds: number;
  stake: number;
  currency: string;
  kind: 'posted' | 'taken';
  ts: number;
};

function shortWallet(w: string) {
  if (!w || w.length < 10) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function predLabel(pred: string, home: string, away: string) {
  if (pred === 'home') return home;
  if (pred === 'away') return away;
  return 'Draw';
}

export function P2PLiveTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  const { data: recentOffers } = useQuery<any[]>({
    queryKey: ['/api/p2p/offers/ticker'],
    queryFn: () =>
      fetch('/api/p2p/offers?limit=20&status=all')
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!recentOffers || !Array.isArray(recentOffers)) return;
    const mapped: TickerItem[] = recentOffers
      .slice(0, 16)
      .map((o: any) => ({
        id: `offer-${o.id}`,
        wallet: o.creatorWallet ?? '',
        eventName: o.eventName ?? `${o.homeTeam ?? ''} vs ${o.awayTeam ?? ''}`,
        prediction: predLabel(o.prediction ?? '', o.homeTeam ?? '', o.awayTeam ?? ''),
        odds: Number(o.odds ?? 0),
        stake: Number(o.creatorStake ?? 0),
        currency: o.currency ?? 'SUI',
        kind: (o.status === 'filled' || o.status === 'settled') ? 'taken' : 'posted',
        ts: new Date(o.createdAt ?? 0).getTime(),
      }))
      .sort((a, b) => b.ts - a.ts);
    setItems(mapped);
  }, [recentOffers]);

  useWsOn((msg) => {
    if (msg.type !== 'p2p-updates') return;
    const { action, type: kind, data: d } = msg.data ?? {};
    if (!action || !d) return;
    if (action === 'created' && kind === 'offer') {
      setItems(prev => [{
        id: `ws-${Date.now()}`,
        wallet: d.creatorWallet ?? '',
        eventName: d.eventName ?? 'Match',
        prediction: d.prediction ?? '',
        odds: Number(d.odds ?? 0),
        stake: Number(d.stake ?? 0),
        currency: d.currency ?? 'SUI',
        kind: 'posted',
        ts: Date.now(),
      }, ...prev].slice(0, 20));
    }
    if (action === 'accepted' && kind === 'offer') {
      setItems(prev => [{
        id: `ws-acc-${Date.now()}`,
        wallet: d.takerWallet ?? '',
        eventName: d.eventName ?? 'Match',
        prediction: d.prediction ?? '',
        odds: Number(d.odds ?? 0),
        stake: Number(d.stake ?? 0),
        currency: d.currency ?? 'SUI',
        kind: 'taken',
        ts: Date.now(),
      }, ...prev].slice(0, 20));
    }
  });

  if (!items.length) return null;

  const doubled = [...items, ...items];

  return (
    <div className="w-full bg-[#050810] border-b border-cyan-900/25 overflow-hidden relative" style={{ height: 32 }}>
      <style>{`
        @keyframes suibets-ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .p2p-ticker-inner {
          animation: suibets-ticker ${Math.max(doubled.length * 4, 30)}s linear infinite;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          height: 100%;
        }
        .p2p-ticker-inner:hover { animation-play-state: paused; }
      `}</style>

      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center gap-1.5 bg-[#050810] pr-3 pl-2 border-r border-cyan-900/30">
        <Zap size={10} className="text-cyan-400" />
        <span className="text-[10px] text-cyan-400 font-bold tracking-widest uppercase">Live P2P</span>
      </div>

      <div className="pl-24 h-full">
        <div className="p2p-ticker-inner gap-0">
          {doubled.map((item, i) => (
            <span key={`${item.id}-${i}`} className="inline-flex items-center gap-1.5 px-4">
              <span className={`text-[10px] font-mono ${item.kind === 'taken' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                {shortWallet(item.wallet)}
              </span>
              <span className="text-[10px] text-gray-500">
                {item.kind === 'taken' ? 'took' : 'posted'}
              </span>
              <span className="text-[10px] text-white font-mono font-bold">
                {item.stake.toLocaleString(undefined, { maximumFractionDigits: 2 })} {item.currency}
              </span>
              <span className="text-[10px] text-gray-500">on</span>
              <span className="text-[10px] text-gray-300 max-w-[120px] truncate inline-block align-bottom">
                {item.prediction} — {item.eventName}
              </span>
              <span className="text-[10px] text-amber-400 font-mono">@{item.odds.toFixed(2)}</span>
              <span className="text-gray-700 mx-1">·</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
