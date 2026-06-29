import { useState, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/hooks/use-toast';
import CleanHome from '@/pages/clean-home';
import {
  X, Share2, Check, Loader2, Shield, ExternalLink, Copy,
  Clock, ArrowRight, Info, AlertTriangle,
} from 'lucide-react';

// ── Coin / contract constants (mainnet) ──────────────────────────────────────
const SUI_COIN    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const SBETS_COIN  = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const USDSUI_COIN = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
const CLOCK_ID    = '0x0000000000000000000000000000000000000000000000000000000000000006';

const coinType = (c: string) =>
  c === 'SBETS' ? SBETS_COIN : c === 'USDSUI' ? USDSUI_COIN : SUI_COIN;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const predLabel = (pred: string, home: string, away: string) => {
  if (pred === 'home') return home;
  if (pred === 'away') return away;
  if (pred === 'draw') return 'Draw';
  return pred;
};
const oppLabel = (pred: string, home: string, away: string) => {
  if (pred === 'home') return `${away} or Draw`;
  if (pred === 'away') return `${home} or Draw`;
  if (pred === 'draw') return `${home} or ${away}`;
  return 'opposite';
};

const fmtTimeLeft = (expiresAt: string) => {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0)  return `${h}h ${m}m`;
  return `${m}m`;
};

// ── Types ─────────────────────────────────────────────────────────────────────
type Offer = {
  id: number;
  creatorWallet: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  leagueName?: string;
  sportName?: string;
  prediction: string;
  odds: number;
  creatorStake: number;
  takerStake: number;
  filledStake: number;
  currency: string;
  status: string;
  expiresAt: string;
  onchainOfferId?: string;
};

type Parlay = {
  id: number;
  creatorWallet: string;
  totalOdds: number;
  legCount: number;
  creatorStake: number;
  takerStake: number;
  currency: string;
  status: string;
  expiresAt: string;
  onchainParlayId?: string;
  legs: Array<{
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    prediction: string;
    odds: number;
    status: string;
  }>;
};

// ── PayoutBreakdown ───────────────────────────────────────────────────────────
function PayoutBreakdown({ grossPot, takerFee, winnerPayout, currency }: {
  grossPot: number; takerFee: number; winnerPayout: number; currency: string;
}) {
  return (
    <div className="bg-[#0d1420] border border-[#1e2a3a] rounded-xl p-3 space-y-2 text-sm">
      <div className="flex justify-between text-gray-400">
        <span>Gross pot</span>
        <span className="text-white font-medium">{grossPot.toFixed(4)} {currency}</span>
      </div>
      <div className="flex justify-between text-gray-400">
        <span>Platform fee (2%)</span>
        <span className="text-red-400">−{takerFee.toFixed(4)} {currency}</span>
      </div>
      <div className="border-t border-[#1e2a3a] pt-2 flex justify-between font-bold">
        <span className="text-gray-300">You receive if you win</span>
        <span className="text-green-400">{winnerPayout.toFixed(4)} {currency}</span>
      </div>
    </div>
  );
}

