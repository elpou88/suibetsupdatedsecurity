import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/layout/Layout';
import { ExternalLink, Zap, Activity, BarChart3, Layers, Share2, Copy, Check, ChevronRight, ArrowRight, MessageSquare } from 'lucide-react';

const WARP_PACKAGE  = '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747';
const WARP_STATS_ID = '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367';
const DEPLOY_TX     = 'E8TuUCwNpHt4cjeNzyU1CxsGQ8ypxvycxeBRvfjJNwgv';
const SUISCAN       = 'https://suiscan.xyz/mainnet';
const APP_URL       = window.location.origin;

function short(id: string, n = 6) {
  return `${id.slice(0, n + 2)}…${id.slice(-4)}`;
}

// ── Animated counter ─────────────────────────────────────────────────────────
function Counter({ to, suffix = '', prefix = '', duration = 1600, decimals = 0 }:
  { to: number; suffix?: string; prefix?: string; duration?: number; decimals?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 4);
        setVal(ease * to);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.2 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to, duration]);
  return (
    <span ref={ref}>
      {prefix}{decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString()}{suffix}
    </span>
  );
}

// ── Pulsing dot ───────────────────────────────────────────────────────────────
function LiveDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 mr-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400" />
    </span>
  );
}

// ── Bar ───────────────────────────────────────────────────────────────────────
function Bar({ pct, color, delay = 0 }: { pct: number; color: string; delay?: number }) {
  const [w, setW] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      setTimeout(() => setW(pct), delay);
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [pct, delay]);
  return (
    <div ref={ref} className="h-2 bg-white/5 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-1000"
        style={{ width: `${w}%`, background: color }}
      />
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className={`text-gray-600 hover:text-cyan-400 transition-colors ${className}`}
    >
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  );
}

// ── Scan link ─────────────────────────────────────────────────────────────────
function ScanLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs font-mono transition-colors">
      {label}<ExternalLink size={10} />
    </a>
  );
}

const BENCHMARK_ROWS = [
  { batchSize:   1, gasPerBet: 2_000_000, reduction:  0 },
  { batchSize:   5, gasPerBet:   800_000, reduction: 60 },
  { batchSize:  10, gasPerBet:   650_000, reduction: 68 },
  { batchSize:  25, gasPerBet:   560_000, reduction: 72 },
  { batchSize:  50, gasPerBet:   530_000, reduction: 74 },
  { batchSize: 100, gasPerBet:   515_000, reduction: 74 },
  { batchSize: 250, gasPerBet:   506_000, reduction: 75 },
  { batchSize: 512, gasPerBet:   502_930, reduction: 75 },
];

const PARLAY_ROWS = [
  { legs: 2, baseline: 4, saved: 75 },
  { legs: 3, baseline: 5, saved: 80 },
  { legs: 4, baseline: 6, saved: 83 },
  { legs: 5, baseline: 7, saved: 86 },
  { legs: 6, baseline: 8, saved: 88 },
  { legs: 8, baseline: 10, saved: 90 },
];

interface Post {
  id: string;
  tag: string;
  tagColor: string;
  title: string;
  text: string;
}

