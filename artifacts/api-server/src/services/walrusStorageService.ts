import { createHash } from 'crypto';

// =============================================================================
// Publisher list — Walrus mainnet publishers.
//
// ⚠️  IMPORTANT: Walrus Mainnet has NO public unauthenticated publishers.
//     All old "community" publishers (NodeInfra, StakeTab, dWallet, Chainbase,
//     Staking4All, Overclock, 4Everland, Suiftly) are dead (NXDOMAIN) as of 2026.
//     The official Walrus operators.json lists ZERO public mainnet publishers.
//
// Working commercial publishers (require accounts/keys):
//   1. Nami Cloud  — https://nami.cloud  — set NAMI_CLOUD_ENDPOINT_KEY
//      URL format: https://walrus-mainnet-publisher.nami.cloud/{key}/v1/blobs
//
//   2. Triton One  — https://triton.one/products/walrus  — sign up at customers.triton.one
//      Set WALRUS_TRITON_PUBLISHER_URL to the full URL they give you
//      (e.g. https://<your-endpoint>.triton.one/v1/blobs)
//
//   3. Custom / self-hosted — set WALRUS_PUBLISHER_URL / _2 / _3
//
// Without any key/URL configured, all uploads fall back to local storage and
// the retry worker (every 3 min) re-uploads once a publisher is available.
// =============================================================================
function buildPublisherList(): Array<{ url: string; timeout: number; priority: 'primary' | 'secondary' }> {
  const list: Array<{ url: string; timeout: number; priority: 'primary' | 'secondary' }> = [];

  // ── Custom publisher env vars (highest priority) ──────────────────────────
  for (const envKey of ['WALRUS_PUBLISHER_URL', 'WALRUS_PUBLISHER_URL_2', 'WALRUS_PUBLISHER_URL_3']) {
    const url = process.env[envKey]?.trim();
    if (url) {
      const normalised = url.endsWith('/v1/blobs') ? url : `${url.replace(/\/$/, '')}/v1/blobs`;
      list.push({ url: normalised, timeout: 60000, priority: 'primary' });
      console.log(`[Walrus] Custom publisher from ${envKey}: ${normalised}`);
    }
  }

  // ── Triton One (managed publisher — requires account at customers.triton.one) ─
  const tritonUrl = process.env.WALRUS_TRITON_PUBLISHER_URL?.trim();
  if (tritonUrl) {
    const normalised = tritonUrl.endsWith('/v1/blobs') ? tritonUrl : `${tritonUrl.replace(/\/$/, '')}/v1/blobs`;
    list.push({ url: normalised, timeout: 60000, priority: 'primary' });
    console.log('[Walrus] Triton One publisher enabled');
  }

  // ── Nami Cloud (managed publisher — requires NAMI_CLOUD_ENDPOINT_KEY) ────
  const namiKey = process.env.NAMI_CLOUD_ENDPOINT_KEY?.trim();
  if (namiKey) {
    list.push({
      url: `https://walrus-mainnet-publisher.nami.cloud/${namiKey}/v1/blobs`,
      timeout: 60000,
      priority: 'primary',
    });
    console.log('[Walrus] Nami Cloud publisher enabled');
  }

  if (list.length === 0) {
    console.warn('[Walrus] ⚠️ No publishers configured — all uploads will be stored locally.');
    console.warn('[Walrus]    Set NAMI_CLOUD_ENDPOINT_KEY (nami.cloud) or WALRUS_TRITON_PUBLISHER_URL (triton.one) to enable uploads.');
  } else {
    console.log(`[Walrus] Publisher list: ${list.length} publisher(s) configured`);
  }

  return list;
}

let WALRUS_PUBLISHERS = buildPublisherList();

// Aggregators are PUBLIC (no auth needed) — these are confirmed working from
// the official Walrus operators.json (cache: true, functional: true as of 2026)
const WALRUS_AGGREGATORS = [
  'https://aggregator.walrus-mainnet.walrus.space/v1/blobs',   // Mysten Labs
  'https://wal-aggregator-mainnet.staketab.org/v1/blobs',      // Staketab
  'https://aggregator.walrus-mainnet.h2o-nodes.com/v1/blobs',  // H2O Nodes
  'https://sui-walrus-mainnet-aggregator.bwarelabs.com/v1/blobs', // Alchemy Validators
  'https://aggregator.walrus-mainnet.tududes.com/v1/blobs',    // TuDudes
  'https://walrus-agg.mainnet.obelisk.sh/v1/blobs',            // Obelisk
  'https://walmain.agg.chainflow.io/v1/blobs',                 // Chainflow
];

