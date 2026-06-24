/**
 * suiClockService.ts
 *
 * Reads the sui::clock shared object (0x6) to expose the current Sui network
 * time to the frontend.  This is the same clock object the P2P contract uses
 * inside accept_offer / expire_offer — so any drift here matches the contract's
 * view of "now" exactly.
 *
 * Nothing is written on-chain.  Read-only.
 */

import { getSuiClient } from '../lib/suiRpcConfig';

// Canonical shared clock object on every Sui network
export const SUI_CLOCK_OBJECT_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000006';

export type ClockInfo = {
  networkTimestampMs: number;
  systemTimestampMs: number;
  driftMs: number;
  clockObjectId: string;
  dataType: string;
  version: string;
  note: string;
};

// 5-second in-process cache to avoid hammering the RPC on every request
let _cache: { data: ClockInfo; expiresAt: number } | null = null;

export async function getSuiClockInfo(): Promise<ClockInfo> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.data;

  const client = getSuiClient() as any;
  const systemTimestampMs = Date.now();

  let networkTimestampMs = systemTimestampMs;
  let dataType = 'unknown';
  let version = 'unknown';

  try {
    const obj = await client.getObject({
      id: SUI_CLOCK_OBJECT_ID,
      options: { showContent: true, showType: true, showOwner: true },
    });

    const content = obj?.data?.content as any;
    if (content?.fields?.timestamp_ms) {
      networkTimestampMs = Number(content.fields.timestamp_ms);
    }
    dataType = content?.type ?? obj?.data?.type ?? 'unknown';
    version  = String(obj?.data?.version ?? 'unknown');
  } catch (e: any) {
    console.warn('[SuiClock] Failed to read clock object:', e?.message);
  }

  const driftMs = networkTimestampMs - systemTimestampMs;

  const info: ClockInfo = {
    networkTimestampMs,
    systemTimestampMs,
    driftMs,
    clockObjectId: SUI_CLOCK_OBJECT_ID,
    dataType,
    version,
    note:
      'sui::clock is a shared Sui object updated every consensus round. ' +
      'The P2P betting contract reads clock.timestamp_ms() inside accept_offer ' +
      'and expire_offer — so expiry is enforced at the Move VM level, not the backend.',
  };

  _cache = { data: info, expiresAt: Date.now() + 5_000 };
  return info;
}
