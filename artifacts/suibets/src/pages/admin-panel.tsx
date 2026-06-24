import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Lock, RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2, Shield, Wallet, Coins, TrendingUp, DollarSign, Flame, Settings, GitMerge, Ban, Play, ExternalLink, ChevronDown, ChevronUp, Filter, Zap } from 'lucide-react';
import Layout from '@/components/layout/Layout';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@/lib/dapp-kit-compat';
import { Transaction } from '@mysten/sui/transactions';
import { ConnectButton } from '@/lib/dapp-kit-compat';

const BETTING_PACKAGE_ID = (import.meta.env.VITE_BETTING_PACKAGE_ID || '').trim();
const BETTING_PLATFORM_ID = (import.meta.env.VITE_BETTING_PLATFORM_ID || '').trim();
const ADMIN_CAP_ID = import.meta.env.VITE_ADMIN_CAP_ID || '0xe1e5fd1e5077a78bb3a8fd28bf096f32b0e031213974239ebee1dd80afcfae61';
const CLOCK_OBJECT_ID = '0x6';
const SBETS_TOKEN_TYPE = import.meta.env.VITE_SBETS_TOKEN_TYPE || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const USDSUI_COIN_TYPE = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
const USDSUI_DECIMALS = 1_000_000; // 6 decimals

const ADMIN_WALLET = import.meta.env.VITE_ADMIN_WALLET_ADDRESS || '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';

interface Bet {
  id: string;
  dbId: number;
  userId: number;
  walletAddress: string;
  eventId: string;
  eventName: string;
  selection: string;
  odds: number;
  stake: number;
  potentialWin: number;
  status: string;
  placedAt: string;
  settledAt?: string;
  txHash?: string;
  currency: string;
  betType: string;
  platformFee?: number;
  networkFee?: number;
}

interface Stats {
  total: number;
  pending: number;
  won: number;
  lost: number;
  void: number;
  totalStake: number;
  totalPotentialWin: number;
}

interface PlatformInfo {
  treasurySui: number;
  treasurySbets: number;
  treasuryUsdsui: number;
  totalVolumeSui: number;
  totalVolumeSbets: number;
  totalVolumeUsdsui?: number;
  totalPotentialLiabilitySui: number;
  totalPotentialLiabilitySbets: number;
  realLiabilitySui: number;
  realLiabilitySbets: number;
  realLiabilityUsdsui?: number;
  accruedFeesSui: number;
  accruedFeesSbets: number;
  accruedFeesUsdsui?: number;
  platformFeeBps: number;
  totalBets: number;
  paused: boolean;
  minBetSui: number;
  maxBetSui: number;
  minBetSbets: number;
  maxBetSbets: number;
}

