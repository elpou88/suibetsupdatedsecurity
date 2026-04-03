import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Zap, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface LiveBet {
  id: string;
  wallet: string;
  amount: string;
  currency: string;
  team: string;
  odds: string;
  sport: string;
  timestamp: number;
  isParlay?: boolean;
  legCount?: number;
  status?: string;
}

const SPORT_EMOJIS: Record<string, string> = {
  soccer: "⚽", football: "⚽", basketball: "🏀", tennis: "🎾",
  baseball: "⚾", hockey: "🏒", "ice-hockey": "🏒", mma: "🥊",
  boxing: "🥊", esports: "🎮", cricket: "🏏", rugby: "🏉",
  volleyball: "🏐", handball: "🤾", afl: "🏈", "american-football": "🏈",
  "formula-1": "🏎️", "horse-racing": "🐎",
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncateTeam(team: string, maxLen: number = 28): string {
  if (!team || team.length <= maxLen) return team;
  return team.slice(0, maxLen) + "…";
}

export default function LiveBetFeed() {
  const [displayBets, setDisplayBets] = useState<LiveBet[]>([]);

  const { data: recentBets } = useQuery<LiveBet[]>({
    queryKey: ["/api/bets/recent-feed"],
    refetchInterval: 12000,
    staleTime: 8000,
  });

  useEffect(() => {
    if (recentBets && recentBets.length > 0) {
      setDisplayBets(recentBets.slice(0, 10));
    }
  }, [recentBets]);

  if (!displayBets || displayBets.length === 0) return null;

  const doubled = [...displayBets, ...displayBets];
  const itemWidth = 320;
  const gap = 12;
  const totalWidth = displayBets.length * (itemWidth + gap);

  return (
    <div className="w-full py-4 border-t border-cyan-900/20" data-testid="live-bet-feed">
      <div className="flex items-center justify-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
        <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Live Bets</span>
        <Zap size={12} className="text-yellow-400 fill-yellow-400" />
      </div>

      <div
        className="relative overflow-hidden"
        style={{ maskImage: "linear-gradient(to right, transparent, black 3%, black 97%, transparent)" }}
      >
        <motion.div
          className="flex"
          style={{ gap: `${gap}px` }}
          animate={{ x: [0, -totalWidth] }}
          transition={{ duration: displayBets.length * 5, repeat: Infinity, ease: "linear" }}
        >
          {doubled.map((bet, idx) => {
            const emoji = SPORT_EMOJIS[bet.sport?.toLowerCase()] || "🎯";
            const isSbets = bet.currency === "SBETS";

            return (
              <div
                key={`${bet.id}-${idx}`}
                className="flex-shrink-0 flex items-center gap-2.5 bg-[#0a1a1e] border border-cyan-900/30 rounded-xl px-4 py-2.5"
                style={{ minWidth: `${itemWidth}px` }}
                data-testid={`live-bet-${bet.id}-${idx}`}
              >
                <span className="text-base">{emoji}</span>

                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-500 font-mono">{bet.wallet}</span>
                    {bet.isParlay && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-semibold uppercase">
                        {bet.legCount || 0}x Parlay
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-sm font-bold ${isSbets ? "text-yellow-400" : "text-cyan-400"}`}>
                      {bet.amount} {bet.currency}
                    </span>
                    <span className="text-gray-600 text-xs">on</span>
                    <span className="text-white text-xs font-medium truncate max-w-[120px]">
                      {truncateTeam(bet.team)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end ml-auto">
                  <span className="text-yellow-400 text-xs font-bold">@{bet.odds}</span>
                  <span className="text-[10px] text-gray-600">{timeAgo(bet.timestamp)}</span>
                </div>

                {bet.status === "won" || bet.status === "paid_out" ? (
                  <Trophy size={14} className="text-green-400 ml-1" />
                ) : null}
              </div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
