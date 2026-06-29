import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, RefreshCw, ExternalLink, Zap, ArrowUpDown,
  Wallet, Info, PlusCircle, ArrowDownCircle, ArrowUpCircle,
  Target, CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';

// ── Types ──────────────────────────────────────────────────────────────────────

type PoolInfo = { key: string; address: string; baseCoin: string; quoteCoin: string; label: string };
type DepthLevel = { price: number; quantity: number };
type PoolDepth = {
  poolKey: string; label: string; midPrice: number | null;
  bids: DepthLevel[]; asks: DepthLevel[];
  lotSize: number | null; minSize: number | null; takerFee: number | null; makerFee: number | null; fetchedAt: string;
};
type PoolSummary = { key: string; label: string; midPrice: number | null };
type VaultBalances = {
  poolKey: string; label: string;
  baseAvailable: number; baseLocked: number;
  quoteAvailable: number; quoteLocked: number;
  deepAvailable: number; deepLocked: number;
  fetchedAt: string;
};
type SbetsPoolStatus = {
  poolId: string | null;
  configured: boolean;
  coinType: string;
  tickSize: number;
  lotSize: number;
  minSize: number;
  creationFeeDEEP: number;
};

type TradeTab = 'limit' | 'market' | 'cancel' | 'create-bm' | 'deposit' | 'withdraw' | 'bet-order';

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 4): string {
  if (n == null || isNaN(n) || !isFinite(n)) return '—';
  return n.toFixed(dec);
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(3)}%`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SuiScanLink({ address }: { address: string }) {
  return (
    <a href={`https://suiscan.xyz/mainnet/object/${address}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors">
      <ExternalLink size={11} />
    </a>
  );
}

function DepthBar({ level, max, side }: { level: DepthLevel; max: number; side: 'bid' | 'ask' }) {
  const pct = max > 0 ? (level.quantity / max) * 100 : 0;
  const color = side === 'bid' ? '#22c55e' : '#ef4444';
  return (
    <div className="relative flex items-center gap-2 py-0.5 px-2 group">
      <div className="absolute inset-0 opacity-15 rounded" style={{
        background: color, width: `${pct}%`,
        left: side === 'ask' ? 0 : 'auto', right: side === 'bid' ? 0 : 'auto',
      }} />
      {side === 'bid' ? (
        <>
          <span className="text-xs font-mono text-gray-400 flex-1 text-right relative z-10">{fmt(level.quantity, 3)}</span>
          <span className="text-xs font-mono font-bold text-green-400 w-24 text-right relative z-10 tabular-nums">{fmt(level.price, 6)}</span>
        </>
      ) : (
        <>
          <span className="text-xs font-mono font-bold text-red-400 w-24 relative z-10 tabular-nums">{fmt(level.price, 6)}</span>
          <span className="text-xs font-mono text-gray-400 flex-1 relative z-10">{fmt(level.quantity, 3)}</span>
        </>
      )}
    </div>
  );
}

