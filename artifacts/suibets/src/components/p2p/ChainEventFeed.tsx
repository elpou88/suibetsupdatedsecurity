/**
 * ChainEventFeed — Real-Time On-Chain Order Book Activity Ticker
 *
 * Listens to `p2p-chain-event` WebSocket messages broadcast by the API server
 * whenever a Sui blockchain event arrives from the P2P contract.
 *
 * Shows a scrolling ticker of recent on-chain activity with:
 *  - Event type badge (OfferPosted / Filled / Settled / Cancelled)
 *  - Amount + currency
 *  - Relative timestamp
 *  - "CHAIN LIVE" indicator with Sui logo pulse
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWsOn } from '@/hooks/useWebSocket';
import { Activity, Zap, TrendingUp, XCircle, CheckCircle2, Clock } from 'lucide-react';

interface ChainEvent {
  id:        string;
  eventType: string;
  ts:        number;
  offerId?:  string;
  eventName?: string;
  currency?: string;
  makerStake?: number;
  odds?:      number;
  prediction?: string;
  fillAmount?: number;
  matchId?:   number;
  actualPayout?: number;
  winner?:    string;
  txDigest?:  string;
}

const EVENT_META: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
  OfferPosted:  { label: 'New Offer',  color: 'text-cyan-400',   bg: 'bg-cyan-950/60 border-cyan-500/30',   Icon: TrendingUp   },
  OfferFilled:  { label: 'Matched',    color: 'text-green-400',  bg: 'bg-green-950/60 border-green-500/30', Icon: Zap          },
  BetSettled:   { label: 'Settled',    color: 'text-yellow-400', bg: 'bg-yellow-950/60 border-yellow-500/30', Icon: CheckCircle2 },
  BetVoided:    { label: 'Voided',     color: 'text-gray-400',   bg: 'bg-gray-900/60 border-gray-600/30',   Icon: XCircle      },
  OfferCancelled:{ label: 'Cancelled', color: 'text-red-400',    bg: 'bg-red-950/60 border-red-500/30',     Icon: XCircle      },
  OfferExpired: { label: 'Expired',    color: 'text-orange-400', bg: 'bg-orange-950/60 border-orange-500/30', Icon: Clock      },
  ParlaySettled:{ label: 'Parlay Won', color: 'text-purple-400', bg: 'bg-purple-950/60 border-purple-500/30', Icon: CheckCircle2 },
  ParlayVoided: { label: 'Parlay Void',color: 'text-gray-400',   bg: 'bg-gray-900/60 border-gray-600/30',   Icon: XCircle      },
};

const DEFAULT_META = { label: 'Chain Event', color: 'text-blue-400', bg: 'bg-blue-950/60 border-blue-500/30', Icon: Activity };

function formatAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5)  return 'just now';
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function formatAmount(amount: number | undefined, currency: string | undefined): string {
  if (!amount || !currency) return '';
  const fmt = amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2);
  return `${fmt} ${currency}`;
}

function eventSummary(ev: ChainEvent): string {
  switch (ev.eventType) {
    case 'OfferPosted':
      return [
        ev.eventName && `${ev.eventName.slice(0, 28)}`,
        ev.makerStake && ev.currency && `${ev.makerStake.toFixed(2)} ${ev.currency}`,
        ev.odds && `@${ev.odds}x`,
      ].filter(Boolean).join(' · ');

    case 'OfferFilled':
      return [
        ev.eventName && `${ev.eventName.slice(0, 28)}`,
        ev.fillAmount && ev.currency && `${ev.fillAmount.toFixed(2)} ${ev.currency} matched`,
      ].filter(Boolean).join(' · ');

    case 'BetSettled':
    case 'ParlaySettled':
      return [
        ev.actualPayout && ev.currency ? `${ev.actualPayout.toFixed(2)} ${ev.currency} paid out` : 'Bet settled',
      ].filter(Boolean).join(' · ');

    case 'BetVoided':
    case 'ParlayVoided':
      return 'Stakes refunded';

    case 'OfferCancelled':
      return 'Offer cancelled on-chain';

    case 'OfferExpired':
      return 'Offer expired on-chain';

    default:
      return ev.eventType;
  }
}

interface ChainEventFeedProps {
  maxItems?: number;
  compact?: boolean;
}

export function ChainEventFeed({ maxItems = 12, compact = false }: ChainEventFeedProps) {
  const [events, setEvents]     = useState<ChainEvent[]>([]);
  const [isLive, setIsLive]     = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashLive = useCallback(() => {
    setIsLive(true);
    setPulseKey(k => k + 1);
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setIsLive(false), 8_000);
  }, []);

  useWsOn((msg) => {
    if (msg.type !== 'p2p-chain-event') return;
    const ev: ChainEvent = {
      id:        `${msg.data.eventType}-${msg.ts ?? Date.now()}-${Math.random()}`,
      eventType: msg.data.eventType ?? 'Unknown',
      ts:        msg.ts ?? Date.now(),
      ...msg.data,
    };
    setEvents(prev => [ev, ...prev].slice(0, maxItems));
    flashLive();
  });

  // Relative-time ticker: update every 15s
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(k => k + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Scroll new events into view
  useEffect(() => {
    if (listRef.current && events.length > 0) {
      listRef.current.scrollTop = 0;
    }
  }, [events.length]);

  if (compact) {
    // Compact inline indicator strip for embedding in order-book header
    return (
      <div className="flex items-center gap-2">
        <span
          className={`flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-full border transition-all duration-300 ${
            isLive
              ? 'bg-green-950/80 border-green-500/60 text-green-300'
              : 'bg-gray-900/60 border-gray-700/40 text-gray-500'
          }`}
        >
          <span
            key={pulseKey}
            className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-400 animate-ping' : 'bg-gray-600'}`}
          />
          {isLive ? 'CHAIN LIVE' : 'CHAIN'}
        </span>
        {events.length > 0 && (
          <span className="text-xs text-gray-500">{events.length} event{events.length !== 1 ? 's' : ''}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-gray-300 tracking-wide uppercase">
            On-Chain Activity
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            key={`pulse-${pulseKey}`}
            className={`w-2 h-2 rounded-full transition-colors duration-500 ${
              isLive ? 'bg-green-400 animate-ping' : 'bg-gray-600'
            }`}
          />
          <span className={`text-[10px] font-mono tracking-widest uppercase ${isLive ? 'text-green-400' : 'text-gray-600'}`}>
            {isLive ? 'LIVE' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* Event list */}
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-1.5 p-2 min-h-0">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="w-8 h-8 text-gray-700 mb-2" />
            <p className="text-xs text-gray-600">Waiting for on-chain events…</p>
            <p className="text-[10px] text-gray-700 mt-1">Activity appears here the moment it hits the Sui blockchain</p>
          </div>
        ) : (
          events.map((ev) => {
            const meta = EVENT_META[ev.eventType] ?? DEFAULT_META;
            const { label, color, bg, Icon } = meta;
            return (
              <div
                key={ev.id}
                className={`flex items-start gap-2 p-2 rounded-lg border text-xs transition-all duration-200 ${bg}`}
              >
                <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`font-semibold ${color}`}>{label}</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-500 text-[10px]">{formatAgo(ev.ts)}</span>
                  </div>
                  <p className="text-gray-400 leading-tight truncate">
                    {eventSummary(ev)}
                  </p>
                  {ev.txDigest && (
                    <a
                      href={`https://suiscan.xyz/mainnet/tx/${ev.txDigest}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-gray-600 hover:text-cyan-500 transition-colors"
                    >
                      {ev.txDigest.slice(0, 12)}…
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