export default function AdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [bets, setBets] = useState<Bet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const { toast } = useToast();
  
  // Wallet and blockchain state
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [depositAmount, setDepositAmount] = useState('1');
  const [depositingSui, setDepositingSui] = useState(false);
  const [depositingSbets, setDepositingSbets] = useState(false);
  const [depositingUsdsui, setDepositingUsdsui] = useState(false);
  const [depositAmountUsdsui, setDepositAmountUsdsui] = useState('10');
  const [loadingPlatform, setLoadingPlatform] = useState(false);
  const [userSuiBalance, setUserSuiBalance] = useState(0);
  const [userSbetsBalance, setUserSbetsBalance] = useState(0);
  const [userUsdsuiBalance, setUserUsdsuiBalance] = useState(0);
  const [newMinBetSui, setNewMinBetSui] = useState('0.02');
  const [newMaxBetSui, setNewMaxBetSui] = useState('15');
  const [newMinBetSbets, setNewMinBetSbets] = useState('100');
  const [newMaxBetSbets, setNewMaxBetSbets] = useState('250000');
  const [updatingLimitsSui, setUpdatingLimitsSui] = useState(false);
  const [updatingLimitsSbets, setUpdatingLimitsSbets] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [triggeringSettlement, setTriggeringSettlement] = useState(false);
  const [withdrawingSuiFees, setWithdrawingSuiFees] = useState(false);
  const [withdrawingSbetsFees, setWithdrawingSbetsFees] = useState(false);
  const [legacyBets, setLegacyBets] = useState<any[]>([]);
  const [loadingLegacy, setLoadingLegacy] = useState(false);
  const [suiBettingPaused, setSuiBettingPaused] = useState<boolean | null>(null);
  const [togglingSuiPause, setTogglingSuiPause] = useState(false);
  const [triggeringTreasuryWithdraw, setTriggeringTreasuryWithdraw] = useState(false);
  const [revenueController, setRevenueController] = useState<any>(null);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [voidingPhantom, setVoidingPhantom] = useState(false);
  const [voidResult, setVoidResult] = useState<any>(null);
  const [resettingLiability, setResettingLiability] = useState(false);
  const [resetLiabilityResult, setResetLiabilityResult] = useState<any>(null);
  const [exposureData, setExposureData] = useState<any>(null);
  const [loadingExposure, setLoadingExposure] = useState(false);
  const [settingCap, setSettingCap] = useState(false);
  const [capInputs, setCapInputs] = useState<Record<string, string>>({});
  const [payingUnpaidWinners, setPayingUnpaidWinners] = useState(false);
  const [allPredictions, setAllPredictions] = useState<any[]>([]);
  const [allChallenges, setAllChallenges] = useState<any[]>([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [loadingChallenges, setLoadingChallenges] = useState(false);
  const [resolvingPrediction, setResolvingPrediction] = useState<number | null>(null);
  const [cancellingPrediction, setCancellingPrediction] = useState<number | null>(null);
  const [predictionFilter, setPredictionFilter] = useState<string>('all');
  const [predictionSearch, setPredictionSearch] = useState('');
  const [seedingPredictions, setSeedingPredictions] = useState(false);
  const [predictionExpanded, setPredictionExpanded] = useState<number | null>(null);
  const [settleEventId, setSettleEventId] = useState('');
  const [settleWinnerName, setSettleWinnerName] = useState('');
  const [settlingEvent, setSettlingEvent] = useState(false);
  const [settleEventResult, setSettleEventResult] = useState<any>(null);
  const [unsettledBets, setUnsettledBets] = useState<any>(null);
  const [loadingUnsettled, setLoadingUnsettled] = useState(false);
  const [unsettledFilter, setUnsettledFilter] = useState('all');
  const [liabilityCheck, setLiabilityCheck] = useState<any>(null);
  const [loadingLiability, setLoadingLiability] = useState(false);
  const [voidingStaleBets, setVoidingStaleBets] = useState(false);
  const [staleBetVoidResult, setStaleBetVoidResult] = useState<any>(null);
  const [staleBetHours, setStaleBetHours] = useState('48');
  const [settlingBetId, setSettlingBetId] = useState<string | null>(null);

  // P2P Vault state
  const [p2pVault, setP2pVault] = useState<{ sui: number; sbets: number; usdsui: number; usdc: number; lbtc: number } | null>(null);
  const [loadingP2PVault, setLoadingP2PVault] = useState(false);
  const [p2pVaultFetchedAt, setP2pVaultFetchedAt] = useState<number | null>(null);
  const [withdrawingVaultCoin, setWithdrawingVaultCoin] = useState<string | null>(null);
  const [vaultWithdrawAmounts, setVaultWithdrawAmounts] = useState<Record<string, string>>({ SUI: '', SBETS: '', USDSUI: '', USDC: '', LBTC: '' });

  // P2P Admin state
  const [p2pOffers, setP2pOffers] = useState<any[]>([]);
  const [p2pParlays, setP2pParlays] = useState<any[]>([]);
  const [p2pRevenueStats, setP2pRevenueStats] = useState<any>(null);
  const [loadingP2POffers, setLoadingP2POffers] = useState(false);
  const [loadingP2PParlays, setLoadingP2PParlays] = useState(false);
  const [loadingP2PRevenue, setLoadingP2PRevenue] = useState(false);
  const [p2pOfferStatusFilter, setP2pOfferStatusFilter] = useState('all');
  const [p2pParlayStatusFilter, setP2pParlayStatusFilter] = useState('all');
  const [voidingP2PId, setVoidingP2PId] = useState<string | null>(null);
  const [forceExpiringId, setForceExpiringId] = useState<number | null>(null);
  const [settlingP2P, setSettlingP2P] = useState(false);
  const [p2pExpandedOffer, setP2pExpandedOffer] = useState<number | null>(null);
  const [p2pExpandedParlay, setP2pExpandedParlay] = useState<number | null>(null);
  const [p2pVoidReason, setP2pVoidReason] = useState('');
  const [p2pTotalOffers, setP2pTotalOffers] = useState(0);
  const [p2pTotalParlays, setP2pTotalParlays] = useState(0);

  // PULSE Pools admin state
  const [pulsePools, setPulsePools] = useState<any[]>([]);
  const [loadingPulsePools, setLoadingPulsePools] = useState(false);
  const [pulsePoolsError, setPulsePoolsError] = useState('');
  const [pulseActionId, setPulseActionId] = useState<string | null>(null);
  const [pulseOracleKey, setPulseOracleKey] = useState('');
  const [pulseSettleWinner, setPulseSettleWinner] = useState<Record<string, 0 | 1>>({});

  const isAdminWallet = currentAccount?.address?.toLowerCase() === ADMIN_WALLET.toLowerCase();

  // Debug logging
  console.log('[AdminPanel] Render state:', {
    walletConnected: !!currentAccount?.address,
    walletAddress: currentAccount?.address?.slice(0, 10),
    isAdminWallet,
    platformInfoLoaded: !!platformInfo,
    loadingPlatform
  });

  // Fetch platform info from blockchain
  const fetchPlatformInfo = useCallback(async () => {
    setLoadingPlatform(true);
    let success = false;
    const token = getToken();
    const authHeaders: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

    try {
      const treasuryRes = await fetch('/api/treasury/status', {
        headers: authHeaders
      });
      if (treasuryRes.ok) {
        const data = await treasuryRes.json();
        if (data.success && data.fullPlatformInfo) {
          setPlatformInfo(data.fullPlatformInfo);
          success = true;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch platform info from backend API');
    }

    if (!success && BETTING_PLATFORM_ID) {
      try {
        const platformObject = await suiClient.getObject({
          id: BETTING_PLATFORM_ID,
          options: { showContent: true }
        });

        let realLiabilitySui = -1;
        let realLiabilitySbets = -1;
        try {
          const liabilityRes = await fetch('/api/treasury/status', { headers: authHeaders });
          if (liabilityRes.ok) {
            const liabilityData = await liabilityRes.json();
            realLiabilitySui = liabilityData.sui?.liability ?? -1;
            realLiabilitySbets = liabilityData.sbets?.liability ?? -1;
          }
        } catch (e) {}

        if (platformObject.data?.content && 'fields' in platformObject.data.content) {
          const fields = platformObject.data.content.fields as Record<string, unknown>;
          const extractBalance = (field: unknown): number => {
            if (field && typeof field === 'object' && 'fields' in (field as Record<string, unknown>)) {
              return Number((field as Record<string, Record<string, unknown>>).fields?.value || 0);
            }
            return Number(field || 0);
          };
          let treasuryUsdsui = extractBalance(fields.treasury_usdsui) / USDSUI_DECIMALS;
          if (treasuryUsdsui === 0) {
            try {
              const adminWallet = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';
              const usdsuiBalanceRes = await suiClient.getBalance({
                owner: adminWallet,
                coinType: USDSUI_COIN_TYPE,
              });
              treasuryUsdsui = Number(usdsuiBalanceRes.totalBalance) / USDSUI_DECIMALS;
            } catch (e) {
              console.warn('Failed to fetch admin wallet USDsui balance');
            }
          }

          setPlatformInfo({
            treasurySui: extractBalance(fields.treasury_sui) / 1_000_000_000,
            treasurySbets: extractBalance(fields.treasury_sbets) / 1_000_000_000,
            treasuryUsdsui,
            totalVolumeSui: Number(fields.total_volume_sui || 0) / 1_000_000_000,
            totalVolumeSbets: Number(fields.total_volume_sbets || 0) / 1_000_000_000,
            totalVolumeUsdsui: Number(fields.total_volume_usdsui || 0) / USDSUI_DECIMALS,
            totalPotentialLiabilitySui: Number(fields.total_potential_liability_sui || 0) / 1_000_000_000,
            totalPotentialLiabilitySbets: Number(fields.total_potential_liability_sbets || 0) / 1_000_000_000,
            realLiabilitySui,
            realLiabilitySbets,
            accruedFeesSui: Number(fields.accrued_fees_sui || 0) / 1_000_000_000,
            accruedFeesSbets: Number(fields.accrued_fees_sbets || 0) / 1_000_000_000,
            accruedFeesUsdsui: Number(fields.accrued_fees_usdsui || 0) / USDSUI_DECIMALS,
            platformFeeBps: Number(fields.platform_fee_bps || 0),
            totalBets: Number(fields.total_bets || 0),
            paused: Boolean(fields.paused),
            minBetSui: Number(fields.min_bet_sui || fields.min_bet || 0) / 1_000_000_000,
            maxBetSui: Number(fields.max_bet_sui || fields.max_bet || 0) / 1_000_000_000,
            minBetSbets: Number(fields.min_bet_sbets || fields.min_bet || 0) / 1_000_000_000,
            maxBetSbets: Number(fields.max_bet_sbets || fields.max_bet || 0) / 1_000_000_000,
          });
          success = true;
        }
      } catch (error) {
        console.error('RPC fallback also failed:', error);
      }
    }

    if (!success) {
      toast({ title: 'Error', description: 'Failed to fetch platform info', variant: 'destructive' });
    }

    setLoadingPlatform(false);
  }, [suiClient, toast]);

  // Fetch user balances
  const fetchUserBalances = useCallback(async () => {
    if (!currentAccount?.address) return;
    
    try {
      // Get SUI balance
      const suiBalance = await suiClient.getBalance({
        owner: currentAccount.address,
        coinType: '0x2::sui::SUI'
      });
      setUserSuiBalance(Number(suiBalance.totalBalance) / 1_000_000_000);

      // Get SBETS balance
      const sbetsBalance = await suiClient.getBalance({
        owner: currentAccount.address,
        coinType: SBETS_TOKEN_TYPE
      });
      setUserSbetsBalance(Number(sbetsBalance.totalBalance) / 1_000_000_000);

      // Get USDsui balance
      try {
        const usdsuiBalance = await suiClient.getBalance({
          owner: currentAccount.address,
          coinType: USDSUI_COIN_TYPE
        });
        setUserUsdsuiBalance(Number(usdsuiBalance.totalBalance) / USDSUI_DECIMALS);
      } catch {
        setUserUsdsuiBalance(0);
      }
    } catch (error) {
      console.error('Failed to fetch user balances:', error);
    }
  }, [currentAccount?.address, suiClient]);

  // Deposit SUI liquidity
  const depositSuiLiquidity = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Error', description: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (amount > userSuiBalance - 0.01) {
      toast({ title: 'Error', description: 'Insufficient SUI balance (need gas)', variant: 'destructive' });
      return;
    }

    setDepositingSui(true);
    try {
      const amountMist = Math.floor(amount * 1_000_000_000);
      
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [amountMist]);
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          coin,
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: 'Deposit Successful', 
          description: `Deposited ${amount} SUI to treasury. TX: ${result.digest.slice(0, 10)}...` 
        });
        // Refresh data
        await fetchPlatformInfo();
        await fetchUserBalances();
      }
    } catch (error: unknown) {
      console.error('Deposit failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Deposit Failed', description: errorMessage, variant: 'destructive' });
    }
    setDepositingSui(false);
  };

  // Deposit SBETS liquidity
  const depositSbetsLiquidity = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Error', description: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (amount > userSbetsBalance) {
      toast({ title: 'Error', description: 'Insufficient SBETS balance', variant: 'destructive' });
      return;
    }

    setDepositingSbets(true);
    try {
      const amountMist = Math.floor(amount * 1_000_000_000);
      
      // Get SBETS coins
      const coins = await suiClient.getCoins({
        owner: currentAccount.address,
        coinType: SBETS_TOKEN_TYPE,
      });

      if (coins.data.length === 0) {
        throw new Error('No SBETS coins found');
      }

      const tx = new Transaction();
      
      // If we need to merge coins
      if (coins.data.length > 1) {
        const primaryCoin = coins.data[0];
        const otherCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(tx.object(primaryCoin.coinObjectId), otherCoins);
        const [sbetsCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [amountMist]);
        
        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity_sbets`,
          arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(BETTING_PLATFORM_ID),
            sbetsCoin,
            tx.object(CLOCK_OBJECT_ID),
          ],
        });
      } else {
        const [sbetsCoin] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [amountMist]);
        
        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity_sbets`,
          arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(BETTING_PLATFORM_ID),
            sbetsCoin,
            tx.object(CLOCK_OBJECT_ID),
          ],
        });
      }

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: 'Deposit Successful', 
          description: `Deposited ${amount} SBETS to treasury. TX: ${result.digest.slice(0, 10)}...` 
        });
        await fetchPlatformInfo();
        await fetchUserBalances();
      }
    } catch (error: unknown) {
      console.error('SBETS deposit failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Deposit Failed', description: errorMessage, variant: 'destructive' });
    }
    setDepositingSbets(false);
  };

  // Deposit USDsui liquidity
  const depositUsdsuiLiquidity = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(depositAmountUsdsui);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Error', description: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (amount > userUsdsuiBalance) {
      toast({ title: 'Error', description: 'Insufficient USDsui balance', variant: 'destructive' });
      return;
    }

    setDepositingUsdsui(true);
    try {
      const amountUnits = Math.floor(amount * USDSUI_DECIMALS);

      const coins = await suiClient.getCoins({
        owner: currentAccount.address,
        coinType: USDSUI_COIN_TYPE,
      });

      if (coins.data.length === 0) {
        throw new Error('No USDsui coins found in wallet');
      }

      const tx = new Transaction();

      let usdsuiCoin;
      if (coins.data.length > 1) {
        const primaryCoin = coins.data[0];
        const otherCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(tx.object(primaryCoin.coinObjectId), otherCoins);
        [usdsuiCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [amountUnits]);
      } else {
        [usdsuiCoin] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [amountUnits]);
      }

      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity_usdsui`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          usdsuiCoin,
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({
          title: 'Deposit Successful',
          description: `Deposited ${amount} USDsui to treasury. TX: ${result.digest.slice(0, 10)}...`
        });
        await fetchPlatformInfo();
        await fetchUserBalances();
      }
    } catch (error: unknown) {
      console.error('USDsui deposit failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Deposit Failed', description: errorMessage, variant: 'destructive' });
    }
    setDepositingUsdsui(false);
  };

  // Update SUI bet limits
  const updateBetLimitsSui = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const minBet = parseFloat(newMinBetSui);
    const maxBet = parseFloat(newMaxBetSui);
    
    if (isNaN(minBet) || minBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid minimum bet', variant: 'destructive' });
      return;
    }
    
    if (isNaN(maxBet) || maxBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid maximum bet', variant: 'destructive' });
      return;
    }
    
    if (minBet >= maxBet) {
      toast({ title: 'Error', description: 'Minimum bet must be less than maximum', variant: 'destructive' });
      return;
    }

    setUpdatingLimitsSui(true);
    try {
      const minBetMist = Math.floor(minBet * 1_000_000_000);
      const maxBetMist = Math.floor(maxBet * 1_000_000_000);
      
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::update_limits_sui`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.u64(minBetMist),
          tx.pure.u64(maxBetMist),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: 'SUI Limits Updated', 
          description: `Min: ${minBet} SUI, Max: ${maxBet} SUI. TX: ${result.digest.slice(0, 10)}...` 
        });
        await fetchPlatformInfo();
      }
    } catch (error: unknown) {
      console.error('Update SUI limits failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Update Failed', description: errorMessage, variant: 'destructive' });
    }
    setUpdatingLimitsSui(false);
  };

  // Update SBETS bet limits
  const updateBetLimitsSbets = async () => {
    const minBet = parseFloat(newMinBetSbets);
    const maxBet = parseFloat(newMaxBetSbets);
    
    if (isNaN(minBet) || minBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid minimum bet', variant: 'destructive' });
      return;
    }
    
    if (isNaN(maxBet) || maxBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid maximum bet', variant: 'destructive' });
      return;
    }
    
    if (minBet >= maxBet) {
      toast({ title: 'Error', description: 'Minimum bet must be less than maximum', variant: 'destructive' });
      return;
    }

    setUpdatingLimitsSbets(true);
    let backendUpdated = false;

    // ── Step 1: Always update backend limit via API (reliable, no wallet needed) ──
    try {
      const res = await fetch('/api/admin/update-stake-limits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ maxStakeSbets: maxBet }),
      });
      if (res.ok) {
        backendUpdated = true;
        console.log('[Admin] Backend stake limit updated to', maxBet);
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('[Admin] Backend limit update failed:', err.message);
      }
    } catch (err) {
      console.warn('[Admin] Backend limit update error:', err);
    }

    // ── Step 2: Try to also update on-chain limits (optional, requires wallet) ──
    if (currentAccount?.address && isAdminWallet) {
      try {
        const minBetMist = Math.floor(minBet * 1_000_000_000);
        const maxBetMist = Math.floor(maxBet * 1_000_000_000);
        
        const tx = new Transaction();
        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::update_limits_sbets`,
          arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(BETTING_PLATFORM_ID),
            tx.pure.u64(minBetMist),
            tx.pure.u64(maxBetMist),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        if (result.digest) {
          await suiClient.waitForTransaction({ digest: result.digest });
          console.log('[Admin] On-chain limits updated. TX:', result.digest);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'On-chain update failed';
        console.warn('[Admin] On-chain limit update failed (backend still updated):', msg);
      }
    }

    if (backendUpdated) {
      toast({ 
        title: 'SBETS Limits Updated', 
        description: `Max bet set to ${maxBet.toLocaleString()} SBETS. Active immediately.`,
      });
      await fetchPlatformInfo();
    } else {
      toast({ title: 'Update Failed', description: 'Could not update limits. Check admin login.', variant: 'destructive' });
    }

    setUpdatingLimitsSbets(false);
  };

  // Toggle platform pause
  const togglePlatformPause = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const newPausedState = !platformInfo?.paused;
    
    if (!confirm(`Are you sure you want to ${newPausedState ? 'PAUSE' : 'UNPAUSE'} the platform?`)) {
      return;
    }

    setTogglingPause(true);
    try {
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::set_pause`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.bool(newPausedState),
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: newPausedState ? 'Platform Paused' : 'Platform Unpaused', 
          description: `TX: ${result.digest.slice(0, 10)}...` 
        });
        await fetchPlatformInfo();
      }
    } catch (error: unknown) {
      console.error('Toggle pause failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Toggle Failed', description: errorMessage, variant: 'destructive' });
    }
    setTogglingPause(false);
  };

  const triggerAutoSettlement = async () => {
    if (!confirm('Trigger auto-settlement now?')) return;

    setTriggeringSettlement(true);
    try {
      const token = getToken();
      const response = await fetch('/api/admin/trigger-settlement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({})
      });

      if (response.ok) {
        const result = await response.json();
        toast({ 
          title: 'Settlement Triggered', 
          description: result.message || 'Check server logs for results'
        });
        // Refresh bets after a delay to show updates
        setTimeout(() => fetchBets(), 3000);
      } else {
        const error = await response.json();
        toast({ title: 'Settlement Failed', description: error.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to trigger settlement', variant: 'destructive' });
    }
    setTriggeringSettlement(false);
  };

  // Withdraw SUI fees from contract
  const withdrawSuiFees = async () => {
    if (!platformInfo || platformInfo.accruedFeesSui <= 0) {
      toast({ title: 'No Fees', description: 'No SUI fees available to withdraw', variant: 'destructive' });
      return;
    }

    const amount = platformInfo.accruedFeesSui;
    
    if (!confirm(`Withdraw ${amount.toFixed(4)} SUI fees?`)) return;

    setWithdrawingSuiFees(true);
    try {
      const token = getToken();
      const response = await fetch('/api/admin/withdraw-fees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount })
      });

      if (response.ok) {
        const result = await response.json();
        toast({ 
          title: 'SUI Fees Withdrawn', 
          description: `${amount.toFixed(4)} SUI sent. TX: ${result.txHash?.slice(0, 10)}...`
        });
        await fetchPlatformInfo();
      } else {
        const error = await response.json();
        toast({ title: 'Withdrawal Failed', description: error.message || error.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to withdraw SUI fees', variant: 'destructive' });
    }
    setWithdrawingSuiFees(false);
  };

  // Withdraw SBETS fees from contract
  const withdrawSbetsFees = async () => {
    if (!platformInfo || platformInfo.accruedFeesSbets <= 0) {
      toast({ title: 'No Fees', description: 'No SBETS fees available to withdraw', variant: 'destructive' });
      return;
    }

    const amount = platformInfo.accruedFeesSbets;
    
    if (!confirm(`Withdraw ${amount.toFixed(4)} SBETS fees?`)) return;

    setWithdrawingSbetsFees(true);
    try {
      const token = getToken();
      const response = await fetch('/api/admin/withdraw-fees-sbets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount })
      });

      if (response.ok) {
        const result = await response.json();
        toast({ 
          title: 'SBETS Fees Withdrawn', 
          description: `${amount.toFixed(4)} SBETS sent. TX: ${result.txHash?.slice(0, 10)}...`
        });
        await fetchPlatformInfo();
      } else {
        const error = await response.json();
        toast({ title: 'Withdrawal Failed', description: error.message || error.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to withdraw SBETS fees', variant: 'destructive' });
    }
    setWithdrawingSbetsFees(false);
  };

  const fetchP2PVault = useCallback(async () => {
    setLoadingP2PVault(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/p2p-vault', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setP2pVault(data.vault);
        setP2pVaultFetchedAt(data.fetchedAt);
        setVaultWithdrawAmounts(prev => ({
          SUI:    data.vault.sui    > 0 ? data.vault.sui.toFixed(6)    : (prev.SUI    || ''),
          SBETS:  data.vault.sbets  > 0 ? data.vault.sbets.toFixed(4)  : (prev.SBETS  || ''),
          USDSUI: data.vault.usdsui > 0 ? data.vault.usdsui.toFixed(4) : (prev.USDSUI || ''),
          USDC:   data.vault.usdc   > 0 ? data.vault.usdc.toFixed(4)   : (prev.USDC   || ''),
          LBTC:   (data.vault.lbtc ?? 0) > 0 ? (data.vault.lbtc ?? 0).toFixed(8) : (prev.LBTC  || ''),
        }));
      }
    } catch {
    }
    setLoadingP2PVault(false);
  }, []);

  const withdrawFromP2PVault = async (coinType: 'SUI' | 'SBETS' | 'USDSUI' | 'USDC' | 'LBTC') => {
    const rawAmount = vaultWithdrawAmounts[coinType];
    const amount = parseFloat(rawAmount);
    if (!amount || amount <= 0) {
      toast({ title: 'Invalid Amount', description: `Enter a positive amount for ${coinType}`, variant: 'destructive' });
      return;
    }
    if (!confirm(`Withdraw ${amount} ${coinType} from P2P vault to admin wallet?`)) return;

    setWithdrawingVaultCoin(coinType);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/p2p-vault/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ coinType, amount }),
      });
      if (res.ok) {
        const data = await res.json();
        toast({
          title: `${coinType} Withdrawn`,
          description: `${amount} ${coinType} sent. TX: ${data.txHash?.slice(0, 16)}...`,
        });
        await fetchP2PVault();
      } else {
        const err = await res.json();
        toast({ title: 'Withdrawal Failed', description: err.message, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: `Failed to withdraw ${coinType}`, variant: 'destructive' });
    }
    setWithdrawingVaultCoin(null);
  };

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      if (response.ok) {
        const data = await response.json();
        setAuthToken(data.token);
        setIsAuthenticated(true);
        sessionStorage.setItem('adminToken', data.token);
        setPassword('');
        toast({ title: 'Login successful', description: 'Welcome to the admin panel' });
      } else {
        toast({ title: 'Login failed', description: 'Invalid password', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Login failed', variant: 'destructive' });
    }
  };

  const getToken = () => authToken || sessionStorage.getItem('adminToken') || '';

  // ─── PULSE Pools helpers ─────────────────────────────────────────────────────
  const fetchPulsePools = useCallback(async () => {
    setLoadingPulsePools(true);
    setPulsePoolsError('');
    try {
      const res = await fetch('/api/pulse/pools');
      const data = await res.json();
      if (data.ok) {
        setPulsePools(data.pools ?? []);
      } else {
        setPulsePoolsError(data.error || 'Failed to fetch pools');
      }
    } catch {
      setPulsePoolsError('Network error — is the API server running?');
    } finally {
      setLoadingPulsePools(false);
    }
  }, []);

  const pulsePoolAction = async (poolObjectId: string, action: 'lock' | 'settle' | 'void', winner?: 0 | 1) => {
    const key = pulseOracleKey.trim();
    if (!key) {
      toast({ title: 'Oracle key required', description: 'Enter your oracle key above before executing pool actions', variant: 'destructive' });
      return;
    }
    const actionKey = `${action}-${poolObjectId}`;
    setPulseActionId(actionKey);
    try {
      const body: any = { poolObjectId };
      if (action === 'settle') body.winner = winner;
      const res = await fetch(`/api/pulse/pool/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: `Pool ${action}d ✓`, description: `TX: ${data.result?.digest?.slice(0, 20) ?? 'submitted'}...` });
        await fetchPulsePools();
      } else {
        toast({ title: `${action} failed`, description: data.error || 'Unknown error', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach API server', variant: 'destructive' });
    } finally {
      setPulseActionId(null);
    }
  };

  // ─── P2P Admin helpers ──────────────────────────────────────────────────────
  const fetchP2PRevenue = async () => {
    setLoadingP2PRevenue(true);
    try {
      const res = await fetch('/api/p2p/revenue-stats');
      if (res.ok) setP2pRevenueStats(await res.json());
    } catch { /* ignore */ } finally { setLoadingP2PRevenue(false); }
    fetchRevenueController();
  };

  const fetchP2POffers = async (statusFilter = p2pOfferStatusFilter) => {
    setLoadingP2POffers(true);
    try {
      const params = new URLSearchParams({ status: statusFilter, limit: '50' });
      const res = await fetch(`/api/p2p/admin/offers?${params}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setP2pOffers(data.offers ?? []);
        setP2pTotalOffers(data.total ?? 0);
      }
    } catch { /* ignore */ } finally { setLoadingP2POffers(false); }
  };

  const fetchP2PParlays = async (statusFilter = p2pParlayStatusFilter) => {
    setLoadingP2PParlays(true);
    try {
      const params = new URLSearchParams({ status: statusFilter, limit: '50' });
      const res = await fetch(`/api/p2p/admin/parlays?${params}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setP2pParlays(data.parlays ?? []);
        setP2pTotalParlays(data.total ?? 0);
      }
    } catch { /* ignore */ } finally { setLoadingP2PParlays(false); }
  };

  const voidP2POffer = async (betId: string, isParlay = false) => {
    const key = `${isParlay ? 'p' : 'b'}-${betId}`;
    setVoidingP2PId(key);
    try {
      const body: any = isParlay ? { parlayId: betId } : { betId };
      if (p2pVoidReason) body.reason = p2pVoidReason;
      const res = await fetch('/api/p2p/void-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: data.onchain ? 'Voided on-chain ✓' : 'Void recorded',
          description: data.message ?? `${isParlay ? 'Parlay' : 'Bet'} refunded`,
        });
        await fetchP2POffers();
        await fetchP2PParlays();
      } else {
        toast({ title: 'Void failed', description: data.message, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setVoidingP2PId(null); }
  };

  const forceExpireOffer = async (offerId: number) => {
    setForceExpiringId(offerId);
    try {
      const res = await fetch(`/api/p2p/admin/force-expire/${offerId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: 'Force-expired ✓',
          description: `Offer #${offerId} refunded on-chain. TX: ${data.txHash?.slice(0, 16)}…`,
        });
        await fetchP2POffers();
      } else {
        toast({
          title: res.status === 409 ? 'Not expired yet' : 'Force-expire failed',
          description: data.message,
          variant: 'destructive',
        });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setForceExpiringId(null); }
  };

  const triggerP2PSettle = async () => {
    setSettlingP2P(true);
    try {
      const res = await fetch('/api/p2p/settle', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: 'P2P Settlement run', description: data.message });
        await fetchP2POffers();
        await fetchP2PParlays();
        await fetchP2PRevenue();
      } else {
        toast({ title: 'Settlement failed', description: data.message, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setSettlingP2P(false); }
  };

  const statusBadgeClass = (status: string) => {
    const map: Record<string, string> = {
      open: 'bg-green-500/20 text-green-400 border-green-500/30',
      partial: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      filled: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      settled: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
      cancelled: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      expired: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      voided: 'bg-red-500/20 text-red-400 border-red-500/30',
      disputed: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      settling: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    };
    return `text-xs px-2 py-0.5 rounded-full border font-medium ${map[status] ?? 'bg-gray-600/20 text-gray-400 border-gray-600/30'}`;
  };

  const fetchBets = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/all-bets?status=${filter}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setBets(data.bets || []);
        setStats(data.stats || null);
      } else if (response.status === 401) {
        setIsAuthenticated(false);
        sessionStorage.removeItem('adminToken');
        setAuthToken('');
      }
    } catch (error) {
      console.error('Failed to fetch bets:', error);
    }
    setLoading(false);
  };

  // Fetch legacy bets without betObjectId (stuck liability)
  const fetchLegacyBets = async () => {
    setLoadingLegacy(true);
    try {
      const response = await fetch('/api/admin/legacy-bets', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setLegacyBets(data.legacyBets || []);
      }
    } catch (error) {
      console.error('Failed to fetch legacy bets:', error);
    }
    setLoadingLegacy(false);
  };

  const pollRetryCountRef = useRef(0);

  const pollVoidStatus = async () => {
    try {
      const response = await fetch('/api/admin/void-phantom-status', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (response.status === 401) {
        pollRetryCountRef.current++;
        if (pollRetryCountRef.current <= 60) {
          setTimeout(pollVoidStatus, 5000);
          return;
        }
        setVoidingPhantom(false);
        toast({ title: 'Session Expired', description: 'Admin session expired during scan. The scan continues on the server — please log in again and check status.', variant: 'destructive' });
        return;
      }
      if (!response.ok) {
        pollRetryCountRef.current++;
        if (pollRetryCountRef.current <= 10) {
          setTimeout(pollVoidStatus, 5000);
          return;
        }
        setVoidingPhantom(false);
        toast({ title: 'Poll Failed', description: `Server returned ${response.status}`, variant: 'destructive' });
        return;
      }
      pollRetryCountRef.current = 0;
      const data = await response.json();
      if (data.success && data.status) {
        setVoidResult(data.status);
        if (data.status.running) {
          setTimeout(pollVoidStatus, 3000);
        } else {
          setVoidingPhantom(false);
          fetchPlatformInfo();
          const hasErrors = data.status.errors?.length > 0;
          toast({
            title: hasErrors ? 'Phantom Void Completed with Errors' : 'Phantom Void Complete',
            description: `Voided ${data.status.voided} bets, freed ${(data.status.liabilityFreed || 0).toFixed(2)} SBETS${hasErrors ? ` (${data.status.errors.length} errors)` : ''}`,
            variant: hasErrors ? 'destructive' : 'default',
          });
        }
      } else {
        setVoidingPhantom(false);
      }
    } catch (err: any) {
      pollRetryCountRef.current++;
      if (pollRetryCountRef.current <= 10) {
        setTimeout(pollVoidStatus, 5000);
        return;
      }
      setVoidingPhantom(false);
      toast({ title: 'Poll Error', description: err.message || 'Lost connection to server', variant: 'destructive' });
    }
  };

  const voidPhantomSbets = async (forceReset = false) => {
    setVoidingPhantom(true);
    setVoidResult(null);
    pollRetryCountRef.current = 0;
    try {
      const response = await fetch('/api/admin/void-phantom-sbets', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ forceReset })
      });
      if (response.status === 401) {
        toast({
          title: 'Session Expired',
          description: 'Your admin session has expired. Please log in again.',
          variant: 'destructive',
        });
        setVoidingPhantom(false);
        return;
      }
      const data = await response.json();
      if (data.success) {
        setVoidResult(data.status);
        toast({
          title: 'Void Scan Started',
          description: data.message,
        });
        setTimeout(pollVoidStatus, 3000);
      } else {
        if (data.message?.includes('already in progress')) {
          toast({
            title: 'Scan Stuck',
            description: 'A previous scan appears stuck. Click "Force Reset & Restart" to clear it.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Void Failed',
            description: data.message || data.error,
            variant: 'destructive',
          });
        }
        setVoidingPhantom(false);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to void phantom bets',
        variant: 'destructive',
      });
      setVoidingPhantom(false);
    }
  };

  const settleEvent = async () => {
    if (!settleEventId.trim()) {
      toast({ title: 'Missing Event ID', description: 'Please enter an event ID to settle', variant: 'destructive' });
      return;
    }
    if (!settleWinnerName.trim()) {
      toast({ title: 'Missing Winner', description: 'Please enter the winner name', variant: 'destructive' });
      return;
    }
    setSettlingEvent(true);
    setSettleEventResult(null);
    try {
      const response = await fetch('/api/admin/settle-event', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ eventId: settleEventId.trim(), winnerName: settleWinnerName.trim() })
      });
      const data = await response.json();
      if (data.success) {
        setSettleEventResult(data);
        toast({ title: 'Event Settled', description: `${data.settled} bets settled (${data.won} won, ${data.lost} lost)` });
        fetchBets();
      } else {
        toast({ title: 'Settlement Failed', description: data.message || 'Unknown error', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to settle event', variant: 'destructive' });
    } finally {
      setSettlingEvent(false);
    }
  };

  const fetchUnsettledBets = async () => {
    setLoadingUnsettled(true);
    try {
      const response = await fetch('/api/admin/unsettled-bets', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      const data = await response.json();
      if (data.success) {
        setUnsettledBets(data);
      } else {
        toast({ title: 'Error', description: data.message, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingUnsettled(false);
    }
  };

  const fetchLiabilityCheck = async () => {
    setLoadingLiability(true);
    try {
      const response = await fetch('/api/admin/liability-check', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      const data = await response.json();
      if (data.success) {
        setLiabilityCheck(data);
      } else {
        toast({ title: 'Error', description: data.message, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingLiability(false);
    }
  };

  const voidStaleBets = async (execute: boolean) => {
    setVoidingStaleBets(true);
    setStaleBetVoidResult(null);
    try {
      const response = await fetch('/api/admin/void-stale-bets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ execute, hoursOld: parseInt(staleBetHours) || 48 })
      });
      const data = await response.json();
      setStaleBetVoidResult(data);
      if (data.success && execute) {
        toast({ title: 'Stale Bets Voided', description: data.message });
        fetchPlatformInfo();
        fetchUnsettledBets();
      } else if (data.success) {
        toast({ title: 'Dry Run Complete', description: data.message });
      } else {
        toast({ title: 'Error', description: data.message, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setVoidingStaleBets(false);
    }
  };

  const manualSettleBet = async (betId: string, outcome: 'won' | 'lost' | 'void') => {
    setSettlingBetId(betId);
    try {
      const response = await fetch('/api/admin/settle-bet', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ betId, outcome })
      });
      const data = await response.json();
      if (data.success) {
        toast({ title: 'Bet Settled', description: `Bet ${betId} → ${outcome}` });
        fetchUnsettledBets();
        fetchPlatformInfo();
      } else {
        toast({ title: 'Settlement Failed', description: data.message, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSettlingBetId(null);
    }
  };

  const resetOnChainLiability = async (currency: 'SUI' | 'SBETS') => {
    setResettingLiability(true);
    setResetLiabilityResult(null);
    try {
      const response = await fetch('/api/admin/reset-onchain-liability', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ currency })
      });
      const data = await response.json();
      setResetLiabilityResult(data);
      toast({
        title: data.success ? 'Liability Reset Complete' : 'Reset Failed',
        description: data.message || data.error,
        variant: data.success ? 'default' : 'destructive',
      });
      if (data.success) {
        fetchPlatformInfo();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to reset liability',
        variant: 'destructive',
      });
    }
    setResettingLiability(false);
  };

  const settleBet = async (betId: string, outcome: 'won' | 'lost' | 'void') => {
    setSettling(betId);
    try {
      const response = await fetch('/api/admin/settle-bet', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ betId, outcome, reason: 'Manual admin settlement' })
      });
      
      if (response.ok) {
        toast({ title: 'Bet settled', description: `Bet ${betId} marked as ${outcome}` });
        fetchBets();
      } else {
        const error = await response.json();
        toast({ title: 'Settlement failed', description: error.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Settlement failed', variant: 'destructive' });
    }
    setSettling(null);
  };

  const settleAllPending = async (outcome: 'won' | 'lost' | 'void') => {
    if (!confirm(`Are you sure you want to settle ALL pending bets as ${outcome.toUpperCase()}?`)) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settle-all', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ outcome })
      });
      
      if (response.ok) {
        const result = await response.json();
        toast({ title: 'All bets settled', description: `${result.settled} bets marked as ${outcome}` });
        fetchBets();
      } else {
        const error = await response.json();
        toast({ title: 'Bulk settlement failed', description: error.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Bulk settlement failed', variant: 'destructive' });
    }
    setLoading(false);
  };

  useEffect(() => {
    const savedToken = sessionStorage.getItem('adminToken');
    if (savedToken) {
      setAuthToken(savedToken);
      setIsAuthenticated(true);
    }
    // Always fetch platform info
    fetchPlatformInfo();
    // Fetch SUI betting status
    fetch('/api/betting-status').then(r => r.ok ? r.json() : null).then(data => {
      if (data) setSuiBettingPaused(data.suiBettingPaused);
    }).catch(() => {});
    
    const refreshInterval = setInterval(() => {
      fetchPlatformInfo();
    }, 15000);
    
    return () => clearInterval(refreshInterval);
  }, [fetchPlatformInfo]);

  const fetchRevenueController = async () => {
    setLoadingRevenue(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/revenue-controller', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (res.status === 401) { setIsAuthenticated(false); sessionStorage.removeItem('adminToken'); toast({ title: 'Session expired', variant: 'destructive' }); return; }
      if (res.ok) setRevenueController(await res.json());
      else toast({ title: 'Failed to load revenue data', variant: 'destructive' });
    } catch (e: any) { toast({ title: 'Error loading revenue', description: e.message, variant: 'destructive' }); }
    finally { setLoadingRevenue(false); }
  };

  const fetchExposure = async () => {
    setLoadingExposure(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/event-exposure', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (res.ok) setExposureData(await res.json());
    } catch (e: any) { toast({ title: 'Failed to load exposure data', description: e.message, variant: 'destructive' }); }
    finally { setLoadingExposure(false); }
  };

  const setEventCap = async (eventId: string, currency: string, cap: number | null) => {
    setSettingCap(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/event-caps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ eventId, currency, cap }),
      });
      if (res.ok) {
        toast({ title: 'Cap Updated', description: `${currency} cap for event ${eventId} set to ${cap ?? 'default'}` });
        fetchExposure();
      } else {
        toast({ title: 'Failed to set cap', variant: 'destructive' });
      }
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
    finally { setSettingCap(false); }
  };

  const resetEventExposure = async (eventId: string) => {
    try {
      const token = getToken();
      const res = await fetch('/api/admin/event-exposure/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ eventId }),
      });
      if (res.ok) { toast({ title: 'Exposure Reset', description: `Event ${eventId} exposure cleared` }); fetchExposure(); }
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  // Sync input values when platform info loads
  useEffect(() => {
    if (platformInfo) {
      setNewMinBetSui(platformInfo.minBetSui.toString());
      setNewMaxBetSui(platformInfo.maxBetSui.toString());
      setNewMinBetSbets(platformInfo.minBetSbets.toString());
      setNewMaxBetSbets(platformInfo.maxBetSbets.toString());
    }
  }, [platformInfo]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchBets();
      fetchLegacyBets();
    }
  }, [isAuthenticated, filter]);

  useEffect(() => {
    if (currentAccount?.address) {
      fetchUserBalances();
    }
  }, [currentAccount?.address, fetchUserBalances]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchP2PVault();
    const id = setInterval(fetchP2PVault, 60_000);
    return () => clearInterval(id);
  }, [isAuthenticated, fetchP2PVault]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30" data-testid={`badge-status-${status}`}><AlertCircle className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'won':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30" data-testid={`badge-status-${status}`}><CheckCircle className="w-3 h-3 mr-1" /> Won</Badge>;
      case 'lost':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30" data-testid={`badge-status-${status}`}><XCircle className="w-3 h-3 mr-1" /> Lost</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30" data-testid={`badge-status-${status}`}>{status}</Badge>;
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Shield className="w-8 h-8 text-cyan-400" />
              Admin Panel
            </h1>
            <p className="text-gray-400 mt-1">Manage treasury and bets</p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <ConnectButton />
            {isAuthenticated && (
              <>
                <Button 
                  onClick={() => { fetchBets(); fetchPlatformInfo(); }} 
                  variant="outline" 
                  className="border-cyan-500/30 text-cyan-400"
                  disabled={loading}
                  data-testid="button-refresh"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button 
                  onClick={() => { setIsAuthenticated(false); sessionStorage.removeItem('adminToken'); setAuthToken(''); }} 
                  variant="outline"
                  className="border-red-500/30 text-red-400"
                  data-testid="button-admin-logout"
                >
                  Logout
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Contract Info Section */}
        <Card className="bg-gradient-to-r from-purple-900/20 to-indigo-900/20 border-purple-500/30 mb-4">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 text-purple-400" />
              <span className="text-sm font-semibold text-white">Contract Info (January 27, 2026 - Shared Object Fix)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="bg-black/40 rounded p-2">
                <p className="text-gray-500 mb-1">Package ID</p>
                <p className="text-purple-300 font-mono break-all" data-testid="contract-package-id">
                  {BETTING_PACKAGE_ID}
                </p>
                <a 
                  href={`https://suivision.xyz/package/${BETTING_PACKAGE_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline text-xs mt-1 inline-block"
                >
                  View on SuiVision
                </a>
              </div>
              <div className="bg-black/40 rounded p-2">
                <p className="text-gray-500 mb-1">Platform ID (Treasury)</p>
                <p className="text-cyan-300 font-mono break-all" data-testid="contract-platform-id">
                  {BETTING_PLATFORM_ID}
                </p>
                <a 
                  href={`https://suivision.xyz/object/${BETTING_PLATFORM_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline text-xs mt-1 inline-block"
                >
                  View on SuiVision
                </a>
              </div>
              <div className="bg-black/40 rounded p-2">
                <p className="text-gray-500 mb-1">Admin Cap ID</p>
                <p className="text-yellow-300 font-mono break-all" data-testid="contract-admin-cap-id">
                  {ADMIN_CAP_ID}
                </p>
                <p className="text-gray-600 text-xs mt-1">Owned by admin wallet</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Treasury Management Section - Always visible */}
        <Card className="bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border-cyan-500/30 mb-8">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-xl text-white flex items-center gap-2">
              <Wallet className="w-6 h-6 text-cyan-400" />
              Treasury Management
            </CardTitle>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => fetchPlatformInfo()}
              disabled={loadingPlatform}
              className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-900/30"
              data-testid="button-refresh-treasury"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loadingPlatform ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {loadingPlatform ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              </div>
            ) : platformInfo ? (
              <div className="space-y-6">
                {/* Platform Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-black/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <Coins className="w-4 h-4" /> SUI Treasury
                    </div>
                    <p className="text-2xl font-bold text-cyan-400" data-testid="treasury-sui">
                      {platformInfo.treasurySui.toFixed(4)} SUI
                    </p>
                    {platformInfo.realLiabilitySui >= 0 ? (
                      <>
                        <p className="text-xs text-green-400 mt-1">
                          Active Liability: {platformInfo.realLiabilitySui.toFixed(4)} SUI
                        </p>
                        <p className="text-xs text-cyan-300">
                          Available: {(platformInfo.treasurySui - platformInfo.realLiabilitySui).toFixed(4)} SUI
                        </p>
                        {platformInfo.totalPotentialLiabilitySui > platformInfo.realLiabilitySui + 0.01 && (
                          <p className="text-xs text-gray-600 mt-1" title="Legacy on-chain counter (cosmetic only, does NOT affect betting or available balance)">
                            On-Chain Counter: {platformInfo.totalPotentialLiabilitySui.toFixed(4)} SUI (ignored)
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-orange-400 mt-1">
                          On-Chain Liability: {platformInfo.totalPotentialLiabilitySui.toFixed(4)} SUI
                        </p>
                        <p className="text-xs text-gray-500">
                          Available: {(platformInfo.treasurySui - platformInfo.totalPotentialLiabilitySui).toFixed(4)} SUI
                        </p>
                      </>
                    )}
                  </div>
                  <div className="bg-black/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <Coins className="w-4 h-4" /> SBETS Treasury
                    </div>
                    <p className="text-2xl font-bold text-purple-400" data-testid="treasury-sbets">
                      {platformInfo.treasurySbets.toFixed(4)} SBETS
                    </p>
                    {platformInfo.realLiabilitySbets >= 0 ? (
                      <>
                        <p className="text-xs text-green-400 mt-1">
                          Active Liability: {platformInfo.realLiabilitySbets.toFixed(4)} SBETS
                        </p>
                        <p className="text-xs text-purple-300">
                          Available: {(platformInfo.treasurySbets - platformInfo.realLiabilitySbets).toFixed(4)} SBETS
                        </p>
                        {platformInfo.totalPotentialLiabilitySbets > platformInfo.realLiabilitySbets + 0.01 && (
                          <p className="text-xs text-gray-600 mt-1" title="Legacy on-chain counter (cosmetic only, does NOT affect betting or available balance)">
                            On-Chain Counter: {platformInfo.totalPotentialLiabilitySbets.toFixed(4)} SBETS (ignored)
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-orange-400 mt-1">
                          On-Chain Liability: {platformInfo.totalPotentialLiabilitySbets.toFixed(4)} SBETS
                        </p>
                        <p className="text-xs text-gray-500">
                          Available: {(platformInfo.treasurySbets - platformInfo.totalPotentialLiabilitySbets).toFixed(4)} SBETS
                        </p>
                      </>
                    )}
                  </div>
                  <div className="bg-black/40 rounded-lg p-4 border border-green-500/30">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <DollarSign className="w-4 h-4 text-green-400" /> USDsui Treasury
                    </div>
                    <p className="text-2xl font-bold text-green-400" data-testid="treasury-usdsui">
                      {(platformInfo.treasuryUsdsui ?? 0).toFixed(2)} USDsui
                    </p>
                    {platformInfo.realLiabilityUsdsui != null && platformInfo.realLiabilityUsdsui >= 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        Liability: {platformInfo.realLiabilityUsdsui.toFixed(2)} |
                        Available: {((platformInfo.treasuryUsdsui ?? 0) - platformInfo.realLiabilityUsdsui).toFixed(2)} USDsui
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-0.5">Max bet: $1.00 · 6 decimals · pegged to USD</p>
                  </div>
                  <div className="bg-black/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <TrendingUp className="w-4 h-4" /> Total Volume
                    </div>
                    <p className="text-lg font-bold text-green-400">
                      {platformInfo.totalVolumeSui.toFixed(2)} SUI
                    </p>
                    <p className="text-sm text-purple-300">
                      {platformInfo.totalVolumeSbets.toFixed(2)} SBETS
                    </p>
                    {(platformInfo.totalVolumeUsdsui ?? 0) > 0 && (
                      <p className="text-sm text-green-300">
                        {(platformInfo.totalVolumeUsdsui ?? 0).toFixed(2)} USDsui
                      </p>
                    )}
                  </div>
                  <div className="bg-black/40 rounded-lg p-4 border border-yellow-500/30">
                    <div className="flex items-center gap-2 text-yellow-400 text-sm mb-1">
                      <DollarSign className="w-4 h-4" /> Withdrawable Revenue
                    </div>
                    <p className="text-lg font-bold text-yellow-400">
                      {platformInfo.accruedFeesSui.toFixed(4)} SUI
                    </p>
                    <p className="text-sm text-purple-300">
                      {platformInfo.accruedFeesSbets.toFixed(4)} SBETS
                    </p>
                    {(platformInfo.accruedFeesUsdsui ?? 0) > 0 && (
                      <p className="text-sm text-green-300">
                        {(platformInfo.accruedFeesUsdsui ?? 0).toFixed(4)} USDsui
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Lost bets + 1% win fees
                    </p>
                  </div>
                </div>

                {/* Platform Status */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <Badge className={platformInfo.paused ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}>
                    {platformInfo.paused ? 'Platform Paused' : 'Platform Active'}
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    SUI: {platformInfo.minBetSui}-{platformInfo.maxBetSui}
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    SBETS: {platformInfo.minBetSbets}-{platformInfo.maxBetSbets}
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    Fee: {platformInfo.platformFeeBps / 100}%
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    Total Bets: {platformInfo.totalBets}
                  </Badge>
                </div>

                {/* Legacy Bets Section - Stuck Liability */}
                {legacyBets.length > 0 && (
                  <div className="mt-6 p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                    <h4 className="text-md font-semibold text-orange-400 mb-3 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Legacy Bets - Stuck On-Chain Liability
                    </h4>
                    <p className="text-gray-400 text-sm mb-3">
                      These bets were placed on-chain but settled via database credits (before betObjectId tracking). 
                      Their liability remains on-chain because the smart contract was never called to settle them.
                      This is phantom liability - it doesn't affect real operations since these bets are already settled.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Legacy Bets</p>
                        <p className="text-lg font-bold text-orange-400">{legacyBets.length}</p>
                      </div>
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Stuck SUI Liability</p>
                        <p className="text-lg font-bold text-cyan-400">
                          {legacyBets.filter(b => b.currency === 'SUI').reduce((sum, b) => sum + (b.potentialWin || 0), 0).toFixed(4)}
                        </p>
                      </div>
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Stuck SBETS Liability</p>
                        <p className="text-lg font-bold text-purple-400">
                          {legacyBets.filter(b => b.currency === 'SBETS').reduce((sum, b) => sum + (b.potentialWin || 0), 0).toFixed(0)}
                        </p>
                      </div>
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Settlement Status</p>
                        <p className="text-lg font-bold text-gray-400">Off-chain</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700">
                            <th className="text-left py-2 px-2">ID</th>
                            <th className="text-left py-2 px-2">Event</th>
                            <th className="text-left py-2 px-2">Status</th>
                            <th className="text-right py-2 px-2">Stake</th>
                            <th className="text-right py-2 px-2">Potential Payout</th>
                            <th className="text-left py-2 px-2">Currency</th>
                          </tr>
                        </thead>
                        <tbody>
                          {legacyBets.map((bet: any) => (
                            <tr key={bet.id} className="border-b border-gray-800 text-gray-300">
                              <td className="py-2 px-2">{bet.dbId || bet.id}</td>
                              <td className="py-2 px-2 max-w-[150px] truncate">{bet.eventName}</td>
                              <td className="py-2 px-2">
                                <Badge variant="outline" className={
                                  bet.status === 'won' ? 'border-green-500 text-green-400' :
                                  bet.status === 'lost' ? 'border-red-500 text-red-400' :
                                  'border-gray-500 text-gray-400'
                                }>
                                  {bet.status}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-right">{bet.stake?.toFixed(2)}</td>
                              <td className="py-2 px-2 text-right text-orange-400">{bet.potentialWin?.toFixed(2)}</td>
                              <td className="py-2 px-2">{bet.currency}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">
                      Note: The smart contract does not have a direct "adjust liability" function. 
                      To reduce this phantom liability, a contract upgrade would be required to add an admin function for liability adjustment.
                      All new bets (with betObjectId) settle correctly on-chain with proper liability tracking.
                    </p>
                  </div>
                )}

                {/* Phantom SBETS Void Section */}
                <div className="border-t border-cyan-500/20 pt-6 mt-6" data-testid="section-phantom-void">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-orange-400" />
                    Phantom SBETS Liability Cleanup
                  </h3>
                  <p className="text-gray-400 text-sm mb-4">
                    Scans on-chain SBETS bet objects and voids any phantom bets that are stuck with status=0 (pending) 
                    but not owned by any user. This frees up phantom liability from the treasury.
                  </p>
                  <div className="flex gap-3">
                    <Button
                      onClick={() => voidPhantomSbets(false)}
                      disabled={voidingPhantom}
                      className="bg-orange-600 hover:bg-orange-700 text-white"
                      data-testid="button-void-phantom"
                    >
                      {voidingPhantom ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Scanning & Voiding...
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4 mr-2" />
                          Void Phantom Bets
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => voidPhantomSbets(true)}
                      disabled={voidingPhantom}
                      variant="outline"
                      className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                    >
                      Force Reset & Restart
                    </Button>
                  </div>
                  {voidResult && (
                    <div className={`mt-4 p-4 rounded-lg ${voidResult.running ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-green-500/10 border border-green-500/30'}`}>
                      <p className={`text-sm font-medium ${voidResult.running ? 'text-yellow-400' : 'text-green-400'}`}>
                        {voidResult.running 
                          ? `Scanning... ${voidResult.scanned || 0}/${voidResult.total || '?'} bets checked`
                          : `Complete: Voided ${voidResult.voided} bets, freed ${(voidResult.liabilityFreed || 0).toFixed(2)} SBETS`
                        }
                      </p>
                      {voidResult.running && voidResult.total > 0 && (
                        <div className="mt-2 w-full bg-black/40 rounded-full h-2">
                          <div 
                            className="bg-yellow-500 h-2 rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, (voidResult.scanned / voidResult.total) * 100)}%` }}
                          />
                        </div>
                      )}
                      <div className="mt-2 grid grid-cols-3 gap-3">
                        <div className="bg-black/40 rounded p-2">
                          <p className="text-xs text-gray-500">Voided</p>
                          <p className="text-lg font-bold text-green-400" data-testid="text-voided-count">{voidResult.voided || 0}</p>
                        </div>
                        <div className="bg-black/40 rounded p-2">
                          <p className="text-xs text-gray-500">Skipped</p>
                          <p className="text-lg font-bold text-gray-400" data-testid="text-skipped-count">{voidResult.skipped || 0}</p>
                        </div>
                        <div className="bg-black/40 rounded p-2">
                          <p className="text-xs text-gray-500">SBETS Freed</p>
                          <p className="text-lg font-bold text-cyan-400" data-testid="text-liability-freed">{(voidResult.liabilityFreed || 0).toFixed(2)}</p>
                        </div>
                      </div>
                      {voidResult.errors?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-red-400">Errors ({voidResult.errors.length}):</p>
                          <p className="text-xs text-gray-500 mt-1">{voidResult.errors.slice(0, 3).join('; ')}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Unsettled Bets Review Section */}
                <div className="border-t border-cyan-500/20 pt-6 mt-6" data-testid="section-unsettled-bets">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-400" />
                    Unsettled Bets Review
                  </h3>
                  <p className="text-gray-400 text-sm mb-4">
                    View all pending/unsettled bets with classification by type. Identify stale bets, recovered bets, 
                    and manually settle individual bets that can't be auto-settled.
                  </p>
                  <div className="flex gap-3 mb-4">
                    <Button
                      onClick={fetchUnsettledBets}
                      disabled={loadingUnsettled}
                      className="bg-yellow-600 hover:bg-yellow-700 text-white"
                      data-testid="button-fetch-unsettled"
                    >
                      {loadingUnsettled ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Load Unsettled Bets
                        </>
                      )}
                    </Button>
                  </div>
                  {unsettledBets && (
                    <div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                        <div className="bg-black/40 rounded p-3">
                          <p className="text-xs text-gray-500">Total Unsettled</p>
                          <p className="text-lg font-bold text-yellow-400" data-testid="text-unsettled-total">{unsettledBets.summary?.total || 0}</p>
                        </div>
                        {unsettledBets.summary?.byType && Object.entries(unsettledBets.summary.byType).map(([type, count]: [string, any]) => (
                          <div key={type} className="bg-black/40 rounded p-3">
                            <p className="text-xs text-gray-500">{type.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</p>
                            <p className={`text-lg font-bold ${
                              type === 'football' ? 'text-green-400' :
                              type.includes('free-sport') ? 'text-blue-400' :
                              type === 'horse-racing' ? 'text-purple-400' :
                              type === 'parlay' ? 'text-orange-400' :
                              'text-red-400'
                            }`}>{count}</p>
                          </div>
                        ))}
                      </div>
                      {unsettledBets.summary?.byCurrency && (
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          {Object.entries(unsettledBets.summary.byCurrency).map(([currency, data]: [string, any]) => (
                            <div key={currency} className="bg-black/40 rounded p-3 flex justify-between items-center">
                              <div>
                                <p className="text-xs text-gray-500">{currency} Bets</p>
                                <p className="text-lg font-bold text-white">{data.count}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-gray-500">Liability</p>
                                <p className={`text-lg font-bold ${currency === 'SUI' ? 'text-cyan-400' : 'text-purple-400'}`}>
                                  {currency === 'SUI' ? Number(data.liability).toFixed(4) : Number(data.liability).toFixed(0)} {currency}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 mb-3 flex-wrap">
                        {['all', ...(unsettledBets.summary?.byType ? Object.keys(unsettledBets.summary.byType) : [])].map((type) => (
                          <Button
                            key={type}
                            variant={unsettledFilter === type ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setUnsettledFilter(type)}
                            className={unsettledFilter === type
                              ? 'bg-cyan-600 text-white'
                              : 'border-gray-600 text-gray-400 hover:bg-gray-800'}
                            data-testid={`button-filter-${type}`}
                          >
                            {type === 'all' ? 'All' : type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </Button>
                        ))}
                      </div>
                      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-500 border-b border-gray-700">
                              <th className="text-left py-2 px-2">ID</th>
                              <th className="text-left py-2 px-2">Type</th>
                              <th className="text-left py-2 px-2">Event</th>
                              <th className="text-left py-2 px-2">Selection</th>
                              <th className="text-right py-2 px-2">Stake</th>
                              <th className="text-right py-2 px-2">Payout</th>
                              <th className="text-left py-2 px-2">Currency</th>
                              <th className="text-left py-2 px-2">Age</th>
                              <th className="text-left py-2 px-2">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(unsettledBets.bets || [])
                              .filter((b: any) => unsettledFilter === 'all' || b.betType === unsettledFilter)
                              .map((bet: any) => (
                                <tr key={bet.id} className={`border-b border-gray-800 text-gray-300 hover:bg-gray-800/50 ${bet.eventName?.includes('Recovered') ? 'bg-orange-950/20' : ''}`}>
                                  <td className="py-2 px-2 font-mono text-xs">
                                    <div>{bet.id?.slice(0, 12)}{bet.id?.length > 12 ? '…' : ''}</div>
                                    {bet.betObjectId && (
                                      <div className="text-[9px] text-cyan-600 mt-0.5" title={bet.betObjectId}>
                                        obj: {bet.betObjectId.slice(0, 10)}…
                                      </div>
                                    )}
                                    {bet.txHash && (
                                      <div className="text-[9px] text-gray-600 mt-0.5" title={bet.txHash}>
                                        tx: {bet.txHash.slice(0, 10)}…
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2 px-2">
                                    <div className="flex flex-col gap-0.5">
                                      <Badge variant="outline" className={
                                        bet.betType === 'football' ? 'border-green-500 text-green-400' :
                                        bet.betType?.includes('free-sport') ? 'border-blue-500 text-blue-400' :
                                        bet.betType === 'horse-racing' ? 'border-purple-500 text-purple-400' :
                                        bet.betType === 'parlay' ? 'border-orange-500 text-orange-400' :
                                        'border-red-500 text-red-400'
                                      }>
                                        {bet.betType}
                                      </Badge>
                                      {bet.eventName?.includes('Recovered') && (
                                        <Badge variant="outline" className="border-orange-500 text-orange-400 text-[9px] px-1 py-0">
                                          recovered
                                        </Badge>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 px-2 max-w-[120px]" title={bet.eventName || `${bet.homeTeam} vs ${bet.awayTeam}`}>
                                    <div className="truncate">{bet.eventName?.includes('Recovered') && bet.homeTeam && bet.homeTeam !== 'Unknown'
                                      ? `${bet.homeTeam} vs ${bet.awayTeam}`
                                      : (bet.eventName || `${bet.homeTeam} vs ${bet.awayTeam}`)
                                    }</div>
                                    {bet.eventName?.includes('Recovered') && (
                                      <div className="text-[9px] text-orange-500/70 truncate" title={bet.externalEventId}>
                                        id: {bet.externalEventId || '—'}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2 px-2 max-w-[80px] truncate" title={bet.prediction}>{bet.prediction}</td>
                                  <td className="py-2 px-2 text-right">
                                    <span className={Number(bet.betAmount) === 0 && bet.eventName?.includes('Recovered') ? 'text-orange-400' : ''}>
                                      {Number(bet.betAmount).toFixed(2)}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-right text-yellow-400">{Number(bet.potentialPayout).toFixed(2)}</td>
                                  <td className="py-2 px-2">{bet.currency}</td>
                                  <td className="py-2 px-2 text-gray-500">{bet.ageHours ? `${bet.ageHours}h` : '-'}</td>
                                  <td className="py-2 px-2">
                                    <div className="flex gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 px-2 text-[10px] border-green-600 text-green-400 hover:bg-green-600/20"
                                        disabled={settlingBetId === String(bet.id)}
                                        onClick={() => manualSettleBet(String(bet.id), 'won')}
                                        data-testid={`button-settle-won-${bet.id}`}
                                      >
                                        Win
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 px-2 text-[10px] border-red-600 text-red-400 hover:bg-red-600/20"
                                        disabled={settlingBetId === String(bet.id)}
                                        onClick={() => manualSettleBet(String(bet.id), 'lost')}
                                        data-testid={`button-settle-lost-${bet.id}`}
                                      >
                                        Loss
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 px-2 text-[10px] border-gray-600 text-gray-400 hover:bg-gray-600/20"
                                        disabled={settlingBetId === String(bet.id)}
                                        onClick={() => manualSettleBet(String(bet.id), 'void')}
                                        data-testid={`button-settle-void-${bet.id}`}
                                      >
                                        Void
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      {unsettledBets.bets?.length === 0 && (
                        <p className="text-center text-gray-500 py-4">No unsettled bets found</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Liability Check & Stale Bet Void Section */}
                <div className="border-t border-cyan-500/20 pt-6 mt-6" data-testid="section-liability-check">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-cyan-400" />
                    Liability Check & Stale Bet Cleanup
                  </h3>
                  <p className="text-gray-400 text-sm mb-4">
                    Compare on-chain vs database liability, view age distribution of unsettled bets, 
                    and void stale bets that are too old to settle automatically.
                  </p>
                  <div className="flex gap-3 mb-4">
                    <Button
                      onClick={fetchLiabilityCheck}
                      disabled={loadingLiability}
                      className="bg-cyan-600 hover:bg-cyan-700 text-white"
                      data-testid="button-liability-check"
                    >
                      {loadingLiability ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Checking...
                        </>
                      ) : (
                        <>
                          <TrendingUp className="w-4 h-4 mr-2" />
                          Run Liability Check
                        </>
                      )}
                    </Button>
                  </div>
                  {liabilityCheck && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="bg-black/40 rounded p-3">
                          <p className="text-xs text-gray-500">On-Chain SUI Liability</p>
                          <p className="text-lg font-bold text-cyan-400" data-testid="text-onchain-sui-liability">
                            {liabilityCheck.onChain?.liabilitySui?.toFixed(4) ?? '-'}
                          </p>
                        </div>
                        <div className="bg-black/40 rounded p-3">
                          <p className="text-xs text-gray-500">DB SUI Liability</p>
                          <p className="text-lg font-bold text-blue-400" data-testid="text-db-sui-liability">
                            {liabilityCheck.database?.dbLiabilitySui?.toFixed(4) ?? '-'}
                          </p>
                        </div>
                        <div className="bg-black/40 rounded p-3">
                          <p className="text-xs text-gray-500">SUI Diff</p>
                          <p className={`text-lg font-bold ${(liabilityCheck.mismatch?.suiDiff || 0) > 0.01 ? 'text-red-400' : 'text-green-400'}`}>
                            {liabilityCheck.mismatch?.suiDiff?.toFixed(4) ?? '0'}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="bg-black/40 rounded p-3">
                          <p className="text-xs text-gray-500">On-Chain SBETS Liability</p>
                          <p className="text-lg font-bold text-purple-400" data-testid="text-onchain-sbets-liability">
                            {liabilityCheck.onChain?.liabilitySbets?.toFixed(0) ?? '-'}
                          </p>
                        </div>
                        <div className="bg-black/40 rounded p-3">
                          <p className="text-xs text-gray-500">DB SBETS Liability</p>
                          <p className="text-lg font-bold text-violet-400" data-testid="text-db-sbets-liability">
                            {liabilityCheck.database?.dbLiabilitySbets?.toFixed(0) ?? '-'}
                          </p>
                        </div>
                        <div className="bg-black/40 rounded p-3">
                          <p className="text-xs text-gray-500">SBETS Diff</p>
                          <p className={`text-lg font-bold ${(liabilityCheck.mismatch?.sbetsDiff || 0) > 100 ? 'text-red-400' : 'text-green-400'}`}>
                            {liabilityCheck.mismatch?.sbetsDiff?.toFixed(0) ?? '0'}
                          </p>
                        </div>
                      </div>
                      {liabilityCheck.onChain && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-black/40 rounded p-3">
                            <p className="text-xs text-gray-500">Treasury SUI</p>
                            <p className="text-lg font-bold text-cyan-400">{liabilityCheck.onChain.treasurySui?.toFixed(4)}</p>
                          </div>
                          <div className="bg-black/40 rounded p-3">
                            <p className="text-xs text-gray-500">Available SUI</p>
                            <p className="text-lg font-bold text-green-400">{liabilityCheck.onChain.availableSui?.toFixed(4)}</p>
                          </div>
                          <div className="bg-black/40 rounded p-3">
                            <p className="text-xs text-gray-500">Treasury SBETS</p>
                            <p className="text-lg font-bold text-purple-400">{liabilityCheck.onChain.treasurySbets?.toFixed(0)}</p>
                          </div>
                          <div className="bg-black/40 rounded p-3">
                            <p className="text-xs text-gray-500">Available SBETS</p>
                            <p className="text-lg font-bold text-green-400">{liabilityCheck.onChain.availableSbets?.toFixed(0)}</p>
                          </div>
                        </div>
                      )}
                      {(liabilityCheck.mismatch?.suiDiff > 0.01 || liabilityCheck.mismatch?.sbetsDiff > 100) && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                          <p className="text-sm font-medium text-red-400">
                            Liability Mismatch — On-chain liability exceeds DB by {liabilityCheck.mismatch.suiDiff?.toFixed(4)} SUI 
                            and {liabilityCheck.mismatch.sbetsDiff?.toFixed(0)} SBETS. Likely phantom liability from legacy/stale bets.
                          </p>
                        </div>
                      )}
                      {liabilityCheck.database?.wonUnpaid?.length > 0 && (
                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                          <p className="text-sm font-medium text-yellow-400">
                            Won but Unpaid: {liabilityCheck.database.wonUnpaid.map((w: any) => `${w.count} ${w.currency} bets (${Number(w.total_liability).toFixed(2)} liability)`).join(', ')}
                          </p>
                        </div>
                      )}
                      {liabilityCheck.database?.ageBuckets?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-300 mb-2">Age Distribution of Unsettled Bets</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500 border-b border-gray-700">
                                  <th className="text-left py-2 px-2">Age Bucket</th>
                                  <th className="text-left py-2 px-2">Currency</th>
                                  <th className="text-right py-2 px-2">Count</th>
                                  <th className="text-right py-2 px-2">Liability</th>
                                </tr>
                              </thead>
                              <tbody>
                                {liabilityCheck.database.ageBuckets.map((row: any, i: number) => (
                                  <tr key={i} className="border-b border-gray-800 text-gray-300">
                                    <td className="py-2 px-2">{row.age_bucket}</td>
                                    <td className="py-2 px-2">{row.currency}</td>
                                    <td className="py-2 px-2 text-right">{row.count}</td>
                                    <td className="py-2 px-2 text-right text-yellow-400">{Number(row.liability).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <h4 className="text-md font-semibold text-red-400 mb-3 flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      Void Stale Bets
                    </h4>
                    <p className="text-gray-400 text-sm mb-3">
                      Settles old unsettled bets as lost on-chain first, then voids them in the database. 
                      This frees up on-chain liability safely. Run a dry-run first to preview what will be voided.
                    </p>
                    <div className="flex items-end gap-3 mb-3">
                      <div>
                        <label className="text-sm text-gray-400 mb-1 block">Hours Old Threshold</label>
                        <Input
                          type="number"
                          value={staleBetHours}
                          onChange={(e) => setStaleBetHours(e.target.value)}
                          className="bg-black/40 border-gray-700 text-white w-24"
                          min="1"
                          data-testid="input-stale-hours"
                        />
                      </div>
                      <Button
                        onClick={() => voidStaleBets(false)}
                        disabled={voidingStaleBets}
                        variant="outline"
                        className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
                        data-testid="button-void-dryrun"
                      >
                        {voidingStaleBets ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Dry Run
                      </Button>
                      <Button
                        onClick={() => voidStaleBets(true)}
                        disabled={voidingStaleBets}
                        className="bg-red-600 hover:bg-red-700 text-white"
                        data-testid="button-void-execute"
                      >
                        {voidingStaleBets ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Execute Void
                      </Button>
                    </div>
                    {staleBetVoidResult && (
                      <div className={`mt-3 p-3 rounded-lg ${staleBetVoidResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                        <p className={`text-sm font-medium ${staleBetVoidResult.success ? 'text-green-400' : 'text-red-400'}`}>
                          {staleBetVoidResult.dryRun ? '🔍 DRY RUN — ' : '✅ EXECUTED — '}{staleBetVoidResult.message}
                        </p>
                        {staleBetVoidResult.summary && (
                          <div className="mt-3 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="bg-black/40 rounded p-2">
                                <p className="text-xs text-gray-500">Total Stale</p>
                                <p className="text-lg font-bold text-yellow-400" data-testid="text-stale-total">{staleBetVoidResult.summary.totalStale}</p>
                              </div>
                              <div className="bg-black/40 rounded p-2">
                                <p className="text-xs text-gray-500">Total Liability</p>
                                <p className="text-lg font-bold text-red-400">{Number(staleBetVoidResult.summary.totalLiability).toFixed(2)}</p>
                              </div>
                              <div className="bg-black/40 rounded p-2">
                                <p className="text-xs text-gray-500">Cutoff</p>
                                <p className="text-sm font-bold text-gray-300">{staleBetVoidResult.summary.hoursOld}h ago</p>
                              </div>
                              <div className="bg-black/40 rounded p-2">
                                <p className="text-xs text-gray-500">Oldest Bet</p>
                                <p className="text-xs font-bold text-gray-400">{staleBetVoidResult.summary.oldestBet ? new Date(staleBetVoidResult.summary.oldestBet).toLocaleDateString() : '-'}</p>
                              </div>
                            </div>
                            {staleBetVoidResult.summary.byCurrency && (
                              <div className="grid grid-cols-2 gap-3">
                                {Object.entries(staleBetVoidResult.summary.byCurrency).map(([cur, data]: [string, any]) => (
                                  <div key={cur} className="bg-black/40 rounded p-2 flex justify-between items-center">
                                    <span className="text-xs text-gray-500">{cur}</span>
                                    <span className={`text-sm font-bold ${cur === 'SUI' ? 'text-cyan-400' : 'text-purple-400'}`}>
                                      {data.count} bets / {Number(data.liability).toFixed(2)} liability
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {staleBetVoidResult.summary.byType && (
                              <div className="flex gap-2 flex-wrap">
                                {Object.entries(staleBetVoidResult.summary.byType)
                                  .filter(([_, count]: [string, any]) => count > 0)
                                  .map(([type, count]: [string, any]) => (
                                    <Badge key={type} variant="outline" className="border-gray-600 text-gray-300">
                                      {type}: {count}
                                    </Badge>
                                  ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Manual Event Settlement */}
                <div className="border-t border-cyan-500/20 pt-6 mt-6" data-testid="section-settle-event">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    Manual Event Settlement
                  </h3>
                  <p className="text-gray-400 text-sm mb-4">
                    Settle all pending bets for a specific event. Use for generated sports (WWE, F1, MotoGP, Boxing, Tennis, Horse Racing, Cricket) 
                    that require manual settlement after results are known.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-sm text-gray-400 mb-1 block">Event ID</label>
                      <Input
                        value={settleEventId}
                        onChange={(e) => setSettleEventId(e.target.value)}
                        placeholder="e.g. wwe_1234 or f1_2026_australia"
                        className="bg-black/40 border-gray-700 text-white"
                        data-testid="input-settle-event-id"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-400 mb-1 block">Winner Name</label>
                      <Input
                        value={settleWinnerName}
                        onChange={(e) => setSettleWinnerName(e.target.value)}
                        placeholder="e.g. Max Verstappen or Cody Rhodes"
                        className="bg-black/40 border-gray-700 text-white"
                        data-testid="input-settle-winner-name"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={settleEvent}
                    disabled={settlingEvent || !settleEventId.trim() || !settleWinnerName.trim()}
                    className="bg-green-600 hover:bg-green-700 text-white"
                    data-testid="button-settle-event"
                  >
                    {settlingEvent ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Settling...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Settle Event
                      </>
                    )}
                  </Button>
                  {settleEventResult && (
                    <div className="mt-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                      <p className="text-sm font-medium text-green-400">
                        Settled {settleEventResult.settled} bets for event {settleEventResult.eventId}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-3">
                        <div className="bg-black/40 rounded p-2">
                          <p className="text-xs text-gray-500">Winner</p>
                          <p className="text-sm font-bold text-white" data-testid="text-settle-winner">{settleEventResult.winner}</p>
                        </div>
                        <div className="bg-black/40 rounded p-2">
                          <p className="text-xs text-gray-500">Won</p>
                          <p className="text-lg font-bold text-green-400" data-testid="text-settle-won">{settleEventResult.won}</p>
                        </div>
                        <div className="bg-black/40 rounded p-2">
                          <p className="text-xs text-gray-500">Lost</p>
                          <p className="text-lg font-bold text-red-400" data-testid="text-settle-lost">{settleEventResult.lost}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bet Limits & Platform Controls - Available to any authenticated admin */}
                {isAuthenticated && platformInfo && (
                  <div className="border-t border-cyan-500/20 pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-cyan-400" />
                      Bet Limits & Platform Controls
                    </h3>
                    
                    {/* SBETS Bet Limits */}
                    <div className="mb-6 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                      <h4 className="text-md font-medium text-purple-400 mb-3 flex items-center gap-2">
                        <Coins className="w-4 h-4" />
                        SBETS Bet Limits (Backend)
                      </h4>
                      <div className="flex flex-wrap gap-4 items-end">
                        <div className="flex-1 min-w-[100px]">
                          <label className="text-sm text-gray-400 mb-2 block">Min Bet (SBETS)</label>
                          <Input
                            type="number"
                            value={newMinBetSbets}
                            onChange={(e) => setNewMinBetSbets(e.target.value)}
                            placeholder="100"
                            className="bg-black/40 border-gray-700 text-white"
                            min="1"
                            step="1"
                            data-testid="input-min-bet-sbets-top"
                          />
                        </div>
                        <div className="flex-1 min-w-[100px]">
                          <label className="text-sm text-gray-400 mb-2 block">Max Bet (SBETS)</label>
                          <Input
                            type="number"
                            value={newMaxBetSbets}
                            onChange={(e) => setNewMaxBetSbets(e.target.value)}
                            placeholder="1000000"
                            className="bg-black/40 border-gray-700 text-white"
                            min="100"
                            step="100"
                            data-testid="input-max-bet-sbets-top"
                          />
                        </div>
                        <Button
                          onClick={updateBetLimitsSbets}
                          disabled={updatingLimitsSbets}
                          className="bg-purple-600 hover:bg-purple-700 text-white min-w-[140px]"
                          data-testid="button-update-limits-sbets-top"
                        >
                          {updatingLimitsSbets ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <TrendingUp className="w-4 h-4 mr-2" />
                          )}
                          Update SBETS
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Updates the server-side max stake. No wallet connection needed.
                      </p>
                    </div>

                    {/* SUI Bet Limits */}
                    <div className="mb-6 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
                      <h4 className="text-md font-medium text-cyan-400 mb-3 flex items-center gap-2">
                        <Wallet className="w-4 h-4" />
                        SUI Bet Limits (Backend)
                      </h4>
                      <div className="flex flex-wrap gap-4 items-end">
                        <div className="flex-1 min-w-[100px]">
                          <label className="text-sm text-gray-400 mb-2 block">Min Bet (SUI)</label>
                          <Input
                            type="number"
                            value={newMinBetSui}
                            onChange={(e) => setNewMinBetSui(e.target.value)}
                            placeholder="0.02"
                            className="bg-black/40 border-gray-700 text-white"
                            min="0.01"
                            step="0.01"
                            data-testid="input-min-bet-sui-top"
                          />
                        </div>
                        <div className="flex-1 min-w-[100px]">
                          <label className="text-sm text-gray-400 mb-2 block">Max Bet (SUI)</label>
                          <Input
                            type="number"
                            value={newMaxBetSui}
                            onChange={(e) => setNewMaxBetSui(e.target.value)}
                            placeholder="15"
                            className="bg-black/40 border-gray-700 text-white"
                            min="1"
                            step="0.1"
                            data-testid="input-max-bet-sui-top"
                          />
                        </div>
                        <Button
                          onClick={updateBetLimitsSui}
                          disabled={updatingLimitsSui}
                          className="bg-cyan-600 hover:bg-cyan-700 text-white min-w-[140px]"
                          data-testid="button-update-limits-sui-top"
                        >
                          {updatingLimitsSui ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <TrendingUp className="w-4 h-4 mr-2" />
                          )}
                          Update SUI
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Updates the server-side max stake. No wallet connection needed.
                      </p>
                    </div>
                  </div>
                )}

                {/* Deposit Section - Only for Admin Wallet */}
                {currentAccount?.address ? (
                  isAdminWallet ? (
                    <div className="border-t border-cyan-500/20 pt-6 mt-6">
                      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-400" />
                        Admin Wallet Connected
                      </h3>
                      <div className="flex flex-wrap gap-2 text-sm text-gray-400 mb-4">
                        <span>Your SUI Balance: <span className="text-cyan-400 font-medium">{userSuiBalance.toFixed(4)} SUI</span></span>
                        <span>|</span>
                        <span>Your SBETS Balance: <span className="text-purple-400 font-medium">{userSbetsBalance.toFixed(4)} SBETS</span></span>
                        <span>|</span>
                        <span>Your USDsui Balance: <span className="text-green-400 font-medium">{userUsdsuiBalance.toFixed(2)} USDsui</span></span>
                      </div>
                      
                      <div className="flex flex-wrap gap-4 items-end mb-4">
                        <div className="flex-1 min-w-[200px]">
                          <label className="text-sm text-gray-400 mb-2 block">Amount (SUI / SBETS)</label>
                          <Input
                            type="number"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            placeholder="Enter amount"
                            className="bg-black/40 border-gray-700 text-white"
                            min="0.1"
                            step="0.1"
                            data-testid="input-deposit-amount"
                          />
                        </div>
                        <Button
                          onClick={depositSuiLiquidity}
                          disabled={depositingSui || depositingSbets || depositingUsdsui}
                          className="bg-cyan-600 hover:bg-cyan-700 text-white min-w-[150px]"
                          data-testid="button-deposit-sui"
                        >
                          {depositingSui ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <Coins className="w-4 h-4 mr-2" />
                          )}
                          Deposit SUI
                        </Button>
                        <Button
                          onClick={depositSbetsLiquidity}
                          disabled={depositingSui || depositingSbets || depositingUsdsui || userSbetsBalance === 0}
                          className="bg-purple-600 hover:bg-purple-700 text-white min-w-[150px]"
                          data-testid="button-deposit-sbets"
                        >
                          {depositingSbets ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <Coins className="w-4 h-4 mr-2" />
                          )}
                          Deposit SBETS
                        </Button>
                      </div>

                      {/* USDsui deposit section */}
                      <div className="border border-green-500/30 rounded-lg p-4 bg-green-500/5">
                        <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
                          <DollarSign className="w-4 h-4" /> USDsui Treasury Deposit
                          <span className="text-xs text-gray-400 font-normal">(6 decimals · max bet $1)</span>
                        </h4>
                        <div className="flex flex-wrap gap-4 items-end">
                          <div className="flex-1 min-w-[180px]">
                            <label className="text-sm text-gray-400 mb-2 block">Amount (USDsui)</label>
                            <Input
                              type="number"
                              value={depositAmountUsdsui}
                              onChange={(e) => setDepositAmountUsdsui(e.target.value)}
                              placeholder="e.g. 100"
                              className="bg-black/40 border-green-700/50 text-white"
                              min="1"
                              step="1"
                              data-testid="input-deposit-usdsui"
                            />
                          </div>
                          <Button
                            onClick={depositUsdsuiLiquidity}
                            disabled={depositingSui || depositingSbets || depositingUsdsui || userUsdsuiBalance === 0}
                            className="bg-green-700 hover:bg-green-600 text-white min-w-[180px]"
                            data-testid="button-deposit-usdsui"
                          >
                            {depositingUsdsui ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <DollarSign className="w-4 h-4 mr-2" />
                            )}
                            Deposit USDsui
                          </Button>
                        </div>
                        {userUsdsuiBalance === 0 && (
                          <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> No USDsui in admin wallet. Acquire USDsui first.
                          </p>
                        )}
                      </div>
                      
                      {platformInfo.treasurySui === 0 && (
                        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                          <p className="text-yellow-400 text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Treasury is empty! Deposit SUI to enable betting. Recommended: at least 10 SUI to start.
                          </p>
                        </div>
                      )}

                      {/* Bet Limits Controls */}
                      <div className="border-t border-cyan-500/20 pt-6 mt-6">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-cyan-400" />
                          Bet Limits & Platform Controls
                        </h3>
                        
                        {/* SUI Bet Limits */}
                        <div className="mb-6 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
                          <h4 className="text-md font-medium text-cyan-400 mb-3 flex items-center gap-2">
                            <Wallet className="w-4 h-4" />
                            SUI Bet Limits
                          </h4>
                          <div className="flex flex-wrap gap-4 items-end">
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Min Bet (SUI)</label>
                              <Input
                                type="number"
                                value={newMinBetSui}
                                onChange={(e) => setNewMinBetSui(e.target.value)}
                                placeholder="0.02"
                                className="bg-black/40 border-gray-700 text-white"
                                min="0.01"
                                step="0.01"
                                data-testid="input-min-bet-sui"
                              />
                            </div>
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Max Bet (SUI)</label>
                              <Input
                                type="number"
                                value={newMaxBetSui}
                                onChange={(e) => setNewMaxBetSui(e.target.value)}
                                placeholder="15"
                                className="bg-black/40 border-gray-700 text-white"
                                min="1"
                                step="0.1"
                                data-testid="input-max-bet-sui"
                              />
                            </div>
                            <Button
                              onClick={updateBetLimitsSui}
                              disabled={updatingLimitsSui}
                              className="bg-cyan-600 hover:bg-cyan-700 text-white min-w-[140px]"
                              data-testid="button-update-limits-sui"
                            >
                              {updatingLimitsSui ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : (
                                <TrendingUp className="w-4 h-4 mr-2" />
                              )}
                              Update SUI
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Current: Min {platformInfo.minBetSui} SUI | Max {platformInfo.maxBetSui} SUI
                          </p>
                        </div>
                        
                        {/* SBETS Bet Limits */}
                        <div className="mb-6 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                          <h4 className="text-md font-medium text-purple-400 mb-3 flex items-center gap-2">
                            <Coins className="w-4 h-4" />
                            SBETS Bet Limits
                          </h4>
                          <div className="flex flex-wrap gap-4 items-end">
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Min Bet (SBETS)</label>
                              <Input
                                type="number"
                                value={newMinBetSbets}
                                onChange={(e) => setNewMinBetSbets(e.target.value)}
                                placeholder="100"
                                className="bg-black/40 border-gray-700 text-white"
                                min="1"
                                step="1"
                                data-testid="input-min-bet-sbets"
                              />
                            </div>
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Max Bet (SBETS)</label>
                              <Input
                                type="number"
                                value={newMaxBetSbets}
                                onChange={(e) => setNewMaxBetSbets(e.target.value)}
                                placeholder="50000"
                                className="bg-black/40 border-gray-700 text-white"
                                min="100"
                                step="100"
                                data-testid="input-max-bet-sbets"
                              />
                            </div>
                            <Button
                              onClick={updateBetLimitsSbets}
                              disabled={updatingLimitsSbets}
                              className="bg-purple-600 hover:bg-purple-700 text-white min-w-[140px]"
                              data-testid="button-update-limits-sbets"
                            >
                              {updatingLimitsSbets ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : (
                                <TrendingUp className="w-4 h-4 mr-2" />
                              )}
                              Update SBETS
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Current: Min {platformInfo.minBetSbets} SBETS | Max {platformInfo.maxBetSbets} SBETS
                          </p>
                        </div>
                        
                        {/* Platform Pause Control */}
                        <div className="flex flex-wrap gap-4 items-center">
                          <Button
                            onClick={togglePlatformPause}
                            disabled={togglingPause}
                            className={platformInfo.paused 
                              ? "bg-green-600 hover:bg-green-700 text-white" 
                              : "bg-red-600 hover:bg-red-700 text-white"}
                            data-testid="button-toggle-pause"
                          >
                            {togglingPause ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : platformInfo.paused ? (
                              <CheckCircle className="w-4 h-4 mr-2" />
                            ) : (
                              <XCircle className="w-4 h-4 mr-2" />
                            )}
                            {platformInfo.paused ? 'Unpause Platform' : 'Pause Platform'}
                          </Button>
                          <span className="text-sm text-gray-400">
                            Platform Status: {platformInfo.paused ? 'PAUSED' : 'ACTIVE'}
                          </span>
                        </div>
                      </div>

                      {/* Settlement & Revenue Controls */}
                      <div className="border-t border-cyan-500/20 pt-6 mt-6">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                          <DollarSign className="w-5 h-5 text-yellow-400" />
                          Settlement & Revenue
                        </h3>
                        
                        <div className="flex flex-wrap gap-4 items-center mb-4">
                          <Button
                            onClick={triggerAutoSettlement}
                            disabled={triggeringSettlement}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            data-testid="button-trigger-settlement"
                          >
                            {triggeringSettlement ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <RefreshCw className="w-4 h-4 mr-2" />
                            )}
                            Trigger Auto-Settlement
                          </Button>
                          <span className="text-sm text-gray-400">
                            Checks finished matches and settles pending bets
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-4 items-end">
                          <Button
                            onClick={withdrawSuiFees}
                            disabled={withdrawingSuiFees || platformInfo.accruedFeesSui <= 0}
                            className="bg-cyan-600 hover:bg-cyan-700 text-white"
                            data-testid="button-withdraw-sui-fees"
                          >
                            {withdrawingSuiFees ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <Coins className="w-4 h-4 mr-2" />
                            )}
                            Withdraw SUI Fees ({platformInfo.accruedFeesSui.toFixed(4)})
                          </Button>
                          <Button
                            onClick={withdrawSbetsFees}
                            disabled={withdrawingSbetsFees || platformInfo.accruedFeesSbets <= 0}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            data-testid="button-withdraw-sbets-fees"
                          >
                            {withdrawingSbetsFees ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <Coins className="w-4 h-4 mr-2" />
                            )}
                            Withdraw SBETS Fees ({platformInfo.accruedFeesSbets.toFixed(4)})
                          </Button>
                        </div>
                        
                        <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                          <h4 className="text-sm font-medium text-white mb-2">How Revenue Works:</h4>
                          <ul className="text-xs text-gray-400 space-y-1">
                            <li>ALL platform revenue is split 30/40/30:</li>
                            <li className="ml-4">Lost bet stakes (full amount)</li>
                            <li className="ml-4">1% fee on winning bet profits</li>
                            <li className="mt-2">Distribution:</li>
                            <li className="ml-4">30% to SBETS Holders (revenue sharing pool)</li>
                            <li className="ml-4">40% to Treasury Buffer (liquidity)</li>
                            <li className="ml-4">30% to Platform Profit (admin withdrawable)</li>
                          </ul>
                        </div>

                        {/* P2P Fee Vault Live Snapshot */}
                        <div className="border-t border-emerald-500/20 pt-6 mt-6" data-testid="section-p2p-vault">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                              <Zap className="w-5 h-5 text-emerald-400" />
                              P2P Fee Vault (Live On-Chain)
                            </h3>
                            <Button
                              onClick={fetchP2PVault}
                              disabled={loadingP2PVault}
                              variant="outline"
                              className="border-emerald-600 text-emerald-400 hover:bg-emerald-900/30 text-xs h-8"
                            >
                              {loadingP2PVault ? (
                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="w-3 h-3 mr-1" />
                              )}
                              Refresh
                            </Button>
                          </div>

                          {p2pVaultFetchedAt && (
                            <p className="text-xs text-gray-500 mb-3">
                              Last fetched: {new Date(p2pVaultFetchedAt).toLocaleTimeString()}
                            </p>
                          )}

                          {!p2pVault && !loadingP2PVault && (
                            <p className="text-sm text-gray-400 italic mb-3">
                              Click Refresh to load live vault balances from the P2P contract.
                            </p>
                          )}

                          {loadingP2PVault && (
                            <div className="flex items-center gap-2 text-gray-400 text-sm mb-3">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Reading P2PConfig fee_vault from chain...
                            </div>
                          )}

                          {p2pVault && (
                            <div className="space-y-3">
                              {(
                                [
                                  { coin: 'SUI'    as const, balance: p2pVault.sui,         color: 'cyan',    decimals: 6 },
                                  { coin: 'SBETS'  as const, balance: p2pVault.sbets,        color: 'purple',  decimals: 4 },
                                  { coin: 'USDSUI' as const, balance: p2pVault.usdsui,       color: 'green',   decimals: 4 },
                                  { coin: 'USDC'   as const, balance: p2pVault.usdc   ?? 0,  color: 'emerald', decimals: 4 },
                                  { coin: 'LBTC'   as const, balance: p2pVault.lbtc   ?? 0,  color: 'orange',  decimals: 8 },
                                ] as const
                              ).map(({ coin, balance, color, decimals }) => (
                                <div
                                  key={coin}
                                  className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg bg-black/40 border border-${color}-500/20`}
                                >
                                  <div className="flex-1">
                                    <p className={`text-sm font-semibold text-${color}-300`}>{coin}</p>
                                    <p className={`text-xl font-mono font-bold text-${color}-400`}>
                                      {balance.toFixed(decimals)}
                                    </p>
                                    {balance <= 0 && (
                                      <p className="text-xs text-gray-500 mt-0.5">Vault empty</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={vaultWithdrawAmounts[coin]}
                                      onChange={e => setVaultWithdrawAmounts(prev => ({ ...prev, [coin]: e.target.value }))}
                                      placeholder={`Amount (max ${balance.toFixed(decimals)})`}
                                      className="w-44 h-8 text-xs bg-black/60 border-gray-600 text-white"
                                      disabled={withdrawingVaultCoin !== null}
                                    />
                                    <Button
                                      onClick={() => withdrawFromP2PVault(coin)}
                                      disabled={
                                        withdrawingVaultCoin !== null ||
                                        balance <= 0 ||
                                        !vaultWithdrawAmounts[coin] ||
                                        parseFloat(vaultWithdrawAmounts[coin]) <= 0
                                      }
                                      className={`h-8 text-xs bg-${color}-700 hover:bg-${color}-600 text-white whitespace-nowrap`}
                                    >
                                      {withdrawingVaultCoin === coin ? (
                                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                      ) : (
                                        <Wallet className="w-3 h-3 mr-1" />
                                      )}
                                      Withdraw
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* SUI Betting Pause/Unpause (Server-side) */}
                        <div className="border-t border-cyan-500/20 pt-6 mt-6" data-testid="section-sui-betting-pause">
                          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-yellow-400" />
                            SUI Betting Pause/Unpause (Server-side)
                          </h3>
                          <div className="flex flex-wrap items-center gap-4">
                            <Badge variant={suiBettingPaused ? 'destructive' : 'default'} data-testid="badge-sui-betting-status">
                              {suiBettingPaused === null ? 'Loading...' : suiBettingPaused ? 'SUI Betting PAUSED' : 'SUI Betting ACTIVE'}
                            </Badge>
                            <Button
                              onClick={async () => {
                                setTogglingSuiPause(true);
                                try {
                                  if (!confirm('Toggle SUI betting pause?')) { setTogglingSuiPause(false); return; }
                                  const response = await fetch('/api/admin/toggle-sui-pause', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                                    body: JSON.stringify({})
                                  });
                                  if (response.ok) {
                                    const result = await response.json();
                                    setSuiBettingPaused(result.suiBettingPaused);
                                    toast({ title: 'SUI Betting Status Updated', description: result.message || `SUI betting is now ${result.suiBettingPaused ? 'PAUSED' : 'ACTIVE'}` });
                                  } else {
                                    const error = await response.json();
                                    toast({ title: 'Toggle Failed', description: error.message, variant: 'destructive' });
                                  }
                                } catch (error) {
                                  toast({ title: 'Error', description: 'Failed to toggle SUI betting pause', variant: 'destructive' });
                                }
                                setTogglingSuiPause(false);
                              }}
                              disabled={togglingSuiPause}
                              className={suiBettingPaused ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}
                              data-testid="button-toggle-sui-pause"
                            >
                              {togglingSuiPause ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
                              {suiBettingPaused ? 'Unpause SUI Betting' : 'Pause SUI Betting'}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={async () => {
                                try {
                                  const response = await fetch('/api/betting-status');
                                  if (response.ok) {
                                    const data = await response.json();
                                    setSuiBettingPaused(data.suiBettingPaused);
                                    toast({ title: 'Status Refreshed', description: `SUI Betting: ${data.suiBettingPaused ? 'PAUSED' : 'ACTIVE'}` });
                                  }
                                } catch { /* ignore */ }
                              }}
                              data-testid="button-refresh-sui-pause-status"
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Refresh Status
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">This pauses SUI betting on the server. Separate from the on-chain platform pause above.</p>
                        </div>

                        {/* Treasury Withdraw */}
                        <div className="border-t border-cyan-500/20 pt-6 mt-6" data-testid="section-treasury-withdraw">
                          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <Wallet className="w-5 h-5 text-cyan-400" />
                            Treasury Withdraw
                          </h3>
                          <div className="flex flex-wrap gap-4">
                            <Button
                              onClick={async () => {
                                if (!confirm('Trigger treasury withdrawal?')) return;
                                setTriggeringTreasuryWithdraw(true);
                                try {
                                  const response = await fetch('/api/admin/treasury-withdraw-now', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                                    body: JSON.stringify({})
                                  });
                                  if (response.ok) {
                                    const result = await response.json();
                                    toast({ title: 'Treasury Withdrawal', description: result.message || 'Withdrawal triggered successfully' });
                                  } else {
                                    const error = await response.json();
                                    toast({ title: 'Withdrawal Failed', description: error.message, variant: 'destructive' });
                                  }
                                } catch (error) {
                                  toast({ title: 'Error', description: 'Failed to trigger treasury withdrawal', variant: 'destructive' });
                                }
                                setTriggeringTreasuryWithdraw(false);
                              }}
                              disabled={triggeringTreasuryWithdraw}
                              className="bg-cyan-600 hover:bg-cyan-700 text-white"
                              data-testid="button-treasury-withdraw"
                            >
                              {triggeringTreasuryWithdraw ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
                              Trigger Treasury Withdrawal
                            </Button>
                            <Button
                              onClick={async () => {
                                if (!confirm('Pay all unpaid winners?')) return;
                                setPayingUnpaidWinners(true);
                                try {
                                  const response = await fetch('/api/admin/pay-unpaid-winners', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                                    body: JSON.stringify({})
                                  });
                                  if (response.ok) {
                                    const result = await response.json();
                                    toast({ title: 'Pay Unpaid Winners', description: result.message || 'Payment triggered successfully' });
                                  } else {
                                    const error = await response.json();
                                    toast({ title: 'Payment Failed', description: error.message, variant: 'destructive' });
                                  }
                                } catch (error) {
                                  toast({ title: 'Error', description: 'Failed to pay unpaid winners', variant: 'destructive' });
                                }
                                setPayingUnpaidWinners(false);
                              }}
                              disabled={payingUnpaidWinners}
                              className="bg-green-600 hover:bg-green-700 text-white"
                              data-testid="button-pay-unpaid-winners"
                            >
                              {payingUnpaidWinners ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Coins className="w-4 h-4 mr-2" />}
                              Pay Unpaid Winners
                            </Button>
                          </div>
                        </div>

                        {/* Predictions Management — Full Admin Panel */}
                        <div className="border-t border-cyan-500/20 pt-6 mt-6">
                          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-green-400" />
                            Prediction Markets Management
                          </h3>

                          {/* Action Buttons Row */}
                          <div className="flex flex-wrap gap-2 mb-4">
                            <Button
                              variant="outline"
                              onClick={async () => {
                                setLoadingPredictions(true);
                                try {
                                  const response = await fetch('/api/admin/predictions/all', {
                                    headers: { 'Authorization': `Bearer ${getToken()}` }
                                  });
                                  if (response.ok) {
                                    const data = await response.json();
                                    setAllPredictions(data.predictions || data || []);
                                    toast({ title: 'Loaded', description: `${(data.predictions || data || []).length} predictions found` });
                                  } else {
                                    const error = await response.json();
                                    toast({ title: 'Load Failed', description: error.message, variant: 'destructive' });
                                  }
                                } catch (error) {
                                  toast({ title: 'Error', description: 'Failed to fetch predictions', variant: 'destructive' });
                                }
                                setLoadingPredictions(false);
                              }}
                              disabled={loadingPredictions}
                            >
                              {loadingPredictions ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                              Load Markets
                            </Button>
                            <Button
                              variant="outline"
                              className="border-green-500/50 text-green-400 hover:bg-green-500/10"
                              onClick={async () => {
                                if (!confirm('Trigger prediction market re-seed? This will expire old markets and create new ones from live sports data.')) return;
                                setSeedingPredictions(true);
                                try {
                                  const response = await fetch('/api/admin/predictions/seed', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }
                                  });
                                  if (response.ok) {
                                    const data = await response.json();
                                    toast({ title: 'Seed Complete', description: `Total markets: ${data.totalMarkets}` });
                                    setLoadingPredictions(true);
                                    const r2 = await fetch('/api/admin/predictions/all', { headers: { 'Authorization': `Bearer ${getToken()}` } });
                                    if (r2.ok) { const d2 = await r2.json(); setAllPredictions(d2.predictions || d2 || []); }
                                    setLoadingPredictions(false);
                                  } else {
                                    const error = await response.json();
                                    toast({ title: 'Seed Failed', description: error.message, variant: 'destructive' });
                                  }
                                } catch (error) {
                                  toast({ title: 'Error', description: 'Seed operation failed', variant: 'destructive' });
                                }
                                setSeedingPredictions(false);
                              }}
                              disabled={seedingPredictions}
                            >
                              {seedingPredictions ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Flame className="w-4 h-4 mr-2" />}
                              Seed Markets
                            </Button>
                          </div>

                          {/* Stats Summary Cards */}
                          {allPredictions.length > 0 && (() => {
                            const active = allPredictions.filter(p => p.status === 'active').length;
                            const resolvedYes = allPredictions.filter(p => p.status === 'resolved_yes').length;
                            const resolvedNo = allPredictions.filter(p => p.status === 'resolved_no').length;
                            const expired = allPredictions.filter(p => p.status === 'expired').length;
                            const cancelled = allPredictions.filter(p => p.status === 'cancelled').length;
                            const totalVolume = allPredictions.reduce((s: number, p: any) => s + Number(p.totalVolume || p.totalYesAmount || 0) + Number(p.totalNoAmount || 0), 0);
                            const totalParticipants = allPredictions.reduce((s: number, p: any) => s + Number(p.totalParticipants || 0), 0);
                            const onchain = allPredictions.filter(p => p.onchainMarketId).length;
                            return (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-green-400">{active}</p>
                                  <p className="text-xs text-gray-400">Active</p>
                                </div>
                                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-blue-400">{resolvedYes + resolvedNo}</p>
                                  <p className="text-xs text-gray-400">Resolved ({resolvedYes}Y / {resolvedNo}N)</p>
                                </div>
                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-yellow-400">{expired}</p>
                                  <p className="text-xs text-gray-400">Expired</p>
                                </div>
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-red-400">{cancelled}</p>
                                  <p className="text-xs text-gray-400">Cancelled</p>
                                </div>
                                <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-cyan-400">{allPredictions.length}</p>
                                  <p className="text-xs text-gray-400">Total Markets</p>
                                </div>
                                <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-purple-400">{totalVolume > 1000 ? `${(totalVolume/1000).toFixed(1)}K` : totalVolume.toLocaleString()}</p>
                                  <p className="text-xs text-gray-400">Total Volume</p>
                                </div>
                                <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-orange-400">{totalParticipants}</p>
                                  <p className="text-xs text-gray-400">Total Bettors</p>
                                </div>
                                <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-center">
                                  <p className="text-2xl font-bold text-indigo-400">{onchain}</p>
                                  <p className="text-xs text-gray-400">On-Chain</p>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Filters & Search */}
                          {allPredictions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                              <div className="flex gap-1 flex-wrap">
                                {['all', 'active', 'resolved_yes', 'resolved_no', 'expired', 'cancelled'].map(f => (
                                  <button
                                    key={f}
                                    onClick={() => setPredictionFilter(f)}
                                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                                      predictionFilter === f
                                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'
                                    }`}
                                  >
                                    {f === 'all' ? 'All' : f === 'resolved_yes' ? 'Resolved YES' : f === 'resolved_no' ? 'Resolved NO' : f.charAt(0).toUpperCase() + f.slice(1)}
                                  </button>
                                ))}
                              </div>
                              <Input
                                placeholder="Search by title..."
                                value={predictionSearch}
                                onChange={(e: any) => setPredictionSearch(e.target.value)}
                                className="w-48 h-8 text-xs bg-gray-800 border-gray-600"
                              />
                            </div>
                          )}

                          {/* Market List */}
                          {allPredictions.length > 0 && (() => {
                            let filtered = allPredictions;
                            if (predictionFilter !== 'all') {
                              filtered = filtered.filter(p => p.status === predictionFilter);
                            }
                            if (predictionSearch.trim()) {
                              const q = predictionSearch.toLowerCase();
                              filtered = filtered.filter(p => (p.title || p.question || '').toLowerCase().includes(q));
                            }
                            return (
                              <div className="mb-6">
                                <h4 className="text-sm font-medium text-gray-400 mb-2">
                                  Showing {filtered.length} of {allPredictions.length} markets
                                </h4>
                                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                                  {filtered.map((pred: any) => {
                                    const isActive = pred.status === 'active';
                                    const isExpanded = predictionExpanded === pred.id;
                                    const endDate = pred.endDate ? new Date(pred.endDate) : null;
                                    const isExpired = endDate && endDate < new Date();
                                    const statusColor = pred.status === 'active' ? 'border-green-500/40' :
                                      pred.status === 'resolved_yes' ? 'border-blue-500/40' :
                                      pred.status === 'resolved_no' ? 'border-red-500/40' :
                                      pred.status === 'expired' ? 'border-yellow-500/40' :
                                      pred.status === 'cancelled' ? 'border-gray-500/40' : 'border-gray-700';
                                    const yesAmt = Number(pred.totalYesAmount || 0);
                                    const noAmt = Number(pred.totalNoAmount || 0);
                                    const yesRes = Number(pred.yesReserve || 0);
                                    const noRes = Number(pred.noReserve || 0);
                                    const totalRes = yesRes + noRes;
                                    const yesPrice = totalRes > 0 ? (noRes / totalRes) : 0.5;
                                    const noPrice = totalRes > 0 ? (yesRes / totalRes) : 0.5;

                                    return (
                                      <div key={pred.id} className={`bg-gray-900/60 rounded-lg border ${statusColor} overflow-hidden`}>
                                        {/* Main Row */}
                                        <div
                                          className="p-3 cursor-pointer hover:bg-gray-800/40 transition-colors"
                                          onClick={() => setPredictionExpanded(isExpanded ? null : pred.id)}
                                        >
                                          <div className="flex items-center gap-3">
                                            {/* Team logos */}
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                              {pred.homeLogo && (
                                                <img src={pred.homeLogo} alt="" className="w-6 h-6 rounded-full object-cover" onError={(e: any) => e.target.style.display='none'} />
                                              )}
                                              {pred.awayLogo && (
                                                <img src={pred.awayLogo} alt="" className="w-6 h-6 rounded-full object-cover" onError={(e: any) => e.target.style.display='none'} />
                                              )}
                                            </div>

                                            {/* Title & meta */}
                                            <div className="flex-1 min-w-0">
                                              <p className="text-sm text-white font-medium truncate">{pred.title || pred.question || `#${pred.id}`}</p>
                                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                                <Badge
                                                  className={`text-[10px] px-1.5 py-0 ${
                                                    pred.status === 'active' ? 'bg-green-500/20 text-green-300 border-green-500/30' :
                                                    pred.status === 'resolved_yes' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                                                    pred.status === 'resolved_no' ? 'bg-red-500/20 text-red-300 border-red-500/30' :
                                                    pred.status === 'expired' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' :
                                                    'bg-gray-500/20 text-gray-300 border-gray-500/30'
                                                  }`}
                                                >
                                                  {pred.status}
                                                </Badge>
                                                {pred.category && (
                                                  <span className="text-[10px] text-gray-500 uppercase">{pred.category}</span>
                                                )}
                                                <span className="text-[10px] text-gray-500">{pred.currency || 'SBETS'}</span>
                                                {pred.onchainMarketId && (
                                                  <Badge className="text-[10px] px-1.5 py-0 bg-indigo-500/20 text-indigo-300 border-indigo-500/30">ON-CHAIN</Badge>
                                                )}
                                                {isExpired && isActive && (
                                                  <Badge className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-300 border-orange-500/30">PAST END DATE</Badge>
                                                )}
                                              </div>
                                            </div>

                                            {/* AMM prices */}
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                              <div className="text-center">
                                                <p className="text-xs font-mono text-green-400">{(yesPrice * 100).toFixed(0)}c</p>
                                                <p className="text-[10px] text-gray-500">YES</p>
                                              </div>
                                              <div className="text-center">
                                                <p className="text-xs font-mono text-red-400">{(noPrice * 100).toFixed(0)}c</p>
                                                <p className="text-[10px] text-gray-500">NO</p>
                                              </div>
                                            </div>

                                            {/* Settlement Buttons — visible for active markets */}
                                            {(isActive || pred.status === 'expired') && (
                                              <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                  size="sm"
                                                  className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                                                  onClick={async () => {
                                                    if (!confirm(`Resolve "${(pred.title || '').slice(0, 50)}" as YES?\n\nThis will also resolve on-chain if applicable.`)) return;
                                                    setResolvingPrediction(pred.id);
                                                    try {
                                                      const response = await fetch('/api/admin/predictions/resolve', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                                                        body: JSON.stringify({ predictionId: pred.id, winner: 'yes' })
                                                      });
                                                      const result = await response.json();
                                                      if (response.ok) {
                                                        toast({ title: 'Resolved YES', description: result.onchainTxHash ? `On-chain TX: ${result.onchainTxHash.slice(0, 16)}...` : result.message });
                                                        setAllPredictions(prev => prev.map(p => p.id === pred.id ? { ...p, status: 'resolved_yes', resolvedOutcome: 'yes' } : p));
                                                      } else {
                                                        toast({ title: 'Resolve Failed', description: result.message, variant: 'destructive' });
                                                      }
                                                    } catch (error) {
                                                      toast({ title: 'Error', description: 'Failed to resolve', variant: 'destructive' });
                                                    }
                                                    setResolvingPrediction(null);
                                                  }}
                                                  disabled={resolvingPrediction === pred.id}
                                                >
                                                  {resolvingPrediction === pred.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle className="w-3 h-3 mr-1" />YES</>}
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  className="h-7 px-2 text-xs bg-red-600 hover:bg-red-700 text-white"
                                                  onClick={async () => {
                                                    if (!confirm(`Resolve "${(pred.title || '').slice(0, 50)}" as NO?\n\nThis will also resolve on-chain if applicable.`)) return;
                                                    setResolvingPrediction(pred.id);
                                                    try {
                                                      const response = await fetch('/api/admin/predictions/resolve', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                                                        body: JSON.stringify({ predictionId: pred.id, winner: 'no' })
                                                      });
                                                      const result = await response.json();
                                                      if (response.ok) {
                                                        toast({ title: 'Resolved NO', description: result.onchainTxHash ? `On-chain TX: ${result.onchainTxHash.slice(0, 16)}...` : result.message });
                                                        setAllPredictions(prev => prev.map(p => p.id === pred.id ? { ...p, status: 'resolved_no', resolvedOutcome: 'no' } : p));
                                                      } else {
                                                        toast({ title: 'Resolve Failed', description: result.message, variant: 'destructive' });
                                                      }
                                                    } catch (error) {
                                                      toast({ title: 'Error', description: 'Failed to resolve', variant: 'destructive' });
                                                    }
                                                    setResolvingPrediction(null);
                                                  }}
                                                  disabled={resolvingPrediction === pred.id}
                                                >
                                                  {resolvingPrediction === pred.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><XCircle className="w-3 h-3 mr-1" />NO</>}
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  className="h-7 px-2 text-xs border-gray-500 text-gray-400 hover:bg-gray-700"
                                                  onClick={async () => {
                                                    if (!confirm(`Cancel "${(pred.title || '').slice(0, 50)}"?`)) return;
                                                    setCancellingPrediction(pred.id);
                                                    try {
                                                      const response = await fetch('/api/admin/predictions/cancel', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                                                        body: JSON.stringify({ predictionId: pred.id })
                                                      });
                                                      const result = await response.json();
                                                      if (response.ok) {
                                                        toast({ title: 'Cancelled', description: result.onchainTxHash ? `On-chain TX: ${result.onchainTxHash.slice(0, 16)}...` : result.message });
                                                        setAllPredictions(prev => prev.map(p => p.id === pred.id ? { ...p, status: 'cancelled' } : p));
                                                      } else {
                                                        toast({ title: 'Cancel Failed', description: result.message, variant: 'destructive' });
                                                      }
                                                    } catch (error) {
                                                      toast({ title: 'Error', description: 'Failed to cancel', variant: 'destructive' });
                                                    }
                                                    setCancellingPrediction(null);
                                                  }}
                                                  disabled={cancellingPrediction === pred.id}
                                                >
                                                  {cancellingPrediction === pred.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Cancel'}
                                                </Button>
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Expanded Details */}
                                        {isExpanded && (
                                          <div className="px-3 pb-3 border-t border-gray-700/50 pt-3 space-y-3">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                              <div>
                                                <p className="text-gray-500 mb-1">ID</p>
                                                <p className="text-white font-mono">#{pred.id}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">End Date</p>
                                                <p className="text-white">{endDate ? endDate.toLocaleString() : 'N/A'}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">Category</p>
                                                <p className="text-white capitalize">{pred.category || 'N/A'}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">Currency</p>
                                                <p className="text-white">{pred.currency || 'SBETS'}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">YES Bets</p>
                                                <p className="text-green-400 font-mono">{yesAmt.toLocaleString()}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">NO Bets</p>
                                                <p className="text-red-400 font-mono">{noAmt.toLocaleString()}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">YES Reserve</p>
                                                <p className="text-green-400 font-mono">{yesRes.toLocaleString()}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">NO Reserve</p>
                                                <p className="text-red-400 font-mono">{noRes.toLocaleString()}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">Total Volume</p>
                                                <p className="text-cyan-400 font-mono">{Number(pred.totalVolume || 0).toLocaleString()}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">Participants</p>
                                                <p className="text-white font-mono">{pred.totalParticipants || 0}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">Initial Liquidity</p>
                                                <p className="text-white font-mono">{Number(pred.initialLiquidity || 0).toLocaleString()}</p>
                                              </div>
                                              <div>
                                                <p className="text-gray-500 mb-1">Creator</p>
                                                <p className="text-white font-mono truncate" title={pred.creatorWallet}>{(pred.creatorWallet || 'N/A').slice(0, 12)}...</p>
                                              </div>
                                            </div>

                                            {/* On-chain Info */}
                                            <div className="p-2 bg-gray-800/50 rounded-lg">
                                              <p className="text-gray-500 text-xs mb-1">On-Chain Market</p>
                                              {pred.onchainMarketId ? (
                                                <div className="flex items-center gap-2">
                                                  <p className="text-indigo-300 text-xs font-mono truncate flex-1">{pred.onchainMarketId}</p>
                                                  <a
                                                    href={`https://suiscan.xyz/mainnet/object/${pred.onchainMarketId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] text-cyan-400 hover:text-cyan-300 underline flex-shrink-0"
                                                  >
                                                    View on SuiScan
                                                  </a>
                                                </div>
                                              ) : (
                                                <p className="text-gray-500 text-xs italic">Not created on-chain yet</p>
                                              )}
                                            </div>

                                            {/* Event ID */}
                                            {pred.eventId && (
                                              <div className="p-2 bg-gray-800/50 rounded-lg">
                                                <p className="text-gray-500 text-xs mb-1">Sports Event ID</p>
                                                <p className="text-white text-xs font-mono">{pred.eventId}</p>
                                              </div>
                                            )}

                                            {/* Resolved outcome */}
                                            {pred.resolvedOutcome && (
                                              <div className={`p-2 rounded-lg ${pred.resolvedOutcome === 'yes' ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                                                <p className="text-xs font-medium text-white">
                                                  Resolved: <span className={pred.resolvedOutcome === 'yes' ? 'text-blue-400' : 'text-red-400'}>{pred.resolvedOutcome.toUpperCase()}</span>
                                                  {pred.resolvedAt && <span className="text-gray-400 ml-2">at {new Date(pred.resolvedAt).toLocaleString()}</span>}
                                                </p>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Challenges Section */}
                          <div className="mt-6 pt-4 border-t border-gray-700/50">
                            <div className="flex items-center gap-2 mb-3">
                              <h4 className="text-sm font-medium text-white">Challenges</h4>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7"
                                onClick={async () => {
                                  setLoadingChallenges(true);
                                  try {
                                    const response = await fetch('/api/admin/challenges/all', {
                                      headers: { 'Authorization': `Bearer ${getToken()}` }
                                    });
                                    if (response.ok) {
                                      const data = await response.json();
                                      setAllChallenges(data.challenges || data || []);
                                      toast({ title: 'Loaded', description: `${(data.challenges || data || []).length} challenges` });
                                    }
                                  } catch (error) {
                                    toast({ title: 'Error', description: 'Failed to fetch challenges', variant: 'destructive' });
                                  }
                                  setLoadingChallenges(false);
                                }}
                                disabled={loadingChallenges}
                              >
                                {loadingChallenges ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                                Load
                              </Button>
                            </div>
                            {allChallenges.length > 0 && (
                              <div className="space-y-2 max-h-48 overflow-y-auto">
                                {allChallenges.map((challenge: any, index: number) => (
                                  <div key={challenge.id || index} className="p-2 bg-gray-900/50 rounded-lg border border-gray-700 flex items-center justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-white truncate">{challenge.question || challenge.title || `Challenge #${challenge.id}`}</p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <Badge variant={challenge.status === 'active' || challenge.status === 'open' ? 'default' : 'secondary'} className="text-[10px] px-1 py-0">{challenge.status}</Badge>
                                        <span className="text-[10px] text-gray-500">Pool: {Number(challenge.pool || challenge.totalPool || 0).toLocaleString()} SBETS</span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {allPredictions.length === 0 && allChallenges.length === 0 && !loadingPredictions && !loadingChallenges && (
                            <p className="text-sm text-gray-500 mt-4">Click "Load Markets" to view all prediction markets.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t border-red-500/20 pt-6 mt-6">
                      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-red-400 flex items-center gap-2">
                          <XCircle className="w-5 h-5" />
                          Wrong wallet connected. Connect the admin wallet to deposit liquidity.
                        </p>
                        <p className="text-gray-500 text-sm mt-2">
                          Admin wallet: {ADMIN_WALLET.slice(0, 10)}...{ADMIN_WALLET.slice(-8)}
                        </p>
                        <p className="text-gray-500 text-sm">
                          Connected: {currentAccount.address.slice(0, 10)}...{currentAccount.address.slice(-8)}
                        </p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="border-t border-gray-700 pt-6 mt-6">
                    <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg text-center">
                      <p className="text-gray-400 mb-3">Connect your admin wallet to deposit liquidity</p>
                      <ConnectButton />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400">Failed to load platform info</p>
            )}
          </CardContent>
        </Card>

        {/* P2P Management Section */}
        {isAuthenticated && (
          <Card className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 border-emerald-500/30 mb-8">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-xl text-white flex items-center gap-2">
                <GitMerge className="w-6 h-6 text-emerald-400" />
                P2P Betting Management
                <span className="text-xs font-normal text-emerald-400/70 ml-1">On-chain only · no custodial</span>
              </CardTitle>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={fetchP2PRevenue} disabled={loadingP2PRevenue}
                  className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-900/30">
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingP2PRevenue ? 'animate-spin' : ''}`} /> Stats
                </Button>
                <Button size="sm" onClick={triggerP2PSettle} disabled={settlingP2P}
                  className="bg-emerald-700 hover:bg-emerald-600 text-white">
                  {settlingP2P ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                  Run Settlement
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Revenue snapshot */}
              {p2pRevenueStats ? (
                <div className="space-y-3">
                  {/* Top-line totals */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-black/40 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Total Volume (all)</p>
                      <p className="text-lg font-bold text-emerald-400">{(p2pRevenueStats.totalVolumeSui ?? 0).toFixed(3)}</p>
                    </div>
                    <div className="bg-black/40 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Platform Fees (all)</p>
                      <p className="text-lg font-bold text-cyan-400">{(p2pRevenueStats.totalPlatformFeeSui ?? 0).toFixed(4)}</p>
                    </div>
                    <div className="bg-black/40 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Open Offers</p>
                      <p className="text-lg font-bold text-white">{p2pRevenueStats.openOffersCount ?? 0}</p>
                    </div>
                    <div className="bg-black/40 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Settled Bets</p>
                      <p className="text-lg font-bold text-white">{p2pRevenueStats.totalSettledBets ?? 0}</p>
                    </div>
                  </div>

                  {/* Per-currency breakdown */}
                  {Array.isArray(p2pRevenueStats.currencyBreakdown) && p2pRevenueStats.currencyBreakdown.length > 0 && (
                    <div className="bg-black/30 rounded-lg p-3 border border-emerald-500/20">
                      <p className="text-gray-400 text-xs font-semibold mb-2 uppercase tracking-wide">Fees by Currency</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 border-b border-gray-700/50">
                              <th className="text-left pb-1 pr-4">Currency</th>
                              <th className="text-right pb-1 pr-4">Fees Collected</th>
                              <th className="text-right pb-1 pr-4">Volume</th>
                              <th className="text-right pb-1">Bets Settled</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p2pRevenueStats.currencyBreakdown.map((row: any) => {
                              const colorMap: Record<string, string> = {
                                SUI: 'text-blue-400',
                                SBETS: 'text-purple-400',
                                USDC: 'text-green-400',
                                USDSUI: 'text-emerald-400',
                              };
                              const color = colorMap[row.currency] ?? 'text-white';
                              return (
                                <tr key={row.currency} className="border-b border-gray-800/50 last:border-0">
                                  <td className={`py-1 pr-4 font-bold ${color}`}>{row.currency}</td>
                                  <td className="py-1 pr-4 text-right text-cyan-300">{Number(row.fees ?? 0).toFixed(4)}</td>
                                  <td className="py-1 pr-4 text-right text-gray-300">{Number(row.volume ?? 0).toFixed(3)}</td>
                                  <td className="py-1 text-right text-gray-400">{row.count ?? 0}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Revenue tracker shares (from revenueController) */}
                      {revenueController?.allTime && (
                        <div className="mt-3 pt-3 border-t border-gray-700/50">
                          <p className="text-gray-500 text-xs font-semibold mb-2 uppercase tracking-wide">Revenue Tracker — Fee Distribution (25% each)</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {(['SUI','SBETS','USDC','USDSUI'] as const).map(cur => {
                              const gross = revenueController.allTime[`gross${cur === 'SUI' ? 'Sui' : cur === 'SBETS' ? 'Sbets' : cur === 'USDC' ? 'Usdc' : 'Usdsui'}`] ?? 0;
                              if (gross === 0) return null;
                              const holders  = revenueController.allTime[`holders${cur === 'SUI' ? 'Sui' : cur === 'SBETS' ? 'Sbets' : cur === 'USDC' ? 'Usdc' : 'Usdsui'}`] ?? 0;
                              const lp       = revenueController.allTime[`lp${cur === 'SUI' ? 'Sui' : cur === 'SBETS' ? 'Sbets' : cur === 'USDC' ? 'Usdc' : 'Usdsui'}`] ?? 0;
                              const treasury = revenueController.allTime[`treasury${cur === 'SUI' ? 'Sui' : cur === 'SBETS' ? 'Sbets' : cur === 'USDC' ? 'Usdc' : 'Usdsui'}`] ?? 0;
                              const profit   = revenueController.allTime[`profit${cur === 'SUI' ? 'Sui' : cur === 'SBETS' ? 'Sbets' : cur === 'USDC' ? 'Usdc' : 'Usdsui'}`] ?? 0;
                              const colorMap: Record<string, string> = { SUI: 'text-blue-400', SBETS: 'text-purple-400', USDC: 'text-green-400', USDSUI: 'text-emerald-400' };
                              return (
                                <div key={cur} className="bg-black/30 rounded p-2 text-xs space-y-0.5">
                                  <p className={`font-bold ${colorMap[cur]}`}>{cur} — {Number(gross).toFixed(4)}</p>
                                  <p className="text-gray-400">Holders: <span className="text-white">{Number(holders).toFixed(4)}</span></p>
                                  <p className="text-gray-400">LP: <span className="text-white">{Number(lp).toFixed(4)}</span></p>
                                  <p className="text-gray-400">Treasury: <span className="text-white">{Number(treasury).toFixed(4)}</span></p>
                                  <p className="text-gray-400">Profit: <span className="text-white">{Number(profit).toFixed(4)}</span></p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm mb-2">Click Stats to load P2P revenue overview</p>
                  <Button size="sm" onClick={fetchP2PRevenue} className="bg-emerald-700 hover:bg-emerald-600 text-white">
                    Load Stats
                  </Button>
                </div>
              )}

              {/* Void reason input */}
              <div className="flex items-center gap-2 pt-2 border-t border-emerald-500/20">
                <span className="text-xs text-gray-400 whitespace-nowrap">Void reason (optional):</span>
                <input
                  type="text"
                  placeholder="e.g. match postponed, dispute resolved"
                  value={p2pVoidReason}
                  onChange={e => setP2pVoidReason(e.target.value)}
                  className="flex-1 text-xs bg-black/40 border border-gray-700 rounded px-3 py-1.5 text-white"
                />
              </div>

              {/* Single Bet Offers */}
              <div className="border-t border-emerald-500/20 pt-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <GitMerge className="w-4 h-4 text-emerald-400" />
                    Single Bet Offers
                    {p2pTotalOffers > 0 && <span className="text-xs text-gray-400">({p2pTotalOffers} total)</span>}
                  </h3>
                  <div className="flex gap-2 items-center">
                    <Filter className="w-3.5 h-3.5 text-gray-500" />
                    {(['all', 'open', 'partial', 'filled', 'settled', 'cancelled', 'expired', 'voided'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => { setP2pOfferStatusFilter(s); fetchP2POffers(s); }}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${p2pOfferStatusFilter === s ? 'bg-emerald-600 text-white border-emerald-500' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                      >{s}</button>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => fetchP2POffers()} disabled={loadingP2POffers}
                      className="border-gray-700 text-gray-400 h-7 px-2">
                      <RefreshCw className={`w-3 h-3 ${loadingP2POffers ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>

                {p2pOffers.length === 0 ? (
                  <div className="text-center py-6 bg-black/20 rounded-lg border border-dashed border-gray-700">
                    <p className="text-gray-500 text-sm">{loadingP2POffers ? 'Loading...' : 'No offers found. Click refresh to load.'}</p>
                    {!loadingP2POffers && p2pOffers.length === 0 && (
                      <Button size="sm" onClick={() => fetchP2POffers()} className="mt-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs">Load Offers</Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {p2pOffers.map((offer: any) => (
                      <div key={offer.id} className="bg-black/40 rounded-lg border border-gray-800 overflow-hidden">
                        <div
                          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/[0.02]"
                          onClick={() => setP2pExpandedOffer(p2pExpandedOffer === offer.id ? null : offer.id)}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-white text-xs font-mono">#{offer.id}</span>
                            <span className={statusBadgeClass(offer.status)}>{offer.status}</span>
                            <span className="text-gray-300 text-xs truncate">{offer.eventName}</span>
                            <span className="text-gray-500 text-xs">{offer.prediction}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-emerald-400 text-xs font-mono">{offer.creatorStake} {offer.currency}</span>
                            {['open', 'partial', 'expired'].includes(offer.status) && offer.onchainOfferId && (
                              <Button
                                size="sm"
                                disabled={forceExpiringId === offer.id}
                                onClick={e => { e.stopPropagation(); forceExpireOffer(offer.id); }}
                                title="Force on-chain expire now — skips the 5-minute settlement cycle"
                                className="bg-amber-700 hover:bg-amber-600 text-white h-6 px-2 text-xs"
                              >
                                {forceExpiringId === offer.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <Zap className="w-3 h-3 mr-1" />}
                                Expire
                              </Button>
                            )}
                            {['open', 'partial', 'filled'].includes(offer.status) && (
                              <Button
                                size="sm"
                                disabled={voidingP2PId === `b-${offer.onchainOfferId ?? offer.id}`}
                                onClick={e => { e.stopPropagation(); voidP2POffer(offer.onchainOfferId ?? String(offer.id)); }}
                                className="bg-red-700 hover:bg-red-600 text-white h-6 px-2 text-xs"
                              >
                                {voidingP2PId === `b-${offer.onchainOfferId ?? offer.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3 mr-1" />}
                                Void
                              </Button>
                            )}
                            {p2pExpandedOffer === offer.id ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                          </div>
                        </div>
                        {p2pExpandedOffer === offer.id && (
                          <div className="px-3 pb-3 pt-1 border-t border-gray-800 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div><span className="text-gray-500 block">Creator</span><span className="text-white font-mono break-all">{offer.creatorWallet?.slice(0, 16)}...</span></div>
                            <div><span className="text-gray-500 block">Odds</span><span className="text-white">{offer.odds}x</span></div>
                            <div><span className="text-gray-500 block">Taker Stake</span><span className="text-white">{offer.takerStake ?? '-'} {offer.currency}</span></div>
                            <div><span className="text-gray-500 block">Filled</span><span className="text-white">{offer.filledStake ?? 0} {offer.currency}</span></div>
                            <div><span className="text-gray-500 block">Winner</span><span className={`font-medium ${offer.winner === 'creator' ? 'text-emerald-400' : offer.winner === 'taker' ? 'text-cyan-400' : 'text-gray-400'}`}>{offer.winner ?? 'pending'}</span></div>
                            <div><span className="text-gray-500 block">Fee</span><span className="text-white">{offer.platformFee ?? 0} {offer.currency}</span></div>
                            {offer.onchainOfferId && (
                              <div className="col-span-2">
                                <span className="text-gray-500 block">On-chain ID</span>
                                <a href={`https://suiscan.xyz/mainnet/object/${offer.onchainOfferId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-mono text-[10px] flex items-center gap-1">
                                  {offer.onchainOfferId.slice(0, 20)}... <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                            {offer.settledTxHash && (
                              <div className="col-span-2">
                                <span className="text-gray-500 block">Settlement TX (Walrus receipt)</span>
                                <a href={`https://suiscan.xyz/mainnet/tx/${offer.settledTxHash}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline font-mono text-[10px] flex items-center gap-1">
                                  {offer.settledTxHash.slice(0, 20)}... <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                            <div className="col-span-2"><span className="text-gray-500 block">Expires</span><span className="text-white">{offer.expiresAt ? new Date(offer.expiresAt).toLocaleString() : '-'}</span></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Parlay Offers */}
              <div className="border-t border-emerald-500/20 pt-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <GitMerge className="w-4 h-4 text-cyan-400" />
                    Parlay Offers
                    {p2pTotalParlays > 0 && <span className="text-xs text-gray-400">({p2pTotalParlays} total)</span>}
                  </h3>
                  <div className="flex gap-2 items-center">
                    <Filter className="w-3.5 h-3.5 text-gray-500" />
                    {(['all', 'open', 'filled', 'settled', 'cancelled', 'voided'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => { setP2pParlayStatusFilter(s); fetchP2PParlays(s); }}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${p2pParlayStatusFilter === s ? 'bg-cyan-600 text-white border-cyan-500' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                      >{s}</button>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => fetchP2PParlays()} disabled={loadingP2PParlays}
                      className="border-gray-700 text-gray-400 h-7 px-2">
                      <RefreshCw className={`w-3 h-3 ${loadingP2PParlays ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>

                {p2pParlays.length === 0 ? (
                  <div className="text-center py-6 bg-black/20 rounded-lg border border-dashed border-gray-700">
                    <p className="text-gray-500 text-sm">{loadingP2PParlays ? 'Loading...' : 'No parlays found. Click refresh to load.'}</p>
                    {!loadingP2PParlays && (
                      <Button size="sm" onClick={() => fetchP2PParlays()} className="mt-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs">Load Parlays</Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {p2pParlays.map((parlay: any) => (
                      <div key={parlay.id} className="bg-black/40 rounded-lg border border-gray-800 overflow-hidden">
                        <div
                          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/[0.02]"
                          onClick={() => setP2pExpandedParlay(p2pExpandedParlay === parlay.id ? null : parlay.id)}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-white text-xs font-mono">#{parlay.id}</span>
                            <span className={statusBadgeClass(parlay.status)}>{parlay.status}</span>
                            <span className="text-gray-300 text-xs">Parlay · {parlay.legCount ?? '?'} legs</span>
                            <span className="text-gray-500 text-xs">×{Number(parlay.totalOdds ?? 0).toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-cyan-400 text-xs font-mono">{parlay.creatorStake} {parlay.currency}</span>
                            {['open', 'filled', 'settling'].includes(parlay.status) && (
                              <Button
                                size="sm"
                                disabled={voidingP2PId === `p-${parlay.onchainParlayId ?? parlay.id}`}
                                onClick={e => { e.stopPropagation(); voidP2POffer(parlay.onchainParlayId ?? String(parlay.id), true); }}
                                className="bg-red-700 hover:bg-red-600 text-white h-6 px-2 text-xs"
                              >
                                {voidingP2PId === `p-${parlay.onchainParlayId ?? parlay.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3 mr-1" />}
                                Void
                              </Button>
                            )}
                            {p2pExpandedParlay === parlay.id ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                          </div>
                        </div>
                        {p2pExpandedParlay === parlay.id && (
                          <div className="px-3 pb-3 pt-1 border-t border-gray-800 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div><span className="text-gray-500 block">Creator</span><span className="text-white font-mono">{parlay.creatorWallet?.slice(0, 16)}...</span></div>
                            <div><span className="text-gray-500 block">Taker Stake</span><span className="text-white">{parlay.takerStake ?? '-'} {parlay.currency}</span></div>
                            <div><span className="text-gray-500 block">Winner</span><span className={`font-medium ${parlay.winner === 'creator' ? 'text-emerald-400' : parlay.winner === 'taker' ? 'text-cyan-400' : 'text-gray-400'}`}>{parlay.winner ?? 'pending'}</span></div>
                            <div><span className="text-gray-500 block">Fee</span><span className="text-white">{parlay.platformFee ?? 0} {parlay.currency}</span></div>
                            {parlay.onchainParlayId && (
                              <div className="col-span-2">
                                <span className="text-gray-500 block">On-chain ID</span>
                                <a href={`https://suiscan.xyz/mainnet/object/${parlay.onchainParlayId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-mono text-[10px] flex items-center gap-1">
                                  {parlay.onchainParlayId.slice(0, 20)}... <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                            {parlay.settledTxHash && (
                              <div className="col-span-2">
                                <span className="text-gray-500 block">Settlement TX (Walrus receipt)</span>
                                <a href={`https://suiscan.xyz/mainnet/tx/${parlay.settledTxHash}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline font-mono text-[10px] flex items-center gap-1">
                                  {parlay.settledTxHash.slice(0, 20)}... <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </CardContent>
          </Card>
        )}

        {/* Admin Login Section */}
        {!isAuthenticated ? (
          <Card className="w-full max-w-md mx-auto bg-black/60 border-cyan-500/30">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-cyan-400" />
              </div>
              <CardTitle className="text-2xl text-white">Bet Management</CardTitle>
              <p className="text-gray-400 mt-2">Enter password to manage bets</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type="password"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="pl-10 bg-black/40 border-gray-700 text-white"
                  data-testid="input-admin-password"
                />
              </div>
              <Button 
                onClick={handleLogin} 
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
                data-testid="button-admin-login"
              >
                Login
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
                <Card className="bg-black/40 border-gray-700">
                  <CardContent className="p-4 text-center">
                    <p className="text-gray-400 text-sm">Total Bets</p>
                    <p className="text-2xl font-bold text-white" data-testid="stat-total">{stats.total}</p>
                  </CardContent>
                </Card>
                <Card className="bg-yellow-500/10 border-yellow-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-yellow-400 text-sm">Pending</p>
                    <p className="text-2xl font-bold text-yellow-300" data-testid="stat-pending">{stats.pending}</p>
                  </CardContent>
                </Card>
                <Card className="bg-green-500/10 border-green-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-green-400 text-sm">Won</p>
                    <p className="text-2xl font-bold text-green-300" data-testid="stat-won">{stats.won}</p>
                  </CardContent>
                </Card>
                <Card className="bg-red-500/10 border-red-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-red-400 text-sm">Lost</p>
                    <p className="text-2xl font-bold text-red-300" data-testid="stat-lost">{stats.lost}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gray-500/10 border-gray-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-gray-400 text-sm">Void</p>
                    <p className="text-2xl font-bold text-gray-300" data-testid="stat-void">{stats.void}</p>
                  </CardContent>
                </Card>
                <Card className="bg-purple-500/10 border-purple-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-purple-400 text-sm">Total Stake</p>
                    <p className="text-xl font-bold text-purple-300" data-testid="stat-total-stake">{stats.totalStake.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card className="bg-cyan-500/10 border-cyan-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-cyan-400 text-sm">Potential Win</p>
                    <p className="text-xl font-bold text-cyan-300" data-testid="stat-potential-win">{stats.totalPotentialWin.toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {stats && stats.pending > 0 && (
              <Card className="bg-yellow-500/10 border-yellow-500/30 mb-6">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-yellow-400">Bulk Settlement</h3>
                      <p className="text-yellow-300/70 text-sm">{stats.pending} pending bets can be settled</p>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => settleAllPending('won')} 
                        className="bg-green-600 hover:bg-green-700"
                        disabled={loading}
                        data-testid="button-settle-all-won"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" /> Settle All Won
                      </Button>
                      <Button 
                        onClick={() => settleAllPending('lost')} 
                        className="bg-red-600 hover:bg-red-700"
                        disabled={loading}
                        data-testid="button-settle-all-lost"
                      >
                        <XCircle className="w-4 h-4 mr-2" /> Settle All Lost
                      </Button>
                      <Button 
                        onClick={() => settleAllPending('void')} 
                        variant="outline"
                        className="border-gray-500 text-gray-300"
                        disabled={loading}
                        data-testid="button-settle-all-void"
                      >
                        Void All
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2 mb-6 flex-wrap">
              {['all', 'pending', 'won', 'lost', 'void'].map((status) => (
                <Button
                  key={status}
                  onClick={() => setFilter(status)}
                  variant={filter === status ? 'default' : 'outline'}
                  className={filter === status ? 'bg-cyan-600' : 'border-gray-600 text-gray-300'}
                  data-testid={`filter-${status}`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              </div>
            ) : bets.length === 0 ? (
              <Card className="bg-black/40 border-gray-700">
                <CardContent className="p-12 text-center">
                  <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                  <p className="text-gray-400">No bets found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {bets.map((bet) => (
                  <Card key={bet.id} className="bg-black/40 border-gray-700 hover:border-cyan-500/30 transition-colors" data-testid={`bet-card-${bet.id}`}>
                    <CardContent className="p-4">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            {getStatusBadge(bet.status)}
                            <Badge variant="outline" className="border-gray-600 text-gray-400">
                              {bet.betType}
                            </Badge>
                            <span className="text-gray-500 text-sm">ID: {bet.id}</span>
                          </div>
                          <h3 className="text-white font-medium">{bet.eventName}</h3>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <span className="text-gray-400">Selection: <span className="text-cyan-400">{bet.selection}</span></span>
                            <span className="text-gray-400">Odds: <span className="text-white">{bet.odds?.toFixed(2)}</span></span>
                            <span className="text-gray-400">Stake: <span className="text-green-400">{bet.stake?.toFixed(2)} {bet.currency}</span></span>
                            <span className="text-gray-400">Potential: <span className="text-yellow-400">{bet.potentialWin?.toFixed(2)} {bet.currency}</span></span>
                          </div>
                          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                            <span>Wallet: {bet.walletAddress?.slice(0, 10)}...</span>
                            <span>Placed: {new Date(bet.placedAt).toLocaleString()}</span>
                            {bet.settledAt && <span>Settled: {new Date(bet.settledAt).toLocaleString()}</span>}
                          </div>
                        </div>
                        
                        {bet.status === 'pending' && (
                          <div className="flex gap-2 flex-shrink-0">
                            <Button
                              onClick={() => settleBet(bet.id, 'won')}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              disabled={settling === bet.id}
                              data-testid={`settle-won-${bet.id}`}
                            >
                              {settling === bet.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            </Button>
                            <Button
                              onClick={() => settleBet(bet.id, 'lost')}
                              size="sm"
                              className="bg-red-600 hover:bg-red-700"
                              disabled={settling === bet.id}
                              data-testid={`settle-lost-${bet.id}`}
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                            <Button
                              onClick={() => settleBet(bet.id, 'void')}
                              size="sm"
                              variant="outline"
                              className="border-gray-500"
                              disabled={settling === bet.id}
                              data-testid={`settle-void-${bet.id}`}
                            >
                              Void
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Liability Caps Section */}
        <div className="border-t border-red-500/20 pt-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-red-400 flex items-center gap-2">
              <span>🛡️</span> Per-Event Liability Caps
            </h2>
            <button
              onClick={fetchExposure}
              disabled={loadingExposure}
              className="text-xs px-3 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
            >
              {loadingExposure ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Prevents one-sided book risk. When total potential payout exposure on any side reaches the cap, the oracle stops signing new bets for that side/event. Default caps apply to all events unless overridden.
          </p>

          {/* Default Caps */}
          {exposureData && (
            <Card className="bg-black/40 border-red-500/20 mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-red-300">Default Side Caps (per event, per currency)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(exposureData.defaults || {}).map(([currency, cap]) => (
                    <div key={currency} className="bg-black/40 rounded p-3">
                      <p className="text-xs text-gray-400 mb-1">{currency} per side</p>
                      <p className="text-white font-bold">{Number(cap).toLocaleString()}</p>
                      <div className="flex gap-1 mt-2">
                        <input
                          type="number"
                          placeholder="New cap"
                          value={capInputs[`default_${currency}`] ?? ''}
                          onChange={e => setCapInputs(prev => ({ ...prev, [`default_${currency}`]: e.target.value }))}
                          className="w-full text-xs bg-black/60 border border-gray-700 rounded px-2 py-1 text-white"
                        />
                        <button
                          onClick={async () => {
                            const val = capInputs[`default_${currency}`];
                            if (!val) return;
                            const token = sessionStorage.getItem('adminToken') || '';
                            await fetch('/api/admin/default-caps', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                              body: JSON.stringify({ currency, cap: Number(val) }),
                            });
                            toast({ title: 'Default cap updated', description: `${currency} → ${val}` });
                            setCapInputs(prev => ({ ...prev, [`default_${currency}`]: '' }));
                            fetchExposure();
                          }}
                          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                        >Set</button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!exposureData && !loadingExposure && (
            <Card className="bg-black/40 border-gray-700 mb-4">
              <CardContent className="p-6 text-center text-gray-400">
                <p className="mb-3">No exposure data loaded yet. Click Refresh to load.</p>
                <button onClick={fetchExposure} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm">
                  Load Exposure Data
                </button>
              </CardContent>
            </Card>
          )}

          {/* Per-event exposure table */}
          {exposureData?.events?.length > 0 && (
            <Card className="bg-black/40 border-red-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-red-300">Active Event Exposures ({exposureData.events.length} events with bets)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 max-h-96 overflow-y-auto">
                {exposureData.events.map((ev: any) => {
                  const cap = ev.caps.SUI;
                  const maxSide = Math.max(ev.exposure.home, ev.exposure.draw, ev.exposure.away);
                  const pct = cap > 0 ? Math.min(100, (maxSide / cap) * 100) : 0;
                  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';
                  return (
                    <div key={ev.eventId} className="bg-black/40 rounded p-3 border border-gray-800">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-white text-sm font-medium">{ev.eventName}</p>
                          <p className="text-xs text-gray-500">ID: {ev.eventId} · Last bet: {ev.lastBet ? new Date(ev.lastBet).toLocaleTimeString() : 'N/A'}</p>
                        </div>
                        <button
                          onClick={() => resetEventExposure(ev.eventId)}
                          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded ml-2"
                        >
                          Reset
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2 text-center text-xs">
                        {(['home', 'draw', 'away'] as const).map(side => (
                          <div key={side} className={`rounded p-1 ${ev.exposure[side] / cap >= 0.9 ? 'bg-red-900/40' : ev.exposure[side] / cap >= 0.7 ? 'bg-yellow-900/40' : 'bg-black/40'}`}>
                            <p className="text-gray-400 capitalize">{side}</p>
                            <p className="text-white font-mono">{ev.exposure[side].toFixed(2)}</p>
                            <p className="text-gray-500">/ {ev.caps.SUI} SUI</p>
                          </div>
                        ))}
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2">
                        <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Override SUI cap:</span>
                        <input
                          type="number"
                          placeholder={String(cap)}
                          value={capInputs[ev.eventId] ?? ''}
                          onChange={e => setCapInputs(prev => ({ ...prev, [ev.eventId]: e.target.value }))}
                          className="w-24 text-xs bg-black/60 border border-gray-700 rounded px-2 py-1 text-white"
                        />
                        <button
                          disabled={settingCap}
                          onClick={() => {
                            const val = capInputs[ev.eventId];
                            if (val !== undefined && val !== '') setEventCap(ev.eventId, 'SUI', Number(val));
                          }}
                          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                        >
                          Set
                        </button>
                        <button
                          onClick={() => setEventCap(ev.eventId, 'SUI', null)}
                          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
                        >
                          Reset to default
                        </button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {exposureData?.events?.length === 0 && (
            <p className="text-sm text-gray-500 italic">No bets placed yet — exposure tracking starts on first oracle-signed bet.</p>
          )}
        </div>

        {/* ── PULSE Pools Admin ─────────────────────────────────────────── */}
        <div className="border-t border-violet-500/20 pt-6 mt-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-xl font-bold text-violet-400 flex items-center gap-2">
              <Zap className="w-5 h-5" />
              PULSE Pools — Live Status
            </h2>
            <div className="flex items-center gap-2">
              {pulsePools.length > 0 && (
                <span className="text-xs text-gray-500">
                  {pulsePools.filter(p => p.status === 0).length} open ·{' '}
                  {pulsePools.filter(p => p.status === 1).length} locked ·{' '}
                  {pulsePools.filter(p => p.status === 2).length} settled ·{' '}
                  {pulsePools.filter(p => p.status === 3).length} voided
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={fetchPulsePools}
                disabled={loadingPulsePools}
                className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 h-7 px-3"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingPulsePools ? 'animate-spin' : ''}`} />
                {pulsePools.length === 0 ? 'Load Pools' : 'Refresh'}
              </Button>
            </div>
          </div>

          <p className="text-sm text-gray-400 mb-4">
            Pari-mutuel pools — lock before match starts, settle with winner, void if event is cancelled. Actions are signed on-chain by the oracle wallet.
          </p>

          {/* Oracle key input */}
          <div className="flex items-center gap-3 mb-5 p-3 bg-black/30 rounded-lg border border-violet-500/20">
            <Shield className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <span className="text-xs text-gray-400 whitespace-nowrap">Oracle key:</span>
            <input
              type="password"
              placeholder="Enter ADMIN_PASSWORD / oracle key…"
              value={pulseOracleKey}
              onChange={e => setPulseOracleKey(e.target.value)}
              className="flex-1 text-sm bg-black/50 border border-gray-700 rounded px-3 py-1.5 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
            />
            {pulseOracleKey && (
              <span className="text-xs text-green-400 whitespace-nowrap flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> set
              </span>
            )}
          </div>

          {/* Error state */}
          {pulsePoolsError && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded-lg mb-4 text-sm text-red-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {pulsePoolsError}
            </div>
          )}

          {/* Empty state */}
          {!loadingPulsePools && pulsePools.length === 0 && !pulsePoolsError && (
            <div className="text-center py-10 bg-black/20 rounded-lg border border-dashed border-violet-500/20">
              <Zap className="w-8 h-8 text-violet-500/40 mx-auto mb-3" />
              <p className="text-gray-500 text-sm mb-3">Click Load Pools to fetch live on-chain state for all 9 PULSE pools</p>
              <Button onClick={fetchPulsePools} className="bg-violet-700 hover:bg-violet-600 text-white text-sm">
                Load Pools
              </Button>
            </div>
          )}

          {/* Loading skeleton */}
          {loadingPulsePools && pulsePools.length === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="bg-black/30 border border-gray-800 rounded-xl p-4 animate-pulse">
                  <div className="h-4 bg-gray-700 rounded w-3/4 mb-3" />
                  <div className="h-3 bg-gray-800 rounded w-1/2 mb-2" />
                  <div className="h-8 bg-gray-800 rounded mt-4" />
                </div>
              ))}
            </div>
          )}

          {/* Pool cards */}
          {pulsePools.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {pulsePools.map((pool: any) => {
                const statusColors: Record<string, string> = {
                  OPEN:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
                  LOCKED:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
                  SETTLED:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
                  VOIDED:   'bg-gray-500/20 text-gray-400 border-gray-500/30',
                  NOT_FOUND:'bg-red-500/20 text-red-300 border-red-500/30',
                };
                const statusDot: Record<string, string> = {
                  OPEN: 'bg-emerald-400', LOCKED: 'bg-amber-400', SETTLED: 'bg-blue-400', VOIDED: 'bg-gray-500',
                };
                const sc = statusColors[pool.statusName] ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30';
                const isActing = (action: string) => pulseActionId === `${action}-${pool.poolId}`;
                const anyActing = ['lock','settle','void'].some(a => pulseActionId === `${a}-${pool.poolId}`);
                const totalStaked = (pool.sideAStaked ?? 0) + (pool.sideBStaked ?? 0);
                const sideAPct = totalStaked > 0 ? (pool.sideAStaked / totalStaked) * 100 : 50;

                return (
                  <Card key={pool.poolId} className={`bg-black/40 border ${pool.status === 0 ? 'border-emerald-500/20' : pool.status === 1 ? 'border-amber-500/20' : 'border-gray-800'} rounded-xl overflow-hidden`}>
                    <CardContent className="p-4 space-y-3">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-white font-semibold text-sm truncate">
                            {pool.sideA || '—'} <span className="text-gray-500">vs</span> {pool.sideB || '—'}
                          </p>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {pool.eventId || pool.poolId?.slice(0, 14) + '…'}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1 flex-shrink-0 ${sc}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusDot[pool.statusName] ?? 'bg-gray-500'}`} />
                          {pool.statusName}
                        </span>
                      </div>

                      {/* Stakes */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-gray-400">
                          <span className="truncate max-w-[45%]">{pool.sideA || 'Side A'}</span>
                          <span className="truncate max-w-[45%] text-right">{pool.sideB || 'Side B'}</span>
                        </div>
                        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden flex">
                          <div className="bg-emerald-500 h-full transition-all" style={{ width: `${sideAPct}%` }} />
                          <div className="bg-cyan-500 h-full transition-all flex-1" />
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-emerald-400">{pool.sideAStaked?.toFixed(3)} SUI</span>
                          <span className="text-gray-500">{pool.positionCount} positions · {totalStaked.toFixed(3)} total</span>
                          <span className="text-cyan-400">{pool.sideBStaked?.toFixed(3)} SUI</span>
                        </div>
                      </div>

                      {/* Settle winner selector (only shown when LOCKED) */}
                      {pool.status === 1 && (
                        <div className="flex gap-1.5 p-2 bg-amber-900/10 rounded-lg border border-amber-500/20">
                          <span className="text-xs text-gray-400 self-center mr-1 whitespace-nowrap">Winner:</span>
                          <button
                            onClick={() => setPulseSettleWinner(prev => ({ ...prev, [pool.poolId]: 0 }))}
                            className={`flex-1 text-xs py-1 rounded transition-colors ${pulseSettleWinner[pool.poolId] === 0 ? 'bg-emerald-600 text-white' : 'bg-black/40 text-gray-400 hover:bg-emerald-900/30 hover:text-emerald-300'}`}
                          >
                            {pool.sideA || 'A'}
                          </button>
                          <button
                            onClick={() => setPulseSettleWinner(prev => ({ ...prev, [pool.poolId]: 1 }))}
                            className={`flex-1 text-xs py-1 rounded transition-colors ${pulseSettleWinner[pool.poolId] === 1 ? 'bg-cyan-600 text-white' : 'bg-black/40 text-gray-400 hover:bg-cyan-900/30 hover:text-cyan-300'}`}
                          >
                            {pool.sideB || 'B'}
                          </button>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-1.5 pt-1">
                        {/* LOCK — only for OPEN pools */}
                        {pool.status === 0 && (
                          <Button
                            size="sm"
                            disabled={anyActing}
                            onClick={() => pulsePoolAction(pool.poolId, 'lock')}
                            className="flex-1 bg-amber-700 hover:bg-amber-600 text-white h-7 text-xs"
                          >
                            {isActing('lock') ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3 mr-1" />}
                            Lock
                          </Button>
                        )}

                        {/* SETTLE — only for LOCKED pools */}
                        {pool.status === 1 && (
                          <Button
                            size="sm"
                            disabled={anyActing || pulseSettleWinner[pool.poolId] === undefined}
                            onClick={() => pulsePoolAction(pool.poolId, 'settle', pulseSettleWinner[pool.poolId])}
                            title={pulseSettleWinner[pool.poolId] === undefined ? 'Select winner above first' : ''}
                            className="flex-1 bg-blue-700 hover:bg-blue-600 text-white h-7 text-xs disabled:opacity-50"
                          >
                            {isActing('settle') ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                            Settle
                          </Button>
                        )}

                        {/* VOID — for OPEN or LOCKED pools */}
                        {(pool.status === 0 || pool.status === 1) && (
                          <Button
                            size="sm"
                            disabled={anyActing}
                            onClick={() => pulsePoolAction(pool.poolId, 'void')}
                            className="flex-1 bg-red-800 hover:bg-red-700 text-white h-7 text-xs"
                          >
                            {isActing('void') ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3 mr-1" />}
                            Void
                          </Button>
                        )}

                        {/* Suiscan link */}
                        <a
                          href={`https://suiscan.xyz/mainnet/object/${pool.poolId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center w-7 h-7 rounded bg-black/30 border border-gray-700 hover:border-gray-500 text-gray-500 hover:text-gray-300 flex-shrink-0 transition-colors"
                          title="View on Suiscan"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      {/* Settled/Voided — read-only label */}
                      {(pool.status === 2 || pool.status === 3) && (
                        <p className="text-center text-xs text-gray-600 italic">
                          {pool.status === 2 ? '✓ Settled — payouts available on-chain' : '✗ Voided — refunds available on-chain'}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}