// ── Accept modal for a single offer ──────────────────────────────────────────
function OfferAcceptModal({ offer, contractWallet, packageId, configId, registryId, onClose, onDone }: {
  offer: Offer;
  contractWallet: string;
  packageId: string;
  configId: string;
  registryId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const account = useCurrentAccount();
  const myWallet = account?.address ?? '';
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { toast } = useToast();

  const [stake, setStake] = useState('');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');

  const isOnchain = !!(offer.onchainOfferId && packageId && configId && registryId);
  const maxStake = r3(offer.takerStake - (offer.filledStake ?? 0));
  const stakeNum = parseFloat(stake) || 0;
  const grossPot = stakeNum > 0 ? r3(stakeNum + offer.creatorStake * (stakeNum / offer.takerStake)) : 0;
  const takerFee = r3(grossPot * 0.02);
  const winnerPayout = r3(grossPot - takerFee);

  const handleAccept = async () => {
    if (stakeNum <= 0 || stakeNum > maxStake + 0.0001) return;
    setSignError('');
    if (!myWallet) { setSignError('Connect your wallet first'); return; }
    setSigning(true);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);
      const decimals = offer.currency === 'USDSUI' ? 6 : 9;
      const amountBase = BigInt(Math.round(stakeNum * Math.pow(10, decimals)));
      const ct = coinType(offer.currency);

      let paymentCoin: any;
      if (offer.currency === 'SUI') {
        [paymentCoin] = tx.splitCoins(tx.gas, [amountBase]);
      } else {
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType: ct });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${offer.currency} in your wallet`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amountBase]);
      }

      if (isOnchain) {
        tx.moveCall({
          target: `${packageId}::p2p_betting::accept_offer`,
          typeArguments: [ct],
          arguments: [
            tx.object(configId),
            tx.object(registryId),
            tx.object(offer.onchainOfferId!),
            paymentCoin,
            tx.pure.u64(amountBase),
            tx.object(CLOCK_ID),
          ],
        });
      } else {
        if (!contractWallet) throw new Error('No escrow wallet configured');
        tx.transferObjects([paymentCoin], contractWallet);
      }

      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest ?? '';
      if (!digest) throw new Error('No transaction digest returned');

      // Register acceptance with the API
      await fetch(`/api/p2p/offers/${offer.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: myWallet, stake: stakeNum, txHash: digest }),
      });

      toast({ title: 'Bet accepted!', description: `TX: ${digest.slice(0, 16)}…` });
      onDone();
    } catch (e: any) {
      setSignError(e.message ?? 'Wallet signing failed');
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-4">
      <div className="bg-[#111827] border border-cyan-500/30 rounded-2xl p-5 w-full max-w-sm mx-4 my-auto">
        <h2 className="text-white font-black text-xl mb-1">Accept This Bet</h2>
        <p className="text-gray-500 text-xs mb-4">Take the opposite side of this offer</p>

        {isOnchain && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Shield size={12} className="text-green-400 flex-shrink-0" />
            <span className="text-green-400 text-xs font-medium">On-chain escrow · wallet signs in one step</span>
          </div>
        )}

        <div className="bg-[#0d1420] rounded-xl p-3 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Match</span>
            <span className="text-white font-medium text-right max-w-[60%] truncate">{offer.eventName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Creator picked</span>
            <span className="text-green-400 font-bold">{predLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">You back</span>
            <span className="text-orange-400 font-bold">{oppLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Odds</span>
            <span className="text-cyan-400 font-bold">{Number(offer.odds ?? 0).toFixed(2)}x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Max stake</span>
            <span className="text-cyan-400 font-bold">{maxStake.toFixed(4)} {offer.currency}</span>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-gray-400 text-xs mb-1.5 block">
            Your Stake ({offer.currency}) — partial fill supported
          </label>
          <input
            type="number"
            value={stake}
            onChange={e => setStake(e.target.value)}
            max={maxStake}
            step="0.01"
            placeholder={`0 – ${maxStake.toFixed(4)}`}
            className="w-full bg-[#0d1420] border border-[#1e2a3a] focus:border-cyan-500 rounded-lg px-3 py-2 text-white outline-none"
          />
        </div>

        {stakeNum > 0 && (
          <div className="mb-4">
            <div className="text-gray-500 text-xs mb-2 flex items-center gap-1"><Info size={11} /> Payout breakdown</div>
            <PayoutBreakdown grossPot={grossPot} takerFee={takerFee} winnerPayout={winnerPayout} currency={offer.currency} />
          </div>
        )}

        {signError && <p className="text-red-400 text-xs mb-3 px-1">{signError}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={signing}
            className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={stakeNum <= 0 || stakeNum > maxStake + 0.0001 || signing}
            className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {signing ? <><Loader2 size={14} className="animate-spin" /> Signing…</> : 'Accept Bet'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Accept modal for a parlay ─────────────────────────────────────────────────
function ParlayAcceptModal({ parlay, contractWallet, packageId, configId, onClose, onDone }: {
  parlay: Parlay;
  contractWallet: string;
  packageId: string;
  configId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const account = useCurrentAccount();
  const myWallet = account?.address ?? '';
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { toast } = useToast();

  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');

  const isOnchain = !!(parlay.onchainParlayId && packageId && configId);
  const grossPot = r3(parlay.creatorStake + parlay.takerStake);
  const takerFee = r3(grossPot * 0.02);
  const winnerPayout = r3(grossPot - takerFee);

  const handleAccept = async () => {
    setSignError('');
    if (!myWallet) { setSignError('Connect your wallet first'); return; }
    setSigning(true);
    try {
      const tx = new Transaction();
      tx.setSender(myWallet);
      tx.setGasBudget(20_000_000);
      const decimals = parlay.currency === 'USDSUI' ? 6 : 9;
      const amountBase = BigInt(Math.round(parlay.takerStake * Math.pow(10, decimals)));
      const ct = coinType(parlay.currency);

      let paymentCoin: any;
      if (parlay.currency === 'SUI') {
        [paymentCoin] = tx.splitCoins(tx.gas, [amountBase]);
      } else {
        const allCoins = await (suiClient as any).getCoins({ owner: myWallet, coinType: ct });
        const coins: any[] = allCoins?.data ?? [];
        if (!coins.length) throw new Error(`No ${parlay.currency} in your wallet`);
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
        [paymentCoin] = tx.splitCoins(primary, [amountBase]);
      }

      if (isOnchain) {
        tx.moveCall({
          target: `${packageId}::p2p_betting::accept_parlay`,
          typeArguments: [ct],
          arguments: [
            tx.object(configId),
            tx.object(parlay.onchainParlayId!),
            paymentCoin,
            tx.object(CLOCK_ID),
          ],
        });
      } else {
        if (!contractWallet) throw new Error('No escrow wallet configured');
        tx.transferObjects([paymentCoin], contractWallet);
      }

      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest ?? '';
      if (!digest) throw new Error('No transaction digest returned');

      await fetch(`/api/p2p/parlays/${parlay.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takerWallet: myWallet, txHash: digest }),
      });

      toast({ title: 'Parlay accepted!', description: `TX: ${digest.slice(0, 16)}…` });
      onDone();
    } catch (e: any) {
      setSignError(e.message ?? 'Wallet signing failed');
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-4">
      <div className="bg-[#111827] border border-purple-500/30 rounded-2xl p-5 w-full max-w-sm mx-4 my-auto">
        <h2 className="text-white font-black text-xl mb-1">Accept This Parlay</h2>
        <p className="text-gray-500 text-xs mb-4">You win if ANY of the creator's legs fails</p>

        {isOnchain && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Shield size={12} className="text-green-400 flex-shrink-0" />
            <span className="text-green-400 text-xs font-medium">On-chain escrow · wallet signs in one step</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2">
            <div className="text-green-400 font-bold mb-1">Creator wins if…</div>
            <div className="text-gray-300">ALL legs hit</div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-2">
            <div className="text-orange-400 font-bold mb-1">You win if…</div>
            <div className="text-gray-300">ANY leg fails</div>
          </div>
        </div>

        <div className="bg-[#0d1420] rounded-xl p-3 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Legs</span>
            <span className="text-purple-400 font-bold">{parlay.legCount} selections</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Combined odds</span>
            <span className="text-white font-bold">{Number(parlay.totalOdds ?? 0).toFixed(2)}x</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Creator stakes</span>
            <span className="text-green-400 font-bold">{parlay.creatorStake} {parlay.currency}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Your stake</span>
            <span className="text-orange-400 font-bold">{parlay.takerStake.toFixed(4)} {parlay.currency}</span>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-gray-500 text-xs mb-2 flex items-center gap-1"><Info size={11} /> Payout breakdown</div>
          <PayoutBreakdown grossPot={grossPot} takerFee={takerFee} winnerPayout={winnerPayout} currency={parlay.currency} />
        </div>

        {signError && <p className="text-red-400 text-xs mb-3 px-1">{signError}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={signing}
            className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={signing}
            className="flex-1 bg-purple-500 hover:bg-purple-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {signing ? <><Loader2 size={14} className="animate-spin" /> Signing…</> : 'Accept Parlay'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SharedP2POfferPage() {
  const [, offerParams] = useRoute('/p2p/offer/:id');
  const [, parlayParams] = useRoute('/p2p/parlay/:id');
  const [, setLocation] = useLocation();

  const isParlay = !!parlayParams;
  const id = offerParams?.id ?? parlayParams?.id;

  const [showAccept, setShowAccept] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: offer, isLoading: loadingOffer, error: offerError } = useQuery<Offer>({
    queryKey: [`/api/p2p/offers/${id}`],
    queryFn: () => fetch(`/api/p2p/offers/${id}`).then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); }),
    enabled: !!id && !isParlay,
  });

  const { data: parlay, isLoading: loadingParlay, error: parlayError } = useQuery<Parlay>({
    queryKey: [`/api/p2p/parlays/${id}`],
    queryFn: () => fetch(`/api/p2p/parlays/${id}`).then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); }),
    enabled: !!id && isParlay,
  });

  const { data: contractData } = useQuery<{ wallet: string; onchainEscrow?: boolean }>({
    queryKey: ['/api/p2p/contract-wallet'],
    queryFn: () => fetch('/api/p2p/contract-wallet').then(r => r.json()),
    staleTime: Infinity,
  });

  const { data: onchainBook } = useQuery<{ packageId?: string; configId?: string; registryId?: string }>({
    queryKey: ['/api/p2p/onchain-book'],
    queryFn: () => fetch('/api/p2p/onchain-book').then(r => r.json()),
    staleTime: Infinity,
  });

  const contractWallet = contractData?.wallet ?? '';
  const packageId  = onchainBook?.packageId  ?? '';
  const configId   = onchainBook?.configId   ?? '';
  const registryId = onchainBook?.registryId ?? '';

  const isLoading = isParlay ? loadingParlay : loadingOffer;
  const hasError  = isParlay ? !!parlayError  : !!offerError;
  const item      = isParlay ? parlay : offer;

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/p2p/${isParlay ? 'parlay' : 'offer'}/${id}`
    : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleShareOnX = () => {
    let tweetText = '';
    if (!isParlay && offer) {
      const predLbl = offer.prediction === 'home' ? offer.homeTeam : offer.prediction === 'away' ? offer.awayTeam : 'Draw';
      const maxWin = r3((offer.creatorStake + offer.takerStake) * 0.98);
      tweetText = `🎯 P2P Bet: ${offer.homeTeam} vs ${offer.awayTeam}\n${predLbl} @ ${Number(offer.odds ?? 0).toFixed(2)}x odds\n💰 Max win: ${maxWin} ${offer.currency}\n\nAccept my bet on SuiBets 👇`;
    } else if (isParlay && parlay) {
      const legSummary = parlay.legs.slice(0, 2).map(l => `${l.homeTeam} vs ${l.awayTeam}`).join(', ');
      const maxWin = r3((parlay.creatorStake + parlay.takerStake) * 0.98);
      tweetText = `🎰 ${parlay.legCount}-Leg Parlay @ ${Number(parlay.totalOdds ?? 0).toFixed(2)}x\n${legSummary}${parlay.legs.length > 2 ? ` +${parlay.legs.length - 2} more` : ''}\n💰 Win: ${maxWin} ${parlay.currency}\n\nAccept my parlay on SuiBets 👇`;
    }
    const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(xUrl, '_blank', 'noopener,noreferrer');
  };

  // Dynamic document title
  useEffect(() => {
    if (!isParlay && offer) {
      document.title = `${offer.homeTeam} vs ${offer.awayTeam} @ ${Number(offer.odds ?? 0).toFixed(2)}x — SuiBets P2P`;
    } else if (isParlay && parlay) {
      document.title = `${parlay.legCount}-Leg Parlay @ ${Number(parlay.totalOdds ?? 0).toFixed(2)}x — SuiBets P2P`;
    }
    return () => { document.title = 'SuiBets'; };
  }, [offer, parlay, isParlay]);

  const statusColor = (status: string) => {
    if (status === 'open') return 'text-green-400 bg-green-500/15 border-green-500/30';
    if (status === 'filled') return 'text-blue-400 bg-blue-500/15 border-blue-500/30';
    if (status === 'cancelled' || status === 'expired') return 'text-red-400 bg-red-500/15 border-red-500/30';
    return 'text-gray-400 bg-gray-500/15 border-gray-500/30';
  };

  const canAccept = item?.status === 'open' && !accepted;

  return (
    <>
      <CleanHome />

      {/* Overlay */}
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setLocation('/p2p')} />

        <div className="relative z-10 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto rounded-2xl">
          {/* Close */}
          <button
            onClick={() => setLocation('/p2p')}
            className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/40 text-gray-400 hover:text-white hover:bg-black/60 transition-colors"
          >
            <X size={18} />
          </button>

          {/* Loading */}
          {isLoading && (
            <div className="bg-[#0d1b2a] rounded-2xl border border-cyan-900/40 p-12 text-center">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-400">Loading bet details…</p>
            </div>
          )}

          {/* Error */}
          {hasError && !isLoading && (
            <div className="bg-[#0d1b2a] rounded-2xl border border-red-900/40 p-10 text-center">
              <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <p className="text-white text-lg font-bold mb-2">Bet Not Found</p>
              <p className="text-gray-400 mb-6">This link may be invalid or the bet may have been cancelled.</p>
              <button onClick={() => setLocation('/p2p')} className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-3 rounded-xl">
                Browse Offers
              </button>
            </div>
          )}

          {/* Offer card */}
          {!isLoading && !hasError && offer && !isParlay && (
            <div className="space-y-3">
              <div className="bg-[#0d1117] rounded-2xl border border-cyan-900/30 overflow-hidden">
                {/* Header */}
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">P2P Bet Offer</p>
                      <h2 className="text-white font-black text-base leading-snug">{offer.eventName}</h2>
                      {offer.leagueName && <p className="text-gray-600 text-xs mt-0.5">{offer.leagueName}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusColor(offer.status)}`}>
                        {offer.status.toUpperCase()}
                      </span>
                      {offer.onchainOfferId && (
                        <a
                          href={`https://suiscan.xyz/mainnet/object/${offer.onchainOfferId}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:text-cyan-300"
                        >
                          <Shield size={9} /> On-chain <ExternalLink size={8} />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Matchup */}
                  <div className="flex items-stretch gap-2 mb-3">
                    <div className="flex-1 bg-green-500/5 border border-green-500/12 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">Creator bets</div>
                      <div className="text-green-400 font-bold text-sm truncate">{predLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}</div>
                      <div className="text-white font-black text-base mt-1">
                        {offer.creatorStake.toLocaleString()} <span className="text-gray-500 font-normal text-xs">{offer.currency}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-center text-gray-700 font-black text-lg px-1">⚔</div>
                    <div className="flex-1 bg-orange-500/5 border border-orange-500/12 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">You stake</div>
                      <div className="text-orange-400 font-bold text-sm truncate">{oppLabel(offer.prediction, offer.homeTeam, offer.awayTeam)}</div>
                      <div className="text-white font-black text-base mt-1">
                        {r3(offer.takerStake - (offer.filledStake ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 3 })} <span className="text-gray-500 font-normal text-xs">{offer.currency}</span>
                      </div>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-[#0a0d14] rounded-lg p-2">
                      <div className="text-[10px] text-gray-600 uppercase mb-0.5">Odds</div>
                      <div className="text-cyan-400 font-black">{Number(offer.odds ?? 0).toFixed(2)}x</div>
                    </div>
                    <div className="bg-[#0a0d14] rounded-lg p-2">
                      <div className="text-[10px] text-gray-600 uppercase mb-0.5">Max win</div>
                      <div className="text-green-400 font-bold text-xs">≈{r3((offer.creatorStake + offer.takerStake) * 0.98).toLocaleString(undefined, { maximumFractionDigits: 2 })} {offer.currency}</div>
                    </div>
                    <div className="bg-[#0a0d14] rounded-lg p-2">
                      <div className="text-[10px] text-gray-600 uppercase mb-0.5">Expires</div>
                      <div className="text-yellow-400 font-bold text-xs flex items-center justify-center gap-0.5"><Clock size={9} />{fmtTimeLeft(offer.expiresAt)}</div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-[#1a2235] px-5 py-3 bg-[#0a0d14] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-600 text-[10px]">By</span>
                    <a
                      href={`https://suiscan.xyz/mainnet/account/${offer.creatorWallet}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-gray-500 hover:text-cyan-400 text-xs font-mono"
                    >
                      {offer.creatorWallet.slice(0, 6)}…{offer.creatorWallet.slice(-4)}
                    </a>
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-cyan-400 transition-colors"
                  >
                    {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              {accepted ? (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center">
                  <Check className="h-8 w-8 text-green-400 mx-auto mb-2" />
                  <p className="text-green-400 font-bold">Bet accepted successfully!</p>
                  <button onClick={() => setLocation('/p2p')} className="mt-3 text-xs text-gray-400 hover:text-white transition-colors underline">
                    Go to P2P hub
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-3">
                    {canAccept && (
                      <button
                        onClick={() => setShowAccept(true)}
                        className="flex-1 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-black transition-all"
                      >
                        Accept This Bet <ArrowRight size={15} />
                      </button>
                    )}
                    {!canAccept && offer.status !== 'open' && (
                      <div className="flex-1 py-3.5 rounded-xl text-sm text-center font-bold text-gray-500 bg-gray-800/60">
                        This offer is {offer.status}
                      </div>
                    )}
                    <button
                      onClick={handleCopyLink}
                      title="Copy link"
                      className="py-3.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2 bg-[#0f1923] border border-cyan-900/30 text-gray-300 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors"
                    >
                      {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                    </button>
                  </div>
                  <button
                    onClick={handleShareOnX}
                    className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors text-white"
                    style={{ background: '#000', border: '1px solid rgba(255,255,255,0.15)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#000')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.258 5.639 5.906-5.639Zm-1.161 17.52h1.833L7.084 4.126H5.117Z"/></svg>
                    Share on X
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Parlay card */}
          {!isLoading && !hasError && parlay && isParlay && (
            <div className="space-y-3">
              <div className="bg-[#0d1117] rounded-2xl border border-purple-900/30 overflow-hidden">
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">P2P Parlay</p>
                      <h2 className="text-white font-black text-base">
                        {parlay.legCount}-Leg Parlay
                        <span className="text-purple-400 ml-2 font-normal text-sm">@ {Number(parlay.totalOdds ?? 0).toFixed(2)}x</span>
                      </h2>
                      <p className="text-gray-600 text-xs mt-0.5">
                        {parlay.legs.slice(0, 2).map(l => l.homeTeam.split(' ').slice(-1)[0]).join(' · ')}
                        {parlay.legs.length > 2 && ` +${parlay.legs.length - 2} more`}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusColor(parlay.status)}`}>
                        {parlay.status.toUpperCase()}
                      </span>
                      {parlay.onchainParlayId && (
                        <a
                          href={`https://suiscan.xyz/mainnet/object/${parlay.onchainParlayId}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-500/40 bg-purple-500/10 text-purple-400 hover:text-purple-300"
                        >
                          <Shield size={9} /> On-chain <ExternalLink size={8} />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Stakes */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-green-500/5 border border-green-500/12 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-gray-600 uppercase mb-0.5">Creator stakes</div>
                      <div className="text-green-400 font-black text-lg">{parlay.creatorStake.toLocaleString()}</div>
                      <div className="text-gray-600 text-[10px]">{parlay.currency} · ALL legs must hit</div>
                    </div>
                    <div className="bg-orange-500/5 border border-orange-500/12 rounded-lg p-3 text-center">
                      <div className="text-[10px] text-gray-600 uppercase mb-0.5">You stake</div>
                      <div className="text-orange-400 font-black text-lg">{parlay.takerStake.toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>
                      <div className="text-gray-600 text-[10px]">{parlay.currency} · ANY leg fails</div>
                    </div>
                  </div>

                  {/* Legs */}
                  <div className="space-y-1 mb-2">
                    {parlay.legs.map((leg, i) => (
                      <div key={i} className="flex items-center justify-between bg-[#0a0d14] border border-[#161e2e] rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-purple-500" />
                          <div className="min-w-0">
                            <div className="text-gray-300 text-[11px] font-medium truncate">{leg.eventName}</div>
                            <div className="text-green-400 text-[10px] truncate">{predLabel(leg.prediction, leg.homeTeam, leg.awayTeam)}</div>
                          </div>
                        </div>
                        <span className="text-purple-400 font-bold text-[11px] flex-shrink-0">{Number(leg.odds ?? 0).toFixed(2)}x</span>
                      </div>
                    ))}
                  </div>

                  {/* Expires */}
                  <div className="flex items-center gap-1 text-[10px] text-gray-600 mt-1">
                    <Clock size={9} />
                    <span>Expires {fmtTimeLeft(parlay.expiresAt)}</span>
                  </div>
                </div>

                <div className="border-t border-[#1a2235] px-5 py-3 bg-[#0a0d14] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-600 text-[10px]">By</span>
                    <a
                      href={`https://suiscan.xyz/mainnet/account/${parlay.creatorWallet}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-gray-500 hover:text-purple-400 text-xs font-mono"
                    >
                      {parlay.creatorWallet.slice(0, 6)}…{parlay.creatorWallet.slice(-4)}
                    </a>
                  </div>
                  <button onClick={handleCopyLink} className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-purple-400 transition-colors">
                    {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </div>

              {accepted ? (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center">
                  <Check className="h-8 w-8 text-green-400 mx-auto mb-2" />
                  <p className="text-green-400 font-bold">Parlay accepted!</p>
                  <button onClick={() => setLocation('/p2p')} className="mt-3 text-xs text-gray-400 hover:text-white transition-colors underline">
                    Go to P2P hub
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-3">
                    {canAccept && (
                      <button
                        onClick={() => setShowAccept(true)}
                        className="flex-1 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white transition-all"
                      >
                        Accept This Parlay <ArrowRight size={15} />
                      </button>
                    )}
                    {!canAccept && parlay.status !== 'open' && (
                      <div className="flex-1 py-3.5 rounded-xl text-sm text-center font-bold text-gray-500 bg-gray-800/60">
                        This parlay is {parlay.status}
                      </div>
                    )}
                    <button
                      onClick={handleCopyLink}
                      title="Copy link"
                      className="py-3.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2 bg-[#0f1923] border border-purple-900/30 text-gray-300 hover:text-purple-400 hover:border-purple-500/40 transition-colors"
                    >
                      {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                    </button>
                  </div>
                  <button
                    onClick={handleShareOnX}
                    className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors text-white"
                    style={{ background: '#000', border: '1px solid rgba(255,255,255,0.15)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#000')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.258 5.639 5.906-5.639Zm-1.161 17.52h1.833L7.084 4.126H5.117Z"/></svg>
                    Share on X
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Accept modals */}
      {showAccept && offer && !isParlay && (
        <OfferAcceptModal
          offer={offer}
          contractWallet={contractWallet}
          packageId={packageId}
          configId={configId}
          registryId={registryId}
          onClose={() => setShowAccept(false)}
          onDone={() => { setShowAccept(false); setAccepted(true); }}
        />
      )}
      {showAccept && parlay && isParlay && (
        <ParlayAcceptModal
          parlay={parlay}
          contractWallet={contractWallet}
          packageId={packageId}
          configId={configId}
          onClose={() => setShowAccept(false)}
          onDone={() => { setShowAccept(false); setAccepted(true); }}
        />
      )}
    </>
  );
}