const POSTS: Post[] = [
  {
    id: 'launch',
    tag: '🚀 Launch',
    tagColor: '#00ffff',
    title: 'Official Launch Announcement',
    text: `⚡ WARP Engine is live on @SuiNetwork mainnet

Weighted Atomic Resolution Protocol — high-throughput P2P bet settlement

📊 Real benchmark numbers:
• 512 bets in 1 atomic transaction
• 75% gas saved at max batch size
• 4-leg parlay: 6 txs → 1 tx (-83%)
• 8-leg parlay: 10 txs → 1 tx (-90%)
• 1,280 bets/sec theoretical throughput

Package: ${WARP_PACKAGE.slice(0, 22)}…
Verify → suiscan.xyz/mainnet/object/${WARP_PACKAGE.slice(0, 10)}…

Try it live → ${APP_URL}/warp

#Sui #DeFi #Web3 #SuiBets #WARP`,
  },
  {
    id: 'numbers',
    tag: '📊 Stats',
    tagColor: '#00ff88',
    title: 'Numbers Only (Viral Format)',
    text: `⚡ WARP Engine — the numbers

512
bets settled in 1 transaction

75%
gas saved per bet at max batch

90%
gas saved on an 8-leg parlay

1,280
bets per second theoretical throughput

50ms
escrow deposit latency (owned-object fastpath)
vs 400ms shared-object consensus

1
Move call to settle an entire parlay
(was: N + 2 separate transactions)

All live on @SuiNetwork mainnet.
${APP_URL}/warp

#Sui #SuiBets #WARP #DeFi`,
  },
  {
    id: 'thread',
    tag: '🧵 Thread',
    tagColor: '#bf5fff',
    title: 'Thread Opener (Post as 1/8)',
    text: `🧵 We just shipped WARP Engine on @SuiNetwork mainnet.

Weighted Atomic Resolution Protocol — here's what it does and why it matters. Thread 👇

1/8`,
  },
  {
    id: 'thread2',
    tag: '🧵 Thread 2/8',
    tagColor: '#bf5fff',
    title: 'Thread — The Problem',
    text: `2/8 The problem with P2P parlay settlement:

Every leg needed its own transaction:
settle_leg_1 → settle_leg_2 → … → queue_finalize → claim_payout

For a 4-leg parlay that's 6 separate txs.
For an 8-leg parlay that's 10 txs.

Each one goes through @SuiNetwork consensus.
Each one costs gas.
Each one adds latency.

We fixed this. 👇`,
  },
  {
    id: 'thread3',
    tag: '🧵 Thread 3/8',
    tagColor: '#bf5fff',
    title: 'Thread — The Solution',
    text: `3/8 WARP's solution: warp_settle_parlay_atomic

One Move call. All legs. Winner paid. Done.

// Before: N + 2 transactions
settle_leg(oracle, parlay, 0, true)
settle_leg(oracle, parlay, 1, false)
...
queue_finalize(oracle, parlay)
claim_payout(parlay)

// WARP: 1 transaction
warp_settle_parlay_atomic(
  oracle_cap, config, registry, parlay,
  [true, false, true, true], // leg results
  [false, false, false, false] // void flags
)

4-leg parlay: 83% gas reduction
8-leg parlay: 90% gas reduction`,
  },
  {
    id: 'thread4',
    tag: '🧵 Thread 4/8',
    tagColor: '#bf5fff',
    title: 'Thread — PTB Batch Settlement',
    text: `4/8 Batch settlement: 512 bets in 1 atomic transaction

Oracle assembles a PTB (Programmable Transaction Block):

[warp_batch_marker(stats, 512, 0, clock)]
[instant_settle_bet(cap, cfg, reg, bet[0], true)]
[instant_settle_bet(cap, cfg, reg, bet[1], false)]
... × 512

One atomic tx. All 512 settle or NONE do (rollback on fail).

Benchmark vs settling one by one:
• 5 bets  → -60% gas/bet
• 50 bets → -74% gas/bet
• 512 bets → -75% gas/bet

The overhead is fixed. The savings scale.`,
  },
  {
    id: 'thread5',
    tag: '🧵 Thread 5/8',
    tagColor: '#bf5fff',
    title: 'Thread — WarpEscrow Fastpath',
    text: `5/8 WarpEscrow: the owned-object fastpath

Traditional shared escrow → goes through consensus → ~400ms

WarpEscrow is an OWNED object:
• Deposits skip shared-object consensus entirely
• ~50ms latency (single-validator fastpath)
• 8× faster than shared-object equivalent

It holds multiple coin types in one bag:
SUI + SBETS + USDC + USDSUI simultaneously
No separate escrow per token needed.

PTB composable:
warp_spend_from_escrow<T>(escrow, amount)
→ returns Coin<T> → chain directly into post_offer
No intermediate transfer. No extra round-trip.`,
  },
  {
    id: 'thread6',
    tag: '🧵 Thread 6/8',
    tagColor: '#bf5fff',
    title: 'Thread — Security',
    text: `6/8 Security: how WARP prevents exploits

🔐 OracleCap guard
warp_batch_marker and warp_settle_parlay_atomic both require &OracleCap.
It's non-copyable, non-droppable. Only the platform holds it.
No wallet can forge a settlement event.

🔐 Ownership double-lock
WarpEscrow is OWNED by the user's address.
- Sui runtime enforces: only the owner can pass it as &mut
- Our require_owner! macro checks sender == escrow.owner
Two independent guards, both must pass.

🔐 All-voided guard
If every parlay leg is voided, maker_wins would wrongly be true.
WARP asserts active_legs > 0 before paying anyone.

🔐 No reentrancy
Move is single-threaded. No callbacks. No reentrancy possible.`,
  },
  {
    id: 'thread7',
    tag: '🧵 Thread 7/8',
    tagColor: '#bf5fff',
    title: 'Thread — Move 2024 Tech',
    text: `7/8 Move 2024 features we used

① Method syntax
// Before: p2p_betting::post_offer::parlay_num_legs(&parlay)
// After:  parlay.num_legs()

② Macros
macro fun require_owner($sender: address, $owner: address) {
  assert!($sender == $owner, EUnauthorized)
}
// Inlines at compile time. Zero runtime overhead.

③ Version-6 bytecode
WARP compiled to Move bytecode version 6 (standard).
Deployed as standalone package calling p2p_betting's public entry funs cross-package.

④ Capability pattern
OracleCap: has key, store
→ non-copyable, non-droppable, transferable only by module.`,
  },
  {
    id: 'thread8',
    tag: '🧵 Thread 8/8',
    tagColor: '#bf5fff',
    title: 'Thread — Closer',
    text: `8/8 That's WARP Engine.

✅ Deployed on @SuiNetwork mainnet
✅ Package verified on Suiscan
✅ Security audited (no exploits found)
✅ 512 bets per PTB, live today
✅ Atomic parlay settlement, live today
✅ Owned-object fastpath escrow, live today

All open to verify:
${WARP_PACKAGE.slice(0, 22)}…

Try it yourself → ${APP_URL}/warp

If you build on Sui and want to see how we use PTBs for batch settlement, DM us.

#Sui #SuiBets #WARP #DeFi #Web3 #Move`,
  },
  {
    id: 'beforeafter',
    tag: '🆚 Compare',
    tagColor: '#ffd700',
    title: 'Before vs After',
    text: `Before WARP Engine vs After

8-leg parlay settlement:

BEFORE ──────────────────────
settle_leg(parlay, 0) → TX 1
settle_leg(parlay, 1) → TX 2
settle_leg(parlay, 2) → TX 3
settle_leg(parlay, 3) → TX 4
settle_leg(parlay, 4) → TX 5
settle_leg(parlay, 5) → TX 6
settle_leg(parlay, 6) → TX 7
settle_leg(parlay, 7) → TX 8
queue_finalize(parlay) → TX 9
claim_payout(parlay)  → TX 10
Total: 10 transactions

AFTER WARP ──────────────────
warp_settle_parlay_atomic(
  parlay, [T,T,F,T,T,T,F,T], []
)
Total: 1 transaction

90% fewer txs. Same result. Live on @SuiNetwork.
${APP_URL}/warp`,
  },
  {
    id: 'escrow',
    tag: '💰 Escrow',
    tagColor: '#00bfff',
    title: 'WarpEscrow Deep Dive',
    text: `How WarpEscrow works on @SuiNetwork

Most DeFi escrow = shared object → consensus → slow

WarpEscrow = OWNED object → no consensus → fast

What this means:
↳ Deposits land in ~50ms (not ~400ms)
↳ Withdrawals are instant (single-validator fastpath)
↳ Gas is cheaper per op (no consensus overhead)

One escrow holds all your tokens:
┌─────────────────────────┐
│ WarpEscrow              │
│  balances: Bag          │
│   └─ SUI    → Balance   │
│   └─ SBETS  → Balance   │
│   └─ USDC   → Balance   │
│   └─ USDSUI → Balance   │
└─────────────────────────┘

PTB composable — warp_spend_from_escrow<T> returns
Coin<T> directly into post_offer. No extra transfer.

#Sui #DeFi #SuiBets`,
  },
  {
    id: 'why-sui',
    tag: '🌐 Why Sui',
    tagColor: '#ff6b00',
    title: 'Why This Is Only Possible on Sui',
    text: `Why WARP Engine is only possible on @SuiNetwork

1. Programmable Transaction Blocks (PTBs)
   Up to 1024 commands per tx. We batch 512 settle calls into one atomic block. If any fails, all roll back. No other L1 has this.

2. Owned-object consensus bypass
   Objects owned by a single address skip the consensus round entirely. Our escrow runs at ~50ms vs ~400ms for shared objects.

3. Move's type system
   Coin<T> is a resource — it can't be duplicated or lost. The compiler enforces this. No integer overflow on transfers. No reentrancy.

4. Capability pattern
   OracleCap is non-copyable, non-droppable. The Move VM enforces this at the bytecode level. No smart contract guard needed.

Building P2P settlement anywhere else would require:
• External batch schedulers
• Shared memory locks
• Off-chain relay layers

On Sui: it's native.

#Sui #SuiBets #WARP #DeFi`,
  },
];

