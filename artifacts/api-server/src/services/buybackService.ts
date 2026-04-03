import { blockchainBetService } from './blockchainBetService';
import { getSuiClient, getJsonRpcUrl } from '../lib/suiRpcConfig';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { db } from '../db';
import { sql } from 'drizzle-orm';

const BUYBACK_PERCENTAGE = 0.03;
const MIN_BUYBACK_SUI = 0.05;
const MAX_BUYBACK_SUI = 2.0;
const BUYBACK_INTERVAL_MS = 3 * 60 * 1000;
const MAX_DAILY_BUYBACK_SUI = 50;
const PERSIST_INTERVAL_MS = 30_000;

const CETUS_POOL_ID = '0xa809b51ec650e4ae45224107e62787be5e58f9caf8d3f74542f8edd73dc37a50';
const CETUS_CLMM_ORIGINAL = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb';
const CETUS_POOL_SCRIPT_V2 = '0xb2db7142fa83210a7d78d9c12ac49c043b3cbbd482224fea6e3da00aa5a5ae2d';
const CETUS_GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SBETS_COIN_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const SBETS_PACKAGE_ID = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502';
const SUI_COIN_TYPE = '0x2::sui::SUI';
const SQRT_PRICE_LIMIT_B2A = '79226673515401279992447579055';
const SQRT_PRICE_LIMIT_A2B = '4295048016';
const SUI_DECIMALS = 1_000_000_000;
const BURN_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000';
const SBETS_ACTIVITY_SWAPS = 5;
const MAX_SBETS_BURN_PER_CYCLE = 50000;
const MAX_DAILY_SBETS_BURN = 500000;

interface BuybackHistoryEntry {
  timestamp: number;
  suiSpent: number;
  sbetsBought: number;
  sbetsBurned: number;
  burnTxHash: string;
  swapTxHash: string;
  type: 'sui_buyback' | 'sbets_burn' | 'sbets_swap_cycle_burn';
}

interface BuybackStats {
  totalBuybackSui: number;
  totalSbetsBought: number;
  totalSbetsBurned: number;
  totalSwaps: number;
  totalBurns: number;
  pendingPoolSui: number;
  pendingPoolSbets: number;
  lastSwapTime: number | null;
  dailyBuybackSui: number;
  dailyResetDate: string;
  history: BuybackHistoryEntry[];
}

class BuybackService {
  private pendingPoolSui = 0;
  private pendingPoolSbets = 0;
  private dailySbetsBurned = 0;
  private stats: BuybackStats = {
    totalBuybackSui: 0,
    totalSbetsBought: 0,
    totalSbetsBurned: 0,
    totalSwaps: 0,
    totalBurns: 0,
    pendingPoolSui: 0,
    pendingPoolSbets: 0,
    lastSwapTime: null,
    dailyBuybackSui: 0,
    dailyResetDate: new Date().toISOString().split('T')[0],
    history: [],
  };
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private persistHandle: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  private dirty = false;

  addRevenueToBuyback(amount: number, currency: 'SUI' | 'SBETS'): number {
    if (amount <= 0) return 0;

    const buybackAmount = amount * BUYBACK_PERCENTAGE;

    if (currency === 'SUI') {
      this.pendingPoolSui += buybackAmount;
      this.stats.pendingPoolSui = this.pendingPoolSui;
    } else if (currency === 'SBETS') {
      this.pendingPoolSbets += buybackAmount;
      this.stats.pendingPoolSbets = this.pendingPoolSbets;
    }

    this.dirty = true;
    return buybackAmount;
  }

