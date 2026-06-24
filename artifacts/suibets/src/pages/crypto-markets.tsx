import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, TrendingUp, TrendingDown, Activity, Clock, BarChart2,
  RefreshCw, ChevronUp, ChevronDown, Zap, AlertCircle, CheckCircle,
  Bitcoin, Loader2, Target, DollarSign
} from "lucide-react";

interface PythPrice {
  symbol: string;
  feedId: string;
  price: number;
  confidence: number;
  publishTime: number;
  priceFormatted: string;
  changePercent24h: number | null;
}

interface CryptoMarket {
  id: string;
  symbol: string;
  feedId: string;
  currentPrice: number;
  targetPrice: number;
  direction: "above" | "below";
  targetTime: number;
  durationHours: number;
  oddsAbove: number;
  oddsBelow: number;
  totalBets: number;
  totalVolume: number;
  status: "open" | "resolved" | "cancelled";
  resolvedOutcome?: "above" | "below";
  createdAt: number;
  description: string;
}

const SYMBOL_COLORS: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  BTC: { bg: "from-orange-500/20 to-yellow-500/10", text: "text-orange-400", border: "border-orange-500/30", icon: "₿" },
  ETH: { bg: "from-purple-500/20 to-indigo-500/10", text: "text-purple-400", border: "border-purple-500/30", icon: "Ξ" },
  SUI: { bg: "from-[#4da2ff]/20 to-cyan-500/10", text: "text-[#4da2ff]", border: "border-[#4da2ff]/30", icon: "𝕊" },
  SOL: { bg: "from-green-500/20 to-emerald-500/10", text: "text-green-400", border: "border-green-500/30", icon: "◎" },
  BNB: { bg: "from-yellow-500/20 to-amber-500/10", text: "text-yellow-400", border: "border-yellow-500/30", icon: "♦" },
};

function formatPrice(price: number, symbol: string): string {
  if (price >= 1000) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return `$${price.toFixed(6)}`;
}

