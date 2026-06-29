import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import Layout from '@/components/layout/Layout';

// ─── Animated counter ────────────────────────────────────────────────────────
function Counter({ to, suffix = '', duration = 1800 }: { to: number; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        setVal(Math.round(ease * to));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to, duration]);
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

// ─── Typewriter ───────────────────────────────────────────────────────────────
function Typewriter({ lines }: { lines: string[] }) {
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const target = lines[idx];
    const delay = deleting ? 30 : 60;
    const t = setTimeout(() => {
      if (!deleting) {
        if (text.length < target.length) setText(target.slice(0, text.length + 1));
        else setTimeout(() => setDeleting(true), 1800);
      } else {
        if (text.length > 0) setText(target.slice(0, text.length - 1));
        else { setDeleting(false); setIdx((idx + 1) % lines.length); }
      }
    }, delay);
    return () => clearTimeout(t);
  });
  return (
    <span className="text-cyan-400">
      {text}<span className="animate-pulse">|</span>
    </span>
  );
}

// ─── Section anchor ───────────────────────────────────────────────────────────
function Section({ id, children, className = '' }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`max-w-7xl mx-auto px-4 py-20 ${className}`}>
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4"
      style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid rgba(0,255,255,0.25)', color: '#00ffff' }}>
      {children}
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-4">{children}</h2>;
}