  async executeBuybackIfReady(): Promise<void> {
    if (this.isProcessing) return;

    const today = new Date().toISOString().split('T')[0];
    if (this.stats.dailyResetDate !== today) {
      this.stats.dailyBuybackSui = 0;
      this.dailySbetsBurned = 0;
      this.stats.dailyResetDate = today;
    }

    if (this.pendingPoolSbets >= 100) {
      if (this.dailySbetsBurned >= MAX_DAILY_SBETS_BURN) {
        console.log(`🔄 [Buyback] Daily SBETS burn limit reached (${this.dailySbetsBurned.toFixed(2)}/${MAX_DAILY_SBETS_BURN} SBETS) — skipping`);
      } else {
        await this.executeSbetsBurnCycle();
      }
    }

    if (this.pendingPoolSui < MIN_BUYBACK_SUI) return;

    if (this.stats.dailyBuybackSui >= MAX_DAILY_BUYBACK_SUI) {
      console.log(`🔄 [Buyback] Daily limit reached (${this.stats.dailyBuybackSui.toFixed(4)}/${MAX_DAILY_BUYBACK_SUI} SUI)`);
      return;
    }

    this.isProcessing = true;

    try {
      const swapAmount = Math.min(this.pendingPoolSui, MAX_BUYBACK_SUI, MAX_DAILY_BUYBACK_SUI - this.stats.dailyBuybackSui);

      if (swapAmount < MIN_BUYBACK_SUI) {
        return;
      }

      console.log(`🔄 [Buyback] Executing swap+burn: ${swapAmount.toFixed(4)} SUI → SBETS → BURN on Cetus`);

      const result = await this.executeSwapAndBurn(swapAmount);

      if (result.success && result.sbetsBurned && result.sbetsBurned > 0) {
        this.pendingPoolSui -= swapAmount;
        if (this.pendingPoolSui < 0) this.pendingPoolSui = 0;
        this.stats.pendingPoolSui = this.pendingPoolSui;
        this.stats.totalBuybackSui += swapAmount;
        this.stats.totalSbetsBought += result.sbetsBought || 0;
        this.stats.totalSbetsBurned += result.sbetsBurned || 0;
        this.stats.totalSwaps++;
        this.stats.totalBurns++;
        this.stats.lastSwapTime = Date.now();
        this.stats.dailyBuybackSui += swapAmount;
        this.stats.history.push({
          timestamp: Date.now(),
          suiSpent: swapAmount,
          sbetsBought: result.sbetsBought || 0,
          sbetsBurned: result.sbetsBurned || 0,
          swapTxHash: result.txHash || '',
          burnTxHash: result.burnTxHash || result.txHash || '',
          type: 'sui_buyback',
        });

        if (this.stats.history.length > 200) {
          this.stats.history = this.stats.history.slice(-200);
        }

        this.dirty = true;
        await this.persistState();

        console.log(`🔥 [Buyback] BURNED: ${swapAmount.toFixed(4)} SUI → ${(result.sbetsBought || 0).toFixed(2)} SBETS bought & burned | TX: ${result.txHash}`);
        console.log(`📊 [Buyback] Pool: ${this.pendingPoolSui.toFixed(4)} SUI pending | Lifetime: ${this.stats.totalBuybackSui.toFixed(4)} SUI spent, ${this.stats.totalSbetsBurned.toFixed(2)} SBETS burned (${this.stats.totalSwaps} swaps)`);
      } else {
        console.warn(`⚠️ [Buyback] Swap+burn failed: ${result.error} — pool kept at ${this.pendingPoolSui.toFixed(4)} SUI (will retry)`);
      }
    } catch (error: any) {
      console.error(`❌ [Buyback] Error:`, error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeSbetsBurnCycle(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const remainingDaily = MAX_DAILY_SBETS_BURN - this.dailySbetsBurned;
    const rawBurnAmount = Math.min(this.pendingPoolSbets, MAX_SBETS_BURN_PER_CYCLE, remainingDaily);
    if (rawBurnAmount < 100) {
      console.log(`🔄 [Buyback] SBETS burn amount too small (${rawBurnAmount.toFixed(2)}) or daily limit near — skipping`);
      this.isProcessing = false;
      return;
    }
    const burnAmount = rawBurnAmount;
    console.log(`🔥 [Buyback] SBETS swap cycle + burn: ${burnAmount.toFixed(2)} SBETS (cap: ${MAX_SBETS_BURN_PER_CYCLE}/cycle, ${MAX_DAILY_SBETS_BURN}/day, used today: ${this.dailySbetsBurned.toFixed(2)}) → ${SBETS_ACTIVITY_SWAPS} swaps → burn to 0x0`);

    try {
      const result = await this.executeSbetsSwapCycleAndBurn(burnAmount);

      if (result.success && result.sbetsBurned && result.sbetsBurned > 0) {
        this.pendingPoolSbets -= burnAmount;
        if (this.pendingPoolSbets < 0) this.pendingPoolSbets = 0;
        this.stats.pendingPoolSbets = this.pendingPoolSbets;
        this.stats.totalSbetsBurned += result.sbetsBurned || 0;
        this.dailySbetsBurned += result.sbetsBurned || 0;
        this.stats.totalBurns++;
        this.stats.lastSwapTime = Date.now();
        this.stats.history.push({
          timestamp: Date.now(),
          suiSpent: 0,
          sbetsBought: result.sbetsBurned || 0,
          sbetsBurned: result.sbetsBurned || 0,
          swapTxHash: (result.swapTxHashes || []).join(','),
          burnTxHash: result.burnTxHash || '',
          type: 'sbets_swap_cycle_burn',
        });

        if (this.stats.history.length > 200) {
          this.stats.history = this.stats.history.slice(-200);
        }

        this.dirty = true;
        await this.persistState();

        console.log(`🔥 [Buyback] SBETS BURNED: ${burnAmount.toFixed(2)} SBETS → ${(result.swapTxHashes || []).length} activity swaps → ${(result.sbetsBurned || 0).toFixed(2)} SBETS burned | Burn TX: ${result.burnTxHash}`);
      } else {
        console.warn(`⚠️ [Buyback] SBETS swap cycle + burn failed: ${result.error} — keeping ${burnAmount.toFixed(2)} SBETS for retry`);
      }
    } catch (error: any) {
      console.error(`❌ [Buyback] SBETS burn error:`, error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeSwapAndBurn(suiAmount: number): Promise<{ success: boolean; sbetsBought?: number; sbetsBurned?: number; txHash?: string; error?: string }> {
    try {
      const keypair = blockchainBetService.getRevenueKeypair();
      if (!keypair) {
        return { success: false, error: 'Revenue wallet keypair not configured' };
      }

      const senderAddress = keypair.toSuiAddress();
      const amountInMist = BigInt(Math.floor(suiAmount * SUI_DECIMALS));

      const directClient = new SuiJsonRpcClient({ url: getJsonRpcUrl('mainnet' as any) });

      const suiCoins = await directClient.getCoins({ owner: senderAddress, coinType: '0x2::sui::SUI', limit: 10 });
      const gasCoins = suiCoins.data;
      if (!gasCoins.length) {
        return { success: false, error: `No SUI coins found for ${senderAddress.slice(0, 16)}...` };
      }
      console.log(`🔥 [Buyback] Found ${gasCoins.length} SUI coins for swap, total: ${gasCoins.reduce((s, c) => s + Number(c.balance), 0) / 1e9} SUI`);

      const tx = new Transaction();
      tx.setSender(senderAddress);

      if (gasCoins.length > 1) {
        const primaryCoin = gasCoins[0].coinObjectId;
        const otherCoins = gasCoins.slice(1).map(c => c.coinObjectId);
        tx.mergeCoins(tx.object(primaryCoin), otherCoins.map(id => tx.object(id)));
        tx.setGasPayment([{
          objectId: primaryCoin,
          version: gasCoins[0].version,
          digest: gasCoins[0].digest,
        }]);
      } else {
        tx.setGasPayment([{
          objectId: gasCoins[0].coinObjectId,
          version: gasCoins[0].version,
          digest: gasCoins[0].digest,
        }]);
      }

      const zeroSbetsCoin = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [SBETS_COIN_TYPE],
        arguments: [],
      });

      const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountInMist)]);

      tx.moveCall({
        target: `${CETUS_POOL_SCRIPT_V2}::pool_script_v2::swap_b2a`,
        typeArguments: [SBETS_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(CETUS_GLOBAL_CONFIG),
          tx.object(CETUS_POOL_ID),
          zeroSbetsCoin,
          suiCoin,
          tx.pure.bool(true),
          tx.pure.u64(amountInMist),
          tx.pure.u64(0),
          tx.pure.u128(SQRT_PRICE_LIMIT_B2A),
          tx.object(SUI_CLOCK),
        ],
      });

      tx.setGasBudget(30_000_000);

      const result = await directClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showBalanceChanges: true, showEffects: true, showObjectChanges: true },
      });

