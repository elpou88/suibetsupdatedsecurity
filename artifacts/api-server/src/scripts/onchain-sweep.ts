/**
 * onchain-sweep.ts
 * ────────────────
 * Direct on-chain sweep: reads ALL open entries from the P2PRegistry's
 * open_offers and open_parlays Tables, checks each object's on-chain
 * status and expiresAt, and calls expire_offer / expire_parlay for every
 * object that is STATUS_OPEN and past its expiry time.
 *
 * No database needed — truth is read straight from Sui mainnet.
 * Uses ADMIN_PRIVATE_KEY from env (same key Railway uses).
 *
 * Run:  pnpm --filter @workspace/api-server run onchain-sweep
 */

import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { Transaction }         from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { getSuiClient }        from '../lib/suiRpcConfig';

// ── Config ───────────────────────────────────────────────────────────────────
const PACKAGE_ID  = (process.env.P2P_PACKAGE_ID  || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59').trim();
const CONFIG_ID   = (process.env.P2P_CONFIG_ID   || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf').trim();
const REGISTRY_ID = (process.env.P2P_REGISTRY_ID || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d').trim();
const SUI_COIN    = '0x2::sui::SUI';

const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY ?? '';
if (!ADMIN_KEY) { console.error('❌  ADMIN_PRIVATE_KEY env var required'); process.exit(1); }

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m';
const OK   = (s: string) => console.log(`${G}  ✅  ${s}${X}`);
const FAIL = (s: string) => console.log(`${R}  ❌  ${s}${X}`);
const WARN = (s: string) => console.log(`${Y}  ⏳  ${s}${X}`);
const INFO = (s: string) => console.log(`${C}  ℹ️   ${s}${X}`);

// ── Keypair ──────────────────────────────────────────────────────────────────
function loadKeypair(): Ed25519Keypair {
  try {
    const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    return Ed25519Keypair.fromSecretKey(ADMIN_KEY as any);
  }
}

// ── Read all IDs from a Sui Table (via getDynamicFields on the table's inner UID) ──
async function readAllTableIds(client: any, tableUid: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page: any = await client.getDynamicFields({
      parentId: tableUid,
      ...(cursor ? { cursor } : {}),
    });
    for (const entry of (page.data ?? [])) {
      // The Table<ID, bool> key is the offer/parlay object ID
      const id = entry.name?.value as string | undefined;
      if (id) ids.push(id);
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return ids;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(64)}`);
  console.log('  SuiBets — Direct On-Chain Sweep (no DB required)');
  console.log('  Reads P2PRegistry Tables → expires OPEN+past-expiry objects');
  console.log(`${'═'.repeat(64)}\n`);

  const client = getSuiClient() as any;
  const kp     = loadKeypair();
  const wallet  = kp.getPublicKey().toSuiAddress();
  INFO(`Wallet: ${wallet}`);

  // Balance check
  const coinRes = await client.getCoins({ owner: wallet, coinType: SUI_COIN });
  const balance = (coinRes.data ?? []).reduce((s: bigint, c: any) => s + BigInt(c.balance), 0n);
  INFO(`Balance: ${(Number(balance) / 1e9).toFixed(4)} SUI`);
  if (balance < 10_000_000n) {
    FAIL('Insufficient balance — need at least 0.01 SUI for gas');
    process.exit(1);
  }

  // ── 1. Read the registry to find Table inner UIDs ─────────────────────────
  INFO(`Reading registry ${REGISTRY_ID.slice(0, 20)}…`);
  const regObj: any = await client.getObject({
    id: REGISTRY_ID,
    options: { showContent: true },
  });
  const regFields = regObj?.data?.content?.fields ?? {};

  // In Sui Move, Table<K,V> serialises as { id: { id: "0x..." }, size: "N" }
  const offersTableId  = regFields?.open_offers?.fields?.id?.id  as string | undefined;
  const parlaysTableId = regFields?.open_parlays?.fields?.id?.id as string | undefined;

  if (!offersTableId || !parlaysTableId) {
    FAIL(`Could not read Table UIDs from registry. offersTableId=${offersTableId} parlaysTableId=${parlaysTableId}`);
    FAIL(`Registry fields keys: ${Object.keys(regFields).join(', ')}`);
    process.exit(1);
  }

  const openOffersCount  = Number(regFields?.open_offers?.fields?.size  ?? 0);
  const openParlaysCount = Number(regFields?.open_parlays?.fields?.size ?? 0);
  INFO(`Registry reports: ${openOffersCount} open offers, ${openParlaysCount} open parlays`);
  INFO(`open_offers  Table UID: ${offersTableId.slice(0, 20)}…`);
  INFO(`open_parlays Table UID: ${parlaysTableId.slice(0, 20)}…`);

  // ── 2. Enumerate all IDs from both Tables ─────────────────────────────────
  INFO('Reading all offer IDs from open_offers table…');
  const offerIds  = await readAllTableIds(client, offersTableId);
  INFO(`Reading all parlay IDs from open_parlays table…`);
  const parlayIds = await readAllTableIds(client, parlaysTableId);
  INFO(`Found ${offerIds.length} offer IDs, ${parlayIds.length} parlay IDs`);

  if (offerIds.length === 0 && parlayIds.length === 0) {
    OK('Tables are empty — nothing to sweep.');
    return;
  }

  // ── 3. Inspect each object for status + expiry ────────────────────────────
  const nowMs = Date.now();
  const expiredOffers:  { id: string; coinType: string }[] = [];
  const expiredParlays: { id: string; coinType: string }[] = [];
  let   alreadyDone = 0;
  let   notExpired  = 0;
  let   noExpiry    = 0;

  const inspectObject = async (id: string, kind: 'offer' | 'parlay') => {
    let obj: any;
    try {
      obj = await client.getObject({ id, options: { showContent: true, showType: true } });
    } catch (e: any) {
      WARN(`${id.slice(0,14)}… fetch error: ${e.message}`);
      return;
    }

    const rawType  = (obj?.data?.type ?? '') as string;
    const fields   = obj?.data?.content?.fields ?? {};
    const status    = Number(fields.status ?? fields.status_value ?? -1);
    const expiresAt = Number(fields.expires_at ?? 0);

    // STATUS_OPEN = 0
    if (status !== 0) {
      INFO(`${kind} ${id.slice(0,14)}… already settled (status=${status})`);
      alreadyDone++;
      return;
    }

    if (expiresAt === 0) {
      WARN(`${kind} ${id.slice(0,14)}… no expiry set (status=OPEN, will skip)`);
      noExpiry++;
      return;
    }

    if (expiresAt > nowMs) {
      const minsLeft = Math.ceil((expiresAt - nowMs) / 60000);
      WARN(`${kind} ${id.slice(0,14)}… not expired yet (~${minsLeft}m remaining)`);
      notExpired++;
      return;
    }

    // Extract coin type from generic param: `…::P2POffer<0x2::sui::SUI>`
    const coinMatch = rawType.match(/<(.+)>$/);
    const coinType  = coinMatch?.[1]?.trim() ?? SUI_COIN;
    const expired   = new Date(expiresAt).toISOString();
    INFO(`${kind} ${id.slice(0,14)}… EXPIRED at ${expired} (coin: ${coinType.split('::').pop()})`);

    if (kind === 'offer')  expiredOffers.push({ id, coinType });
    else                   expiredParlays.push({ id, coinType });
  };

  for (const id of offerIds)  await inspectObject(id, 'offer');
  for (const id of parlayIds) await inspectObject(id, 'parlay');

  console.log('');
  INFO(`Already settled/cancelled on-chain:  ${alreadyDone}`);
  INFO(`Not yet expired (still open):        ${notExpired}`);
  INFO(`No expiry set:                       ${noExpiry}`);
  INFO(`Offers  to expire now:               ${expiredOffers.length}`);
  INFO(`Parlays to expire now:               ${expiredParlays.length}`);

  if (expiredOffers.length === 0 && expiredParlays.length === 0) {
    OK('\nNothing to expire — all open objects are either not-yet-expired or already settled!');
    return;
  }

  // ── 4. Expire offers ───────────────────────────────────────────────────────
  console.log('');
  let offerOk = 0, offerFail = 0;
  for (const { id, coinType } of expiredOffers) {
    await new Promise(r => setTimeout(r, 800));
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::p2p_betting::expire_offer`,
        typeArguments: [coinType],
        arguments: [
          tx.object(id),
          tx.object(REGISTRY_ID),
          tx.object('0x6'),  // Sui Clock
        ],
      });
      tx.setGasBudget(5_000_000);
      const res = await client.signAndExecuteTransaction({
        signer: kp,
        transaction: tx,
        options: { showEffects: true },
      });
      if (res.effects?.status?.status === 'success') {
        OK(`expire_offer  ${id.slice(0,14)}… → https://suiscan.xyz/mainnet/tx/${res.digest}`);
        offerOk++;
      } else {
        FAIL(`expire_offer  ${id.slice(0,14)}… failed: ${res.effects?.status?.error}`);
        offerFail++;
      }
    } catch (e: any) {
      const msg = (e.message ?? '') as string;
      if (msg.includes('EAlreadySettled') || msg.includes('abort 11') || msg.includes('abort 5')) {
        WARN(`expire_offer  ${id.slice(0,14)}… already terminal (${msg.includes('11') ? 'abort 11' : 'abort 5'}) — skipping`);
      } else {
        FAIL(`expire_offer  ${id.slice(0,14)}… exception: ${msg.slice(0, 120)}`);
        offerFail++;
      }
    }
  }

  // ── 5. Expire parlays ──────────────────────────────────────────────────────
  let parlayOk = 0, parlayFail = 0;
  for (const { id, coinType } of expiredParlays) {
    await new Promise(r => setTimeout(r, 800));
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::p2p_betting::expire_parlay`,
        typeArguments: [coinType],
        arguments: [
          tx.object(id),
          tx.object(REGISTRY_ID),
          tx.object('0x6'),
        ],
      });
      tx.setGasBudget(5_000_000);
      const res = await client.signAndExecuteTransaction({
        signer: kp,
        transaction: tx,
        options: { showEffects: true },
      });
      if (res.effects?.status?.status === 'success') {
        OK(`expire_parlay ${id.slice(0,14)}… → https://suiscan.xyz/mainnet/tx/${res.digest}`);
        parlayOk++;
      } else {
        FAIL(`expire_parlay ${id.slice(0,14)}… failed: ${res.effects?.status?.error}`);
        parlayFail++;
      }
    } catch (e: any) {
      const msg = (e.message ?? '') as string;
      if (msg.includes('EAlreadySettled') || msg.includes('abort 11') || msg.includes('abort 5')) {
        WARN(`expire_parlay ${id.slice(0,14)}… already terminal — skipping`);
      } else {
        FAIL(`expire_parlay ${id.slice(0,14)}… exception: ${msg.slice(0, 120)}`);
        parlayFail++;
      }
    }
  }

  // ── 6. Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(64)}`);
  console.log('  SWEEP COMPLETE');
  console.log(`${'─'.repeat(64)}`);
  console.log(`  Offers:  ✅ ${offerOk} expired   ❌ ${offerFail} failed`);
  console.log(`  Parlays: ✅ ${parlayOk} expired   ❌ ${parlayFail} failed`);
  console.log(`${'═'.repeat(64)}\n`);

  if (offerFail + parlayFail > 0) process.exit(1);
}

main().catch(e => { console.error('Sweep crashed:', e); process.exit(1); });