const STORE_EPOCHS = 10;

// Track publisher health so we skip recently-dead ones
const publisherHealth: Map<string, { failedAt: number; failures: number }> = new Map();
const HEALTH_RESET_MS = 5 * 60 * 1000; // reset after 5 minutes

function isPublisherHealthy(url: string): boolean {
  const h = publisherHealth.get(url);
  if (!h) return true;
  if (Date.now() - h.failedAt > HEALTH_RESET_MS) {
    publisherHealth.delete(url);
    return true;
  }
  const isPrimary = WALRUS_PUBLISHERS.find(p => p.url === url)?.priority === 'primary';
  return h.failures < (isPrimary ? 5 : 2);
}

function markPublisherFailed(url: string) {
  const h = publisherHealth.get(url) || { failedAt: 0, failures: 0 };
  publisherHealth.set(url, { failedAt: Date.now(), failures: h.failures + 1 });
}

function markPublisherSuccess(url: string) {
  publisherHealth.delete(url);
}

interface BetReceiptData {
  betId: string;
  walletAddress: string;
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  odds: number;
  stake: number;
  currency: string;
  potentialPayout: number;
  txHash?: string;
  betObjectId?: string;
  placedAt: number;
  sportName?: string;
  marketType?: string;
}

interface WalrusStoreResponse {
  blobId: string | null;
  receiptJson: string;
  receiptHash: string;
  publisherUsed?: string;
  storageEpoch?: number;
  endEpoch?: number;
  walCost?: number;
  error?: string;
}

function generateReceiptJson(data: BetReceiptData): string {
  const receipt = {
    platform: 'SuiBets',
    version: '2.0',
    type: 'bet_receipt',
    branding: {
      name: 'SuiBets',
      tagline: 'Decentralized Sports Betting on Sui',
      website: 'https://www.suibets.com',
      walrusSite: 'https://suibets.wal.app',
      colors: {
        primary: '#06b6d4',
        secondary: '#8b5cf6',
        accent: '#f59e0b',
        background: '#0a0e1a',
        surface: '#111827',
        success: '#10b981',
        error: '#ef4444',
      },
      logo: 'https://www.suibets.com/suibets-logo.png',
    },
    bet: {
      id: data.betId,
      walletAddress: data.walletAddress,
      eventId: data.eventId,
      eventName: data.eventName,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      prediction: data.prediction,
      odds: data.odds,
      stake: data.stake,
      currency: data.currency,
      potentialPayout: data.potentialPayout,
      sportName: data.sportName || null,
      marketType: data.marketType || 'match_winner',
    },
    blockchain: {
      chain: 'sui:mainnet',
      network: 'mainnet',
      txHash: data.txHash || null,
      betObjectId: data.betObjectId || null,
      token: data.currency === 'SBETS'
        ? (process.env.SBETS_TOKEN_ADDRESS || '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS')
        : '0x2::sui::SUI',
      contract: process.env.BETTING_PACKAGE_ID || '',
      platform: process.env.BETTING_PLATFORM_ID || '',
    },
    storage: {
      protocol: 'walrus',
      network: 'mainnet',
      storedAt: Date.now(),
      placedAt: data.placedAt,
    },
    verification: {
      receiptHash: createHash('sha256').update(JSON.stringify({
        betId: data.betId,
        walletAddress: data.walletAddress,
        eventId: data.eventId,
        prediction: data.prediction,
        odds: data.odds,
        stake: data.stake,
        currency: data.currency,
        placedAt: data.placedAt,
      })).digest('hex'),
      algorithm: 'sha256',
      fields: ['betId', 'walletAddress', 'eventId', 'prediction', 'odds', 'stake', 'currency', 'placedAt'],
    },
  };
  return JSON.stringify(receipt, null, 2);
}

