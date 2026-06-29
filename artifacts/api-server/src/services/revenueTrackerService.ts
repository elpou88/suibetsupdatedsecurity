import { db } from '../db';
import { sql } from 'drizzle-orm';

export type RevenueCurrency = 'SUI' | 'SBETS' | 'USDC' | 'USDSUI' | 'LBTC';

interface RevenueEntry {
  id?: number;
  timestamp: number;
  source: 'lost_bet' | 'won_bet_fee' | 'voided_bet' | 'manual';
  currency: RevenueCurrency;
  grossAmount: number;
  netAmount: number;
  holdersShare: number;
  lpShare: number;
  treasuryShare: number;
  profitShare: number;
  betId?: string;
  txHash?: string;
}

interface CurrencyStats {
  gross: number;
  net: number;
  holders: number;
  lp: number;
  treasury: number;
  profit: number;
  entryCount: number;
}

const emptyCurrencyStats = (): CurrencyStats => ({
  gross: 0, net: 0, holders: 0, lp: 0, treasury: 0, profit: 0, entryCount: 0,
});

interface RevenueControllerView {
  allTime: {
    grossSui: number;
    grossSbets: number;
    grossUsdc: number;
    grossUsdsui: number;
    netSui: number;
    netSbets: number;
    netUsdc: number;
    netUsdsui: number;
    holdersSui: number;
    holdersSbets: number;
    holdersUsdc: number;
    holdersUsdsui: number;
    lpSui: number;
    lpSbets: number;
    lpUsdc: number;
    lpUsdsui: number;
    treasurySui: number;
    treasurySbets: number;
    treasuryUsdc: number;
    treasuryUsdsui: number;
    profitSui: number;
    profitSbets: number;
    profitUsdc: number;
    profitUsdsui: number;
    entryCount: number;
  };
  today: {
    grossSui: number;
    grossSbets: number;
    grossUsdc: number;
    grossUsdsui: number;
    netSui: number;
    netSbets: number;
    netUsdc: number;
    netUsdsui: number;
    entryCount: number;
  };
  revenueWalletNeeds: {
    totalOwedHoldersSui: number;
    totalOwedHoldersSbets: number;
    totalOwedLpSui: number;
    totalOwedLpSbets: number;
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
    currency: RevenueCurrency,
    betId?: string,
    txHash?: string
  ): Promise<void> {
    await this.ensureTable();
    const netAmount = grossAmount;
    const holdersShare = netAmount * 0.25;
    const lpShare = netAmount * 0.25;
    const treasuryShare = netAmount * 0.25;
    const profitShare = netAmount * 0.25;

    try {
      await db.execute(sql`
        INSERT INTO revenue_tracker (timestamp, source, currency, gross_amount, buyback_amount, net_amount, holders_share, lp_share, treasury_share, profit_share, bet_id, tx_hash)
        VALUES (${Date.now()}, ${source}, ${currency}, ${grossAmount}, ${0}, ${netAmount}, ${holdersShare}, ${lpShare}, ${treasuryShare}, ${profitShare}, ${betId || null}, ${txHash || null})
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

    // Helper to pull stats for a given currency from a result set
    const pick = (rows: any[], cur: string): CurrencyStats => {
      const r = rows.find((x: any) => x.currency === cur);
      if (!r) return emptyCurrencyStats();
      return {
        gross: Number(r.total_gross) || 0,
        net: Number(r.total_net) || 0,
        holders: Number(r.total_holders) || 0,
        lp: Number(r.total_lp) || 0,
        treasury: Number(r.total_treasury) || 0,
        profit: Number(r.total_profit) || 0,
        entryCount: Number(r.entry_count) || 0,
      };
    };

    const pickToday = (rows: any[], cur: string) => {
      const r = rows.find((x: any) => x.currency === cur);
      if (!r) return { gross: 0, net: 0, entryCount: 0 };
      return {
        gross: Number(r.total_gross) || 0,
        net: Number(r.total_net) || 0,
        entryCount: Number(r.entry_count) || 0,
      };
    };

    const atSui    = pick(allTimeRows, 'SUI');
    const atSbets  = pick(allTimeRows, 'SBETS');
    const atUsdc   = pick(allTimeRows, 'USDC');
    const atUsdsui = pick(allTimeRows, 'USDSUI');
    const atLbtc   = pick(allTimeRows, 'LBTC');

    const tdSui    = pickToday(todayRows, 'SUI');
    const tdSbets  = pickToday(todayRows, 'SBETS');
    const tdUsdc   = pickToday(todayRows, 'USDC');
    const tdUsdsui = pickToday(todayRows, 'USDSUI');
    const tdLbtc   = pickToday(todayRows, 'LBTC');

    const { storage } = await import('../storage');
    const holdersRev = await storage.getRevenueForHolders();
    const lpRev = await storage.getRevenueForLp();
    const treasuryBuf = await storage.getTreasuryBuffer();
    const distributed = await storage.getDistributedRevenue();

    const unclaimedHoldersSui   = holdersRev.suiRevenue   - (distributed.suiDistributed   || 0);
    const unclaimedHoldersSbets = holdersRev.sbetsRevenue - (distributed.sbetsDistributed || 0);

    let prevTreasurySui   = 0;
    let prevTreasurySbets = 0;
    try {
      const prevSuiRows = await db.execute(sql`
        SELECT COALESCE(SUM(treasury_share), 0) as prev_treasury
        FROM revenue_tracker
        WHERE currency = 'SUI' AND timestamp < ${todayMs}
      `) as any[];
      prevTreasurySui = Number(prevSuiRows?.[0]?.prev_treasury) || 0;

      const prevSbetsRows = await db.execute(sql`
        SELECT COALESCE(SUM(treasury_share), 0) as prev_treasury
        FROM revenue_tracker
        WHERE currency = 'SBETS' AND timestamp < ${todayMs}
      `) as any[];
      prevTreasurySbets = Number(prevSbetsRows?.[0]?.prev_treasury) || 0;
    } catch {}

    const currentTreasurySui   = treasuryBuf.suiBalance;
    const currentTreasurySbets = treasuryBuf.sbetsBalance;

    const totalEntries =
      atSui.entryCount + atSbets.entryCount + atUsdc.entryCount + atUsdsui.entryCount + atLbtc.entryCount;
    const todayTotalEntries =
      tdSui.entryCount + tdSbets.entryCount + tdUsdc.entryCount + tdUsdsui.entryCount + tdLbtc.entryCount;

    return {
      allTime: {
        grossSui:       atSui.gross,
        grossSbets:     atSbets.gross,
        grossUsdc:      atUsdc.gross,
        grossUsdsui:    atUsdsui.gross,
        grossLbtc:      atLbtc.gross,
        netSui:         atSui.net,
        netSbets:       atSbets.net,
        netUsdc:        atUsdc.net,
        netUsdsui:      atUsdsui.net,
        netLbtc:        atLbtc.net,
        holdersSui:     atSui.holders,
        holdersSbets:   atSbets.holders,
        holdersUsdc:    atUsdc.holders,
        holdersUsdsui:  atUsdsui.holders,
        holdersLbtc:    atLbtc.holders,
        lpSui:          atSui.lp,
        lpSbets:        atSbets.lp,
        lpUsdc:         atUsdc.lp,
        lpUsdsui:       atUsdsui.lp,
        lpLbtc:         atLbtc.lp,
        treasurySui:    atSui.treasury,
        treasurySbets:  atSbets.treasury,
        treasuryUsdc:   atUsdc.treasury,
        treasuryUsdsui: atUsdsui.treasury,
        treasuryLbtc:   atLbtc.treasury,
        profitSui:      atSui.profit,
        profitSbets:    atSbets.profit,
        profitUsdc:     atUsdc.profit,
        profitUsdsui:   atUsdsui.profit,
        profitLbtc:     atLbtc.profit,
        entryCount:     totalEntries,
      },
      today: {
        grossSui:    tdSui.gross,
        grossSbets:  tdSbets.gross,
        grossUsdc:   tdUsdc.gross,
        grossUsdsui: tdUsdsui.gross,
        grossLbtc:   tdLbtc.gross,
        netSui:      tdSui.net,
        netSbets:    tdSbets.net,
        netUsdc:     tdUsdc.net,
        netUsdsui:   tdUsdsui.net,
        netLbtc:     tdLbtc.net,
        entryCount:  todayTotalEntries,
      },
      revenueWalletNeeds: {
        totalOwedHoldersSui:   Math.max(0, unclaimedHoldersSui),
        totalOwedHoldersSbets: Math.max(0, unclaimedHoldersSbets),
        totalOwedLpSui:        lpRev.suiRevenue,
        totalOwedLpSbets:      lpRev.sbetsRevenue,
        totalToSendSui:        Math.max(0, unclaimedHoldersSui) + lpRev.suiRevenue,
        totalToSendSbets:      Math.max(0, unclaimedHoldersSbets) + lpRev.sbetsRevenue,
      },
      treasuryHealth: {
        treasuryBalanceSui:   currentTreasurySui,
        treasuryBalanceSbets: currentTreasurySbets,
        isRising: currentTreasurySui >= prevTreasurySui && currentTreasurySbets >= prevTreasurySbets,
        lastCheck: Date.now(),
      },
      recentEntries: recentRows.map((r: any) => ({
        id:           r.id,
        timestamp:    Number(r.timestamp),
        source:       r.source,
        currency:     r.currency,
        grossAmount:  Number(r.gross_amount),
        netAmount:    Number(r.net_amount),
        holdersShare: Number(r.holders_share),
        lpShare:      Number(r.lp_share),
        treasuryShare:Number(r.treasury_share),
        profitShare:  Number(r.profit_share),
        betId:        r.bet_id,
        txHash:       r.tx_hash,
      })),
    };
  }
}

export const revenueTrackerService = new RevenueTrackerService();
