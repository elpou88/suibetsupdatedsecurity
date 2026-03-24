import https from 'https';

const CETUS_POOL_ID = '0xa809b51ec650e4ae45224107e62787be5e58f9caf8d3f74542f8edd73dc37a50';
const CETUS_CLMM_PACKAGE = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb';
const LP_BURN_PACKAGE = '0x12d73de9a6bc3cb658ec9dc0fe7de2662be1cea5c76c092fcc3606048cdbac27';
const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';

const KNOWN_BURN_PROOFS: Record<string, string> = {
  '0x9f11af34d93b2672b501296ad6e26cf9c2f8f382ea35fcaad1140fbd6b78e516': '0xe67d8d37c8da98321fed63a54bd29385aecd14930e6f0714a5aa93c6bec89cc6',
};

interface LpPosition {
  positionId: string;
  ownerAddress: string;
  liquidity: string;
  liquidityNum: number;
  sharePercentage: number;
  isBurned: boolean;
}

interface LpCacheData {
  positions: LpPosition[];
  totalLiquidity: number;
  lastUpdated: number;
}

let lpCache: LpCacheData | null = null;
const LP_CACHE_TTL = 2 * 60 * 1000;

function rpcCall(method: string, params: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(SUI_RPC);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 30000
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(data);
    req.end();
  });
}

async function getObjectSafe(objectId: string): Promise<any> {
  try {
    const result = await rpcCall('sui_getObject', [objectId, { showContent: true, showOwner: true, showType: true }]);
    return result?.result?.data || null;
  } catch {
    return null;
  }
}

async function fetchLpPositions(): Promise<LpPosition[]> {
  const pool = await getObjectSafe(CETUS_POOL_ID);
  if (!pool) {
    console.error('[CetusLP] Could not fetch pool object');
    return [];
  }

  const posManager = pool.content?.fields?.position_manager?.fields;
  const positionsTable = posManager?.positions?.fields;
  const tableId = positionsTable?.id?.id;

  if (!tableId) {
    console.error('[CetusLP] Could not find positions linked_table');
    return [];
  }

  let cursor: string | null = null;
  const fields: any[] = [];
  do {
    const df = await rpcCall('suix_getDynamicFields', [tableId, cursor, 50]);
    const pageData = df?.result?.data || [];
    fields.push(...pageData);
    cursor = df?.result?.hasNextPage ? df?.result?.nextCursor : null;
    if (cursor) await new Promise(r => setTimeout(r, 100));
  } while (cursor);

  const positions: LpPosition[] = [];

  for (const field of fields) {
    const positionObjectId = field.name?.value;
    if (!positionObjectId) continue;

    const posObj = await getObjectSafe(positionObjectId);

    let ownerAddress = '';
    let liquidity = '0';
    let isBurned = false;

    if (posObj) {
      const posType = posObj.content?.type || '';
      const posFields = posObj.content?.fields;
      const owner = posObj.owner;

      if (posType.includes('position::Position')) {
        liquidity = posFields?.liquidity || '0';
        if (owner?.AddressOwner) {
          ownerAddress = owner.AddressOwner;
        } else if (owner?.ObjectOwner) {
          const parentObj = await getObjectSafe(owner.ObjectOwner);
          if (parentObj) {
            const parentType = parentObj.content?.type || '';
            if (parentType.includes('CetusLPBurnProof') || parentType.includes('lp_burn')) {
              isBurned = true;
            }
            ownerAddress = parentObj.owner?.AddressOwner || '';
          }
        }
      } else if (posType.includes('CetusLPBurnProof') || posType.includes('lp_burn')) {
        isBurned = true;
        const innerPos = posFields?.position?.fields;
        liquidity = innerPos?.liquidity || '0';
        ownerAddress = owner?.AddressOwner || '';
      } else {
        liquidity = posFields?.liquidity || '0';
        ownerAddress = owner?.AddressOwner || '';
      }
    } else {
      const burnProofId = KNOWN_BURN_PROOFS[positionObjectId];
      if (burnProofId) {
        const burnObj = await getObjectSafe(burnProofId);
        if (burnObj) {
          isBurned = true;
          const innerPos = burnObj.content?.fields?.position?.fields;
          liquidity = innerPos?.liquidity || '0';
          ownerAddress = burnObj.owner?.AddressOwner || '';
        }
      }

      if (!ownerAddress) {
        const nodeObj = await rpcCall('sui_getObject', [field.objectId, { showContent: true }]);
        const nodeFields = nodeObj?.result?.data?.content?.fields;
        const valueFields = nodeFields?.value?.fields || nodeFields?.value;
        if (valueFields?.liquidity) {
          liquidity = valueFields.liquidity.toString();
          console.log(`[CetusLP] Position ${positionObjectId.slice(0,12)}... is wrapped — liquidity from PositionInfo: ${liquidity}`);
        }
      }
    }

    if (liquidity === '0' || (!ownerAddress && !isBurned)) continue;

    positions.push({
      positionId: positionObjectId,
      ownerAddress: ownerAddress || 'wrapped_unknown',
      liquidity,
      liquidityNum: parseFloat(liquidity),
      sharePercentage: 0,
      isBurned
    });

    await new Promise(r => setTimeout(r, 100));
  }

  const claimableLiquidity = positions.filter(p => !p.isBurned).reduce((sum, p) => sum + p.liquidityNum, 0);
  for (const pos of positions) {
    if (pos.isBurned) {
      pos.sharePercentage = 0;
    } else {
      pos.sharePercentage = claimableLiquidity > 0 ? (pos.liquidityNum / claimableLiquidity) * 100 : 0;
    }
  }

  return positions;
}

