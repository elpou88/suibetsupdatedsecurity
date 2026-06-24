import type { SuiHybridClient } from '../lib/suiHybridClient';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const WALRUS_SITES_PACKAGE = '0x26eb7ee8688da02c5f671679524e379f0b837a12f1d1d799f255b7eea260ad27';
const SITE_OBJECT_ID = '0x7a538ca8c822a006210105b7a804842ba62a56510f35a2cf1a67a5e04fec5aba';
const BACKEND_URL = 'https://www.suibets.com';
const STORE_EPOCHS = 5;

// ⚠️ Walrus mainnet has NO public unauthenticated publishers (as of 2026).
// Old community publishers (StakeTab, Mysten public, etc.) are all dead.
// Configure one of the following authenticated providers:
//   NAMI_CLOUD_ENDPOINT_KEY  → https://nami.cloud
//   WALRUS_TRITON_PUBLISHER_URL → https://triton.one/products/walrus
//   WALRUS_PUBLISHER_URL     → custom / self-hosted
function buildSitePublisherList(): string[] {
  const list: string[] = [];
  for (const envKey of ['WALRUS_PUBLISHER_URL', 'WALRUS_PUBLISHER_URL_2', 'WALRUS_PUBLISHER_URL_3']) {
    const url = process.env[envKey]?.trim();
    if (url) list.push(url.replace(/\/$/, ''));
  }
  const tritonUrl = process.env.WALRUS_TRITON_PUBLISHER_URL?.trim();
  if (tritonUrl) list.push(tritonUrl.replace(/\/$/, ''));
  const namiKey = process.env.NAMI_CLOUD_ENDPOINT_KEY?.trim();
  if (namiKey) list.push(`https://walrus-mainnet-publisher.nami.cloud/${namiKey}`);
  return list;
}
const WALRUS_PUBLISHERS = buildSitePublisherList();

const CONTENT_TYPE_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.map': 'application/json',
};

interface DeployStatus {
  status: 'idle' | 'building' | 'uploading' | 'updating' | 'complete' | 'error';
  message: string;
  progress: number;
  totalFiles: number;
  uploadedFiles: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  filesUpdated: string[];
  txDigest: string | null;
}

let deployStatus: DeployStatus = {
  status: 'idle',
  message: 'Ready',
  progress: 0,
  totalFiles: 0,
  uploadedFiles: 0,
  startedAt: null,
  completedAt: null,
  error: null,
  filesUpdated: [],
  txDigest: null,
};
let isDeploying = false;

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
}

function getAllFiles(dir: string, baseDir: string = dir): { relativePath: string; absolutePath: string }[] {
  const results: { relativePath: string; absolutePath: string }[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, baseDir));
    } else {
      const relativePath = '/' + path.relative(baseDir, fullPath);
      results.push({ relativePath, absolutePath: fullPath });
    }
  }
  return results;
}

function base64urlToBuffer(b64url: string): Buffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function bufferToU256(buf: Buffer): string {
  return BigInt('0x' + buf.toString('hex')).toString();
}

function computeBlobHash(data: Buffer): string {
  const hash = createHash('sha256').update(data).digest();
  return bufferToU256(hash);
}

async function uploadToWalrus(data: Buffer): Promise<{ blobId: string; blobIdU256: string } | null> {
  for (const publisher of WALRUS_PUBLISHERS) {
    try {
      const url = `${publisher}/v1/blobs?epochs=${STORE_EPOCHS}&deletable=true`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.log(`[WalrusDeploy] Publisher ${publisher} returned ${resp.status}: ${errText.substring(0, 200)}`);
        continue;
      }
      const result: any = await resp.json();
      let blobIdRaw: string;
      if (result.newlyCreated) {
        blobIdRaw = result.newlyCreated.blobObject?.blobId || result.newlyCreated.blobId;
      } else if (result.alreadyCertified) {
        blobIdRaw = result.alreadyCertified.blobId;
      } else {
        console.log(`[WalrusDeploy] Unexpected response from ${publisher}:`, JSON.stringify(result).substring(0, 200));
        continue;
      }
      const blobIdBytes = base64urlToBuffer(blobIdRaw);
      const blobIdU256 = bufferToU256(blobIdBytes);
      console.log(`[WalrusDeploy] Uploaded blob via ${publisher}: ${blobIdRaw} → U256: ${blobIdU256.substring(0, 20)}...`);
      return { blobId: blobIdRaw, blobIdU256 };
    } catch (err: any) {
      console.log(`[WalrusDeploy] Publisher ${publisher} failed: ${err.message}`);
    }
  }
  return null;
}