function timeLeft(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "Ended";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function PriceTickerCard({ price }: { price: PythPrice }) {
  const colors = SYMBOL_COLORS[price.symbol] || SYMBOL_COLORS.BTC;
  const positive = (price.changePercent24h ?? 0) >= 0;
  const ageMs = Date.now() - price.publishTime * 1000;
  const fresh = ageMs < 60000;

  return (
    <div className={`bg-gradient-to-br ${colors.bg} border ${colors.border} rounded-2xl p-4 relative overflow-hidden`}>
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {fresh && <div className="h-1.5 w-1.5 bg-green-400 rounded-full animate-pulse" />}
        <span className="text-[10px] text-gray-500 font-mono">Pyth</span>
      </div>
      <div className={`text-2xl font-bold mb-1 ${colors.text}`}>{colors.icon}</div>
      <div className="text-gray-400 text-xs font-medium mb-1">{price.symbol}/USD</div>
      <div className="text-white text-xl font-bold font-mono tracking-tight">{price.priceFormatted}</div>
      <div className={`text-xs font-semibold mt-1 flex items-center gap-0.5 ${positive ? "text-green-400" : "text-red-400"}`}>
        {positive ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {price.changePercent24h != null ? `${Math.abs(price.changePercent24h).toFixed(2)}%` : "—"}
        <span className="text-gray-600 font-normal ml-1">24h</span>
      </div>
      <div className="text-[10px] text-gray-600 mt-1">
        ±{formatPrice(price.confidence, price.symbol)}
      </div>
    </div>
  );
}

function MarketCard({
  market,
  prices,
  onBet,
}: {
  market: CryptoMarket;
  prices: PythPrice[];
  onBet: (marketId: string, side: "above" | "below", odds: number) => void;
}) {
  const colors = SYMBOL_COLORS[market.symbol] || SYMBOL_COLORS.BTC;
  const currentPrice = prices.find(p => p.symbol === market.symbol)?.price ?? market.currentPrice;
  const progress = Math.min(100, Math.max(0, (currentPrice / market.targetPrice) * 100));
  const isAbove = currentPrice >= market.targetPrice;
  const isResolved = market.status === "resolved";
  const won = isResolved && market.resolvedOutcome;

  return (
    <div className={`bg-[#0d1220] border rounded-2xl overflow-hidden transition-all hover:border-opacity-60 ${
      isResolved ? "border-gray-700/40 opacity-80" : colors.border
    }`}>
      <div className={`bg-gradient-to-r ${colors.bg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold ${colors.text}`}>{colors.icon}</span>
          <span className="text-white font-semibold text-sm">{market.symbol}/USD</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
            isResolved
              ? "bg-gray-800 border-gray-600 text-gray-400"
              : "bg-[#4da2ff]/10 border-[#4da2ff]/30 text-[#4da2ff]"
          }`}>
            {isResolved ? `Resolved: ${won === "above" ? "↑ ABOVE" : "↓ BELOW"}` : `${market.durationHours}h market`}
          </span>
        </div>
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <Clock className="h-3 w-3" />
          <span>{isResolved ? "Ended" : timeLeft(market.targetTime)}</span>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="text-center mb-4">
          <div className="text-gray-400 text-xs mb-1">Target Price</div>
          <div className="text-white text-2xl font-bold font-mono">{formatPrice(market.targetPrice, market.symbol)}</div>
          <div className="text-gray-500 text-xs mt-1">
            Current: <span className={`font-mono font-medium ${isAbove ? "text-green-400" : "text-red-400"}`}>
              {formatPrice(currentPrice, market.symbol)}
            </span>
            <span className={`ml-2 ${isAbove ? "text-green-400" : "text-red-400"}`}>
              {isAbove ? "↑ ABOVE" : "↓ BELOW"} target
            </span>
          </div>
        </div>

        <div className="mb-4">
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isAbove ? "bg-green-500" : "bg-red-500"}`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>$0</span>
            <span className={`${colors.text} font-mono`}>{formatPrice(market.targetPrice, market.symbol)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className={`rounded-xl p-3 text-center border ${
            market.resolvedOutcome === "above" ? "bg-green-500/20 border-green-500/40" : "bg-gray-800/50 border-gray-700/40"
          }`}>
            <div className="text-green-400 text-xs font-medium mb-0.5 flex items-center justify-center gap-1">
              <ChevronUp className="h-3.5 w-3.5" /> ABOVE
            </div>
            <div className="text-white font-bold text-lg">{market.oddsAbove}x</div>
            <div className="text-gray-500 text-[10px]">payout odds</div>
          </div>
          <div className={`rounded-xl p-3 text-center border ${
            market.resolvedOutcome === "below" ? "bg-red-500/20 border-red-500/40" : "bg-gray-800/50 border-gray-700/40"
          }`}>
            <div className="text-red-400 text-xs font-medium mb-0.5 flex items-center justify-center gap-1">
              <ChevronDown className="h-3.5 w-3.5" /> BELOW
            </div>
            <div className="text-white font-bold text-lg">{market.oddsBelow}x</div>
            <div className="text-gray-500 text-[10px]">payout odds</div>
          </div>
        </div>

        {!isResolved && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onBet(market.id, "above", market.oddsAbove)}
              className="py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-semibold hover:bg-green-500/20 hover:border-green-500/50 transition-all active:scale-95"
            >
              ↑ Bet Above
            </button>
            <button
              onClick={() => onBet(market.id, "below", market.oddsBelow)}
              className="py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-semibold hover:bg-red-500/20 hover:border-red-500/50 transition-all active:scale-95"
            >
              ↓ Bet Below
            </button>
          </div>
        )}

        {isResolved && (
          <div className={`rounded-xl py-2 text-center text-sm font-semibold ${
            won === "above" ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
          }`}>
            {won === "above" ? "✓ Resolved: ABOVE" : "✗ Resolved: BELOW"}
          </div>
        )}

        <div className="flex justify-between text-[10px] text-gray-600 mt-3 pt-3 border-t border-gray-800/50">
          <span>{market.totalBets} bets</span>
          <span>Vol: ${market.totalVolume.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          <span className="flex items-center gap-0.5">
            <Zap className="h-2.5 w-2.5 text-yellow-500" /> Pyth oracle
          </span>
        </div>
      </div>
    </div>
  );
}

interface BetModal {
  marketId: string;
  side: "above" | "below";
  odds: number;
  market: CryptoMarket;
}

export default function CryptoMarketsPage() {
  const [, navigate] = useLocation();
  const [filterSymbol, setFilterSymbol] = useState<string>("ALL");
  const [betModal, setBetModal] = useState<BetModal | null>(null);
  const [betAmount, setBetAmount] = useState("10");
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pricesQuery = useQuery<PythPrice[]>({
    queryKey: ["/api/pyth/prices", lastRefresh],
    queryFn: async () => {
      const r = await fetch("/api/pyth/prices");
      if (!r.ok) throw new Error("Failed to fetch Pyth prices");
      return r.json();
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const marketsQuery = useQuery<CryptoMarket[]>({
    queryKey: ["/api/pyth/markets", lastRefresh],
    queryFn: async () => {
      const r = await fetch("/api/pyth/markets");
      if (!r.ok) throw new Error("Failed to fetch crypto markets");
      return r.json();
    },
    refetchInterval: 20000,
    staleTime: 15000,
  });

  const placeBetMutation = useMutation({
    mutationFn: async (data: { marketId: string; side: string; odds: number; amount: number }) => {
      const r = await fetch("/api/pyth/markets/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to place bet");
      return r.json();
    },
    onSuccess: () => {
      setBetModal(null);
      setBetAmount("10");
      marketsQuery.refetch();
    },
  });

  const handleBet = (marketId: string, side: "above" | "below", odds: number) => {
    const market = (marketsQuery.data || []).find(m => m.id === marketId);
    if (!market) return;
    setBetModal({ marketId, side, odds, market });
  };

  const symbols = ["ALL", "BTC", "ETH", "SUI", "SOL", "BNB"];
  const prices = pricesQuery.data || [];
  const allMarkets = marketsQuery.data || [];
  const markets = filterSymbol === "ALL" ? allMarkets : allMarkets.filter(m => m.symbol === filterSymbol);
  const openMarkets = markets.filter(m => m.status === "open");
  const resolvedMarkets = markets.filter(m => m.status !== "open");

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#080c14] via-[#0a0e17] to-[#0d1220]">
      <div className="px-4 py-4 border-b border-gray-800/60 bg-[#0d1220]/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3 max-w-5xl mx-auto">
          <button
            onClick={() => navigate("/")}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[#141c2e] border border-gray-700/50 text-gray-400 hover:text-white hover:border-[#4da2ff]/40 transition-all shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-10 w-10 bg-gradient-to-br from-orange-500 to-yellow-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
            <Bitcoin className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white tracking-tight">Crypto Price Markets</h1>
            <p className="text-gray-500 text-xs flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-yellow-500" />
              Live Pyth oracle · Updated every 15s
            </p>
          </div>
          <button
            onClick={() => { setLastRefresh(Date.now()); pricesQuery.refetch(); marketsQuery.refetch(); }}
            className="h-8 w-8 flex items-center justify-center rounded-lg bg-[#141c2e] border border-gray-700/50 text-gray-400 hover:text-[#4da2ff] transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pricesQuery.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#4da2ff]" /> Live Pyth Prices
            </h2>
            <span className="text-[10px] text-gray-500 flex items-center gap-1">
              <div className="h-1.5 w-1.5 bg-green-400 rounded-full animate-pulse" />
              Hermes feed
            </span>
          </div>
          {pricesQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 text-[#4da2ff] animate-spin" /></div>
          ) : pricesQuery.isError ? (
            <div className="text-center py-6 text-gray-500 flex items-center justify-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <span>Failed to load Pyth prices — check connection</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {prices.map(p => <PriceTickerCard key={p.symbol} price={p} />)}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-[#4da2ff]" /> Price Prediction Markets
            </h2>
            <div className="text-[10px] text-gray-500">{openMarkets.length} open</div>
          </div>

          <div className="flex gap-2 mb-4 flex-wrap">
            {symbols.map(s => (
              <button
                key={s}
                onClick={() => setFilterSymbol(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  filterSymbol === s
                    ? "bg-[#4da2ff] border-[#4da2ff] text-white"
                    : "bg-[#141c2e] border-gray-700/50 text-gray-400 hover:border-[#4da2ff]/40 hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {marketsQuery.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 text-[#4da2ff] animate-spin" /></div>
          ) : openMarkets.length === 0 ? (
            <div className="text-center py-12">
              <div className="h-16 w-16 bg-[#4da2ff]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <BarChart2 className="h-8 w-8 text-[#4da2ff]/40" />
              </div>
              <div className="text-gray-400 font-medium mb-1">No open markets</div>
              <div className="text-gray-600 text-sm">Markets are generated from live Pyth prices</div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {openMarkets.map(m => (
                <MarketCard key={m.id} market={m} prices={prices} onBet={handleBet} />
              ))}
            </div>
          )}

          {resolvedMarkets.length > 0 && (
            <div className="mt-8">
              <h3 className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5" /> Resolved Markets
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {resolvedMarkets.slice(0, 6).map(m => (
                  <MarketCard key={m.id} market={m} prices={prices} onBet={handleBet} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-[#0d1220] border border-gray-800/40 rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 bg-yellow-500/10 rounded-xl flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-yellow-500" />
            </div>
            <div>
              <div className="text-white text-sm font-semibold mb-1">Powered by Pyth Network on Sui</div>
              <div className="text-gray-400 text-xs leading-relaxed">
                Prices are sourced from Pyth's Hermes API — the same oracle that updates on-chain Sui price feeds every 400ms.
                Market outcomes are resolved against on-chain Pyth price objects, making manipulation impossible.
                Feed IDs are verifiable on <a href="https://pyth.network/price-feeds" target="_blank" rel="noreferrer" className="text-[#4da2ff] hover:underline">pyth.network</a>.
              </div>
            </div>
          </div>
        </div>
      </div>

      {betModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#0d1220] border border-gray-700/60 rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-white font-bold text-lg mb-1">Place Bet</h3>
            <p className="text-gray-400 text-sm mb-4">{betModal.market.description}</p>

            <div className={`rounded-xl p-3 mb-4 text-center ${
              betModal.side === "above" ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"
            }`}>
              <div className={`font-bold text-lg ${betModal.side === "above" ? "text-green-400" : "text-red-400"}`}>
                {betModal.side === "above" ? "↑ ABOVE" : "↓ BELOW"} {formatPrice(betModal.market.targetPrice, betModal.market.symbol)}
              </div>
              <div className="text-gray-400 text-xs mt-1">Payout: {betModal.odds}x your stake</div>
            </div>

            <div className="mb-4">
              <label className="text-gray-400 text-xs mb-2 block">Stake (SUI)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="number"
                  value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  min="1"
                  step="1"
                  className="w-full bg-[#141c2e] border border-gray-700/50 rounded-xl pl-9 pr-4 py-3 text-white focus:border-[#4da2ff]/50 focus:outline-none"
                />
              </div>
              <div className="text-gray-500 text-xs mt-1.5">
                Potential return: <span className="text-green-400 font-mono">{(parseFloat(betAmount || "0") * betModal.odds).toFixed(2)} SUI</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setBetModal(null)}
                className="flex-1 py-3 rounded-xl border border-gray-700/50 text-gray-400 hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => placeBetMutation.mutate({
                  marketId: betModal.marketId,
                  side: betModal.side,
                  odds: betModal.odds,
                  amount: parseFloat(betAmount || "0"),
                })}
                disabled={placeBetMutation.isPending || !betAmount || parseFloat(betAmount) <= 0}
                className={`flex-1 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 ${
                  betModal.side === "above"
                    ? "bg-green-500 hover:bg-green-400 text-white"
                    : "bg-red-500 hover:bg-red-400 text-white"
                }`}
              >
                {placeBetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Confirm Bet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