export async function getCetusLpPositions(): Promise<LpCacheData> {
  if (lpCache && Date.now() - lpCache.lastUpdated < LP_CACHE_TTL) {
    return lpCache;
  }

  try {
    const positions = await fetchLpPositions();
    const claimableLiquidity = positions.filter(p => !p.isBurned).reduce((sum, p) => sum + p.liquidityNum, 0);

    lpCache = {
      positions,
      totalLiquidity: claimableLiquidity,
      lastUpdated: Date.now()
    };

    console.log(`[CetusLP] Fetched ${positions.length} LP positions | Claimable liquidity: ${claimableLiquidity.toLocaleString()} (burned positions excluded)`);
    for (const pos of positions) {
      console.log(`  Position ${pos.positionId.slice(0, 12)}... | Owner: ${pos.ownerAddress.slice(0, 12)}... | Liquidity: ${pos.liquidityNum.toLocaleString()} (${pos.sharePercentage.toFixed(4)}%) ${pos.isBurned ? '[BURNED]' : ''}`);
    }

    return lpCache;
  } catch (error) {
    console.error('[CetusLP] Error fetching positions:', error);
    if (lpCache) return lpCache;
    return { positions: [], totalLiquidity: 0, lastUpdated: Date.now() };
  }
}

export async function getUserLpShare(walletAddress: string): Promise<{
  hasPosition: boolean;
  totalLiquidity: number;
  userLiquidity: number;
  sharePercentage: number;
  positions: Array<{ positionId: string; liquidity: number; sharePercentage: number; isBurned: boolean }>;
}> {
  const data = await getCetusLpPositions();
  const normalizedWallet = walletAddress.toLowerCase();

  const userPositions = data.positions.filter(p =>
    p.ownerAddress.toLowerCase() === normalizedWallet
  );

  const claimablePositions = userPositions.filter(p => !p.isBurned);
  const userLiquidity = claimablePositions.reduce((sum, p) => sum + p.liquidityNum, 0);
  const sharePercentage = data.totalLiquidity > 0 ? (userLiquidity / data.totalLiquidity) * 100 : 0;

  return {
    hasPosition: userPositions.length > 0,
    totalLiquidity: data.totalLiquidity,
    userLiquidity,
    sharePercentage,
    positions: userPositions.map(p => ({
      positionId: p.positionId,
      liquidity: p.liquidityNum,
      sharePercentage: p.sharePercentage,
      isBurned: p.isBurned
    }))
  };
}

export function invalidateLpCache(): void {
  lpCache = null;
}

let lpRefreshInterval: ReturnType<typeof setInterval> | null = null;

export function startLpBackgroundRefresh(): void {
  if (lpRefreshInterval) return;
  getCetusLpPositions().catch(() => {});
  lpRefreshInterval = setInterval(async () => {
    try {
      lpCache = null;
      await getCetusLpPositions();
    } catch (err) {
      console.error('[CetusLP] Background refresh failed:', err);
    }
  }, LP_CACHE_TTL);
  console.log(`[CetusLP] Background refresh started (every ${LP_CACHE_TTL / 1000}s)`);
}
