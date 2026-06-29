import { useState, useEffect } from 'react';
import { useBetting } from '@/context/BettingContext';
import { useCurrentAccount, useSignAndExecuteTransaction, useSignTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { X, Trash2, ChevronUp, ChevronDown, Shield, Loader2, Zap, MessageSquare, TrendingUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';

// ─── Probability Sparkline (Polymarket-style) ──────────────────────────────────
function ProbabilitySparkline({ points }: { points: Array<{ prob: number; time?: string }> }) {
  if (points.length < 2) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
        <TrendingUp size={12} className="text-gray-600" />
        <span className="text-[10px] text-gray-600">No price history yet — be the first to post odds</span>
      </div>
    );
  }
  const W = 220, H = 42;
  const probs = points.map(p => p.prob);
  const min = Math.min(...probs), max = Math.max(...probs);
  const range = max - min || 1;
  const pts = probs.map((p, i) => ({
    x: (i / (probs.length - 1)) * W,
    y: H - ((p - min) / range) * (H - 8) - 4,
  }));
  const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
  const fillD = `${d} L${W},${H} L0,${H} Z`;
  const last = probs[probs.length - 1];
  const first = probs[0];
  const delta = last - first;
  const color = delta >= 0 ? '#10b981' : '#ef4444';
  const lightColor = delta >= 0 ? '#10b98130' : '#ef444430';
  return (
    <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-black/30">
      <div className="flex items-center justify-between px-3 pt-2 pb-0.5">
        <span className="text-[9px] text-gray-600 uppercase tracking-wider font-semibold">Market Probability History</span>
        <span className="flex items-center gap-1 text-[10px] font-black" style={{ color }}>
          {last.toFixed(1)}%
          <span className="text-[9px]">{delta >= 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(1)}pp</span>
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: 42 }}>
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#sparkFill)" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill={color} />
      </svg>
      <div className="flex justify-between px-3 pb-1.5">
        <span className="text-[9px] text-gray-700">{first.toFixed(1)}%</span>
        <span className="text-[9px] text-gray-700">{points.length} offers · {last.toFixed(1)}%</span>
      </div>
    </div>
  );
}

const SBETS_COIN_TYPE  = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
const USDC_COIN_TYPE   = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const LBTC_COIN_TYPE   = '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC';
const USDSUI_DECIMALS  = 6;
const USDC_DECIMALS    = 6;

const CURRENCIES = [
  { id: 'SUI',    label: '𝕊 SUI',    color: 'bg-cyan-500',    textColor: 'text-black' },
  { id: 'SBETS',  label: '⚡ SBETS',  color: 'bg-purple-500',  textColor: 'text-white' },
  { id: 'USDSUI', label: '$ USDSUI', color: 'bg-teal-500',    textColor: 'text-black' },
  { id: 'USDC',   label: '$ USDC',   color: 'bg-green-500',   textColor: 'text-black' },
  { id: 'LBTC',   label: '₿ LBTC',   color: 'bg-orange-500',  textColor: 'text-white' },
] as const;

type CurrencyId = 'SUI' | 'SBETS' | 'USDSUI' | 'USDC' | 'LBTC';

