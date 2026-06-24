import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@/lib/dapp-kit-compat';
import { useToast } from '@/hooks/use-toast';
import { Shield, AlertTriangle, Clock, CheckCircle, ExternalLink, Loader2, Swords } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type SettlingBet = {
  dbId: number;
  isParlay: boolean;
  eventName: string;
  homeTeam?: string;
  awayTeam?: string;
  prediction?: string;
  yourSide: 'creator' | 'taker';
  winner: string | null;
  youWon: boolean;
  currency: string;
  creatorStake: number;
  takerStake: number;
  odds: number;
  settledAt: string | null;
  disputeDeadline: string;
  secondsRemaining: number;
  totalWindowSecs: number;
  canDispute: boolean;
  canClaim: boolean;
  onchainId: string | null;
  coinType: string;
  ptbCallData: {
    target: string;
    typeArguments: string[];
    arguments: { config: string; bet: string; clock: string };
  } | null;
  suiscanUrl: string | null;
  alreadyDisputed: boolean;
};

type SettlingResponse = {
  settling: SettlingBet[];
  total: number;
  disputeWindowMs: number;
  contractDeployed: boolean;
  packageId: string | null;
  registryId: string | null;
};

// ── Ring SVG — circular countdown ─────────────────────────────────────────────

function CountdownRing({
  secondsRemaining,
  totalSecs,
  size = 64,
}: { secondsRemaining: number; totalSecs: number; size?: number }) {
  const r     = (size - 8) / 2;
  const circ  = 2 * Math.PI * r;
  const pct   = totalSecs > 0 ? Math.max(0, secondsRemaining / totalSecs) : 0;
  const offset = circ * (1 - pct);

  const color =
    pct > 0.5 ? '#22c55e' :   // green  > 50%
    pct > 0.2 ? '#eab308' :   // yellow > 20%
    pct > 0.05 ? '#f97316' :  // orange > 5%
    '#ef4444';                 // red

  const h = Math.floor(secondsRemaining / 3600);
  const m = Math.floor((secondsRemaining % 3600) / 60);
  const s = secondsRemaining % 60;
  const label =
    h > 0 ? `${h}h\n${m}m` :
    m > 0 ? `${m}m\n${s}s` :
    `${s}s`;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" style={{ position: 'absolute', top: 0, left: 0 }}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="#1e2a3a" strokeWidth={5}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-center font-black leading-tight whitespace-pre-line"
          style={{ color, fontSize: size < 56 ? 9 : 11 }}
        >
          {secondsRemaining <= 0 ? 'DONE' : label}
        </span>
      </div>
    </div>
  );
}

// ── Single Bet Card ────────────────────────────────────────────────────────────

