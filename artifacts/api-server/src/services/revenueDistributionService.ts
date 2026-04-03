import { blockchainBetService } from './blockchainBetService';
import { storage } from '../storage';

const DISTRIBUTION_INTERVAL_MS = 15 * 60 * 1000;
const MIN_SUI_TO_DISTRIBUTE = 0.01;
const MIN_SBETS_TO_DISTRIBUTE = 100;

let distributionIntervalId: NodeJS.Timeout | null = null;
let lastDistributionTime = 0;
let isDistributing = false;

async function getUndistributedRevenue(): Promise<{
  holdersSui: number; holdersSbets: number;
  profitSui: number; profitSbets: number;
  lpSui: number; lpSbets: number;
  distributedSui: number; distributedSbets: number;
}> {
  const holders = await storage.getRevenueForHolders();
  const profit = await storage.getPlatformProfit();
  const lp = await storage.getRevenueForLp();

  let distributedSui = 0;
  let distributedSbets = 0;
  try {
    const distributed = await storage.getDistributedRevenue();
    distributedSui = distributed.suiDistributed;
    distributedSbets = distributed.sbetsDistributed;
  } catch (e) {}

  const totalAccumulatedSui = holders.suiRevenue + profit.suiBalance + lp.suiRevenue;
  const totalAccumulatedSbets = holders.sbetsRevenue + profit.sbetsBalance + lp.sbetsRevenue;

  const fraction = 1 / 3;
  const pendingHoldersSui = Math.max(holders.suiRevenue - (distributedSui * fraction), 0);
  const pendingHoldersSbets = Math.max(holders.sbetsRevenue - (distributedSbets * fraction), 0);
  const pendingProfitSui = Math.max(profit.suiBalance - (distributedSui * fraction), 0);
  const pendingProfitSbets = Math.max(profit.sbetsBalance - (distributedSbets * fraction), 0);
  const pendingLpSui = Math.max(lp.suiRevenue - (distributedSui * fraction), 0);
  const pendingLpSbets = Math.max(lp.sbetsRevenue - (distributedSbets * fraction), 0);

  return {
    holdersSui: pendingHoldersSui,
    holdersSbets: pendingHoldersSbets,
    profitSui: pendingProfitSui,
    profitSbets: pendingProfitSbets,
    lpSui: pendingLpSui,
    lpSbets: pendingLpSbets,
    distributedSui,
    distributedSbets,
  };
}

