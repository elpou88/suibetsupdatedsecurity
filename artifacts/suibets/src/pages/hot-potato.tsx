import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { Transaction } from "@mysten/sui/transactions";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Timer, Users, Trophy, ChevronLeft, Zap, Shield, Crown, ArrowRight, Bomb, HandMetal, Coins, TrendingUp, Sparkles, Target, AlertTriangle, CircleDot, Crosshair, Activity } from "lucide-react";
import { motion } from "framer-motion";
import Footer from "@/components/layout/Footer";

const SBETS_TOKEN_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const ADMIN_WALLET = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';

interface HotPotatoGame {
  id: number;
  gameObjectId: string | null;
  eventId: string;
  teamA: string;
  teamB: string;
  sportName: string | null;
  leagueName: string | null;
  matchTime: string | null;
  potAmount: number;
  currency: string;
  minGrabAmount: number;
  currentHolder: string | null;
  holderTeam: number;
  grabCount: number;
  playerCount: number;
  status: string;
  timerDurationMs: number;
  explosionTimeMs: string | null;
  gameDeadlineMs: string | null;
  createdBy: string | null;
  createdAt: string;
  winningTeam: number | null;
}

interface GrabEntry {
  id: number;
  wallet: string;
  amount: number;
  teamChosen: number;
  grabNumber: number;
  timerAtGrab: number | null;
  potAfterGrab: number | null;
  createdAt: string;
}

function formatSBETS(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "0";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}

function shortenWallet(w: string | null): string {
  if (!w) return "---";
  return `${w.slice(0, 6)}...${w.slice(-4)}`;
}

function CountdownTimer({ explosionTimeMs, status }: { explosionTimeMs: string | null; status: string }) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (status !== "active" || !explosionTimeMs) {
      setTimeLeft(0);
      return;
    }

    const updateTimer = () => {
      const left = parseInt(explosionTimeMs) - Date.now();
      setTimeLeft(Math.max(0, left));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [explosionTimeMs, status]);

  if (status !== "active") return null;

  if (!explosionTimeMs) {
    return (
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/60 mb-2 font-medium" data-testid="text-timer-label">Timer Status</div>
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 2.5 }}
          className="text-xl font-bold text-cyan-300"
          data-testid="text-countdown"
        >
          Waiting for first grab
        </motion.div>
        <div className="text-xs mt-2 text-gray-500">Timer starts when someone grabs the potato</div>
      </div>
    );
  }

  const seconds = Math.floor(timeLeft / 1000);
  const ms = Math.floor((timeLeft % 1000) / 100);
  const isUrgent = timeLeft < 10000;
  const isCritical = timeLeft < 5000;

  return (
    <motion.div
      animate={isCritical ? { scale: [1, 1.03, 1] } : {}}
      transition={{ repeat: Infinity, duration: 0.5 }}
      className="text-center"
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/60 mb-2 font-medium" data-testid="text-timer-label">
        {isCritical ? "CRITICAL" : "Time Until Explosion"}
      </div>
      <div className={`text-5xl font-mono font-bold tabular-nums ${
        isCritical ? "text-red-400 drop-shadow-[0_0_20px_rgba(248,113,113,0.5)]" 
        : isUrgent ? "text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.4)]" 
        : "text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]"
      }`} data-testid="text-countdown">
        {seconds}.{ms}s
      </div>
      {isCritical && (
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 0.3 }}
          className="text-xs mt-2 text-red-400 font-bold uppercase tracking-wider"
        >
          ABOUT TO EXPLODE!
        </motion.div>
      )}
    </motion.div>
  );
}

