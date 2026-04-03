import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Check,
  ExternalLink,
  ArrowLeft,
  Shield,
  Database,
  Hash,
  Calendar,
  Layers,
  Wallet,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  Trophy,
  Sparkles,
  Share2,
  Download,
} from 'lucide-react';
import { useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@/lib/dapp-kit-compat';
import { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/hooks/use-toast';
const suibetsLogo = "/images/suibets-logo.png";

const NFT_PACKAGE_ID = import.meta.env.VITE_NFT_PACKAGE_ID || '0x20180106d80547caf91927848f87a84f6cac5162686a622ba74b17b733919842';
const NFT_MINT_AUTHORITY_ID = import.meta.env.VITE_NFT_MINT_AUTHORITY_ID || '0x9e6815de4d258fc17ae1755e06bc1ff0ea0d8b6525b1946d84362194ca7d6546';

export default function WalrusReceiptPage() {
  const [, params] = useRoute('/walrus-receipt/:blobId');
  const [, setLocation] = useLocation();
  const blobId = params?.blobId;
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [mintingNft, setMintingNft] = useState(false);
  const [nftMinted, setNftMinted] = useState(false);
  const [nftTxHash, setNftTxHash] = useState<string | null>(null);
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { toast } = useToast();

  const { data: receipt, isLoading, error } = useQuery<any>({
    queryKey: [`/api/walrus/receipt/${blobId}?json=1`],
    enabled: !!blobId,
    retry: 2,
  });

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {}
  };

  const getStatusConfig = (status?: string) => {
    switch (status) {
      case 'won':
      case 'paid_out':
        return { label: status === 'paid_out' ? 'PAID OUT' : 'WON', color: 'text-green-400', bg: 'bg-green-500/15', border: 'border-green-500/30', icon: <CheckCircle2 className="h-5 w-5 text-green-400" /> };
      case 'lost':
        return { label: 'LOST', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30', icon: <XCircle className="h-5 w-5 text-red-400" /> };
      case 'pending':
      case 'confirmed':
        return { label: 'PENDING', color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30', icon: <Clock className="h-5 w-5 text-yellow-400 animate-pulse" /> };
      default:
        return { label: (status || 'PENDING').toUpperCase(), color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30', icon: <Clock className="h-5 w-5 text-yellow-400" /> };
    }
  };

  const formatDate = (ts?: number | string) => {
    if (!ts) return '—';
    try {
      return new Date(typeof ts === 'number' ? ts : ts).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch { return String(ts); }
  };

  const shortHash = (h?: string, n = 16) => h ? `${h.slice(0, n)}...` : '—';

  const CopyButton = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => copyToClipboard(text, field)}
      className="ml-1.5 text-gray-500 hover:text-cyan-400 transition-colors flex-shrink-0"
      title="Copy"
    >
      {copiedField === field ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-gray-800/60 last:border-0">
      <span className="text-gray-500 text-sm flex-shrink-0">{label}</span>
      <div className="text-right text-sm">{children}</div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #050d12 0%, #0a1520 50%, #060e16 100%)' }}>
      {/* Nav */}
      <nav className="border-b border-cyan-900/30 bg-black/40 backdrop-blur-md px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation('/bet-history')}
              className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
              data-testid="btn-back"
            >
              <ArrowLeft size={18} />
            </button>
            <Link href="/">
              <img src={suibetsLogo} alt="SuiBets" className="h-8 w-auto cursor-pointer" />
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🐋</span>
            <span className="text-cyan-400 text-sm font-semibold">Walrus Receipt</span>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-10">

        {isLoading && (
          <div className="text-center py-24">
            <RefreshCw className="h-10 w-10 text-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Fetching receipt from Walrus decentralized storage...</p>
          </div>
        )}

        {error && !receipt && (
          <div className="text-center py-24">
            <AlertTriangle className="h-12 w-12 text-yellow-400 mx-auto mb-4" />
            <p className="text-white text-lg font-semibold mb-2">Receipt Unavailable</p>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              This blob ID may still be certifying on the Walrus network, or it may not exist. Try again in a moment.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-5 py-2.5 rounded-xl text-sm"
              >
                Retry
              </button>
              <button
                onClick={() => setLocation('/bet-history')}
                className="bg-gray-800 hover:bg-gray-700 text-white font-medium px-5 py-2.5 rounded-xl text-sm"
              >
                Back to My Bets
              </button>
            </div>
          </div>
        )}

        {receipt && (() => {
          const data = receipt.receipt || receipt;
          const bet = data.bet || {};
          const blockchain = data.blockchain || {};
          const storage = data.storage || {};
          const verification = data.verification || {};
          const status = bet.status;
          const statusCfg = getStatusConfig(status);
          let parlayLegs: any[] = [];
          const tryParseLegs = (str: string | undefined): any[] => {
            if (!str) return [];
            try {
              if (str.startsWith('[')) {
                const parsed = JSON.parse(str);
                if (Array.isArray(parsed) && parsed.length > 1) return parsed;
              }
            } catch {}
            return [];
          };

          parlayLegs = tryParseLegs(bet.eventName) || [];
          if (parlayLegs.length === 0) parlayLegs = tryParseLegs(bet.selection) || [];
          if (parlayLegs.length === 0) parlayLegs = tryParseLegs(bet.prediction) || [];

          if (parlayLegs.length === 0 && bet.betType === 'parlay' && typeof bet.prediction === 'string' && bet.prediction.includes(' | ')) {
            parlayLegs = bet.prediction.split(' | ').map((part: string) => {
              const colonIdx = part.lastIndexOf(':');
              if (colonIdx > 0) {
                return { eventName: part.slice(0, colonIdx).trim(), selection: part.slice(colonIdx + 1).trim(), prediction: part.slice(colonIdx + 1).trim(), odds: 0 };
              }
              return { eventName: part.trim(), selection: part.trim(), prediction: part.trim(), odds: 0 };
            });
          }
          if (parlayLegs.length === 0 && typeof bet.eventName === 'string' && bet.eventName.includes(' | ') && (bet.betType === 'parlay' || bet.eventName.split(' | ').length > 2)) {
            parlayLegs = bet.eventName.split(' | ').map((part: string) => {
              const colonIdx = part.lastIndexOf(':');
              if (colonIdx > 0) {
                return { eventName: part.slice(0, colonIdx).trim(), selection: part.slice(colonIdx + 1).trim(), prediction: part.slice(colonIdx + 1).trim(), odds: 0 };
              }
              return { eventName: part.trim(), selection: part.trim(), prediction: part.trim(), odds: 0 };
            });
          }

          const isParlay = parlayLegs.length > 1 || bet.betType === 'parlay';

          return (
            <div className="space-y-5">
              {/* Hero card */}
              <div
                className="rounded-2xl border border-cyan-500/25 overflow-hidden relative"
                style={{ background: 'linear-gradient(135deg, #0d1e2a 0%, #111e2e 60%, #0a1620 100%)' }}
              >
                <div className="absolute top-0 right-0 w-56 h-56 bg-gradient-to-bl from-cyan-500/10 to-transparent pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-gradient-to-tr from-purple-500/8 to-transparent pointer-events-none" />

                <div className="relative p-6">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <img src={suibetsLogo} alt="SuiBets" className="h-8 w-auto" />
                    </div>
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${statusCfg.bg} ${statusCfg.color} ${statusCfg.border}`} data-testid="status-badge">
                      {statusCfg.icon}
                      {statusCfg.label}
                    </div>
                  </div>

                  <div className="mb-1">
                    <p className="text-gray-400 text-xs uppercase tracking-widest font-medium mb-1">
                      {isParlay ? `Parlay Bet (${parlayLegs.length} Legs)` : 'Single Bet'}
                    </p>
                    <h1 className="text-white text-xl font-bold leading-tight">
                      {isParlay
                        ? `${parlayLegs.length}-Leg Parlay`
                        : (bet.eventName && !bet.eventName.includes(' | ') ? bet.eventName : 'Bet Receipt')}
                    </h1>
                    {!isParlay && bet.prediction && (
                      <p className="text-cyan-400 font-semibold mt-1">{bet.prediction}</p>
                    )}
                  </div>

                  {isParlay && parlayLegs.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      {parlayLegs.map((leg: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-2.5 pl-3 py-1.5 relative bg-black/20 rounded-lg">
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-cyan-400/40 rounded-full" />
                          <div className="pl-1 min-w-0">
                            {leg.eventName && (
                              <p className="text-gray-400 text-xs truncate">{leg.eventName}</p>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="text-cyan-300 text-sm font-semibold">{leg.selection || leg.prediction || 'Pick'}</span>
                              {leg.odds > 0 && <span className="text-gray-500 text-xs">@ {Number(leg.odds).toFixed(2)}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="bg-black/30 rounded-xl p-3 text-center">
                      <p className="text-gray-500 text-xs mb-1">Stake</p>
                      <p className="text-white font-bold text-sm" data-testid="text-stake">
                        {Number(bet.stake || 0).toFixed(4)} {bet.currency || 'SUI'}
                      </p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 text-center">
                      <p className="text-gray-500 text-xs mb-1">Odds</p>
                      <p className="text-cyan-400 font-bold text-sm" data-testid="text-odds">
                        {Number(bet.odds || 1).toFixed(2)}x
                      </p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 text-center">
                      <p className="text-gray-500 text-xs mb-1">{(status === 'won' || status === 'paid_out') ? 'Won' : 'To Win'}</p>
                      <p className={`font-bold text-sm ${status === 'won' || status === 'paid_out' ? 'text-green-400' : status === 'lost' ? 'text-red-400 line-through' : 'text-cyan-400'}`} data-testid="text-payout">
                        {Number(bet.actualPayout || bet.potentialPayout || 0).toFixed(4)} {bet.currency || 'SUI'}
                      </p>
                    </div>
                  </div>

                  {bet.settledAt && (
                    <div className="mt-3 flex items-center justify-center gap-2 text-xs">
                      <Calendar className="h-3 w-3 text-gray-500" />
                      <span className="text-gray-500">Settled: {formatDate(bet.settledAt)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Walrus Storage Section */}
              <div className="rounded-2xl border border-purple-500/25 overflow-hidden" style={{ background: 'linear-gradient(135deg, #120a1e 0%, #150d22 100%)' }}>
                <div className="px-5 py-4 border-b border-purple-900/30 flex items-center gap-2">
                  <span className="text-xl">🐋</span>
                  <h2 className="text-purple-300 font-bold text-sm tracking-wide uppercase">Walrus Decentralized Storage</h2>
                  <span className="ml-auto bg-purple-500/20 text-purple-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-purple-500/30">
                    ✓ On-Chain
                  </span>
                </div>
                <div className="p-5 space-y-0">
                  <Row label="Blob ID">
                    <div className="flex items-center justify-end gap-1 max-w-xs">
                      <span className="text-purple-300 font-mono text-xs break-all text-right" data-testid="text-blob-id">
                        {blobId}
                      </span>
                      {blobId && <CopyButton text={blobId} field="blobId" />}
                    </div>
                  </Row>
                  <Row label="Network">
                    <span className="text-gray-300">Walrus Mainnet</span>
                  </Row>
                  {storage.storedAt && (
                    <Row label="Stored At">
                      <span className="text-gray-300">{formatDate(storage.storedAt)}</span>
                    </Row>
                  )}
                  <Row label="Aggregator">
                    <a
                      href={`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-xs"
                      data-testid="link-raw-blob"
                    >
                      View Raw Blob <ExternalLink size={11} />
                    </a>
                  </Row>
                </div>
              </div>

              {/* Bet Details Section */}
              <div className="rounded-2xl border border-cyan-900/30 overflow-hidden" style={{ background: '#0d1520' }}>
                <div className="px-5 py-4 border-b border-cyan-900/30 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-cyan-400" />
                  <h2 className="text-cyan-300 font-bold text-sm tracking-wide uppercase">Bet Details</h2>
                </div>
                <div className="p-5 space-y-0">
                  <Row label="Bet ID">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gray-300 font-mono text-xs" data-testid="text-bet-id">{shortHash(bet.id, 20)}</span>
                      {bet.id && <CopyButton text={bet.id} field="betId" />}
                    </div>
                  </Row>
                  {bet.homeTeam && bet.awayTeam && (
                    <Row label="Match">
                      <span className="text-white font-medium">{bet.homeTeam} vs {bet.awayTeam}</span>
                    </Row>
                  )}
                  {bet.sportName && (
                    <Row label="Sport">
                      <span className="text-gray-300">{bet.sportName}</span>
                    </Row>
                  )}
                  {bet.marketType && (
                    <Row label="Market">
                      <span className="text-gray-300">{bet.marketType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                    </Row>
                  )}
                  {storage.placedAt && (
                    <Row label="Placed At">
                      <span className="text-gray-300">{formatDate(storage.placedAt)}</span>
                    </Row>
                  )}
                  {bet.walletAddress && (
                    <Row label="Wallet">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-gray-300 font-mono text-xs">{shortHash(bet.walletAddress, 12)}</span>
                        <CopyButton text={bet.walletAddress} field="wallet" />
                      </div>
                    </Row>
                  )}
                </div>
              </div>

              {/* Blockchain Section */}
              {(blockchain.txHash || blockchain.betObjectId || blockchain.contract || blockchain.settlementTxHash) && (
                <div className="rounded-2xl border border-cyan-900/30 overflow-hidden" style={{ background: '#0d1520' }}>
                  <div className="px-5 py-4 border-b border-cyan-900/30 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-cyan-400" />
                    <h2 className="text-cyan-300 font-bold text-sm tracking-wide uppercase">Blockchain</h2>
                    <span className="ml-auto text-gray-500 text-xs">Sui Mainnet</span>
                  </div>
                  <div className="p-5 space-y-0">
                    {blockchain.txHash && (
                      <Row label="Transaction">
                        <a
                          href={`https://suiscan.xyz/mainnet/tx/${blockchain.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs"
                          data-testid="link-tx"
                        >
                          {shortHash(blockchain.txHash, 12)} <ExternalLink size={11} />
                        </a>
                      </Row>
                    )}
                    {blockchain.betObjectId && (
                      <Row label="Bet Object">
                        <a
                          href={`https://suiscan.xyz/mainnet/object/${blockchain.betObjectId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs"
                          data-testid="link-object"
                        >
                          {shortHash(blockchain.betObjectId, 12)} <ExternalLink size={11} />
                        </a>
                      </Row>
                    )}
                    {blockchain.contract && (
                      <Row label="Contract">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-500 font-mono text-xs">{shortHash(blockchain.contract, 12)}</span>
                          <CopyButton text={blockchain.contract} field="contract" />
                        </div>
                      </Row>
                    )}
                    {blockchain.settlementTxHash && (
                      <Row label="Settlement TX">
                        <a
                          href={`https://suiscan.xyz/mainnet/tx/${blockchain.settlementTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-green-400 hover:text-green-300 font-mono text-xs"
                          data-testid="link-settlement-tx"
                        >
                          {shortHash(blockchain.settlementTxHash, 12)} <ExternalLink size={11} />
                        </a>
                      </Row>
                    )}
                  </div>
                </div>
              )}

              {/* Verification Section */}
              {verification.receiptHash && (
                <div className="rounded-2xl border border-green-900/30 overflow-hidden" style={{ background: '#0a1510' }}>
                  <div className="px-5 py-4 border-b border-green-900/30 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-green-400" />
                    <h2 className="text-green-300 font-bold text-sm tracking-wide uppercase">Verification</h2>
                    <span className="ml-auto flex items-center gap-1 bg-green-500/15 text-green-400 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-green-500/25">
                      <CheckCircle2 size={10} /> Verified
                    </span>
                  </div>
                  <div className="p-5 space-y-0">
                    <Row label="Receipt Hash">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-green-300 font-mono text-xs">{shortHash(verification.receiptHash, 16)}</span>
                        <CopyButton text={verification.receiptHash} field="receiptHash" />
                      </div>
                    </Row>
                    {verification.algorithm && (
                      <Row label="Algorithm">
                        <span className="text-gray-300 uppercase text-xs">{verification.algorithm}</span>
                      </Row>
                    )}
                    <Row label="Platform">
                      <span className="text-gray-300">SuiBets v{data.version || '2.0'}</span>
                    </Row>
                  </div>
                </div>
              )}

              {(status === 'won' || status === 'paid_out') && (
                <div className="rounded-2xl overflow-hidden relative" style={{
                  background: 'linear-gradient(135deg, #0c1a12 0%, #0a1a20 30%, #12101e 70%, #0c1a12 100%)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }}>
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)' }} />
                    <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full" style={{ background: 'radial-gradient(circle, rgba(234,179,8,0.08) 0%, transparent 70%)' }} />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 60%)' }} />
                  </div>

                  <div className="relative px-5 py-4 border-b border-emerald-800/40 flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-yellow-500/20 to-emerald-500/20 border border-yellow-500/25">
                      <Trophy className="h-4 w-4 text-yellow-400" />
                    </div>
                    <h2 className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-emerald-300 to-cyan-300 font-bold text-sm tracking-wide uppercase">
                      NFT Trophy
                    </h2>
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border"
                      style={{
                        background: 'linear-gradient(135deg, rgba(234,179,8,0.15), rgba(16,185,129,0.15))',
                        borderColor: 'rgba(234,179,8,0.3)',
                        color: '#fbbf24',
                      }}
                    >
                      <Sparkles size={10} />
                      Sui Display Standard
                    </span>
                  </div>

                  <div className="relative p-5">
                    <div className="rounded-xl overflow-hidden border border-emerald-700/30" style={{
                      background: 'linear-gradient(180deg, #0a1510 0%, #080f14 100%)',
                    }}>
                      <div className="relative p-5 pb-4 text-center" style={{
                        background: 'linear-gradient(180deg, rgba(234,179,8,0.06) 0%, transparent 60%)',
                      }}>
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-3 relative" style={{
                          background: 'linear-gradient(135deg, #b45309 0%, #d97706 30%, #fbbf24 50%, #d97706 70%, #b45309 100%)',
                          boxShadow: '0 0 30px rgba(234,179,8,0.25), 0 0 60px rgba(234,179,8,0.1)',
                        }}>
                          <Trophy className="h-8 w-8 text-yellow-900" />
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center border-2 border-emerald-900">
                            <CheckCircle2 size={10} className="text-white" />
                          </div>
                        </div>

                        <h3 className="text-white font-bold text-lg mb-0.5">Winning Bet Trophy</h3>
                        <p className="text-gray-500 text-xs">Proof of Conviction — Minted on Sui</p>
                      </div>

                      <div className="px-4 pb-4 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg p-2.5 text-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                            <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Won</p>
                            <p className="text-emerald-400 font-bold text-sm">{Number(bet.actualPayout || bet.potentialPayout || 0).toFixed(2)} {bet.currency || 'SUI'}</p>
                          </div>
                          <div className="rounded-lg p-2.5 text-center" style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.15)' }}>
                            <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Odds</p>
                            <p className="text-cyan-400 font-bold text-sm">{Number(bet.odds || 1).toFixed(2)}x</p>
                          </div>
                        </div>

                        <div className="rounded-lg p-2.5" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.12)' }}>
                          <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Prediction</p>
                          <p className="text-purple-300 font-semibold text-sm truncate">{bet.prediction || bet.eventName || 'Winning Bet'}</p>
                          {bet.homeTeam && bet.awayTeam && (
                            <p className="text-gray-600 text-xs mt-0.5">{bet.homeTeam} vs {bet.awayTeam}</p>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-gray-600 pt-1 px-1">
                          <span>Walrus: {blobId ? `${blobId.slice(0, 8)}...` : '—'}</span>
                          <span>Sui Mainnet</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2.5">
                      {!nftMinted ? (
                        <>
                          {!account ? (
                            <div className="text-center py-3">
                              <p className="text-gray-500 text-xs mb-2">Connect your Sui wallet to mint this trophy as an NFT</p>
                              <div className="inline-flex items-center gap-1.5 text-yellow-500/60 text-[10px]">
                                <Wallet size={10} />
                                Wallet not connected
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={async () => {
                                if (mintingNft) return;
                                setMintingNft(true);
                                try {
                                  const metadataUrl = `${window.location.origin}/api/nft/metadata/${blobId}`.slice(0, 1024);
                                  const receiptUrl = `${window.location.origin}/walrus-receipt/${blobId}`;
                                  const imageUrl = `${window.location.origin}/api/nft/image/${blobId}`.slice(0, 1024);

                                  if (NFT_PACKAGE_ID && NFT_MINT_AUTHORITY_ID) {
                                    const signResponse = await fetch('/api/nft/sign-mint', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        blobId,
                                        walletAddress: account.address,
                                      }),
                                    });
                                    if (!signResponse.ok && signResponse.status !== 200) {
                                      const errBody = await signResponse.json().catch(() => ({ message: 'Server error' }));
                                      throw new Error(errBody.message || `Sign-mint failed (${signResponse.status})`);
                                    }
                                    const signResult = await signResponse.json();
                                    if (!signResult.success) {
                                      throw new Error(signResult.message || 'Failed to get mint authorization');
                                    }

                                    const safeName = (signResult.name || 'Winning Bet').slice(0, 256);
                                    const safePrediction = (signResult.prediction || '').slice(0, 256);
                                    const safeOdds = (signResult.odds || '1.00').slice(0, 32);
                                    const safePayout = (signResult.payout || '0').slice(0, 64);
                                    const safeCurrency = (signResult.currency || 'SUI').slice(0, 32);
                                    const safeBlobId = (blobId || '').slice(0, 256);

                                    const tx = new Transaction();
                                    tx.moveCall({
                                      target: `${NFT_PACKAGE_ID}::bet_trophy::mint`,
                                      arguments: [
                                        tx.object(NFT_MINT_AUTHORITY_ID),
                                        tx.pure.string(safeName),
                                        tx.pure.string(safePrediction),
                                        tx.pure.string(safeOdds),
                                        tx.pure.string(safePayout),
                                        tx.pure.string(safeCurrency),
                                        tx.pure.string(safeBlobId),
                                        tx.pure.string(imageUrl),
                                        tx.pure.string(metadataUrl),
                                        tx.pure.vector('u8', signResult.signature),
                                      ],
                                    });

                                    const result = await signAndExecute({
                                      transaction: tx,
                                    });

                                    setNftTxHash(result.digest);
                                    setNftMinted(true);
                                    toast({ title: 'NFT Trophy Minted!', description: 'Your winning bet trophy is now a collectible NFT on Sui.' });

                                    fetch('/api/nft/confirm-mint', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ blobId, txHash: result.digest, walletAddress: account.address }),
                                    }).catch(() => {});
                                  } else {
                                    const response = await fetch('/api/nft/register', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        blobId,
                                        walletAddress: account.address,
                                        eventName: bet.eventName,
                                        prediction: bet.prediction,
                                        odds: bet.odds,
                                        payout: bet.actualPayout || bet.potentialPayout,
                                        currency: bet.currency,
                                        sportName: bet.sportName,
                                      }),
                                    });
                                    const result = await response.json();
                                    if (result.success) {
                                      setNftMinted(true);
                                      setNftTxHash(result.registrationId || null);
                                      toast({ title: 'Trophy Registered!', description: 'Your winning bet trophy has been registered. On-chain minting will be available when the NFT contract is deployed.' });
                                    } else {
                                      throw new Error(result.message || 'Registration failed');
                                    }
                                  }
                                } catch (err: any) {
                                  console.error('NFT mint error:', err);
                                  toast({ title: 'Mint Failed', description: err.message || 'Could not mint NFT trophy.', variant: 'destructive' });
                                } finally {
                                  setMintingNft(false);
                                }
                              }}
                              disabled={mintingNft}
                              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
                              style={{
                                background: mintingNft
                                  ? 'rgba(234,179,8,0.15)'
                                  : 'linear-gradient(135deg, #b45309 0%, #d97706 50%, #f59e0b 100%)',
                                color: mintingNft ? '#fbbf24' : '#451a03',
                                boxShadow: mintingNft ? 'none' : '0 0 20px rgba(234,179,8,0.2)',
                              }}
                              data-testid="btn-mint-nft"
                            >
                              {mintingNft ? (
                                <>
                                  <RefreshCw size={16} className="animate-spin" />
                                  {(NFT_PACKAGE_ID && NFT_MINT_AUTHORITY_ID) ? 'Minting on Sui...' : 'Registering Trophy...'}
                                </>
                              ) : (
                                <>
                                  <Trophy size={16} />
                                  {(NFT_PACKAGE_ID && NFT_MINT_AUTHORITY_ID) ? 'Mint NFT Trophy' : 'Claim Trophy'}
                                  <Sparkles size={14} />
                                </>
                              )}
                            </button>
                          )}

                          <div className="flex items-center justify-center gap-4 text-[10px] text-gray-600">
                            <span className="flex items-center gap-1"><Shield size={9} /> Sui Object Display</span>
                            <span className="flex items-center gap-1"><Database size={9} /> On-Chain Metadata</span>
                            <span className="flex items-center gap-1"><Layers size={9} /> Walrus Linked</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-3">
                          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 mb-3">
                            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                          </div>
                          <p className="text-emerald-400 font-bold text-sm mb-1">
                            {NFT_PACKAGE_ID ? 'NFT Trophy Minted!' : 'Trophy Registered!'}
                          </p>
                          <p className="text-gray-500 text-xs mb-3">
                            {NFT_PACKAGE_ID
                              ? 'This trophy NFT is now in your Sui wallet. View it in any Sui-compatible wallet or marketplace.'
                              : 'Your trophy is registered and will be mintable as an NFT when the contract is deployed on Sui mainnet.'}
                          </p>
                          {nftTxHash && NFT_PACKAGE_ID && (
                            <a
                              href={`https://suiscan.xyz/mainnet/tx/${nftTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 text-xs font-medium"
                              data-testid="link-nft-tx"
                            >
                              View on SuiScan <ExternalLink size={11} />
                            </a>
                          )}

                          <div className="flex gap-2 mt-3 justify-center">
                            <button
                              onClick={() => {
                                const shareUrl = `${window.location.origin}/walrus-receipt/${blobId}`;
                                navigator.clipboard.writeText(shareUrl);
                                toast({ title: 'Link Copied!', description: 'Share your winning trophy with others.' });
                              }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs border border-gray-700/50 transition-colors"
                              data-testid="btn-share-trophy"
                            >
                              <Share2 size={12} /> Share
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setLocation('/bet-history')}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm bg-cyan-500 hover:bg-cyan-600 text-black transition-colors"
                  data-testid="btn-my-bets"
                >
                  <ArrowLeft size={16} />
                  My Bets
                </button>
                <a
                  href={`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm bg-gray-800 hover:bg-gray-700 text-white border border-gray-700/50 transition-colors"
                  data-testid="btn-raw-blob"
                >
                  Raw Blob
                  <ExternalLink size={14} />
                </a>
              </div>

              {/* Footer */}
              <div className="text-center pt-2 pb-4">
                <p className="text-gray-600 text-xs">This receipt is permanently stored on the Walrus decentralized storage network.</p>
                <a href="https://www.suibets.com" className="text-cyan-700 hover:text-cyan-500 text-xs">suibets.com</a>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