async function distributeRevenue(): Promise<{
  suiWithdrawn: number;
  sbetsWithdrawn: number;
  suiTxHash?: string;
  sbetsTxHash?: string;
  errors: string[];
}> {
  const result = {
    suiWithdrawn: 0,
    sbetsWithdrawn: 0,
    suiTxHash: undefined as string | undefined,
    sbetsTxHash: undefined as string | undefined,
    errors: [] as string[],
  };

  if (isDistributing) {
    result.errors.push('Distribution already in progress');
    return result;
  }

  if (!blockchainBetService.isAdminKeyConfigured()) {
    result.errors.push('Admin key not configured');
    return result;
  }

  if (process.env.MULTISIG_GUARD_ID) {
    console.log('[RevenueDistribution] Multisig mode — skipping auto-distribution');
    return result;
  }

  isDistributing = true;
  try {
    const holders = await storage.getRevenueForHolders();
    const profit = await storage.getPlatformProfit();
    const lp = await storage.getRevenueForLp();

    const totalToWithdrawSui = holders.suiRevenue + profit.suiBalance + lp.suiRevenue;
    const totalToWithdrawSbets = holders.sbetsRevenue + profit.sbetsBalance + lp.sbetsRevenue;

    let alreadyDistributed = { suiDistributed: 0, sbetsDistributed: 0 };
    try {
      alreadyDistributed = await storage.getDistributedRevenue();
    } catch (e) {}

    const pendingSui = totalToWithdrawSui - alreadyDistributed.suiDistributed;
    const pendingSbets = totalToWithdrawSbets - alreadyDistributed.sbetsDistributed;

    console.log(`[RevenueDistribution] Pending: ${pendingSui.toFixed(6)} SUI, ${pendingSbets.toFixed(0)} SBETS (already distributed: ${alreadyDistributed.suiDistributed.toFixed(6)} SUI, ${alreadyDistributed.sbetsDistributed.toFixed(0)} SBETS)`);

    const platformInfo = await blockchainBetService.getPlatformInfo();
    if (!platformInfo) {
      result.errors.push('Could not fetch platform info');
      return result;
    }

    const treasurySui = platformInfo.treasuryBalanceSui || 0;
    const treasurySbets = platformInfo.treasuryBalanceSbets || 0;
    const liabilitySui = platformInfo.totalPotentialLiabilitySui || 0;
    const liabilitySbets = platformInfo.totalPotentialLiabilitySbets || 0;

    if (pendingSui >= MIN_SUI_TO_DISTRIBUTE) {
      const availableSui = Math.max(treasurySui - liabilitySui - 0.1, 0);
      const withdrawAmount = Math.min(pendingSui, availableSui);

      if (withdrawAmount >= MIN_SUI_TO_DISTRIBUTE) {
        console.log(`[RevenueDistribution] Withdrawing ${withdrawAmount.toFixed(6)} SUI from treasury (available: ${availableSui.toFixed(6)}, liability: ${liabilitySui.toFixed(6)})`);
        const suiResult = await blockchainBetService.withdrawTreasurySuiOnChain(withdrawAmount);
        if (suiResult.success) {
          result.suiWithdrawn = withdrawAmount;
          result.suiTxHash = suiResult.txHash;
          await storage.recordDistribution(withdrawAmount, 0);
          console.log(`✅ [RevenueDistribution] ${withdrawAmount.toFixed(6)} SUI withdrawn to admin | TX: ${suiResult.txHash}`);
          console.log(`   → Holders: ${(withdrawAmount / 3).toFixed(6)} SUI | Profit: ${(withdrawAmount / 3).toFixed(6)} SUI | LP: ${(withdrawAmount / 3).toFixed(6)} SUI`);
        } else {
          result.errors.push(`SUI withdraw failed: ${suiResult.error}`);
        }
      } else {
        console.log(`[RevenueDistribution] Not enough SUI available in treasury (need ${pendingSui.toFixed(6)}, available ${availableSui.toFixed(6)} after liability)`);
      }
    }

    if (pendingSbets >= MIN_SBETS_TO_DISTRIBUTE) {
      const availableSbets = Math.max(treasurySbets - liabilitySbets - 100, 0);
      const withdrawAmount = Math.min(pendingSbets, availableSbets);

      if (withdrawAmount >= MIN_SBETS_TO_DISTRIBUTE) {
        console.log(`[RevenueDistribution] Withdrawing ${withdrawAmount.toFixed(0)} SBETS from treasury (available: ${availableSbets.toFixed(0)}, liability: ${liabilitySbets.toFixed(0)})`);
        const sbetsResult = await blockchainBetService.withdrawTreasurySbetsOnChain(withdrawAmount);
        if (sbetsResult.success) {
          result.sbetsWithdrawn = withdrawAmount;
          result.sbetsTxHash = sbetsResult.txHash;
          await storage.recordDistribution(0, withdrawAmount);
          console.log(`✅ [RevenueDistribution] ${withdrawAmount.toFixed(0)} SBETS withdrawn to admin | TX: ${sbetsResult.txHash}`);
          console.log(`   → Holders: ${(withdrawAmount / 3).toFixed(0)} SBETS | Profit: ${(withdrawAmount / 3).toFixed(0)} SBETS | LP: ${(withdrawAmount / 3).toFixed(0)} SBETS`);
        } else {
          result.errors.push(`SBETS withdraw failed: ${sbetsResult.error}`);
        }
      } else {
        console.log(`[RevenueDistribution] Not enough SBETS available in treasury (need ${pendingSbets.toFixed(0)}, available ${availableSbets.toFixed(0)} after liability)`);
      }
    }

    if (pendingSui < MIN_SUI_TO_DISTRIBUTE && pendingSbets < MIN_SBETS_TO_DISTRIBUTE) {
      console.log(`[RevenueDistribution] Nothing to distribute (SUI: ${pendingSui.toFixed(6)}, SBETS: ${pendingSbets.toFixed(0)})`);
    }

    lastDistributionTime = Date.now();
    return result;
  } finally {
    isDistributing = false;
  }
}

async function runDistributionCycle(): Promise<void> {
  console.log('[RevenueDistribution] Running distribution cycle...');
  try {
    const result = await distributeRevenue();
    if (result.suiWithdrawn > 0 || result.sbetsWithdrawn > 0) {
      console.log(`[RevenueDistribution] Cycle complete: ${result.suiWithdrawn.toFixed(6)} SUI, ${result.sbetsWithdrawn.toFixed(0)} SBETS distributed`);
    }
    if (result.errors.length > 0) {
      console.error('[RevenueDistribution] Errors:', result.errors.join(', '));
    }
  } catch (error) {
    console.error('[RevenueDistribution] Cycle error:', error);
  }
}

export const revenueDistributionService = {
  start(): void {
    if (distributionIntervalId) {
      console.log('[RevenueDistribution] Already running');
      return;
    }
    console.log(`[RevenueDistribution] Starting scheduler (interval: ${DISTRIBUTION_INTERVAL_MS / 1000}s)`);
    setTimeout(() => runDistributionCycle(), 30000);
    distributionIntervalId = setInterval(runDistributionCycle, DISTRIBUTION_INTERVAL_MS);
  },

  stop(): void {
    if (distributionIntervalId) {
      clearInterval(distributionIntervalId);
      distributionIntervalId = null;
    }
  },

  async triggerManual(): Promise<ReturnType<typeof distributeRevenue>> {
    return distributeRevenue();
  },

  getStatus() {
    return {
      running: !!distributionIntervalId,
      lastDistributionTime,
      isDistributing,
    };
  },
};
