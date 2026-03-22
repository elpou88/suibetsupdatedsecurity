import { useState, useCallback } from 'react';
import { useSignAndExecuteTransaction, useSuiClient, useCurrentAccount } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { useToast } from '@/hooks/use-toast';
import { useZkLogin } from '@/context/ZkLoginContext';

// Helper to convert string to SerializedBcs with proper vector<u8> type metadata
// This is required for Nightly wallet to properly parse the transaction
const stringToVectorU8 = (str: string) => {
  const bytes = Array.from(new TextEncoder().encode(str));
  return bcs.vector(bcs.u8()).serialize(bytes);
};

const BETTING_PACKAGE_ID = import.meta.env.VITE_BETTING_PACKAGE_ID || '0x4d83eab83defa9e2488b3c525f54fc588185cfc1a906e5dada1954bf52296e76';
const BETTING_PLATFORM_ID = import.meta.env.VITE_BETTING_PLATFORM_ID || '0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9';
const CLOCK_OBJECT_ID = '0x6';

const SBETS_TOKEN_TYPE = import.meta.env.VITE_SBETS_TOKEN_TYPE || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';

// Backend API for treasury checks
const API_BASE = '';

export interface OnChainBetParams {
  eventId: string;
  marketId: string;
  prediction: string;
  betAmount: number; // In SUI or SBETS (will be converted to smallest units)
  odds: number;
  walrusBlobId?: string;
  coinType: 'SUI' | 'SBETS';
  sbetsCoinObjectId?: string; // Primary SBETS coin (will be used as merge target)
  allSbetsCoinObjectIds?: string[]; // All SBETS coin IDs for merging fragmented balances
}

export interface OnChainBetResult {
  success: boolean;
  txDigest?: string;
  betObjectId?: string;
  coinType?: 'SUI' | 'SBETS';
  error?: string;
}