function GameCard({ game, onSelect }: { game: HotPotatoGame; onSelect: (id: number) => void }) {
  const isActive = game.status === "active";
  const isExploded = game.status === "exploded";

  return (
    <motion.div
      whileHover={{ scale: 1.015, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(game.id)}
      className={`cursor-pointer rounded-2xl border p-5 transition-all relative overflow-hidden group ${
        isActive
          ? "border-cyan-500/20 bg-gradient-to-br from-[#0c1524] via-[#0e1220] to-[#0a0e17] hover:border-cyan-400/40 shadow-lg shadow-cyan-900/10"
          : isExploded
          ? "border-red-500/20 bg-gradient-to-br from-red-950/10 to-[#0a0e17]"
          : "border-gray-700/20 bg-[#0c1018] opacity-70"
      }`}
      data-testid={`card-game-${game.id}`}
    >
      {isActive && (
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] to-transparent pointer-events-none" />
      )}
      
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] text-cyan-400/50 font-medium uppercase tracking-wider mb-1">{game.leagueName || game.sportName || "Sports"}</div>
            <div className="font-bold text-white text-sm">{game.teamA} vs {game.teamB}</div>
          </div>
          {isActive ? (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
              <Activity className="w-3 h-3" /> LIVE
            </span>
          ) : isExploded ? (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
              <Bomb className="w-3 h-3" /> EXPLODED
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              SETTLED
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-cyan-500/[0.06] rounded-xl py-2.5 border border-cyan-500/10">
            <div className="text-lg font-bold text-cyan-400" data-testid={`text-pot-${game.id}`}>{formatSBETS(game.potAmount)}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">SBETS Pot</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl py-2.5 border border-gray-800/30">
            <div className="text-lg font-bold text-white">{game.grabCount}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Grabs</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl py-2.5 border border-gray-800/30">
            <div className="text-lg font-bold text-white">{game.playerCount}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Players</div>
          </div>
        </div>

        {isActive && (
          <div className="mt-4 pt-3 border-t border-cyan-500/10">
            <CountdownTimer explosionTimeMs={game.explosionTimeMs} status={game.status} />
          </div>
        )}

        {isActive && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-cyan-400/60 text-xs font-medium group-hover:text-cyan-400 transition-colors">
            <span>View Game</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function GameDetail({ gameId, onBack }: { gameId: number; onBack: () => void }) {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { toast } = useToast();
  const [grabAmount, setGrabAmount] = useState("1000");
  const [selectedTeam, setSelectedTeam] = useState<number | null>(0);
  const [isGrabbing, setIsGrabbing] = useState(false);

  const { data: game, isLoading } = useQuery<HotPotatoGame>({
    queryKey: ["/api/hot-potato/games", gameId],
    queryFn: async () => {
      const res = await fetch(`/api/hot-potato/games/${gameId}`);
      if (!res.ok) throw new Error('Failed to fetch game');
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: grabs } = useQuery<GrabEntry[]>({
    queryKey: ["/api/hot-potato/games", gameId, "grabs"],
    queryFn: async () => {
      const res = await fetch(`/api/hot-potato/games/${gameId}/grabs`);
      if (!res.ok) throw new Error('Failed to fetch grabs');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const handleGrab = useCallback(async (amount: number, teamChosen: number) => {
    if (!account?.address) {
      toast({ title: "Connect Wallet", description: "Please connect your wallet to play", variant: "destructive" });
      return;
    }
    setIsGrabbing(true);
    try {
      const amountMist = BigInt(Math.floor(amount * 1_000_000_000));

      const sbetsCoins = await suiClient.getCoins({
        owner: account.address,
        coinType: SBETS_TOKEN_TYPE,
      });

      if (!sbetsCoins.data || sbetsCoins.data.length === 0) {
        throw new Error('No SBETS tokens found in your wallet');
      }

      const totalSbets = sbetsCoins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
      if (totalSbets < amountMist) {
        throw new Error(`Insufficient SBETS. Need ${amount.toLocaleString()} but have ${Number(totalSbets / 1_000_000_000n).toLocaleString()}`);
      }

      const tx = new Transaction();
      tx.setGasBudget(20_000_000);

      const primaryCoin = tx.object(sbetsCoins.data[0].coinObjectId);
      if (sbetsCoins.data.length > 1) {
        const otherCoins = sbetsCoins.data.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(primaryCoin, otherCoins);
      }
      const [stakeCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(amountMist)]);

      tx.transferObjects([stakeCoin], tx.pure.address(ADMIN_WALLET));

      toast({ title: "Approve in Wallet", description: `Sending ${amount.toLocaleString()} SBETS to grab the potato...` });

      const result = await signAndExecute({ transaction: tx });
      const txDigest = result.digest;

      await suiClient.waitForTransaction({ digest: txDigest });

      toast({ title: "Transaction Confirmed!", description: "Recording your grab..." });

      let saved = false;
      for (let retry = 0; retry < 3; retry++) {
        try {
          const res = await fetch(`/api/hot-potato/games/${gameId}/grab`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet: account.address,
              amount,
              teamChosen,
              txHash: txDigest,
            }),
          });
          if (res.ok) {
            saved = true;
            break;
          }
          const err = await res.json();
          if (err.exploded) {
            toast({ title: "Game Exploded!", description: "The potato exploded before your grab landed!", variant: "destructive" });
            saved = true;
            break;
          }
        } catch (e) {
          if (retry < 2) await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (saved) {
        queryClient.invalidateQueries({ queryKey: ["/api/hot-potato/games", gameId] });
        queryClient.invalidateQueries({ queryKey: ["/api/hot-potato/games", gameId, "grabs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/hot-potato/games"] });
        toast({ title: "Potato Grabbed!", description: "You're now holding the hot potato!" });
        setGrabAmount("1000");
        setSelectedTeam(0);
      }
    } catch (err: any) {
      const msg = err.message || "Transaction failed";
      if (msg.includes("rejected") || msg.includes("denied")) {
        toast({ title: "Cancelled", description: "Transaction was cancelled in your wallet" });
      } else {
        toast({ title: "Grab Failed", description: msg, variant: "destructive" });
      }
    }
    setIsGrabbing(false);
  }, [account, suiClient, signAndExecute, gameId, toast]);

  const grabMutation = { isPending: isGrabbing };

  if (isLoading || !game) {
    return (
      <div className="flex items-center justify-center h-64">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
          <CircleDot className="w-8 h-8 text-cyan-400" />
        </motion.div>
      </div>
    );
  }

  const isActive = game.status === "active";
  const isHolder = account?.address && game.currentHolder?.toLowerCase() === account.address.toLowerCase();
  const canGrab = isActive && account?.address && !isHolder && selectedTeam !== null && parseFloat(grabAmount) >= game.minGrabAmount;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-2 text-cyan-400/60 hover:text-cyan-400 transition font-medium text-sm" data-testid="button-back">
        <ChevronLeft className="w-4 h-4" /> Back to Games
      </button>

      <div className="rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-[#0c1524] via-[#0e1220] to-[#0a0e17] p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500" />
        
        <div className="flex justify-between items-start mb-6 pt-2">
          <div>
            <div className="text-[10px] text-cyan-400/50 font-medium uppercase tracking-wider mb-1">{game.leagueName || game.sportName}</div>
            <h2 className="text-2xl font-bold text-white">{game.teamA} vs {game.teamB}</h2>
          </div>
          {isActive ? (
            <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1.5">
              <Activity className="w-4 h-4" /> LIVE
            </span>
          ) : (
            <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              game.status === "exploded" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            }`}>
              {game.status === "exploded" ? "EXPLODED" : "SETTLED"}
            </span>
          )}
        </div>

        <div className="mb-6 py-5 px-6 rounded-2xl bg-[#070b12] border border-cyan-500/10">
          <CountdownTimer explosionTimeMs={game.explosionTimeMs} status={game.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-cyan-500/[0.06] rounded-xl p-3 text-center border border-cyan-500/10">
            <Coins className="w-5 h-5 mx-auto mb-1 text-cyan-400" />
            <div className="text-xl font-bold text-cyan-400" data-testid="text-pot-total">{formatSBETS(game.potAmount)}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Total Pot</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 text-center border border-gray-800/30">
            <HandMetal className="w-5 h-5 mx-auto mb-1 text-blue-400" />
            <div className="text-xl font-bold text-white">{game.grabCount}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Total Grabs</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 text-center border border-gray-800/30">
            <Users className="w-5 h-5 mx-auto mb-1 text-blue-400" />
            <div className="text-xl font-bold text-white">{game.playerCount}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Players</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 text-center border border-gray-800/30">
            <Timer className="w-5 h-5 mx-auto mb-1 text-cyan-400/70" />
            <div className="text-xl font-bold text-white">{Math.round(game.timerDurationMs / 1000)}s</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Fuse Length</div>
          </div>
        </div>

        <div className="bg-[#070b12] rounded-xl p-4 mb-6 border border-cyan-500/10">
          <div className="text-[10px] text-cyan-400/50 mb-3 flex items-center gap-1.5 font-medium uppercase tracking-wider">
            <Crown className="w-3.5 h-3.5 text-cyan-400" /> Current Holder
          </div>
          {game.currentHolder ? (
            <div className="flex items-center justify-between">
              <div>
                <div className={`font-mono font-bold text-lg ${isHolder ? "text-cyan-400" : "text-white"}`} data-testid="text-holder">
                  {isHolder ? "YOU!" : shortenWallet(game.currentHolder)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Betting on: <span className={game.holderTeam === 0 ? "text-blue-400 font-bold" : "text-red-400 font-bold"}>
                    {game.holderTeam === 0 ? game.teamA : game.teamB}
                  </span>
                </div>
              </div>
              {isHolder && (
                <motion.div
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                >
                  <Crosshair className="w-10 h-10 text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]" />
                </motion.div>
              )}
            </div>
          ) : (
            <div className="text-center py-3">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <Target className="w-8 h-8 mx-auto mb-2 text-cyan-400/40" />
              </motion.div>
              <div className="text-cyan-400 font-bold text-lg" data-testid="text-holder">No one yet!</div>
              <div className="text-xs text-gray-500 mt-1">Be the first to grab the potato</div>
            </div>
          )}
        </div>

        {isActive && !account?.address && (
          <div className="bg-cyan-500/[0.06] border border-cyan-500/15 rounded-2xl p-5 mb-6 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-cyan-400" />
            <div className="text-cyan-300 font-bold text-lg mb-1">Connect Your Wallet to Play</div>
            <div className="text-sm text-gray-400">Connect a Sui wallet to grab the potato and join the game</div>
          </div>
        )}

        {isActive && !isHolder && account?.address && (
          <div className="space-y-4 bg-gradient-to-br from-cyan-500/[0.04] to-transparent rounded-2xl border border-cyan-500/15 p-5">
            <div className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" /> GRAB THE POTATO
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSelectedTeam(0)}
                className={`p-4 rounded-xl border text-center transition-all ${
                  selectedTeam === 0
                    ? "border-blue-500 bg-blue-500/15 text-blue-400 shadow-lg shadow-blue-500/10"
                    : "border-gray-700/50 bg-[#070b12] text-gray-400 hover:border-blue-500/40 hover:text-blue-300"
                }`}
                data-testid="button-team-a"
              >
                <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Team A</div>
                <div className="font-bold">{game.teamA}</div>
              </button>
              <button
                onClick={() => setSelectedTeam(1)}
                className={`p-4 rounded-xl border text-center transition-all ${
                  selectedTeam === 1
                    ? "border-red-500 bg-red-500/15 text-red-400 shadow-lg shadow-red-500/10"
                    : "border-gray-700/50 bg-[#070b12] text-gray-400 hover:border-red-500/40 hover:text-red-300"
                }`}
                data-testid="button-team-b"
              >
                <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Team B</div>
                <div className="font-bold">{game.teamB}</div>
              </button>
            </div>

            <div>
              <label className="text-[10px] text-cyan-400/50 block mb-1.5 font-medium uppercase tracking-wider">SBETS Amount (min: {formatSBETS(game.minGrabAmount)})</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={grabAmount}
                  onChange={(e) => setGrabAmount(e.target.value)}
                  placeholder={`Min ${game.minGrabAmount}`}
                  className="flex-1 bg-[#070b12] border border-gray-700/50 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition"
                  data-testid="input-grab-amount"
                />
                <div className="flex gap-1.5">
                  {[game.minGrabAmount, game.minGrabAmount * 5, game.minGrabAmount * 10].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setGrabAmount(String(amt))}
                      className={`px-3 py-1.5 text-xs rounded-xl border transition-all ${
                        grabAmount === String(amt) 
                          ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" 
                          : "bg-[#070b12] border-gray-700/50 text-gray-400 hover:border-cyan-500/30 hover:text-cyan-300"
                      }`}
                      data-testid={`button-quick-amount-${amt}`}
                    >
                      {formatSBETS(amt)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <motion.button
              whileHover={canGrab ? { scale: 1.01 } : {}}
              whileTap={canGrab ? { scale: 0.98 } : {}}
              disabled={!canGrab || grabMutation.isPending}
              onClick={() => {
                if (canGrab) {
                  handleGrab(parseFloat(grabAmount), selectedTeam!);
                }
              }}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
                canGrab
                  ? "bg-gradient-to-r from-cyan-600 via-blue-600 to-cyan-600 text-white hover:from-cyan-500 hover:via-blue-500 hover:to-cyan-500 shadow-xl shadow-cyan-500/20"
                  : "bg-gray-800/50 text-gray-600 cursor-not-allowed"
              }`}
              data-testid="button-grab-potato"
            >
              {grabMutation.isPending ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.5, ease: "linear" }}>
                  <CircleDot className="w-5 h-5" />
                </motion.div>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  GRAB THE POTATO
                </>
              )}
            </motion.button>
          </div>
        )}

        {isHolder && isActive && (
          <div className="bg-cyan-500/[0.06] border border-cyan-500/20 rounded-2xl p-5 text-center">
            <motion.div
              animate={{ y: [0, -5, 0], scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              <Crosshair className="w-14 h-14 mx-auto mb-3 text-cyan-400 drop-shadow-[0_0_20px_rgba(34,211,238,0.5)]" />
            </motion.div>
            <div className="text-xl font-bold text-cyan-300 mb-2">You're Holding the Hot Potato!</div>
            <div className="text-sm text-gray-400">
              If the timer runs out, your fate is tied to <span className={game.holderTeam === 0 ? "text-blue-400 font-bold" : "text-red-400 font-bold"}>
                {game.holderTeam === 0 ? game.teamA : game.teamB}
              </span> winning the match.
            </div>
          </div>
        )}

        {game.status === "exploded" && (
          <div className="bg-red-500/[0.06] border border-red-500/15 rounded-2xl p-5 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", bounce: 0.5 }}
            >
              <Bomb className="w-14 h-14 mx-auto mb-3 text-red-400 drop-shadow-[0_0_15px_rgba(248,113,113,0.4)]" />
            </motion.div>
            <div className="text-xl font-bold text-red-400 mb-2">The Potato Exploded!</div>
            <div className="text-sm text-gray-400">
              Last holder: <span className="text-white font-mono font-bold">{shortenWallet(game.currentHolder)}</span>
            </div>
            <div className="text-sm text-gray-500 mt-1">
              Waiting for match result to settle...
            </div>
          </div>
        )}

        {game.status === "settled" && (
          <div className="bg-emerald-500/[0.06] border border-emerald-500/15 rounded-2xl p-5 text-center">
            <Trophy className="w-14 h-14 mx-auto mb-3 text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.4)]" />
            <div className="text-xl font-bold text-emerald-400 mb-2">Game Settled!</div>
            <div className="text-sm text-gray-400">
              Winning team: <span className="text-white font-bold text-lg">
                {game.winningTeam === 0 ? game.teamA : game.winningTeam === 1 ? game.teamB : "Draw"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-800/30 bg-[#0c1018] p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" /> Grab History
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {grabs && grabs.length > 0 ? grabs.map((grab, i) => (
            <motion.div
              key={grab.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between py-2.5 px-4 rounded-xl bg-[#070b12] text-sm border border-gray-800/20"
              data-testid={`row-grab-${grab.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-cyan-400/50 text-xs font-mono">#{grab.grabNumber}</span>
                <span className="font-mono text-gray-300 text-xs">{shortenWallet(grab.wallet)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold ${grab.teamChosen === 0 ? "text-blue-400" : "text-red-400"}`}>
                  {grab.teamChosen === 0 ? game.teamA : game.teamB}
                </span>
                <span className="text-cyan-400 font-bold text-xs">+{formatSBETS(grab.amount)}</span>
              </div>
            </motion.div>
          )) : (
            <div className="text-center text-gray-600 text-sm py-8">No grabs yet — be the first!</div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-500/10 bg-gradient-to-br from-cyan-500/[0.03] to-transparent p-5">
        <h3 className="text-sm font-bold text-cyan-300 mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> How It Works
        </h3>
        <div className="space-y-3 text-sm text-gray-400">
          <div className="flex gap-3 items-start">
            <span className="text-cyan-400 font-bold text-xs mt-0.5 shrink-0 w-5 h-5 rounded-full bg-cyan-500/10 flex items-center justify-center">1</span>
            <p>Each grab adds SBETS to the pot and resets the countdown timer (which gets shorter each time).</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-cyan-400 font-bold text-xs mt-0.5 shrink-0 w-5 h-5 rounded-full bg-cyan-500/10 flex items-center justify-center">2</span>
            <p>You choose a team when you grab — your bet is tied to that team winning.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-cyan-400 font-bold text-xs mt-0.5 shrink-0 w-5 h-5 rounded-full bg-cyan-500/10 flex items-center justify-center">3</span>
            <p>When the timer hits zero, the potato EXPLODES. The last holder's fate depends on the match result.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-cyan-400 font-bold text-xs mt-0.5 shrink-0 w-5 h-5 rounded-full bg-cyan-500/10 flex items-center justify-center">4</span>
            <p>If the last holder's chosen team wins, they take the entire pot (minus 5% platform fee).</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-cyan-400 font-bold text-xs mt-0.5 shrink-0 w-5 h-5 rounded-full bg-cyan-500/10 flex items-center justify-center">5</span>
            <p>If the last holder's team loses, the pot is split among all other players.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HotPotatoPage() {
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

  const { data: games, isLoading } = useQuery<HotPotatoGame[]>({
    queryKey: ["/api/hot-potato/games"],
    refetchInterval: 10000,
  });

  const { data: treasury } = useQuery<{
    activePot?: number;
    pendingPot?: number;
    totalSettled?: number;
    activeGames: number;
    explodedGames?: number;
    settledGames?: number;
    totalVolume: number;
  }>({
    queryKey: ["/api/hot-potato/treasury"],
    refetchInterval: 30000,
  });

  const activeGames = useMemo(() => games?.filter(g => g.status === "active") || [], [games]);
  const pastGames = useMemo(() => games?.filter(g => g.status !== "active") || [], [games]);

  if (selectedGameId) {
    return (
      <div className="min-h-screen bg-[#0a0e17]">
        <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
          <GameDetail gameId={selectedGameId} onBack={() => setSelectedGameId(null)} />
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <div className="max-w-4xl mx-auto px-4 py-6 pb-24">
        <div className="mb-8">
          <Link href="/" className="flex items-center gap-2 text-cyan-400/60 hover:text-cyan-400 transition mb-6 text-sm font-medium" data-testid="link-back-home">
            <ChevronLeft className="w-4 h-4" /> Back to Sports
          </Link>

          <div className="relative">
            <div className="absolute -left-4 top-0 w-1 h-full bg-gradient-to-b from-cyan-400 to-blue-500 rounded-full" />

            <div className="bg-gradient-to-r from-[#0c1524] to-transparent rounded-2xl p-6 border border-cyan-500/10">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-cyan-400" />
                </div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-blue-300 to-cyan-300 bg-clip-text text-transparent">Hot Potato Bets</h1>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-wider">
                  SUI-NATIVE
                </span>
              </div>
              <p className="text-gray-500 text-sm max-w-xl leading-relaxed pl-[52px]">
                Grab the potato, add SBETS, choose your team. When the timer explodes, the last holder's fate
                depends on the match result. Win the entire pot or lose it all.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gradient-to-br from-[#0c1524] to-[#0a0e17] border border-cyan-500/15 rounded-2xl p-5 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.04] to-transparent" />
            <div className="relative">
              <Activity className="w-6 h-6 mx-auto mb-2 text-cyan-400" />
              <div className="text-2xl font-bold text-white" data-testid="text-active-games-count">{activeGames.length}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Active Games</div>
            </div>
          </div>
          <div className="bg-[#0c1018] border border-cyan-500/10 rounded-2xl p-5 text-center">
            <Coins className="w-6 h-6 mx-auto mb-2 text-cyan-400" />
            <div className="text-2xl font-bold text-cyan-400" data-testid="text-total-pot">
              {formatSBETS(activeGames.reduce((sum, g) => sum + g.potAmount, 0))}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Total in Pots</div>
          </div>
          <div className="bg-[#0c1018] border border-gray-800/30 rounded-2xl p-5 text-center">
            <Users className="w-6 h-6 mx-auto mb-2 text-blue-400" />
            <div className="text-2xl font-bold text-white" data-testid="text-playing-now">
              {activeGames.reduce((sum, g) => sum + g.playerCount, 0)}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Playing Now</div>
          </div>
        </div>

        {treasury && treasury.totalVolume > 0 && (
          <div className="mb-8 bg-gradient-to-r from-[#0c1524]/50 via-[#0e1220] to-[#0c1524]/50 border border-cyan-500/10 rounded-2xl p-5">
            <h3 className="text-[10px] font-bold text-cyan-400/50 mb-3 flex items-center gap-2 uppercase tracking-wider">
              <Shield className="w-3.5 h-3.5 text-cyan-400" /> Hot Potato Treasury
            </h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold text-cyan-400" data-testid="text-treasury-active-pot">{formatSBETS(treasury.activePot ?? 0)}</div>
                <div className="text-[9px] text-gray-600 uppercase tracking-wider">Active Pots</div>
              </div>
              <div>
                <div className="text-lg font-bold text-blue-400" data-testid="text-treasury-volume">{formatSBETS(treasury.totalVolume)}</div>
                <div className="text-[9px] text-gray-600 uppercase tracking-wider">Total Volume</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-400" data-testid="text-treasury-games">{treasury.activeGames}</div>
                <div className="text-[9px] text-gray-600 uppercase tracking-wider">Active Games</div>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
              <CircleDot className="w-8 h-8 text-cyan-400" />
            </motion.div>
          </div>
        ) : (
          <>
            {activeGames.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider">
                  <Activity className="w-4 h-4 text-cyan-400" /> Active Games
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {activeGames.map(game => (
                    <GameCard key={game.id} game={game} onSelect={setSelectedGameId} />
                  ))}
                </div>
              </div>
            )}

            {activeGames.length === 0 && (
              <div className="text-center py-20 rounded-2xl border border-dashed border-gray-800/30 bg-[#0c1018]">
                <Zap className="w-16 h-16 mx-auto mb-4 text-gray-700" />
                <h3 className="text-xl font-bold text-gray-500 mb-2">No Active Games</h3>
                <p className="text-gray-600 text-sm">Games are created automatically around upcoming matches.</p>
              </div>
            )}

            {pastGames.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider">
                  <Trophy className="w-4 h-4 text-gray-500" /> Past Games
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {pastGames.slice(0, 6).map(game => (
                    <GameCard key={game.id} game={game} onSelect={setSelectedGameId} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
