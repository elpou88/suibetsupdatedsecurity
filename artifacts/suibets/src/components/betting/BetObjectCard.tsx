import { ExternalLink, Trophy, X, RotateCcw, Clock } from 'lucide-react';
import type { OnChainBetObject } from '@/hooks/useBetObjects';

interface BetObjectCardProps {
  bet: OnChainBetObject;
  compact?: boolean;
}

const STATUS_ICONS = {
  Won:     <Trophy size={14} className="text-emerald-400" />,
  Lost:    <X size={14} className="text-red-400" />,
  Void:    <RotateCcw size={14} className="text-gray-400" />,
  Pending: <Clock size={14} className="text-cyan-400" />,
};

const STATUS_BG = {
  Won:     'bg-emerald-500/10 border-emerald-500/30',
  Lost:    'bg-red-500/10 border-red-500/30',
  Void:    'bg-gray-500/10 border-gray-500/30',
  Pending: 'bg-cyan-500/10 border-cyan-500/30',
};

export function BetObjectCard({ bet, compact = false }: BetObjectCardProps) {
  const suiscanUrl = `https://suiscan.xyz/mainnet/object/${bet.objectId}`;

  const placedDate = bet.placedAt
    ? new Date(bet.placedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  const predictionShort = bet.prediction.length > 60
    ? bet.prediction.slice(0, 57) + '…'
    : bet.prediction;

  const eventShort = bet.eventId.length > 40
    ? bet.eventId.slice(0, 37) + '…'
    : bet.eventId;

  if (compact) {
    return (
      <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${STATUS_BG[bet.statusLabel]}`}>
        <div className="flex items-center gap-2 min-w-0">
          {STATUS_ICONS[bet.statusLabel]}
          <span className="text-white truncate">{predictionShort || eventShort}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-gray-400">{bet.oddsDisplay}</span>
          <span className={bet.statusColor + ' font-semibold'}>{bet.stakeDisplay}</span>
          <a href={suiscanUrl} target="_blank" rel="noopener noreferrer"
            className="text-gray-500 hover:text-cyan-400 transition-colors">
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${STATUS_BG[bet.statusLabel]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {STATUS_ICONS[bet.statusLabel]}
          <span className={`text-xs font-semibold uppercase tracking-wide ${bet.statusColor}`}>
            {bet.statusLabel}
          </span>
          <span className="text-xs text-gray-500 bg-gray-800/60 px-2 py-0.5 rounded-full">
            {bet.coinTypeLabel}
          </span>
        </div>
        <a href={suiscanUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-cyan-400 transition-colors shrink-0">
          On-chain <ExternalLink size={11} />
        </a>
      </div>

      <div>
        <p className="text-white text-sm font-medium leading-snug">{predictionShort || '—'}</p>
        {bet.eventId && bet.prediction !== bet.eventId && (
          <p className="text-gray-500 text-xs mt-0.5 truncate">{eventShort}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-black/20 rounded-lg p-2">
          <p className="text-gray-500 mb-0.5">Odds</p>
          <p className="text-white font-semibold">{bet.oddsDisplay}</p>
        </div>
        <div className="bg-black/20 rounded-lg p-2">
          <p className="text-gray-500 mb-0.5">Stake</p>
          <p className="text-white font-semibold">{bet.stakeDisplay}</p>
        </div>
        <div className="bg-black/20 rounded-lg p-2">
          <p className="text-gray-500 mb-0.5">To Win</p>
          <p className={bet.status === 1 ? 'text-emerald-400 font-semibold' : 'text-white font-semibold'}>
            {bet.potentialPayoutDisplay}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{placedDate}</span>
        <span className="font-mono text-gray-700">{bet.objectId.slice(0, 10)}…</span>
      </div>
    </div>
  );
}

interface BetObjectListProps {
  bets: OnChainBetObject[];
  isLoading?: boolean;
  compact?: boolean;
  emptyMessage?: string;
}

export function BetObjectList({ bets, isLoading, compact, emptyMessage }: BetObjectListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!bets.length) {
    return (
      <p className="text-gray-500 text-sm text-center py-6">
        {emptyMessage ?? 'No bet objects found in this wallet.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {bets.map(bet => (
        <BetObjectCard key={bet.objectId} bet={bet} compact={compact} />
      ))}
    </div>
  );
}
