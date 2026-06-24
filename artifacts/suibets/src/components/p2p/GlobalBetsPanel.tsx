import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { useZkLogin } from '@/context/ZkLoginContext';
import { useToast } from '@/hooks/use-toast';
import { YourOpenBetsPanel } from '@/components/p2p/YourOpenBetsPanel';

const P2P_CLOCK_ID           = '0x0000000000000000000000000000000000000000000000000000000000000006';
const P2P_FALLBACK_PACKAGE_ID  = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const P2P_FALLBACK_REGISTRY_ID = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';

const SBETS_COIN_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const SUI_COIN_TYPE   = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

function resolveCoinType(currency: string | undefined | null): string {
  if (!currency) return SUI_COIN_TYPE;
  const u = currency.toUpperCase();
  if (u === 'SBETS') return SBETS_COIN_TYPE;
  if (u === 'SUI') return SUI_COIN_TYPE;
  if (currency.includes('::')) return currency;
  return SUI_COIN_TYPE;
}

function isGaslessCurrency(currency: string | undefined | null): boolean {
  return !!(currency && currency.toUpperCase() === 'SBETS');
}

export function GlobalBetsPanel() {
  const currentAccount = useCurrentAccount();
  const { isZkLoginActive, zkLoginAddress } = useZkLogin();
  const myWallet = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);

  const qc = useQueryClient();
  const { toast } = useToast();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();

  const { data: myActivity } = useQuery<{
    myOffers: any[];
    myMatches: any[];
    myParlayOffers: any[];
  }>({
    queryKey: ['/api/p2p/my', myWallet],
    queryFn: async () => {
      if (!myWallet) return { myOffers: [], myMatches: [], myParlayOffers: [] };
      const r = await fetch(`/api/p2p/my?wallet=${myWallet}`);
      if (!r.ok) return { myOffers: [], myMatches: [], myParlayOffers: [] };
      return r.json();
    },
    enabled: !!myWallet,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: contractInfo } = useQuery<{ packageId?: string; registryId?: string }>({
    queryKey: ['/api/p2p/onchain-book'],
    queryFn: async () => {
      const r = await fetch('/api/p2p/onchain-book');
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const packageId  = contractInfo?.packageId  || P2P_FALLBACK_PACKAGE_ID;
  const registryId = contractInfo?.registryId || P2P_FALLBACK_REGISTRY_ID;

  const cancelOfferMutation = useMutation({
    mutationFn: async ({ id: offerId, onchainOfferId, currency }: { id: number; onchainOfferId?: string; currency?: string }) => {
      if (!myWallet) throw new Error('Connect your wallet to cancel this offer');
      let cancelTxHash: string | undefined;
      if (onchainOfferId) {
        if (typeof signAndExecute !== 'function') throw new Error('Wallet not connected — please reconnect your Sui wallet');
        const tx = new Transaction();
        tx.setSender(myWallet);
        tx.setGasBudget(20_000_000);
        const coinTypeStr = resolveCoinType(currency);
        if (isGaslessCurrency(currency)) { tx.setGasPrice(0); tx.setGasBudget(0); }
        tx.moveCall({
          target: `${packageId}::p2p_betting::cancel_offer`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(onchainOfferId),
            tx.object(registryId),
            tx.object(P2P_CLOCK_ID),
          ],
        });
        const result = await signAndExecute({ transaction: tx });
        cancelTxHash = (result as any)?.digest;
        if (!cancelTxHash) throw new Error('On-chain cancel failed — no digest returned');
        const check = await (suiClient as any).waitForTransaction({ digest: cancelTxHash, options: { showEffects: true } });
        if (check?.effects?.status?.status !== 'success') {
          throw new Error(`Cancel failed on-chain: ${check?.effects?.status?.error ?? 'unknown error'}`);
        }
      }
      const res = await fetch(`/api/p2p/offers/${offerId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorWallet: myWallet, cancelTxHash }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Cancel failed' }));
        throw new Error(err.message || 'Failed to cancel offer');
      }
      return res.json().catch(() => ({ success: true }));
    },
    onSuccess: (_, vars) => {
      toast({
        title: 'Offer cancelled',
        description: vars.onchainOfferId
          ? 'Your stake was returned to your wallet on-chain.'
          : 'Your offer has been removed from the market.',
      });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
      qc.invalidateQueries({ queryKey: ['/api/p2p/offers', 'all'] });
    },
    onError: (e: Error) => {
      toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    },
  });

  const cancelParlayMutation = useMutation({
    mutationFn: async ({ id, onchainParlayId, currency }: { id: number; onchainParlayId?: string; currency?: string }) => {
      if (!myWallet) throw new Error('Connect your wallet to cancel this parlay');
      let cancelTxHash: string | undefined;
      if (onchainParlayId) {
        if (typeof signAndExecute !== 'function') throw new Error('Wallet not connected — please reconnect your Sui wallet');
        const tx = new Transaction();
        tx.setSender(myWallet);
        tx.setGasBudget(20_000_000);
        const coinTypeStr = resolveCoinType(currency);
        if (isGaslessCurrency(currency)) { tx.setGasPrice(0); tx.setGasBudget(0); }
        tx.moveCall({
          target: `${packageId}::p2p_betting::cancel_parlay`,
          typeArguments: [coinTypeStr],
          arguments: [
            tx.object(onchainParlayId),
            tx.object(registryId),
            tx.object(P2P_CLOCK_ID),
          ],
        });
        const result = await signAndExecute({ transaction: tx });
        cancelTxHash = (result as any)?.digest;
        if (!cancelTxHash) throw new Error('No digest returned');
        const check = await (suiClient as any).waitForTransaction({ digest: cancelTxHash, options: { showEffects: true } });
        if (check?.effects?.status?.status !== 'success') {
          throw new Error(`Parlay cancel failed: ${check?.effects?.status?.error ?? 'unknown'}`);
        }
      }
      const res = await fetch(`/api/p2p/parlays/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorWallet: myWallet, cancelTxHash }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Cancel failed' }));
        throw new Error(err.message || 'Failed to cancel parlay');
      }
      return res.json().catch(() => ({ success: true }));
    },
    onSuccess: () => {
      toast({ title: 'Parlay cancelled' });
      qc.invalidateQueries({ queryKey: ['/api/p2p/my', myWallet] });
    },
    onError: (e: Error) => {
      toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' });
    },
  });

  if (!myWallet) return null;

  const myOffers       = myActivity?.myOffers       ?? [];
  const myParlayOffers = myActivity?.myParlayOffers ?? [];

  return (
    <YourOpenBetsPanel
      myOffers={myOffers}
      myParlayOffers={myParlayOffers}
      onCancelOffer={cancelOfferMutation.mutate}
      onCancelParlay={cancelParlayMutation.mutate}
      cancellingOffer={cancelOfferMutation.isPending}
      cancellingParlay={cancelParlayMutation.isPending}
    />
  );
}
