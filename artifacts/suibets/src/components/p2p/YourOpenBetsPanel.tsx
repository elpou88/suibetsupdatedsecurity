import { useState, useEffect, useCallback } from 'react';
import { X, ChevronRight, Clock, Loader2, TriangleAlert, ExternalLink, Shield } from 'lucide-react';

// ─── Types (mirrored from p2p.tsx to avoid circular dep) ─────────────────────

type OpenOffer = {
  id: number;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  odds: number;
  creatorStake: number;
  currency: string;
  filledStake: number;
  takerStake: number;
  expiresAt: string;
  status: string;
  leagueName?: string;
  onchainOfferId?: string;
  refundTxHash?: string | null;
  settlementTxHash?: string | null;
  walrusBlobId?: string | null;
  matchWalrusBlobId?: string | null;
  matchHasLocalReceipt?: boolean;
  checkpointSeq?: string | null;
};

type OpenParlay = {
  id: number;
  legCount: number;
  totalOdds: number;
  creatorStake: number;
  currency: string;
  expiresAt: string;
  status: string;
  onchainParlayId?: string;
  legs: Array<{ homeTeam: string; awayTeam: string }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeLeft(expiresAt: string): { label: string; urgent: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { label: 'Expired', urgent: true };
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const urgent = diff < 2 * 3_600_000;
  if (h > 24) return { label: `${Math.floor(h / 24)}d ${h % 24}h`, urgent: false };
  if (h > 0) return { label: `${h}h ${m}m`, urgent };
  return { label: `${m}m`, urgent: true };
}

function predLabel(pred: string, home: string, away: string) {
  if (pred === 'home') return home;
  if (pred === 'away') return away;
  return 'Draw';
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  open:             { bg: 'bg-green-500/15',   text: 'text-green-400',   label: 'OPEN' },
  filled:           { bg: 'bg-blue-500/15',    text: 'text-blue-400',    label: 'FILLED' },
  settled:          { bg: 'bg-purple-500/15',  text: 'text-purple-400',  label: 'SETTLED' },
  won:              { bg: 'bg-green-500/15',   text: 'text-green-400',   label: 'WON ✓' },
  lost:             { bg: 'bg-red-500/15',     text: 'text-red-400',     label: 'LOST' },
  settling:         { bg: 'bg-yellow-500/15',  text: 'text-yellow-400',  label: 'SETTLING…' },
  cancelled:        { bg: 'bg-gray-500/15',    text: 'text-gray-400',    label: 'CANCELLED' },
  expired:          { bg: 'bg-gray-500/15',    text: 'text-gray-500',    label: 'EXPIRED' },
  refund_pending:   { bg: 'bg-orange-500/15',  text: 'text-orange-400',  label: 'REFUND PENDING' },
  refunded:         { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'REFUNDED ✓' },
};

function resolveExpiredStatus(offer: { status: string; refundTxHash?: string | null }): string {
  if (offer.status !== 'expired') return offer.status;
  if (!offer.refundTxHash || offer.refundTxHash === 'PENDING') return 'refund_pending';
  if (offer.refundTxHash === 'ON_CHAIN_SETTLED') return 'refunded';
  return 'refunded';
}

function StatusBadge({ status, offer }: { status: string; offer?: { status: string; refundTxHash?: string | null } }) {
  const resolved = offer ? resolveExpiredStatus(offer) : status;
  const s = STATUS_STYLE[resolved] ?? { bg: 'bg-gray-500/15', text: 'text-gray-400', label: resolved.toUpperCase() };
  return (
    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── Single row ───────────────────────────────────────────────────────────────

function OfferRow({
  offer,
  onCancel,
  cancelling,
}: {
  offer: OpenOffer;
  onCancel: (info: { id: number; onchainOfferId?: string; currency?: string }) => void;
  cancelling: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const { label, urgent } = timeLeft(offer.expiresAt);
  const filledPct = offer.takerStake > 0 ? Math.round(((offer.filledStake ?? 0) / offer.takerStake) * 100) : 0;
  const isOnchain = !!offer.onchainOfferId;
  const isOpen = offer.status === 'open';

  const borderClass = isOpen
    ? (isOnchain ? 'border-cyan-500/20 hover:border-cyan-500/40' : 'border-[#1e2a3a] hover:border-cyan-500/30')
    : 'border-[#1a2030] opacity-70';

  return (
    <div className={`border rounded-lg p-2.5 bg-[#0d1420] transition-colors ${borderClass}`}>
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5 flex-wrap">
            <StatusBadge status={offer.status} offer={offer} />
            {isOnchain && (
              <span className="text-[9px] font-bold text-cyan-400/60 bg-cyan-500/10 px-1 py-px rounded border border-cyan-500/20">ON-CHAIN</span>
            )}
          </div>
          <p className="text-white text-xs font-bold truncate leading-tight">{offer.eventName}</p>
          <p className="text-cyan-400 text-xs truncate">
            {predLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}
            <span className="text-gray-500"> @ {Number(offer.odds ?? 0).toFixed(2)}x</span>
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-white font-bold text-xs">{offer.creatorStake} <span className="text-gray-500 font-normal">{offer.currency}</span></p>
          {isOpen && (
            <p className={`text-xs flex items-center justify-end gap-0.5 ${urgent ? 'text-orange-400' : 'text-gray-500'}`}>
              <Clock size={9} />
              {label}
            </p>
          )}
        </div>
      </div>

      {filledPct > 0 && (
        <div className="mb-1.5">
          <div className="flex justify-between text-[10px] text-gray-600 mb-0.5">
            <span>Filled</span><span>{filledPct}%</span>
          </div>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${filledPct}%` }} />
          </div>
        </div>
      )}

      {!isOpen && offer.settlementTxHash && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1 pt-1 border-t border-[#1a2430]">
          <a
            href={`https://suiscan.xyz/mainnet/tx/${offer.settlementTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-[9px] text-cyan-500/70 hover:text-cyan-400 transition-colors"
          >
            <ExternalLink size={9} />
            TX
          </a>
          {offer.checkpointSeq && (
            <a
              href={`https://suiscan.xyz/mainnet/checkpoint/${offer.checkpointSeq}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-[9px] text-purple-500/70 hover:text-purple-400 transition-colors"
            >
              <Shield size={9} />
              Checkpoint #{offer.checkpointSeq}
            </a>
          )}
        </div>
      )}

      {(() => {
        const blobId = offer.matchWalrusBlobId || offer.walrusBlobId;
        const isPending = offer.matchHasLocalReceipt && !blobId;
        if (!blobId && !isPending) return null;
        return (
          <div className="mt-1.5 pt-1.5 border-t border-[#1a2430]">
            {isPending ? (
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <span>🐋</span>
                <span>Receipt pending upload…</span>
              </div>
            ) : blobId && blobId.startsWith('local_') ? (
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <span>🐋</span>
                <span>Receipt pending upload…</span>
              </div>
            ) : blobId ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-gray-400">🐋</span>
                <a
                  href={`/walrus-receipt/${blobId}`}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 transition-colors"
                >
                  <ExternalLink size={9} />
                  View Receipt
                </a>
                <span className="text-gray-700 text-[10px]">·</span>
                <a
                  href={`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-purple-400/70 hover:text-purple-400 flex items-center gap-0.5 transition-colors"
                >
                  Raw <ExternalLink size={9} />
                </a>
                <span className="text-gray-700 text-[10px]">·</span>
                <a
                  href={`https://walruscan.com/mainnet/blob/${blobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] flex items-center gap-0.5 bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 px-1.5 py-px rounded-full transition-colors"
                >
                  <Shield size={9} />
                  Verify
                </a>
              </div>
            ) : null}
          </div>
        );
      })()}

      {isOpen && (
        <div className="flex flex-col items-end gap-1">
          {confirm ? (
            <div className="flex flex-col items-end gap-1 w-full">
              {isOnchain && (
                <p className="text-[9px] text-cyan-400/70 text-right leading-tight">
                  Your wallet will sign a transaction — {offer.creatorStake} {offer.currency} returns to you instantly.
                </p>
              )}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { onCancel({ id: offer.id, onchainOfferId: offer.onchainOfferId, currency: offer.currency }); setConfirm(false); }}
                  disabled={cancelling}
                  className="text-[10px] font-bold text-red-400 bg-red-500/20 hover:bg-red-500/30 px-2 py-0.5 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {cancelling ? <Loader2 size={9} className="animate-spin" /> : null}
                  {isOnchain ? `Reclaim ${offer.creatorStake} ${offer.currency}` : 'Confirm cancel'}
                </button>
                <button
                  onClick={() => setConfirm(false)}
                  className="text-[10px] text-gray-500 bg-gray-800 hover:bg-gray-700 px-2 py-0.5 rounded transition-colors"
                >
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirm(true)}
              className="text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 px-2 py-0.5 rounded transition-colors"
            >
              {isOnchain ? 'Cancel & reclaim' : 'Cancel offer'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ParlayRow({
  parlay,
  onCancel,
  cancelling,
}: {
  parlay: OpenParlay;
  onCancel: (info: { id: number; onchainParlayId?: string; currency?: string }) => void;
  cancelling: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const { label, urgent } = timeLeft(parlay.expiresAt);
  const preview = parlay.legs.slice(0, 2).map(l => l.homeTeam.split(' ').pop()).join(' · ');
  const isOpen = parlay.status === 'open';

  const borderClass = isOpen
    ? 'border-[#1e2a3a] hover:border-purple-500/30'
    : 'border-[#1a2030] opacity-70';

  return (
    <div className={`border rounded-lg p-2.5 bg-[#0d1420] transition-colors ${borderClass}`}>
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5 flex-wrap">
            <StatusBadge status={parlay.status} />
            <span className="text-purple-400 text-[9px] font-bold bg-purple-500/10 px-1 rounded">{parlay.legCount}L</span>
          </div>
          <p className="text-white text-xs font-bold truncate leading-tight">{preview}{parlay.legs.length > 2 ? ` +${parlay.legs.length - 2}` : ''}</p>
          <p className="text-purple-400 text-xs">{Number(parlay.totalOdds ?? 0).toFixed(2)}x parlay</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-white font-bold text-xs">{parlay.creatorStake} <span className="text-gray-500 font-normal">{parlay.currency}</span></p>
          {isOpen && (
            <p className={`text-xs flex items-center justify-end gap-0.5 ${urgent ? 'text-orange-400' : 'text-gray-500'}`}>
              <Clock size={9} />
              {label}
            </p>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="flex justify-end">
          {confirm ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { onCancel({ id: parlay.id, onchainParlayId: parlay.onchainParlayId, currency: parlay.currency }); setConfirm(false); }}
                disabled={cancelling}
                className="text-[10px] font-bold text-red-400 bg-red-500/20 hover:bg-red-500/30 px-2 py-0.5 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {cancelling ? <Loader2 size={9} className="animate-spin" /> : null}
                Confirm cancel
              </button>
              <button
                onClick={() => setConfirm(false)}
                className="text-[10px] text-gray-500 bg-gray-800 hover:bg-gray-700 px-2 py-0.5 rounded transition-colors"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirm(true)}
              className="text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 px-2 py-0.5 rounded transition-colors"
            >
              Cancel parlay
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function YourOpenBetsPanel({
  myOffers,
  myParlayOffers,
  onCancelOffer,
  onCancelParlay,
  cancellingOffer,
  cancellingParlay,
}: {
  myOffers: OpenOffer[];
  myParlayOffers: OpenParlay[];
  onCancelOffer: (info: { id: number; onchainOfferId?: string; currency?: string }) => void;
  onCancelParlay: (info: { id: number; onchainParlayId?: string; currency?: string }) => void;
  cancellingOffer: boolean;
  cancellingParlay: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  // Show ALL bets — open first, then others by most recent
  const sortedOffers = [
    ...myOffers.filter(o => o.status === 'open'),
    ...myOffers.filter(o => o.status !== 'open'),
  ];
  const sortedParlays = [
    ...myParlayOffers.filter(p => p.status === 'open'),
    ...myParlayOffers.filter(p => p.status !== 'open'),
  ];

  const openCount = myOffers.filter(o => o.status === 'open').length
    + myParlayOffers.filter(p => p.status === 'open').length;
  const totalCount = myOffers.length + myParlayOffers.length;

  // Tick every 30s to refresh countdowns
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const close = useCallback(() => setOpen(false), []);

  // Hide entirely only when user has zero bets at all
  if (totalCount === 0 && !open) return null;

  return (
    <>
      {/* Backdrop (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-[58] bg-black/60 backdrop-blur-sm sm:hidden"
          onClick={close}
        />
      )}

      {/* Collapsed tab — peeks from right edge */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-[60] flex items-center gap-1.5 bg-[#111827] border border-r-0 border-cyan-500/40 text-cyan-400 rounded-l-xl px-2 py-3 shadow-xl hover:bg-[#1a2235] transition-all group"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          title="Your P2P bets"
        >
          <ChevronRight size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-black"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              MY BETS
            </span>
            <span className={`text-black text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center ${openCount > 0 ? 'bg-cyan-500' : 'bg-gray-500'}`}>
              {totalCount}
            </span>
          </div>
        </button>
      )}

      {/* Expanded panel */}
      {open && (
        <div className="fixed right-0 top-0 bottom-0 z-[60] flex flex-col w-full sm:w-72 bg-[#0d1117] border-l border-[#1e2a3a] shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-cyan-900/30 to-purple-900/30 border-b border-[#1e2a3a] flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-base">⚔️</span>
              <div>
                <p className="text-white font-black text-sm leading-tight">My Bets</p>
                <p className="text-gray-500 text-[10px]">
                  {openCount > 0 ? `${openCount} open` : 'No open bets'}
                  {totalCount > openCount ? ` · ${totalCount - openCount} settled` : ''}
                </p>
              </div>
            </div>
            <button onClick={close} className="text-gray-500 hover:text-white transition-colors p-1">
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 pb-20 lg:pb-3 space-y-2">
            {totalCount === 0 ? (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">📭</div>
                <p className="text-gray-400 text-xs font-medium">No bets yet</p>
                <p className="text-gray-600 text-xs mt-1">Post a P2P offer below to see it here</p>
              </div>
            ) : (
              <>
                {sortedOffers.length > 0 && (
                  <div>
                    <p className="text-gray-600 text-[10px] font-bold uppercase tracking-wider mb-1.5 px-0.5">
                      Single Offers ({sortedOffers.length})
                    </p>
                    <div className="space-y-2">
                      {sortedOffers.map(o => (
                        <OfferRow
                          key={o.id}
                          offer={o}
                          onCancel={onCancelOffer}
                          cancelling={cancellingOffer}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {sortedParlays.length > 0 && (
                  <div className={sortedOffers.length > 0 ? 'pt-1' : ''}>
                    <p className="text-gray-600 text-[10px] font-bold uppercase tracking-wider mb-1.5 px-0.5">
                      Parlays ({sortedParlays.length})
                    </p>
                    <div className="space-y-2">
                      {sortedParlays.map(p => (
                        <ParlayRow
                          key={p.id}
                          parlay={p}
                          onCancel={onCancelParlay}
                          cancelling={cancellingParlay}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer note */}
          <div className="px-3 py-2.5 border-t border-[#1e2a3a] bg-[#0a0e1a] flex-shrink-0">
            <div className="flex items-start gap-1.5">
              <TriangleAlert size={11} className="text-yellow-500/70 flex-shrink-0 mt-0.5" />
              <p className="text-gray-600 text-[10px] leading-relaxed">
                On-chain offers: stake returns to your wallet <span className="text-cyan-500/60">immediately</span> when you cancel. Legacy offers refunded within 24h.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