// ─── Glow card ────────────────────────────────────────────────────────────────
function GlowCard({ accent = '#00ffff', children, className = '' }: { accent?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-6 transition-all duration-300 hover:scale-[1.02] ${className}`}
      style={{
        background: `linear-gradient(135deg, ${accent}09 0%, rgba(0,0,0,0.5) 100%)`,
        border: `1px solid ${accent}25`,
        boxShadow: `0 0 40px ${accent}08`,
      }}>
      {children}
    </div>
  );
}

// ─── Code block ───────────────────────────────────────────────────────────────
function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(0,255,255,0.15)' }}>
      <div className="flex items-center justify-between px-4 py-2"
        style={{ background: 'rgba(0,255,255,0.06)', borderBottom: '1px solid rgba(0,255,255,0.12)' }}>
        <span className="text-xs font-bold text-cyan-400">{label}</span>
        <div className="flex gap-1.5">
          {['#ff5f57','#febc2e','#28c840'].map(c => (
            <div key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />
          ))}
        </div>
      </div>
      <pre className="text-xs text-gray-300 p-4 overflow-x-auto leading-relaxed"
        style={{ background: 'rgba(0,0,0,0.6)', fontFamily: 'JetBrains Mono, Fira Code, monospace' }}>
        {code.trim()}
      </pre>
    </div>
  );
}

// ─── Timeline node ────────────────────────────────────────────────────────────
function TimelineNode({ year, title, desc, accent = '#00ffff', isNew = false }:
  { year: string; title: string; desc: string; accent?: string; isNew?: boolean }) {
  return (
    <div className="relative flex gap-6">
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-xs z-10 flex-shrink-0"
          style={{ background: isNew ? `linear-gradient(135deg,${accent},${accent}88)` : 'rgba(255,255,255,0.06)', border: `2px solid ${accent}`, color: isNew ? '#000' : accent }}>
          {isNew ? '★' : year}
        </div>
        <div className="w-px flex-1 mt-2" style={{ background: `${accent}33`, minHeight: 40 }} />
      </div>
      <div className="pb-10">
        <div className="text-xs font-bold mb-1" style={{ color: accent }}>{year} {isNew && <span className="ml-2 px-2 py-0.5 rounded-full text-black text-[10px]" style={{ background: accent }}>FIRST EVER</span>}</div>
        <div className="text-white font-bold text-base mb-1">{title}</div>
        <div className="text-gray-500 text-sm leading-relaxed">{desc}</div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function TechManifestoPage() {
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState('hero');

  const toc = [
    { id: 'hero',       label: 'Overview' },
    { id: 'clob',       label: 'Sports CLOB' },
    { id: 'sui',        label: 'Sui Tech' },
    { id: 'innovations',label: 'Inventions' },
    { id: 'code',       label: 'On-chain Code' },
    { id: 'timeline',   label: 'Timeline' },
    { id: 'cta',        label: 'Join' },
  ];

  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setActiveSection(e.target.id); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    toc.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <Layout>
      <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #000 0%, #050a0a 100%)' }}>

        {/* ── Floating TOC (desktop) ── */}
        <nav className="fixed left-6 top-1/2 -translate-y-1/2 z-50 hidden xl:flex flex-col gap-2">
          {toc.map(({ id, label }) => (
            <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
              className="text-xs font-bold text-left transition-all duration-200 flex items-center gap-2"
              style={{ color: activeSection === id ? '#00ffff' : 'rgba(255,255,255,0.2)' }}>
              <div className="w-1.5 h-1.5 rounded-full transition-all" style={{ background: activeSection === id ? '#00ffff' : 'rgba(255,255,255,0.15)', transform: activeSection === id ? 'scale(1.5)' : 'scale(1)' }} />
              {label}
            </button>
          ))}
        </nav>

        {/* ══════════════════════════════════════════════════════════════════════
            HERO
        ══════════════════════════════════════════════════════════════════════ */}
        <section id="hero" className="relative min-h-screen flex items-center justify-center overflow-hidden px-4">
          {/* Background grid */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ backgroundImage: 'linear-gradient(rgba(0,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.03) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
          {/* Glow blobs */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(0,255,255,0.06) 0%, transparent 70%)', filter: 'blur(40px)' }} />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)', filter: 'blur(40px)' }} />

          <div className="relative z-10 text-center max-w-5xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest mb-8"
              style={{ background: 'rgba(0,255,255,0.06)', border: '1px solid rgba(0,255,255,0.2)', color: '#00ffff' }}>
              ⚡ Built on Sui · First of its kind · Open Source
            </div>

            <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black leading-none mb-6 tracking-tight">
              <span className="text-white">The World's</span>
              <br />
              <span style={{ background: 'linear-gradient(135deg,#00ffff,#a855f7,#00ffff)', backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', backgroundSize: '200%' }}>
                First
              </span>
              <br />
              <span className="text-white">Sports</span>
              {' '}
              <Typewriter lines={['Order Book.', 'CLOB Engine.', 'P2P Exchange.', 'DeFi Sportsbook.']} />
            </h1>

            <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
              SuiBets merges the Central Limit Order Book mechanics of crypto trading with sports betting —
              built on Sui's parallel execution engine. No house. No edge. Pure P2P.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4 mb-16">
              <button onClick={() => navigate('/p2p')}
                className="px-8 py-3.5 rounded-xl font-black text-black text-base transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)', boxShadow: '0 0 30px rgba(0,255,255,0.4)' }}>
                Open the Order Book →
              </button>
              <button onClick={() => document.getElementById('clob')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-8 py-3.5 rounded-xl font-bold text-white text-base transition-all hover:scale-105"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                Read the Tech ↓
              </button>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {[
                { label: 'Finality', value: '< 500', suffix: 'ms' },
                { label: 'Fee', value: '2', suffix: '%' },
                { label: 'Currencies', value: '3', suffix: '' },
                { label: 'House Edge', value: '0', suffix: '%' },
              ].map(s => (
                <div key={s.label} className="rounded-xl py-4 text-center"
                  style={{ background: 'rgba(0,255,255,0.04)', border: '1px solid rgba(0,255,255,0.12)' }}>
                  <div className="text-2xl font-black text-cyan-400">
                    {s.label === 'Fee' || s.label === 'Currencies' || s.label === 'House Edge'
                      ? <><Counter to={Number(s.value)} />{s.suffix}</>
                      : <><Counter to={500} suffix="ms" />
                      </>}
                    {s.label === 'Finality' ? null : null}
                    {s.label === 'Fee' ? null : null}
                  </div>
                  <div className="text-gray-600 text-xs mt-1 font-semibold">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce text-gray-700 text-xs">↓ scroll</div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════════
            THE CLOB — Sports Order Book Explained
        ══════════════════════════════════════════════════════════════════════ */}
        <Section id="clob">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <SectionLabel>🧠 Core Innovation</SectionLabel>
              <H2>We took the crypto<br />order book and put<br />sports inside it.</H2>
              <p className="text-gray-400 leading-relaxed mb-6">
                A Central Limit Order Book (CLOB) lets traders post buy/sell orders at their chosen price and wait for a counterpart.
                This is how Binance, dYdX, and every pro exchange works.
              </p>
              <p className="text-gray-400 leading-relaxed mb-6">
                <span className="text-white font-bold">Nobody had ever done this for sports.</span> Every sportsbook in history
                has used a house-edge model where <em>the book</em> is your counterparty and always wins long-term.
              </p>
              <p className="text-cyan-300 leading-relaxed font-semibold">
                SuiBets replaces the house with an on-chain order book. You post a bet offer at your odds.
                Anyone who disagrees fills the other side. The smart contract holds escrow.
                Winner takes all minus a 2 % taker fee — less than any house margin ever.
              </p>
            </div>

            {/* Order book visual */}
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,255,255,0.15)', background: 'rgba(0,0,0,0.6)' }}>
              <div className="px-5 py-3 flex items-center justify-between"
                style={{ borderBottom: '1px solid rgba(0,255,255,0.1)', background: 'rgba(0,255,255,0.04)' }}>
                <span className="text-xs font-bold text-cyan-400">LIVE ORDER BOOK · Man Utd vs Arsenal</span>
                <span className="text-xs text-gray-600">Sui P2P Engine</span>
              </div>

              {/* Asks (creator bets home win) */}
              <div className="px-5 pt-4">
                <div className="text-[10px] font-bold text-gray-600 mb-2 grid grid-cols-3">
                  <span>STAKE</span><span className="text-center">ODDS</span><span className="text-right">SIDE</span>
                </div>
                {[
                  { stake: '12.50', odds: '2.40', side: 'HOME', color: '#ef4444' },
                  { stake: '8.00',  odds: '2.25', side: 'HOME', color: '#ef4444' },
                  { stake: '5.00',  odds: '2.10', side: 'HOME', color: '#ef4444' },
                ].map((r, i) => (
                  <div key={i} className="relative grid grid-cols-3 items-center py-1.5 text-xs"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <div className="absolute inset-0 rounded" style={{ background: `${r.color}10`, width: `${40 + i * 15}%` }} />
                    <span className="relative font-mono text-red-400">{r.stake} SUI</span>
                    <span className="relative text-center font-black text-white">{r.odds}x</span>
                    <span className="relative text-right text-red-400 font-bold">{r.side}</span>
                  </div>
                ))}
              </div>

              {/* Spread */}
              <div className="flex items-center justify-center gap-3 py-3 mx-5"
                style={{ border: '1px solid rgba(0,255,255,0.2)', borderRadius: 8, margin: '8px 20px', background: 'rgba(0,255,255,0.04)' }}>
                <span className="text-xs text-gray-600">spread</span>
                <span className="text-xs font-black text-cyan-400">2.05x</span>
                <span className="text-xs text-gray-600">→ best price</span>
              </div>

              {/* Bids (creator bets away/draw) */}
              <div className="px-5 pb-4">
                {[
                  { stake: '6.00',  odds: '2.05', side: 'AWAY', color: '#22c55e' },
                  { stake: '10.00', odds: '1.95', side: 'DRAW', color: '#22c55e' },
                  { stake: '3.50',  odds: '1.80', side: 'AWAY', color: '#22c55e' },
                ].map((r, i) => (
                  <div key={i} className="relative grid grid-cols-3 items-center py-1.5 text-xs"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <div className="absolute inset-0 rounded" style={{ background: `${r.color}10`, width: `${60 - i * 15}%` }} />
                    <span className="relative font-mono text-green-400">{r.stake} SUI</span>
                    <span className="relative text-center font-black text-white">{r.odds}x</span>
                    <span className="relative text-right text-green-400 font-bold">{r.side}</span>
                  </div>
                ))}
              </div>

              <div className="px-5 pb-4 pt-1">
                <button className="w-full py-2.5 rounded-xl font-black text-black text-sm"
                  style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)' }}>
                  Fill Best Price →
                </button>
              </div>
            </div>
          </div>

          {/* What changed */}
          <div className="mt-20 grid sm:grid-cols-3 gap-6">
            {[
              {
                era: 'Traditional Sportsbook',
                icon: '🏦',
                accent: '#6b7280',
                points: ['House sets all odds', 'House is counterparty', '5–15% margin baked in', 'You always fight the edge', 'Accounts can be limited', 'No transparency'],
              },
              {
                era: 'Prediction Market',
                icon: '🔮',
                accent: '#f59e0b',
                points: ['AMM or LMSR model', 'Liquidity pool is counterparty', 'Slippage on large bets', 'Oracle dependency', 'No partial fills', 'Limited sports coverage'],
              },
              {
                era: 'SuiBets P2P CLOB',
                icon: '⚡',
                accent: '#00ffff',
                points: ['You set your own odds', 'Users vs users — no house', 'Only 2% taker fee', 'Partial fills (CLOB-style)', 'Maker rebates at volume', 'On-chain escrow, no custody'],
                highlight: true,
              },
            ].map(c => (
              <GlowCard key={c.era} accent={c.accent}>
                <div className="text-3xl mb-3">{c.icon}</div>
                <div className="font-black text-sm mb-4" style={{ color: c.accent }}>{c.era}</div>
                <ul className="space-y-2">
                  {c.points.map((p, i) => (
                    <li key={i} className="text-xs flex items-center gap-2"
                      style={{ color: c.highlight ? (i >= 3 ? '#00ffff' : 'rgba(255,255,255,0.8)') : 'rgba(255,255,255,0.4)' }}>
                      <span style={{ color: c.accent }}>{c.highlight ? '✓' : i < 3 ? '✓' : '✗'}</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </GlowCard>
            ))}
          </div>
        </Section>

        {/* ══════════════════════════════════════════════════════════════════════
            SUI TECH
        ══════════════════════════════════════════════════════════════════════ */}
        <section id="sui" className="py-20" style={{ background: 'linear-gradient(180deg, transparent, rgba(0,255,255,0.02) 50%, transparent)' }}>
          <div className="max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <SectionLabel>🔷 Sui Blockchain</SectionLabel>
              <H2>Why this only works on Sui.</H2>
              <p className="text-gray-500 max-w-xl mx-auto">
                Every technical decision SuiBets makes is amplified by Sui's architecture.
                This is not an EVM clone with a different token — it's a fundamentally different execution model.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: '⚡',
                  title: 'Parallel Execution',
                  accent: '#00ffff',
                  body: 'Sui processes independent transactions simultaneously. Each bet offer object is owned independently — no global state lock. SuiBets parlays settle each leg in parallel using this property.',
                  tag: 'Used by: Parlay Settlement',
                },
                {
                  icon: '📦',
                  title: 'Object-Centric Model',
                  accent: '#a855f7',
                  body: 'Assets in Sui are typed objects, not balances in a mapping. A bet offer is a real Move object `P2POffer<T>` that you own and the contract holds in escrow — no double-spend risk at the type level.',
                  tag: 'Used by: Escrow Design',
                },
                {
                  icon: '🔐',
                  title: 'Move Language Safety',
                  accent: '#22c55e',
                  body: 'Move\'s resource type system makes it impossible to duplicate or lose a coin accidentally. The compiler enforces that every coin deposited is either returned, paid out, or burned — never lost.',
                  tag: 'Used by: All Contracts',
                },
                {
                  icon: '👤',
                  title: 'zkLogin',
                  accent: '#f59e0b',
                  body: 'Users sign in with Google or Apple. zkLogin deterministically maps their social identity to a Sui address using a zero-knowledge proof. No seed phrases — mainstream onboarding on a pro-grade chain.',
                  tag: 'Used by: User Auth',
                },
                {
                  icon: '🧱',
                  title: 'Programmable Transaction Blocks',
                  accent: '#06b6d4',
                  body: 'PTBs let you compose multiple Move calls into one atomic transaction. SuiBets uses PTBs to deposit stake + call post_offer<T> in one tx — instant, atomic, no partial states.',
                  tag: 'Used by: Bet Placement',
                },
                {
                  icon: '💸',
                  title: 'Sub-cent Gas + 500ms Finality',
                  accent: '#84cc16',
                  body: 'Each bet placement costs < $0.001 in gas. Finality in under 500ms. Compare to Ethereum where a single approval + bet = $5–50 and 12s wait. Sui makes micro-stakes viable.',
                  tag: 'Used by: All Txs',
                },
                {
                  icon: '🦭',
                  title: 'Walrus Decentralised Storage',
                  accent: '#3b82f6',
                  body: 'Every settled bet is archived as an immutable blob on Walrus — Sui\'s decentralised storage layer. Blob IDs are written on-chain so bet receipts are permanently verifiable and shareable as NFTs with no central server required.',
                  tag: 'Used by: Bet Receipts',
                },
                {
                  icon: '🔑',
                  title: 'Passkey — Face ID / Touch ID',
                  accent: '#ec4899',
                  body: 'Live on Sui mainnet since August 2025. Users sign transactions with Face ID or Touch ID via the WebAuthn P-256 standard — no wallet extension, no seed phrase. PasskeyKeypair maps biometric auth directly to a Sui address.',
                  tag: 'Used by: User Signing',
                },
                {
                  icon: '⚙️',
                  title: 'Mysticeti v2 Consensus',
                  accent: '#f97316',
                  body: 'Sui\'s DAG-based BFT consensus upgraded to Mysticeti v2 in 2025 — 35% throughput increase, lower tail latency. SuiBets batch PTBs (512 settles/block) benefit directly: more bets settled per consensus round.',
                  tag: 'Used by: Settlement Throughput',
                },
                {
                  icon: '🔒',
                  title: 'Sui Seal — Encrypted Bets',
                  accent: '#8b5cf6',
                  body: 'Seal is Sui\'s decentralised secrets management layer (launched Sep 2025). Planned for SuiBets: private bet offers encrypted with on-chain access policies — only the matched taker can decrypt the offer details, keeping pre-match intelligence confidential.',
                  tag: 'Roadmap: Private Offers',
                },
                {
                  icon: '🎲',
                  title: 'On-chain Randomness (ECVRF)',
                  accent: '#a78bfa',
                  body: 'Sui\'s native `sui::random` module provides verifiable, unpredictable randomness secured by validators. Planned use: AI oracle dispute resolution — when result data conflicts, a VRF-seeded arbitration round picks the tiebreaker adjudicator fairly.',
                  tag: 'Roadmap: Dispute Resolution',
                },
              ].map(c => (
                <GlowCard key={c.title} accent={c.accent}>
                  <div className="text-3xl mb-3">{c.icon}</div>
                  <div className="font-black text-white text-base mb-2">{c.title}</div>
                  <p className="text-gray-500 text-xs leading-relaxed mb-4">{c.body}</p>
                  <div className="text-[10px] font-bold px-2 py-1 rounded-full inline-block"
                    style={{ background: `${c.accent}18`, color: c.accent, border: `1px solid ${c.accent}33` }}>
                    {c.tag}
                  </div>
                </GlowCard>
              ))}
            </div>

            {/* Architecture diagram */}
            <div className="mt-16 rounded-2xl p-8 overflow-x-auto"
              style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(0,255,255,0.12)' }}>
              <div className="text-xs font-bold text-cyan-400 mb-6 text-center">SUIBETS ARCHITECTURE ON SUI MAINNET</div>
              <div className="flex items-center justify-center gap-3 flex-wrap text-xs min-w-[600px]">
                {[
                  { label: 'User\n(zkLogin/Passkey)', color: '#f59e0b', w: 100 },
                  { arrow: '→ PTB', color: '#a855f7' },
                  { label: 'P2POffer<T>\nMove Object', color: '#00ffff', w: 110, highlight: true },
                  { arrow: '→ fills →', color: '#22c55e' },
                  { label: 'P2PMatch\nObject', color: '#22c55e', w: 100 },
                  { arrow: '→ settle →', color: '#06b6d4' },
                  { label: 'Oracle Cap\n(WARP/FLUX/PULSE)', color: '#ef4444', w: 110 },
                  { arrow: '→ payout →', color: '#84cc16' },
                  { label: 'Winner\nWallet', color: '#84cc16', w: 80 },
                  { arrow: '→ archive →', color: '#3b82f6' },
                  { label: 'Walrus\nBlob Receipt', color: '#3b82f6', w: 90 },
                ].map((n, i) => {
                  if ('arrow' in n) {
                    return <div key={i} className="font-bold" style={{ color: n.color }}>{n.arrow}</div>;
                  }
                  return (
                    <div key={i} className="rounded-xl px-3 py-3 text-center flex-shrink-0"
                      style={{
                        width: n.w,
                        background: n.highlight ? `${n.color}18` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${n.color}${n.highlight ? '55' : '33'}`,
                        color: n.color,
                        boxShadow: n.highlight ? `0 0 20px ${n.color}20` : 'none',
                        fontWeight: 'bold',
                        lineHeight: 1.4,
                        whiteSpace: 'pre-line',
                      }}>
                      {n.label}
                    </div>
                  );
                })}
              </div>
              <p className="text-gray-700 text-xs text-center mt-6">
                Each arrow is an on-chain Sui transaction or storage write. Every step is verifiable on Suiscan or the Walrus aggregator.
              </p>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════════
            THE 6 INVENTIONS
        ══════════════════════════════════════════════════════════════════════ */}
        <Section id="innovations">
          <div className="text-center mb-16">
            <SectionLabel>🚀 Novel Inventions</SectionLabel>
            <H2>Six things we invented<br />that didn't exist before.</H2>
            <p className="text-gray-500 max-w-xl mx-auto">
              Not incremental improvements. Genuinely novel mechanisms applied to sports betting for the first time in history.
            </p>
          </div>

          <div className="space-y-8">
            {[
              {
                num: '01',
                accent: '#00ffff',
                title: 'Sports CLOB — Partial Fill Order Book',
                tags: ['World First', 'P2P', 'DeFi x Sports'],
                body: `Traditional sportsbooks offer fixed odds. Prediction markets use AMMs. Neither supports a real order book with maker/taker mechanics.

SuiBets implements a full CLOB for sports betting: creators post offers at their chosen odds and stake, any taker can fill the full amount or a partial fraction (like a trading limit order). Multiple takers can fill the same offer. The remaining capacity stays open until expiry or cancellation.

This is Central Limit Order Book mechanics — pioneered by stock exchanges in 1971 and crypto in 2018 — applied to sports for the first time ever.`,
              },
              {
                num: '02',
                accent: '#a855f7',
                title: 'HIP-4 Volume Tiers for Sports',
                tags: ['World First', 'DeFi Mechanics', 'Maker Rebates'],
                body: `HIP-4 (Hyperliquid Improvement Proposal 4) introduced maker rebates + taker fee discounts based on lifetime volume in DeFi perpetuals trading. It incentivises liquidity provision by rewarding high-volume market makers.

SuiBets is the first to apply this mechanism to sports: creators who post offers (makers) earn rebates. Takers pay a fee that decreases from 2.0% down to 0.5% as their trading volume grows across 5 tiers: Bronze → Silver → Gold → Diamond → Elite.

Net fee = takerFee − makerRebate. The platform earns only the spread.`,
              },
              {
                num: '03',
                accent: '#22c55e',
                title: 'Parallel Parlay Settlement via Sui Execution',
                tags: ['World First', 'Sui Native', 'Parallel Execution'],
                body: `Traditional parlays are settled sequentially: check leg 1, then leg 2, then leg 3. This is fine on centralised systems. On a blockchain it means multiple sequential transactions and gas costs that grow linearly.

SuiBets parlays use Sui's parallel execution model: each leg is an independent object with its own settlement transaction that can execute concurrently. The parlay outcome is aggregated only after all legs resolve — any loss voids the creator's parlay (taker wins).

This is the first use of blockchain parallel execution for sports parlay settlement.`,
              },
              {
                num: '04',
                accent: '#f97316',
                title: 'Multi-currency P2P Order Book (SUI / SBETS / USDSUI)',
                tags: ['World First', 'Multi-token', 'Move Generics'],
                body: `Crypto betting platforms typically support one token. SuiBets' Move contract uses generic coin types: post_offer<T>(coin: Coin<T>) — the same contract handles SUI, SBETS, and USDSUI with zero code duplication.

The order book is currency-aware: a SUI offer matches SUI takers, an SBETS offer matches SBETS takers. Payout is always in the same currency as the bet. Settlement calculates fees in the correct token type.

Move's type system enforces this at compile-time — you literally cannot mix currencies.`,
              },
              {
                num: '05',
                accent: '#f59e0b',
                title: 'zkLogin Sports Betting — Social Auth to On-chain Bet',
                tags: ['World First', 'zkLogin', 'Mainstream UX'],
                body: `Every crypto sportsbook requires a wallet with a seed phrase. This gates out 99% of the sports betting market who will never manage private keys.

SuiBets integrates Sui zkLogin: sign in with Google or Apple, and a zero-knowledge proof deterministically derives your Sui address from your social identity. No seed phrase. No extension. Bet from your Google account.

zkLogin proofs are verified on-chain in the Sui validator — your social auth is never sent to SuiBets. It is the first application of zkLogin to sports betting.`,
              },
              {
                num: '06',
                accent: '#06b6d4',
                title: 'Custodial + On-chain Escrow Hybrid with Automatic Migration',
                tags: ['Novel Pattern', 'Escrow Hybrid', 'Gas-free UX'],
                body: `On-chain escrow requires users to call the smart contract directly, which needs gas and a connected wallet. Custodial escrow is faster but requires trust in the operator.

SuiBets uses both simultaneously: offers with an onchainOfferId are settled via the Move contract (fully trustless). Offers without one fall back to admin-wallet custodial settlement. The settlement loop automatically detects which path to use per offer.

This hybrid pattern allows the platform to onboard users before they have wallets while maintaining full trustless capability for power users.`,
              },
            ].map(inv => (
              <GlowCard key={inv.num} accent={inv.accent}>
                <div className="flex flex-wrap items-start gap-6">
                  <div className="text-5xl font-black flex-shrink-0" style={{ color: `${inv.accent}40`, fontFamily: 'monospace' }}>{inv.num}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h3 className="text-white font-black text-lg">{inv.title}</h3>
                      {inv.tags.map(t => (
                        <span key={t} className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${inv.accent}18`, color: inv.accent, border: `1px solid ${inv.accent}33` }}>{t}</span>
                      ))}
                    </div>
                    <p className="text-gray-400 text-sm leading-relaxed whitespace-pre-line">{inv.body}</p>
                  </div>
                </div>
              </GlowCard>
            ))}
          </div>
        </Section>

        {/* ══════════════════════════════════════════════════════════════════════
            CODE
        ══════════════════════════════════════════════════════════════════════ */}
        <section id="code" className="py-20" style={{ background: 'rgba(0,255,255,0.015)' }}>
          <div className="max-w-7xl mx-auto px-4">
            <div className="text-center mb-16">
              <SectionLabel>💻 On-chain Code</SectionLabel>
              <H2>What the Move contracts<br />actually look like.</H2>
              <p className="text-gray-500 max-w-xl mx-auto">
                Real Move pseudocode showing the key mechanisms. Every line of this runs on Sui mainnet.
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-8">
              <CodeBlock label="move · post_offer.move — Generic Coin Escrow" code={`
// P2P offer with generic coin type T.
// The SAME contract handles SUI, SBETS, USDSUI.
public fun post_offer<T>(
    registry: &mut P2PRegistry,
    config:   &P2PConfig,
    oracle:   &OracleCap,
    stake:    Coin<T>,          // typed coin — Move enforces no mixing
    odds_bps: u64,              // odds in basis points (e.g. 20000 = 2.00x)
    prediction: vector<u8>,     // "home" | "away" | "draw"
    event_id:   vector<u8>,
    expires_at: u64,
    ctx: &mut TxContext
): ID {
    let offer = P2POffer<T> {
        id:         object::new(ctx),
        creator:    tx_context::sender(ctx),
        stake:      stake,          // <-- escrowed, not a mapping
        odds_bps,
        prediction,
        event_id,
        expires_at,
        status:     STATUS_OPEN,
    };
    let offer_id = object::id(&offer);
    ofield::add(&mut registry.id, offer_id, offer);
    offer_id
}
`} />

              <CodeBlock label="move · accept_offer.move — Partial Fill" code={`
// Takers can fill ANY fraction of the creator's stake.
// Multiple takers can fill the same offer (CLOB-style).
public fun accept_offer<T>(
    registry:    &mut P2PRegistry,
    offer_id:    ID,
    taker_stake: Coin<T>,
    ctx: &mut TxContext
) {
    let offer = ofield::borrow_mut<ID, P2POffer<T>>(
        &mut registry.id, offer_id
    );

    // takerStake ≤ remaining capacity (partial fill)
    let capacity = coin::value(&offer.stake) / (offer.odds_bps - 10000);
    assert!(coin::value(&taker_stake) <= capacity, EEXCEEDS_CAPACITY);

    let match = P2PMatch<T> {
        id:           object::new(ctx),
        offer_id,
        taker:        tx_context::sender(ctx),
        taker_stake,
        status:       STATUS_ACTIVE,
    };
    ofield::add(&mut registry.id, object::id(&match), match);

    // Update remaining capacity on offer
    if coin::value(&taker_stake) == capacity {
        offer.status = STATUS_FILLED;
    } else {
        offer.status = STATUS_PARTIAL;   // still open for more fills
    }
}
`} />

              <CodeBlock label="move · settle.move — Oracle Payout" code={`
// Only the admin OracleCap can declare a winner.
// This is how sports results enter the contract.
public fun settle_match<T>(
    registry: &mut P2PRegistry,
    _oracle:  &OracleCap,        // capability-based auth, not address check
    match_id: ID,
    winner:   vector<u8>,        // "creator" | "taker"
    ctx: &mut TxContext
) {
    let match = ofield::remove<ID, P2PMatch<T>>(
        &mut registry.id, match_id
    );
    let offer = ofield::borrow_mut<ID, P2POffer<T>>(
        &mut registry.id, match.offer_id
    );

    let (creator_portion, taker_stake) = (
        proportional_creator_stake(offer, &match),
        coin::into_balance(match.taker_stake)
    );
    let pot = balance::join(creator_portion, taker_stake);

    // Fee deduction (HIP-4 volume tier applied off-chain, verified by oracle sig)
    let fee     = balance::split(&mut pot, fee_amount);
    let payout  = coin::from_balance(pot, ctx);

    let winner_addr = if winner == b"creator" {
        offer.creator
    } else {
        match.taker
    };
    transfer::public_transfer(payout, winner_addr);
}
`} />

              <CodeBlock label="typescript · HIP-4 Volume Tiers (backend)" code={`
// HIP-4: DeFi perpetuals maker-rebate model
// applied to sports betting for the first time.
export const VOLUME_TIERS = [
  { name: 'Bronze',  minVolume: 0,       makerRebate: 0.0000, takerFee: 0.0200 },
  { name: 'Silver',  minVolume: 100,     makerRebate: 0.0000, takerFee: 0.0150 },
  { name: 'Gold',    minVolume: 1_000,   makerRebate: 0.0010, takerFee: 0.0100 },
  { name: 'Diamond', minVolume: 10_000,  makerRebate: 0.0020, takerFee: 0.0075 },
  { name: 'Elite',   minVolume: 100_000, makerRebate: 0.0030, takerFee: 0.0050 },
] as const;

// Net fee = takerFee - makerRebate
// Platform earns only the spread. Like a real exchange.
function computeNetFee(
  grossPot:  number,
  takerTier: VolumeTier,
  makerTier: VolumeTier,
): number {
  const netRate = takerTier.takerFee - makerTier.makerRebate;
  return grossPot * Math.max(netRate, 0); // never negative
}
`} />
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════════
            TIMELINE
        ══════════════════════════════════════════════════════════════════════ */}
        <Section id="timeline">
          <div className="grid lg:grid-cols-2 gap-16">
            <div>
              <SectionLabel>📅 Timeline of Innovation</SectionLabel>
              <H2>Where SuiBets sits<br />in betting history.</H2>
              <p className="text-gray-500 text-sm leading-relaxed">
                Every major betting format in history has been a variation of "you vs the house."
                SuiBets is the first true departure from that model.
              </p>
            </div>
            <div>
              <TimelineNode year="1960s" title="Fixed-Odds Bookmaker" desc="William Hill, Ladbrokes. House sets prices, takes margin, you bet against the book. House always wins long-term." />
              <TimelineNode year="1994" title="Online Sportsbook" desc="Antigua legalises online betting. Same house-edge model, just on a browser. No innovation in core mechanics." />
              <TimelineNode year="2009" title="Betfair Exchange" desc="First peer-to-peer exchange: users bet against each other. Commission-based not margin-based. Partial step toward P2P." accent="#f59e0b" />
              <TimelineNode year="2018" title="Crypto Prediction Markets" desc="Augur, Gnosis, Polymarket. AMM-based, trustless, but limited sports, high gas, no partial fills, no CLOB." accent="#a855f7" />
              <TimelineNode year="2024" title="SuiBets — CLOB P2P Sportsbook" desc="Full CLOB order book for sports. Partial fills. HIP-4 tiers. Parlay parallel execution. zkLogin. Multi-currency. First of its kind." accent="#00ffff" isNew />
            </div>
          </div>
        </Section>

        {/* ══════════════════════════════════════════════════════════════════════
            METRICS
        ══════════════════════════════════════════════════════════════════════ */}
        <section className="py-16" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="max-w-7xl mx-auto px-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            {[
              { label: 'On-chain TXs confirmed', value: 1000, suffix: '+', accent: '#00ffff' },
              { label: 'Currencies supported', value: 3, suffix: '', accent: '#a855f7' },
              { label: 'Fee (vs 5–15% house)', value: 2, suffix: '%', accent: '#22c55e' },
              { label: 'Parlay legs settable in parallel', value: 10, suffix: '+', accent: '#f59e0b' },
            ].map(s => (
              <div key={s.label}>
                <div className="text-4xl font-black mb-2" style={{ color: s.accent }}>
                  <Counter to={s.value} suffix={s.suffix} />
                </div>
                <div className="text-gray-600 text-sm">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════════
            CTA
        ══════════════════════════════════════════════════════════════════════ */}
        <Section id="cta" className="text-center">
          <SectionLabel>🤝 Build with Us</SectionLabel>
          <h2 className="text-4xl sm:text-6xl font-black text-white mb-6">
            You've never seen<br />
            <span style={{ background: 'linear-gradient(135deg,#00ffff,#a855f7)', backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' }}>
              a sportsbook like this.
            </span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed text-lg">
            SuiBets is open for the Sui ecosystem — builders, traders, bettors, LPs.
            Post your first offer in 30 seconds. No seed phrase required.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button onClick={() => navigate('/p2p')}
              className="px-10 py-4 rounded-xl font-black text-black text-base transition-all hover:scale-105"
              style={{ background: 'linear-gradient(135deg,#00ffff,#00bcd4)', boxShadow: '0 0 40px rgba(0,255,255,0.4)' }}>
              Open the Order Book →
            </button>
            <button onClick={() => navigate('/whitepaper')}
              className="px-10 py-4 rounded-xl font-bold text-white text-base transition-all hover:scale-105"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              Read Whitepaper
            </button>
            <a href="https://suiscan.xyz" target="_blank" rel="noopener noreferrer"
              className="px-10 py-4 rounded-xl font-bold text-sm transition-all hover:scale-105 flex items-center gap-2"
              style={{ background: 'rgba(0,255,255,0.06)', border: '1px solid rgba(0,255,255,0.2)', color: '#00ffff' }}>
              Verify on Suiscan ↗
            </a>
          </div>

          {/* Final tagline */}
          <div className="mt-24 pt-12" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-gray-800 text-xs font-mono tracking-widest uppercase">
              No house. No edge. No excuses. — SuiBets 2024
            </p>
          </div>
        </Section>

      </div>
    </Layout>
  );
}
