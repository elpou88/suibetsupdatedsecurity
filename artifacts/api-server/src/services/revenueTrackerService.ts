import { db } from '../db';
import { sql } from 'drizzle-orm';

interface RevenueEntry {
  id?: number;
  timestamp: number;
  source: 'lost_bet' | 'won_bet_fee' | 'voided_bet' | 'manual';
  currency: 'SUI' | 'SBETS';
  grossAmount: number;
  buybackAmount: number;
  netAmount: number;
  holdersShare: number;
  lpShare: number;
  treasuryShare: number;
  profitShare: number;
  betId?: string;
  txHash?: string;
}

interface RevenueControllerView {
  allTime: {
    grossSui: number;
    grossSbets: number;
    buybackSui: number;
    buybackSbets: number;
    netSui: number;
    netSbets: number;
    holdersSui: number;
    holdersSbets: number;
    lpSui: number;
    lpSbets: number;
    treasurySui: number;
    treasurySbets: number;
    profitSui: number;
    profitSbets: number;
    entryCount: number;
  };
  today: {
    grossSui: number;
    grossSbets: number;
    buybackSui: number;
    buybackSbets: number;
    netSui: number;
    netSbets: number;
    entryCount: number;
  };
  revenueWalletNeeds: {
    totalOwedHoldersSui: number;
    totalOwedHoldersSbets: number;
    totalOwedLpSui: number;
    totalOwedLpSbets: number;
    totalOwedBuybackSui: number;
    totalOwedBuybackSbets: number;
    totalToSendSui: number;
    totalToSendSbets: number;
  };
  treasuryHealth: {
    treasuryBalanceSui: number;
    treasuryBalanceSbets: number;
    isRising: boolean;
    lastCheck: number;
  };
  recentEntries: RevenueEntry[];
}

class RevenueTrackerService {
  private initialized = false;

  async ensureTable(): Promise<void> {
    if (this.initialized) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS revenue_tracker (
          id SERIAL PRIMARY KEY,
          timestamp BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          source TEXT NOT NULL,
          currency TEXT NOT NULL DEFAULT 'SUI',
          gross_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
          buyback_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
          net_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
          holders_share DOUBLE PRECISION NOT NULL DEFAULT 0,
          lp_share DOUBLE PRECISION NOT NULL DEFAULT 0,
          treasury_share DOUBLE PRECISION NOT NULL DEFAULT 0,
          profit_share DOUBLE PRECISION NOT NULL DEFAULT 0,
          bet_id TEXT,
          tx_hash TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      this.initialized = true;
    } catch (err: any) {
      console.error('⚠️ [RevenueTracker] Table init error:', err.message);
    }
  }

  async recordRevenue(
    source: RevenueEntry['source'],
    grossAmount: number,
    buybackAmount: number,
    currency: 'SUI' | 'SBETS',
    betId?: string,
    txHash?: string
  ): Promise<void> {
    await this.ensureTable();
    const netAmount = grossAmount - buybackAmount;
    const holdersShare = netAmount * 0.25;
    const lpShare = netAmount * 0.25;
    const treasuryShare = netAmount * 0.25;
    const profitShare = netAmount * 0.25;

    try {
      await db.execute(sql`
        INSERT INTO revenue_tracker (timestamp, source, currency, gross_amount, buyback_amount, net_amount, holders_share, lp_share, treasury_share, profit_share, bet_id, tx_hash)
        VALUES (${Date.now()}, ${source}, ${currency}, ${grossAmount}, ${buybackAmount}, ${netAmount}, ${holdersShare}, ${lpShare}, ${treasuryShare}, ${profitShare}, ${betId || null}, ${txHash || null})
      `);
    } catch (err: any) {
      console.error('⚠️ [RevenueTracker] Record error:', err.message);
    }
  }

