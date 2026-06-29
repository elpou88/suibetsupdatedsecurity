import { useRef } from 'react';
import { useWsOn } from './useWebSocket';
import { useToast } from './use-toast';

const LS_KEY = 'suibets:settlement_unseen';

export function getUnseenSettlementCount(): number {
  try { return parseInt(localStorage.getItem(LS_KEY) ?? '0', 10) || 0; } catch { return 0; }
}

export function clearUnseenSettlements() {
  try {
    localStorage.setItem(LS_KEY, '0');
    window.dispatchEvent(new CustomEvent('suibets:settlement-badge-update', { detail: 0 }));
  } catch {}
}

function incrementUnseen() {
  const n = getUnseenSettlementCount() + 1;
  try {
    localStorage.setItem(LS_KEY, String(n));
    window.dispatchEvent(new CustomEvent('suibets:settlement-badge-update', { detail: n }));
  } catch {}
}

export function useSettlementNotifications(walletAddress: string | null | undefined) {
  const { toast } = useToast();
  const walletRef = useRef(walletAddress);
  walletRef.current = walletAddress;

  useWsOn((msg) => {
    if (msg.type !== 'p2p-settlement') return;
    const wallet = walletRef.current?.toLowerCase();
    if (!wallet) return;

    const d = msg.data;
    const winnerWallet = (d.winnerWallet ?? '').toLowerCase();
    const loserWallet  = (d.loserWallet  ?? '').toLowerCase();
    if (wallet !== winnerWallet && wallet !== loserWallet) return;

    const isWin     = wallet === winnerWallet;
    const currency  = d.currency ?? 'SUI';
    const payout    = typeof d.payout === 'number' ? d.payout.toFixed(3) : '?';
    const eventName = d.eventName ?? (d.homeTeam && d.awayTeam ? `${d.homeTeam} vs ${d.awayTeam}` : 'your bet');
    const typeLabel = d.betType === 'parlay' ? 'Parlay' : 'Bet';
    const txSnippet = d.txHash ? ` · TX: ${String(d.txHash).slice(0, 10)}…` : '';

    incrementUnseen();

    toast({
      title: isWin ? `🏆 ${typeLabel} Won!` : `❌ ${typeLabel} Lost`,
      description: isWin
        ? `${eventName} — You won ${payout} ${currency}${txSnippet}`
        : `${eventName} — Better luck next time.`,
      variant: isWin ? 'default' : 'destructive',
    });
  });
}
