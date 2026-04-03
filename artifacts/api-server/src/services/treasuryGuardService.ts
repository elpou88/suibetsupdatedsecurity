import { db } from '../db';
import { sql } from 'drizzle-orm';

const MAX_SINGLE_PAYOUT_SUI = 50;
const MAX_SINGLE_PAYOUT_SBETS = 25_000_000;
const MAX_DAILY_OUTFLOW_SUI = 500;
const MAX_DAILY_OUTFLOW_SBETS = 50_000_000;
const MAX_HOURLY_TX_COUNT = 100;
const LARGE_PAYOUT_DELAY_MS = 30_000;
const LARGE_PAYOUT_THRESHOLD_SUI = 20;
const LARGE_PAYOUT_THRESHOLD_SBETS = 5_000_000;

let frozen = false;
let freezeReason = '';
let freezeTime = 0;

interface OutflowRecord {
  amount: number;
  currency: 'SUI' | 'SBETS';
  recipient: string;
  type: string;
  timestamp: number;
}

const outflowLog: OutflowRecord[] = [];
const MAX_LOG_SIZE = 5000;

function pruneLog() {
  const cutoff = Date.now() - 25 * 60 * 60 * 1000;
  while (outflowLog.length > 0 && outflowLog[0].timestamp < cutoff) {
    outflowLog.shift();
  }
  if (outflowLog.length > MAX_LOG_SIZE) {
    outflowLog.splice(0, outflowLog.length - MAX_LOG_SIZE);
  }
}

function getDailyOutflow(currency: 'SUI' | 'SBETS'): number {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return outflowLog
    .filter(r => r.currency === currency && r.timestamp > dayAgo)
    .reduce((sum, r) => sum + r.amount, 0);
}

function getHourlyTxCount(): number {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  return outflowLog.filter(r => r.timestamp > hourAgo).length;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  delayed?: boolean;
  delayMs?: number;
}

function emergencyFreeze(reason: string): void {
  frozen = true;
  freezeReason = reason;
  freezeTime = Date.now();
  console.error(`🚨🚨🚨 TREASURY FROZEN: ${reason}`);
  console.error(`🚨 All outbound fund transfers are HALTED until manual unfreeze`);
}

function checkGuard(
  amount: number,
  currency: 'SUI' | 'SBETS',
  recipient: string,
  type: string
): GuardResult {
  if (frozen) {
    return { allowed: false, reason: `Treasury is frozen: ${freezeReason}` };
  }

  const maxSingle = currency === 'SUI' ? MAX_SINGLE_PAYOUT_SUI : MAX_SINGLE_PAYOUT_SBETS;
  if (amount > maxSingle) {
    emergencyFreeze(`Single ${type} exceeded max: ${amount} ${currency} > ${maxSingle} ${currency} to ${recipient.slice(0, 12)}...`);
    return { allowed: false, reason: `Single payout ${amount} ${currency} exceeds maximum ${maxSingle} ${currency}` };
  }

  const dailyOutflow = getDailyOutflow(currency);
  const maxDaily = currency === 'SUI' ? MAX_DAILY_OUTFLOW_SUI : MAX_DAILY_OUTFLOW_SBETS;
  if (dailyOutflow + amount > maxDaily) {
    emergencyFreeze(`Daily ${currency} outflow limit hit: ${dailyOutflow + amount} > ${maxDaily} (${type} to ${recipient.slice(0, 12)}...)`);
    return { allowed: false, reason: `Daily outflow limit reached: ${dailyOutflow.toFixed(2)} + ${amount} > ${maxDaily} ${currency}` };
  }

  const hourlyTx = getHourlyTxCount();
  if (hourlyTx >= MAX_HOURLY_TX_COUNT) {
    emergencyFreeze(`Hourly transaction count exceeded: ${hourlyTx} >= ${MAX_HOURLY_TX_COUNT}`);
    return { allowed: false, reason: `Too many outbound transactions this hour (${hourlyTx})` };
  }

  const largeThreshold = currency === 'SUI' ? LARGE_PAYOUT_THRESHOLD_SUI : LARGE_PAYOUT_THRESHOLD_SBETS;
  if (amount > largeThreshold) {
    console.warn(`⚠️ [TreasuryGuard] Large ${type}: ${amount} ${currency} to ${recipient.slice(0, 12)}... — delayed ${LARGE_PAYOUT_DELAY_MS / 1000}s`);
    return { allowed: true, delayed: true, delayMs: LARGE_PAYOUT_DELAY_MS };
  }

  return { allowed: true };
}

