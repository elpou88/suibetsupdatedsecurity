/**
 * P2P Challenge Accept Page  — /p2p/c/:token
 *
 * Anyone who receives a zkSend challenge link lands here.
 * • Wallet holders can accept directly (standard Sui tx flow).
 * • Non-wallet users see a zkLogin / Google sign-in button so they can
 *   onboard in ~15 s and accept the bet without any prior crypto knowledge.
 */

import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { Transaction } from '@mysten/sui/transactions';
import { useZkLogin } from '@/context/ZkLoginContext';
import { useToast } from '@/hooks/use-toast';
import Layout from '@/components/layout/Layout';
import {
  Zap, Shield, Clock, Trophy, ExternalLink, Copy, Check,
  LogIn, Loader2, AlertTriangle, Star,
} from 'lucide-react';

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';
const api = (path: string) => `${API_BASE}/api/p2p${path}`;

// ── Fallback contract addresses (same as AcceptModal in p2p.tsx) ─────────────
const FALLBACK_PACKAGE_ID  = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const FALLBACK_CONFIG_ID   = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const FALLBACK_REGISTRY_ID = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const FALLBACK_WALLET      = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';
const SUI_CLOCK_ID         = '0x6';

interface Offer {
  id: number;
  creatorWallet: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  odds: number;
  creatorStake: number;
  takerStake: number;
  currency: string;
  status: string;
  expiresAt: string;
  matchDate?: string;
  suinsGated?: boolean;
  onchainOfferId?: string;
  shareToken?: string;
}