function SettlingCard({
  bet,
  walletAddress,
  contractDeployed,
  packageId,
  registryId,
  onActionDone,
}: {
  bet: SettlingBet;
  walletAddress: string;
  contractDeployed: boolean;
  packageId: string | null;
  registryId: string | null;
  onActionDone: () => void;
}) {
  const { toast } = useToast();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [secs, setSecs]           = useState(bet.secondsRemaining);
  const [disputing, setDisputing] = useState(false);
  const [claiming, setClaiming]   = useState(false);
  const [done, setDone]           = useState<'disputed' | 'claimed' | null>(
    bet.alreadyDisputed ? 'disputed' : null
  );
  const rafRef = useRef<number>(0);
  const deadlineRef = useRef(new Date(bet.disputeDeadline).getTime());

  // Tick every second using rAF — stays accurate across tab switches
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000));
      setSecs(remaining);
      if (remaining > 0) {
        rafRef.current = window.setTimeout(tick, 1000);
      }
    };
    tick();
    return () => clearTimeout(rafRef.current);
  }, []);

  const canDispute = secs > 0 && !done;
  const canClaim   = secs <= 0 && !done;

  // ── Dispute ─────────────────────────────────────────────────────────────────
  const handleDispute = useCallback(async () => {
    if (!canDispute || disputing) return;
    setDisputing(true);
    try {
      if (contractDeployed && bet.ptbCallData && bet.onchainId && packageId && registryId) {
        // On-chain path: construct PTB + sign via user's wallet
        const txb = new Transaction();
        txb.setSender(walletAddress);
        txb.moveCall({
          target:        bet.ptbCallData.target,
          typeArguments: bet.ptbCallData.typeArguments,
          arguments: [
            txb.object(bet.ptbCallData.arguments.config),
            txb.object(bet.ptbCallData.arguments.bet),
            txb.object(bet.ptbCallData.arguments.clock),
          ],
        });
        const result = await signAndExecute({ transaction: txb });
        const digest = (result as any)?.digest ?? (result as any)?.Transaction?.digest ?? 'unknown';

        // Also record in DB
        await fetch(`/api/p2p/bets/${bet.dbId}/dispute`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ disputerWallet: walletAddress, coinType: bet.coinType }),
        });

        toast({
          title:       '⚔️ Dispute Submitted On-chain',
          description: `Tx: ${digest.slice(0, 12)}… — admin will review within 24h.`,
        });
      } else {
        // Off-chain path: REST endpoint records intent for admin
        const res  = await fetch(`/api/p2p/bets/${bet.dbId}/dispute`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ disputerWallet: walletAddress, coinType: bet.coinType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Dispute failed');
        toast({
          title:       '📋 Dispute Recorded',
          description: 'Flagged for admin review — you will be notified of the outcome.',
        });
      }
      setDone('disputed');
      onActionDone();
    } catch (e: any) {
      toast({ title: 'Dispute failed', description: e.message, variant: 'destructive' });
    } finally {
      setDisputing(false);
    }
  }, [canDispute, disputing, contractDeployed, bet, packageId, registryId, walletAddress, signAndExecute, toast, onActionDone]);

  // ── Claim ────────────────────────────────────────────────────────────────────
  const handleClaim = useCallback(async () => {
    if (!canClaim || claiming) return;
    setClaiming(true);
    try {
      const res  = await fetch(`/api/p2p/${bet.isParlay ? 'parlays' : 'bets'}/${bet.dbId}/claim`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ coinType: bet.coinType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Claim failed');
      toast({
        title:       '🏆 Claim Submitted',
        description: data.message ?? 'Payout in progress — settlement worker will confirm.',
      });
      setDone('claimed');
      onActionDone();
    } catch (e: any) {
      toast({ title: 'Claim failed', description: e.message, variant: 'destructive' });
    } finally {
      setClaiming(false);
    }
  }, [canClaim, claiming, bet, toast, onActionDone]);

  // ── Urgency ring color class ─────────────────────────────────────────────────
  const pct    = bet.totalWindowSecs > 0 ? secs / bet.totalWindowSecs : 0;
  const urgency =
    done             ? 'border-gray-700/50 bg-[#111827]' :
    canClaim         ? 'border-blue-500/30 bg-blue-500/5' :
    pct > 0.5        ? 'border-green-500/30 bg-green-500/5' :
    pct > 0.2        ? 'border-yellow-500/30 bg-yellow-500/5' :
    pct > 0.05       ? 'border-orange-500/30 bg-orange-500/5' :
                       'border-red-500/40 bg-red-500/8 animate-pulse';

  const predLabel =
    bet.prediction === 'home' ? `🏠 ${bet.homeTeam ?? 'Home'}` :
    bet.prediction === 'away' ? `✈️ ${bet.awayTeam ?? 'Away'}` :
    bet.prediction === 'draw' ? '🤝 Draw' :
    bet.prediction ?? '?';

  const coinColor =
    bet.currency === 'SBETS'  ? 'text-purple-400' :
    bet.currency === 'USDSUI' ? 'text-green-400'  : 'text-cyan-400';

  return (
    <div className={`rounded-xl border p-4 transition-colors ${urgency}`}>
      <div className="flex items-start gap-4">
        {/* Countdown ring */}
        <CountdownRing
          secondsRemaining={done ? 0 : secs}
          totalSecs={bet.totalWindowSecs}
          size={64}
        />

        {/* Bet info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="font-bold text-sm text-white truncate">{bet.eventName}</div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {bet.onchainId && (
                <a href={bet.suiscanUrl!} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:text-cyan-300">
                  <Shield size={8} /> ⛓
                </a>
              )}
              {done === 'disputed' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                  DISPUTED
                </span>
              )}
              {done === 'claimed' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                  CLAIMED
                </span>
              )}
              {!done && canClaim && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse">
                  CLAIMABLE
                </span>
              )}
            </div>
          </div>

          {/* Your prediction + result */}
          <div className="flex items-center gap-2 flex-wrap text-xs mb-2">
            <span className="text-gray-400">Your pick:</span>
            <span className="text-white font-bold">{predLabel}</span>
            <span className="text-gray-600">·</span>
            <span className={`font-bold ${coinColor}`}>
              {bet.yourSide === 'creator' ? bet.creatorStake : bet.takerStake} {bet.currency}
            </span>
            {bet.winner && (
              <>
                <span className="text-gray-600">·</span>
                <span className={`font-bold flex items-center gap-0.5 ${bet.youWon ? 'text-green-400' : 'text-red-400'}`}>
                  {bet.youWon
                    ? <><CheckCircle size={11} /> You won!</>
                    : <><AlertTriangle size={11} /> You lost</>}
                </span>
              </>
            )}
          </div>

          {/* Timing note */}
          {!done && canDispute && (
            <p className="text-[10px] text-gray-500 mb-3">
              Result was recorded {bet.settledAt ? new Date(bet.settledAt).toLocaleTimeString() : 'recently'}.
              Dispute closes when the timer hits zero — after that the payout will be sent automatically.
            </p>
          )}
          {!done && canClaim && (
            <p className="text-[10px] text-blue-400/80 mb-3">
              Dispute window has closed. You can now claim your payout.
            </p>
          )}

          {/* Action buttons */}
          {!done && (
            <div className="flex gap-2">
              {canDispute && (
                <button
                  onClick={handleDispute}
                  disabled={disputing}
                  className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-black text-xs px-4 py-2 rounded-lg transition-colors"
                >
                  {disputing
                    ? <><Loader2 size={12} className="animate-spin" /> Submitting…</>
                    : <><AlertTriangle size={12} /> Dispute Result</>}
                </button>
              )}
              {canClaim && (
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-black text-xs px-4 py-2 rounded-lg transition-colors"
                >
                  {claiming
                    ? <><Loader2 size={12} className="animate-spin" /> Claiming…</>
                    : <><CheckCircle size={12} /> Claim Payout</>}
                </button>
              )}
              {bet.suiscanUrl && (
                <a href={bet.suiscanUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-gray-500 hover:text-cyan-400 text-xs transition-colors px-2 py-2">
                  <ExternalLink size={11} /> SuiScan
                </a>
              )}
            </div>
          )}

          {/* PTB note (on-chain) */}
          {!done && canDispute && contractDeployed && bet.ptbCallData && (
            <p className="text-[10px] text-cyan-400/70 mt-2 flex items-center gap-1">
              <Shield size={9} />
              This will submit a Programmable Transaction Block signed by your wallet — no gas paid upfront.
            </p>
          )}
          {!done && canDispute && !contractDeployed && (
            <p className="text-[10px] text-gray-600 mt-2">
              Contract not yet deployed — dispute is recorded off-chain and reviewed by admin.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function DisputeCountdown() {
  const account     = useCurrentAccount();
  const wallet      = account?.address ?? null;
  const qc          = useQueryClient();

  const { data, isLoading, error } = useQuery<SettlingResponse>({
    queryKey:      ['/api/p2p/settling', wallet],
    queryFn:       () => fetch(`/api/p2p/settling?wallet=${wallet}`).then(r => r.json()),
    enabled:       !!wallet,
    refetchInterval: 15_000,   // poll every 15s to catch new settlements
    staleTime:     10_000,
  });

  const onActionDone = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['/api/p2p/settling', wallet] });
    qc.invalidateQueries({ queryKey: ['/api/p2p/my', wallet] });
  }, [qc, wallet]);

  if (!wallet) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">🔗</div>
        <div className="text-gray-400 font-bold">Connect your wallet to track settling bets</div>
        <div className="text-gray-600 text-sm mt-2">The dispute window opens automatically when a match result comes in.</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Loader2 size={28} className="animate-spin mx-auto mb-3 text-cyan-500" />
        Checking for settling bets…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        <AlertTriangle size={28} className="mx-auto mb-3" />
        Failed to load settling bets
      </div>
    );
  }

  const items = data?.settling ?? [];

  return (
    <div className="space-y-4">
      {/* Explainer card */}
      <div className="bg-gradient-to-r from-orange-900/20 to-yellow-900/20 border border-orange-500/25 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Clock size={18} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-white font-black text-sm mb-1">⏳ 2-Hour Dispute Window</div>
            <p className="text-gray-400 text-xs leading-relaxed">
              After each match result is recorded, both sides have <strong className="text-orange-300">2 hours</strong> to raise a dispute
              if they believe the result is wrong. The countdown is permanent and on-chain — nobody can extend it.
              Once it hits zero the settlement is final and the winner is paid automatically.
            </p>
            <div className="mt-2 flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/> &gt;1h left — safe zone</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0"/> &lt;1h left — act soon</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"/> &lt;5m left — urgent!</div>
            </div>
          </div>
        </div>
      </div>

      {/* How dispute works (on-chain vs off-chain) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`rounded-xl p-3 border ${data?.contractDeployed ? 'border-cyan-500/30 bg-cyan-500/8' : 'border-gray-700/30 bg-gray-800/20'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <Shield size={13} className="text-cyan-400" />
            <span className="text-cyan-400 font-bold text-xs">On-chain PTB Dispute</span>
            {!data?.contractDeployed && <span className="text-[10px] text-gray-500 ml-auto">Coming after contract deploy</span>}
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            A Programmable Transaction Block is constructed client-side and signed by your wallet.
            The dispute is recorded permanently on Sui — immutable, no admin gate.
          </p>
        </div>
        <div className="rounded-xl p-3 border border-yellow-500/25 bg-yellow-500/5">
          <div className="flex items-center gap-2 mb-1.5">
            <Swords size={13} className="text-yellow-400" />
            <span className="text-yellow-400 font-bold text-xs">Off-chain Dispute (current)</span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Dispute intent is recorded in the DB and reviewed by the admin team within 24 hours.
            Result is reversed or upheld — loser is notified.
          </p>
        </div>
      </div>

      {/* Bet cards */}
      {items.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">✅</div>
          <div className="text-gray-400 font-bold">No bets in the dispute window right now</div>
          <div className="text-gray-600 text-sm mt-2">
            Settling bets appear here the moment a match result is recorded — and disappear when they're claimed.
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-orange-400 font-bold text-sm">{items.length} bet{items.length > 1 ? 's' : ''} in dispute window</span>
          </div>
          {items.map((bet) => (
            <SettlingCard
              key={`${bet.isParlay ? 'p' : 'b'}-${bet.dbId}`}
              bet={bet}
              walletAddress={wallet}
              contractDeployed={data?.contractDeployed ?? false}
              packageId={data?.packageId ?? null}
              registryId={data?.registryId ?? null}
              onActionDone={onActionDone}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default DisputeCountdown;