function recordOutflow(amount: number, currency: 'SUI' | 'SBETS', recipient: string, type: string): void {
  pruneLog();
  outflowLog.push({
    amount,
    currency,
    recipient,
    type,
    timestamp: Date.now()
  });
}

async function persistAuditLog(
  amount: number,
  currency: 'SUI' | 'SBETS',
  recipient: string,
  type: string,
  txHash: string | null,
  guardResult: string
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO treasury_audit_log (amount, currency, recipient, operation_type, tx_hash, guard_result, created_at)
      VALUES (${amount}, ${currency}, ${recipient}, ${type}, ${txHash}, ${guardResult}, NOW())
    `);
  } catch (err) {
    console.error('[TreasuryGuard] Audit log write failed:', err);
  }
}

async function ensureAuditTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS treasury_audit_log (
        id SERIAL PRIMARY KEY,
        amount NUMERIC NOT NULL,
        currency VARCHAR(10) NOT NULL,
        recipient VARCHAR(100) NOT NULL,
        operation_type VARCHAR(50) NOT NULL,
        tx_hash VARCHAR(200),
        guard_result VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.error('[TreasuryGuard] Could not create audit table:', err);
  }
}

export const treasuryGuard = {
  check(amount: number, currency: 'SUI' | 'SBETS', recipient: string, type: string): GuardResult {
    return checkGuard(amount, currency, recipient, type);
  },

  record(amount: number, currency: 'SUI' | 'SBETS', recipient: string, type: string, txHash?: string): void {
    recordOutflow(amount, currency, recipient, type);
    persistAuditLog(amount, currency, recipient, type, txHash || null, 'allowed').catch(() => {});
  },

  recordBlocked(amount: number, currency: 'SUI' | 'SBETS', recipient: string, type: string, reason: string): void {
    persistAuditLog(amount, currency, recipient, type, null, `blocked: ${reason}`).catch(() => {});
  },

  freeze(reason: string): void {
    emergencyFreeze(reason);
  },

  unfreeze(): { success: boolean; wasFrozen: boolean; frozenDuration?: number } {
    if (!frozen) return { success: true, wasFrozen: false };
    const duration = Date.now() - freezeTime;
    console.log(`🔓 [TreasuryGuard] Treasury UNFROZEN (was frozen for ${Math.round(duration / 1000)}s: ${freezeReason})`);
    frozen = false;
    freezeReason = '';
    freezeTime = 0;
    return { success: true, wasFrozen: true, frozenDuration: duration };
  },

  isFrozen(): boolean {
    return frozen;
  },

  getStatus(): {
    frozen: boolean;
    freezeReason: string;
    freezeTime: number;
    dailyOutflowSui: number;
    dailyOutflowSbets: number;
    hourlyTxCount: number;
    limits: {
      maxSingleSui: number;
      maxSingleSbets: number;
      maxDailySui: number;
      maxDailySbets: number;
      maxHourlyTx: number;
    };
  } {
    pruneLog();
    return {
      frozen,
      freezeReason,
      freezeTime,
      dailyOutflowSui: getDailyOutflow('SUI'),
      dailyOutflowSbets: getDailyOutflow('SBETS'),
      hourlyTxCount: getHourlyTxCount(),
      limits: {
        maxSingleSui: MAX_SINGLE_PAYOUT_SUI,
        maxSingleSbets: MAX_SINGLE_PAYOUT_SBETS,
        maxDailySui: MAX_DAILY_OUTFLOW_SUI,
        maxDailySbets: MAX_DAILY_OUTFLOW_SBETS,
        maxHourlyTx: MAX_HOURLY_TX_COUNT,
      }
    };
  },

  init: ensureAuditTable,
};
