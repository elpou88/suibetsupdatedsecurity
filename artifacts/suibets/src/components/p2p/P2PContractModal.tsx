import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, ExternalLink, Copy, Shield, Zap, Lock,
  CheckCircle, AlertTriangle, ChevronDown, ChevronUp,
  TrendingUp, Activity, BarChart3, Coins,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type ContractInfo = {
  configured: boolean;
  packageId?: string;
  registryId?: string;
  configId?: string;
  adminCapId?: string;
  oracleCapId?: string;
  upgradeCapId?: string;
  network?: string;
  version?: string;
  features?: string[];
  supportedCoins?: Array<{ symbol: string; default?: boolean; coinType?: string }>;
  disputeWindowMs?: number;
  suiscanUrls?: Record<string, string>;
  hipFourTiers?: Array<{
    name: string;
    minVolumeSUI: number;
    takerFeeBps: number;
    makerRebateBps: number;
    netFeeBps: number;
  }>;
};

type P2PRevenueStats = {
  totalSettledBets: number;
  totalPlatformFeeSui: number;
  totalVolumeSui: number;
  openOffersCount: number;
  openParlaysCount: number;
  contractEnabled: boolean;
  network: string;
};

// ─── Copy-to-clipboard helper ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={handleCopy} title="Copy" className="text-gray-600 hover:text-cyan-400 transition-colors flex-shrink-0">
      {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

// ─── Object ID row ────────────────────────────────────────────────────────────

function ObjectRow({ label, id, url, dim }: { label: string; id?: string; url?: string; dim?: boolean }) {
  if (!id) return null;
  const short = `${id.slice(0, 10)}…${id.slice(-6)}`;
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${dim ? 'bg-[#0a0e1a] border-[#1e2a3a]' : 'bg-[#111827] border-[#1e2a3a] hover:border-[#2a3a4a]'}`}>
      <span className="text-gray-400 text-xs w-24 flex-shrink-0 font-medium">{label}</span>
      <span className="text-gray-300 text-xs font-mono flex-1 mx-3 truncate">{short}</span>
      <div className="flex items-center gap-2">
        <CopyButton text={id} />
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" title="View on SuiScan"
            className="text-cyan-400 hover:text-cyan-300 transition-colors flex-shrink-0">
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHead({ icon: Icon, label, color = 'text-cyan-400' }: { icon: any; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={13} className={color} />
      <span className={`text-xs font-bold uppercase tracking-wider ${color}`}>{label}</span>
    </div>
  );
}

// ─── Feature list ─────────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  'generic-coin-type':         'Generic Coin Type (SUI + USDC)',
  'partial-fills':             'Partial Fills — CLOB-style order book',
  'on-chain-order-book':       'On-chain Order Book Registry',
  'dispute-window':            '2-Hour Challenge / Dispute Window',
  'hip4-maker-rebates':        'HIP-4 Maker Rebates (elite = net 0.2%)',
  'on-chain-settlement-proof': 'On-chain Settlement Proof',
  'on-chain-event-history':    'Full Event History On-chain',
  'multi-token-fee-vault':     'Multi-token Fee Vault (Bag)',
  'instant-settle':            'Instant Settlement by Oracle (no delay)',
  'instant-void':              'Instant Void / Refund by Oracle',
  'multisig-fee-withdrawal':   '2-of-2 Multi-sig Fee Withdrawal',
  'multi-sig-withdrawal':      '2-of-2 Multi-sig Fee Withdrawal',
  'upgrade-cap':               'UpgradeCap held post-deploy (upgrade-safe)',
};

// ─── Settlement flow steps (instant oracle path) ──────────────────────────────

const SETTLEMENT_STEPS = [
  {
    icon: '📥',
    title: 'Stakes locked in escrow',
    desc: 'Both sides deposit on-chain. Funds live inside the smart contract — no admin wallet holds them.',
    color: 'text-cyan-400',
    border: 'border-cyan-500/25',
    bg: 'bg-cyan-500/[0.04]',
  },
  {
    icon: '🏟️',
    title: 'Match plays out',
    desc: 'Sports oracle monitors the event and posts the result to settled_events on the server.',
    color: 'text-yellow-400',
    border: 'border-yellow-500/25',
    bg: 'bg-yellow-500/[0.04]',
  },
  {
    icon: '⚡',
    title: 'Instant oracle settlement',
    desc: 'Server calls instant_settle_bet() with OracleCap. Winner paid atomically in the same tx — no waiting.',
    color: 'text-purple-400',
    border: 'border-purple-500/25',
    bg: 'bg-purple-500/[0.04]',
  },
  {
    icon: '✅',
    title: 'Winner receives payout',
    desc: 'Smart contract sends winner\'s share from escrow. Platform collects 0.5–2% fee (HIP-4 tier).',
    color: 'text-green-400',
    border: 'border-green-500/25',
    bg: 'bg-green-500/[0.04]',
  },
];

// ─── Expandable section ───────────────────────────────────────────────────────

function Expandable({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#1e2a3a] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1a2235] transition-colors">
        <span className="text-white text-sm font-bold">{title}</span>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

// ─── Live stat pill ───────────────────────────────────────────────────────────

function StatPill({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-white/[0.06] p-3 text-center"
      style={{ background: `${color}08` }}>
      <Icon size={14} className="mx-auto mb-1.5" style={{ color }} />
      <div className="text-white font-bold text-sm leading-tight truncate">{value}</div>
      <div className="text-gray-500 text-[10px] mt-0.5 leading-tight">{label}</div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function P2PContractModal({ onClose }: { onClose: () => void }) {
  const { data: info, isLoading } = useQuery<ContractInfo>({
    queryKey: ['/api/p2p/contract-info'],
    queryFn: () => fetch('/api/p2p/contract-info').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: stats } = useQuery<P2PRevenueStats>({
    queryKey: ['/api/p2p/revenue-stats'],
    queryFn: () => fetch('/api/p2p/revenue-stats').then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const isEnabled = info?.configured ?? false;
  const suiscanBase = 'https://suiscan.xyz/mainnet';
  const urls = info?.suiscanUrls ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg bg-[#0d1320] border border-cyan-500/25 rounded-2xl shadow-2xl shadow-cyan-500/10 my-auto">

        {/* Glow accent */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent rounded-t-2xl" />

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-[#1a2235]">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.25)' }}>
                <Shield size={14} className="text-cyan-400" />
              </div>
              <h2 className="text-white font-black text-lg">P2P Smart Contract</h2>
              {isEnabled ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/12 text-green-400 border border-green-500/25 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> LIVE · MAINNET
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/12 text-yellow-400 border border-yellow-500/25">
                  ⚠ OFF-CHAIN
                </span>
              )}
            </div>
            <p className="text-gray-500 text-xs">Sui Move contract powering all on-chain P2P bets</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors ml-3 flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
              Loading contract data…
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">

            {/* Deploy status banner */}
            {isEnabled ? (
              <div className="rounded-xl border border-green-500/20 p-4"
                style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(16,185,129,0.02) 100%)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <CheckCircle size={14} className="text-green-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-green-400 font-bold text-sm">On-chain escrow active</span>
                      <span className="text-xs text-gray-600 font-mono">{info?.version ?? 'v1'}</span>
                    </div>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      All stakes locked in the smart contract. No admin can redirect funds — only the verified winner receives payout via atomic tx.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-yellow-500/20 p-4"
                style={{ background: 'rgba(234,179,8,0.04)' }}>
                <div className="flex gap-3">
                  <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-yellow-400 font-bold text-sm mb-1">Contract not deployed</p>
                    <p className="text-gray-400 text-xs">Bets are recorded off-chain. Configure all P2P env vars to enable on-chain escrow.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Live stats */}
            {stats && (
              <div className="flex gap-2">
                <StatPill
                  label="Settled Bets"
                  value={(stats.totalSettledBets ?? 0).toLocaleString()}
                  icon={Activity}
                  color="#06b6d4"
                />
                <StatPill
                  label="Total Volume"
                  value={`${(stats.totalVolumeSui ?? 0).toFixed(2)} SUI`}
                  icon={BarChart3}
                  color="#8b5cf6"
                />
                <StatPill
                  label="Fees Collected"
                  value={`${(stats.totalPlatformFeeSui ?? 0).toFixed(3)} SUI`}
                  icon={Coins}
                  color="#10b981"
                />
                <StatPill
                  label="Live Orders"
                  value={((stats.openOffersCount ?? 0) + (stats.openParlaysCount ?? 0)).toLocaleString()}
                  icon={TrendingUp}
                  color="#f59e0b"
                />
              </div>
            )}

            {/* Settlement flow */}
            <Expandable title="How settlement works" defaultOpen>
              <div className="space-y-2">
                {SETTLEMENT_STEPS.map((s, i) => (
                  <div key={i} className={`flex gap-3 rounded-xl border ${s.border} ${s.bg} p-3`}>
                    <div className="text-xl leading-none flex-shrink-0 mt-0.5">{s.icon}</div>
                    <div>
                      <div className={`font-bold text-xs ${s.color} mb-0.5`}>
                        Step {i + 1} — {s.title}
                      </div>
                      <div className="text-gray-400 text-xs leading-relaxed">{s.desc}</div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 mt-1">
                  <div className="flex-1 rounded-lg border border-purple-500/20 p-2.5 text-center"
                    style={{ background: 'rgba(139,92,246,0.05)' }}>
                    <Zap size={12} className="text-purple-400 mx-auto mb-1" />
                    <div className="text-purple-400 text-[10px] font-bold">Instant settle</div>
                    <div className="text-gray-600 text-[10px] mt-0.5">Oracle bypasses dispute window — winner paid same tx</div>
                  </div>
                  <div className="flex-1 rounded-lg border border-blue-500/20 p-2.5 text-center"
                    style={{ background: 'rgba(59,130,246,0.05)' }}>
                    <Lock size={12} className="text-blue-400 mx-auto mb-1" />
                    <div className="text-blue-400 text-[10px] font-bold">2-of-2 multi-sig</div>
                    <div className="text-gray-600 text-[10px] mt-0.5">Fee withdrawals require AdminCap + OracleCap both</div>
                  </div>
                </div>
              </div>
            </Expandable>

            {/* Contract objects */}
            {isEnabled && (
              <Expandable title="Deployed contract objects" defaultOpen>
                <div className="space-y-1.5">
                  <ObjectRow label="Package"    id={info?.packageId}    url={urls.package}  />
                  <ObjectRow label="Config"     id={info?.configId}     url={urls.config}   />
                  <ObjectRow label="Registry"   id={info?.registryId}   url={urls.registry} />
                  <ObjectRow label="AdminCap"   id={info?.adminCapId}   url={info?.adminCapId   ? `${suiscanBase}/object/${info.adminCapId}`   : undefined} dim />
                  <ObjectRow label="OracleCap"  id={info?.oracleCapId}  url={info?.oracleCapId  ? `${suiscanBase}/object/${info.oracleCapId}`  : undefined} dim />
                  <ObjectRow label="UpgradeCap" id={info?.upgradeCapId} url={info?.upgradeCapId ? `${suiscanBase}/object/${info.upgradeCapId}` : undefined} dim />
                </div>
                <p className="text-gray-600 text-[10px] mt-2.5 leading-relaxed">
                  AdminCap / OracleCap / UpgradeCap are held by the platform server. They are capability objects, not user-facing funds.
                </p>
              </Expandable>
            )}

            {/* Security guarantees */}
            <Expandable title="Security guarantees">
              <div className="space-y-1.5">
                {[
                  { icon: '🔍', title: 'Sui RPC tx verification', desc: 'Every stake txHash is verified against the Sui blockchain before the bet is recorded. Fake or failed transactions are rejected.' },
                  { icon: '🔁', title: 'TxHash deduplication', desc: 'The same transaction hash cannot fund two separate bets. Each tx can only be linked to one bet entry — ever.' },
                  { icon: '💯', title: 'Sender + amount checked', desc: 'Verification confirms the correct wallet signed the tx and the platform received at least the required stake amount.' },
                  { icon: '🔐', title: 'Escrow by ownership', desc: 'In on-chain mode, funds live inside the Bet object — enforced by Move. No intermediary wallet can redirect them.' },
                  { icon: '⚡', title: 'Instant oracle settlement', desc: 'OracleCap enables instant_settle_bet() — atomic payout in the same transaction, no dispute window.' },
                  { icon: '🚫', title: 'No self-bet', desc: 'Contract enforces creator ≠ taker at the SQL layer AND on-chain. You cannot bet against yourself.' },
                  { icon: '🏦', title: '2-of-2 fee guard', desc: 'Collecting fees requires both AdminCap and OracleCap — multi-sig protection against single-key compromise.' },
                  { icon: '🔒', title: 'Double-accept guard', desc: 'SQL UPDATE WHERE status=\'open\' + on-chain check prevents two takers from filling the same offer.' },
                  { icon: '⏰', title: 'Expiry enforcement', desc: 'Server rejects accepts on expired offers. The settlement worker automatically voids offers past expiry.' },
                ].map(item => (
                  <div key={item.title} className="flex gap-3 rounded-lg border border-[#1e2a3a] px-3 py-2.5"
                    style={{ background: 'rgba(255,255,255,0.015)' }}>
                    <span className="text-lg leading-none flex-shrink-0">{item.icon}</span>
                    <div>
                      <div className="text-white text-xs font-bold mb-0.5">{item.title}</div>
                      <div className="text-gray-500 text-xs leading-relaxed">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Expandable>

            {/* Feature matrix */}
            {info?.features && info.features.length > 0 && (
              <Expandable title={`Contract feature set (${info.features.length})`}>
                <div className="grid grid-cols-1 gap-1.5">
                  {info.features.map(f => (
                    <div key={f} className="flex items-center gap-2 rounded-lg border border-[#1e2a3a] px-3 py-2 text-xs"
                      style={{ background: 'rgba(255,255,255,0.015)' }}>
                      <CheckCircle size={11} className="text-green-400 flex-shrink-0" />
                      <span className="text-gray-300">{FEATURE_LABELS[f] ?? f}</span>
                    </div>
                  ))}
                </div>
              </Expandable>
            )}

            {/* Supported coins */}
            {info?.supportedCoins && info.supportedCoins.length > 0 && (
              <div>
                <SectionHead icon={Shield} label="Supported coins" />
                <div className="flex flex-wrap gap-2">
                  {info.supportedCoins.map(coin => (
                    <div key={coin.symbol}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold ${
                        coin.default
                          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                          : 'bg-[#111827] border-[#1e2a3a] text-gray-400'
                      }`}>
                      <span>{coin.symbol === 'SUI' ? '◎' : '$'}</span>
                      <span>{coin.symbol}</span>
                      {coin.default && <span className="text-cyan-500/60 font-normal">Default</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* HIP-4 fee tiers */}
            {info?.hipFourTiers && info.hipFourTiers.length > 0 && (
              <Expandable title="HIP-4 fee tier schedule">
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {info.hipFourTiers.map((tier, i) => {
                    const colors = ['#cd7f32', '#c0c0c0', '#ffd700', '#b9f2ff', '#e040fb'];
                    const color = colors[i] ?? '#888';
                    return (
                      <div key={tier.name} className="rounded-xl p-2.5 text-center text-xs"
                        style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
                        <div className="font-black truncate text-[11px]" style={{ color }}>{tier.name}</div>
                        <div className="text-gray-600 mt-0.5 text-[9px]">
                          {tier.minVolumeSUI >= 1000 ? `${tier.minVolumeSUI / 1000}K SUI` : 'Starter'}
                        </div>
                        <div className="mt-1.5 border-t border-white/[0.06] pt-1.5">
                          <div className="text-red-400 text-[10px]">{(tier.takerFeeBps / 100).toFixed(2)}%</div>
                          {tier.makerRebateBps > 0
                            ? <div className="text-green-400 text-[10px]">−{(tier.makerRebateBps / 100).toFixed(2)}%</div>
                            : <div className="text-gray-700 text-[10px]">—</div>}
                          <div className="text-gray-500 text-[9px] mt-0.5">net {(tier.netFeeBps / 100).toFixed(2)}%</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-gray-600 text-[10px] leading-relaxed">
                  Taker fee decreases with lifetime traded volume. Elite makers earn a rebate — net fee as low as 0.20%. Rates are enforced off-chain and distributed on settlement.
                </p>
              </Expandable>
            )}

            {/* External links */}
            {isEnabled && (
              <div className="flex flex-wrap gap-2 pt-1">
                {urls.package && (
                  <a href={urls.package} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-cyan-500/25 text-cyan-400 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors font-bold"
                    style={{ background: 'rgba(6,182,212,0.06)' }}>
                    <ExternalLink size={11} /> View Package on SuiScan
                  </a>
                )}
                {urls.registry && (
                  <a href={urls.registry} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-purple-500/25 text-purple-400 hover:text-purple-300 transition-colors font-bold"
                    style={{ background: 'rgba(139,92,246,0.06)' }}>
                    <ExternalLink size={11} /> Order Book Registry
                  </a>
                )}
              </div>
            )}

          </div>
        )}

        {/* Footer */}
        <div className="border-t border-[#1a2235] px-5 py-3.5 flex items-center justify-between rounded-b-2xl">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-green-400' : 'bg-gray-600'}`} />
            <span className="text-gray-600 text-xs">
              SuiBets P2P · {isEnabled ? `Verified on-chain · ${info?.network ?? 'mainnet'}` : 'Off-chain mode'}
            </span>
          </div>
          <button onClick={onClose}
            className="text-xs font-bold px-4 py-1.5 rounded-lg text-white transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