async function getCurrentResources(client: SuiHybridClient): Promise<Map<string, string>> {
  const resources = new Map<string, string>();
  let cursor: string | null | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const result = await client.getDynamicFields({
      parentId: SITE_OBJECT_ID,
      limit: 50,
      cursor: cursor || undefined,
    });
    for (const field of result.data) {
      if (field.name?.value?.path) {
        resources.set(field.name.value.path, field.objectId);
      }
    }
    hasMore = result.hasNextPage;
    cursor = result.nextCursor;
  }
  return resources;
}

async function deployToWalrusSites(): Promise<DeployStatus> {
  if (isDeploying) {
    return { ...deployStatus, error: 'Deploy already in progress' };
  }

  isDeploying = true;
  deployStatus = {
    status: 'building',
    message: 'Building frontend...',
    progress: 0,
    totalFiles: 0,
    uploadedFiles: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    filesUpdated: [],
    txDigest: null,
  };

  try {
    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    if (!privateKey) throw new Error('ADMIN_PRIVATE_KEY not configured');

    let keypair: Ed25519Keypair;
    try {
      const { secretKey } = decodeSuiPrivateKey(privateKey);
      keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } catch {
      throw new Error('Failed to parse admin key — check ADMIN_PRIVATE_KEY format');
    }
    const senderAddress = keypair.getPublicKey().toSuiAddress();
    const { getSuiClient: getSuiRpcClient } = await import('../lib/suiRpcConfig');
    const client = getSuiRpcClient();

    const balance = await client.getBalance({ owner: senderAddress });
    const suiBalance = Number(balance.totalBalance) / 1e9;
    if (suiBalance < 0.1) {
      throw new Error(`Insufficient SUI for gas. Wallet ${senderAddress} has ${suiBalance.toFixed(4)} SUI. Need at least 0.1 SUI.`);
    }

    console.log(`[WalrusDeploy] Starting deploy. Wallet: ${senderAddress} (${suiBalance.toFixed(4)} SUI)`);

    deployStatus.message = 'Building frontend with Vite...';
    const buildDir = path.resolve(process.cwd(), 'dist/public');
    try {
      execSync(`VITE_API_BASE_URL="${BACKEND_URL}" npx vite build`, {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 120000,
        env: (() => {
          const safeEnv = { ...process.env, VITE_API_BASE_URL: BACKEND_URL };
          delete safeEnv.ADMIN_PRIVATE_KEY;
          delete safeEnv.ORACLE_PRIVATE_KEY;
          return safeEnv;
        })(),
      });
    } catch (buildErr: any) {
      throw new Error(`Vite build failed: ${buildErr.stderr?.toString().substring(0, 500) || buildErr.message}`);
    }

    if (!fs.existsSync(buildDir)) throw new Error('Build output not found at dist/public');
    console.log('[WalrusDeploy] Frontend build complete');

    const files = getAllFiles(buildDir);
    deployStatus.totalFiles = files.length;
    deployStatus.status = 'uploading';
    deployStatus.message = `Uploading ${files.length} files to Walrus...`;
    console.log(`[WalrusDeploy] ${files.length} files to upload`);

    const currentResources = await getCurrentResources(client);
    console.log(`[WalrusDeploy] ${currentResources.size} existing resources on site`);

    const uploadedFiles: { path: string; blobIdU256: string; blobHash: string; contentType: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileData = fs.readFileSync(file.absolutePath);
      const blobHash = computeBlobHash(fileData);
      const contentType = getContentType(file.absolutePath);

      const result = await uploadToWalrus(fileData);
      if (!result) {
        console.log(`[WalrusDeploy] WARNING: Failed to upload ${file.relativePath}, skipping`);
        continue;
      }

      uploadedFiles.push({
        path: file.relativePath,
        blobIdU256: result.blobIdU256,
        blobHash,
        contentType,
      });

      deployStatus.uploadedFiles = i + 1;
      deployStatus.progress = Math.round(((i + 1) / files.length) * 80);
      deployStatus.message = `Uploaded ${i + 1}/${files.length}: ${file.relativePath}`;
    }

    if (uploadedFiles.length === 0) throw new Error('No files were uploaded successfully');

    deployStatus.status = 'updating';
    deployStatus.message = 'Updating site on Sui blockchain...';
    deployStatus.progress = 85;
    console.log(`[WalrusDeploy] ${uploadedFiles.length} files uploaded. Building transaction...`);

    const MAX_RESOURCES_PER_TX = 15;
    const batches: typeof uploadedFiles[] = [];
    for (let i = 0; i < uploadedFiles.length; i += MAX_RESOURCES_PER_TX) {
      batches.push(uploadedFiles.slice(i, i + MAX_RESOURCES_PER_TX));
    }

    const existingPaths = new Set(currentResources.keys());
    const newPaths = new Set(uploadedFiles.map(f => f.path));
    const pathsToRemove = [...existingPaths].filter(p => !newPaths.has(p));

    let lastTxDigest = '';

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const tx = new Transaction();
      tx.setGasBudget(500_000_000);

      if (batchIdx === 0) {
        for (const removePath of pathsToRemove) {
          tx.moveCall({
            target: `${WALRUS_SITES_PACKAGE}::site::remove_resource_if_exists`,
            arguments: [
              tx.object(SITE_OBJECT_ID),
              tx.pure.string(removePath),
            ],
          });
        }
      }

      for (const file of batch) {
        tx.moveCall({
          target: `${WALRUS_SITES_PACKAGE}::site::remove_resource_if_exists`,
          arguments: [
            tx.object(SITE_OBJECT_ID),
            tx.pure.string(file.path),
          ],
        });

        const resource = tx.moveCall({
          target: `${WALRUS_SITES_PACKAGE}::site::new_resource`,
          arguments: [
            tx.pure.string(file.path),
            tx.pure.u256(file.blobIdU256),
            tx.pure.u256(file.blobHash),
            tx.moveCall({
              target: '0x1::option::none',
              typeArguments: [`${WALRUS_SITES_PACKAGE}::site::Range`],
            }),
          ],
        });

        tx.moveCall({
          target: `${WALRUS_SITES_PACKAGE}::site::add_header`,
          arguments: [
            resource,
            tx.pure.string('content-type'),
            tx.pure.string(file.contentType),
          ],
        });

        tx.moveCall({
          target: `${WALRUS_SITES_PACKAGE}::site::add_header`,
          arguments: [
            resource,
            tx.pure.string('content-encoding'),
            tx.pure.string('identity'),
          ],
        });

        tx.moveCall({
          target: `${WALRUS_SITES_PACKAGE}::site::add_resource`,
          arguments: [
            tx.object(SITE_OBJECT_ID),
            resource,
          ],
        });
      }

      deployStatus.message = `Submitting transaction ${batchIdx + 1}/${batches.length}...`;
      deployStatus.progress = 85 + Math.round(((batchIdx + 1) / batches.length) * 15);

      console.log(`[WalrusDeploy] Submitting batch ${batchIdx + 1}/${batches.length} (${batch.length} resources)...`);

      const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status !== 'success') {
        const errMsg = result.effects?.status?.error || 'Unknown error';
        throw new Error(`Transaction ${batchIdx + 1} failed: ${errMsg}`);
      }

      lastTxDigest = result.digest;
      console.log(`[WalrusDeploy] Batch ${batchIdx + 1} confirmed: ${result.digest}`);

      deployStatus.filesUpdated.push(...batch.map(f => f.path));
    }

    deployStatus = {
      status: 'complete',
      message: `Successfully deployed ${uploadedFiles.length} files to Walrus Sites`,
      progress: 100,
      totalFiles: files.length,
      uploadedFiles: uploadedFiles.length,
      startedAt: deployStatus.startedAt,
      completedAt: Date.now(),
      error: null,
      filesUpdated: uploadedFiles.map(f => f.path),
      txDigest: lastTxDigest,
    };

    console.log(`[WalrusDeploy] Deploy complete! ${uploadedFiles.length} files, tx: ${lastTxDigest}`);
    console.log(`[WalrusDeploy] Site live at https://suibets.wal.app`);

    return deployStatus;
  } catch (err: any) {
    console.error(`[WalrusDeploy] Deploy failed: ${err.message}`);
    deployStatus = {
      ...deployStatus,
      status: 'error',
      message: `Deploy failed: ${err.message}`,
      error: err.message,
      completedAt: Date.now(),
    };
    return deployStatus;
  } finally {
    isDeploying = false;
  }
}

function getDeployStatus(): DeployStatus {
  return { ...deployStatus };
}

export { deployToWalrusSites, getDeployStatus, DeployStatus };
