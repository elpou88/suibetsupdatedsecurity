import { useLocation } from 'wouter';
import { ArrowRight, Zap, Users } from 'lucide-react';

type Offer = {
  id: number;
  creatorWallet: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  odds: number;
  creatorStake: number;
  takerStake: number;
  filledStake: number;
  currency: string;
  status: string;
};

function predLabel(pred: string, home: string, away: string) {
  if (pred === 'home') return home;
  if (pred === 'away') return away;
  return 'Draw';
}

function shortWallet(w: string) {
  if (!w || w.length < 10) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function pctFilled(offer: Offer) {
  if (!offer.takerStake || offer.takerStake <= 0) return 0;
  return Math.min(100, Math.round(((offer.filledStake ?? 0) / offer.takerStake) * 100));
}

type Props = {
  offers: Offer[];
};

export function P2PFeaturedOffers({ offers }: Props) {
  const [, setLocation] = useLocation();

  const featured = [...(offers ?? [])]
    .filter(o => o.status === 'open' || o.status === 'partial')
    .sort((a, b) => b.creatorStake - a.creatorStake)
    .slice(0, 4);

  if (!featured.length) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-cyan-400" />
          <span className="text-sm font-bold text-white tracking-wide">Jump In — Open P2P Offers</span>
          <span className="bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
            0% house edge
          </span>
        </div>
        <button
          onClick={() => setLocation('/p2p')}
          className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          View all <ArrowRight size={12} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {featured.map(offer => {
          const pct = pctFilled(offer);
          const remaining = Math.max(0, offer.takerStake - (offer.filledStake ?? 0));
          const pred = predLabel(offer.prediction, offer.homeTeam, offer.awayTeam);

          return (
            <div
              key={offer.id}
              className="group relative bg-[#060c18] border border-cyan-900/25 hover:border-cyan-500/40 rounded-xl p-3 cursor-pointer transition-all hover:bg-[#08101f]"
              onClick={() => setLocation('/p2p')}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="text-[11px] text-gray-400 truncate">{offer.homeTeam} vs {offer.awayTeam}</p>
                  <p className="text-xs text-white font-semibold truncate mt-0.5">{offer.eventName}</p>
                </div>
                <span className="font-mono text-sm font-black text-amber-400 flex-shrink-0">
                  @{Number(offer.odds ?? 0).toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-2.5">
                <span className="bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 text-[10px] font-bold px-2 py-0.5 rounded">
                  {pred}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">
                  {shortWallet(offer.creatorWallet)}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] mb-2">
                <span className="text-gray-400">
                  Need <span className="text-white font-mono font-bold">
                    {remaining.toLocaleString(undefined, { maximumFractionDigits: 3 })} {offer.currency}
                  </span>
                </span>
                <span className="text-gray-500 font-mono">
                  vs {offer.creatorStake.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                </span>
              </div>

              {pct > 0 && (
                <div className="mb-2">
                  <div className="h-0.5 w-full bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-cyan-500 font-mono">{pct}% filled</span>
                </div>
              )}

              <button
                className="w-full mt-1 flex items-center justify-center gap-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 hover:border-cyan-500/50 text-cyan-400 text-[11px] font-bold py-1.5 rounded-lg transition-all group-hover:text-cyan-300"
                onClick={e => { e.stopPropagation(); setLocation(`/p2p?acceptOffer=${offer.id}`); }}
              >
                Take this bet <ArrowRight size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