function formatTimeLeft(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export default function P2PChallengeAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contractWallet, setContractWallet] = useState(FALLBACK_WALLET);
  const [packageId, setPackageId] = useState(FALLBACK_PACKAGE_ID);
  const [configId, setConfigId] = useState(FALLBACK_CONFIG_ID);
  const [registryId, setRegistryId] = useState(FALLBACK_REGISTRY_ID);

  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();
  const { toast } = useToast();

  // zkLogin state (for wallet-less acceptance)
  let zkLoginCtx: any = null;
  try { zkLoginCtx = useZkLogin(); } catch (_) {}
  const initiateZkLogin = zkLoginCtx?.initiateZkLogin;
  const zkLoginAddress = zkLoginCtx?.address;

  const myWallet = account?.address ?? zkLoginAddress ?? null;

  // ── Load offer by share token ──────────────────────────────────────────────
  useEffect(() => {
    if (!token) { setError('No challenge token provided'); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(api(`/challenge/${token}`));
        if (!res.ok) { const j = await res.json(); throw new Error(j.message || 'Offer not found'); }
        const data = await res.json();
        setOffer(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // ── Load contract addresses ────────────────────────────────────────────────
  useEffect(() => {
    fetch(api('/contract-wallet')).then(r => r.json()).then(d => {
      if (d.wallet) setContractWallet(d.wallet);
      if (d.packageId) setPackageId(d.packageId);
      if (d.configId) setConfigId(d.configId);
      if (d.registryId) setRegistryId(d.registryId);
    }).catch(() => {});
  }, []);

  // ── Accept the bet ─────────────────────────────────────────────────────────
  async function handleAccept() {
    if (!offer || !myWallet) return;
    setAccepting(true);
    try {
      if (offer.suinsGated) {
        const check = await fetch(api(`/suins/check/${myWallet}`)).then(r => r.json());
        if (!check.hasSuiNs) {
          toast({ title: 'VIP Pool', description: 'This offer requires a .sui domain name to enter. You can register one at suins.io.', variant: 'destructive' });
          setAccepting(false);
          return;
        }
      }

      const tx = new Transaction();
      const stakeMist = BigInt(Math.round(offer.takerStake * 1_000_000_000));
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(stakeMist)]);
      tx.moveCall({
        target: `${packageId}::p2p_betting::accept_offer`,
        arguments: [
          tx.object(offer.onchainOfferId ?? ''),
          tx.object(configId),
          tx.object(registryId),
          coin,
          tx.object(SUI_CLOCK_ID),
        ],
      });
      tx.setGasBudget(50_000_000);

      const result = await signAndExecute({ transaction: tx as any });
      const txHash = (result as any)?.digest ?? '';

      await fetch(api(`/offers/${offer.id}/accept`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          takerWallet: myWallet,
          stake: offer.takerStake,
          takerTxHash: txHash,
        }),
      });

      setAccepted(true);
      toast({ title: '🎉 Bet Accepted!', description: `You've accepted ${offer.creatorWallet.slice(0, 8)}…'s challenge. May the best bettor win!` });
    } catch (e: any) {
      toast({ title: 'Failed to accept', description: e.message, variant: 'destructive' });
    } finally {
      setAccepting(false);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ────────────────────────────────────────────────────────────────────────────

  if (loading) return (
    <Layout>
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-cyan-400" />
      </div>
    </Layout>
  );

  if (error || !offer) return (
    <Layout>
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <AlertTriangle className="w-12 h-12 text-red-400" />
        <h1 className="text-2xl font-bold text-white">Challenge Not Found</h1>
        <p className="text-gray-400 text-center max-w-sm">{error ?? 'This challenge link is invalid or has expired.'}</p>
        <button onClick={() => navigate('/p2p')} className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl">
          Browse All Offers
        </button>
      </div>
    </Layout>
  );

  const matchStarted = !!(offer as any).matchDate && new Date((offer as any).matchDate).getTime() <= Date.now();
  const isExpired = matchStarted || new Date(offer.expiresAt) <= new Date();
  const isFilled = offer.status === 'filled' || offer.status === 'settled' || offer.status === 'cancelled';

  return (
    <Layout>
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4 py-12">
        {/* Share strip */}
        <div className="w-full max-w-lg mb-4 flex items-center justify-between bg-[#12121a] border border-[#2a2a3a] rounded-xl px-4 py-2">
          <span className="text-xs text-gray-500 truncate">{window.location.href}</span>
          <button onClick={handleCopyLink} className="ml-3 flex-shrink-0 flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Challenge card */}
        <div className="w-full max-w-lg bg-[#12121a] border border-[#2a2a3a] rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-cyan-900/40 to-violet-900/40 px-6 py-5 border-b border-[#2a2a3a]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">⚡ P2P Bet Challenge</span>
              {offer.suinsGated && (
                <span className="flex items-center gap-1 text-xs font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30 px-2 py-0.5 rounded-full">
                  <Star className="w-3 h-3" /> VIP .sui
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-white">{offer.eventName}</h1>
            <p className="text-sm text-gray-400 mt-0.5">{offer.homeTeam} vs {offer.awayTeam}</p>
          </div>

          <div className="px-6 py-6 space-y-4">
            {/* Bet details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#1a1a2e] rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1">Creator picks</p>
                <p className="text-sm font-bold text-white">{offer.prediction}</p>
              </div>
              <div className="bg-[#1a1a2e] rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1">Odds</p>
                <p className="text-lg font-bold text-cyan-400">{offer.odds.toFixed(2)}×</p>
              </div>
              <div className="bg-[#1a1a2e] rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1">Your stake</p>
                <p className="text-sm font-bold text-white">{offer.takerStake.toFixed(3)} {offer.currency}</p>
              </div>
              <div className="bg-[#1a1a2e] rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1">Your payout if you win</p>
                <p className="text-sm font-bold text-green-400">{(offer.takerStake + offer.creatorStake).toFixed(3)} {offer.currency}</p>
              </div>
            </div>


            {offer.suinsGated && (
              <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-3 flex items-start gap-3">
                <Star className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-violet-400">VIP Pool — .sui Name Required</p>
                  <p className="text-xs text-gray-400 mt-0.5">This offer is exclusive to wallets that own a SuiNS domain. <a href="https://suins.io" target="_blank" rel="noreferrer" className="text-violet-300 underline">Get yours at suins.io →</a></p>
                </div>
              </div>
            )}

            {/* Status / expiry */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock className="w-3.5 h-3.5" />
              <span>{isExpired ? 'Expired' : formatTimeLeft(offer.expiresAt)}</span>
              <span className="text-gray-700">·</span>
              <Shield className="w-3.5 h-3.5" />
              <span>Sui escrow · 2% platform fee</span>
            </div>

            {/* CTA */}
            {accepted ? (
              <div className="text-center py-4">
                <Trophy className="w-10 h-10 text-amber-400 mx-auto mb-2" />
                <p className="text-lg font-bold text-white">Challenge Accepted!</p>
                <p className="text-sm text-gray-400">Match {offer.eventName} — may the best bettor win.</p>
                <button onClick={() => navigate('/p2p')} className="mt-4 px-4 py-2 bg-[#1a1a2e] border border-[#2a2a3a] text-cyan-400 text-sm rounded-xl hover:bg-[#1e1e35]">
                  View All Offers →
                </button>
              </div>
            ) : isExpired || isFilled ? (
              <div className="text-center py-3">
                <p className="text-sm text-gray-400 mb-3">{isFilled ? 'This challenge has already been filled.' : 'This challenge has expired.'}</p>
                <button onClick={() => navigate('/p2p')} className="w-full py-3 bg-[#1a1a2e] border border-[#2a2a3a] text-cyan-400 font-bold rounded-xl hover:bg-[#1e1e35]">
                  Browse Open Offers
                </button>
              </div>
            ) : !myWallet ? (
              <div className="space-y-2">
                <button
                  onClick={() => initiateZkLogin?.()}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-white text-gray-900 font-bold text-sm rounded-xl hover:bg-gray-100 transition-colors shadow-lg"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Accept with Google (zkLogin)
                </button>
                <p className="text-center text-xs text-gray-600">No wallet needed · Google sign-in · Takes ~15 seconds</p>
                <div className="relative my-2 flex items-center">
                  <div className="flex-grow border-t border-[#2a2a3a]" />
                  <span className="px-2 text-xs text-gray-600">or</span>
                  <div className="flex-grow border-t border-[#2a2a3a]" />
                </div>
                <button
                  className="w-full flex items-center justify-center gap-2 py-3 bg-[#1a1a2e] border border-[#2a2a3a] text-cyan-400 font-bold text-sm rounded-xl hover:bg-[#1e1e35]"
                  onClick={() => document.querySelector<HTMLElement>('[data-connect-wallet]')?.click()}
                >
                  <LogIn className="w-4 h-4" />
                  Connect Sui Wallet
                </button>
              </div>
            ) : myWallet === offer.creatorWallet ? (
              <div className="py-3 text-center text-sm text-gray-500">This is your own offer — you can't accept it.</div>
            ) : (
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full py-4 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-bold text-base rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg"
              >
                {accepting ? <><Loader2 className="w-5 h-5 animate-spin" /> Accepting…</> : <><Zap className="w-5 h-5" /> Accept Challenge — Stake {offer.takerStake.toFixed(3)} {offer.currency}</>}
              </button>
            )}

            {/* Powered by Sui */}
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-600 pt-1">
              <ExternalLink className="w-3 h-3" />
              <span>Settled on Sui · sub-second finality · verifiable on-chain</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