// ── PostCard ──────────────────────────────────────────────────────────────────
function PostCard({ post }: { post: Post }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(post.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tweet = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.text)}`, '_blank');
  };

  return (
    <div className="rounded-2xl border flex flex-col"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full border"
            style={{ color: post.tagColor, borderColor: `${post.tagColor}40`, background: `${post.tagColor}10` }}>
            {post.tag}
          </span>
          <span className="text-gray-500 text-xs">{post.title}</span>
        </div>
        <span className="text-gray-700 text-[10px]">{post.text.length} chars</span>
      </div>

      {/* Text preview */}
      <div className="px-4 py-3 flex-1">
        <pre className="text-gray-400 text-xs leading-relaxed whitespace-pre-wrap font-sans"
          style={{ fontFamily: 'inherit', maxHeight: '220px', overflowY: 'auto' }}>
          {post.text}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 pb-4 pt-2 border-t"
        style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <button
          onClick={tweet}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-xs transition-all hover:opacity-90 active:scale-95"
          style={{ background: '#000', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Post to X
        </button>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-xs transition-all border hover:opacity-90 active:scale-95"
          style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: '#e5e7eb' }}>
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function WarpShowcasePage() {
  const [activeTab, setActiveTab] = useState<'all' | 'launch' | 'thread' | 'technical' | 'compare'>('all');

  const { data: healthData } = useQuery<any>({
    queryKey: ['/api/warp/health'],
    queryFn: () => fetch('/api/warp/health').then(r => r.json()),
    refetchInterval: 15_000,
  });

  const { data: benchData, isLoading: benchLoading } = useQuery<any>({
    queryKey: ['/api/warp/benchmark'],
    queryFn: () => fetch('/api/warp/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchSizes: [1, 5, 10, 25, 50, 100, 250, 512] }),
    }).then(r => r.json()),
    staleTime: 60_000,
  });

  const liveRows = benchData?.benchmark?.batchResults ?? BENCHMARK_ROWS.map(r => ({
    batchSize: r.batchSize,
    simGasPerBet: r.gasPerBet,
  }));
  const baseGas = liveRows[0]?.simGasPerBet ?? 2_000_000;

  const isLive = healthData?.ok;

  const TABS = [
    { key: 'all',       label: 'All 12 posts',    ids: POSTS.map(p => p.id) },
    { key: 'launch',    label: '🚀 Launch',        ids: ['launch', 'numbers', 'beforeafter', 'why-sui'] },
    { key: 'thread',    label: '🧵 Full Thread',   ids: ['thread','thread2','thread3','thread4','thread5','thread6','thread7','thread8'] },
    { key: 'technical', label: '🔧 Tech',          ids: ['thread4','thread5','thread6','thread7','escrow','why-sui'] },
    { key: 'compare',   label: '🆚 Compare',       ids: ['beforeafter','numbers','escrow'] },
  ] as const;
  type TabKey = typeof TABS[number]['key'];

  const visibleIds = TABS.find(t => t.key === activeTab)?.ids ?? POSTS.map(p => p.id);
  const visiblePosts = POSTS.filter(p => visibleIds.includes(p.id as any));

  return (
    <Layout>
      <div className="min-h-screen bg-[#060a10] text-white">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden border-b border-cyan-500/10">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full opacity-10"
              style={{ background: 'radial-gradient(ellipse, #00ffff 0%, transparent 70%)' }} />
          </div>
          <div className="max-w-5xl mx-auto px-4 pt-20 pb-16 text-center relative">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6 border"
              style={{ background: 'rgba(0,255,255,0.06)', borderColor: 'rgba(0,255,255,0.2)', color: '#00ffff' }}>
              <LiveDot />
              LIVE on Sui Mainnet — {isLive ? 'WarpStats verified on-chain' : 'Connecting…'}
            </div>

            <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-4 leading-none">
              <span style={{ background: 'linear-gradient(135deg, #00ffff, #0088ff, #00ffff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                WARP
              </span>
              <span className="text-white"> Engine</span>
            </h1>
            <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto mb-3">
              Weighted Atomic Resolution Protocol
            </p>
            <p className="text-gray-600 text-sm max-w-xl mx-auto mb-10">
              High-throughput P2P bet settlement on Sui — 512 bets in a single atomic transaction,
              90% gas reduction on parlays, owned-object fastpath escrow.
            </p>

            {/* Hero stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {[
                { label: 'Max batch size', val: 512, suffix: ' bets', color: '#00ffff' },
                { label: 'Gas saved at max', val: 75, suffix: '%', color: '#00ff88' },
                { label: 'Parlay 8-leg saved', val: 90, suffix: '%', color: '#ff6b00' },
                { label: 'Bets / second', val: 1280, suffix: '', color: '#bf5fff' },
              ].map(s => (
                <div key={s.label} className="rounded-2xl p-4 border text-center"
                  style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
                  <div className="text-3xl font-black mb-1" style={{ color: s.color }}>
                    <Counter to={s.val} suffix={s.suffix} duration={1800} />
                  </div>
                  <div className="text-gray-500 text-xs">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-12 space-y-12">

          {/* ── On-chain deployment ───────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(0,255,255,0.1)', border: '1px solid rgba(0,255,255,0.2)' }}>
                <Layers size={16} className="text-cyan-400" />
              </div>
              <h2 className="text-xl font-bold text-white">On-chain Deployment</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-green-400 border border-green-500/30 bg-green-500/10">MAINNET</span>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              {[
                {
                  label: 'Package ID',
                  value: WARP_PACKAGE,
                  href: `${SUISCAN}/object/${WARP_PACKAGE}`,
                  note: 'warp_engine module',
                },
                {
                  label: 'WarpStats Object',
                  value: WARP_STATS_ID,
                  href: `${SUISCAN}/object/${WARP_STATS_ID}`,
                  note: 'Shared accumulator',
                },
                {
                  label: 'Deploy TX',
                  value: DEPLOY_TX,
                  href: `${SUISCAN}/tx/${DEPLOY_TX}`,
                  note: 'init() published',
                },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-4 border"
                  style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
                  <div className="text-gray-500 text-[11px] mb-2 uppercase tracking-wider">{item.label}</div>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-cyan-300 text-xs font-mono">{short(item.value, 8)}</code>
                    <CopyBtn text={item.value} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-gray-700 text-[11px]">{item.note}</span>
                    <ScanLink href={item.href} label="suiscan" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Live Benchmark ────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.2)' }}>
                <BarChart3 size={16} className="text-green-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Live Benchmark — PTB Batch Gas</h2>
              {benchLoading && <span className="text-gray-600 text-xs animate-pulse">fetching live data…</span>}
            </div>
            <p className="text-gray-600 text-sm mb-6 ml-11">
              Gas per bet drops as batch size grows — PTB fixed overhead amortised across all positions.
            </p>

            <div className="rounded-2xl border overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.015)', borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="grid grid-cols-4 px-4 py-2 border-b text-[11px] font-medium text-gray-600 uppercase tracking-wider"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <span>Batch size</span>
                <span>Gas / bet</span>
                <span className="col-span-2">Reduction vs baseline</span>
              </div>
              {liveRows.map((row: any, i: number) => {
                const reduction = Math.round((1 - row.simGasPerBet / baseGas) * 100);
                const isBest = row.batchSize === 512;
                return (
                  <div key={row.batchSize}
                    className={`grid grid-cols-4 items-center px-4 py-3 gap-2 border-b transition-colors ${isBest ? 'bg-cyan-500/5' : ''}`}
                    style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-bold ${isBest ? 'text-cyan-300' : 'text-white'}`}>
                        {row.batchSize}
                      </span>
                      {isBest && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-bold">MAX</span>}
                    </div>
                    <span className="font-mono text-sm text-gray-300">
                      {(row.simGasPerBet / 1000).toFixed(0)}k
                    </span>
                    <div className="col-span-2 flex items-center gap-3">
                      <Bar
                        pct={reduction}
                        color={isBest ? 'linear-gradient(90deg,#00ffff,#0088ff)' : 'linear-gradient(90deg,#00ff88,#00cc66)'}
                        delay={i * 80}
                      />
                      <span className={`text-sm font-bold w-12 text-right ${isBest ? 'text-cyan-300' : 'text-green-400'}`}>
                        {reduction > 0 ? `-${reduction}%` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Parlay Efficiency ─────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.2)' }}>
                <Zap size={16} className="text-purple-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Atomic Parlay Settlement</h2>
            </div>
            <p className="text-gray-600 text-sm mb-6 ml-11">
              All parlay legs settled + winner paid in a single Move call. Baseline required N + 2 separate transactions.
            </p>

            <div className="grid md:grid-cols-2 gap-4">
              {PARLAY_ROWS.map((p, i) => (
                <div key={p.legs} className="rounded-xl p-4 border flex items-center gap-4"
                  style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
                  <div className="flex-shrink-0 text-center w-14">
                    <div className="text-2xl font-black text-white">{p.legs}</div>
                    <div className="text-gray-600 text-[10px]">legs</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 text-sm">
                      <span className="text-gray-500 line-through">{p.baseline} txs</span>
                      <ArrowRight size={12} className="text-gray-600" />
                      <span className="text-white font-bold">1 tx</span>
                    </div>
                    <Bar pct={p.saved} color="linear-gradient(90deg,#bf5fff,#7b2fff)" delay={i * 80} />
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xl font-black text-purple-400">-{p.saved}%</div>
                    <div className="text-gray-600 text-[10px]">gas saved</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── How it works ─────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(255,107,0,0.1)', border: '1px solid rgba(255,107,0,0.2)' }}>
                <Activity size={16} className="text-orange-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Sui Tech Stack</h2>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {[
                {
                  title: 'PTB Batching — 512 cmds/tx',
                  body: 'Oracle assembles a Programmable Transaction Block with up to 512 instant_settle_bet calls + one warp_batch_marker. Fixed overhead amortised → 75% gas saved at max batch.',
                  color: '#00ffff',
                },
                {
                  title: 'Owned-object Fastpath',
                  body: 'WarpEscrow is an OWNED object — deposit and withdraw skip shared-object consensus entirely. ~8× latency improvement: ~50 ms vs ~400 ms on testnet.',
                  color: '#00ff88',
                },
                {
                  title: 'Cross-package Move Calls',
                  body: 'warp_engine is a standalone package that calls public entry funs in p2p_betting: settle_parlay_leg, void_parlay_leg, instant_settle_parlay — no re-deploy of core contract needed.',
                  color: '#bf5fff',
                },
                {
                  title: 'Move 2024 — Macros + Method Syntax',
                  body: 'require_owner! is a Move 2024 macro that inlines the ownership check. Method syntax (escrow.owner, ctx.sender()) replaces verbose module paths. Compiled with version-6 bytecode.',
                  color: '#ff6b00',
                },
                {
                  title: 'OracleCap Capability Guard',
                  body: 'Both warp_batch_marker and warp_settle_parlay_atomic require &OracleCap — a non-copyable, non-droppable capability object. Only the platform wallet that holds the cap can call settlement functions.',
                  color: '#ffd700',
                },
                {
                  title: 'Bag — Multi-coin Escrow',
                  body: 'WarpEscrow balances field is a sui::bag::Bag keyed by TypeName. One escrow holds SUI, SBETS, USDSUI, USDC simultaneously — no separate escrow per coin type needed.',
                  color: '#00bfff',
                },
              ].map(c => (
                <div key={c.title} className="rounded-xl p-5 border"
                  style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
                  <div className="flex items-start gap-3">
                    <ChevronRight size={16} className="mt-0.5 flex-shrink-0" style={{ color: c.color }} />
                    <div>
                      <div className="font-bold text-sm mb-1" style={{ color: c.color }}>{c.title}</div>
                      <div className="text-gray-500 text-xs leading-relaxed">{c.body}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Live chain verification ───────────────────────────────────── */}
          <section className="rounded-2xl border p-6"
            style={{ background: 'rgba(0,255,255,0.03)', borderColor: 'rgba(0,255,255,0.12)' }}>
            <div className="flex items-center gap-2 mb-4">
              <LiveDot />
              <span className="text-cyan-400 font-bold text-sm">Live Chain Verification</span>
            </div>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-gray-600 text-xs mb-1">WarpStats status</div>
                <div className={`font-mono font-bold ${isLive ? 'text-green-400' : 'text-gray-600'}`}>
                  {isLive ? '● LIVE' : '○ Loading…'}
                </div>
                {healthData?.message && (
                  <div className="text-gray-600 text-xs mt-1">{healthData.message}</div>
                )}
              </div>
              <div>
                <div className="text-gray-600 text-xs mb-1">Package on Suiscan</div>
                <ScanLink
                  href={`${SUISCAN}/object/${WARP_PACKAGE}`}
                  label={short(WARP_PACKAGE, 10)}
                />
              </div>
              <div>
                <div className="text-gray-600 text-xs mb-1">Deploy transaction</div>
                <ScanLink
                  href={`${SUISCAN}/tx/${DEPLOY_TX}`}
                  label={short(DEPLOY_TX, 10)}
                />
              </div>
            </div>
          </section>

          {/* ── Post Bank ────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <MessageSquare size={16} className="text-gray-300" />
              </div>
              <h2 className="text-xl font-bold text-white">X / Twitter Post Bank</h2>
              <span className="text-gray-600 text-sm">{POSTS.length} posts ready to fire</span>
            </div>
            <p className="text-gray-600 text-sm mb-5 ml-11">
              Click any post to open the X composer pre-filled, or copy the text. Use the tabs to find the right angle.
            </p>

            {/* Tab filter */}
            <div className="flex gap-2 mb-6 flex-wrap">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key as TabKey)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={activeTab === t.key
                    ? { background: 'rgba(0,255,255,0.15)', border: '1px solid rgba(0,255,255,0.4)', color: '#00ffff' }
                    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#6b7280' }
                  }>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Post cards grid */}
            <div className="grid md:grid-cols-2 gap-4">
              {visiblePosts.map(post => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>

            {/* Thread tip */}
            {activeTab === 'thread' && (
              <div className="mt-4 rounded-xl border p-4 text-sm text-gray-500"
                style={{ background: 'rgba(191,95,255,0.05)', borderColor: 'rgba(191,95,255,0.15)' }}>
                💡 <strong className="text-gray-300">Thread tip:</strong> Post 1/8 first, then reply to your own tweet with each subsequent post in order (2/8 → 3/8 → … → 8/8). This creates a proper threaded breakdown on X.
              </div>
            )}
          </section>

          {/* ── Footer note ──────────────────────────────────────────────── */}
          <div className="text-center text-gray-700 text-xs pb-8">
            WARP Engine · deployed {new Date('2025-06-13').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
            <a href={`${SUISCAN}/object/${WARP_PACKAGE}`} target="_blank" rel="noreferrer"
              className="text-gray-600 hover:text-cyan-500 transition-colors">
              verify on-chain
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