function OrderBook({ poolKey }: { poolKey: string }) {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<PoolDepth>({
    queryKey: ['/api/p2p/deepbook/depth', poolKey],
    queryFn: () => fetch(`/api/p2p/deepbook/depth/${poolKey}?ticks=10`).then(r => r.json()),
    refetchInterval: 12_000, staleTime: 8_000, enabled: !!poolKey,
  });

  if (isLoading) return <div className="text-center py-8 text-gray-500 text-sm animate-pulse">Loading order book…</div>;
  if (error || !data || (data as any).message) return (
    <div className="text-center py-8 text-gray-600 text-sm">Order book unavailable — pool may be newly created</div>
  );

  const maxQty = Math.max(...(data.asks ?? []).map(a => a.quantity), ...(data.bids ?? []).map(b => b.quantity), 0);
  const asksToShow = (data.asks ?? []).slice(0, 8).reverse();
  const bidsToShow = (data.bids ?? []).slice(0, 8);

  return (
    <div>
      <div className="grid grid-cols-2 text-[10px] font-bold uppercase tracking-wider text-gray-600 px-2 pt-2 pb-1 border-b border-[#1e2a3a]">
        <div>Price (ask)</div>
        <div className="text-right">Qty</div>
      </div>
      <div className="py-1">
        {asksToShow.length === 0 ? <div className="text-gray-700 text-xs text-center py-2">No asks</div>
          : asksToShow.map((lvl, i) => <DepthBar key={i} level={lvl} max={maxQty} side="ask" />)}
      </div>
      {data.midPrice != null && (
        <div className="text-center py-2 border-y border-[#1e2a3a]" style={{ background: 'rgba(0,255,255,0.04)' }}>
          <div className="text-cyan-400 font-black text-lg tabular-nums">{fmt(data.midPrice, 6)}</div>
          <div className="text-gray-600 text-xs mt-0.5">
            Mid Price
            {poolKey === 'SBETS_SUI' && data.midPrice != null && (
              <span className="ml-2 text-purple-400">
                ≈ {(1 / data.midPrice).toFixed(3)}x implied odds
              </span>
            )}
          </div>
        </div>
      )}
      <div className="py-1">
        {bidsToShow.length === 0 ? <div className="text-gray-700 text-xs text-center py-2">No bids</div>
          : bidsToShow.map((lvl, i) => <DepthBar key={i} level={lvl} max={maxQty} side="bid" />)}
      </div>
      <div className="grid grid-cols-2 text-[10px] font-bold uppercase tracking-wider text-gray-600 px-2 pt-1 pb-2 border-t border-[#1e2a3a]">
        <div>Qty</div>
        <div className="text-right">Price (bid)</div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 px-2">
        {[
          { label: 'Lot Size',  value: data.lotSize  != null ? fmt(data.lotSize, 0) : '—' },
          { label: 'Min Size',  value: data.minSize  != null ? fmt(data.minSize, 0) : '—' },
          { label: 'Taker Fee', value: fmtPct(data.takerFee) },
          { label: 'Maker Fee', value: fmtPct(data.makerFee) },
        ].map(s => (
          <div key={s.label} className="bg-[#0d1420] border border-[#1e2a3a] rounded-lg px-3 py-2 text-xs text-center">
            <div className="text-white font-bold">{s.value}</div>
            <div className="text-gray-600 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="text-gray-700 text-[10px] text-center mt-2 pb-1">
        Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'} · auto-refreshes every 12s
      </div>
    </div>
  );
}

// ── SBETS Pool Status Banner ───────────────────────────────────────────────────

function SbetsPoolBanner({ onCreatePool }: { onCreatePool: () => void }) {
  const { data } = useQuery<SbetsPoolStatus>({
    queryKey: ['/api/p2p/deepbook/pool/sbets-status'],
    queryFn: () => fetch('/api/p2p/deepbook/pool/sbets-status').then(r => r.json()),
    staleTime: 30_000,
  });

  if (!data) return null;

  if (data.configured) {
    return (
      <div className="rounded-xl px-3 py-2 flex items-center gap-2 text-xs"
        style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />
        <div>
          <span className="text-green-400 font-bold">SBETS/SUI pool live</span>
          <span className="text-gray-500 ml-2 font-mono text-[10px]">{data.poolId?.slice(0, 14)}…</span>
          <a href={`https://suiscan.xyz/mainnet/object/${data.poolId}`} target="_blank" rel="noopener noreferrer"
            className="ml-1 text-cyan-500 hover:text-cyan-400"><ExternalLink size={10} className="inline" /></a>
        </div>
        <span className="ml-auto text-gray-600 text-[10px]">Tick: {data.tickSize} · Lot: {data.lotSize?.toLocaleString()} SBETS</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl px-3 py-2.5 space-y-2"
      style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
      <div className="flex items-start gap-2">
        <AlertCircle size={13} className="text-purple-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-purple-300 font-bold text-xs">SBETS/SUI pool not yet created</div>
          <div className="text-gray-500 text-[10px] mt-0.5 leading-relaxed">
            Create the permissionless DeepBook pool so bets appear as live limit orders.
            Costs 500 DEEP from your wallet.
          </div>
        </div>
      </div>
      <button onClick={onCreatePool}
        className="w-full py-1.5 rounded-lg text-xs font-bold transition-all"
        style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
        Create SBETS/SUI Pool on DeepBook →
      </button>
    </div>
  );
}

// ── Vault Balances ─────────────────────────────────────────────────────────────

function VaultPanel({ poolKey }: { poolKey: string }) {
  const { data, isLoading } = useQuery<VaultBalances>({
    queryKey: ['/api/p2p/deepbook/vault', poolKey],
    queryFn: () => fetch(`/api/p2p/deepbook/vault/${poolKey}`).then(r => r.json()),
    refetchInterval: 30_000, staleTime: 20_000, enabled: !!poolKey,
  });

  if (isLoading) return <div className="text-gray-600 text-xs text-center py-3 animate-pulse">Loading vault…</div>;
  if (!data || (data as any).message) return null;

  const rows = [
    { label: `${data.label?.split('/')[0] ?? 'Base'} Available`, value: fmt(data.baseAvailable, 4) },
    { label: `${data.label?.split('/')[0] ?? 'Base'} Locked`,    value: fmt(data.baseLocked,    4) },
    { label: `${data.label?.split('/')[1] ?? 'Quote'} Available`, value: fmt(data.quoteAvailable, 4) },
    { label: `${data.label?.split('/')[1] ?? 'Quote'} Locked`,    value: fmt(data.quoteLocked,    4) },
    { label: 'DEEP Available', value: fmt(data.deepAvailable, 4) },
    { label: 'DEEP Locked',    value: fmt(data.deepLocked,    4) },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#080f1a', border: '1px solid rgba(0,255,255,0.1)' }}>
      <div className="px-3 py-2 border-b border-[#1e2a3a] text-[10px] font-bold uppercase tracking-wider text-cyan-400/70">
        Pool Vault Balances — {data.label}
      </div>
      <div className="grid grid-cols-2 gap-0">
        {rows.map((r, i) => (
          <div key={r.label} className="px-3 py-2 text-xs"
            style={{ borderBottom: i < rows.length - 2 ? '1px solid rgba(255,255,255,0.04)' : undefined,
                     borderRight: i % 2 === 0 ? '1px solid rgba(255,255,255,0.04)' : undefined }}>
            <div className="text-gray-600 text-[10px]">{r.label}</div>
            <div className="text-white font-mono font-bold mt-0.5">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Input field ────────────────────────────────────────────────────────────────

function InputField({ label, value, onChange, placeholder, type = 'text', step, suffix }:
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; step?: string; suffix?: string }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{label}</label>
      <div className="relative">
        <input
          type={type} step={step} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#0d1420] border border-[#1e2a3a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600
            focus:outline-none focus:border-cyan-500/50 focus:bg-[#0f1825] transition-all font-mono"
          style={suffix ? { paddingRight: '3.5rem' } : undefined}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500 pointer-events-none">{suffix}</span>
        )}
      </div>
    </div>
  );
}

// ── Trade Panel ────────────────────────────────────────────────────────────────

function TradePanel({ poolKey }: { poolKey: string }) {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [tradeTab, setTradeTab]     = useState<TradeTab>('limit');
  const [isBid, setIsBid]           = useState(true);
  const [price, setPrice]           = useState('');
  const [quantity, setQuantity]     = useState('');
  const [bmAddress, setBmAddress]   = useState('');
  const [orderId, setOrderId]       = useState('');
  const [coinKey, setCoinKey]       = useState('SUI');
  const [amount, setAmount]         = useState('');
  const [odds, setOdds]             = useState('');
  const [betStake, setBetStake]     = useState('');
  const [isCreator, setIsCreator]   = useState(true);
  const [betCurrency, setBetCurrency] = useState<'SBETS' | 'SUI'>('SBETS');
  const [status, setStatus]         = useState<{ type: 'idle' | 'loading' | 'ok' | 'err'; msg: string }>({ type: 'idle', msg: '' });

  const walletAddr = account?.address ?? '';

  async function buildAndSign(endpoint: string, body: Record<string, unknown>) {
    setStatus({ type: 'loading', msg: 'Building transaction…' });
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: walletAddr, ...body }),
      });
      const data = await res.json();
      if (!res.ok || !data.transactionBytes) throw new Error(data.message ?? 'Build failed');

      setStatus({ type: 'loading', msg: 'Waiting for wallet…' });
      const tx = Transaction.from(data.transactionBytes);
      const result = await signAndExecute({ transaction: tx } as any);
      const digest: string = (result as any)?.digest ?? (result as any)?.Transaction?.digest ?? '';
      setStatus({ type: 'ok', msg: `Done! Digest: ${digest.slice(0, 12)}…` });
      return { ok: true, digest, data };
    } catch (err: any) {
      setStatus({ type: 'err', msg: err?.message ?? 'Unknown error' });
      return { ok: false };
    }
  }

  // Handlers
  const handleLimit     = () => buildAndSign('/api/p2p/deepbook/order/limit', { balanceManagerAddress: bmAddress, poolKey, price: parseFloat(price), quantity: parseFloat(quantity), isBid, payWithDeep: true });
  const handleMarket    = () => buildAndSign('/api/p2p/deepbook/order/market', { balanceManagerAddress: bmAddress, poolKey, quantity: parseFloat(quantity), isBid, payWithDeep: true });
  const handleCancel    = () => buildAndSign('/api/p2p/deepbook/order/cancel', { balanceManagerAddress: bmAddress, poolKey, orderId });
  const handleCancelAll = () => buildAndSign('/api/p2p/deepbook/order/cancel-all', { balanceManagerAddress: bmAddress, poolKey });
  const handleCreateBM  = () => buildAndSign('/api/p2p/deepbook/balance-manager/create', {});
  const handleDeposit   = () => buildAndSign('/api/p2p/deepbook/balance-manager/deposit', { balanceManagerAddress: bmAddress, coinKey, amount: parseFloat(amount) });
  const handleWithdraw  = () => buildAndSign('/api/p2p/deepbook/balance-manager/withdraw', { balanceManagerAddress: bmAddress, coinKey, amount: parseFloat(amount) });

  async function handleBetOrder() {
    const oddsNum = parseFloat(odds);
    const stakeNum = parseFloat(betStake);
    if (!bmAddress) return setStatus({ type: 'err', msg: 'Balance Manager address required' });
    if (isNaN(oddsNum) || oddsNum <= 1) return setStatus({ type: 'err', msg: 'Odds must be greater than 1.0' });
    if (isNaN(stakeNum) || stakeNum <= 0) return setStatus({ type: 'err', msg: 'Stake must be a positive number' });
    await buildAndSign('/api/p2p/deepbook/bet/limit-order', {
      balanceManagerAddress: bmAddress,
      odds: oddsNum,
      stakeAmount: stakeNum,
      isCreator,
      currency: betCurrency,
      payWithDeep: true,
    });
  }

  async function handleCreateSbetsPool() {
    await buildAndSign('/api/p2p/deepbook/pool/create-sbets', {});
  }

  if (!walletAddr) {
    return (
      <div className="text-center py-6 space-y-2">
        <Wallet size={24} className="text-gray-600 mx-auto" />
        <div className="text-gray-500 text-sm">Connect your wallet to place DeepBook orders</div>
      </div>
    );
  }

  const impliedProb = parseFloat(odds) > 1 ? (1 / parseFloat(odds)) : null;

  const tabs: { key: TradeTab; label: string; icon: React.ReactNode }[] = [
    { key: 'bet-order', label: 'Bet Order', icon: <Target size={10} /> },
    { key: 'limit',     label: 'Limit',     icon: <ArrowUpDown size={10} /> },
    { key: 'market',    label: 'Market',    icon: <Zap size={10} /> },
    { key: 'deposit',   label: 'Deposit',   icon: <ArrowDownCircle size={10} /> },
    { key: 'withdraw',  label: 'Withdraw',  icon: <ArrowUpCircle size={10} /> },
    { key: 'cancel',    label: 'Cancel',    icon: <RefreshCw size={10} /> },
    { key: 'create-bm', label: 'Create BM', icon: <PlusCircle size={10} /> },
  ];

  return (
    <div className="space-y-3">
      {/* Tab bar — scrollable */}
      <div className="flex gap-1 p-1 rounded-lg overflow-x-auto" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTradeTab(t.key); setStatus({ type: 'idle', msg: '' }); }}
            className="flex-shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all"
            style={tradeTab === t.key
              ? { background: t.key === 'bet-order' ? 'rgba(168,85,247,0.2)' : 'rgba(0,255,255,0.12)',
                  color: t.key === 'bet-order' ? '#a855f7' : '#00ffff',
                  border: `1px solid ${t.key === 'bet-order' ? 'rgba(168,85,247,0.4)' : 'rgba(0,255,255,0.3)'}` }
              : { color: '#6b7280' }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* BM address — all tabs except create-bm */}
      {tradeTab !== 'create-bm' && (
        <InputField label="Your Balance Manager Address (0x…)" value={bmAddress}
          onChange={setBmAddress} placeholder="0x1234…your_balance_manager" />
      )}

      {/* ── Bet Order tab ── */}
      {tradeTab === 'bet-order' && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 text-xs space-y-1.5"
            style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
            <div className="text-purple-300 font-bold flex items-center gap-1.5"><Target size={12} />Bets as DeepBook Limit Orders</div>
            <p className="text-gray-400 leading-relaxed">
              Your bet becomes a real on-chain limit order on the <span className="text-white font-semibold">SBETS/SUI pool</span> — no second pool needed for either currency.
              Price = implied probability (1/odds). Any Sui wallet or bot can fill your order.
            </p>
            <div className="flex items-start gap-1.5 pt-0.5">
              <span className="text-green-400 mt-0.5">✓</span>
              <span className="text-gray-500">
                {betCurrency === 'SUI'
                  ? 'SUI bet → BID order (locks SUI in Balance Manager)'
                  : 'SBETS bet → ASK order (locks SBETS in Balance Manager)'}
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-green-400 mt-0.5">✓</span>
              <span className="text-gray-500">
                {betCurrency === 'SUI'
                  ? 'Requires: Balance Manager + SUI deposited into it'
                  : 'Requires: Balance Manager + SBETS deposited into it'}
              </span>
            </div>
          </div>

          {/* Currency selector */}
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
            {([
              { v: 'SBETS' as const, label: 'SBETS Bet', color: '#a855f7' },
              { v: 'SUI'  as const, label: 'SUI Bet',   color: '#00ffff' },
            ] as const).map(c => (
              <button key={c.v} onClick={() => setBetCurrency(c.v)}
                className="flex-1 rounded-md py-1.5 text-xs font-black transition-all"
                style={betCurrency === c.v
                  ? { background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}55` }
                  : { color: '#6b7280' }}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Post / Take toggle */}
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
            {[
              { v: true,  label: 'Post Offer', color: '#ef4444' },
              { v: false, label: 'Take Offer', color: '#22c55e' },
            ].map(s => (
              <button key={String(s.v)} onClick={() => setIsCreator(s.v)}
                className="flex-1 rounded-md py-1.5 text-xs font-black transition-all"
                style={isCreator === s.v
                  ? { background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}55` }
                  : { color: '#6b7280' }}>
                {s.label}
              </button>
            ))}
          </div>

          <InputField label="Odds (e.g. 1.47)" value={odds} onChange={setOdds}
            placeholder="1.47" type="number" step="0.01" />
          <InputField
            label={`Stake (${betCurrency})`}
            value={betStake} onChange={setBetStake}
            placeholder={betCurrency === 'SUI' ? '2.5' : '1000000'}
            type="number" step={betCurrency === 'SUI' ? '0.1' : '1000'}
            suffix={betCurrency} />

          {impliedProb !== null && (() => {
            const stakeNum = parseFloat(betStake) || 0;
            const isSui = betCurrency === 'SUI';
            const deepbookQty = isSui && impliedProb > 0 ? stakeNum / impliedProb : stakeNum;
            const suiLocked   = isSui ? stakeNum : stakeNum * impliedProb;
            // Side: SUI creator = BID, SBETS creator = ASK
            const orderSide = isSui
              ? (isCreator ? 'BUY (BID)' : 'SELL (ASK)')
              : (isCreator ? 'SELL (ASK)' : 'BUY (BID)');
            const sideColor = orderSide.includes('BUY') ? '#22c55e' : '#ef4444';
            return (
              <div className="rounded-lg px-3 py-2.5 space-y-1.5"
                style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">DeepBook price</span>
                  <span className="text-purple-300 font-mono font-bold">{impliedProb.toFixed(6)} SUI/SBETS</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Implied probability</span>
                  <span className="text-white font-bold">{(impliedProb * 100).toFixed(2)}%</span>
                </div>
                {stakeNum > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">DeepBook quantity</span>
                    <span className="text-white font-mono">{deepbookQty.toFixed(isSui ? 4 : 0)} SBETS</span>
                  </div>
                )}
                {stakeNum > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">{isSui ? 'SUI locked in BM' : 'SUI received if filled'}</span>
                    <span className={`font-mono font-bold ${isSui ? 'text-cyan-400' : 'text-green-400'}`}>
                      {suiLocked.toFixed(4)} SUI
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Order side</span>
                  <span className="font-bold" style={{ color: sideColor }}>{orderSide}</span>
                </div>
                <div className="text-[10px] text-gray-600 pt-0.5">
                  Visible on <span className="text-cyan-400">DeepBook</span>, SuiScan, and any Sui DEX aggregator
                </div>
              </div>
            );
          })()}

          <button onClick={handleBetOrder} disabled={isPending || !impliedProb}
            className="w-full py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
            style={{ background: betCurrency === 'SUI' ? 'rgba(0,255,255,0.1)' : 'rgba(168,85,247,0.15)', color: betCurrency === 'SUI' ? '#00ffff' : '#a855f7', border: `1px solid ${betCurrency === 'SUI' ? 'rgba(0,255,255,0.3)' : 'rgba(168,85,247,0.35)'}` }}>
            {isPending ? 'Waiting for wallet…' : `Post ${betCurrency} Bet → DeepBook @ ${impliedProb?.toFixed(4) ?? '—'}`}
          </button>
        </div>
      )}

      {/* ── Limit order tab ── */}
      {tradeTab === 'limit' && (
        <div className="space-y-3">
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
            {[{ v: true, label: 'Buy', color: '#22c55e' }, { v: false, label: 'Sell', color: '#ef4444' }].map(s => (
              <button key={String(s.v)} onClick={() => setIsBid(s.v)}
                className="flex-1 rounded-md py-1.5 text-xs font-black transition-all"
                style={isBid === s.v
                  ? { background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}55` }
                  : { color: '#6b7280' }}>
                {s.label}
              </button>
            ))}
          </div>
          <InputField label="Price" value={price} onChange={setPrice} placeholder="0.5000" type="number" step="0.0001" />
          <InputField label="Quantity" value={quantity} onChange={setQuantity} placeholder="1000" type="number" step="0.001" />
          <button onClick={handleLimit} disabled={isPending}
            className="w-full py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
            style={{ background: isBid ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: isBid ? '#22c55e' : '#ef4444',
              border: `1px solid ${isBid ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            {isPending ? 'Waiting…' : `Place Limit ${isBid ? 'Buy' : 'Sell'}`}
          </button>
        </div>
      )}

      {/* ── Market order tab ── */}
      {tradeTab === 'market' && (
        <div className="space-y-3">
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
            {[{ v: true, label: 'Buy', color: '#22c55e' }, { v: false, label: 'Sell', color: '#ef4444' }].map(s => (
              <button key={String(s.v)} onClick={() => setIsBid(s.v)}
                className="flex-1 rounded-md py-1.5 text-xs font-black transition-all"
                style={isBid === s.v
                  ? { background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}55` }
                  : { color: '#6b7280' }}>
                {s.label}
              </button>
            ))}
          </div>
          <InputField label="Quantity" value={quantity} onChange={setQuantity} placeholder="1000" type="number" step="0.001" />
          <div className="text-[10px] text-yellow-500/70 px-1">Market orders fill immediately at the best available price.</div>
          <button onClick={handleMarket} disabled={isPending}
            className="w-full py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
            style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308', border: '1px solid rgba(234,179,8,0.3)' }}>
            {isPending ? 'Waiting…' : `Market ${isBid ? 'Buy' : 'Sell'}`}
          </button>
        </div>
      )}

      {/* ── Deposit tab ── */}
      {tradeTab === 'deposit' && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 text-xs"
            style={{ background: 'rgba(0,255,255,0.04)', border: '1px solid rgba(0,255,255,0.1)' }}>
            <div className="text-cyan-400 font-bold flex items-center gap-1.5 mb-1"><ArrowDownCircle size={12} />Deposit into Balance Manager</div>
            <p className="text-gray-400 leading-relaxed">
              Fund your Balance Manager with SBETS or SUI to place orders. SBETS is required to post bet limit orders (SELL side).
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Coin</label>
            <div className="flex gap-1">
              {['SUI', 'SBETS', 'DEEP'].map(c => (
                <button key={c} onClick={() => setCoinKey(c)}
                  className="flex-1 rounded-lg py-2 text-xs font-bold transition-all"
                  style={coinKey === c
                    ? { background: 'rgba(0,255,255,0.12)', color: '#00ffff', border: '1px solid rgba(0,255,255,0.35)' }
                    : { background: 'rgba(255,255,255,0.04)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <InputField label="Amount" value={amount} onChange={setAmount}
            placeholder="1000" type="number" step="0.001" suffix={coinKey} />
          <button onClick={handleDeposit} disabled={isPending}
            className="w-full py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
            style={{ background: 'rgba(0,255,255,0.1)', color: '#00ffff', border: '1px solid rgba(0,255,255,0.25)' }}>
            {isPending ? 'Waiting…' : `Deposit ${amount || '—'} ${coinKey}`}
          </button>
        </div>
      )}

      {/* ── Withdraw tab ── */}
      {tradeTab === 'withdraw' && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 text-xs"
            style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)' }}>
            <div className="text-red-400 font-bold flex items-center gap-1.5 mb-1"><ArrowUpCircle size={12} />Withdraw from Balance Manager</div>
            <p className="text-gray-400 leading-relaxed">
              Withdraw SBETS or SUI back to your wallet from the Balance Manager.
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Coin</label>
            <div className="flex gap-1">
              {['SUI', 'SBETS', 'DEEP'].map(c => (
                <button key={c} onClick={() => setCoinKey(c)}
                  className="flex-1 rounded-lg py-2 text-xs font-bold transition-all"
                  style={coinKey === c
                    ? { background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }
                    : { background: 'rgba(255,255,255,0.04)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <InputField label="Amount to Withdraw" value={amount} onChange={setAmount}
            placeholder="1000" type="number" step="0.001" suffix={coinKey} />
          <button onClick={handleWithdraw} disabled={isPending}
            className="w-full py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
            {isPending ? 'Waiting…' : `Withdraw ${amount || '—'} ${coinKey}`}
          </button>
        </div>
      )}

      {/* ── Cancel order tab ── */}
      {tradeTab === 'cancel' && (
        <div className="space-y-3">
          <InputField label="Order ID (on-chain)" value={orderId} onChange={setOrderId} placeholder="1234567890" />
          <div className="flex gap-2">
            <button onClick={handleCancel} disabled={isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
              {isPending ? 'Waiting…' : 'Cancel Order'}
            </button>
            <button onClick={handleCancelAll} disabled={isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.06)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.15)' }}>
              {isPending ? 'Waiting…' : 'Cancel All'}
            </button>
          </div>
        </div>
      )}

      {/* ── Create Balance Manager tab ── */}
      {tradeTab === 'create-bm' && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 text-xs space-y-2"
            style={{ background: 'rgba(0,255,255,0.04)', border: '1px solid rgba(0,255,255,0.1)' }}>
            <div className="text-cyan-400 font-bold flex items-center gap-1.5"><Info size={12} />What is a Balance Manager?</div>
            <p className="text-gray-400 leading-relaxed">
              A shared Sui object that holds your funds for DeepBook trading. Create it once, then deposit SBETS
              and SUI into it to start placing orders (including bet limit orders).
            </p>
            <p className="text-gray-500 text-[10px]">
              After creating, copy the object ID from your wallet's tx and paste it as "Balance Manager Address" above.
            </p>
          </div>
          <button onClick={handleCreateBM} disabled={isPending}
            className="w-full py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50"
            style={{ background: 'rgba(0,255,255,0.1)', color: '#00ffff', border: '1px solid rgba(0,255,255,0.25)' }}>
            {isPending ? 'Waiting for wallet…' : 'Create Balance Manager'}
          </button>

          <div className="border-t border-[#1e2a3a] pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600 mb-2">Create SBETS/SUI Pool</div>
            <div className="text-[10px] text-gray-500 mb-2 leading-relaxed">
              Creates the SBETS/SUI permissionless pool on DeepBook. Costs 500 DEEP from your wallet.
              Required once for bets to appear as live orders.
            </div>
            <button onClick={handleCreateSbetsPool} disabled={isPending}
              className="w-full py-2 rounded-xl text-xs font-black transition-all disabled:opacity-50"
              style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.25)' }}>
              {isPending ? 'Waiting…' : 'Create SBETS/SUI Pool (500 DEEP)'}
            </button>
          </div>
        </div>
      )}

      {/* Status */}
      {status.type !== 'idle' && (
        <div className={`rounded-lg px-3 py-2 text-xs font-mono break-all
          ${status.type === 'ok'  ? 'bg-green-900/30 text-green-400 border border-green-500/25'
          : status.type === 'err' ? 'bg-red-900/30 text-red-400 border border-red-500/25'
          :                          'bg-cyan-900/20 text-cyan-400 border border-cyan-500/20 animate-pulse'}`}>
          {status.msg}
          {status.type === 'ok' && (
            <a href={`https://suiscan.xyz/mainnet/tx/${status.msg.match(/[A-Za-z0-9]{43,}/)?.[0] ?? ''}`}
              target="_blank" rel="noopener noreferrer"
              className="ml-2 underline hover:text-white transition-colors">View on SuiScan ↗</a>
          )}
        </div>
      )}

      <div className="text-[10px] text-gray-600 text-center">
        Wallet: {walletAddr.slice(0, 8)}…{walletAddr.slice(-6)} · Orders go on-chain via DeepBook v3
      </div>
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────

export function DeepBookPanel() {
  const [selectedPool, setSelectedPool] = useState<string>('SBETS_SUI');
  const [showAll, setShowAll]           = useState(false);
  const [showTrade, setShowTrade]       = useState(false);
  const [showVault, setShowVault]       = useState(false);

  const { data: poolsData } = useQuery<{ featured: PoolInfo[]; all: PoolInfo[] }>({
    queryKey: ['/api/p2p/deepbook/pools'],
    queryFn: () => fetch('/api/p2p/deepbook/pools').then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: summariesData, refetch: refetchSummaries } = useQuery<{ summaries: PoolSummary[] }>({
    queryKey: ['/api/p2p/deepbook/summaries'],
    queryFn: () => fetch('/api/p2p/deepbook/summaries').then(r => r.json()),
    refetchInterval: 15_000, staleTime: 10_000,
  });

  const { data: sbetsStatus } = useQuery<SbetsPoolStatus>({
    queryKey: ['/api/p2p/deepbook/pool/sbets-status'],
    queryFn: () => fetch('/api/p2p/deepbook/pool/sbets-status').then(r => r.json()),
    staleTime: 30_000,
  });

  const featured  = poolsData?.featured ?? [];
  const summaries = summariesData?.summaries ?? [];

  // Fall back to SUI_USDC if SBETS pool not ready
  const effectivePool = selectedPool === 'SBETS_SUI' && !sbetsStatus?.configured ? 'SUI_USDC' : selectedPool;
  const selectedInfo  = featured.find(p => p.key === effectivePool) ?? featured[0];

  function handleCreatePool() {
    setShowTrade(true);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.2)' }}>
            <TrendingUp size={16} className="text-cyan-400" />
          </div>
          <div>
            <div className="text-white font-black text-sm">DeepBook v3 — Live CLOB</div>
            <div className="text-gray-500 text-xs">Bets → real limit orders on Sui's native DEX</div>
          </div>
        </div>
        <button onClick={() => refetchSummaries()}
          className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10" title="Refresh">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* SBETS pool status banner */}
      <SbetsPoolBanner onCreatePool={handleCreatePool} />

      {/* Pool price summary strip */}
      {summaries.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {/* Always show SBETS_SUI slot first */}
          {sbetsStatus?.configured ? null : (
            <button onClick={() => {}} disabled
              className="flex-shrink-0 rounded-xl px-3 py-2 text-xs opacity-50 cursor-not-allowed"
              style={{ background: 'rgba(168,85,247,0.06)', border: '1px dashed rgba(168,85,247,0.3)' }}>
              <div className="font-bold text-purple-400">SBETS/SUI</div>
              <div className="font-mono text-gray-600 mt-0.5 text-[10px]">not created</div>
            </button>
          )}
          {summaries.map(s => (
            <button key={s.key} onClick={() => setSelectedPool(s.key)}
              className="flex-shrink-0 rounded-xl px-3 py-2 text-xs transition-all text-left"
              style={effectivePool === s.key
                ? { background: s.key === 'SBETS_SUI' ? 'rgba(168,85,247,0.15)' : 'rgba(0,255,255,0.12)',
                    border: `1px solid ${s.key === 'SBETS_SUI' ? 'rgba(168,85,247,0.4)' : 'rgba(0,255,255,0.4)'}` }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="font-bold"
                style={{ color: effectivePool === s.key ? (s.key === 'SBETS_SUI' ? '#a855f7' : '#00ffff') : '#9ca3af' }}>
                {s.label}
              </div>
              <div className={`font-mono tabular-nums mt-0.5 ${effectivePool === s.key ? 'text-white' : 'text-gray-500'}`}>
                {s.midPrice != null ? fmt(s.midPrice, s.key === 'SBETS_SUI' ? 6 : 4) : '…'}
              </div>
              {s.key === 'SBETS_SUI' && s.midPrice != null && (
                <div className="text-[10px] text-purple-400 mt-0.5">
                  {(1 / s.midPrice).toFixed(2)}x odds
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Order book for selected pool */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#080f1a', border: '1px solid rgba(0,255,255,0.07)' }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2a3a]">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <span style={{ color: effectivePool === 'SBETS_SUI' ? '#a855f7' : '#00ffff' }}>
              {selectedInfo?.label ?? effectivePool}
            </span>
            {effectivePool === 'SBETS_SUI' && (
              <span className="text-[10px] text-purple-400/70 font-normal">· price = implied probability</span>
            )}
          </div>
          {selectedInfo?.address && <SuiScanLink address={selectedInfo.address} />}
        </div>
        <OrderBook poolKey={effectivePool} />
      </div>

      {/* Pool list — all pools */}
      {featured.length > 0 && (
        <div>
          <button onClick={() => setShowAll(p => !p)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            {showAll ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showAll ? 'Hide' : 'Show'} all featured pools ({featured.length})
          </button>
          {showAll && (
            <div className="mt-2 space-y-1">
              {featured.map(p => (
                <button key={p.key} onClick={() => { setSelectedPool(p.key); setShowAll(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all"
                  style={effectivePool === p.key
                    ? { background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.2)' }
                    : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{p.label}</span>
                    <span className="text-gray-600 font-mono text-[10px]">{p.address.slice(0, 10)}…</span>
                  </div>
                  <SuiScanLink address={p.address} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trade panel — collapsible */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#080f1a', border: '1px solid rgba(0,255,255,0.07)' }}>
        <button onClick={() => setShowTrade(p => !p)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown size={12} className="text-cyan-400" />
            Trade / Post Orders
            <span className="text-[10px] text-gray-600 font-normal ml-1">
              — place orders on {selectedInfo?.label ?? effectivePool}
            </span>
          </div>
          {showTrade ? <ChevronUp size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
        </button>
        {showTrade && (
          <div className="px-3 pb-4 pt-1 border-t border-[#1e2a3a]">
            <TradePanel poolKey={effectivePool} />
          </div>
        )}
      </div>

      {/* Vault balances — collapsible */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#080f1a', border: '1px solid rgba(0,255,255,0.07)' }}>
        <button onClick={() => setShowVault(p => !p)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-white hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-1.5">
            <Wallet size={12} className="text-cyan-400" />
            Pool Vault Balances
          </div>
          {showVault ? <ChevronUp size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
        </button>
        {showVault && (
          <div className="px-3 pb-3 pt-1 border-t border-[#1e2a3a]">
            <VaultPanel poolKey={effectivePool} />
          </div>
        )}
      </div>
    </div>
  );
}