export function BetSlip() {
  const { selectedBets, removeBet, clearBets } = useBetting();
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute }   = useSignAndExecuteTransaction();
  const { mutateAsync: signTransaction }  = useSignTransaction();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const { data: contractData } = useQuery<{
    wallet: string;
    onchainEscrow?: boolean;
    packageId?: string;
    configId?: string;
    registryId?: string;
  }>({
    queryKey: ['/api/p2p/contract-wallet'],
    queryFn: () => fetch('/api/p2p/contract-wallet').then(r => r.json()),
    staleTime: Infinity,
  });
  const contractWallet  = contractData?.wallet ?? '';
  const onchainEscrow   = contractData?.onchainEscrow ?? false;
  const packageId       = contractData?.packageId ?? '';
  const configId        = contractData?.configId  ?? '';
  const registryId      = contractData?.registryId ?? '';

  // Sponsor address for gasless USDC / USDSUI transactions
  const { data: sponsorData } = useQuery<{ sponsorAddress: string; gasless: boolean }>({
    queryKey: ['/api/p2p/sponsor-address'],
    queryFn: () => fetch('/api/p2p/sponsor-address').then(r => r.json()),
    staleTime: 60_000,
  });
  const sponsorAddress = sponsorData?.sponsorAddress ?? '';

  const [p2pOdds, setP2pOdds]             = useState('');
  const [p2pStake, setP2pStake]           = useState('');
  const [currency, setCurrency]           = useState<CurrencyId>('SUI');
  const [isPosting, setIsPosting]         = useState(false);
  const [oddsFormat, setOddsFormat]       = useState<'%' | 'Dec' | 'US'>('Dec');
  const [sliderProb, setSliderProb]       = useState(50);
  const [expiryHours, setExpiryHours]     = useState(24);
  // Sui-native feature toggles
  const [suinsGated, setSuinsGated]       = useState(false);
  const syncSlider = (oddsStr: string) => {
    const o = parseFloat(oddsStr);
    if (o >= 1.01 && o <= 100) setSliderProb(Math.round(Math.min(97, Math.max(1, 100 / o))));
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const odds = (e as CustomEvent<{ odds: string }>).detail?.odds;
      if (odds) { setP2pOdds(odds); syncSlider(odds); }
    };
    window.addEventListener('open-betslip-p2p', handler);
    return () => window.removeEventListener('open-betslip-p2p', handler);
  }, []);

  const isParlay = selectedBets.length > 1;
  const parlayOdds    = selectedBets.reduce((acc, b) => acc * (b.odds ?? 1), 1);
  const effectiveOdds = isParlay ? parlayOdds : (parseFloat(p2pOdds) || 0);

  const { data: myVolumeData } = useQuery({
    queryKey: ['/api/p2p/volume', currentAccount?.address],
    queryFn: () => fetch(`/api/p2p/volume?wallet=${currentAccount?.address}`).then(r => r.json()),
    enabled: !!currentAccount?.address,
    staleTime: 60000,
  });
  const myTakerFee: number    = (myVolumeData as any)?.tier?.takerFee    ?? 0.02;
  const myTierName: string    = (myVolumeData as any)?.tier?.name        ?? 'Bronze';
  const myMakerRebate: number = (myVolumeData as any)?.tier?.makerRebate ?? 0;

  // Polymarket-style: odds history for the primary selected event
  const primaryEventId = !isParlay ? (selectedBets[0] as any)?.eventId ?? (selectedBets[0] as any)?.id : null;
  const { data: oddsHistoryData } = useQuery<{ points: Array<{ prob: number; time?: string }> }>({
    queryKey: ['/api/p2p/odds-history', primaryEventId],
    queryFn: () => fetch(`/api/p2p/odds-history?eventId=${encodeURIComponent(String(primaryEventId))}`).then(r => r.json()),
    enabled: !!primaryEventId && !isParlay,
    staleTime: 60_000,
  });
  const oddsPoints = oddsHistoryData?.points ?? [];

  const stakeNum        = parseFloat(p2pStake) || 0;
  const takerStake      = stakeNum > 0 && effectiveOdds > 1
    ? Math.round(stakeNum * (effectiveOdds - 1) * 10000) / 10000
    : 0;
  const creatorWinAfterFee = stakeNum > 0 && effectiveOdds > 1
    ? Math.round(stakeNum * effectiveOdds * (1 - myTakerFee) * 10000) / 10000
    : 0;

  const normalizePred = (pred: string, homeTeam?: string, awayTeam?: string): string => {
    const p = (pred || '').toLowerCase().trim();
    if (!p) return 'home';
    // Pass through new football market types unchanged before any substring checks
    if (/^(over|under)_[\d.]+$/.test(p)) return p;
    if (p === 'btts_yes' || p === 'btts_no') return p;
    if (p === 'home_or_draw' || p === 'away_or_draw' || p === 'home_or_away') return p;
    if (/^(home|away)_[-+]?[\d.]+$/.test(p)) return p;
    // Standard match winner
    if (p === 'home' || p === '1') return 'home';
    if (p === 'away' || p === '2') return 'away';
    if (p === 'draw' || p === 'x' || p === 'tie') return 'draw';
    if (p.includes('home')) return 'home';
    if (p.includes('away')) return 'away';
    if (p.includes('draw') || p.includes('tie')) return 'draw';
    if (awayTeam && p.includes(awayTeam.toLowerCase())) return 'away';
    if (homeTeam && p.includes(homeTeam.toLowerCase())) return 'home';
    return 'home';
  };

  const predLabel = (pred: string, homeTeam?: string, awayTeam?: string): string => {
    const norm = normalizePred(pred, homeTeam, awayTeam);
    if (norm === 'home') return `🏠 ${homeTeam || 'Home'}`;
    if (norm === 'away') return `✈️ ${awayTeam || 'Away'}`;
    if (norm === 'draw') return '🤝 Draw';
    if (norm === 'btts_yes') return '⚽ BTTS Yes';
    if (norm === 'btts_no')  return '🚫 BTTS No';
    if (norm === 'home_or_draw') return `${homeTeam || 'Home'} or Draw`;
    if (norm === 'away_or_draw') return `${awayTeam || 'Away'} or Draw`;
    if (norm === 'home_or_away') return 'Either Team Wins';
    const ouMatch = norm.match(/^(over|under)_([\d.]+)$/);
    if (ouMatch) return `${ouMatch[1] === 'over' ? '⬆️ Over' : '⬇️ Under'} ${ouMatch[2]} Goals`;
    const hcapMatch = norm.match(/^(home|away)_([-+]?[\d.]+)$/);
    if (hcapMatch) {
      const side = hcapMatch[1] === 'home' ? (homeTeam || 'Home') : (awayTeam || 'Away');
      const val = parseFloat(hcapMatch[2]);
      return `${side} ${val > 0 ? '+' : ''}${hcapMatch[2]}`;
    }
    return norm;
  };

  const SUI_COIN_TYPE  = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  const SUI_CLOCK_ID   = '0x0000000000000000000000000000000000000000000000000000000000000006';
  const enc = new TextEncoder();
  const toBytes = (s: string) => Array.from(enc.encode(s));

  const buildPaymentCoin = async (tx: Transaction): Promise<any> => {
    if (currency === 'SUI') {
      const amount = BigInt(Math.floor(stakeNum * 1_000_000_000));
      const [coin] = tx.splitCoins(tx.gas, [amount]);
      return coin;
    }
    const coinType = currency === 'SBETS'  ? SBETS_COIN_TYPE
      : currency === 'USDSUI' ? USDSUI_COIN_TYPE
      : currency === 'USDC'   ? USDC_COIN_TYPE
      : LBTC_COIN_TYPE;
    const decimals = (currency === 'USDSUI' || currency === 'USDC') ? 6
      : currency === 'LBTC' ? 8
      : 9;
    const amount   = BigInt(Math.floor(stakeNum * Math.pow(10, decimals)));
    const allCoins = await (suiClient as any).getCoins({ owner: currentAccount!.address, coinType });
    const coins: any[] = allCoins?.data ?? [];
    if (coins.length === 0) throw new Error(`No ${currency} coins found in your wallet.`);
    const totalBalance = coins.reduce((sum: bigint, c: any) => sum + BigInt(c.balance), 0n);
    if (totalBalance < amount) throw new Error(`Insufficient ${currency} balance. Need ${stakeNum} ${currency}.`);
    const primary = tx.object(coins[0].coinObjectId);
    if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)));
    const [split] = tx.splitCoins(primary, [amount]);
    return split;
  };

  // Whether the current currency uses gas sponsorship (no SUI needed from user)
  const isGasless = currency === 'USDC' || currency === 'USDSUI';

  /** Build the Move call arguments into `tx` (PTB only, no gas set). */
  const addMoveCall = (tx: Transaction, paymentCoin: any, coinTypeStr: string, expiresAtMs: bigint) => {
    if (!isParlay) {
      const bet = selectedBets[0] as any;
      const oddsBps = BigInt(Math.round(effectiveOdds * 10_000));
      tx.moveCall({
        target:        `${packageId}::p2p_betting::post_offer`,
        typeArguments: [coinTypeStr],
        arguments: [
          tx.object(configId),
          tx.object(registryId),
          paymentCoin,
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(String(bet.eventId || bet.id || '')))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(bet.eventName || bet.event || 'Match'))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(normalizePred(bet.prediction || bet.selection || bet.selectionName || '', bet.homeTeam, bet.awayTeam)))),
          tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
          tx.pure.u64(oddsBps),
          tx.pure.u64(expiresAtMs),
          tx.object(SUI_CLOCK_ID),
        ],
      });
    } else {
      const totalOddsBps = BigInt(Math.round(parlayOdds * 10_000));
      const legOddsBps   = selectedBets.map((b: any) => BigInt(Math.round((Number(b.odds) || 2) * 10_000)));
      tx.moveCall({
        target:        `${packageId}::p2p_betting::post_parlay`,
        typeArguments: [coinTypeStr],
        arguments: [
          tx.object(configId),
          tx.object(registryId),
          paymentCoin,
          tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(
            selectedBets.map((b: any) => toBytes(String(b.eventId || b.id || '')))
          )),
          tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(
            selectedBets.map((b: any) => toBytes(b.eventName || b.event || 'Match'))
          )),
          tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(
            selectedBets.map((b: any) => toBytes(normalizePred(b.prediction || b.selection || b.selectionName || '', b.homeTeam, b.awayTeam)))
          )),
          tx.pure(bcs.vector(bcs.u64()).serialize(legOddsBps)),
          tx.pure.u64(totalOddsBps),
          tx.pure.u64(expiresAtMs),
          tx.object(SUI_CLOCK_ID),
        ],
      });
    }
  };

  const buildContractTransaction = async (): Promise<{ digest: string; onchainOfferId: string; expiresAtMs: bigint }> => {
    if (!packageId || !configId || !registryId) {
      throw new Error('P2P contract not configured on this deployment. Contact support.');
    }

    const coinTypeStr = currency === 'SUI'    ? SUI_COIN_TYPE
      : currency === 'SBETS'  ? SBETS_COIN_TYPE
      : currency === 'USDSUI' ? USDSUI_COIN_TYPE
      : currency === 'USDC'   ? USDC_COIN_TYPE
      : LBTC_COIN_TYPE;

    // Cap expiresAtMs to match start time when available — keeps on-chain and DB expiry in sync
    const matchStartMs = (() => {
      const bet = selectedBets[0] as any;
      const raw = bet?.startTime || bet?.matchDate || bet?.commence_time || bet?.date;
      if (!raw) return 0;
      const t = new Date(raw).getTime();
      return isNaN(t) ? 0 : t;
    })();
    // expiryHours === 0 means "until kickoff" — expire exactly when the match starts
    const rawExpiresAtMs = expiryHours === 0
      ? (matchStartMs > Date.now() ? matchStartMs : Date.now() + 72 * 3600 * 1000)
      : Date.now() + expiryHours * 3600 * 1000;
    const expiresAtMs = BigInt(matchStartMs > Date.now() && matchStartMs < rawExpiresAtMs ? matchStartMs : rawExpiresAtMs);

    // ── GASLESS PATH (USDC / USDSUI) ──────────────────────────────────────────
    // Uses Sui gas sponsorship: admin is the gasOwner, user needs zero SUI.
    // The wallet displays "Gas: FREE" because gasOwner ≠ sender.
    //
    // Flow:
    //   1. Build full tx with tx.setGasOwner(adminAddr) — SDK resolves gas from admin
    //   2. POST built bytes to /api/p2p/sponsor-gas → admin co-signs as gas owner
    //   3. Wallet signs the SAME pre-built bytes as the sender
    //   4. Submit with [userSig, sponsorSig]
    if (isGasless) {
      if (!sponsorAddress) {
        throw new Error('Gas sponsor not available. Please use SUI as currency instead.');
      }

      // Step 1: build tx — setSponsor tells the SDK to resolve gas from adminAddr
      const tx = new Transaction();
      tx.setSender(currentAccount!.address);
      tx.setGasOwner(sponsorAddress);          // admin pays gas → wallet shows "Gas: FREE"
      const paymentCoin = await buildPaymentCoin(tx);
      addMoveCall(tx, paymentCoin, coinTypeStr, expiresAtMs);

      toast({
        title: `Posting ${currency} bet (Gas: FREE)`,
        description: 'Building sponsored transaction — no SUI needed from your wallet…',
      });

      // Build complete bytes — resolves gas coins from sponsorAddress automatically
      const builtBytes = await tx.build({ client: suiClient as any });
      const builtBase64 = btoa(String.fromCharCode(...builtBytes));

      // Step 2: admin signs as gas sponsor
      const sponsorRes = await fetch('/api/p2p/sponsor-gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txBytes: builtBase64 }),
      });
      if (!sponsorRes.ok) {
        const err = await sponsorRes.json().catch(() => ({}));
        throw new Error(err.message || 'Gas sponsorship failed — try again or switch to SUI');
      }
      const { sponsorSig } = await sponsorRes.json() as { sponsorSig: string };

      // Step 3: user wallet signs the SAME pre-built bytes (NOT the Transaction object —
      // passing the object would cause the wallet to rebuild with different gas resolution,
      // making the user's signature cover different bytes than the sponsor's → invalid tx).
      toast({
        title: 'Approve in wallet',
        description: `Gas: FREE — sponsored by SuiBets. Sign to lock ${stakeNum} ${currency} on-chain.`,
      });
      const { bytes: signedBytes, signature: userSig } = await signTransaction({
        transaction: builtBytes,   // ← exact bytes admin already signed
      });

      // Step 4: submit with [senderSig, sponsorSig]
      const result = await (suiClient as any).executeTransactionBlock({
        transactionBlock: signedBytes,
        signature: [userSig, sponsorSig],
        options: { showEffects: true, showObjectChanges: true },
      });
      const digest: string = result?.digest ?? result?.Transaction?.digest ?? '';
      if (!digest) throw new Error('Wallet did not return a transaction digest. Please try again.');

      // Extract created P2POffer / P2PParlay object ID
      let onchainOfferId = '';
      for (let attempt = 1; attempt <= 5 && !onchainOfferId; attempt++) {
        try {
          const txBlock = await (suiClient as any).getTransactionBlock({
            digest, options: { showObjectChanges: true },
          });
          const created = (txBlock?.objectChanges ?? []).find((c: any) =>
            c.type === 'created' && (
              c.objectType?.includes('::p2p_betting::P2POffer') ||
              c.objectType?.includes('::p2p_betting::P2PParlay')
            )
          );
          if (created?.objectId) onchainOfferId = created.objectId;
        } catch (err) {
          console.warn(`[BetSlip] gasless: Could not extract onchain ID (attempt ${attempt}/5):`, err);
        }
        if (!onchainOfferId && attempt < 5) await new Promise(r => setTimeout(r, 2000));
      }

      return { digest, onchainOfferId, expiresAtMs };
    }

    // ── REGULAR PATH (SUI / SBETS) ────────────────────────────────────────────
    const tx = new Transaction();
    tx.setGasBudget(20_000_000);

    const paymentCoin = await buildPaymentCoin(tx);
    addMoveCall(tx, paymentCoin, coinTypeStr, expiresAtMs);

    toast({
      title: 'Approve in wallet',
      description: isParlay
        ? `Calling post_parlay on-chain — ${stakeNum} ${currency} locked in contract escrow`
        : `Calling post_offer on-chain — ${stakeNum} ${currency} locked in contract escrow`,
    });

    const result = await signAndExecute({ transaction: tx } as any);
    const digest: string = result?.digest || (result as any)?.Transaction?.digest || '';
    if (!digest) throw new Error('Wallet did not return a transaction digest. Please try again.');

    // Extract the created P2POffer / P2PParlay object ID from on-chain tx
    // Retry up to 5 times with 2 s delay — Sui RPC can lag a few seconds after finality
    let onchainOfferId = '';
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const txBlock = await (suiClient as any).getTransactionBlock({
          digest,
          options: { showObjectChanges: true },
        });
        const created = (txBlock?.objectChanges ?? []).find((c: any) =>
          c.type === 'created' && (
            c.objectType?.includes('::p2p_betting::P2POffer') ||
            c.objectType?.includes('::p2p_betting::P2PParlay')
          )
        );
        if (created?.objectId) { onchainOfferId = created.objectId; break; }
      } catch (err) {
        console.warn(`[BetSlip] Could not extract onchain object ID (attempt ${attempt}/5):`, err);
      }
      if (!onchainOfferId && attempt < 5) await new Promise(r => setTimeout(r, 2000));
    }

    return { digest, onchainOfferId, expiresAtMs };
  };

  const handlePost = async () => {
    if (!currentAccount?.address) {
      toast({ title: 'Connect Wallet', description: 'Please connect your Sui wallet first.', variant: 'destructive' });
      window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
      return;
    }
    if (selectedBets.length === 0) {
      toast({ title: 'No bets selected', description: 'Select a match first.', variant: 'destructive' });
      return;
    }

    // Detect live/started matches — we allow live in-play offers (liveOdds mode),
    // but only single-leg (not parlays) and the API will cap expiry at 90 s + void on goal.
    const now = Date.now();
    const isLiveBet = selectedBets.some((b: any) => {
      if (b.isLive) return true;
      const raw = b.startTime || b.matchDate || b.commence_time || b.date;
      if (!raw) return false;
      const t = new Date(raw).getTime();
      return !isNaN(t) && t <= now;
    });
    // Block live multi-leg parlays — live in-play only works for single bets
    if (isLiveBet && isParlay) {
      toast({
        title: 'Live parlays not supported',
        description: 'In-play betting is single-leg only. Remove live matches to post a parlay.',
        variant: 'destructive',
      });
      return;
    }

    if (stakeNum <= 0) {
      toast({ title: 'Enter your stake', description: 'Stake must be greater than 0.', variant: 'destructive' });
      return;
    }
    if (!isParlay && (isNaN(parseFloat(p2pOdds)) || parseFloat(p2pOdds) < 1.01)) {
      toast({ title: 'Invalid odds', description: 'Odds must be at least 1.01.', variant: 'destructive' });
      return;
    }
    if (!isParlay && effectiveOdds > 100) {
      toast({ title: 'Odds too high', description: 'Maximum odds is 100.', variant: 'destructive' });
      return;
    }

    setIsPosting(true);
    try {
      const { digest: txHash, onchainOfferId, expiresAtMs } = await buildContractTransaction();

      const expiresAt = new Date(Number(expiresAtMs)).toISOString();

      if (isParlay) {
        const res = await fetch('/api/p2p/parlays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creatorWallet:    currentAccount.address,
            legs: selectedBets.map((b: any) => ({
              eventId:    String(b.eventId || b.id || ''),
              eventName:  b.eventName || b.event || 'Match',
              homeTeam:   b.homeTeam || b.team1 || 'Home',
              awayTeam:   b.awayTeam || b.team2 || 'Away',
              prediction: normalizePred(b.prediction || b.selection || b.selectionName || '', b.homeTeam || b.team1, b.awayTeam || b.team2),
              odds:       Number(b.odds) || 2.0,
              leagueName: b.league,
              sportName:  b.sport,
              matchDate:  b.startTime || b.matchDate || b.commence_time || b.date || null,
            })),
            creatorStake:     stakeNum,
            currency,
            creatorTxHash:    txHash         || undefined,
            onchainParlayId:  onchainOfferId || undefined,
            onchainConfigId:  configId       || undefined,
            expiresAt,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to post parlay');
        toast({
          title: '✅ Parlay Posted On-Chain!',
          description: `Offer #${data.id} is live — taker needs ${takerStake.toFixed(4)} ${currency}.`,
        });
        qc.invalidateQueries({ queryKey: ['/api/p2p/parlays'] });
        qc.invalidateQueries({ queryKey: ['/api/p2p/offers'] });
        window.dispatchEvent(new CustomEvent('p2p-offer-created'));
      } else {
        const bet: any = selectedBets[0];
        const res = await fetch('/api/p2p/offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creatorWallet:   currentAccount.address,
            eventId:         String(bet.eventId || bet.id || ''),
            eventName:       bet.eventName || bet.event || 'Match',
            homeTeam:        bet.homeTeam || bet.team1 || 'Home',
            awayTeam:        bet.awayTeam || bet.team2 || 'Away',
            prediction:      normalizePred(bet.prediction || bet.selection || bet.selectionName || '', bet.homeTeam || bet.team1, bet.awayTeam || bet.team2),
            odds:            parseFloat(p2pOdds),
            creatorStake:    stakeNum,
            currency,
            creatorTxHash:   txHash        || undefined,
            onchainOfferId:  onchainOfferId || undefined,
            onchainConfigId: configId       || undefined,
            expiresAt,
            leagueName:      bet.league,
            sportName:       bet.sport,
            matchDate:       bet.startTime || bet.matchDate || bet.commence_time || bet.date || null,
            suinsGated,
            liveOdds:        isLiveBet || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to post offer');

        toast({
          title: '✅ Offer Posted On-Chain!',
          description: `Offer #${data.id} at ${parseFloat(p2pOdds).toFixed(2)}x — taker needs ${takerStake.toFixed(4)} ${currency}.`,
        });
        qc.invalidateQueries({ queryKey: ['/api/p2p/offers'] });
        qc.invalidateQueries({ queryKey: ['/api/p2p/parlays'] });
        window.dispatchEvent(new CustomEvent('p2p-offer-created', { detail: data }));
      }

      clearBets();
      setP2pOdds('');
      setP2pStake('');
      setTimeout(() => {
        const el = document.getElementById('p2p-order-book');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    } catch (e: any) {
      const msg: string = e?.message ?? 'Unknown error';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        toast({ title: 'Cancelled', description: 'Transaction was cancelled in your wallet.', variant: 'destructive' });
      } else {
        toast({ title: 'Error posting offer', description: msg, variant: 'destructive' });
      }
    } finally {
      setIsPosting(false);
    }
  };

  if (selectedBets.length === 0) return null;

  const activeCurrency = CURRENCIES.find(c => c.id === currency) ?? CURRENCIES[0];

  return (
    <div className="bg-[#111111] border border-[#1e2a3a] rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-900/40 to-cyan-900/40 border-b border-[#1e2a3a]">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚔️</span>
          <span className="text-white font-black text-sm">
            {isParlay ? `P2P Parlay (${selectedBets.length} legs)` : 'P2P Bet Slip'}
          </span>
          {onchainEscrow && (
            <span className="flex items-center gap-0.5 text-[10px] font-bold text-cyan-400 bg-cyan-500/15 px-1.5 py-0.5 rounded-full border border-cyan-500/30">
              <Shield size={8} /> On-chain
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => clearBets()} className="text-gray-500 hover:text-red-400 transition-colors" title="Clear all">
            <Trash2 size={14} />
          </button>
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="text-gray-500 hover:text-white transition-colors">
            {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Selected Bets */}
          <div className="divide-y divide-[#1e2a3a]">
            {selectedBets.map((bet: any) => {
              const eventId = bet.eventId ?? bet.id;
              return (
                <div key={bet.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{bet.eventName || bet.event || 'Match'}</div>
                      <div className="text-cyan-400 text-xs mt-0.5">
                        {predLabel(bet.prediction || bet.selection || bet.selectionName || '', bet.homeTeam, bet.awayTeam)}
                        {' '}
                        <span className="text-gray-400">@ {Number(bet.odds || 0).toFixed(2)}x</span>
                      </div>
                      {bet.league && <div className="text-gray-600 text-xs mt-0.5 truncate">{bet.league}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                      {eventId && (
                        <a
                          href={`/messaging?eventId=${encodeURIComponent(String(eventId))}`}
                          title="Discuss this match in encrypted chat"
                          className="text-gray-600 hover:text-cyan-400 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          <MessageSquare size={13} />
                        </a>
                      )}
                      <button onClick={() => removeBet(bet.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Parlay combined odds */}
          {isParlay && (
            <div className="px-4 py-2 bg-purple-900/20 border-y border-purple-500/20 flex justify-between items-center">
              <span className="text-gray-400 text-xs">Combined odds:</span>
              <span className="text-purple-400 font-black">{parlayOdds.toFixed(2)}x</span>
            </div>
          )}

          <div className="px-4 py-4 space-y-3">
            {/* Currency selector */}
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Currency</label>
              <div className="flex gap-1.5">
                {CURRENCIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCurrency(c.id as CurrencyId)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      currency === c.id
                        ? `${c.color} ${c.textColor}`
                        : 'bg-[#1a2235] text-gray-400 hover:text-white'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {currency === 'SBETS' && (
                <p className="text-purple-400/70 text-xs mt-1">⚡ SBETS holders get rebates at Gold+ tier</p>
              )}
              {(currency === 'USDSUI' || currency === 'USDC') && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    <Zap size={9} /> Gas: FREE
                  </span>
                  <span className="text-gray-500 text-[11px]">
                    {currency === 'USDC' ? 'Circle USDC · no SUI needed' : 'Stripe USDSUI · no SUI needed'}
                  </span>
                </div>
              )}
            </div>

            {/* Odds — Polymarket-style probability selector (single only) */}
            {!isParlay && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-gray-400 text-xs">Your odds</label>
                  <div className="flex gap-0.5">
                    {(['Dec', '%', 'US'] as const).map(f => (
                      <button key={f} onClick={() => setOddsFormat(f)}
                        className={`text-[10px] px-2 py-0.5 rounded font-bold transition-all ${oddsFormat === f ? 'bg-purple-600 text-white' : 'bg-[#1a2235] text-gray-500 hover:text-white'}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] text-gray-600 mb-1.5">
                    <span>Unlikely</span>
                    <span className="text-purple-300 font-black text-base">
                      {oddsFormat === '%'
                        ? `${sliderProb}%`
                        : oddsFormat === 'Dec'
                        ? `${effectiveOdds >= 1.01 ? effectiveOdds.toFixed(2) : (100 / sliderProb).toFixed(2)}×`
                        : (() => {
                            const d = effectiveOdds >= 1.01 ? effectiveOdds : 100 / sliderProb;
                            return d >= 2 ? `+${Math.round((d - 1) * 100)}` : `-${Math.round(100 / (d - 1))}`;
                          })()}
                    </span>
                    <span>Likely</span>
                  </div>
                  <input
                    type="range" min="1" max="97" step="1" value={sliderProb}
                    onChange={e => {
                      const prob = Number(e.target.value);
                      setSliderProb(prob);
                      setP2pOdds((100 / prob).toFixed(2));
                    }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{ background: `linear-gradient(to right, #7c3aed ${sliderProb}%, #1e2a3a ${sliderProb}%)` }}
                  />
                </div>

                <div className="flex items-center gap-px bg-[#0d1420] border border-[#1e2a3a] rounded-xl overflow-hidden">
                  {[
                    { label: 'Decimal', val: effectiveOdds >= 1.01 ? `${effectiveOdds.toFixed(2)}×` : '—', color: 'text-white' },
                    { label: 'Implied', val: effectiveOdds >= 1.01 ? `${(100/effectiveOdds).toFixed(1)}%` : '—', color: 'text-purple-400' },
                    { label: 'American', val: (() => {
                        if (effectiveOdds < 1.01) return '—';
                        return effectiveOdds >= 2
                          ? `+${Math.round((effectiveOdds - 1) * 100)}`
                          : `-${Math.round(100 / (effectiveOdds - 1))}`;
                      })(), color: 'text-cyan-400' },
                  ].map((item, i) => (
                    <div key={item.label} className={`flex-1 text-center py-2 ${i > 0 ? 'border-l border-[#1e2a3a]' : ''}`}>
                      <div className="text-gray-600 text-[9px] uppercase tracking-wider">{item.label}</div>
                      <div className={`${item.color} text-sm font-black`}>{item.val}</div>
                    </div>
                  ))}
                </div>

                <input
                  type="number" value={p2pOdds}
                  onChange={e => { setP2pOdds(e.target.value); syncSlider(e.target.value); }}
                  step="0.05" min="1.01" max="100" placeholder="Fine-tune decimal odds…"
                  className="w-full bg-[#0a0a0a] border border-[#1e2a3a] focus:border-purple-500 rounded-lg px-3 py-1.5 text-white text-xs outline-none transition-colors"
                />

                {selectedBets[0]?.odds && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600">Sportsbook line:</span>
                    <span className="text-gray-400 font-mono">{Number(selectedBets[0].odds).toFixed(2)}×</span>
                    <span className="text-gray-600">({(100 / Number(selectedBets[0].odds)).toFixed(0)}%)</span>
                    <button
                      onClick={() => {
                        const o = Number(selectedBets[0].odds).toFixed(2);
                        setP2pOdds(o);
                        syncSlider(o);
                      }}
                      className="ml-auto text-[10px] text-purple-400 hover:text-purple-300 font-bold border border-purple-500/30 hover:border-purple-400/50 px-2 py-0.5 rounded transition-all"
                    >
                      Use line
                    </button>
                  </div>
                )}

                {/* Polymarket-style probability sparkline */}
                <ProbabilitySparkline points={oddsPoints} />

                {/* Chat link for the match */}
                {primaryEventId && (
                  <a
                    href={`/messaging?eventId=${encodeURIComponent(String(primaryEventId))}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10 hover:border-cyan-500/40 transition-all text-xs text-cyan-400 font-semibold"
                  >
                    <MessageSquare size={12} />
                    Discuss this match in encrypted chat
                    <span className="ml-auto text-gray-600 text-[10px]">→</span>
                  </a>
                )}
              </div>
            )}

            {/* Offer Expiry Duration */}
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Offer valid for</label>
              <div className="flex gap-1 flex-wrap">
                {[6, 12, 24, 48, 72].map(h => (
                  <button
                    key={h}
                    onClick={() => setExpiryHours(h)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      expiryHours === h
                        ? 'bg-cyan-600 text-black'
                        : 'bg-[#1a2235] text-gray-400 hover:text-white'
                    }`}
                  >
                    {h}h
                  </button>
                ))}
                <button
                  onClick={() => setExpiryHours(0)}
                  title="Offer stays open until the match kicks off"
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                    expiryHours === 0
                      ? 'bg-green-500 text-black'
                      : 'bg-[#1a2235] text-gray-400 hover:text-white'
                  }`}
                >
                  ⚽ Kickoff
                </button>
              </div>
            </div>

            {/* Stake */}
            <div>
              <label className="text-gray-400 text-xs mb-1 block">Your Stake ({currency})</label>
              <input
                type="number" value={p2pStake} onChange={e => setP2pStake(e.target.value)}
                step="0.1" min="0.001" placeholder="e.g. 5"
                className="w-full bg-[#0a0a0a] border border-[#1e2a3a] focus:border-purple-500 rounded-lg px-3 py-2 text-white text-sm outline-none transition-colors"
              />
            </div>

            {/* Payout Preview */}
            {stakeNum > 0 && effectiveOdds >= 1.01 && (
              <div className="bg-[#0d1420] border border-[#1e2a3a] rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Taker must stake:</span>
                  <span className="text-orange-400 font-bold">{takerStake.toFixed(4)} {currency}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Total pot:</span>
                  <span className="text-white font-bold">{(stakeNum + takerStake).toFixed(4)} {currency}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-[#1e2a3a] pt-1.5">
                  <span className="text-gray-400">If you win (after {(myTakerFee * 100).toFixed(myTakerFee < 0.01 ? 2 : 0)}% {myTierName} fee):</span>
                  <span className="text-green-400 font-bold">{creatorWinAfterFee.toFixed(4)} {currency}</span>
                </div>
                {myMakerRebate > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-purple-400/80">Maker rebate (you earn):</span>
                    <span className="text-purple-300 font-bold">+{(myMakerRebate * 100).toFixed(2)}% of pot</span>
                  </div>
                )}
              </div>
            )}

            {/* Sui-native feature toggles */}
            {!isParlay && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setSuinsGated(v => !v)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg border transition-all text-left"
                  style={suinsGated ? { background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.4)' } : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div>
                    <span className="text-xs font-bold" style={{ color: suinsGated ? '#a78bfa' : '#6b7280' }}>⭐ VIP Pool — .sui name required</span>
                    <p className="text-[10px] text-gray-600 mt-0.5">Only wallets with a SuiNS domain can accept. Elite tier auto-applied (0.3% fee). <a href="https://suins.io" target="_blank" rel="noreferrer" className="text-violet-400 underline">Get .sui →</a></p>
                  </div>
                  <div className={`w-8 h-4 rounded-full flex-shrink-0 ml-3 flex items-center transition-all ${suinsGated ? 'bg-violet-500' : 'bg-gray-700'}`}>
                    <div className={`w-3 h-3 rounded-full bg-white ml-0.5 transition-transform ${suinsGated ? 'translate-x-4' : ''}`} />
                  </div>
                </button>
              </div>
            )}

            {/* What happens explanation */}
            <div className="bg-cyan-400/8 border border-cyan-500/20 rounded-lg p-3">
              <p className="text-cyan-400 text-xs font-bold mb-0.5">
                🔒 {packageId ? 'Trustless contract escrow' : 'On-chain escrow'}
              </p>
              <p className="text-gray-400 text-xs">
                {packageId
                  ? `Your wallet will sign a ${isParlay ? 'post_parlay' : 'post_offer'} transaction. ${stakeNum > 0 ? `${stakeNum} ${currency}` : 'Your stake'} goes directly into the P2P contract's escrow object — no admin wallet holds your funds.`
                  : `Clicking below will open your wallet. ${stakeNum > 0 ? `${stakeNum} ${currency}` : 'Your stake'} is locked in escrow. Winner is paid automatically after the match settles.`
                }
              </p>
            </div>

            {/* Post Button */}
            <button
              onClick={handlePost}
              disabled={isPosting || stakeNum <= 0 || (!isParlay && parseFloat(p2pOdds) < 1.01)}
              className="w-full bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-black py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
            >
              {isPosting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Sending to escrow…
                </>
              ) : (
                `⚔️ Post ${isParlay ? 'Parlay' : 'P2P'} Offer — ${stakeNum > 0 ? `${stakeNum} ${currency}` : currency}`
              )}
            </button>
            <p className="text-xs text-gray-600 text-center">
              No house edge · winner takes all minus {(myTakerFee * 100).toFixed(myTakerFee < 0.01 ? 2 : 0)}% fee ({myTierName} tier)
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default BetSlip;