function hashReceipt(json: string): string {
  return createHash('sha256').update(json).digest('hex').slice(0, 32);
}

interface ExtractedBlobData {
  blobId: string | null;
  storageEpoch?: number;
  endEpoch?: number;
  walCost?: number;
}

function extractBlobData(result: any): ExtractedBlobData {
  if (result?.newlyCreated?.blobObject) {
    const obj = result.newlyCreated.blobObject;
    return {
      blobId: obj.blobId || null,
      storageEpoch: obj.registeredEpoch ?? obj.storage?.startEpoch,
      endEpoch: obj.storage?.endEpoch,
      walCost: result.newlyCreated.cost,
    };
  }
  if (result?.alreadyCertified) {
    return {
      blobId: result.alreadyCertified.blobId || null,
      endEpoch: result.alreadyCertified.endEpoch,
    };
  }
  if (typeof result?.blobId === 'string') {
    return { blobId: result.blobId };
  }
  if (Array.isArray(result) && result[0]?.blobStoreResult) {
    const inner = result[0].blobStoreResult;
    return extractBlobData(inner);
  }
  return { blobId: null };
}

async function tryPublisher(
  publisherUrl: string,
  receiptJson: string,
  timeoutMs: number,
): Promise<{ blobId: string; publisher: string; storageEpoch?: number; endEpoch?: number; walCost?: number } | null> {
  try {
    const url = `${publisherUrl}?epochs=${STORE_EPOCHS}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: receiptJson,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      markPublisherFailed(publisherUrl);
      return null;
    }

    const result = await response.json();
    const data = extractBlobData(result);

    if (data.blobId) {
      markPublisherSuccess(publisherUrl);
      return { blobId: data.blobId, publisher: publisherUrl, storageEpoch: data.storageEpoch, endEpoch: data.endEpoch, walCost: data.walCost };
    }

    console.warn(`[Walrus] No blobId from ${publisherUrl}:`, JSON.stringify(result).slice(0, 300));
    markPublisherFailed(publisherUrl);
    return null;
  } catch {
    markPublisherFailed(publisherUrl);
    return null;
  }
}

// Track env var snapshot so we can detect changes without rebuilding every call
let _lastEnvSnapshot = '';
function _currentEnvSnapshot() {
  return [
    process.env.WALRUS_PUBLISHER_URL,
    process.env.WALRUS_PUBLISHER_URL_2,
    process.env.WALRUS_PUBLISHER_URL_3,
    process.env.WALRUS_TRITON_PUBLISHER_URL,
    process.env.NAMI_CLOUD_ENDPOINT_KEY,
  ].join('|');
}

async function storeViaHttp(receiptJson: string): Promise<{ blobId: string; publisher: string; storageEpoch?: number; endEpoch?: number; walCost?: number } | null> {
  // Refresh publisher list whenever any publisher env var changes (e.g. set after startup)
  const snap = _currentEnvSnapshot();
  if (snap !== _lastEnvSnapshot) {
    WALRUS_PUBLISHERS = buildPublisherList();
    _lastEnvSnapshot = snap;
  }

  // ROUND 1: Race all publishers in parallel — take the first real blob ID
  const allCandidates = WALRUS_PUBLISHERS.filter(p => isPublisherHealthy(p.url));

  const parallelPromises = allCandidates.map(async (p) => {
    const result = await tryPublisher(p.url, receiptJson, p.timeout);
    if (!result) throw new Error(`${p.url} failed`);
    return result;
  });

  try {
    const winner = await Promise.any(parallelPromises);
    console.log(`[Walrus] ✅ Blob stored via: ${winner.publisher}`);
    return winner;
  } catch {
    // All parallel attempts failed — try sequential fallback silently
  }

  // ROUND 2: Sequential retry — primary publishers only, each uses its own timeout
  const round2Candidates = WALRUS_PUBLISHERS.filter(p => p.priority === 'primary');
  for (const p of round2Candidates) {
    const result = await tryPublisher(p.url, receiptJson, p.timeout);
    if (result) {
      console.log(`[Walrus] ✅ Round 2 success via: ${result.publisher}`);
      return result;
    }
  }

  // Only log the final "all failed" summary — individual publisher errors are suppressed above
  return null;
}

async function verifyBlobStored(blobId: string): Promise<boolean> {
  for (const aggregatorBase of WALRUS_AGGREGATORS) {
    try {
      const response = await fetch(`${aggregatorBase}/${blobId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        console.log(`[Walrus] ✅ Blob ${blobId} verified on: ${aggregatorBase}`);
        return true;
      }
    } catch {}
  }
  console.warn(`[Walrus] ⚠️ Blob ${blobId} could not be verified (may still be certifying)`);
  return false;
}

