import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { ExternalLink, Zap, Globe, ArrowRightLeft, Droplets, Shield, BarChart3 } from "lucide-react";

const SBETS_TOKEN = import.meta.env.VITE_SBETS_TOKEN_TYPE || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const CETUS_POOL_ID = "0xa809b51ec650e4ae45224107e62787be5e58f9caf8d3f74542f8edd73dc37a50";
const CETUS_SWAP_URL = `https://app.cetus.zone/swap?from=0x2::sui::SUI&to=${SBETS_TOKEN}`;
const CETUS_POOL_URL = `https://app.cetus.zone/clmm?tab=deposit&poolAddress=${CETUS_POOL_ID}`;
const CETUS_POOL_VIEW_URL = `https://app.cetus.zone/clmm?tab=my-position&poolAddress=${CETUS_POOL_ID}`;

export default function TradePage() {
  return (
    <Layout title="">
      <div className="max-w-5xl mx-auto space-y-6 py-4">

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img
              src="/logo/suibets-logo.jpg"
              alt="SuiBets"
              className="h-10 w-auto object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-2xl text-gray-400">&times;</span>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center">
                <Droplets className="h-5 w-5 text-cyan-400" />
              </div>
              <span className="text-2xl font-bold text-cyan-400">Cetus</span>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white" data-testid="text-trade-title">Trade SBETS on Cetus</h1>
          <p className="text-gray-400 max-w-xl mx-auto">
            Swap SBETS tokens and provide liquidity on Cetus — the leading concentrated liquidity DEX on Sui. Earn 25% of platform revenue by adding to the SBETS-SUI pool.
          </p>
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-400/30 rounded-full px-4 py-1 text-cyan-300 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Live on Cetus CLMM
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-[#0b1618] border border-cyan-500/30 rounded-2xl p-6 space-y-4 hover:border-cyan-400/60 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center">
                <ArrowRightLeft className="h-6 w-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Swap SBETS</h2>
                <p className="text-sm text-gray-400">Buy or sell SBETS on Cetus</p>
              </div>
            </div>
            <p className="text-gray-400 text-sm">
              Swap SUI for SBETS tokens to place bets and earn your share of platform revenue. All swaps settle instantly on-chain via Cetus concentrated liquidity pools.
            </p>
            <div className="bg-[#112225] rounded-xl p-3 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-gray-400">
                <span>Token</span>
                <span className="text-cyan-300">SBETS</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Network</span>
                <span className="text-cyan-300">Sui Mainnet</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>DEX</span>
                <span className="text-cyan-300">Cetus CLMM</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Contract</span>
                <span className="text-gray-500 text-[10px] truncate max-w-[160px]">{SBETS_TOKEN.slice(0, 10)}...{SBETS_TOKEN.slice(-8)}</span>
              </div>
            </div>
            <Button
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 transition-all shadow-[0_4px_20px_rgba(6,182,212,0.3)] hover:shadow-[0_4px_30px_rgba(6,182,212,0.5)]"
              onClick={() => window.open(CETUS_SWAP_URL, '_blank', 'noopener,noreferrer')}
              data-testid="button-swap-cetus"
            >
              <ArrowRightLeft className="h-5 w-5 mr-2" />
              Swap on Cetus
              <ExternalLink className="h-4 w-4 ml-2 opacity-70" />
            </Button>
          </div>

          <div className="bg-[#0b1618] border border-cyan-500/20 rounded-2xl p-6 space-y-4 hover:border-cyan-400/40 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center">
                <Droplets className="h-6 w-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Provide Liquidity</h2>
                <p className="text-sm text-gray-400">Earn 25% of platform revenue</p>
              </div>
            </div>
            <p className="text-gray-400 text-sm">
              Add SBETS-SUI liquidity to the Cetus pool and earn your proportional share of 25% of all platform revenue, plus trading fees from the pool.
            </p>
            <div className="bg-[#112225] rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-gray-300">
                <BarChart3 className="h-3.5 w-3.5 text-cyan-400" /> 25% platform revenue share for LP providers
              </div>
              <div className="flex items-center gap-2 text-gray-300">
                <Zap className="h-3.5 w-3.5 text-yellow-400" /> Concentrated liquidity for capital efficiency
              </div>
              <div className="flex items-center gap-2 text-gray-300">
                <Shield className="h-3.5 w-3.5 text-green-400" /> Claim rewards daily from the Revenue page
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 hover:border-cyan-400/70 font-bold py-3 transition-all"
              onClick={() => window.open(CETUS_POOL_URL, '_blank', 'noopener,noreferrer')}
              data-testid="button-add-liquidity-cetus"
            >
              <Droplets className="h-5 w-5 mr-2" />
              Add Liquidity on Cetus
              <ExternalLink className="h-4 w-4 ml-2 opacity-70" />
            </Button>
          </div>
        </div>

        <div className="bg-gradient-to-r from-cyan-900/40 via-cyan-800/20 to-cyan-900/40 border border-cyan-500/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-cyan-300 text-sm font-medium">Live on Cetus</span>
            </div>
            <h3 className="text-white font-bold text-xl">Ready to get started?</h3>
            <p className="text-gray-400 text-sm max-w-sm">
              Cetus opens in a new tab — connect your Sui wallet and swap or provide liquidity instantly.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Button
              size="lg"
              className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-8 shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)] transition-all"
              onClick={() => window.open(CETUS_SWAP_URL, '_blank', 'noopener,noreferrer')}
              data-testid="button-cta-swap"
            >
              <ArrowRightLeft className="h-5 w-5 mr-2" />
              Buy SBETS
              <ExternalLink className="h-4 w-4 ml-2 opacity-70" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-cyan-400/50 text-cyan-300 hover:bg-cyan-500/10 hover:border-cyan-400 font-bold px-8 transition-all"
              onClick={() => window.open(CETUS_POOL_URL, '_blank', 'noopener,noreferrer')}
              data-testid="button-cta-liquidity"
            >
              <Droplets className="h-5 w-5 mr-2" />
              Add Liquidity
              <ExternalLink className="h-4 w-4 ml-2 opacity-70" />
            </Button>
          </div>
        </div>

        <div className="bg-gradient-to-r from-cyan-900/20 via-[#0b1618] to-cyan-900/10 border border-cyan-500/20 rounded-2xl p-6">
          <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
            <Globe className="h-5 w-5 text-cyan-400" />
            About Cetus Protocol
          </h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-400">
            <div className="space-y-2">
              <p>
                <span className="text-cyan-300 font-semibold">Cetus</span> is the leading concentrated liquidity (CLMM) protocol on Sui, enabling capital-efficient swaps with minimal slippage.
              </p>
              <p>The SBETS-SUI pool on Cetus provides deep liquidity for instant token swaps, with competitive trading fees.</p>
            </div>
            <div className="space-y-2">
              <p>
                <span className="text-cyan-300 font-semibold">LP Revenue Share</span> — liquidity providers earn 25% of all SuiBets platform revenue proportional to their pool share, on top of standard Cetus trading fees.
              </p>
              <p>All positions are non-custodial and settled on-chain via the Sui blockchain.</p>
            </div>
          </div>

          <div className="mt-5 bg-cyan-900/20 border border-cyan-500/30 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span className="text-green-400 text-xs font-semibold uppercase tracking-wide">Live Pool — Cetus CLMM</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs font-mono">
              <div className="flex flex-col gap-1">
                <span className="text-gray-500">Pool Address</span>
                <span className="text-cyan-300 break-all">{CETUS_POOL_ID}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-gray-500">Pair</span>
                <span className="text-cyan-300">SBETS / SUI</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href={CETUS_POOL_VIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 underline underline-offset-2"
                data-testid="link-view-pool-cetus"
              >
                View Pool on Cetus <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-gray-600">&middot;</span>
              <a
                href={`https://suiscan.xyz/mainnet/object/${CETUS_POOL_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 underline underline-offset-2"
                data-testid="link-pool-suiscan"
              >
                Suiscan <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-gray-600">&middot;</span>
              <a
                href={`https://suivision.xyz/object/${CETUS_POOL_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 underline underline-offset-2"
                data-testid="link-pool-suivision"
              >
                SuiVision <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="https://www.cetus.zone"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 underline underline-offset-2"
              data-testid="link-cetus-website"
            >
              cetus.zone <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-gray-600">&middot;</span>
            <a
              href="https://x.com/CetusProtocol"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 underline underline-offset-2"
              data-testid="link-cetus-twitter"
            >
              @CetusProtocol <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

      </div>
    </Layout>
  );
}
