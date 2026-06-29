import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Handshake, Zap } from "lucide-react";

interface TapeItem {
  type: "single" | "parlay";
  id: number;
  eventName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  prediction: string | null;
  odds: number;
  creatorStake: number;
  takerStake: number;
  totalPot: number;
  winner: "creator" | "taker" | null;
  creatorWallet: string | null;
  takerWallet: string | null;
  payoutAmount: number | null;
  payoutTxHash: string | null;
  settledAt: string | null;
  legCount: number | null;
  currency?: string;
}

function timeAgo(ts: string | null): string {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncWallet(w: string | null): string {
  if (!w) return "???";
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function formatAmt(n: number, currency: string = "SUI"): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ${currency}`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K ${currency}`;
  return `${n.toFixed(3)} ${currency}`;
}

const CURRENCY_COLOR: Record<string, string> = {
  SUI:    "#06b6d4",
  SBETS:  "#a855f7",
  USDSUI: "#22c55e",
  USDC:   "#2775ca",
  LBTC:   "#f7931a",
};

export default function LiveBetFeed() {
  const { data } = useQuery<{ tape: TapeItem[]; updatedAt: number }>({
    queryKey: ["/api/p2p/settled-tape"],
    queryFn: () => fetch("/api/p2p/settled-tape").then(r => r.json()),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const tape: TapeItem[] = data?.tape ?? [];

  const trackRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const posRef = useRef<number>(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (tape.length === 0) return;
    setReady(true);

    const speed = 0.5;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const el = trackRef.current;
      if (!el) { animRef.current = requestAnimationFrame(tick); return; }
      const half = el.scrollWidth / 2;
      posRef.current += speed * (dt / 16.67);
      if (posRef.current >= half) posRef.current -= half;
      el.style.transform = `translateX(-${posRef.current}px)`;
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [tape.length]);

  if (tape.length === 0) {
    return (
      <div className="w-full py-3 border-t border-cyan-900/20 flex items-center justify-center gap-2">
        <Handshake size={13} className="text-purple-400/60" />
        <span className="text-[11px] text-gray-600">No settled P2P bets yet — be the first!</span>
      </div>
    );
  }

  const doubled = [...tape, ...tape];

  return (
    <div className="w-full border-t border-cyan-900/20" data-testid="live-bet-feed">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
          </span>
          <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider">Recent P2P Settlements</span>
          <Zap size={11} className="text-yellow-400 fill-yellow-400" />
        </div>
        <span className="text-[10px] text-gray-600">{tape.length} settled</span>
      </div>

      <div
        className="relative overflow-hidden pb-3"
        style={{ maskImage: "linear-gradient(to right, transparent, black 4%, black 96%, transparent)" }}
      >
        <div ref={trackRef} className="flex" style={{ gap: "10px", willChange: "transform" }}>
          {doubled.map((item, idx) => {
            const isParlay = item.type === "parlay";
            const currency = item.currency ?? "SUI";
            const currColor = CURRENCY_COLOR[currency] ?? "#06b6d4";
            const winnerWallet = item.winner === "creator" ? item.creatorWallet : item.takerWallet;
            const loserWallet = item.winner === "creator" ? item.takerWallet : item.creatorWallet;
            const matchLabel = isParlay
              ? `${item.legCount ?? "?"}-Leg Parlay`
              : (item.homeTeam && item.awayTeam ? `${item.homeTeam} vs ${item.awayTeam}` : item.eventName ?? "Match");
            const predLabel = isParlay
              ? "Full parlay"
              : (item.prediction ?? "—");
            const pot = item.totalPot;
            const payout = item.payoutAmount ?? (pot * (item.odds || 1) * 0.98);

            return (
              <div
                key={`${item.id}-${idx}`}
                className="flex-shrink-0 flex items-center gap-3 rounded-xl px-3.5 py-2.5 border border-white/[0.05]"
                style={{
                  minWidth: "300px",
                  background: "linear-gradient(135deg, rgba(139,92,246,0.05) 0%, rgba(10,20,30,0.8) 100%)",
                }}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)" }}>
                  {isParlay
                    ? <span className="text-[11px] font-bold text-purple-300">{item.legCount ?? "?"}x</span>
                    : <Trophy size={13} className="text-yellow-400" />}
                </div>

                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white font-semibold truncate max-w-[130px]" title={matchLabel}>
                      {matchLabel}
                    </span>
                    {isParlay && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold uppercase flex-shrink-0">
                        Parlay
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] font-bold" style={{ color: "#22c55e" }}>
                      {truncWallet(winnerWallet)} won
                    </span>
                    <span className="text-[9px] text-gray-600">vs</span>
                    <span className="text-[10px] text-gray-500">{truncWallet(loserWallet)}</span>
                  </div>
                  <div className="text-[9px] text-gray-600 mt-0.5 truncate">{predLabel}</div>
                </div>

                <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                  <span className="text-[11px] font-bold" style={{ color: currColor }}>
                    {formatAmt(pot, currency)}
                  </span>
                  <span className="text-[9px]" style={{ color: "#22c55e" }}>
                    @{item.odds?.toFixed(2)}
                  </span>
                  <span className="text-[9px] text-gray-600">{timeAgo(item.settledAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