      if (result.effects?.status?.status !== 'success') {
        return { success: false, error: `TX failed: ${result.effects?.status?.error || 'unknown'}` };
      }

      let sbetsBought = 0;
      if (result.balanceChanges) {
        for (const change of result.balanceChanges) {
          if (change.coinType === SBETS_COIN_TYPE) {
            const amt = BigInt(change.amount);
            if (amt > 0n) {
              sbetsBought = Number(amt) / SUI_DECIMALS;
            }
          }
        }
      }

      let sbetsCoinId: string | null = null;
      if (result.objectChanges) {
        for (const change of result.objectChanges) {
          if ('objectType' in change && change.objectType?.includes('::sbets::SBETS') && change.type === 'created') {
            sbetsCoinId = change.objectId;
          }
        }
      }

      if (!sbetsCoinId || sbetsBought <= 0) {
        console.warn(`⚠️ [Buyback] Swap TX succeeded but no SBETS coin received`);
        return { success: false, sbetsBought: 0, sbetsBurned: 0, txHash: result.digest, burnTxHash: undefined, error: 'Swap succeeded but no SBETS coin found in output' };
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
      const burnTx = new Transaction();
      burnTx.setSender(senderAddress);
      burnTx.transferObjects([burnTx.object(sbetsCoinId)], burnTx.pure.address(BURN_ADDRESS));
      burnTx.setGasBudget(10_000_000);

      const burnResult = await directClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: burnTx,
        options: { showEffects: true },
      });

      if (burnResult.effects?.status?.status !== 'success') {
        console.warn(`⚠️ [Buyback] Swap succeeded but burn failed: ${burnResult.effects?.status?.error}`);
        return { success: false, sbetsBought, sbetsBurned: 0, txHash: result.digest, burnTxHash: undefined, error: `Burn failed: ${burnResult.effects?.status?.error}` };
      }

      console.log(`🔥 [Buyback] Burn TX: ${burnResult.digest}`);

      return {
        success: true,
        sbetsBought,
        sbetsBurned: sbetsBought,
        txHash: result.digest,
        burnTxHash: burnResult.digest,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeSbetsSwapCycleAndBurn(sbetsAmount: number): Promise<{ success: boolean; sbetsBurned?: number; txHash?: string; burnTxHash?: string; swapTxHashes?: string[]; error?: string }> {
    try {
      const keypair = blockchainBetService.getRevenueKeypair();
      if (!keypair) {
        return { success: false, error: 'Revenue wallet keypair not configured' };
      }

      const senderAddress = keypair.toSuiAddress();
      const directClient = new SuiJsonRpcClient({ url: getJsonRpcUrl('mainnet' as any) });
      const amountInMist = BigInt(Math.floor(sbetsAmount * SUI_DECIMALS));

      const sbetsCoins = await directClient.getCoins({
        owner: senderAddress,
        coinType: SBETS_COIN_TYPE,
        limit: 50,
      });

      if (!sbetsCoins.data || sbetsCoins.data.length === 0) {
        return { success: false, error: 'No SBETS coins found in revenue wallet' };
      }

      const totalAvailable = sbetsCoins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
      if (totalAvailable < amountInMist) {
        return { success: false, error: `Insufficient SBETS: have ${Number(totalAvailable) / SUI_DECIMALS}, need ${sbetsAmount}` };
      }

      const swapTxHashes: string[] = [];
      let currentCoinType: 'sbets' | 'sui' = 'sbets';
      let currentAmount = amountInMist;

      for (let cycle = 0; cycle < SBETS_ACTIVITY_SWAPS; cycle++) {
        console.log(`🔄 [Buyback] Activity swap ${cycle + 1}/${SBETS_ACTIVITY_SWAPS}: ${currentCoinType === 'sbets' ? 'SBETS→SUI' : 'SUI→SBETS'} (${(Number(currentAmount) / SUI_DECIMALS).toFixed(4)} ${currentCoinType.toUpperCase()})`);

        if (currentCoinType === 'sbets') {
          const result = await this.executeSingleSwapA2B(directClient, keypair, senderAddress, currentAmount);
          if (!result.success || !result.amountOut) {
            console.warn(`⚠️ [Buyback] Activity swap ${cycle + 1} (SBETS→SUI) failed: ${result.error}`);
            break;
          }
          swapTxHashes.push(result.txHash!);
          currentAmount = result.amountOut;
          currentCoinType = 'sui';
          console.log(`✅ [Buyback] Swap ${cycle + 1}: SBETS→SUI got ${(Number(currentAmount) / SUI_DECIMALS).toFixed(6)} SUI | TX: ${result.txHash}`);
          await this.waitForTx(directClient, result.txHash!);
        } else {
          const result = await this.executeSingleSwapB2A(directClient, keypair, senderAddress, currentAmount);
          if (!result.success || !result.amountOut) {
            console.warn(`⚠️ [Buyback] Activity swap ${cycle + 1} (SUI→SBETS) failed: ${result.error}`);
            break;
          }
          swapTxHashes.push(result.txHash!);
          currentAmount = result.amountOut;
          currentCoinType = 'sbets';
          console.log(`✅ [Buyback] Swap ${cycle + 1}: SUI→SBETS got ${(Number(currentAmount) / SUI_DECIMALS).toFixed(2)} SBETS | TX: ${result.txHash}`);
          await this.waitForTx(directClient, result.txHash!);
        }
      }

      if (currentCoinType === 'sui' && currentAmount > 0n) {
        console.log(`🔄 [Buyback] Final swap back: SUI→SBETS for burn`);
        await this.waitForTx(directClient, swapTxHashes[swapTxHashes.length - 1]);
        const finalSwap = await this.executeSingleSwapB2A(directClient, keypair, senderAddress, currentAmount);
        if (finalSwap.success && finalSwap.amountOut) {
          swapTxHashes.push(finalSwap.txHash!);
          currentAmount = finalSwap.amountOut;
          currentCoinType = 'sbets';
          await this.waitForTx(directClient, finalSwap.txHash!);
        }
      }

      if (currentCoinType !== 'sbets' || currentAmount <= 0n) {
        return { success: false, error: 'Swap cycle ended in wrong state — cannot burn', swapTxHashes };
      }

      const finalSbetsAmount = Number(currentAmount) / SUI_DECIMALS;
      console.log(`🔥 [Buyback] Burning ${finalSbetsAmount.toFixed(2)} SBETS after ${swapTxHashes.length} activity swaps`);

      await new Promise(resolve => setTimeout(resolve, 3000));

      const burnCoins = await directClient.getCoins({
        owner: senderAddress,
        coinType: SBETS_COIN_TYPE,
        limit: 50,
      });

      if (!burnCoins.data.length) {
        return { success: false, error: 'No SBETS coins found after swap cycle', swapTxHashes };
      }

      const burnTx = new Transaction();
      burnTx.setSender(senderAddress);

      const suiGasCoins = await directClient.getCoins({ owner: senderAddress, coinType: '0x2::sui::SUI', limit: 5 });
      if (suiGasCoins.data.length) {
        burnTx.setGasPayment([{
          objectId: suiGasCoins.data[0].coinObjectId,
          version: suiGasCoins.data[0].version,
          digest: suiGasCoins.data[0].digest,
        }]);
      }

      let burnInput;
      if (burnCoins.data.length === 1) {
        burnInput = burnTx.object(burnCoins.data[0].coinObjectId);
      } else {
        const primary = burnTx.object(burnCoins.data[0].coinObjectId);
        const rest = burnCoins.data.slice(1).map(c => burnTx.object(c.coinObjectId));
        burnTx.mergeCoins(primary, rest);
        burnInput = primary;
      }

      const [splitBurn] = burnTx.splitCoins(burnInput, [burnTx.pure.u64(currentAmount)]);
      burnTx.transferObjects([splitBurn], burnTx.pure.address(BURN_ADDRESS));
      burnTx.setGasBudget(20_000_000);

      const burnResult = await directClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: burnTx,
        options: { showEffects: true },
      });

      if (burnResult.effects?.status?.status !== 'success') {
        return { success: false, error: `Burn TX failed: ${burnResult.effects?.status?.error}`, swapTxHashes };
      }

      return {
        success: true,
        sbetsBurned: finalSbetsAmount,
        txHash: swapTxHashes[0] || burnResult.digest,
        burnTxHash: burnResult.digest,
        swapTxHashes,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeSingleSwapA2B(
    client: SuiJsonRpcClient, keypair: any, senderAddress: string, sbetsAmountMist: bigint
  ): Promise<{ success: boolean; amountOut?: bigint; txHash?: string; error?: string }> {
    try {
      const sbetsCoins = await client.getCoins({ owner: senderAddress, coinType: SBETS_COIN_TYPE, limit: 50 });
      if (!sbetsCoins.data.length) return { success: false, error: 'No SBETS coins' };

      const suiCoins = await client.getCoins({ owner: senderAddress, coinType: '0x2::sui::SUI', limit: 10 });
      if (!suiCoins.data.length) return { success: false, error: 'No SUI for gas' };

      const tx = new Transaction();
      tx.setSender(senderAddress);
      tx.setGasPayment([{
        objectId: suiCoins.data[0].coinObjectId,
        version: suiCoins.data[0].version,
        digest: suiCoins.data[0].digest,
      }]);

      let sbetsCoin;
      if (sbetsCoins.data.length === 1) {
        sbetsCoin = tx.object(sbetsCoins.data[0].coinObjectId);
      } else {
        const primary = tx.object(sbetsCoins.data[0].coinObjectId);
        const rest = sbetsCoins.data.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(primary, rest);
        sbetsCoin = primary;
      }

      const [swapCoin] = tx.splitCoins(sbetsCoin, [tx.pure.u64(sbetsAmountMist)]);
      const zeroSuiCoin = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [SUI_COIN_TYPE],
        arguments: [],
      });

      tx.moveCall({
        target: `${CETUS_POOL_SCRIPT_V2}::pool_script_v2::swap_a2b`,
        typeArguments: [SBETS_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(CETUS_GLOBAL_CONFIG),
          tx.object(CETUS_POOL_ID),
          swapCoin,
          zeroSuiCoin,
          tx.pure.bool(true),
          tx.pure.u64(sbetsAmountMist),
          tx.pure.u64(0),
          tx.pure.u128(SQRT_PRICE_LIMIT_A2B),
          tx.object(SUI_CLOCK),
        ],
      });

      tx.setGasBudget(30_000_000);

      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showBalanceChanges: true, showEffects: true },
      });

      if (result.effects?.status?.status !== 'success') {
        return { success: false, error: `swap_a2b failed: ${result.effects?.status?.error}` };
      }

      let suiReceived = 0n;
      if (result.balanceChanges) {
        for (const change of result.balanceChanges) {
          if (change.coinType === '0x2::sui::SUI') {
            const amt = BigInt(change.amount);
            if (amt > 0n) suiReceived = amt;
          }
        }
      }

      return { success: true, amountOut: suiReceived, txHash: result.digest };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async executeSingleSwapB2A(
    client: SuiJsonRpcClient, keypair: any, senderAddress: string, suiAmountMist: bigint
  ): Promise<{ success: boolean; amountOut?: bigint; txHash?: string; error?: string }> {
    try {
      const GAS_RESERVE = 50_000_000n;
      const safeAmount = suiAmountMist > GAS_RESERVE ? suiAmountMist - GAS_RESERVE : suiAmountMist;
      if (safeAmount <= 0n) return { success: false, error: 'SUI amount too small after gas reserve' };

      const tx = new Transaction();
      tx.setSender(senderAddress);

      const zeroSbetsCoin = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [SBETS_COIN_TYPE],
        arguments: [],
      });

      const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(safeAmount)]);

      tx.moveCall({
        target: `${CETUS_POOL_SCRIPT_V2}::pool_script_v2::swap_b2a`,
        typeArguments: [SBETS_COIN_TYPE, SUI_COIN_TYPE],
        arguments: [
          tx.object(CETUS_GLOBAL_CONFIG),
          tx.object(CETUS_POOL_ID),
          zeroSbetsCoin,
          suiCoin,
          tx.pure.bool(true),
          tx.pure.u64(safeAmount),
          tx.pure.u64(0),
          tx.pure.u128(SQRT_PRICE_LIMIT_B2A),
          tx.object(SUI_CLOCK),
        ],
      });

      tx.setGasBudget(30_000_000);

      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showBalanceChanges: true, showEffects: true, showObjectChanges: true },
      });

      if (result.effects?.status?.status !== 'success') {
        return { success: false, error: `swap_b2a failed: ${result.effects?.status?.error}` };
      }

      let sbetsReceived = 0n;
      if (result.balanceChanges) {
        for (const change of result.balanceChanges) {
          if (change.coinType === SBETS_COIN_TYPE) {
            const amt = BigInt(change.amount);
            if (amt > 0n) sbetsReceived = amt;
          }
        }
      }

      return { success: true, amountOut: sbetsReceived, txHash: result.digest };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async waitForTx(client: SuiJsonRpcClient, txHash: string): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const tx = await client.getTransactionBlock({ digest: txHash, options: { showEffects: true } });
        if (tx?.effects?.status?.status === 'success') return;
      } catch {}
    }
    console.warn(`⚠️ [Buyback] TX ${txHash.slice(0, 12)}... not confirmed after 20s — continuing anyway`);
  }

  private async ensureTable(): Promise<void> {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS buyback_state (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          pending_pool_sui DOUBLE PRECISION NOT NULL DEFAULT 0,
          pending_pool_sbets DOUBLE PRECISION NOT NULL DEFAULT 0,
          total_buyback_sui DOUBLE PRECISION NOT NULL DEFAULT 0,
          total_sbets_bought DOUBLE PRECISION NOT NULL DEFAULT 0,
          total_sbets_burned DOUBLE PRECISION NOT NULL DEFAULT 0,
          total_swaps INTEGER NOT NULL DEFAULT 0,
          total_burns INTEGER NOT NULL DEFAULT 0,
          last_swap_time BIGINT,
          daily_buyback_sui DOUBLE PRECISION NOT NULL DEFAULT 0,
          daily_reset_date TEXT NOT NULL DEFAULT '',
          history JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(sql`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS pending_pool_sbets DOUBLE PRECISION NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS daily_sbets_burned DOUBLE PRECISION NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_sbets_burned DOUBLE PRECISION NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_sbets_bought DOUBLE PRECISION NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_buyback_sui DOUBLE PRECISION NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_swaps INTEGER NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_burns INTEGER NOT NULL DEFAULT 0`);
    } catch {}
  }

  private async persistState(): Promise<void> {
    if (!this.dirty) return;
    try {
      const historyJson = JSON.stringify(this.stats.history);
      await db.execute(sql`
        INSERT INTO buyback_state (id, pending_pool_sui, pending_pool_sbets, total_buyback_sui, total_sbets_bought, total_sbets_burned, total_swaps, total_burns, last_swap_time, daily_buyback_sui, daily_sbets_burned, daily_reset_date, history, updated_at)
        VALUES (1, ${this.pendingPoolSui}, ${this.pendingPoolSbets}, ${this.stats.totalBuybackSui}, ${this.stats.totalSbetsBought}, ${this.stats.totalSbetsBurned}, ${this.stats.totalSwaps}, ${this.stats.totalBurns}, ${this.stats.lastSwapTime}, ${this.stats.dailyBuybackSui}, ${this.dailySbetsBurned}, ${this.stats.dailyResetDate}, ${historyJson}::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE SET
          pending_pool_sui = ${this.pendingPoolSui},
          pending_pool_sbets = ${this.pendingPoolSbets},
          total_buyback_sui = ${this.stats.totalBuybackSui},
          total_sbets_bought = ${this.stats.totalSbetsBought},
          total_sbets_burned = ${this.stats.totalSbetsBurned},
          total_swaps = ${this.stats.totalSwaps},
          total_burns = ${this.stats.totalBurns},
          last_swap_time = ${this.stats.lastSwapTime},
          daily_buyback_sui = ${this.stats.dailyBuybackSui},
          daily_sbets_burned = ${this.dailySbetsBurned},
          daily_reset_date = ${this.stats.dailyResetDate},
          history = ${historyJson}::jsonb,
          updated_at = NOW()
      `);
      this.dirty = false;
    } catch (err: any) {
      console.error(`⚠️ [Buyback] Persist failed:`, err.message);
    }
  }

  private async loadState(): Promise<void> {
    try {
      await this.ensureTable();
      const rows: any[] = await db.execute(sql`SELECT * FROM buyback_state WHERE id = 1`);
      const row = rows?.[0];
      if (row) {
        this.pendingPoolSui = Number(row.pending_pool_sui) || 0;
        this.pendingPoolSbets = Number(row.pending_pool_sbets) || 0;
        this.stats.totalBuybackSui = Number(row.total_buyback_sui) || 0;
        this.stats.totalSbetsBought = Number(row.total_sbets_bought) || 0;
        this.stats.totalSbetsBurned = Number(row.total_sbets_burned) || 0;
        this.stats.totalSwaps = Number(row.total_swaps) || 0;
        this.stats.totalBurns = Number(row.total_burns) || 0;
        this.stats.lastSwapTime = row.last_swap_time ? Number(row.last_swap_time) : null;
        this.stats.dailyBuybackSui = Number(row.daily_buyback_sui) || 0;
        this.dailySbetsBurned = Number(row.daily_sbets_burned) || 0;
        this.stats.dailyResetDate = row.daily_reset_date || new Date().toISOString().split('T')[0];
        const today = new Date().toISOString().split('T')[0];
        if (this.stats.dailyResetDate !== today) {
          this.stats.dailyBuybackSui = 0;
          this.dailySbetsBurned = 0;
          this.stats.dailyResetDate = today;
        }
        this.stats.pendingPoolSui = this.pendingPoolSui;
        this.stats.pendingPoolSbets = this.pendingPoolSbets;
        try {
          this.stats.history = typeof row.history === 'string' ? JSON.parse(row.history) : (row.history || []);
        } catch { this.stats.history = []; }
        console.log(`📦 [Buyback] Loaded state from DB: ${this.pendingPoolSui.toFixed(4)} SUI + ${this.pendingPoolSbets.toFixed(2)} SBETS pending, ${this.stats.totalBurns} burns, ${this.stats.totalSbetsBurned.toFixed(2)} SBETS burned total`);
      } else {
        console.log(`📦 [Buyback] No saved state — starting fresh`);
      }
    } catch (err: any) {
      console.error(`⚠️ [Buyback] Load state failed:`, err.message);
    }
  }

  async start() {
    if (this.intervalHandle) return;

    await this.loadState();

    console.log(`🔥 [Buyback] Service started — ${(BUYBACK_PERCENTAGE * 100).toFixed(0)}% of ALL revenue → SBETS buyback & BURN`);
    console.log(`🔥 [Buyback] SUI revenue: swap on Cetus → burn SBETS | SBETS revenue: swap cycle → burn`);
    console.log(`🔥 [Buyback] SUI: Min ${MIN_BUYBACK_SUI} | Max ${MAX_BUYBACK_SUI}/swap | Daily cap: ${MAX_DAILY_BUYBACK_SUI} SUI`);
    console.log(`🔥 [Buyback] SBETS: Max ${MAX_SBETS_BURN_PER_CYCLE}/cycle | Daily cap: ${MAX_DAILY_SBETS_BURN} SBETS`);
    console.log(`🔥 [Buyback] Interval: every ${BUYBACK_INTERVAL_MS / 60000} minutes | Pool: Cetus SBETS/SUI`);
    console.log(`🔥 [Buyback] ⚠️ ONLY burns from 3% revenue pool — does NOT touch revenue wallet reserves`);

    this.intervalHandle = setInterval(() => {
      this.executeBuybackIfReady().catch(err => {
        console.error(`❌ [Buyback] Interval error:`, err.message);
      });
    }, BUYBACK_INTERVAL_MS);

    this.persistHandle = setInterval(() => {
      this.persistState().catch(() => {});
    }, PERSIST_INTERVAL_MS);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.persistHandle) {
      clearInterval(this.persistHandle);
      this.persistHandle = null;
    }
    this.persistState().catch(() => {});
    console.log(`🛑 [Buyback] Service stopped`);
  }

  getStats(): BuybackStats & { config: { percentage: number; minSwap: number; maxSwap: number; dailyCap: number; intervalMinutes: number } } {
    return {
      ...this.stats,
      pendingPoolSui: this.pendingPoolSui,
      pendingPoolSbets: this.pendingPoolSbets,
      config: {
        percentage: BUYBACK_PERCENTAGE,
        minSwap: MIN_BUYBACK_SUI,
        maxSwap: MAX_BUYBACK_SUI,
        dailyCap: MAX_DAILY_BUYBACK_SUI,
        intervalMinutes: BUYBACK_INTERVAL_MS / 60000,
      },
    };
  }

  async triggerManualBuyback(): Promise<{ success: boolean; message: string }> {
    if (this.isProcessing) {
      return { success: false, message: 'Buyback already in progress' };
    }
    if (this.pendingPoolSui < MIN_BUYBACK_SUI && this.pendingPoolSbets < 100) {
      return { success: false, message: `Pending pool too low: ${this.pendingPoolSui.toFixed(4)} SUI, ${this.pendingPoolSbets.toFixed(2)} SBETS (min: ${MIN_BUYBACK_SUI} SUI or 100 SBETS)` };
    }
    await this.executeBuybackIfReady();
    return { success: true, message: `Buyback executed. Pool: ${this.pendingPoolSui.toFixed(4)} SUI, ${this.pendingPoolSbets.toFixed(2)} SBETS remaining` };
  }

  async testSwap(suiAmount: number): Promise<{ success: boolean; details: any }> {
    if (suiAmount <= 0 || suiAmount > 0.5) {
      return { success: false, details: 'Test amount must be 0 < amount <= 0.5 SUI' };
    }
    console.log(`🧪 [Buyback] TEST SWAP: ${suiAmount} SUI → SBETS → BURN`);

    const keypair = blockchainBetService.getRevenueKeypair();
    if (!keypair) {
      return { success: false, details: 'Revenue wallet keypair not configured' };
    }

    const senderAddress = keypair.toSuiAddress();
    const client = getSuiClient('mainnet' as any);

    const suiCoins = await client.getCoins({ owner: senderAddress, coinType: '0x2::sui::SUI', limit: 5 });
    const totalSui = suiCoins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
    const totalSuiHuman = Number(totalSui) / 1e9;
    console.log(`🧪 [Buyback] Revenue wallet ${senderAddress.slice(0,12)}... has ${totalSuiHuman.toFixed(6)} SUI`);

    const gasReserve = 0.05;
    if (totalSuiHuman < suiAmount + gasReserve) {
      const needed = suiAmount + gasReserve + 0.05;
      console.log(`🧪 [Buyback] Revenue wallet low — auto-funding ${needed.toFixed(4)} SUI from admin wallet`);
      try {
        const adminKeypair = blockchainBetService.getAdminKeypair();
        if (adminKeypair) {
          const fundTx = new Transaction();
          fundTx.setSender(adminKeypair.toSuiAddress());
          const [fundCoin] = fundTx.splitCoins(fundTx.gas, [fundTx.pure.u64(BigInt(Math.floor(needed * SUI_DECIMALS)))]);
          fundTx.transferObjects([fundCoin], fundTx.pure.address(senderAddress));
          fundTx.setGasBudget(10_000_000);
          const fundResult = await client.signAndExecuteTransaction({
            signer: adminKeypair,
            transaction: fundTx,
            options: { showEffects: true },
          });
          if (fundResult.effects?.status?.status === 'success') {
            console.log(`🧪 [Buyback] Funded revenue wallet with ${needed.toFixed(4)} SUI | TX: ${fundResult.digest}`);
            console.log(`🧪 [Buyback] Waiting 5s for on-chain finalization...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            return { success: false, details: `Auto-fund failed: ${fundResult.effects?.status?.error}` };
          }
        } else {
          return { success: false, details: `Insufficient SUI: have ${totalSuiHuman.toFixed(6)}, need ${(suiAmount + gasReserve).toFixed(4)} (and no admin keypair for auto-fund)` };
        }
      } catch (fundErr: any) {
        return { success: false, details: `Auto-fund error: ${fundErr.message}` };
      }
    }

    const result = await this.executeSwapAndBurn(suiAmount);

    if (result.success && result.sbetsBurned && result.sbetsBurned > 0) {
      this.stats.totalBuybackSui += suiAmount;
      this.stats.totalSbetsBought += result.sbetsBought || 0;
      this.stats.totalSbetsBurned += result.sbetsBurned || 0;
      this.stats.totalSwaps++;
      this.stats.totalBurns++;
      this.stats.lastSwapTime = Date.now();
      this.stats.history.push({
        timestamp: Date.now(),
        suiSpent: suiAmount,
        sbetsBought: result.sbetsBought || 0,
        sbetsBurned: result.sbetsBurned || 0,
        swapTxHash: result.txHash || '',
        burnTxHash: result.burnTxHash || result.txHash || '',
        type: 'sui_buyback',
      });
      this.dirty = true;
      await this.persistState();
      console.log(`🧪 [Buyback] TEST SUCCESS: ${suiAmount} SUI → ${(result.sbetsBought || 0).toFixed(2)} SBETS burned | TX: ${result.txHash}`);
    } else {
      console.log(`🧪 [Buyback] TEST FAILED: ${result.error}`);
    }

    return { success: result.success, details: result };
  }
}

export const buybackService = new BuybackService();
