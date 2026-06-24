import { useRef } from 'react';
import { useWsOn } from './useWebSocket';
import { useToast } from './use-toast';

interface MatchNotification {
  dbOfferId:     number;
  creatorWallet: string;
  takerWallet:   string;
  eventName:     string;
  homeTeam:      string;
  awayTeam:      string;
  prediction:    string;
  odds:          number;
  fillAmount:    number;
  currency:      string;
  txDigest:      string;
  ts:            number;
}

function predLabel(prediction: string, homeTeam: string, awayTeam: string): string {
  const p = (prediction || '').toLowerCase();
  if (p === 'home') return `🏠 ${homeTeam || 'Home'} wins`;
  if (p === 'away') return `✈️ ${awayTeam || 'Away'} wins`;
  if (p === 'draw') return '🤝 Draw';
  return prediction;
}

export function useP2PMatchNotifications(walletAddress: string | null | undefined) {
  const { toast } = useToast();
  const walletRef  = useRef(walletAddress);
  walletRef.current = walletAddress;

  // Track seen offer IDs so duplicate WS deliveries don't double-toast
  const seenRef = useRef<Set<number>>(new Set());

  useWsOn((msg) => {
    if (msg.type !== 'p2p-match-notification') return;

    const wallet = walletRef.current?.toLowerCase();
    if (!wallet) return;

    const d = msg.data as MatchNotification;
    const creator = (d.creatorWallet ?? '').toLowerCase();

    // Only notify the offer creator
    if (wallet !== creator) return;

    // Deduplicate
    if (seenRef.current.has(d.dbOfferId)) return;
    seenRef.current.add(d.dbOfferId);
    // Keep set bounded
    if (seenRef.current.size > 200) seenRef.current.clear();

    const currency   = d.currency ?? 'SUI';
    const fillAmount = typeof d.fillAmount === 'number' ? d.fillAmount.toFixed(4) : '?';
    const eventName  = d.eventName || (d.homeTeam && d.awayTeam ? `${d.homeTeam} vs ${d.awayTeam}` : 'your bet');
    const selection  = predLabel(d.prediction, d.homeTeam, d.awayTeam);
    const takerSnip  = d.takerWallet ? `${d.takerWallet.slice(0, 6)}…${d.takerWallet.slice(-4)}` : 'Someone';
    const txSnip     = d.txDigest    ? ` · TX: ${d.txDigest.slice(0, 10)}…` : '';
    const oddsStr    = typeof d.odds === 'number' ? `${d.odds.toFixed(2)}x` : '';

    toast({
      title: '⚔️ Your offer was matched!',
      description: `${takerSnip} accepted your ${oddsStr} ${selection} bet on ${eventName} — ${fillAmount} ${currency} staked${txSnip}`,
    });
  });
}