  async getControllerView(): Promise<RevenueControllerView> {
    await this.ensureTable();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    let allTimeRows: any[] = [];
    let todayRows: any[] = [];
    let recentRows: any[] = [];

    try {
      allTimeRows = await db.execute(sql`
        SELECT currency,
          COUNT(*)::INTEGER as entry_count,
          COALESCE(SUM(gross_amount), 0) as total_gross,
          COALESCE(SUM(buyback_amount), 0) as total_buyback,
          COALESCE(SUM(net_amount), 0) as total_net,
          COALESCE(SUM(holders_share), 0) as total_holders,
          COALESCE(SUM(lp_share), 0) as total_lp,
          COALESCE(SUM(treasury_share), 0) as total_treasury,
          COALESCE(SUM(profit_share), 0) as total_profit
        FROM revenue_tracker
        GROUP BY currency
      `) as any[];
    } catch {}

    try {
      todayRows = await db.execute(sql`
        SELECT currency,
          COUNT(*)::INTEGER as entry_count,
          COALESCE(SUM(gross_amount), 0) as total_gross,
          COALESCE(SUM(buyback_amount), 0) as total_buyback,
          COALESCE(SUM(net_amount), 0) as total_net
        FROM revenue_tracker
        WHERE timestamp >= ${todayMs}
        GROUP BY currency
      `) as any[];
    } catch {}

    try {
      recentRows = await db.execute(sql`
        SELECT * FROM revenue_tracker ORDER BY id DESC LIMIT 50
      `) as any[];
    } catch {}

    const allTimeSui = allTimeRows.find((r: any) => r.currency === 'SUI');
    const allTimeSbets = allTimeRows.find((r: any) => r.currency === 'SBETS');
    const todaySui = todayRows.find((r: any) => r.currency === 'SUI');
    const todaySbets = todayRows.find((r: any) => r.currency === 'SBETS');

    const { storage } = await import('../storage');
    const holdersRev = await storage.getRevenueForHolders();
    const lpRev = await storage.getRevenueForLp();
    const treasuryBuf = await storage.getTreasuryBuffer();
    const distributed = await storage.getDistributedRevenue();

    let buybackStats = { pendingPoolSui: 0, pendingPoolSbets: 0 };
    try {
      const { buybackService } = await import('./buybackService');
      buybackStats = buybackService.getStats();
    } catch {}

    const unclaimedHoldersSui = holdersRev.suiRevenue - (distributed.suiDistributed || 0);
    const unclaimedHoldersSbets = holdersRev.sbetsRevenue - (distributed.sbetsDistributed || 0);

    let prevTreasurySui = 0;
    let prevTreasurySbets = 0;
    try {
      const prevRows = await db.execute(sql`
        SELECT COALESCE(SUM(treasury_share), 0) as prev_treasury
        FROM revenue_tracker
        WHERE currency = 'SUI' AND timestamp < ${todayMs}
      `) as any[];
      prevTreasurySui = Number(prevRows?.[0]?.prev_treasury) || 0;
      const prevRowsSbets = await db.execute(sql`
        SELECT COALESCE(SUM(treasury_share), 0) as prev_treasury
        FROM revenue_tracker
        WHERE currency = 'SBETS' AND timestamp < ${todayMs}
      `) as any[];
      prevTreasurySbets = Number(prevRowsSbets?.[0]?.prev_treasury) || 0;
    } catch {}

    const currentTreasurySui = treasuryBuf.suiBalance;
    const currentTreasurySbets = treasuryBuf.sbetsBalance;

    return {
      allTime: {
        grossSui: Number(allTimeSui?.total_gross) || 0,
        grossSbets: Number(allTimeSbets?.total_gross) || 0,
        buybackSui: Number(allTimeSui?.total_buyback) || 0,
        buybackSbets: Number(allTimeSbets?.total_buyback) || 0,
        netSui: Number(allTimeSui?.total_net) || 0,
        netSbets: Number(allTimeSbets?.total_net) || 0,
        holdersSui: Number(allTimeSui?.total_holders) || 0,
        holdersSbets: Number(allTimeSbets?.total_holders) || 0,
        lpSui: Number(allTimeSui?.total_lp) || 0,
        lpSbets: Number(allTimeSbets?.total_lp) || 0,
        treasurySui: Number(allTimeSui?.total_treasury) || 0,
        treasurySbets: Number(allTimeSbets?.total_treasury) || 0,
        profitSui: Number(allTimeSui?.total_profit) || 0,
        profitSbets: Number(allTimeSbets?.total_profit) || 0,
        entryCount: (Number(allTimeSui?.entry_count) || 0) + (Number(allTimeSbets?.entry_count) || 0),
      },
      today: {
        grossSui: Number(todaySui?.total_gross) || 0,
        grossSbets: Number(todaySbets?.total_gross) || 0,
        buybackSui: Number(todaySui?.total_buyback) || 0,
        buybackSbets: Number(todaySbets?.total_buyback) || 0,
        netSui: Number(todaySui?.total_net) || 0,
        netSbets: Number(todaySbets?.total_net) || 0,
        entryCount: (Number(todaySui?.entry_count) || 0) + (Number(todaySbets?.entry_count) || 0),
      },
      revenueWalletNeeds: {
        totalOwedHoldersSui: Math.max(0, unclaimedHoldersSui),
        totalOwedHoldersSbets: Math.max(0, unclaimedHoldersSbets),
        totalOwedLpSui: lpRev.suiRevenue,
        totalOwedLpSbets: lpRev.sbetsRevenue,
        totalOwedBuybackSui: buybackStats.pendingPoolSui,
        totalOwedBuybackSbets: buybackStats.pendingPoolSbets,
        totalToSendSui: Math.max(0, unclaimedHoldersSui) + lpRev.suiRevenue + buybackStats.pendingPoolSui,
        totalToSendSbets: Math.max(0, unclaimedHoldersSbets) + lpRev.sbetsRevenue + buybackStats.pendingPoolSbets,
      },
      treasuryHealth: {
        treasuryBalanceSui: currentTreasurySui,
        treasuryBalanceSbets: currentTreasurySbets,
        isRising: currentTreasurySui >= prevTreasurySui && currentTreasurySbets >= prevTreasurySbets,
        lastCheck: Date.now(),
      },
      recentEntries: recentRows.map((r: any) => ({
        id: r.id,
        timestamp: Number(r.timestamp),
        source: r.source,
        currency: r.currency,
        grossAmount: Number(r.gross_amount),
        buybackAmount: Number(r.buyback_amount),
        netAmount: Number(r.net_amount),
        holdersShare: Number(r.holders_share),
        lpShare: Number(r.lp_share),
        treasuryShare: Number(r.treasury_share),
        profitShare: Number(r.profit_share),
        betId: r.bet_id,
        txHash: r.tx_hash,
      })),
    };
  }
}

export const revenueTrackerService = new RevenueTrackerService();