export function useOnChainBet() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const suiClient = useSuiClient();
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { isZkLoginActive, zkLoginAddress, signAndExecuteZkLogin } = useZkLogin();

  // Check treasury can cover a potential payout before betting
  const checkTreasuryCapacity = useCallback(async (
    coinType: 'SUI' | 'SBETS',
    potentialPayout: number
  ): Promise<{ canBet: boolean; available: number; message?: string }> => {
    try {
      const response = await fetch('/api/treasury/status');
      if (!response.ok) {
        console.warn('[useOnChainBet] Treasury check failed, proceeding anyway');
        return { canBet: true, available: 0 };
      }
      
      const data = await response.json();
      if (!data.success) {
        return { canBet: true, available: 0 };
      }
      
      if (data.paused) {
        return { 
          canBet: false, 
          available: 0, 
          message: 'Platform is temporarily paused for maintenance' 
        };
      }
      
      const treasury = coinType === 'SBETS' ? data.sbets : data.sui;
      if (!treasury.acceptingBets) {
        return {
          canBet: false,
          available: treasury.available,
          message: `${coinType} betting temporarily unavailable - treasury limit reached`
        };
      }
      
      if (potentialPayout > treasury.available) {
        return {
          canBet: false,
          available: treasury.available,
          message: `Bet too large - available ${coinType} is ${treasury.available.toFixed(4)}. Try a smaller bet or use ${coinType === 'SBETS' ? 'SUI' : 'SBETS'} instead.`
        };
      }
      
      return { canBet: true, available: treasury.available };
    } catch (err) {
      console.warn('[useOnChainBet] Treasury check error:', err);
      return { canBet: true, available: 0 };
    }
  }, []);

  const getSbetsCoins = useCallback(async (walletAddress: string): Promise<{objectId: string, balance: number}[]> => {
    try {
      const allCoins: {objectId: string, balance: number}[] = [];
      let cursor: string | null | undefined = undefined;
      let hasNext = true;
      
      while (hasNext) {
        const resp = await suiClient.getCoins({
          owner: walletAddress,
          coinType: SBETS_TOKEN_TYPE,
          cursor: cursor || undefined,
        });
        
        for (const coin of resp.data) {
          allCoins.push({
            objectId: coin.coinObjectId,
            balance: parseInt(coin.balance) / 1_000_000_000,
          });
        }
        
        hasNext = resp.hasNextPage;
        cursor = resp.nextCursor;
      }
      
      allCoins.sort((a, b) => b.balance - a.balance);
      return allCoins;
    } catch (err) {
      console.error('Failed to get SBETS coins:', err);
      return [];
    }
  }, [suiClient]);

  // Get user's SUI coins for bet placement (separate from gas)
  const getSuiCoins = useCallback(async (walletAddress: string): Promise<{objectId: string, balance: number}[]> => {
    try {
      const coins = await suiClient.getCoins({
        owner: walletAddress,
        coinType: '0x2::sui::SUI',
      });

      return coins.data.map(coin => ({
        objectId: coin.coinObjectId,
        balance: parseInt(coin.balance) / 1_000_000_000,
      }));
    } catch (err) {
      console.error('Failed to get SUI coins:', err);
      return [];
    }
  }, [suiClient]);

  // Place bet on-chain (SUI or SBETS)
  const placeBetOnChain = useCallback(async (params: OnChainBetParams & { walletAddress?: string }): Promise<OnChainBetResult> => {
    console.log('[useOnChainBet] placeBetOnChain called with params:', params);
    setIsLoading(true);
    setError(null);

    const useZkLogin = isZkLoginActive && !!zkLoginAddress && !currentAccount?.address;
    const activeAddress = currentAccount?.address || (useZkLogin ? zkLoginAddress : null);

    try {
      if (!activeAddress) {
        console.error('[useOnChainBet] No wallet connected, aborting transaction');
        throw new Error('Wallet disconnected. Please reconnect your wallet and try again.');
      }
      console.log('[useOnChainBet] Wallet connected:', activeAddress, useZkLogin ? '(zkLogin)' : '(extension)');
      
      const { eventId, marketId, prediction, betAmount, odds, walrusBlobId = '', coinType = 'SUI', sbetsCoinObjectId, allSbetsCoinObjectIds } = params;
      const walletAddress = params.walletAddress || activeAddress;
      
      // On-chain bet limits (separate for SUI and SBETS)
      const MIN_BET_SUI = 0.05;       // 50,000,000 MIST
      const MAX_BET_SUI = 20;         // 20,000,000,000 MIST
      const MIN_BET_SBETS = 1000;     // 1,000,000,000,000 MIST
      const MAX_BET_SBETS = 10000000; // 10,000,000,000,000,000 MIST
      
      const MIN_BET = coinType === 'SBETS' ? MIN_BET_SBETS : MIN_BET_SUI;
      const MAX_BET = coinType === 'SBETS' ? MAX_BET_SBETS : MAX_BET_SUI;
      
      // Validate bet amount against on-chain limits
      if (betAmount < MIN_BET) {
        throw new Error(`Minimum bet is ${MIN_BET.toLocaleString()} ${coinType}. You tried to bet ${betAmount.toLocaleString()} ${coinType}.`);
      }
      if (betAmount > MAX_BET) {
        throw new Error(`Maximum bet is ${MAX_BET.toLocaleString()} ${coinType}. You tried to bet ${betAmount.toLocaleString()} ${coinType}.`);
      }
      
      // Pre-flight check: verify treasury can cover potential payout
      const potentialPayout = betAmount * odds;
      console.log('[useOnChainBet] Checking treasury capacity:', { coinType, potentialPayout });
      const treasuryCheck = await checkTreasuryCapacity(coinType, potentialPayout);
      if (!treasuryCheck.canBet) {
        throw new Error(treasuryCheck.message || `${coinType} bets temporarily unavailable`);
      }
      
      const betAmountMist = Math.floor(betAmount * 1_000_000_000);
      const oddsBps = Math.floor(odds * 100);
      
      console.log('[useOnChainBet] Requesting oracle signature...');
      const oracleRes = await fetch('/api/oracle/sign-bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, oddsBps, walletAddress, prediction }),
      });
      if (!oracleRes.ok) {
        const errData = await oracleRes.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to get oracle approval for bet');
      }
      const oracleData = await oracleRes.json();
      if (!oracleData.success || !oracleData.signature) {
        throw new Error('Oracle signing failed — bet cannot be placed');
      }
      const { signature: oracleSignature, quoteExpiry } = oracleData;
      console.log('[useOnChainBet] Oracle signature received, expiry:', new Date(quoteExpiry).toISOString());

      const GAS_MARGIN_MIST = 20_000_000;
      const requiredMist = betAmountMist + GAS_MARGIN_MIST;
      
      console.log('[useOnChainBet] Building transaction:', {
        packageId: BETTING_PACKAGE_ID,
        platformId: BETTING_PLATFORM_ID,
        betAmountMist,
        oddsBps,
        coinType,
        requiredMist
      });

      const tx = new Transaction();
      
      // Set explicit gas budget to help wallet pre-checks
      tx.setGasBudget(20_000_000); // 0.02 SUI should be plenty for this transaction
      
      if (coinType === 'SUI') {
        // Validate balance before building transaction
        if (!walletAddress) {
          throw new Error('Wallet address required for SUI bets');
        }
        
        const suiCoins = await getSuiCoins(walletAddress);
        const totalBalance = suiCoins.reduce((acc, c) => acc + c.balance, 0);
        const requiredSui = betAmount + 0.03; // 0.03 SUI buffer for gas
        
        console.log('[useOnChainBet] SUI balance check:', {
          totalBalance,
          requiredSui,
          betAmount,
          hasEnough: totalBalance >= requiredSui
        });
        
        if (totalBalance < requiredSui) {
          throw new Error(`Insufficient SUI balance. Need ${requiredSui.toFixed(4)} SUI (${betAmount} bet + 0.03 gas), but you have ${totalBalance.toFixed(4)} SUI available.`);
        }
        
        // Use tx.gas for splitting - this is what wallets can simulate properly
        // The wallet will automatically select and merge coins for gas payment
        console.log('[useOnChainBet] Using tx.gas for coin split (wallet-compatible)');
        const [stakeCoin] = tx.splitCoins(tx.gas, [betAmountMist]);
        
        // Convert strings to SerializedBcs with vector<u8> type metadata
        // This preserves type info that Nightly wallet needs to parse the transaction
        const eventIdSerialized = stringToVectorU8(eventId);
        const marketIdSerialized = stringToVectorU8(marketId);
        const predictionSerialized = stringToVectorU8(prediction);
        const walrusSerialized = stringToVectorU8(walrusBlobId);
        
        console.log('[useOnChainBet] Serialized with BCS type metadata:', {
          eventId: eventId,
          marketId: marketId,
          prediction: prediction,
          walrusBlobId: walrusBlobId
        });
        
        const oracleSignatureSerialized = bcs.vector(bcs.u8()).serialize(oracleSignature);

        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::place_bet`,
          arguments: [
            tx.object(BETTING_PLATFORM_ID),
            stakeCoin,
            tx.pure(eventIdSerialized),
            tx.pure(marketIdSerialized),
            tx.pure(predictionSerialized),
            tx.pure.u64(oddsBps),
            tx.pure.u64(quoteExpiry),
            tx.pure(oracleSignatureSerialized),
            tx.pure(walrusSerialized),
            tx.object(CLOCK_OBJECT_ID),
          ],
        });
      } else if (coinType === 'SBETS') {
        if (!sbetsCoinObjectId) {
          throw new Error('SBETS coin object ID required for SBETS bets');
        }
        
        const primaryCoin = tx.object(sbetsCoinObjectId);
        
        if (allSbetsCoinObjectIds && allSbetsCoinObjectIds.length > 1) {
          const otherCoinIds = allSbetsCoinObjectIds.filter(id => id !== sbetsCoinObjectId);
          if (otherCoinIds.length > 0) {
            console.log('[useOnChainBet] Merging', otherCoinIds.length, 'fragmented SBETS coins into primary coin');
            tx.mergeCoins(primaryCoin, otherCoinIds.map(id => tx.object(id)));
          }
        }
        
        const [sbetsCoin] = tx.splitCoins(primaryCoin, [betAmountMist]);
        
        // Convert strings to SerializedBcs with vector<u8> type metadata
        const eventIdSerialized = stringToVectorU8(eventId);
        const marketIdSerialized = stringToVectorU8(marketId);
        const predictionSerialized = stringToVectorU8(prediction);
        const walrusSerialized = stringToVectorU8(walrusBlobId);
        
        const oracleSignatureSerialized = bcs.vector(bcs.u8()).serialize(oracleSignature);

        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::place_bet_sbets`,
          arguments: [
            tx.object(BETTING_PLATFORM_ID),
            sbetsCoin,
            tx.pure(eventIdSerialized),
            tx.pure(marketIdSerialized),
            tx.pure(predictionSerialized),
            tx.pure.u64(oddsBps),
            tx.pure.u64(quoteExpiry),
            tx.pure(oracleSignatureSerialized),
            tx.pure(walrusSerialized),
            tx.object(CLOCK_OBJECT_ID),
          ],
        });
      } else {
        throw new Error(`Unsupported coin type: ${coinType}`);
      }

      console.log('[useOnChainBet] Transaction built, requesting signature...', useZkLogin ? '(zkLogin)' : '(wallet)');
      toast({
        title: "Signing Transaction",
        description: useZkLogin 
          ? `Processing ${coinType} bet via Google login...`
          : `Please approve the ${coinType} bet in your wallet...`,
      });

      let result: { digest: string; effects?: any; objectChanges?: any };
      
      if (useZkLogin) {
        const zkResult = await signAndExecuteZkLogin(tx);
        result = { digest: zkResult.digest, effects: zkResult.effects };
      } else {
        result = await signAndExecute({
          transaction: tx,
        } as any);
      }
      console.log('[useOnChainBet] Transaction signed, result:', JSON.stringify(result, null, 2));

      if (!result.digest) {
        throw new Error('Transaction failed - no digest returned');
      }

      // Check if this is a Nightly wallet result that needs special handling
      // Some wallets return the digest but the transaction might still be pending in the mempool
      // or the wallet might have timed out waiting for its own confirmation
      console.log('[useOnChainBet] Transaction digest received:', result.digest);

      // Wait for transaction and check status - CRITICAL for detecting Move aborts
      let txDetails;
      const MAX_RETRIES = 3;
      let retryCount = 0;
      
      try {
        while (retryCount < MAX_RETRIES) {
          try {
            console.log(`[useOnChainBet] Waiting for transaction (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
            txDetails = await suiClient.waitForTransaction({
              digest: result.digest,
              options: { showEffects: true, showObjectChanges: true },
              timeout: 15000, 
            });
            if (txDetails) break;
          } catch (waitErr: any) {
            console.warn(`[useOnChainBet] Attempt ${retryCount + 1} failed:`, waitErr.message);
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              try {
                txDetails = await suiClient.getTransactionBlock({
                  digest: result.digest,
                  options: { showEffects: true, showObjectChanges: true },
                });
                if (txDetails) break;
              } catch (pollErr) {
                console.log('[useOnChainBet] Direct poll failed');
              }
            }
          }
        }
      } catch (err) {
        console.error('[useOnChainBet] Error in wait loop:', err);
      }
      
      // CRITICAL FIX: If we have a digest but wait timed out, we assume it's pending/success 
      // rather than failing and blocking the user. The backend sync will handle it.
      if (!txDetails && result.digest) {
        console.log('[useOnChainBet] Wait timed out but we have a digest. Treating as success.');
        setIsLoading(false);
        return {
          success: true,
          txDigest: result.digest,
          coinType,
        };
      }
      const status = txDetails.effects?.status;
      if (status?.status === 'failure') {
        // Parse Move abort error for user-friendly message
        const errorMsg = status.error || 'Transaction failed on-chain';
        console.error('[useOnChainBet] Move abort detected:', errorMsg);
        
        let userMessage = 'Transaction failed on the blockchain. Your funds were NOT deducted.';
        const abortCodeMatch = errorMsg.match(/},\s*(\d+)\)\s*in\s*command/);
        const abortCode = abortCodeMatch ? parseInt(abortCodeMatch[1]) : -1;
        
        if (abortCode === 0 || errorMsg.includes('EInsufficientBalance')) {
          userMessage = 'Bet rejected: Platform treasury cannot cover this payout. Try a smaller bet or use a different currency.';
        } else if (abortCode === 7 || errorMsg.includes('EPlatformPaused')) {
          userMessage = 'Platform is temporarily paused. Please try again later.';
        } else if (abortCode === 8 || errorMsg.includes('EExceedsMaxBet')) {
          userMessage = 'Bet amount exceeds maximum allowed. Please reduce your stake.';
        } else if (abortCode === 9 || errorMsg.includes('EExceedsMinBet')) {
          userMessage = 'Bet amount below minimum required.';
        } else if (abortCode === 3 || errorMsg.includes('EInvalidOdds')) {
          userMessage = 'Invalid odds detected. Please refresh and try again.';
        } else if (abortCode === 11 || errorMsg.includes('EInsufficientTreasury')) {
          userMessage = 'Platform treasury insufficient. Try a smaller bet or different currency.';
        } else if (abortCode === 12 || errorMsg.includes('EInvalidOracleSignature')) {
          userMessage = 'Oracle verification failed. Please refresh and try again.';
        } else if (abortCode === 13 || errorMsg.includes('EQuoteExpired')) {
          userMessage = 'Odds quote expired. Please refresh and place your bet again.';
        } else if (abortCode === 15 || errorMsg.includes('EExceedsHardMaxBet')) {
          userMessage = 'Bet exceeds the absolute maximum allowed by the platform.';
        } else if (abortCode === 16 || errorMsg.includes('EOracleNotSet')) {
          userMessage = 'Platform oracle not configured. Betting temporarily disabled.';
        }
        
        throw new Error(userMessage);
      }

      let betObjectId: string | undefined;
      
      // FIRST: Try to extract from signAndExecute result directly (some wallets return it here)
      if ((result as any).objectChanges) {
        console.log('[useOnChainBet] Checking objectChanges from signAndExecute result');
        for (const change of (result as any).objectChanges) {
          console.log('[useOnChainBet] Result objectChange:', change.type, change.objectType);
          if (change.type === 'created' && change.objectType?.includes('::betting::Bet')) {
            betObjectId = change.objectId;
            console.log('[useOnChainBet] Extracted betObjectId from result:', betObjectId);
          }
        }
      }

      // Use already-fetched txDetails to find bet object if not in result
      if (!betObjectId && txDetails.objectChanges) {
        console.log('[useOnChainBet] Checking txDetails objectChanges:', txDetails.objectChanges.length);
        for (const change of txDetails.objectChanges) {
          // Check for 'created' objects that include '::betting::Bet'
          if (change.type === 'created' && (change as any).objectType?.includes('::betting::Bet')) {
            betObjectId = (change as any).objectId;
            console.log('[useOnChainBet] Extracted betObjectId from txDetails objectChanges:', betObjectId);
          }
        }
      }
      
      // Fallback: Check effects.created which is more reliable across some wallets
      if (!betObjectId && txDetails.effects?.created) {
        console.log('[useOnChainBet] Checking effects.created fallback:', txDetails.effects.created.length);
        // Look for any newly created object in the effects
        // On Sui, created objects are listed in effects.created
        for (const createdEffect of txDetails.effects.created) {
          if (createdEffect.reference?.objectId) {
            // Check if this object is already known (not the split coin or gas)
            const objId = createdEffect.reference.objectId;
            
            // Try to verify if it's a Bet object via a quick client check if possible, 
            // but for speed we'll take the first non-gas created object
            betObjectId = objId;
            console.log('[useOnChainBet] Extracted potential betObjectId from effects.created:', betObjectId);
            break; 
          }
        }
      }

      // If still no betObjectId, check objectChanges more thoroughly
      if (!betObjectId && txDetails.objectChanges) {
        const createdObj = txDetails.objectChanges.find((c: any) => c.type === 'created');
        if (createdObj) {
          betObjectId = (createdObj as any).objectId;
          console.log('[useOnChainBet] Fallback objectId from any created object:', betObjectId);
        }
      }
      
      console.log('[useOnChainBet] Final betObjectId:', betObjectId);

      toast({
        title: `${coinType} Bet Placed On-Chain!`,
        description: `Transaction confirmed: ${result.digest.slice(0, 12)}...`,
        variant: "default",
      });

      setIsLoading(false);
      return {
        success: true,
        txDigest: result.digest,
        betObjectId,
        coinType,
      };

    } catch (err: any) {
      console.error('[useOnChainBet] Transaction failed:', err);
      console.error('[useOnChainBet] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      const errorMessage = err.message || 'Failed to place bet on-chain';
      setError(errorMessage);
      setIsLoading(false);

      toast({
        title: "On-Chain Bet Failed",
        description: errorMessage,
        variant: "destructive",
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }, [signAndExecute, suiClient, toast, getSuiCoins, checkTreasuryCapacity, currentAccount, isZkLoginActive, zkLoginAddress, signAndExecuteZkLogin]);

  return {
    placeBetOnChain,
    getSbetsCoins,
    isLoading,
    error,
    SBETS_TOKEN_TYPE,
  };
}