export async function storeBetReceipt(data: BetReceiptData): Promise<WalrusStoreResponse> {
  const receiptJson = generateReceiptJson(data);
  const receiptHash = hashReceipt(receiptJson);

  const result = await storeViaHttp(receiptJson);

  if (result) {
    console.log(`🐋 Walrus MAINNET receipt stored: ${result.blobId} (via ${result.publisher})`);
    verifyBlobStored(result.blobId).catch(() => {});
    return {
      blobId: result.blobId,
      receiptJson,
      receiptHash,
      publisherUsed: result.publisher,
      storageEpoch: result.storageEpoch,
      endEpoch: result.endEpoch,
      walCost: result.walCost,
    };
  }

  console.warn(`[Walrus] All publishers failed — receipt stored locally (hash: ${receiptHash})`);
  return { blobId: null, receiptJson, receiptHash, error: 'All Walrus publishers unreachable' };
}

export async function getBetReceipt(blobId: string): Promise<any | null> {
  for (const aggregatorBase of WALRUS_AGGREGATORS) {
    try {
      const response = await fetch(`${aggregatorBase}/${blobId}`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) continue;

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text, format: 'text' };
      }
    } catch (err: any) {
      console.warn(`[Walrus] Aggregator ${aggregatorBase} failed for ${blobId}: ${err.message}`);
    }
  }
  return null;
}

export function getWalrusAggregatorUrl(blobId: string): string {
  return `${WALRUS_AGGREGATORS[0]}/${blobId}`;
}

/**
 * Re-upload an existing receipt JSON string to Walrus to get a real blob ID.
 * Used by the retry worker to upgrade `local_` blob IDs to real ones.
 */
export async function reuploadReceiptJson(receiptJson: string): Promise<{ blobId: string; publisherUsed: string } | null> {
  const result = await storeViaHttp(receiptJson);
  if (result) return { blobId: result.blobId, publisherUsed: result.publisher };
  return null;
}

export async function checkPublisherHealth(): Promise<Record<string, { status: string; latencyMs?: number }>> {
  const testPayload = JSON.stringify({ suibets_health_check: true, ts: Date.now() });
  const results: Record<string, { status: string; latencyMs?: number }> = {};

  await Promise.allSettled(
    WALRUS_PUBLISHERS.map(async (p) => {
      const start = Date.now();
      const displayUrl = p.url.includes('nami.cloud') ? 'nami.cloud/[key]/v1/blobs' : p.url;
      try {
        const response = await fetch(`${p.url}?epochs=1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: testPayload,
          signal: AbortSignal.timeout(15000),
        });
        const latencyMs = Date.now() - start;
        if (response.ok) {
          const json = await response.json().catch(() => null);
          const data = json ? extractBlobData(json) : { blobId: null };
          results[displayUrl] = {
            status: data.blobId ? `✅ working (blobId: ${data.blobId.slice(0, 12)}... epoch: ${data.storageEpoch}→${data.endEpoch})` : '⚠️ responded but no blobId',
            latencyMs,
          };
        } else {
          results[displayUrl] = { status: `❌ HTTP ${response.status}`, latencyMs };
        }
      } catch (err: any) {
        const reason = err.name === 'TimeoutError' ? 'timeout'
          : err.cause?.code === 'ECONNREFUSED' ? 'connection refused'
          : err.cause?.code === 'ENOTFOUND' ? 'DNS not found'
          : err.message;
        results[displayUrl] = { status: `❌ ${reason}`, latencyMs: Date.now() - start };
      }
    })
  );

  return results;
}
