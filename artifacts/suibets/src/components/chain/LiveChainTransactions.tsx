/**
 * LiveChainTransactions — Real-time on-chain activity feed for all 3 engines.
 *
 * Polls /api/chain/live-transactions every 8 s (pure HTTP, no WebSocket).
 * Works on Railway, Replit, Vercel, or any deployment that runs the API server.
 *
 * Shows P2P · WARP · FLUX · PULSE transactions with SuiScan links.
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Activity, Zap, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChainTx {
  id: string;
  engine: 'P2P' | 'WARP' | 'FLUX' | 'PULSE';
  color: 'cyan' | 'purple' | 'orange' | 'green';
  txDigest: string;
  eventName: string;
  label: string;
  detail: string;
  ts: number;
  suiscanUrl: string;
  suivisionUrl: string;
}

const ENGINE_STYLES: Record<string, { badge: string; dot: string; label: string }> = {
  P2P:   { badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',    dot: 'bg-cyan-400',   label: 'P2P' },
  WARP:  { badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40', dot: 'bg-purple-400', label: 'WARP' },
  FLUX:  { badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40', dot: 'bg-orange-400', label: 'FLUX' },
  PULSE: { badge: 'bg-green-500/20 text-green-300 border-green-500/40',  dot: 'bg-green-400',  label: 'PULSE' },
};


function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function shortDigest(d: string): string {
  if (!d) return '—';
  return `${d.slice(0, 6)}…${d.slice(-4)}`;
}


interface Props {
  maxItems?: number;
  compact?: boolean;
  engines?: string[];
}

export function LiveChainTransactions({ maxItems = 20, compact = false, engines }: Props) {
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [newIds, setNewIds]   = useState<Set<string>>(new Set());
  const prevTxIds = useRef<Set<string>>(new Set());
  const [, setTick] = useState(0);

  const { data, isLoading, isError, dataUpdatedAt } = useQuery<{ ok: boolean; transactions: ChainTx[]; fetchedAt: number }>({
    queryKey: ['/api/chain/live-transactions'],
    queryFn: async () => {
      const r = await fetch('/api/chain/live-transactions');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 8_000,
    staleTime: 5_000,
    retry: 3,
  });

  const allTxs: ChainTx[] = (data?.transactions ?? []).filter(tx =>
    !engines || engines.includes(tx.engine)
  ).slice(0, maxItems);

  useEffect(() => {
    if (!allTxs.length) return;
    const incoming = new Set(allTxs.map(t => t.id));
    const fresh = new Set([...incoming].filter(id => !prevTxIds.current.has(id)));
    if (fresh.size > 0) {
      setNewIds(fresh);
      prevTxIds.current = incoming;
      setTimeout(() => setNewIds(new Set()), 3_000);
    }
    setSeenIds(incoming);
  }, [dataUpdatedAt]);

  useEffect(() => {
    const t = setInterval(() => setTick(k => k + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const isLive = !isLoading && !isError && allTxs.length > 0;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-full border transition-all ${
          isLive ? 'bg-green-950/80 border-green-500/50 text-green-300' : 'bg-gray-900/60 border-gray-700/40 text-gray-500'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-400 animate-ping' : 'bg-gray-600'}`} />
          {isLive ? 'CHAIN LIVE' : 'CHAIN'}
        </span>
        {isLive && <span className="text-xs text-gray-500">{allTxs.length} txs</span>}
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-gray-800/60 bg-gray-950/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white tracking-wide">Live On-Chain Activity</span>
          <div className="flex items-center gap-1 ml-1">
            {['P2P','WARP','FLUX','PULSE'].map(e => {
              const s = ENGINE_STYLES[e];
              return (
                <span key={e} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${s.badge}`}>{e}</span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="text-[10px] text-gray-500 animate-pulse">fetching…</span>
          )}
          <span className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            isLive ? 'bg-green-950/60 border-green-500/40 text-green-400' : 'bg-gray-900/60 border-gray-700/40 text-gray-600'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-400 animate-ping' : 'bg-gray-600'}`} />
            {isLive ? 'LIVE' : 'CONNECTING'}
          </span>
        </div>
      </div>

      {/* Transaction list */}
      <div className="divide-y divide-gray-800/40 max-h-[420px] overflow-y-auto">
        <AnimatePresence initial={false}>
          {allTxs.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Zap className="w-8 h-8 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Fetching on-chain activity…</p>
              <p className="text-xs text-gray-700 mt-1">Transactions appear within seconds of hitting the Sui blockchain</p>
            </div>
          )}

          {allTxs.map((tx) => {
            const style = ENGINE_STYLES[tx.engine] ?? ENGINE_STYLES.P2P;
            const isNew = newIds.has(tx.id);

            return (
              <motion.div
                key={tx.id}
                initial={{ opacity: 0, y: -8, backgroundColor: 'rgba(0,255,200,0.08)' }}
                animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }}
                transition={{ duration: 0.4 }}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-900/40 transition-colors group ${
                  isNew ? 'ring-1 ring-cyan-500/20' : ''
                }`}
              >
                {/* Engine dot */}
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot} ${isNew ? 'animate-ping' : ''}`} />

                {/* Engine badge */}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${style.badge}`}>
                  {style.label}
                </span>

                {/* Event name + detail */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-200 truncate">{tx.label || tx.eventName}</span>
                    {tx.detail && (
                      <span className="text-[10px] text-gray-400 flex-shrink-0 truncate max-w-[160px]">{tx.detail}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-mono text-gray-600">{shortDigest(tx.txDigest)}</span>
                    <span className="text-[10px] text-gray-700">{timeAgo(tx.ts)}</span>
                  </div>
                </div>

                {/* Links */}
                <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={tx.suiscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-cyan-400 transition-colors px-1.5 py-0.5 rounded bg-gray-800/60 hover:bg-gray-800"
                    title="View on SuiScan"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    <span>SuiScan</span>
                  </a>
                  <a
                    href={tx.suivisionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-purple-400 transition-colors px-1.5 py-0.5 rounded bg-gray-800/60 hover:bg-gray-800"
                    title="View on SuiVision"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    <span>Vision</span>
                  </a>
                </div>

                <ChevronRight className="w-3 h-3 text-gray-700 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Footer */}
      {allTxs.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800/40 flex items-center justify-between">
          <span className="text-[10px] text-gray-600">
            {allTxs.length} recent txs · refreshes every 8s
          </span>
          <a
            href={`https://suivision.xyz/package/0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-600 hover:text-purple-400 flex items-center gap-1 transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            View on SuiVision
          </a>
        </div>
      )}
    </div>
  );
}

export default LiveChainTransactions;
