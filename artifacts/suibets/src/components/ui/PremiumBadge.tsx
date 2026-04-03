import { Crown, Shield } from "lucide-react";
import { useSuiClientQuery, useCurrentAccount } from '@/lib/dapp-kit-compat';

const SBETS_COIN_TYPE = import.meta.env.VITE_SBETS_TOKEN_TYPE || "0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS";
const PREMIUM_THRESHOLD = 1000;

function useSbetsBalance(): { balance: number; isLoading: boolean } {
  const account = useCurrentAccount();
  const { data, isLoading } = useSuiClientQuery('getBalance', {
    owner: account?.address || '',
    coinType: SBETS_COIN_TYPE,
  }, {
    enabled: !!account?.address,
    refetchInterval: 60000,
  });

  const balance = data ? Number(data.totalBalance) / 1e9 : 0;
  return { balance, isLoading };
}

export function PremiumBadge({ compact = false }: { compact?: boolean }) {
  const { balance, isLoading } = useSbetsBalance();

  if (isLoading || balance < PREMIUM_THRESHOLD) return null;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-500/40 text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full" data-testid="badge-premium-compact">
        <Crown size={10} />
        PRO
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/30 rounded-lg px-3 py-1.5" data-testid="badge-premium">
      <Crown size={14} className="text-yellow-400" />
      <span className="text-yellow-400 text-xs font-bold">SBETS Premium</span>
      <span className="text-yellow-500/60 text-[10px]">{Math.floor(balance).toLocaleString()} SBETS</span>
    </div>
  );
}

export function TokenGateCheck({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { balance, isLoading } = useSbetsBalance();

  if (isLoading) {
    return <div className="animate-pulse bg-gray-800/50 rounded-lg h-20" />;
  }

  if (balance < PREMIUM_THRESHOLD) {
    return (
      <>
        {fallback || (
          <div className="relative overflow-hidden rounded-xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-amber-500/5 p-6 text-center" data-testid="token-gate-locked">
            <div className="absolute inset-0 backdrop-blur-sm bg-black/40" />
            <div className="relative z-10">
              <Shield size={32} className="text-yellow-400 mx-auto mb-3" />
              <h3 className="text-white font-bold text-lg mb-1">Premium Content</h3>
              <p className="text-gray-400 text-sm mb-3">
                Hold {PREMIUM_THRESHOLD.toLocaleString()}+ SBETS to unlock
              </p>
              <div className="text-yellow-400/80 text-xs">
                Current: {Math.floor(balance).toLocaleString()} SBETS
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}

export { useSbetsBalance, PREMIUM_THRESHOLD, SBETS_COIN_TYPE };
